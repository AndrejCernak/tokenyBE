import { Body, Controller, Post, Req, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../db/prisma.service';
import Stripe from 'stripe';

type CreateCheckoutDto =
  | { type: 'ADMIN'; tokensCount: number }
  | { type: 'P2P'; listingId: number };

@Controller('market')
@UseGuards(AuthGuard)
export class MarketController {
  constructor(
    private prisma: PrismaService,
    private cfg: ConfigService,
    @Inject('STRIPE') private stripe: Stripe,
  ) {}

  @Post('create-checkout')
  async create(@Req() req: any, @Body() dto: CreateCheckoutDto) {
    const buyerId = req.user.dbId as string;
    let amountCents = 0;
    const metadata: Record<string, string> = { buyerId };

    if (dto.type === 'ADMIN') {
      const price = Number(this.cfg.get('ADMIN_PRICE_CENTS') ?? 999);
      amountCents = price * dto.tokensCount;
      metadata.type = 'ADMIN';
      metadata.tokensCount = String(dto.tokensCount);
    } else {
      const listing = await this.prisma.listing.findUnique({ where: { id: dto.listingId } });
      if (!listing || listing.status !== 'open') throw new Error('Listing nedostupný');
      amountCents = listing.priceCents;
      metadata.type = 'P2P';
      metadata.listingId = String(listing.id);
      metadata.tokenId = listing.tokenId;
      metadata.sellerId = listing.sellerId;
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: this.cfg.get('SUCCESS_URL')!,
      cancel_url: this.cfg.get('CANCEL_URL')!,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          product_data: { name: dto.type === 'ADMIN' ? 'Tokeny (60 min / ks)' : 'P2P token (60 min)' },
        },
      }],
      metadata,
    });

    return { url: session.url };
  }
}
