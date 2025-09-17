"use strict";
const express = require("express");
const { Prisma } = require("@prisma/client");
const { MAX_PRIMARY_TOKENS_PER_USER } = require("./config");
const { jwtVerify, createRemoteJWKSet } = require("jose");
const { verifyToken, createClerkClient } = require("@clerk/backend");
const Stripe = require("stripe");
const { sendVoipPush, sendAlertPush } = require("./apns");


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }); // ✅ toto si pridal


// 🔑 JWKS setup – len raz
const ISSUER = process.env.CLERK_ISSUER;
const JWKS = ISSUER
  ? createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`))
  : null;

// helper na získanie userId z Authorization: Bearer ...
async function getUserIdFromAuthHeader(req) {
  try {
    const auth = req.header("authorization") || req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) return null;

    const token = auth.slice("Bearer ".length);
    if (!JWKS || !ISSUER) return null;

    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
    return payload.sub || null;
  } catch (e) {
    console.error("JWT verify error:", e);
    return null;
  }
}

// 📌 Exportujeme funkciu fridayRoutes
module.exports = fridayRoutes;

function fridayRoutes(prisma) {
  const router = express.Router();

  async function ensureSettings() {
    const existing = await prisma.fridaySettings.findUnique({ where: { id: 1 } });
    if (!existing) {
      await prisma.fridaySettings.create({
        data: { id: 1, currentPriceEur: new Prisma.Decimal(0) },
      });
    }
    return prisma.fridaySettings.findUnique({ where: { id: 1 } });
  }

  async function ensureUser(userId) {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });
  }

  // NÁHRADA za pôvodnú verziu s { payload }
async function getUserIdFromBearer(req) {
  const auth = req.header("authorization") || req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice("Bearer ".length);

  try {
    // verifyToken vracia priamo claims (nie { payload })
    const claims = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      // nič ďalšie sem nedávaj, nech to je čo najtolerantnejšie
    });

    return claims.sub || null;
  } catch (e) {
    console.error("Clerk verifyToken error:", e);
    return null;
  }
}

router.post("/register-device", async (req, res) => {
  try {
    const { userId, voipToken } = req.body;
    if (!userId || !voipToken) {
      return res.status(400).json({ error: "Missing userId or voipToken" });
    }

    let device = await prisma.device.findFirst({ where: { voipToken } });

    if (device) {
      device = await prisma.device.update({
        where: { id: device.id },
        data: { userId, voipToken, updatedAt: new Date() },
      });
    } else {
      device = await prisma.device.upsert({
      where: { userId }, // unikátne pole
      update: { voipToken, updatedAt: new Date() },
      create: { userId, voipToken },
    });

    }

    console.log("✅ Device saved:", device);
    res.json({ ok: true, device });
  } catch (err) {
    console.error("register-device error:", err);
    res.status(500).json({ error: "register-device failed" });
  }
});




  // ========== ADMIN ==========
  router.post("/admin/mint", async (req, res) => {
    try {
      const { quantity, priceEur, year } = req.body;
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

router.post("/debug-log", async (req, res) => {
  try {
    const { msg, time, userId } = req.body;
    console.log("📜 iOS DEBUG:", time, userId || "-", msg);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ debug-log error:", err);
    res.status(500).json({ ok: false });
  }
});

  
  // Nastavenie ceny
    router.post("/admin/set-price", async (req, res) => {
        try {
            const { newPrice, repriceTreasury } = req.body;
            const price = Number(newPrice);
            if (!Number.isFinite(price) || price <= 0) {
                return res.status(400).json({ success: false, message: "Invalid newPrice" });
            }
            await prisma.$transaction(async (tx) => {
                await tx.fridaySettings.upsert({
                    where: { id: 1 },
                    update: { currentPriceEur: price },
                    create: { id: 1, currentPriceEur: price },
                });
                if (repriceTreasury) {
                    await tx.fridayToken.updateMany({
                        where: { ownerId: null, status: "active" },
                        data: { originalPriceEur: price },
                    });
                }
            });
            return res.json({ success: true, priceEur: price });
        }
        catch (e) {
            console.error("POST /friday/admin/set-price", e);
            return res.status(500).json({ success: false, message: "Server error" });
        }
    });
  
  router.post("/sync-user", async (req, res) => {
  const userId = await getUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "Unauthenticated" });

  try {
    await ensureUser(userId);

    // (voliteľné) nastav rolu v Clerk, ak chýba
    try {
      const u = await clerk.users.getUser(userId);
      if (!u.publicMetadata?.role) {
        await clerk.users.updateUser(userId, {
          publicMetadata: { ...(u.publicMetadata || {}), role: "client" },
        });
        console.log(`🔑 Clerk: nastavil som rolu "client" pre user ${userId}`);
      }
    } catch (e) {
      console.error("clerk update role failed:", e);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("sync-user error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

  // VoIP push – zavolanie užívateľa
router.post("/call-user", async (req, res) => {
  const { callerId, calleeId } = req.body;

  if (!callerId || !calleeId) {
    return res.status(400).json({ success: false, message: "Missing callerId or calleeId" });
  }

  try {
    const device = await prisma.device.findFirst({ where: { userId: calleeId } });
    if (!device?.voipToken) {
      return res.status(404).json({ success: false, message: "Callee has no VoIP token" });
    }

    const payload = { callerId, type: "incoming_call" };

    console.log("📡 Sending VoIP push to:", calleeId);
    const voipResult = await sendVoipPush(device.voipToken, payload);
    console.log("📡 VoIP result:", JSON.stringify(voipResult, null, 2));

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ call-user error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});



  // ========== PUBLIC ==========
  router.get("/supply", async (req, res) => {
    try {
      const y = Number(req.query.year || new Date().getFullYear());
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

  router.get("/sso", async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== "string") {
    return res.status(400).send("❌ Missing token");
  }

  try {
    const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    const userId = claims.sub;
    if (!userId) return res.status(401).send("❌ Invalid token");

    const { token: signInToken } = await clerk.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: 60,
    });

    const url = `${process.env.APP_URL}/sso/callback?token=${encodeURIComponent(signInToken)}`;
    return res.redirect(url);
  } catch (err) {
    console.error("SSO error:", err);
    return res.status(401).send("❌ Invalid or expired token");
  }
});




    router.post("/payments/checkout/treasury", async (req, res) => {
        try {
            const { userId, quantity, year } = (req.body || {});
            if (!userId || !Number.isInteger(quantity) || quantity <= 0) {
                return res.status(400).json({ message: "Missing or invalid userId/quantity" });
            }
            await ensureUser(userId);
            const settings = await ensureSettings();
            const unitPrice = Number(settings?.currentPriceEur || 0);
            if (unitPrice <= 0)
                return res.status(400).json({ message: "Treasury price not set" });
            const y = Number(year) || new Date().getFullYear();
            // limit 20 ks / user / rok – rovnaká validácia ako v /purchase
            const ownedThisYear = await prisma.fridayToken.count({
                where: { ownerId: userId, issuedYear: y, status: { in: ["active", "listed"] } },
            });
            if (ownedThisYear + quantity > config_1.MAX_PRIMARY_TOKENS_PER_USER) {
                return res.status(400).json({ message: `Primary limit is ${config_1.MAX_PRIMARY_TOKENS_PER_USER} tokens per user for year ${y}` });
            }
            // dostupnosť v pokladnici – rovnaké kritérium ako v /purchase
            const available = await prisma.fridayToken.count({ where: { ownerId: null, issuedYear: y, status: "active" } });
            if (available < quantity)
                return res.status(400).json({ message: "Not enough tokens in treasury" });
            // Založ Payment
            const amount = unitPrice * quantity;
            const payment = await prisma.payment.create({
                data: { buyerId: userId, type: "treasury", quantity, year: y, amountEur: amount, status: "pending" },
            });
            // Stripe Checkout
            const session = await stripe.checkout.sessions.create({
                mode: "payment",
                currency: "eur",
                line_items: [{
                        price_data: {
                            currency: "eur",
                            unit_amount: Math.round(unitPrice * 100),
                            product_data: { name: `Piatkový token (${y})` },
                        },
                        quantity,
                    }],
                success_url: `${process.env.APP_URL}/?payment=success`,
                cancel_url: `${process.env.APP_URL}/?payment=cancel`,
                metadata: {
                    type: "treasury",
                    buyerId: userId,
                    quantity: String(quantity),
                    year: String(y),
                    paymentId: payment.id,
                },
            });
            await prisma.payment.update({ where: { id: payment.id }, data: { stripeSessionId: session.id } });
            return res.json({ url: session.url });
        }
        catch (e) {
            console.error("POST /payments/checkout/treasury", e);
            return res.status(500).json({ message: "Server error" });
        }
    });
    // HOVORY ENDPOINTY
    // === HOVORY ===
    // Štart hovoru
    router.post("/calls/start", async (req, res) => {
        const { callerId, advisorId } = req.body;
        const today = new Date();
        const isFriday = today.getDay() === 5; // 5 = piatok
        let usedToken = null;
        if (isFriday) {
            // klient musí mať token
            const token = await prisma.fridayToken.findFirst({
                where: { ownerId: callerId, status: "active", minutesRemaining: { gt: 0 } },
            });
            if (!token) {
                return res.status(403).json({ success: false, message: "V piatok potrebuješ token." });
            }
            usedToken = token.id;
            // token spotrebujeme
            await prisma.fridayToken.update({
                where: { id: token.id },
                data: { status: "spent" },
            });
        }
        const call = await prisma.callLog.create({
            data: {
                callerId,
                advisorId,
                startedAt: new Date(),
                usedToken,
            },
        });
        return res.json({ success: true, callId: call.id });
    });
    // Ukončenie hovoru
    router.post("/calls/end", async (req, res) => {
        const { callId } = req.body;
        const call = await prisma.callLog.findUnique({ where: { id: callId } });
        if (!call)
            return res.status(404).json({ success: false, message: "Call not found" });
        const endedAt = new Date();
        const duration = Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000);
        const updated = await prisma.callLog.update({
            where: { id: callId },
            data: { endedAt, duration },
        });
        return res.json({ success: true, call: updated });
    });
    // História hovorov pre usera
    router.get("/calls/:userId", async (req, res) => {
        const { userId } = req.params;
        const calls = await prisma.callLog.findMany({
            where: { OR: [{ callerId: userId }, { advisorId: userId }] },
            orderBy: { startedAt: "desc" },
        });
        return res.json({ success: true, calls });
    });
    // === Stripe Checkout: burza (listing) ===
    router.post("/payments/checkout/listing", async (req, res) => {
        try {
            const { buyerId, listingId } = (req.body || {});
            if (!buyerId || !listingId)
                return res.status(400).json({ message: "Missing buyerId/listingId" });
            await ensureUser(buyerId);
            const listing = await prisma.fridayListing.findUnique({ where: { id: listingId } });
            if (!listing || listing.status !== "open")
                return res.status(400).json({ message: "Listing not available" });
            if (listing.sellerId === buyerId)
                return res.status(400).json({ message: "Cannot buy own listing" });
            const unit = Number(listing.priceEur);
            const payment = await prisma.payment.create({
                data: { buyerId, listingId, type: "listing", amountEur: unit, status: "pending" },
            });
            // Jednoduchá verzia (bez Stripe Connect) – peniaze idú na tvoj účet
            const session = await stripe.checkout.sessions.create({
                mode: "payment",
                currency: "eur",
                line_items: [{
                        price_data: {
                            currency: "eur",
                            unit_amount: Math.round(unit * 100),
                            product_data: { name: `Token z burzy` },
                        },
                        quantity: 1,
                    }],
                success_url: `${process.env.APP_URL}/?payment=success`,
                cancel_url: `${process.env.APP_URL}/?payment=cancel`,
                metadata: {
                    type: "listing",
                    buyerId,
                    listingId,
                    paymentId: payment.id,
                },
            });
            await prisma.payment.update({ where: { id: payment.id }, data: { stripeSessionId: session.id } });
            return res.json({ url: session.url });
        }
        catch (e) {
            console.error("POST /payments/checkout/listing", e);
            return res.status(500).json({ message: "Server error" });
        }
    });
    // Zostatok používateľa
    router.get("/balance/:userId", async (req, res) => {
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
        }
        catch (e) {
            console.error("GET /balance/:userId", e);
            return res.status(500).json({ success: false, message: "Server error" });
        }
    });
    // Primárny nákup z pokladnice
    router.post("/purchase", async (req, res) => {
        try {
            const { userId, quantity, year } = (req.body || {});
            if (!userId || !Number.isInteger(quantity) || quantity <= 0) {
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
            if (ownedThisYear + quantity > config_1.MAX_PRIMARY_TOKENS_PER_USER) {
                return res.status(400).json({
                    success: false,
                    message: `Primary limit is ${config_1.MAX_PRIMARY_TOKENS_PER_USER} tokens per user for year ${y}`,
                });
            }
            // vezmi dostupné tokeny z pokladnice
            const available = await prisma.fridayToken.findMany({
                where: { ownerId: null, issuedYear: y, status: "active" },
                take: quantity,
                select: { id: true },
                orderBy: { createdAt: "asc" },
            });
            if (available.length < quantity) {
                return res.status(400).json({ success: false, message: "Not enough tokens in treasury" });
            }
            const amountEur = new client_1.Prisma.Decimal(unitPrice).mul(quantity);
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
                        unitPriceEur: new client_1.Prisma.Decimal(unitPrice),
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
        }
        catch (e) {
            console.error("POST /purchase", e);
            return res.status(500).json({ success: false, message: "Server error" });
        }
    });
    // Kúpa z burzy (sekundárny obchod)
    router.post("/buy-listing", async (req, res) => {
        const { buyerId, listingId } = (req.body || {});
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
                if (!listing || listing.status !== "open")
                    throw new Error("Listing nie je dostupný");
                if (listing.sellerId === buyerId)
                    throw new Error("Nemôžeš kúpiť vlastný listing");
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
                if (locked.count !== 1)
                    throw new Error("Listing už bol uzavretý");
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
                const platformFeeEur = new client_1.Prisma.Decimal(0);
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
        }
        catch (e) {
            console.error("POST /buy-listing", e);
            return res.status(400).json({ success: false, message: e.message || "Buy failed" });
        }
    });
    // Zalistovanie tokenu
    router.post("/list", async (req, res) => {
        try {
            const { sellerId, tokenId, priceEur } = (req.body || {});
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
                await tx.fridayListing.create({ data: { tokenId, sellerId, priceEur: new client_1.Prisma.Decimal(price) } });
            });
            return res.json({ success: true });
        }
        catch (e) {
            console.error("POST /list", e);
            return res.status(500).json({ success: false, message: "Server error" });
        }
    });
    // Zrušenie listingu
    router.post("/cancel-listing", async (req, res) => {
        try {
            const { sellerId, listingId } = (req.body || {});
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
        }
        catch (e) {
            console.error("POST /cancel-listing", e);
            return res.status(500).json({ success: false, message: "Server error" });
        }
    });
    // Zoznam otvorených ponúk
    router.get("/listings", async (_req, res) => {
        try {
            const items = await prisma.fridayListing.findMany({
                where: { status: "open" },
                orderBy: { createdAt: "desc" },
                take: 50,
                include: { token: true },
            });
            return res.json({ items });
        }
        catch (e) {
            console.error("GET /listings", e);
            return res.status(500).json({ success: false, message: "Server error" });
        }
    });
    return router;
}
