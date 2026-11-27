import { synthesize, piperVoices } from "./lib/tts.js";
import { systemInfo } from "./lib/system.js";
import "./lib/boot.js";
import express from "express";
import * as google from "./lib/google.js";
import * as spotify from "./lib/spotify.js";
import { getWeather } from "./lib/weather.js";
import { pendingDiscord } from "./lib/agent.js";
import { chat, activeProvider, aiConfigured, aiHealth, checkAi, resetAi, friendlyError, getModel, pendingEmails, getMemory, usageTotals } from "./lib/agent.js";
import { checkGroq, getGroqModel, groqConfigured, groqHealth, resetGroq } from "./lib/groq.js";
import { publicSettings, updateSettings } from "./lib/config.js";
import { save } from "./lib/store.js";
import * as discord from "./lib/discord.js";
import { checkPage } from "./lib/web.js";
import * as projects from "./lib/projects.js";
import { searchVideos, youtubeConfigured } from "./lib/youtube.js";
import * as images from "./lib/images.js";
import { spawn } from "child_process";

const PORT = Number(process.env.PORT || 3000);
const APP_URL = `http://127.0.0.1:${PORT}`;
const app = express();
app.disable("x-powered-by");

// ---------- Sécurité ----------
// Le serveur n'écoute que sur ta machine. En plus, on refuse toute requête dont l'adresse
// n'est pas la nôtre : un site web malveillant ne peut pas s'en servir pour lire tes mails.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(String(req.headers.host || "").toLowerCase())) return res.status(403).send("Accès refusé");
  // Les requêtes qui modifient quelque chose doivent venir de la page elle-même.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, "").toLowerCase())) {
      return res.status(403).json({ error: "Origine refusée" });
    }
  }
  next();
});

app.use(express.json({ limit: "25mb" })); // images jointes au chat
app.use(express.static("public", { maxAge: 0 }));

function wrap(fn) {
  return (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error(new Date().toISOString(), req.method, req.path, err);
      if (!res.headersSent) res.status(500).json({ error: err.message || "Erreur interne" });
    });
}

function status() {
  return {
    name: process.env.ASSISTANT_NAME || "Jarvis",
    userName: process.env.USER_NAME || "",
    model: getModel(),
    ai: aiConfigured(),
    aiOk: aiConfigured() ? aiHealth.ok : false,
    aiMessage: aiHealth.message,
    aiReason: aiHealth.reason,
    aiDetail: aiHealth.detail,
    discord: { configured: discord.discordConfigured(), ok: discord.discordConfigured() ? discord.discordHealth.ok : false, message: discord.discordHealth.message, bot: discord.discordHealth.bot, invite: discord.inviteUrl() },
    free: { configured: groqConfigured(), ok: groqConfigured() ? groqHealth.ok : false, message: groqHealth.message, model: getGroqModel() },
    provider: activeProvider(),
    providerPref: process.env.AI_PROVIDER || "auto",
    webEngine: process.env.WEB_ENGINE || "google",
    uiSounds: process.env.UI_SOUNDS !== "false",
    youtube: youtubeConfigured(),
    piper: piperVoices(),
    google: { configured: google.googleConfigured(), connected: google.googleConnected() },
    spotify: {
      configured: spotify.spotifyConfigured(),
      connected: spotify.spotifyConnected(),
      playerAllowed: spotify.spotifyConnected() && spotify.playerAllowed(),
      playerReady: spotify.playerReady(),
      scopesOk: spotify.spotifyConnected() && spotify.scopesOk(),
      canEdit: spotify.spotifyConnected() && spotify.canEditPlaylists(),
    },
    usage: usageTotals,
  };
}

app.get("/api/status", (req, res) => res.json(status()));

app.get("/api/system", wrap(async (req, res) => res.json(await systemInfo())));

// Voix naturelle (Piper, sur le PC).
app.post(
  "/api/tts",
  wrap(async (req, res) => {
    const { text, voice, rate } = req.body || {};
    const wav = await synthesize(text, { voice, rate });
    res.set({ "Content-Type": "audio/wav", "Cache-Control": "no-store" }).send(wav);
  }),
);

