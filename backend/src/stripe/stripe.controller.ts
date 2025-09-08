// src/stripe/stripe.controller.ts
import { Controller, Post, Req, Res, Inject } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { upsertUser } from '../utils/upsertUser';

@Controller('stripe')
export class StripeController {
  constructor(
    private prisma: PrismaService,
    private cfg: ConfigService,
    @Inject('STRIPE') private stripe: Stripe,
  ) {}

  /**
   * Dôležité: musíš mať raw body pre tento endpoint.
   * V main.ts napr.:
   *
   *   import { json, raw } from 'body-parser';
   *   app.use(json()); // default na všetko
   *   app.use('/stripe/webhook', raw({ type: 'application/json' })); // iba pre webhook
   *
   * A v tomto controllery používať req.rawBody.
   */
  @Post('webhook')
  async webhook(@Req() req: any, @Res() res: Response) {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        // ⚠️ musí byť raw body!
        req.rawBody ?? req.body,
        sig,
        this.cfg.get<string>('STRIPE_WEBHOOK_SECRET')!,
      );
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const md = (session.metadata || {}) as Record<string, string>;

      // Clerk identita, ktorú posielaš v metadata pri vytváraní checkoutu
      const clerkUserId = md.userId;     // Clerk sub
      const email = md.email;            // email z FE (dobrovoľné)
      const flowType = md.type;          // 'ADMIN' | 'P2P'

      if (!clerkUserId) {
        // Bez identity nevieme komu tokeny patria
        return res.status(400).json({ error: 'Missing Clerk userId in metadata' });
      }

      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Idempotencia – ak sme už spracovali túto session, skonči
        const exists = await tx.payment.findUnique({
          where: { stripeSessionId: session.id },
        });
        if (exists) return;

        // 🔑 Uisti sa, že máme používateľa v DB (User.id) – podľa Clerk ID
        const user = await tx.user.upsert({
          where: { clerkUserId },
          update: {},
          create: {
            clerkUserId,
            email: email ?? `${clerkUserId}@unknown.local`,
            role: 'client',
          },
        });

        if (flowType === 'ADMIN') {
          // nákup priamo od admina – počet tokenov je v metadata
          const tokensCount = Number(md.tokensCount || '0');
          if (!Number.isFinite(tokensCount) || tokensCount <= 0) return;

          await tx.payment.create({
            data: {
              type: 'ADMIN_SALE',
              status: 'succeeded',
              userId: user.id, // 👈 DB User.id
              stripeSessionId: session.id,
              stripePaymentIntentId: session.payment_intent as string | null,
              amountCents: session.amount_total ?? 0,
              tokensCount,
            },
          });

          for (let i = 0; i < tokensCount; i++) {
            const token = await tx.token.create({
              data: {
                ownerId: user.id,
                remainingMinutes: 60,
                status: 'owned',
                mintedByAdmin: true,
              },
            });

            await tx.ledger.create({
              data: {
                userId: user.id,
                tokenId: token.id,
                deltaMinutes: +60,
                reason: 'buy_admin',
                ref: session.id,
              },
            });
          }
        } else if (flowType === 'P2P') {
          // nákup z burzy – očakávame listingId v metadata
          const listingId = Number(md.listingId);
          if (!Number.isFinite(listingId) || listingId <= 0) return;

          // Načítaj listing z DB aj s väzbami
          const listing = await tx.listing.findUnique({
            where: { id: listingId },
            include: { token: true },
          });
          if (!listing || listing.status !== 'open') return;

          const sellerId = listing.sellerId; // DB id predávajúceho
          const tokenId = listing.tokenId;

          // Uzavri listing
          await tx.listing.update({
            where: { id: listingId },
            data: { status: 'filled' },
          });

          // Trade a Payment 1:1
          const trade = await tx.trade.create({
            data: {
              listingId,
              buyerId: user.id,      // 👈 DB User.id kupujúceho
              sellerId,              // DB User.id predávajúceho
              totalCents: session.amount_total ?? 0,
            },
          });

          await tx.payment.create({
            data: {
              type: 'P2P_SALE',
              status: 'succeeded',
              userId: user.id, // kupujúci
              stripeSessionId: session.id,
              stripePaymentIntentId: session.payment_intent as string | null,
              amountCents: session.amount_total ?? 0,
              tradeId: trade.id, // 1:1 prepojenie
            },
          });

          // Prevlastni token
          await tx.token.update({
            where: { id: tokenId },
            data: { ownerId: user.id, status: 'owned' },
          });

          // Ledger zápisy
          await tx.ledger.createMany({
            data: [
              { userId: sellerId, tokenId, deltaMinutes: 0, reason: 'p2p_sell', ref: session.id },
              { userId: user.id, tokenId, deltaMinutes: 0, reason: 'p2p_buy', ref: session.id },
            ],
          });
        }
      });
    }

    return res.json({ received: true });
  }
}
