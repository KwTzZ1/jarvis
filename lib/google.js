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
  if (!res.ok) throw new Error(data.error_description || data.error || "Échec de connexion Google");
  save("google_tokens", { ...data, expires_at: Date.now() + data.expires_in * 1000 });
}

export function googleDisconnect() {
  remove("google_tokens");
}

async function accessToken() {
  const tokens = load("google_tokens", null);
  if (!tokens?.refresh_token) throw new Error("Google n'est pas connecté.");
  if (tokens.access_token && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error === "invalid_grant") googleDisconnect();
    throw new Error("Session Google expirée : reconnecte Google.");
  }
  save("google_tokens", { ...tokens, ...data, expires_at: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

async function gfetch(url, options = {}) {
  const token = await accessToken();
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Erreur Google ${res.status}`);
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

export async function createEvent({ title, start, end, description, location }) {
  const tz = process.env.TIMEZONE || "Europe/Paris";
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const body = {
    summary: title,
    description,
    location,
    start: isDate ? { date: start } : { dateTime: start, timeZone: tz },
    end: isDate
      ? { date: end || start }
      : { dateTime: end || new Date(new Date(start).getTime() + 3600_000).toISOString(), timeZone: tz },
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

export async function sendEmail({ to, subject, body }) {
  const encSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const raw = [
    `To: ${to}`,
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
  if (due) body.due = new Date(due).toISOString();
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
