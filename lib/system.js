// État du PC (processeur, mémoire, disque) et ouverture d'applis connues.
import os from "os";
import fs from "fs";
import { spawn } from "child_process";

let lastCpu = null;
function cpuPercent() {
  const now = os.cpus().reduce(
    (a, c) => {
      const t = c.times;
      a.idle += t.idle;
      a.total += t.user + t.nice + t.sys + t.irq + t.idle;
      return a;
    },
    { idle: 0, total: 0 },
  );
  const prev = lastCpu;
  lastCpu = now;
  if (!prev || now.total === prev.total) return null;
  return Math.round(100 * (1 - (now.idle - prev.idle) / (now.total - prev.total)));
}
cpuPercent();

export async function systemInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  let disk = null;
  try {
    const s = await fs.promises.statfs(process.platform === "win32" ? "C:\\" : "/");
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    // statfs indisponible : pas d'info disque.
  }
  return {
    cpu: cpuPercent(),
    cpuName: os.cpus()[0]?.model?.replace(/\s+/g, " ").trim() || "",
    cores: os.cpus().length,
    ram: { total, used: total - free },
    disk,
    uptime: os.uptime(),
  };
}

// Applis que Jarvis peut ouvrir (liste fermée : rien d'autre ne peut être lancé).
const APPS = {
  discord: { label: "Discord", url: "discord:" },
  steam: { label: "Steam", url: "steam:" },
  spotify: { label: "Spotify", url: "spotify:" },
  epic: { label: "Epic Games", url: "com.epicgames.launcher:" },
  parametres: { label: "Paramètres Windows", url: "ms-settings:" },
  calculatrice: { label: "Calculatrice", exe: "calc.exe" },
  blocnotes: { label: "Bloc-notes", exe: "notepad.exe" },
  explorateur: { label: "Explorateur de fichiers", exe: "explorer.exe" },
  taches: { label: "Gestionnaire des tâches", exe: "taskmgr.exe" },
  capture: { label: "Outil Capture d'écran", url: "ms-screenclip:" },
};
export const APP_IDS = Object.keys(APPS);

export function openApp(id) {
  const app = APPS[id];
  if (!app) throw new Error("Appli inconnue.");
  const child = app.url
    ? spawn("rundll32.exe", ["url.dll,FileProtocolHandler", app.url], { detached: true, stdio: "ignore" })
    : spawn(app.exe, [], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
  return `${app.label} ouvert.`;
}
