// "Cerveau" gratuit : modèles open source hébergés par Groq (offre gratuite, sans facturation).
// Limites de l'offre gratuite (console.groq.com/docs/rate-limits) : environ 30 requêtes/minute,
// 1 000 requêtes/jour et 8 000 jetons/minute. On garde donc les requêtes compactes.

const API = "https://api.groq.com/openai/v1";
export const GROQ_MODELS = [
  ["openai/gpt-oss-120b", "GPT-OSS 120B : le plus malin (recommandé)"],
  ["openai/gpt-oss-20b", "GPT-OSS 20B : plus rapide, plus simple"],
];
export const getGroqModel = () => process.env.GROQ_MODEL || GROQ_MODELS[0][0];
// Modèle gratuit qui comprend les images (et sait utiliser les outils), utilisé seulement quand il y a une image.
export const GROQ_VISION_MODEL = "qwen/qwen3.8-27b";
export const groqConfigured = () => Boolean(process.env.GROQ_API_KEY);

// Dernier état connu : ok = true / false / null (pas encore vérifié).
export const groqHealth = { ok: null, message: "" };
const setHealth = (ok, message = "") => Object.assign(groqHealth, { ok, message });
export const resetGroq = () => setHealth(null);

// Erreur déjà formulée pour l'utilisateur.
export class GroqError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, body, attempt = 0) {
  let res;
  try {
    res = await fetch(API + path, {
      method: body ? "POST" : "GET",
      signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GroqError("Impossible de joindre l'IA gratuite (Groq). Vérifie ta connexion internet.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;

  const code = data?.error?.code;
  if (res.status === 401) {
    setHealth(false, "Clé Groq refusée : vérifie-la dans les réglages (elle commence par gsk_).");
    throw new GroqError(groqHealth.message);
  }
  if (res.status === 429) {
    // Limite gratuite : si l'attente est courte, on patiente puis on réessaie une fois.
    const wait = Number(res.headers.get("retry-after"));
    if (attempt === 0 && Number.isFinite(wait) && wait <= 20) {
      await sleep((wait + 0.5) * 1000);
      return request(path, body, 1);
    }
    const when = Number.isFinite(wait) && wait < 3600 ? `dans ${Math.ceil(wait / 60)} min` : "demain";
    throw new GroqError(`Limite gratuite de Groq atteinte. Réessaie ${when}.`);
  }
  // Le modèle a produit un appel d'outil mal formé : on retente une fois avant d'abandonner.
  if (res.status === 400 && code === "tool_use_failed") {
    if (attempt === 0) return request(path, body, 1);
    throw new GroqError("L'IA gratuite s'est embrouillée sur cette demande. Reformule plus simplement.");
  }
  if (res.status === 404 || code === "model_not_found" || code === "model_decommissioned") {
    throw new GroqError("Ce modèle gratuit n'est plus disponible : choisis-en un autre dans les réglages.");
  }
  if (res.status === 413 || code === "context_length_exceeded") {
    throw new GroqError("Conversation trop longue pour l'IA gratuite : recharge la page (F5) pour repartir de zéro.");
  }
  if (res.status >= 500) throw new GroqError("Le service gratuit (Groq) est surchargé. Réessaie dans un instant.");
  throw new GroqError(`L'IA gratuite a refusé la demande (erreur ${res.status}). ${data?.error?.message || ""}`.trim());
}

// Vérifie la clé et que le modèle choisi existe (appel gratuit, aucun jeton consommé).
export async function checkGroq() {
  if (!groqConfigured()) return { ok: false, message: "Aucune clé Groq enregistrée." };
  try {
    const list = await request("/models");
    const ids = (list.data || []).map((m) => m.id);
    if (ids.length && !ids.includes(getGroqModel())) {
      setHealth(false, "Ce modèle gratuit n'est plus proposé par Groq : choisis-en un autre dans les réglages.");
    } else {
      setHealth(true);
    }
  } catch (err) {
    // Coupure réseau ou surcharge : on ne conclut rien sur la clé.
    if (groqHealth.ok !== false) return { ok: false, message: err.message };
  }
  return { ok: groqHealth.ok === true, message: groqHealth.ok ? "Clé Groq valide." : groqHealth.message };
}

// JSON Schema des outils, sans les champs que l'API n'attend pas.
function cleanSchema(schema) {
  const { $schema, ...rest } = schema || {};
  return rest;
}

const MAX_RESULT = 4000; // on tronque les gros résultats d'outils pour rester sous la limite de jetons/minute

/**
 * Conversation avec outils, au format "chat completions" de Groq.
 * @param {string} system   consigne système
 * @param {{role: string, content: string}[]} history  derniers échanges (le dernier vient de l'utilisateur)
 * @param {object[]} tools  outils construits par agent.js (nom, description, input_schema, parse, run)
 * @param {(usage: object) => void} onUsage
 */
export async function groqChat(system, history, tools, onUsage) {
  if (!groqConfigured()) throw new GroqError("Aucune clé Groq : ajoute-la dans les réglages.");
  const defs = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: cleanSchema(t.input_schema) },
  }));
  // Images jointes : format "image_url", et modèle capable de les voir pour cette demande.
  const hasImages = history.some((m) => m.images?.length);
  const model = hasImages ? GROQ_VISION_MODEL : getGroqModel();
  const toGroq = (m) =>
    m.images?.length
      ? { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image_url", image_url: { url: i.dataUrl } }))] }
      : { role: m.role, content: m.content };
  const messages = [{ role: "system", content: system }, ...history.slice(-10).map(toGroq)];

  for (let step = 0; step < 6; step++) {
    const data = await request("/chat/completions", {
      model,
      messages,
      tools: defs,
      tool_choice: "auto",
      temperature: 0.3,
      max_completion_tokens: 1500,
    });
    setHealth(true);
    onUsage?.(data.usage);
    const msg = data.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    if (!calls.length) return (msg.content || "").trim() || "C'est fait.";

    // On ne renvoie que les champs standard (pas le raisonnement interne du modèle).
    messages.push({
      role: "assistant",
      content: msg.content || "",
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.function?.name, arguments: c.function?.arguments || "{}" } })),
    });
    for (const call of calls) {
      messages.push({ role: "tool", tool_call_id: call.id, content: (await runTool(tools, call)).slice(0, MAX_RESULT) });
    }
  }
  return "C'était trop long à traiter d'un coup. Peux-tu découper ta demande ?";
}

async function runTool(tools, call) {
  const tool = tools.find((t) => t.name === call.function?.name);
  if (!tool) return `Erreur : l'outil « ${call.function?.name} » n'existe pas.`;
  let args;
  try {
    args = tool.parse(JSON.parse(call.function.arguments || "{}"));
  } catch (err) {
    return `Erreur : paramètres invalides pour ${tool.name} (${err.message.slice(0, 300)}). Corrige-les et réessaie.`;
  }
  try {
    const out = await tool.run(args);
    return typeof out === "string" ? out : JSON.stringify(out);
  } catch (err) {
    return `Erreur : ${err.message}`;
  }
}
