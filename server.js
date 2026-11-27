import "./lib/boot.js";
import express from "express";
import * as google from "./lib/google.js";
import * as spotify from "./lib/spotify.js";
import { getWeather } from "./lib/weather.js";
import { chat, aiConfigured, getModel, pendingEmails, getMemory, usageTotals } from "./lib/agent.js";
import { publicSettings, updateSettings } from "./lib/config.js";
import { save } from "./lib/store.js";

const PORT = Number(process.env.PORT || 3000);
const APP_URL = `http://127.0.0.1:${PORT}`;
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// Le serveur n'écoute que sur ta machine : personne d'autre sur le réseau ne peut y accéder.
function wrap(fn) {
  return (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error(err);
      res.status(500).json({ error: err.message });
    });
}

// Petite sécurité : les requêtes qui modifient quelque chose doivent venir de la page elle-même.
app.use((req, res, next) => {
  if (req.method !== "GET") {
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      return res.status(403).json({ error: "Origine refusée" });
    }
  }
  next();
});

app.get("/api/status", (req, res) => {
  res.json({
    name: process.env.ASSISTANT_NAME || "Jarvis",
    userName: process.env.USER_NAME || "",
    model: getModel(),
    ai: aiConfigured(),
    google: { configured: google.googleConfigured(), connected: google.googleConnected() },
    spotify: { configured: spotify.spotifyConfigured(), connected: spotify.spotifyConnected() },
    usage: usageTotals,
  });
});

// ---------- Réglages ----------
app.get("/api/settings", (req, res) => res.json({ fields: publicSettings() }));
app.post("/api/settings", (req, res) => {
  updateSettings(req.body?.values || {});
  res.json({ ok: true });
});

// ---------- Connexions OAuth ----------
app.get("/auth/google", (req, res) => {
  if (!google.googleConfigured()) return res.redirect(`${APP_URL}/?error=${encodeURIComponent("Renseigne d'abord le Client ID et le Client secret Google dans les réglages.")}`);
  res.redirect(google.googleAuthUrl());
});
app.get("/auth/google/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    await google.googleHandleCallback(String(req.query.code), String(req.query.state));
    res.redirect(`${APP_URL}/?connected=google`);
  } catch (err) {
    res.redirect(`${APP_URL}/?error=${encodeURIComponent(err.message)}`);
  }
});
app.post("/auth/google/logout", (req, res) => {
  google.googleDisconnect();
  res.json({ ok: true });
});

app.get("/auth/spotify", (req, res) => {
  if (!spotify.spotifyConfigured()) return res.redirect(`${APP_URL}/?error=${encodeURIComponent("Renseigne d'abord le Client ID et le Client secret Spotify dans les réglages.")}`);
  res.redirect(spotify.spotifyAuthUrl());
});
app.get("/auth/spotify/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    await spotify.spotifyHandleCallback(String(req.query.code), String(req.query.state));
    res.redirect(`${APP_URL}/?connected=spotify`);
  } catch (err) {
    res.redirect(`${APP_URL}/?error=${encodeURIComponent(err.message)}`);
  }
});
app.post("/auth/spotify/logout", (req, res) => {
  spotify.spotifyDisconnect();
  res.json({ ok: true });
});

// ---------- Données des widgets ----------
async function settle(fn) {
  try {
    return { data: await fn() };
  } catch (err) {
    return { error: err.message };
  }
}

app.get(
  "/api/dashboard",
  wrap(async (req, res) => {
    const g = google.googleConnected();
    const [events, emails, tasks, weather] = await Promise.all([
      g ? settle(() => google.listEvents({ days: 7, max: 10 })) : { error: "not_connected" },
      g ? settle(() => google.listEmails({ max: 6 })) : { error: "not_connected" },
      g ? settle(() => google.listTasks({ max: 10 })) : { error: "not_connected" },
      settle(() => getWeather(String(req.query.city || process.env.CITY || "Paris"))),
    ]);
    res.json({ events, emails, tasks, weather, memory: getMemory() });
  }),
);

app.get(
  "/api/music",
  wrap(async (req, res) => {
    if (!spotify.spotifyConnected()) return res.json({ error: "not_connected" });
    res.json(await settle(() => spotify.nowPlaying()));
  }),
);

app.post(
  "/api/music/:cmd",
  wrap(async (req, res) => {
    res.json(await spotify.control(req.params.cmd, req.body?.value));
  }),
);

app.post(
  "/api/tasks/:id/complete",
  wrap(async (req, res) => {
    res.json(await google.completeTask(req.params.id));
  }),
);

app.delete(
  "/api/memory/:index",
  wrap(async (req, res) => {
    const mem = getMemory();
    mem.splice(Number(req.params.index), 1);
    save("memory", mem);
    res.json({ memory: mem });
  }),
);

// ---------- Mails : envoi uniquement après clic de l'utilisateur ----------
app.post(
  "/api/email/:id/send",
  wrap(async (req, res) => {
    const draft = pendingEmails.get(req.params.id);
    if (!draft) return res.status(404).json({ error: "Brouillon introuvable (déjà envoyé ou expiré)." });
    const edited = { ...draft, ...(req.body || {}) };
    await google.sendEmail({ to: edited.to, subject: edited.subject, body: edited.body });
    pendingEmails.delete(req.params.id);
    res.json({ ok: true });
  }),
);
app.post("/api/email/:id/cancel", (req, res) => {
  pendingEmails.delete(req.params.id);
  res.json({ ok: true });
});

// ---------- Chat avec l'IA ----------
app.post(
  "/api/chat",
  wrap(async (req, res) => {
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    res.json(await chat(history));
  }),
);

// Écoute aussi sur ::1 pour que "localhost" marche quel que soit le réglage de Windows.
app.listen(PORT, "::1").on("error", () => {});
app.listen(PORT, "127.0.0.1", () => {
  const name = process.env.ASSISTANT_NAME || "Jarvis";
  console.log(`\n  ${name} est en ligne : ${APP_URL}\n`);
  if (!aiConfigured()) console.log("  [!] Pas de clé API Claude : renseigne-la dans les réglages.");
  if (!google.googleConfigured()) console.log("  [!] Google non configuré (voir README).");
  if (!spotify.spotifyConfigured()) console.log("  [!] Spotify non configuré (voir README).");
});
