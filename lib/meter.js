// Son du PC (lib/meter.ps1) : niveau en direct pour faire danser la sphère, et volume général de Windows.
// Rien n'est enregistré. Le petit relevé ne tourne que tant qu'une fenêtre visible l'écoute,
// ou une minute après un réglage du volume.
import fs from "fs";
import { spawn } from "child_process";
import { createInterface } from "readline";

const SCRIPT = fs.readFileSync(new URL("./meter.ps1", import.meta.url), "utf8");
const clients = new Set();
let child = null, stopTimer = null, keepUntil = 0;
let volume = null; // { level: 0..100, muted }
const waiters = new Set();

function broadcast(msg) {
  for (const c of clients) c.write(msg);
}

function start() {
  if (child || process.platform !== "win32") return;
  const me = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(`$Parent = ${process.pid}\n${SCRIPT}`, "utf16le").toString("base64")], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  createInterface({ input: me.stdout }).on("line", (l) => {
    if (/^\d\.\d{3}$/.test(l)) return broadcast(`data: ${l}\n\n`);
    const v = /^vol (\d\.\d{3}) ([01])$/.exec(l);
    if (!v) return;
    volume = { level: Math.round(+v[1] * 100), muted: v[2] === "1" };
    broadcast(`event: volume\ndata: ${JSON.stringify(volume)}\n\n`);
    for (const w of waiters) w(volume);
    waiters.clear();
  });
  me.stdin.on("error", () => {});
  me.on("error", () => {});
  me.on("exit", () => {
    if (child !== me) return;
    child = null;
    volume = null;
  });
  child = me;
}

// Arrêt quand plus personne n'écoute et qu'on n'a pas touché au volume depuis une minute.
function scheduleStop() {
  clearTimeout(stopTimer);
  if (clients.size) return;
  const wait = Math.max(5000, keepUntil - Date.now());
  stopTimer = setTimeout(() => {
    if (clients.size || Date.now() < keepUntil) return scheduleStop();
    child?.kill();
    child = null;
    volume = null;
  }, wait);
}

// GET /api/audio-level : flux d'événements (niveau 0 à 1 à chaque changement, et « volume » quand il change).
export function meterStream(req, res) {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  clients.add(res);
  clearTimeout(stopTimer);
  start();
  if (volume) res.write(`event: volume\ndata: ${JSON.stringify(volume)}\n\n`);
  req.on("close", () => {
    clients.delete(res);
    scheduleStop();
  });
}

function command(line) {
  if (process.platform !== "win32") return Promise.reject(new Error("Réglage du volume disponible seulement sur Windows."));
  keepUntil = Date.now() + 60_000;
  start();
  scheduleStop();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      waiters.delete(done);
      volume ? resolve(volume) : reject(new Error("Le volume de Windows ne répond pas."));
    }, 5000);
    const done = (v) => (clearTimeout(t), resolve(v));
    waiters.add(done);
    child.stdin.write(line + "\n");
  });
}

export const getVolume = () => command("get");

// level : 0 à 100 ; muted : vrai/faux. Renvoie le volume réel après le réglage.
export async function setVolume({ level, muted } = {}) {
  let v = volume;
  if (Number.isFinite(level)) v = await command(`set ${(Math.max(0, Math.min(100, level)) / 100).toFixed(3)}`);
  if (typeof muted === "boolean") v = await command(`mute ${muted ? 1 : 0}`);
  return v || getVolume();
}
