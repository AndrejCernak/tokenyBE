const express = require("express");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const server = createServer(app);

// Test route
app.get("/", (_, res) => {
  res.send("✅ Signaling server running");
});

// WebSocket server na /ws
const wss = new WebSocketServer({ noServer: true });
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
