// Niveau sonore du PC (vumètre de Windows) envoyé en direct à la fenêtre : la sphère danse sur la musique.
// Rien n'est enregistré. Le petit relevé (lib/meter.ps1) ne tourne que tant qu'une fenêtre visible l'écoute.
import fs from "fs";
import { spawn } from "child_process";
import { createInterface } from "readline";

const SCRIPT = fs.readFileSync(new URL("./meter.ps1", import.meta.url), "utf8");
const clients = new Set();
let child = null, stopTimer = null;

function start() {
  if (child || process.platform !== "win32") return;
  const me = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(`$Parent = ${process.pid}\n${SCRIPT}`, "utf16le").toString("base64")], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  createInterface({ input: me.stdout }).on("line", (l) => {
    if (!/^\d\.\d{3}$/.test(l)) return;
    for (const c of clients) c.write(`data: ${l}\n\n`);
  });
  me.on("error", () => {});
  me.on("exit", () => child === me && (child = null));
  child = me;
}

// GET /api/audio-level : flux d'événements (une valeur de 0 à 1 à chaque changement).
export function meterStream(req, res) {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  clients.add(res);
  clearTimeout(stopTimer);
  start();
  req.on("close", () => {
    clients.delete(res);
    if (clients.size) return;
    // Plus personne : on arrête le relevé (5 s de marge si la fenêtre se recharge).
    stopTimer = setTimeout(() => {
      child?.kill();
      child = null;
    }, 5000);
  });
}
