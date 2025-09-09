// src/index.ts
import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import fridayRoutes from "./routes";

// ⬇️ PRIDANÉ:
import Stripe from "stripe";
import bodyParser from "body-parser";

const app = express();
const prisma = new PrismaClient();

// ⬇️ PRIDANÉ: Stripe init
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ⬇️ PRIDANÉ: Webhook (MUSÍ byť pred express.json())
app.post("/stripe/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"] as string;

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = session.metadata || {};
      const paymentId = meta.paymentId!;

      // Označ succeeded
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "succeeded", stripePaymentIntent: String(session.payment_intent ?? "") },
      });

      // Fulfillment podľa typu
      if (meta.type === "treasury") {
        const buyerId = meta.buyerId!;
        const quantity = Number(meta.quantity || 0);
        const year = Number(meta.year || new Date().getFullYear());

        // tu zrecykluj tvoju logiku z /purchase (priradenie tokenov z pokladnice)
        await prisma.$transaction(async (tx) => {
          const available = await tx.fridayToken.findMany({
            where: { ownerId: null, issuedYear: year, status: "active" },
            take: quantity,
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          if (available.length < quantity) throw new Error("Treasury sold out");

          const tokenIds = available.map(t => t.id);
          await tx.fridayToken.updateMany({ where: { id: { in: tokenIds } }, data: { ownerId: buyerId } });

          const settings = await tx.fridaySettings.findUnique({ where: { id: 1 } });
          const unitPrice = Number(settings?.currentPriceEur || 0);

          await tx.fridayPurchaseItem.createMany({
            data: tokenIds.map(tokenId => ({ userId: buyerId, tokenId, unitPriceEur: unitPrice as any })),
          });
        });
      }

      if (meta.type === "listing") {
        const buyerId = meta.buyerId!;
        const listingId = meta.listingId!;

        // tu zrecykluj logiku z /buy-listing (prevod vlastníctva, uzavretie listing-u, trade záznam)
        await prisma.$transaction(async (tx) => {
          const listing = await tx.fridayListing.findUnique({ where: { id: listingId }, include: { token: true } });
          if (!listing || listing.status !== "open") throw new Error("Listing not open");

          const locked = await tx.fridayListing.updateMany({
            where: { id: listing.id, status: "open" },
            data: { status: "sold", closedAt: new Date() },
          });
          if (locked.count !== 1) throw new Error("Listing already closed");

          const tok = await tx.fridayToken.findUnique({
            where: { id: listing.tokenId },
            select: { ownerId: true, status: true, minutesRemaining: true },
          });
          if (!tok || tok.ownerId !== listing.sellerId || tok.status !== "listed" || (tok.minutesRemaining ?? 0) <= 0) {
            throw new Error("Token not purchasable");
          }

          await tx.fridayToken.update({ where: { id: listing.tokenId }, data: { ownerId: buyerId, status: "active" } });

          await tx.fridayTrade.create({
            data: {
              sellerId: listing.sellerId,
              buyerId,
              listingId: listing.id,
              tokenId: listing.tokenId,
              priceEur: listing.priceEur,
              platformFeeEur: 0 as any,
            },
          });
        });
      }
    }

    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentId = session.metadata?.paymentId;
      if (paymentId) {
        await prisma.payment.update({ where: { id: paymentId }, data: { status: "failed" } });
      }
    }

    res.json({ received: true });
  } catch (e: any) {
    console.error("Webhook error:", e.message || e);
    res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

// ⬇️ pôvodné stredy ostávajú
app.use(cors());
app.use(express.json());
app.use("/friday", fridayRoutes(prisma));

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
