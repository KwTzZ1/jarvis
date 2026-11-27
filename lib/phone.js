// Accès depuis le téléphone : un second serveur sur le réseau local (Wi-Fi de la maison),
// protégé par une clé secrète donnée une fois via un QR code. Désactivé par défaut.
import http from "http";
import os from "os";
import crypto from "crypto";
import QRCode from "qrcode";
import { load, save } from "./store.js";

export const PHONE_PORT = Number(process.env.PHONE_PORT || 3001);
let server = null;

export const phoneEnabled = () => process.env.PHONE_ACCESS === "true";

function token() {
  let t = load("phone_token", null);
  if (!t) save("phone_token", (t = crypto.randomBytes(18).toString("hex")));
  return t;
}
export function resetPhoneToken() {
  save("phone_token", crypto.randomBytes(18).toString("hex"));
}

// La clé est-elle bonne ? (comparaison à temps constant)
export function checkToken(given) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(token());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Adresses du PC sur le réseau local (192.168.x.x en premier).
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254.")) out.push(i.address);
  }
  return out.sort((a, b) => b.startsWith("192.168.") - a.startsWith("192.168."));
}

export async function phoneInfo() {
  const ips = lanAddresses();
  const url = ips[0] ? `http://${ips[0]}:${PHONE_PORT}/?k=${token()}` : null;
  return {
    enabled: phoneEnabled(),
    running: !!server,
    url,
    others: ips.slice(1).map((ip) => `http://${ip}:${PHONE_PORT}/?k=${token()}`),
    qr: url ? await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#dff4ff", light: "#00000000" } }) : null,
  };
}

export function updatePhoneServer(app) {
  if (phoneEnabled() && !server) {
    server = http.createServer(app);
    server.on("error", (e) => {
      console.error("Accès téléphone impossible :", e.message);
      server = null;
    });
    server.listen(PHONE_PORT, "0.0.0.0", () => console.log(`  Accès téléphone actif sur le port ${PHONE_PORT}.`));
  } else if (!phoneEnabled() && server) {
    server.close();
    server.closeAllConnections?.();
    server = null;
  }
}
