import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const app = express();
const server = createServer(app);

// WebSocket Server bežiaci na rovnakom porte ako HTTP server
const wss = new WebSocketServer({ server });

const clients: Record<string, any> = {};

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
    } catch (e) {
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
