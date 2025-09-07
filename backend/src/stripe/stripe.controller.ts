import { Controller, Post, Req, Res, Inject } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';

@Controller('stripe')
export class StripeController {
  constructor(
    private prisma: PrismaService,
    private cfg: ConfigService,
    @Inject('STRIPE') private stripe: Stripe,
  ) {}

  @Post('webhook')
  async webhook(@Req() req: any, @Res() res: Response) {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(req.body, sig, this.cfg.get('STRIPE_WEBHOOK_SECRET')!);
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const md = (session.metadata || {}) as Record<string, string>;
      const buyerId = md.buyerId;
      const type = md.type;

      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const exists = await tx.payment.findUnique({ where: { stripeSessionId: session.id } });
        if (exists) return;

        if (type === 'ADMIN') {
          const tokensCount = Number(md.tokensCount || '0');
          await tx.payment.create({
            data: {
              type: 'ADMIN_SALE',
              status: 'succeeded',
              userId: buyerId,
              stripeSessionId: session.id,
              stripePaymentIntentId: session.payment_intent as string | null,
              amountCents: session.amount_total ?? 0,
              tokensCount,
            },
          });
          for (let i = 0; i < tokensCount; i++) {
            const token = await tx.token.create({
              data: { ownerId: buyerId, remainingMinutes: 60, status: 'owned', mintedByAdmin: true },
            });
            await tx.ledger.create({
              data: { userId: buyerId, tokenId: token.id, deltaMinutes: +60, reason: 'buy_admin', ref: session.id },
            });
          }
        } else if (type === 'P2P') {
          const listingId = Number(md.listingId);
          const tokenId = md.tokenId!;
          const sellerId = md.sellerId!;
          const listing = await tx.listing.findUnique({ where: { id: listingId } });
          if (!listing || listing.status !== 'open') return;

          await tx.listing.update({ where: { id: listingId }, data: { status: 'filled' } });
          await tx.trade.create({ data: { listingId, buyerId, sellerId, totalCents: session.amount_total ?? 0 } });
          await tx.payment.create({
            data: {
              type: 'P2P_SALE',
              status: 'succeeded',
              userId: buyerId,
              stripeSessionId: session.id,
              stripePaymentIntentId: session.payment_intent as string | null,
              amountCents: session.amount_total ?? 0,
              trade: { connect: { listingId } },
            },
          });
          await tx.token.update({ where: { id: tokenId }, data: { ownerId: buyerId, status: 'owned' } });
          await tx.ledger.createMany({
            data: [
              { userId: sellerId, tokenId, deltaMinutes: 0, reason: 'p2p_sell', ref: session.id },
              { userId: buyerId, tokenId, deltaMinutes: 0, reason: 'p2p_buy', ref: session.id },
            ],
          });
        }
      });
    }
    return res.json({ received: true });
  }
}
