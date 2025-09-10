"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const client_1 = require("@prisma/client");
const routes_1 = __importDefault(require("./routes"));
// ⬇️ PRIDANÉ:
const stripe_1 = __importDefault(require("stripe"));
const body_parser_1 = __importDefault(require("body-parser"));
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
// ⬇️ PRIDANÉ: Stripe init
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY);
// ⬇️ PRIDANÉ: Webhook (MUSÍ byť pred express.json())
app.post("/stripe/webhook", body_parser_1.default.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    try {
        const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            const meta = session.metadata || {};
            const paymentId = meta.paymentId;
            // Označ succeeded
            await prisma.payment.update({
                where: { id: paymentId },
                data: { status: "succeeded", stripePaymentIntent: String(session.payment_intent ?? "") },
            });
            // Fulfillment podľa typu
            if (meta.type === "treasury") {
                const buyerId = meta.buyerId;
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
                    if (available.length < quantity)
                        throw new Error("Treasury sold out");
                    const tokenIds = available.map(t => t.id);
                    await tx.fridayToken.updateMany({ where: { id: { in: tokenIds } }, data: { ownerId: buyerId } });
                    const settings = await tx.fridaySettings.findUnique({ where: { id: 1 } });
                    const unitPrice = Number(settings?.currentPriceEur || 0);
                    await tx.fridayPurchaseItem.createMany({
                        data: tokenIds.map(tokenId => ({ userId: buyerId, tokenId, unitPriceEur: unitPrice })),
                    });
                });
            }
            if (meta.type === "listing") {
                const buyerId = meta.buyerId;
                const listingId = meta.listingId;
                // tu zrecykluj logiku z /buy-listing (prevod vlastníctva, uzavretie listing-u, trade záznam)
                await prisma.$transaction(async (tx) => {
                    const listing = await tx.fridayListing.findUnique({ where: { id: listingId }, include: { token: true } });
                    if (!listing || listing.status !== "open")
                        throw new Error("Listing not open");
                    const locked = await tx.fridayListing.updateMany({
                        where: { id: listing.id, status: "open" },
                        data: { status: "sold", closedAt: new Date() },
                    });
                    if (locked.count !== 1)
                        throw new Error("Listing already closed");
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
                            platformFeeEur: 0,
                        },
                    });
                });
            }
        }
        if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
            const session = event.data.object;
            const paymentId = session.metadata?.paymentId;
            if (paymentId) {
                await prisma.payment.update({ where: { id: paymentId }, data: { status: "failed" } });
            }
        }
        res.json({ received: true });
    }
    catch (e) {
        console.error("Webhook error:", e.message || e);
        res.status(400).send(`Webhook Error: ${e.message}`);
    }
});
// ⬇️ pôvodné stredy ostávajú
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use("/friday", (0, routes_1.default)(prisma));
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
