// Google : connexion OAuth + Agenda (Calendar), Gmail et Tâches (Tasks), via l'API REST.
import crypto from "crypto";
import { load, save, remove } from "./store.js";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/tasks",
];

const pendingStates = new Set();

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleConnected() {
  return Boolean(load("google_tokens", null)?.refresh_token);
}

function redirectUri() {
  return `${process.env.GOOGLE_REDIRECT_BASE || "http://localhost:" + (process.env.PORT || 3000)}/auth/google/callback`;
}

export function googleAuthUrl() {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function googleHandleCallback(code, state) {
  if (!pendingStates.delete(state)) throw new Error("État OAuth invalide, réessaie la connexion.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Échec de connexion Google : ${data.error_description || data.error}. Vérifie le Client ID, le Client secret et l'URI de redirection.`);
  if (!data.refresh_token) throw new Error("Google n'a pas donné d'accès durable. Réessaie de te connecter.");
  save("google_tokens", { ...data, expires_at: Date.now() + data.expires_in * 1000 });
}

export function googleDisconnect() {
  remove("google_tokens");
}

async function accessToken() {
  try {
    return await refreshIfNeeded();
  } catch (err) {
    if (err.name === "TypeError" || err.name === "TimeoutError") throw new Error("Impossible de joindre Google. Vérifie ta connexion internet.");
    throw err;
  }
}

async function refreshIfNeeded() {
  const tokens = load("google_tokens", null);
  if (!tokens?.refresh_token) throw new Error("Google n'est pas connecté.");
  if (tokens.access_token && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 400/401 : autorisation révoquée, expirée ou identifiants changés. On déconnecte proprement.
    if (res.status === 400 || res.status === 401) {
      googleDisconnect();
      throw new Error("La connexion Google a expiré. Clique sur « Connecter » à côté de Google.");
    }
    throw new Error("Google ne répond pas pour le moment. Réessaie dans un instant.");
  }
  save("google_tokens", { ...tokens, ...data, expires_at: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

// Quelle API Google est concernée par une adresse, pour les messages d'erreur.
function apiName(url) {
  if (url.includes("calendar")) return "Google Calendar API";
  if (url.includes("gmail")) return "Gmail API";
  if (url.includes("tasks")) return "Google Tasks API";
  return "API Google";
}

async function gfetch(url, options = {}) {
  const token = await accessToken();
  let res;
  try {
    res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch {
    throw new Error("Impossible de joindre Google. Vérifie ta connexion internet.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reasons = [
      ...(data.error?.errors || []).map((e) => e.reason),
      ...(data.error?.details || []).map((d) => d.reason),
    ];
    if (reasons.includes("accessNotConfigured") || reasons.includes("SERVICE_DISABLED")) {
      throw new Error(`Active « ${apiName(url)} » dans ton projet Google Cloud (voir README), puis réessaie.`);
    }
    if (res.status === 403 && (reasons.includes("insufficientPermissions") || reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT"))) {
      throw new Error("Autorisation Google incomplète : déconnecte puis reconnecte Google en cochant toutes les cases.");
    }
    if (res.status === 401) {
      googleDisconnect();
      throw new Error("La connexion Google a expiré. Clique sur « Connecter » à côté de Google.");
    }
    if (res.status === 404) throw new Error("Élément introuvable côté Google (déjà supprimé ?).");
    throw new Error(data.error?.message || `Erreur Google ${res.status}`);
  }
  return data;
}

// ---------- Agenda ----------
export async function listEvents({ days = 7, max = 15 } = {}) {
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(max),
  });
  const data = await gfetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
  return (data.items || []).map((e) => ({
    id: e.id,
    title: e.summary || "(sans titre)",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: Boolean(e.start?.date),
    location: e.location || null,
  }));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// "2026-11-28T14:00:00" (heure locale) + 1 h, sans passer par le fuseau du PC.
function addOneHour(localDateTime) {
  const m = localDateTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString().slice(0, 19);
}

export async function createEvent({ title, start, end, description, location }) {
  const tz = process.env.TIMEZONE || "Europe/Paris";
  const isDate = DATE_ONLY.test(start);
  if (!isDate && Number.isNaN(new Date(start).getTime())) throw new Error("Date de début invalide.");
  if (end && Number.isNaN(new Date(end).getTime())) throw new Error("Date de fin invalide.");
  let endValue;
  if (isDate) {
    // Pour Google, la date de fin d'un événement "journée entière" est exclusive.
    endValue = { date: end && DATE_ONLY.test(end) && end > start ? nextDay(end) : nextDay(start) };
  } else {
    const fallback = addOneHour(start);
    if (!end && !fallback) throw new Error("Précise l'heure de fin.");
    endValue = { dateTime: end || fallback, timeZone: tz };
  }
  const body = {
    summary: title,
    description,
    location,
    start: isDate ? { date: start } : { dateTime: start, timeZone: tz },
    end: endValue,
  };
  const e = await gfetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: e.id, title: e.summary, start: e.start?.dateTime || e.start?.date, link: e.htmlLink };
}

// ---------- Gmail ----------
function header(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

export async function listEmails({ query = "is:unread in:inbox", max = 8 } = {}) {
  const params = new URLSearchParams({ q: query, maxResults: String(max) });
  const list = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
  const msgs = await Promise.all(
    (list.messages || []).map((m) =>
      gfetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      ),
    ),
  );
  return msgs.map((m) => ({
    id: m.id,
    from: header(m.payload?.headers, "From"),
    subject: header(m.payload?.headers, "Subject") || "(sans objet)",
    date: header(m.payload?.headers, "Date"),
    snippet: decodeEntities(m.snippet || ""),
    unread: (m.labelIds || []).includes("UNREAD"),
  }));
}

function decodeEntities(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function extractText(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  for (const part of payload.parts || []) {
    const t = extractText(part);
    if (t) return t;
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url")
      .toString("utf8")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
  }
  return "";
}

export async function readEmail(id) {
  const m = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
  const h = m.payload?.headers;
  return {
    id: m.id,
    from: header(h, "From"),
    to: header(h, "To"),
    subject: header(h, "Subject"),
    date: header(h, "Date"),
    body: extractText(m.payload).slice(0, 6000),
  };
}

// Une ou plusieurs adresses séparées par des virgules, sans retour à la ligne.
export function validRecipients(to) {
  if (typeof to !== "string" || /[\r\n]/.test(to)) return false;
  const list = to.split(",").map((a) => a.trim()).filter(Boolean);
  return list.length > 0 && list.length <= 20 && list.every((a) => ADDRESS.test(a));
}
const ADDRESS = /^(?:[^<>@\r\n]*<\s*[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+\s*>|[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+)$/;

// "Élodie <e@x.fr>" -> nom encodé pour l'en-tête du mail (les accents passent partout).
function encodeRecipients(to) {
  return to
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => {
      const m = a.match(/^(.*?)\s*<\s*([^>]+?)\s*>$/);
      if (!m) return a;
      const name = m[1].replace(/^"|"$/g, "").trim();
      if (!name) return `<${m[2]}>`;
      const encoded = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "")}"` : `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?=`;
      return `${encoded} <${m[2]}>`;
    })
    .join(", ");
}

export async function sendEmail({ to, subject, body }) {
  if (!validRecipients(to)) throw new Error("Adresse du destinataire invalide.");
  subject = String(subject || "").replace(/[\r\n]+/g, " ").trim() || "(sans objet)";
  body = String(body || "");
  const encSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const raw = [
    `To: ${encodeRecipients(to)}`,
    `Subject: ${encSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64"),
  ].join("\r\n");
  const res = await gfetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
  });
  return { id: res.id };
}

// ---------- Tâches ----------
export async function listTasks({ max = 15 } = {}) {
  const params = new URLSearchParams({ showCompleted: "false", maxResults: String(max) });
  const data = await gfetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?${params}`);
  return (data.items || []).map((t) => ({ id: t.id, title: t.title, due: t.due || null, notes: t.notes || null }));
}

export async function addTask({ title, due, notes }) {
  const body = { title, notes };
  if (due) {
    // Google Tasks ne garde que la date : on l'envoie telle quelle, à minuit UTC.
    const day = String(due).match(/^\d{4}-\d{2}-\d{2}/);
    if (!day) throw new Error("Échéance invalide (format attendu : AAAA-MM-JJ).");
    body.due = `${day[0]}T00:00:00.000Z`;
  }
  const t = await gfetch("https://tasks.googleapis.com/tasks/v1/lists/@default/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: t.id, title: t.title };
}

export async function completeTask(id) {
  const t = await gfetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "completed" }),
  });
  return { id: t.id, title: t.title, status: t.status };
}
