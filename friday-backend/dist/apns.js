const apn = require("apn");

const provider = new apn.Provider({
  token: {
    key: process.env.APN_KEY_FILE,
    keyId: process.env.APN_KEY_ID,
    teamId: process.env.APN_TEAM_ID,
  },
  production: false,
});

async function sendVoipPush(deviceToken, payload = {}) {
  const note = new apn.Notification();
  note.payload = payload; // musí obsahovať callId + callerId
  note.topic = process.env.APN_BUNDLE_ID + ".voip";
  note.pushType = "voip";
  note.expiry = Math.floor(Date.now() / 1000) + 30;

  console.log("📡 [VoIP] topic:", note.topic);
  console.log("📡 [VoIP] token:", deviceToken);
  console.log("📡 [VoIP] payload:", JSON.stringify(payload));

  return provider.send(note, deviceToken);
}

module.exports = { sendVoipPush };
