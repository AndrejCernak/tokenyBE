import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '@prisma/client';

@Controller('listings')
@UseGuards(AuthGuard)
export class ListingController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async open() {
    const items = await this.prisma.listing.findMany({
      where: { status: 'open' },
      select: { id: true, priceCents: true, tokenId: true, sellerId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  // Zalistovať token (len vlastník + len plný a owned)
  @Post('create')
  async create(@Req() req: any, @Body() dto: { tokenId: string; priceCents: number }) {
    const userId = req.user.dbId as string;
    const token = await this.prisma.token.findUnique({ where: { id: dto.tokenId } });
    if (!token || token.ownerId !== userId) {
      throw new Error('Token nepatrí používateľovi.');
    }
    if (token.status !== 'owned' || token.remainingMinutes !== 60) {
      throw new Error('Listovať možno iba plný OWNED token (60 min).');
    }
    const listing = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const l = await tx.listing.create({
        data: { sellerId: userId, tokenId: token.id, priceCents: dto.priceCents, status: 'open' },
      });
      await tx.token.update({ where: { id: token.id }, data: { status: 'listed' } });
      return l;
    });
    return { listing };
  }

  // Zrušiť listing (vráti token späť do OWNED)
  @Post(':id/cancel')
  async cancel(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.dbId as string;
    const listing = await this.prisma.listing.findUnique({ where: { id: Number(id) } });
    if (!listing || listing.sellerId !== userId) throw new Error('Nedovolené.');
    if (listing.status !== 'open') throw new Error('Listing nie je open.');
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.listing.update({ where: { id: listing.id }, data: { status: 'canceled' } });
      await tx.token.update({ where: { id: listing.tokenId }, data: { status: 'owned' } });
    });
    return { ok: true };
  }
}
