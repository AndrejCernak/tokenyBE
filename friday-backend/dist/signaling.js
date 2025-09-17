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
    const { type, callId, callerId, targetId, sdp, candidate, sdpMid, sdpMLineIndex } = data;

    switch (type) {
      // registrácia klienta
      case "register":
        clients[data.userId] = ws;
        console.log(`✅ Registered user: ${data.userId}`);
        break;

      // klient spustil hovor → pošli adminovi incoming-call
      case "call":
        if (clients[targetId]) {
          clients[targetId].send(
            JSON.stringify({ type: "incoming-call", callerId, callId })
          );
          console.log(`📲 Incoming call from ${callerId} to ${targetId} (callId=${callId})`);
        }
        break;

      // admin prijal hovor → späť klientovi
      case "accept":
        if (clients[targetId]) {
          clients[targetId].send(JSON.stringify({ type: "call-accepted", callId }));
          console.log(`✅ Call accepted (callId=${callId})`);
        }
        break;

      // admin/klient položil → druhému pošli call-ended
      case "hangup":
        if (clients[targetId]) {
          clients[targetId].send(JSON.stringify({ type: "call-ended", callId }));
          console.log(`❌ Call ended (callId=${callId})`);
        }
        break;

      // WebRTC výmena
      case "offer":
      case "answer":
      case "candidate": {
        const target = clients[targetId];
        if (target) {
          target.send(JSON.stringify({ ...data, from: data.userId }));
          console.log(`➡️ Forwarded ${type} from ${data.userId} to ${targetId}`);
        }
        break;
      }

      default:
        console.log("ℹ️ Unknown type:", data);
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
