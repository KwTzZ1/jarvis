// Gardien de la fenêtre Jarvis.
// Ouvre la fenêtre d'appli (Chrome ou Edge, profil dédié), y charge l'extension "affichage des sites"
// de Jarvis, puis reste en veille tant que la fenêtre est ouverte : Chrome ne garde l'extension que
// tant que ce lien privé (un "tuyau", pas un port réseau) reste ouvert.
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "extension");
const LOG = path.join(ROOT, "data", "window.log");
const [browser, url, profileDir] = process.argv.slice(2);

const log = (line) => {
  try {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {}
};

if (!browser || !url || !profileDir) {
  log("paramètres manquants");
  process.exit(1);
}

const proc = spawn(
  browser,
  [
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profileDir}`,
    `--app=${url}`,
    "--window-size=1440,900",
    "--no-first-run",
    "--no-default-browser-check",
  ],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: false },
);

// Mini client du protocole DevTools sur le tuyau (messages JSON séparés par \0).
let nextId = 0;
const waiting = new Map();
let buffer = "";
proc.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf("\0")) >= 0) {
    const raw = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    try {
      const msg = JSON.parse(raw);
      if (msg.id && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg);
        waiting.delete(msg.id);
      }
    } catch {}
  }
});
proc.stdio[3].on("error", () => {});
proc.stdio[4].on("error", () => {});

function send(method, params = {}, sessionId) {
  return new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    try {
      proc.stdio[3].write(JSON.stringify(msg) + "\0");
    } catch {
      resolve({ error: { message: "tuyau fermé" } });
    }
    setTimeout(() => waiting.has(id) && (waiting.delete(id), resolve({ error: { message: "délai dépassé" } })), 15000);
  });
}

const started = Date.now();
proc.on("exit", (code) => {
  // Sortie immédiate = une fenêtre Jarvis était déjà ouverte avec ce profil : elle prend le relais.
  log(`navigateur fermé (code ${code}) après ${Math.round((Date.now() - started) / 1000)} s`);
  process.exit(0);
});

(async () => {
  const loaded = await send("Extensions.loadUnpacked", { path: EXT });
  if (loaded.error) {
    log(`extension non chargée : ${loaded.error.message}`);
    return;
  }
  log(`extension chargée (${loaded.result.id})`);
  // La page s'est ouverte avant l'extension : on la recharge pour que l'extension s'y active.
  const { result } = await send("Target.getTargets");
  const page = result?.targetInfos?.find((t) => t.type === "page" && t.url.startsWith(url.replace(/\/$/, "")));
  if (!page) return;
  const att = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  if (att.result?.sessionId) {
    await send("Page.reload", {}, att.result.sessionId);
    await send("Target.detachFromTarget", { sessionId: att.result.sessionId });
  }
})();
