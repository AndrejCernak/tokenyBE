// apns.js
const apn = require("apn");

const apnProvider = new apn.Provider({
  token: {
    key: Buffer.from(process.env.APNS_AUTH_KEY, "utf-8"), // alebo použi fs.readFileSync
    keyId: process.env.APNS_KEY_ID,
    teamId: process.env.APNS_TEAM_ID,
  },
  production: false, // ⚠️ true až keď budeš na TestFlight/App Store
});

async function sendVoipPush(deviceToken, callerId) {
  const notification = new apn.Notification();

  notification.topic = process.env.APNS_BUNDLE_ID + ".voip"; // VoIP má vždy .voip suffix
  notification.pushType = "voip";
  notification.expiry = Math.floor(Date.now() / 1000) + 60; // platnosť 1 minúta
  notification.payload = { callerId }; // pošleme ID volajúceho

  try {
    const result = await apnProvider.send(notification, deviceToken);
    console.log("📩 APNs push result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("❌ APNs push error:", err);
  }
}

module.exports = { sendVoipPush };
