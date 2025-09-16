const apn = require("apn");

const provider = new apn.Provider({
  token: {
    key: process.env.APN_KEY_FILE,   // napr. "AuthKey_XXXXXX.p8"
    keyId: process.env.APN_KEY_ID,   // z Apple Developer Console
    teamId: process.env.APN_TEAM_ID, // tvoj Apple Team ID
  },
  production: false, // true ak chceš produkčné APNs
});

// VoIP push
async function sendVoipPush(deviceToken, payload = {}) {
  const note = new apn.Notification();
  note.payload = payload; // payload sa dostane do didReceiveIncomingPush
  note.topic = process.env.APN_BUNDLE_ID + ".voip";
  note.pushType = "voip";
  console.log("📡 Sending VoIP push with topic:", note.topic, "to:", deviceToken);

  note.expiry = Math.floor(Date.now() / 1000) + 30; // expirácia 30s

  try {
    const result = await provider.send(note, deviceToken);
    console.log("📡 APNs response:", JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error("❌ VoIP push error:", err);
    throw err;
  }
}


// Alert push
async function sendAlertPush(deviceToken, title, body, payload = {}) {
  const note = new apn.Notification();
  note.alert = { title, body };
  note.sound = "default";
  note.topic = process.env.APN_BUNDLE_ID;
  note.pushType = "alert";
  note.payload = payload;

  try {
    return await provider.send(note, deviceToken);
  } catch (err) {
    console.error("❌ Alert push error:", err);
    throw err;
  }
}

module.exports = { provider, sendVoipPush, sendAlertPush };
