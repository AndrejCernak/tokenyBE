// src/friday/routes.ts
import express, { Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { MAX_PRIMARY_TOKENS_PER_USER } from "./config";

export default function fridayRoutes(prisma: PrismaClient) {
  const router = express.Router();

  async function ensureSettings() {
    const existing = await prisma.fridaySettings.findUnique({ where: { id: 1 } });
    if (!existing) {
      await prisma.fridaySettings.create({ data: { id: 1, currentPriceEur: new Prisma.Decimal(0) } });
    }
    return prisma.fridaySettings.findUnique({ where: { id: 1 } });
  }

  async function ensureUser(userId: string) {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });
  }

  // ========== ADMIN ==========
  // Mint tokenov (bez auth – pridaj si middleware podľa potreby)
  router.post("/admin/mint", async (req: Request, res: Response) => {
    try {
      const { quantity, priceEur, year } = req.body as {
        quantity?: number | string;
        priceEur?: number | string;
        year?: number | string;
      };
      const qty = Number(quantity);
      const price = Number(priceEur);
      const y = Number(year) || new Date().getFullYear();

      if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ success: false, message: "Invalid quantity/priceEur" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.fridayToken.createMany({
          data: Array.from({ length: qty }, () => ({
            minutesRemaining: 60,
            status: "active",
            originalPriceEur: new Prisma.Decimal(price),
            issuedYear: y,
          })),
        });

        await tx.fridaySettings.upsert({
          where: { id: 1 },
          update: { currentPriceEur: new Prisma.Decimal(price) },
          create: { id: 1, currentPriceEur: new Prisma.Decimal(price) },
        });
      });

      return res.json({ success: true, minted: qty, priceEur: price, year: y });
    } catch (e) {
      console.error("POST /admin/mint", e);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // Nastavenie ceny v pokladnici
  router.post("/admin/set-price", async (req: Request, res: Response) => {
    try {
      const { newPrice, repriceTreasury } = req.body as {
        newPrice?: number | string;
        repriceTreasury?: boolean;
      };
      const price = Number(newPrice);
      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ success: false, message: "Invalid newPrice" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.fridaySettings.upsert({
          where: { id: 1 },
          update: { currentPriceEur: new Prisma.Decimal(price) },
          create: { id: 1, currentPriceEur: new Prisma.Decimal(price) },
        });

        if (repriceTreasury) {
          await tx.fridayToken.updateMany({
            where: { ownerId: null, status: "active" },
            data: { originalPriceEur: new Prisma.Decimal(price) },
          });
        }
      });

      return res.json({ success: true, priceEur: price });
    } catch (e) {
      console.error("POST /admin/set-price", e);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // ========== PUBLIC ==========
  // Supply (stav pokladnice pre rok)
  router.get("/supply", async (req, res) => {
    try {
      const y = Number((req.query.year as string) || new Date().getFullYear());
      const settings = await ensureSettings();

      const treasuryCount = await prisma.fridayToken.count({
        where: { ownerId: null, status: "active", issuedYear: y },
      });

      return res.json({
        year: y,
        priceEur: Number(settings?.currentPriceEur || 0),
        treasuryAvailable: treasuryCount,
        totalMinted: 0,
        totalSold: 0,
      });
    } catch (e) {
      console.error("GET /supply", e);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // Zostatok používateľa
  router.get("/balance/:userId", async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const tokens = await prisma.fridayToken.findMany({
        where: { ownerId: userId },
        orderBy: [{ issuedYear: "asc" }, { createdAt: "asc" }],
        select: { id: true, issuedYear: true, minutesRemaining: true, status: true },
      });
      const totalMinutes = tokens
        .filter((t) => t.status === "active")
        .reduce((a, t) => a + t.minutesRemaining, 0);
      return res.json({ userId, totalMinutes, tokens });
    } catch (e) {
      console.error("GET /balance/:userId", e);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // Primárny nákup z pokladnice
  router.post("/purchase", async (req: Request, res: Response) => {
    try {
      const { userId, quantity, year } = (req.body || {}) as {
        userId?: string;
        quantity?: number;
        year?: number | string;
      };

      if (!userId || !Number.isInteger(quantity) || (quantity as number) <= 0) {
        return res.status(400).json({ success: false, message: "Missing or invalid userId/quantity" });
      }
      await ensureUser(userId);

      const settings = await ensureSettings();
      const unitPrice = Number(settings?.currentPriceEur || 0);
      if (unitPrice <= 0) {
        return res.status(400).json({ success: false, message: "Treasury price not set" });
      }

      const y = Number(year) || new Date().getFullYear();

      // limit 20 ks / user / rok
      const ownedThisYear = await prisma.fridayToken.count({
        where: { ownerId: userId, issuedYear: y, status: { in: ["active", "listed"] } },
      });
      if (ownedThisYear + (quantity as number) > MAX_PRIMARY_TOKENS_PER_USER) {
        return res.status(400).json({
          success: false,
          message: `Primary limit is ${MAX_PRIMARY_TOKENS_PER_USER} tokens per user for year ${y}`,
        });
      }

      // vezmi dostupné tokeny z pokladnice
      const available = await prisma.fridayToken.findMany({
        where: { ownerId: null, issuedYear: y, status: "active" },
        take: quantity,
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (available.length < (quantity as number)) {
        return res.status(400).json({ success: false, message: "Not enough tokens in treasury" });
      }

      const amountEur = new Prisma.Decimal(unitPrice).mul(quantity as number);
      const purchasedTokenIds = available.map((a) => a.id);

      await prisma.$transaction(async (tx) => {
        // transakcia
        const tr = await tx.transaction.create({
          data: {
            userId,
            type: "friday_purchase",
            amountEur,
            secondsDelta: 0,
            note: `friday:${y}; qty:${quantity}; unit:${unitPrice}`,
          },
        });

        // priradenie tokenov
        await tx.fridayToken.updateMany({
          where: { id: { in: purchasedTokenIds } },
          data: { ownerId: userId },
        });

        // položky nákupu (1 riadok na token)
        await tx.fridayPurchaseItem.createMany({
          data: purchasedTokenIds.map((tokenId) => ({
            userId,
            tokenId,
            unitPriceEur: new Prisma.Decimal(unitPrice),
            // ak si pridáš do modelu transactionId, odkomentuj:
            // transactionId: tr.id,
          })),
        });
      });

      // odpoveď
      const tokens = await prisma.fridayToken.findMany({
        where: { ownerId: userId },
        select: { id: true, issuedYear: true, minutesRemaining: true, status: true },
        orderBy: [{ issuedYear: "asc" }, { createdAt: "asc" }],
      });
      const totalMinutes = tokens
        .filter((t) => t.status === "active")
        .reduce((a, t) => a + t.minutesRemaining, 0);

      return res.json({
        success: true,
        year: y,
        unitPrice,
        quantity,
        purchasedTokenIds,
        totalMinutes,
        tokens,
      });
    } catch (e) {
      console.error("POST /purchase", e);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // Kúpa z burzy (sekundárny obchod)
  router.post("/buy-listing", async (req: Request, res: Response) => {
    const { buyerId, listingId } = (req.body || {}) as { buyerId?: string; listingId?: string };
    if (!buyerId || !listingId) {
      return res.status(400).json({ success: false, message: "Missing buyerId/listingId" });
    }

    try {
      await ensureUser(buyerId);

      const result = await prisma.$transaction(async (tx) => {
        // 1) načítaj listing + token
        const listing = await tx.fridayListing.findUnique({
          where: { id: listingId },
          include: { token: true },
        });
        if (!listing || listing.status !== "open") throw new Error("Listing nie je dostupný");
        if (listing.sellerId === buyerId) throw new Error("Nemôžeš kúpiť vlastný listing");

        // 2) limit 20/rok aj pre sekundárny nákup (vyhoď, ak nechceš)
        const ownedThisYear = await tx.fridayToken.count({
          where: {
            ownerId: buyerId,
            issuedYear: listing.token.issuedYear,
            status: { in: ["active", "listed"] },
          },
        });
        if (ownedThisYear >= 20) {
          throw new Error(`Limit 20 tokenov pre rok ${listing.token.issuedYear} dosiahnutý`);
        }

        // 3) uzamkni listing
        const locked = await tx.fridayListing.updateMany({
          where: { id: listing.id, status: "open" },
          data: { status: "sold", closedAt: new Date() },
        });
        if (locked.count !== 1) throw new Error("Listing už bol uzavretý");

        // 4) over token
        const tok = await tx.fridayToken.findUnique({
          where: { id: listing.tokenId },
          select: { ownerId: true, status: true, minutesRemaining: true },
        });
        if (!tok || tok.ownerId !== listing.sellerId || tok.status !== "listed" || (tok.minutesRemaining ?? 0) <= 0) {
          throw new Error("Token nie je možné kúpiť");
        }

        // 5) prehoď vlastníka tokenu
        await tx.fridayToken.update({
          where: { id: listing.tokenId },
          data: { ownerId: buyerId, status: "active" },
        });

        // 6) zapíš obchod
        const platformFeeEur = new Prisma.Decimal(0);
        const trade = await tx.fridayTrade.create({
          data: {
            listingId: listing.id,
            tokenId: listing.tokenId,
            sellerId: listing.sellerId,
            buyerId,
            priceEur: listing.priceEur,
            platformFeeEur,
          },
        });

        // 7) transakčné záznamy
        await tx.transaction.createMany({
          data: [
            {
              userId: buyerId,
              type: "friday_trade_buy",
              amountEur: listing.priceEur,
              secondsDelta: 0,
              note: `listing:${listing.id}; token:${listing.tokenId}`,
            },
            {
              userId: listing.sellerId,
              type: "friday_trade_sell",
              amountEur: listing.priceEur, // prípadne odpočítaj fee
              secondsDelta: 0,
              note: `listing:${listing.id}; token:${listing.tokenId}`,
            },
          ],
        });

        // (voliteľne) log purchase item, aby si mal jednotný audit
        await tx.fridayPurchaseItem.createMany({
          data: [
            {
              userId: buyerId,
              tokenId: listing.tokenId,
              unitPriceEur: listing.priceEur,
            },
          ],
        });

        return { tradeId: trade.id, tokenId: listing.tokenId, priceEur: listing.priceEur };
      });

      return res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("POST /buy-listing", e);
      return res.status(400).json({ success: false, message: e.message || "Buy failed" });
    }
  });

  // Zalistovanie tokenu
  router.post("/list", async (req: Request, res: Response) => {
    try {
      const { sellerId, tokenId, priceEur } = (req.body || {}) as {
        sellerId?: string;
        tokenId?: string;
        priceEur?: number | string;
      };
      const price = Number(priceEur);

      if (!sellerId || !tokenId || !Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ success: false, message: "Missing or invalid fields" });
      }

      const token = await prisma.fridayToken.findUnique({ where: { id: tokenId } });
      if (!token || token.ownerId !== sellerId) {
        return res.status(400).json({ success: false, message: "Token not owned by seller" });
      }
      if (token.status !== "active" || token.minutesRemaining <= 0) {
        return res.status(400).json({ success: false, message: "Token not listable" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.fridayToken.update({ where: { id: tokenId }, data: { status: "listed" } });
        await tx.fridayListing.create({ data: { tokenId, sellerId, priceEur: new Prisma.Decimal(price) } });
      });

      return res.json({ success: true });
    } catch (e) {
      console.error("POST /list", e);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // Zrušenie listingu
  router.post("/cancel-listing", async (req: Request, res: Response) => {
    try {
      const { sellerId, listingId } = (req.body || {}) as {
        sellerId?: string;
        listingId?: string;
      };
      const listing = await prisma.fridayListing.findUnique({
        where: { id: listingId },
        include: { token: true },
      });
      if (!listing || listing.sellerId !== sellerId || listing.status !== "open") {
        return res.status(400).json({ success: false, message: "Listing not cancellable" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.fridayListing.update({
          where: { id: listingId },
          data: { status: "cancelled", closedAt: new Date() },
        });
        await tx.fridayToken.update({
          where: { id: listing.tokenId },
          data: { status: "active" },
        });
      });

      return res.json({ success: true });
    } catch (e) {
      console.error("POST /cancel-listing", e);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // Zoznam otvorených ponúk
  router.get("/listings", async (_req: Request, res: Response) => {
    try {
      const items = await prisma.fridayListing.findMany({
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { token: true },
      });
      return res.json({ items });
    } catch (e) {
      console.error("GET /listings", e);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  });

  return router;
}
