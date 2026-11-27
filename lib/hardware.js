// État détaillé du PC pour les points autour de la sphère : processeur, carte graphique, mémoire, stockage, réseau.
// Deux petits relevés (PowerShell et nvidia-smi) tournent seulement tant que l'interface les affiche :
// 30 s sans demande et ils s'arrêtent tout seuls.
import os from "os";
import fs from "fs";
import { spawn } from "child_process";
import { createInterface } from "readline";

const IDLE_MS = 30_000;
const PS_SCRIPT = fs.readFileSync(new URL("./hardware.ps1", import.meta.url), "utf8");
const NV = ["C:\\Windows\\System32\\nvidia-smi.exe", "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"].find((p) => fs.existsSync(p)) || null;
const NV_FIELDS = "name,utilization.gpu,temperature.gpu,memory.used,memory.total,fan.speed,clocks.gr,power.draw";

let info = null; // fiche du matériel (ne change pas)
let sample = { t: 0 }; // derniers relevés PowerShell
let gpu = { t: 0 }; // derniers relevés NVIDIA
let psChild = null, nvChild = null, idleTimer = null;

function readLines(child, onLine) {
  createInterface({ input: child.stdout }).on("line", (l) => {
    try {
      onLine(l);
    } catch {
      // Ligne illisible : on attend la suivante.
    }
  });
}

function start() {
  if (process.platform !== "win32") return;
  if (!psChild) {
    const head = `$Parent = ${process.pid}; $WithInfo = $${!info}; $NoNv = $${!NV}\n`;
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(head + PS_SCRIPT, "utf16le").toString("base64")], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    readLines(child, (l) => {
      const d = JSON.parse(l);
      if (d.info) info = d.info;
      else sample = { ...sample, cpuTemp: undefined, gpuTemp: undefined, ...d, t: Date.now() };
    });
    child.on("error", () => {});
    child.on("exit", () => psChild === child && (psChild = null));
    psChild = child;
  }
  if (NV && !nvChild) {
    const child = spawn(NV, [`--query-gpu=${NV_FIELDS}`, "--format=csv,noheader,nounits", "--id=0", "-lms", "1500"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    readLines(child, (l) => {
      const v = l.split(",").map((s) => s.trim());
      const n = (i) => (/^-?\d+(\.\d+)?$/.test(v[i] || "") ? +v[i] : null);
      const mib = (i) => (n(i) == null ? null : n(i) * 1048576);
      gpu = { t: Date.now(), name: v[0], usage: n(1), temp: n(2), used: mib(3), total: mib(4), fan: n(5), mhz: n(6), watts: n(7) };
    });
    child.on("error", () => {});
    child.on("exit", () => nvChild === child && (nvChild = null));
    nvChild = child;
  }
}

function stop() {
  psChild?.kill();
  nvChild?.kill();
  psChild = nvChild = null;
}

// Chaque demande garde les relevés en vie ; sans demande pendant 30 s, ils s'arrêtent.
function touch() {
  start();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stop, IDLE_MS);
  idleTimer.unref?.();
}

// En attendant le premier relevé : charge du processeur calculée par Node.
let lastCpu = null;
function cpuFallback() {
  const now = os.cpus().reduce((a, c) => ((a.idle += c.times.idle), (a.total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle), a), { idle: 0, total: 0 });
  const prev = lastCpu;
  lastCpu = now;
  if (!prev || now.total === prev.total) return null;
  return Math.round(100 * (1 - (now.idle - prev.idle) / (now.total - prev.total)));
}

function localIp() {
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vEthernet|VirtualBox|VMware|Loopback|Bluetooth/i.test(name)) continue;
    const a = list?.find((x) => x.family === "IPv4" && !x.internal);
    if (a) return a.address;
  }
  return null;
}

export async function hardware() {
  touch();
  const now = Date.now();
  const s = now - sample.t < 6000 ? sample : {};
  const g = now - gpu.t < 6000 ? gpu : null;
  const total = os.totalmem(), free = os.freemem();
  const baseMhz = info?.cpu?.mhz || os.cpus()[0]?.speed || 0;
  // Place libre relue à chaque fois (rapide).
  const list = info?.drives?.length ? info.drives : [{ id: "C:", label: "" }];
  const drives = (
    await Promise.all(
      list.map(async (d) => {
        try {
          const st = await fs.promises.statfs(d.id + "\\");
          return { id: d.id, label: d.label, total: st.blocks * st.bsize, free: st.bavail * st.bsize };
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);
  const vga = info?.gpus?.find((x) => !/Basic|Remote|Virtual|Parsec|Meta|Mirage/i.test(x.name));
  return {
    live: !!s.t,
    cpu: {
      name: info?.cpu?.name || os.cpus()[0]?.model || "",
      cores: info?.cpu?.cores ?? null,
      threads: info?.cpu?.threads || os.cpus().length,
      baseMhz,
      usage: s.cpu != null ? Math.min(100, Math.round(s.cpu)) : cpuFallback(),
      mhz: s.perf && baseMhz ? Math.round((baseMhz * s.perf) / 100) : null,
      temp: s.cpuTemp ?? null,
    },
    gpu: {
      name: g?.name || vga?.name || "",
      usage: g?.usage ?? (s.gpu != null ? Math.round(s.gpu) : null),
      temp: g?.temp ?? s.gpuTemp ?? null,
      used: g?.used ?? s.vram ?? null,
      total: g?.total ?? vga?.ram ?? null,
      fan: g?.fan ?? null,
      mhz: g?.mhz ?? null,
      watts: g?.watts ?? null,
    },
    ram: { total, used: total - free, modules: info?.mem || [], top: sample.top || [] },
    disk: { drives, physical: info?.disks || [], read: s.rd ?? null, write: s.wr ?? null, busy: s.busy ?? null },
    net: { rx: s.rx ?? null, tx: s.tx ?? null, name: s.nic || "", ip: localIp() },
    sys: { os: info?.os || null, board: info?.board || "", uptime: os.uptime(), procs: sample.procs ?? null, jarvis: process.memoryUsage().rss },
  };
}