// ---------- Réglages ----------
app.get("/api/settings", (req, res) => res.json({ fields: publicSettings() }));
app.post(
  "/api/settings",
  wrap(async (req, res) => {
    const changed = updateSettings(req.body?.values);
    // Nouveaux identifiants = les anciennes connexions ne marchent plus : on repart de zéro.
    if (changed.some((k) => k.startsWith("GOOGLE_"))) google.googleDisconnect();
    if (changed.some((k) => k.startsWith("SPOTIFY_"))) spotify.spotifyDisconnect();
    const values = req.body?.values || {};
    let ai = null;
    let free = null;
    if (changed.some((k) => k.startsWith("CLAUDE_") || k === "ANTHROPIC_API_KEY" || k === "ENABLE_WEB_SEARCH")) resetAi();
    if (changed.some((k) => k.startsWith("GROQ_"))) resetGroq();
    if (changed.some((k) => k.startsWith("DISCORD_"))) discord.resetDiscord();
    // On vérifie une clé dès qu'elle est saisie (même identique : la vérif précédente a pu échouer faute de réseau).
    const checks = [];
    if (changed.includes("ANTHROPIC_API_KEY") || changed.includes("CLAUDE_MODEL") || values.ANTHROPIC_API_KEY) checks.push(checkAi().then((r) => (ai = r)));
    if (changed.includes("GROQ_API_KEY") || changed.includes("GROQ_MODEL") || values.GROQ_API_KEY) checks.push(checkGroq().then((r) => (free = r)));
    let disc = null;
    if (changed.includes("DISCORD_BOT_TOKEN") || values.DISCORD_BOT_TOKEN) checks.push(discord.checkDiscord().then((r) => (disc = r)));
    await Promise.all(checks);
    res.json({ ok: true, changed, ai, free, discord: disc, status: status() });
  }),
);
app.post("/api/settings/check-ai", wrap(async (req, res) => res.json(await checkAi())));

// ---------- Connexions OAuth ----------
function oauthError(err) {
  if (err === "access_denied") return "Connexion annulée.";
  return `Connexion refusée (${err}).`;
}

app.get("/auth/google", (req, res) => {
  if (!google.googleConfigured()) return res.redirect(`${APP_URL}/?error=${encodeURIComponent("Renseigne d'abord le Client ID et le Client secret Google dans les réglages.")}`);
  res.redirect(google.googleAuthUrl());
});
app.get("/auth/google/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(oauthError(String(req.query.error)));
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
    if (req.query.error) throw new Error(oauthError(String(req.query.error)));
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
      settle(() => getWeather()),
    ]);
    res.json({ events, emails, tasks, weather, memory: getMemory(), status: status() });
  }),
);

app.get(
  "/api/music",
  wrap(async (req, res) => {
    if (!spotify.spotifyConnected()) return res.json({ error: "not_connected" });
    res.json(await settle(() => spotify.nowPlaying()));
  }),
);

// Lecteur intégré (Spotify Premium) : la page récupère un jeton court et déclare son appareil.
app.get(
  "/api/spotify/token",
  wrap(async (req, res) => {
    if (!spotify.spotifyConnected()) return res.status(404).json({ error: "Spotify n'est pas connecté." });
    res.set("Cache-Control", "no-store");
    res.json({ token: await spotify.playerToken() });
  }),
);
app.get(
  "/api/spotify/playlists",
  wrap(async (req, res) => {
    if (!spotify.spotifyConnected()) return res.status(404).json({ error: "Spotify n'est pas connecté." });
    res.json({ playlists: await spotify.myPlaylists(req.query.refresh === "1") });
  }),
);
const TRACK_URI = /^spotify:track:[A-Za-z0-9]{1,40}$/;
const PLAYLIST_ID = /^[A-Za-z0-9]{1,40}$/;
app.get(
  "/api/spotify/search",
  wrap(async (req, res) => {
    if (!spotify.spotifyConnected()) return res.status(404).json({ error: "Spotify n'est pas connecté." });
    const q = String(req.query.q || "").trim();
    res.json({ tracks: q ? await spotify.searchTracks(q) : [] });
  }),
);
app.post(
  "/api/spotify/track",
  wrap(async (req, res) => {
    const { uri, playlistId, newPlaylist } = req.body || {};
    if (!TRACK_URI.test(String(uri))) return res.status(400).json({ error: "Titre inconnu." });
    if (typeof newPlaylist === "string" && newPlaylist.trim()) return res.json(await spotify.createPlaylist(newPlaylist.trim(), uri));
    if (playlistId !== undefined) {
      if (!PLAYLIST_ID.test(String(playlistId))) return res.status(400).json({ error: "Playlist inconnue." });
      return res.json(await spotify.addToPlaylist(playlistId, uri));
    }
    res.json(await spotify.playTrack(uri));
  }),
);
app.get(
  "/api/spotify/playlist/:id",
  wrap(async (req, res) => {
    if (!spotify.spotifyConnected()) return res.status(404).json({ error: "Spotify n'est pas connecté." });
    if (!/^(liked|[A-Za-z0-9]{1,40})$/.test(req.params.id)) return res.status(400).json({ error: "Playlist inconnue." });
    res.json(await spotify.playlistView(req.params.id));
  }),
);
app.post(
  "/api/spotify/play",
  wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.playlistId === "string") {
      if (!/^(liked|[A-Za-z0-9]{1,40})$/.test(b.playlistId)) return res.status(400).json({ error: "Playlist inconnue." });
      return res.json(await spotify.playFrom(b.playlistId, b.position));
    }
    if (b.liked) return res.json(await spotify.playLiked(true));
    if (typeof b.playlist === "string") return res.json(await spotify.playPlaylist(b.playlist, { order: b.order, start: b.start }));
    res.status(400).json({ error: "Rien à lancer." });
  }),
);
app.post("/api/spotify/device", (req, res) => {
  spotify.setPlayerDevice(req.body?.id ?? null);
  res.json({ ok: true, ready: spotify.playerReady() });
});

