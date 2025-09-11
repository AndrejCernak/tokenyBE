import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const app = express();
const server = createServer(app);

// Testovacia HTTP route → overíš cez https://tokenybe-1.onrender.com
app.get("/", (_, res) => {
  res.send("✅ Signaling server is running");
});

// WebSocket server na /ws
const wss = new WebSocketServer({ noServer: true });

// Uloženie pripojených klientov
const clients = {};

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  console.log("🔌 New WebSocket connection");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === "register") {
        clients[data.userId] = ws;
        console.log(`✅ Registered user: ${data.userId}`);
      }

      if (["offer", "answer", "ice"].includes(data.type)) {
        const target = clients[data.targetId];
        if (target) {
          target.send(JSON.stringify({ ...data, from: data.userId }));
          console.log(`➡️ Forwarded ${data.type} from ${data.userId} to ${data.targetId}`);
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
