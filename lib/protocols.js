// Protocoles : des routines lancées d'un mot (« Jarvis, mode jeu »), gardées dans data/protocols.json.
// Chaque protocole enchaîne des étapes (ouvrir une appli, lancer de la musique, régler le volume…)
// que la fenêtre de Jarvis exécute dans l'ordre.
import { load, save } from "./store.js";
import { APP_IDS } from "./system.js";

export const STEP_TYPES = ["say", "app", "music", "media", "volume", "theme", "timer", "ambient", "dnd", "party", "web", "lock", "wait"];
const THEMES = ["jarvis", "mark", "emeraude", "glace", "nebuleuse"];
const ICONS = ["zap", "gamepad", "briefcase", "moon", "party", "music", "sun", "heart", "home", "headphones", "sparkles", "timer"];

const DEFAULTS = [
  {
    id: "jeu",
    name: "Mode jeu",
    icon: "gamepad",
    color: "#ff5a46",
    triggers: ["mode jeu", "on joue", "mode gaming"],
    steps: [
      { type: "theme", value: "mark" },
      { type: "app", value: "discord" },
      { type: "app", value: "steam" },
      { type: "volume", value: 60 },
      { type: "say", value: "Mode jeu activé. Discord et Steam sont lancés. Bonne partie !" },
    ],
  },
  {
    id: "travail",
    name: "Mode travail",
    icon: "briefcase",
    color: "#5fc3ff",
    triggers: ["mode travail", "au boulot", "concentration"],
    steps: [
      { type: "theme", value: "jarvis" },
      { type: "dnd", value: "on" },
      { type: "music", value: "lofi focus" },
      { type: "volume", value: 35 },
      { type: "timer", value: 25, label: "Concentration" },
      { type: "say", value: "Mode travail activé. Vingt-cinq minutes de concentration, je ne te dérange pas." },
    ],
  },
  {
    id: "nuit",
    name: "Bonne nuit",
    icon: "moon",
    color: "#9fc3ff",
    triggers: ["bonne nuit", "je vais dormir", "au lit"],
    steps: [
      { type: "media", value: "pause" },
      { type: "say", value: "Bonne nuit. Je veille sur le PC." },
      { type: "volume", value: 20 },
      { type: "dnd", value: "on" },
      { type: "wait", value: 5 },
      { type: "ambient" },
    ],
  },
  {
    id: "fete",
    name: "Protocole fête",
    icon: "party",
    color: "#ea6ad6",
    triggers: ["protocole fête", "c'est la fête", "mode fête"],
    steps: [
      { type: "party", value: 30 },
      { type: "music", value: "party hits" },
      { type: "volume", value: 75 },
      { type: "say", value: "Protocole fête activé. Que la fête commence !" },
    ],
  },
];

const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const num = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};

// Garde seulement des étapes valides (type connu, valeur dans les limites).
function cleanStep(s) {
  if (!s || !STEP_TYPES.includes(s.type)) return null;
  const t = s.type;
  if (t === "app") return APP_IDS.includes(s.value) ? { type: t, value: s.value } : null;
  if (t === "say" || t === "music") return text(s.value, t === "say" ? 220 : 80) ? { type: t, value: text(s.value, t === "say" ? 220 : 80) } : null;
  if (t === "media") return ["play", "pause", "next", "previous"].includes(s.value) ? { type: t, value: s.value } : null;
  if (t === "volume") return { type: t, value: num(s.value, 0, 100, 50) };
  if (t === "theme") return THEMES.includes(s.value) ? { type: t, value: s.value } : null;
  if (t === "timer") return { type: t, value: num(s.value, 1, 600, 25), label: text(s.label, 40) || "Minuteur" };
  if (t === "dnd") return { type: t, value: ["on", "off"].includes(s.value) ? s.value : "on" };
  if (t === "party") return { type: t, value: num(s.value, 3, 120, 20) };
  if (t === "wait") return { type: t, value: num(s.value, 1, 30, 3) };
  if (t === "web") {
    try {
      const u = new URL(String(s.value));
      return ["http:", "https:"].includes(u.protocol) ? { type: t, value: u.href.slice(0, 500) } : null;
    } catch {
      return null;
    }
  }
  return { type: t }; // ambient, lock : sans réglage
}

function cleanProtocol(p, i) {
  const name = text(p?.name, 40);
  if (!name) return null;
  const id = text(p.id, 40).replace(/[^a-z0-9-]/gi, "") || `p${Date.now().toString(36)}${i}`;
  const triggers = (Array.isArray(p.triggers) ? p.triggers : String(p.triggers || "").split(","))
    .map((t) => text(t, 40))
    .filter(Boolean)
    .slice(0, 6);
  return {
    id,
    name,
    icon: ICONS.includes(p.icon) ? p.icon : "zap",
    color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#5fc3ff",
    triggers,
    steps: (Array.isArray(p.steps) ? p.steps : []).map(cleanStep).filter(Boolean).slice(0, 14),
  };
}

export function listProtocols() {
  const saved = load("protocols", null);
  return Array.isArray(saved) ? saved : DEFAULTS;
}

export function saveProtocols(list) {
  if (!Array.isArray(list)) throw new Error("Liste de protocoles invalide.");
  const clean = list.slice(0, 24).map(cleanProtocol).filter(Boolean);
  const seen = new Set();
  for (const p of clean) {
    while (seen.has(p.id)) p.id += "x";
    seen.add(p.id);
  }
  save("protocols", clean);
  return clean;
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Retrouve un protocole par son nom ou une de ses phrases (« mode jeu », « jeu »…).
export function findProtocol(name) {
  const n = norm(name).replace(/^(le |la |l')?(mode |protocole )?/, "");
  if (!n) return null;
  return listProtocols().find((p) => [p.name, ...p.triggers].some((t) => {
    const x = norm(t).replace(/^(le |la |l')?(mode |protocole )?/, "");
    return x === n || x.includes(n) || n.includes(x);
  })) || null;
}
