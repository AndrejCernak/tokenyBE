// apns.js
const apn = require("apn");

const provider = new apn.Provider({
  token: {
    key: process.env.APN_KEY_FILE,   // napr. "AuthKey_XXXXXX.p8"
    keyId: process.env.APN_KEY_ID,   // z Apple Developer Console
    teamId: process.env.APN_TEAM_ID, // tvoj Apple Team ID
  },
  production: false, // true = produkčné APNs, false = sandbox
});

// VoIP push
async function sendVoipPush(deviceToken, payload = {}) {
  const note = new apn.Notification();

  // payload sa dostane do PKPushRegistry -> didReceiveIncomingPush
  note.payload = payload;

  // VoIP topic = bundleId + ".voip"
  note.topic = process.env.APN_BUNDLE_ID + ".voip";
  note.pushType = "voip";
  note.expiry = Math.floor(Date.now() / 1000) + 30; // expirácia 30s

  console.log("📡 [VoIP] Sending push:");
  console.log("   → topic:", note.topic);
  console.log("   → pushType:", note.pushType);
  console.log("   → deviceToken:", deviceToken);
  console.log("   → payload:", JSON.stringify(payload));

  try {
    const result = await provider.send(note, deviceToken);

    console.log("📡 [VoIP] APNs response:");
    console.log(JSON.stringify(result, null, 2));

    if (result.failed && result.failed.length > 0) {
      result.failed.forEach(f =>
        console.error("❌ [VoIP] Failed:", f.device, f.response || f.error)
      );
    }

    return result;
  } catch (err) {
    console.error("❌ [VoIP] Push send error:", err);
    throw err;
  }
}

module.exports = { provider, sendVoipPush };