const MUSIC_COMMANDS = new Set(["play", "pause", "next", "previous", "volume", "shuffle", "seek"]);
app.post(
  "/api/music/:cmd",
  wrap(async (req, res) => {
    if (!MUSIC_COMMANDS.has(req.params.cmd)) return res.status(400).json({ error: "Commande inconnue" });
    res.json(await spotify.control(req.params.cmd, req.body?.value));
  }),
);

app.post(
  "/api/tasks/:id/complete",
  wrap(async (req, res) => {
    res.json(await google.completeTask(req.params.id));
  }),
);

// Suppression d'un souvenir : on vérifie aussi le texte, au cas où la liste aurait bougé entre-temps.
app.delete(
  "/api/memory/:index",
  wrap(async (req, res) => {
    const mem = getMemory();
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= mem.length) return res.status(400).json({ error: "Souvenir introuvable", memory: mem });
    const text = typeof req.query.text === "string" ? req.query.text : null;
    const target = text !== null && mem[index] !== text ? mem.indexOf(text) : index;
    if (target < 0) return res.json({ memory: mem });
    mem.splice(target, 1);
    save("memory", mem);
    res.json({ memory: mem });
  }),
);

// ---------- Mails : envoi uniquement après clic de l'utilisateur ----------
app.post(
  "/api/email/:id/send",
  wrap(async (req, res) => {
    const draft = pendingEmails.get(req.params.id);
    if (!draft) return res.status(404).json({ error: "Brouillon introuvable (déjà envoyé, ou Jarvis a redémarré)." });
    const b = req.body || {};
    const mail = {
      to: typeof b.to === "string" ? b.to : draft.to,
      subject: typeof b.subject === "string" ? b.subject : draft.subject,
      body: typeof b.body === "string" ? b.body : draft.body,
    };
    if (!google.validRecipients(mail.to)) return res.status(400).json({ error: "Adresse du destinataire invalide." });
    await google.sendEmail(mail);
    pendingEmails.delete(req.params.id);
    res.json({ ok: true });
  }),
);
app.post("/api/email/:id/cancel", (req, res) => {
  pendingEmails.delete(req.params.id);
  res.json({ ok: true });
});

// ---------- Chat avec l'IA ----------
app.post("/api/chat", async (req, res) => {
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  try {
    res.json(await chat(history));
  } catch (err) {
    console.error(new Date().toISOString(), "chat", err);
    res.status(502).json({ error: friendlyError(err) });
  }
});

// ---------- Discord (bot) ----------
const needDiscord = (res) => (discord.discordConfigured() ? false : (res.status(400).json({ error: "Ajoute le jeton de ton bot Discord dans les réglages." }), true));
app.get(
  "/api/discord/channels",
  wrap(async (req, res) => {
    if (needDiscord(res)) return;
    res.json({ channels: await discord.listChannels(), preferred: discord.getPreferredChannel() });
  }),
);
app.get(
  "/api/discord/messages",
  wrap(async (req, res) => {
    if (needDiscord(res)) return;
    const channel = await discord.findChannel(typeof req.query.channel === "string" ? req.query.channel : null);
    res.json({ channel, messages: await discord.readMessages(channel.id, 20) });
  }),
);
app.post(
  "/api/discord/prefs",
  wrap(async (req, res) => {
    if (typeof req.body?.channel === "string") discord.setPreferredChannel(req.body.channel);
    res.json({ ok: true });
  }),
);
// Envoi tapé par l'utilisateur lui-même dans le widget.
app.post(
  "/api/discord/send",
  wrap(async (req, res) => {
    if (needDiscord(res)) return;
    const channel = await discord.findChannel(String(req.body?.channel || ""));
    res.json(await discord.sendMessage(channel.id, req.body?.content));
  }),
);
// Message préparé par l'IA : envoyé seulement après le clic "Envoyer".
app.post(
  "/api/discord/draft/:id/send",
  wrap(async (req, res) => {
    const draft = pendingDiscord.get(req.params.id);
    if (!draft) return res.status(404).json({ error: "Brouillon introuvable (déjà envoyé, ou Jarvis a redémarré)." });
    const content = typeof req.body?.content === "string" ? req.body.content : draft.content;
    await discord.sendMessage(draft.channelId, content);
    pendingDiscord.delete(req.params.id);
    res.json({ ok: true });
  }),
);
app.post("/api/discord/draft/:id/cancel", (req, res) => {
  pendingDiscord.delete(req.params.id);
  res.json({ ok: true });
});

