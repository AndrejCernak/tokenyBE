"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const wss = new ws_1.WebSocketServer({ port: 8080 });
const clients = {};
wss.on("connection", (ws) => {
    ws.on("message", (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === "register") {
                clients[data.userId] = ws;
            }
            if (["offer", "answer", "ice"].includes(data.type)) {
                const target = clients[data.targetId];
                if (target) {
                    target.send(JSON.stringify(data));
                }
            }
        }
        catch (e) {
            console.error("WS error:", e);
        }
    });
    ws.on("close", () => {
        for (const id in clients) {
            if (clients[id] === ws)
                delete clients[id];
        }
    });
});
console.log("✅ WebSocket signaling server beží na porte 8080");
