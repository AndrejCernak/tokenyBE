// apns.js
const apn = require("apn");

const keyContent = process.env.APN_KEY_CONTENT.replace(/\\n/g, "\n");

const provider = new apn.Provider({
  token: {
    key: keyContent,
    keyId: process.env.APN_KEY_ID,
    teamId: process.env.APN_TEAM_ID,
  },
  production: false,
});

async function sendVoipPush(deviceToken, payload = {}) {
  const note = new apn.Notification();

  note.rawPayload = payload; // tu posielaš vlastné JSON
  note.topic = process.env.APN_BUNDLE_ID + ".voip"; // ⚠️ musí byť s .voip suffixom
  note.pushType = "voip";

  try {
    const result = await apnProvider.send(note, deviceToken);
    console.log("📩 APNs result:", result);
    return result;
  } catch (err) {
    console.error("❌ APNs send error:", err);
    throw err;
  }
}

module.exports = { sendVoipPush };
