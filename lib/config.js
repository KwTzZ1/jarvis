// Réglages modifiables depuis l'interface. Enregistrés dans data/config.json,
// ils passent devant le fichier .env.
import { load, save } from "./store.js";

export const FIELDS = [
  { group: "Intelligence artificielle", key: "ANTHROPIC_API_KEY", label: "Clé API Claude", secret: true, help: "Sur platform.claude.com, rubrique API Keys." },
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
  { group: "Personnalisation", key: "ASSISTANT_NAME", label: "Nom de l'assistant", help: "C'est aussi le mot de réveil." },
  { group: "Personnalisation", key: "USER_NAME", label: "Ton prénom" },
  { group: "Personnalisation", key: "CITY", label: "Ville (météo)" },
  { group: "Google", key: "GOOGLE_CLIENT_ID", label: "Client ID" },
  { group: "Google", key: "GOOGLE_CLIENT_SECRET", label: "Client secret", secret: true },
  { group: "Spotify", key: "SPOTIFY_CLIENT_ID", label: "Client ID" },
  { group: "Spotify", key: "SPOTIFY_CLIENT_SECRET", label: "Client secret", secret: true },
];

const DEFAULTS = {
  CLAUDE_MODEL: "claude-haiku-5-5",
  CLAUDE_EFFORT: "low",
  ENABLE_WEB_SEARCH: "true",
  ASSISTANT_NAME: "Jarvis",
  CITY: "Paris",
};

const listeners = [];
export function onConfigChange(fn) {
  listeners.push(fn);
}

// Applique config.json (puis les valeurs par défaut) sur process.env.
export function applyConfig() {
  const cfg = load("config", {});
  for (const f of FIELDS) {
    if (cfg[f.key]) process.env[f.key] = cfg[f.key];
    else if (!process.env[f.key] && DEFAULTS[f.key]) process.env[f.key] = DEFAULTS[f.key];
  }
}

function mask(v) {
  return v ? "•".repeat(8) + v.slice(-4) : "";
}

export function publicSettings() {
  return FIELDS.map((f) => ({
    ...f,
    value: f.secret ? "" : process.env[f.key] || "",
    placeholder: f.secret ? (process.env[f.key] ? `Enregistrée (${mask(process.env[f.key])})` : "Non renseignée") : "",
  }));
}

export function updateSettings(values) {
  const cfg = load("config", {});
  for (const f of FIELDS) {
    if (!(f.key in values)) continue;
    let v = String(values[f.key] ?? "").trim();
    if (f.secret && !v) continue; // champ secret vide = on garde l'ancienne valeur
    if (f.options && !f.options.some(([o]) => o === v)) continue;
    if (!f.secret && !v) {
      delete cfg[f.key];
      delete process.env[f.key];
      continue;
    }
    cfg[f.key] = v;
    process.env[f.key] = v;
  }
  save("config", cfg);
  applyConfig();
  listeners.forEach((fn) => fn());
}
