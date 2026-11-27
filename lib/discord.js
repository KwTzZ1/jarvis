// Discord via un bot à toi (méthode officielle) : lire les salons de tes serveurs et y écrire.
// Discord interdit d'automatiser un compte utilisateur ("self-bot") : on ne lit donc pas les messages privés.
import { load, save } from "./store.js";

const API = "https://discord.com/api/v10";
// Voir les salons + envoyer des messages + lire l'historique.
const BOT_PERMISSIONS = 1024 + 2048 + 65536;

export const discordConfigured = () => Boolean(process.env.DISCORD_BOT_TOKEN);

// Dernier état connu : ok = true / false / null (pas encore vérifié).
export const discordHealth = { ok: null, message: "", bot: null, appId: null };
export const resetDiscord = () => {
  Object.assign(discordHealth, { ok: null, message: "", bot: null, appId: null });
  channelCache = { at: 0, list: null };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dfetch(path, options = {}, attempt = 0) {
  let res;
  try {
    res = await fetch(API + path, {
      ...options,
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch {
    throw new Error("Impossible de joindre Discord. Vérifie ta connexion internet.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (res.status === 429 && attempt === 0 && data.retry_after <= 10) {
    await sleep(data.retry_after * 1000 + 200);
    return dfetch(path, options, 1);
  }
  if (res.status === 401) {
    Object.assign(discordHealth, { ok: false, message: "Jeton du bot Discord refusé : copie-le à nouveau (Bot > Reset Token) dans les réglages." });
    throw new Error(discordHealth.message);
  }
  if (res.status === 403) throw new Error("Le bot n'a pas accès à ce salon : vérifie ses permissions sur ton serveur (voir les salons, lire l'historique, envoyer des messages).");
  if (res.status === 404) throw new Error("Salon introuvable (supprimé, ou le bot n'est plus sur ce serveur).");
  if (res.status === 429) throw new Error("Discord limite les requêtes. Réessaie dans quelques secondes.");
  throw new Error(data?.message ? `Discord : ${data.message}` : `Erreur Discord ${res.status}`);
}

// Vérifie le jeton et récupère le nom du bot + le lien d'invitation (gratuit).
export async function checkDiscord() {
  if (!discordConfigured()) return { ok: false, message: "Aucun jeton de bot Discord." };
  try {
    const app = await dfetch("/oauth2/applications/@me");
    Object.assign(discordHealth, { ok: true, message: "", bot: app.bot?.username || app.name, appId: app.id });
    return { ok: true, message: `Bot Discord « ${discordHealth.bot} » connecté.` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export function inviteUrl() {
  if (!discordHealth.appId) return null;
  return `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: discordHealth.appId, scope: "bot", permissions: String(BOT_PERMISSIONS) })}`;
}

// Serveurs et salons texte où le bot a été invité (gardés 1 minute en mémoire).
let channelCache = { at: 0, list: null };
export const resetDiscordCache = () => (channelCache = { at: 0, list: null });
export async function listChannels() {
  if (channelCache.list && Date.now() - channelCache.at < 60_000) return channelCache.list;
  channelCache = { at: Date.now(), list: await fetchChannels() };
  return channelCache.list;
}
async function fetchChannels() {
  const guilds = await dfetch("/users/@me/guilds");
  const out = [];
  for (const g of guilds.slice(0, 20)) {
    const channels = await dfetch(`/guilds/${g.id}/channels`);
    for (const c of channels) {
      // 0 = salon texte, 5 = annonces
      if (c.type === 0 || c.type === 5) out.push({ id: c.id, name: c.name, guild: g.name, guildId: g.id, position: c.position ?? 0 });
    }
  }
  return out.sort((a, b) => a.guild.localeCompare(b.guild) || a.position - b.position);
}

// Trouve un salon par son id, son nom ("general", "#général") ou "serveur/salon".
export async function findChannel(ref) {
  const channels = await listChannels();
  if (!channels.length) throw new Error("Le bot n'est sur aucun serveur : invite-le avec le lien des réglages.");
  if (!ref) {
    const pref = load("discord_prefs", {}).channel;
    return channels.find((c) => c.id === pref) || channels[0];
  }
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^#/, "").trim();
  const wanted = norm(String(ref));
  return (
    channels.find((c) => c.id === ref) ||
    channels.find((c) => norm(`${c.guild}/${c.name}`) === wanted) ||
    channels.find((c) => norm(c.name) === wanted) ||
    channels.find((c) => norm(c.name).includes(wanted)) ||
    (() => {
      throw new Error(`Salon « ${ref} » introuvable. Salons disponibles : ${channels.map((c) => "#" + c.name).join(", ")}`);
    })()
  );
}

export async function readMessages(channelId, limit = 15) {
  const msgs = await dfetch(`/channels/${channelId}/messages?limit=${Math.min(50, Math.max(1, limit))}`);
  return msgs.reverse().map((m) => ({
    id: m.id,
    author: m.member?.nick || m.author?.global_name || m.author?.username || "?",
    avatar: m.author?.avatar ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64` : null,
    bot: Boolean(m.author?.bot),
    content: m.content || (m.attachments?.length ? `[${m.attachments.length} pièce(s) jointe(s)]` : m.embeds?.length ? "[contenu intégré]" : ""),
    at: m.timestamp,
  }));
}

export async function sendMessage(channelId, content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("Message vide.");
  if (text.length > 2000) throw new Error("Message trop long pour Discord (2000 caractères maximum).");
  // allowed_mentions vide : le bot ne peut pas faire de @everyone ou de mention surprise.
  const m = await dfetch(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }) });
  return { id: m.id };
}

export const getPreferredChannel = () => load("discord_prefs", {}).channel || null;
export const setPreferredChannel = (id) => save("discord_prefs", { ...load("discord_prefs", {}), channel: id });
