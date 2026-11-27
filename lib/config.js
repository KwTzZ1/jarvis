// Réglages modifiables depuis l'interface. Enregistrés dans data/config.json,
// ils passent devant le fichier .env (optionnel).
import { load, save } from "./store.js";
import { GROQ_MODELS } from "./groq.js";

export const FIELDS = [
  {
    group: "Intelligence artificielle", key: "AI_PROVIDER", label: "IA utilisée",
    options: [
      ["auto", "Automatique : Claude, sinon l'IA gratuite"],
      ["claude", "Claude uniquement"],
      ["groq", "IA gratuite uniquement (Groq)"],
    ],
    help: "En automatique, l'IA gratuite prend le relais si Claude n'a pas de crédit ou n'est pas configuré.",
  },
  { group: "Intelligence artificielle", key: "ANTHROPIC_API_KEY", label: "Clé API Claude", secret: true, compact: true, help: "Sur platform.claude.com, rubrique API Keys. Elle commence par sk-ant-." },
  {
    group: "Intelligence artificielle", key: "CLAUDE_MODEL", label: "Modèle",
    options: [
      ["claude-haiku-5-5", "Haiku 5.5 : rapide, très économique"],
      ["claude-sonnet-5-5", "Sonnet 5.5 : plus malin"],
      ["claude-opus-5-5", "Opus 5.5 : le plus puissant"],
    ],
  },
  { group: "Intelligence artificielle", key: "CLAUDE_EFFORT", label: "Réflexion", options: [["low", "Rapide"], ["medium", "Normale"], ["high", "Approfondie"]] },
  { group: "Intelligence artificielle", key: "ENABLE_WEB_SEARCH", label: "Recherche web", options: [["true", "Activée"], ["false", "Désactivée"]] },
  { group: "IA gratuite (Groq)", key: "GROQ_API_KEY", label: "Clé Groq", secret: true, compact: true, help: "Gratuite sur console.groq.com, rubrique API Keys. Elle commence par gsk_." },
  { group: "IA gratuite (Groq)", key: "GROQ_MODEL", label: "Modèle gratuit", options: GROQ_MODELS },
  { group: "Personnalisation", key: "ASSISTANT_NAME", label: "Nom de l'assistant", max: 30, help: "C'est aussi le mot de réveil." },
  { group: "Personnalisation", key: "USER_NAME", label: "Ton prénom", max: 40 },
  { group: "Personnalisation", key: "CITY", label: "Ville (météo)", max: 80 },
  { group: "Google", key: "GOOGLE_CLIENT_ID", label: "Client ID", compact: true },
  { group: "Google", key: "GOOGLE_CLIENT_SECRET", label: "Client secret", secret: true, compact: true },
  { group: "Spotify", key: "SPOTIFY_CLIENT_ID", label: "Client ID", compact: true },
  { group: "Spotify", key: "SPOTIFY_CLIENT_SECRET", label: "Client secret", secret: true, compact: true },
];

// Noms lus par l'appli. Les variables Windows portant le même nom sont ignorées (voir boot.js).
export const ALL_KEYS = [...FIELDS.map((f) => f.key), "TIMEZONE", "PORT"];

const DEFAULTS = {
  AI_PROVIDER: "auto",
  GROQ_MODEL: GROQ_MODELS[0][0],
  CLAUDE_MODEL: "claude-haiku-5-5",
  CLAUDE_EFFORT: "low",
  ENABLE_WEB_SEARCH: "true",
  ASSISTANT_NAME: "Jarvis",
  CITY: "Paris",
  TIMEZONE: "Europe/Paris",
};

// Valeurs venues du fichier .env, gardées à part pour pouvoir y revenir.
let fileValues = {};
export function setFileValues(values) {
  fileValues = { ...values };
}

// Applique : valeurs par défaut < .env < réglages de l'interface (data/config.json).
export function applyConfig() {
  const cfg = load("config", {});
  for (const key of ALL_KEYS) {
    const field = FIELDS.find((f) => f.key === key);
    const candidates = [cfg[key], fileValues[key], DEFAULTS[key]];
    const value = candidates.find((v) => typeof v === "string" && v.trim() && (!field?.options || field.options.some(([o]) => o === v)));
    if (value) process.env[key] = value.trim();
    else delete process.env[key];
  }
}

function mask(v) {
  return v ? "•".repeat(8) + v.slice(-4) : "";
}

export function publicSettings() {
  return FIELDS.map((f) => ({
    ...f,
    value: f.secret ? "" : process.env[f.key] || "",
    isSet: Boolean(process.env[f.key]),
    placeholder: f.secret ? (process.env[f.key] ? `Enregistrée (${mask(process.env[f.key])}). Laisse vide pour la garder.` : "Non renseignée") : "",
  }));
}

function clean(field, raw) {
  let v = String(raw ?? "");
  // Les clés et identifiants ne contiennent jamais d'espace : on retire ceux d'un copier-coller.
  v = field.compact ? v.replace(/\s+/g, "") : v.replace(/[\r\n\t]+/g, " ").trim();
  if (field.max) v = v.slice(0, field.max);
  return v;
}

// Met à jour les réglages. Retourne la liste des clés réellement modifiées.
export function updateSettings(values) {
  if (!values || typeof values !== "object") return [];
  const cfg = load("config", {});
  const before = Object.fromEntries(ALL_KEYS.map((k) => [k, process.env[k] || ""]));
  for (const f of FIELDS) {
    if (!(f.key in values)) continue;
    const v = clean(f, values[f.key]);
    if (f.secret && !v) continue; // champ secret vide = on garde l'ancienne valeur
    if (f.options && !f.options.some(([o]) => o === v)) continue;
    if (v) cfg[f.key] = v;
    else delete cfg[f.key]; // champ vidé : retour à la valeur par défaut
  }
  save("config", cfg);
  applyConfig();
  return ALL_KEYS.filter((k) => (process.env[k] || "") !== before[k]);
}