// ---------- Projets ----------
app.get("/api/projects", (req, res) => res.json({ projects: projects.listProjects() }));
app.post("/api/projects", wrap(async (req, res) => res.json(projects.addProject(req.body || {}))));
app.put("/api/projects/:id", wrap(async (req, res) => res.json(projects.updateProject(req.params.id, req.body || {}))));
app.delete("/api/projects/:id", (req, res) => {
  projects.removeProject(req.params.id);
  res.json({ ok: true });
});
app.post("/api/projects/sync", wrap(async (req, res) => res.json(await projects.syncGithub())));
app.get("/api/projects/status", wrap(async (req, res) => res.json(await projects.siteStatuses())));
app.post("/api/projects/:id/open-folder", wrap(async (req, res) => res.json(projects.openFolder(req.params.id))));

// ---------- Images créées ----------
app.get("/api/images", (req, res) => res.json({ images: images.listImages().map((i) => ({ ...i, url: `/api/images/${i.file}` })) }));
app.get("/api/images/:file", (req, res) => {
  const p = images.imagePath(req.params.file);
  if (!p) return res.status(404).json({ error: "Image introuvable" });
  res.sendFile(p);
});
app.post(
  "/api/images",
  wrap(async (req, res) => res.json(await images.generateImage(req.body?.prompt, req.body?.format))),
);
app.delete("/api/images/:file", (req, res) => {
  images.deleteImage(req.params.file);
  res.json({ ok: true });
});

// ---------- YouTube ----------
app.get(
  "/api/youtube/search",
  wrap(async (req, res) => {
    res.json({ videos: await searchVideos(String(req.query.q || "")) });
  }),
);

// ---------- Ouvrir un lien dans le navigateur habituel (où l'utilisateur est connecté) ----------
app.post("/api/open-external", (req, res) => {
  let url;
  try {
    url = new URL(String(req.body?.url || ""));
  } catch {
    return res.status(400).json({ error: "Adresse invalide" });
  }
  if (!["http:", "https:"].includes(url.protocol)) return res.status(400).json({ error: "Seuls les liens web sont autorisés" });
  // Sans passer par un interpréteur de commandes : l'adresse est un simple argument.
  spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url.href], { detached: true, stdio: "ignore" }).unref();
  res.json({ ok: true });
});

// ---------- Onglet Web ----------
app.get(
  "/api/web/check",
  wrap(async (req, res) => {
    res.json(await checkPage(String(req.query.url || "")));
  }),
);

app.use("/api", (req, res) => res.status(404).json({ error: "Route inconnue" }));

// Une erreur imprévue ne doit pas faire tomber l'assistant.
process.on("unhandledRejection", (err) => console.error(new Date().toISOString(), "unhandledRejection", err));

// Écoute aussi sur ::1 pour que "localhost" marche quel que soit le réglage de Windows.
app.listen(PORT, "::1").on("error", () => {});
app
  .listen(PORT, "127.0.0.1", () => {
    const name = process.env.ASSISTANT_NAME || "Jarvis";
    console.log(`\n  ${name} est en ligne : ${APP_URL}\n`);
    if (!aiConfigured()) console.log("  [!] Pas de clé API Claude : renseigne-la dans les réglages.");
    else checkAi().then((r) => !r.ok && console.log("  [!] " + r.message));
    if (groqConfigured()) checkGroq().then((r) => !r.ok && console.log("  [!] " + r.message));
    if (discord.discordConfigured()) discord.checkDiscord().then((r) => !r.ok && console.log("  [!] " + r.message));
    if (!google.googleConfigured()) console.log("  [!] Google non configuré (voir README).");
    if (!spotify.spotifyConfigured()) console.log("  [!] Spotify non configuré (voir README).");
  })
  .on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Le port ${PORT} est déjà utilisé par un autre programme. Ferme-le (ou l'autre Jarvis) puis relance.`);
    } else {
      console.error("Impossible de démarrer le serveur :", err.message);
    }
    process.exit(1);
  });
