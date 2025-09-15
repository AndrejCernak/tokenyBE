// apns.js
const apn = require("apn");

// Inicializácia APNs providera
const provider = new apn.Provider({
  token: {
    key: process.env.APN_KEY_FILE, // cesta k .p8 súboru
    keyId: process.env.APN_KEY_ID,
    teamId: process.env.APN_TEAM_ID,
  },
  production: false, // sandbox/test prostredie
});

// Funkcia na posielanie VOIP push notifikácií
async function sendVoipPush(deviceToken, payload = {}) {
  const note = new apn.Notification();

  note.rawPayload = payload; // posielame custom JSON
  note.topic = process.env.APN_BUNDLE_ID + ".voip"; // musí mať .voip suffix
  note.pushType = "voip";

  try {
    const result = await provider.send(note, deviceToken);
    console.log("📩 APNs result:", result);
    return result;
  } catch (err) {
    console.error("❌ APNs send error:", err);
    throw err;
  }
}

module.exports = { provider, sendVoipPush };
