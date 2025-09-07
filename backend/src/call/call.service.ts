import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CallService {
  constructor(private prisma: PrismaService) {}

  private isFridayNow(tz = process.env.TIMEZONE || 'Europe/Bratislava') {
    if (process.env.FORCE_FRIDAY === 'true') return true;
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    return local.getDay() === 5; // 0=Sun ... 5=Fri
  }

  async createRinging(callerId: string, calleeId: string) {
    const call = await this.prisma.call.create({
      data: { callerId, calleeId, status: 'ringing', isFriday: this.isFridayNow() },
    });
    return call;
  }

  async markActive(callId: string) {
    return this.prisma.call.update({ where: { id: callId }, data: { status: 'active', startedAt: new Date() } });
  }

  async endCall(callId: string, reason: 'ended' | 'failed' = 'ended') {
    return this.prisma.call.update({ where: { id: callId }, data: { status: reason, endedAt: new Date() } });
  }

  // rezervuj token pre piatkový hovor
  async reserveTokenForCall(userId: string, callId: string) {
    const token = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const t = await tx.token.findFirst({
        where: { ownerId: userId, status: 'owned', remainingMinutes: { gt: 0 } },
        orderBy: { createdAt: 'asc' },
      });
      if (!t) return null;
      await tx.token.update({ where: { id: t.id }, data: { status: 'reserved' } });
      return t;
    });
    return token;
  }

  async chargeMinute(callId: string, tokenId: string) {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const t = await tx.token.update({
        where: { id: tokenId },
        data: { remainingMinutes: { decrement: 1 } },
      });
      await tx.call.update({ where: { id: callId }, data: { chargedMins: { increment: 1 } } });
      await tx.callCharge.create({ data: { callId, tokenId, minutes: 1 } });
      await tx.ledger.create({ data: { userId: t.ownerId!, tokenId, deltaMinutes: -1, reason: 'call_charge', ref: callId } });
      if (t.remainingMinutes - 1 <= 0) {
        await tx.token.update({ where: { id: tokenId }, data: { status: 'spent' } });
      }
    });
  }

  async releaseToken(tokenId: string) {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const t = await tx.token.findUnique({ where: { id: tokenId } });
      if (!t) return;
      if (t.remainingMinutes > 0 && t.status === 'reserved') {
        await tx.token.update({ where: { id: tokenId }, data: { status: 'owned' } });
      }
    });
  }
}
