// src/auth/clerk.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { verifyToken } from '@clerk/backend';

@Injectable()
export class ClerkStrategy {
  constructor(private prisma: PrismaService) {}

  async verifyBearerToken(authHeader?: string) {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = authHeader.slice('Bearer '.length);

    try {
      // verifyToken vráti objekt s payload (typ je unknown → treba any)
      const { payload } = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!, // 🔑
      });

      const clerkUserId = (payload as any).sub as string | undefined;
      if (!clerkUserId) {
        throw new UnauthorizedException('Invalid token: missing sub');
      }

      const email =
        (payload as any).email_addresses?.[0]?.email_address ??
        (payload as any).email ??
        null;

      // 🔑 upsert používateľa do DB
      const user = await this.prisma.user.upsert({
        where: { clerkUserId },
        update: { email: email ?? undefined },
        create: {
          clerkUserId,
          email: email ?? `${clerkUserId}@unknown.local`,
          role: 'client',
        },
      });

      return user;
    } catch (err) {
      console.error('Clerk verify error:', err);
      throw new UnauthorizedException('Invalid Clerk token');
    }
  }
}
