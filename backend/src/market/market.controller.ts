import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { Request } from 'express';
import Stripe from 'stripe';
import { AuthGuard } from '../auth/auth.guard';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
});

type CreateCheckoutDto =
  | { type: 'ADMIN'; tokensCount: number }
  | { type: 'P2P'; listingId: number };

@Controller('market')
export class MarketController {
  constructor(private prisma: PrismaService) {}

  @Post('create-checkout')
  @UseGuards(AuthGuard)
  async createCheckout(@Req() req: Request, @Body() body: CreateCheckoutDto) {
    const user = (req as any).user;
    if (!user) throw new BadRequestException('Missing user');

    const success_url = process.env.SUCCESS_URL as string;
    const cancel_url = process.env.CANCEL_URL as string;

    if (!success_url || !cancel_url) {
      throw new BadRequestException('Missing SUCCESS_URL / CANCEL_URL env');
    }

    if (body.type === 'ADMIN') {
      const tokensCount = Number((body as any).tokensCount ?? 1);
      if (!Number.isFinite(tokensCount) || tokensCount < 1) {
        throw new BadRequestException('Invalid tokensCount');
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'eur',
              product_data: { name: `Hovorový token (x${tokensCount})` },
              unit_amount: this.getAdminUnitAmountCents(),
            },
            quantity: tokensCount,
          },
        ],
        metadata: {
          userId: user.clerkUserId, // Clerk ID
          email: user.email ?? '',
          type: 'ADMIN',
          tokensCount: String(tokensCount),
        },
        success_url,
        cancel_url,
      });

      return { url: session.url };
    }

    if (body.type === 'P2P') {
      const listingId = Number((body as any).listingId);
      if (!Number.isFinite(listingId) || listingId <= 0) {
        throw new BadRequestException('Invalid listingId');
      }

      const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
      if (!listing || listing.status !== 'open') {
        throw new BadRequestException('Listing unavailable');
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'eur',
              product_data: { name: `Hovorový token (P2P)` },
              unit_amount: listing.priceCents,
            },
            quantity: 1,
          },
        ],
        metadata: {
          userId: user.clerkUserId,
          email: user.email ?? '',
          type: 'P2P',
          listingId: String(listingId),
        },
        success_url,
        cancel_url,
      });

      return { url: session.url };
    }

    throw new BadRequestException('Invalid type');
  }

  private getAdminUnitAmountCents(): number {
    const cents = Number(process.env.ADMIN_PRICE_CENTS ?? 1999);
    return Math.max(100, Math.floor(cents));
  }
}
