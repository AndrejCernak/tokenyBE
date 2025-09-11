"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const ws_1 = require("ws");
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
// WebSocket Server bežiaci na rovnakom porte ako HTTP server
const wss = new ws_1.WebSocketServer({ server });
const clients = {};
wss.on("connection", (ws) => {
    ws.on("message", (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === "register") {
                clients[data.userId] = ws;
                console.log(`✅ Registered user ${data.userId}`);
            }
            if (["offer", "answer", "ice"].includes(data.type)) {
                const target = clients[data.targetId];
                if (target) {
                    target.send(JSON.stringify({ ...data, from: data.userId }));
                }
            }
        }
        catch (e) {
            console.error("WS error:", e);
        }
    });
    ws.on("close", () => {
        for (const id in clients) {
            if (clients[id] === ws) {
                delete clients[id];
                console.log(`❌ Disconnected user ${id}`);
            }
        }
    });
});
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`✅ Signaling server running on port ${PORT}`);
});
