const apn = require("apn");

// Inicializácia providera
const provider = new apn.Provider({
  token: {
    key: process.env.APN_KEY_FILE,
    keyId: process.env.APN_KEY_ID,
    teamId: process.env.APN_TEAM_ID,
  },
  production: false,
});

// 📌 Funkcia na VoIP push
async function sendVoipPush(deviceToken, payload = {}) {
  const note = new apn.Notification();
  note.rawPayload = payload;
  note.topic = process.env.APN_BUNDLE_ID + ".voip"; // musí mať suffix .voip
  note.pushType = "voip";

  try {
    return await provider.send(note, deviceToken);
  } catch (err) {
    console.error("❌ VoIP push error:", err);
    throw err;
  }
}

// 📌 Funkcia na Alert push (klasická notifikácia)
async function sendAlertPush(deviceToken, title, body, payload = {}) {
  const note = new apn.Notification();
  note.alert = { title, body };      // text notifikácie
  note.sound = "default";            // aby zaznel zvuk
  note.topic = process.env.APN_BUNDLE_ID; // bez .voip suffixu
  note.pushType = "alert";           // alert notifikácia
  note.payload = payload;            // custom data pre appku

  try {
    return await provider.send(note, deviceToken);
  } catch (err) {
    console.error("❌ Alert push error:", err);
    throw err;
  }
}

module.exports = { provider, sendVoipPush, sendAlertPush };
