// Spotify : connexion OAuth + lecture en cours, contrôle de la musique, recherche.
// Avec Spotify Premium, Jarvis devient lui-même un appareil Spotify (lecteur intégré, "Web Playback SDK") :
// "joue …" lance la musique directement dans la fenêtre Jarvis, sans l'appli Spotify.
import crypto from "crypto";
import { load, save, remove } from "./store.js";

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  // Lecteur intégré :
  "streaming",
  "user-read-email",
  "user-read-private",
];

// Appareil "Jarvis" déclaré par la page quand son lecteur intégré est prêt.
let playerDeviceId = null;
export const setPlayerDevice = (id) => (playerDeviceId = typeof id === "string" && id ? id : null);
export const playerReady = () => Boolean(playerDeviceId);

// La connexion actuelle autorise-t-elle le lecteur intégré ? (anciennes connexions : non)
export function playerAllowed() {
  const scope = load("spotify_tokens", null)?.scope || "";
  return scope.split(" ").includes("streaming");
}
// Toutes les autorisations actuelles (lecteur + playlists + titres likés) sont-elles accordées ?
export function scopesOk() {
  const granted = (load("spotify_tokens", null)?.scope || "").split(" ");
  return SCOPES.every((s) => granted.includes(s));
}

class NoDeviceError extends Error {}

const pendingStates = new Set();

export function spotifyConfigured() {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

export function spotifyConnected() {
  return Boolean(load("spotify_tokens", null)?.refresh_token);
}

function redirectUri() {
  // Spotify exige 127.0.0.1 (pas "localhost") pour les adresses locales.
  return `${process.env.SPOTIFY_REDIRECT_BASE || "http://127.0.0.1:" + (process.env.PORT || 3000)}/auth/spotify/callback`;
}

function basicAuth() {
  return "Basic " + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
}

export function spotifyAuthUrl() {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES.join(" "),
    state,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(params) {
  try {
    return await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  } catch {
    throw new Error("Impossible de joindre Spotify. Vérifie ta connexion internet.");
  }
}

export async function spotifyHandleCallback(code, state) {
  if (!pendingStates.delete(state)) throw new Error("La connexion a expiré, réessaie.");
  const res = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Échec de connexion Spotify : ${data.error_description || data.error || res.status}. Vérifie le Client ID, le Client secret et la Redirect URI.`);
  save("spotify_tokens", { ...data, expires_at: Date.now() + data.expires_in * 1000 });
}

export function spotifyDisconnect() {
  remove("spotify_tokens");
}

// Jeton court pour le lecteur intégré de la page.
export async function playerToken() {
  return accessToken();
}

async function accessToken(forceRefresh = false) {
  const tokens = load("spotify_tokens", null);
  if (!tokens?.refresh_token) throw new Error("Spotify n'est pas connecté.");
  if (!forceRefresh && tokens.access_token && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  const res = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 400/401 : accès révoqué ou identifiants changés. On déconnecte proprement.
    if (res.status === 400 || res.status === 401) {
      spotifyDisconnect();
      throw new Error("La connexion Spotify a expiré. Clique sur « Connecter » à côté de Spotify.");
    }
    throw new Error("Spotify ne répond pas pour le moment. Réessaie dans un instant.");
  }
  save("spotify_tokens", { ...tokens, ...data, expires_at: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

async function sfetch(path, options = {}, retried = false) {
  const token = await accessToken(retried);
  let res;
  try {
    res = await fetch(`https://api.spotify.com/v1${path}`, {
      ...options,
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch {
    throw new Error("Impossible de joindre Spotify. Vérifie ta connexion internet.");
  }
  if (res.status === 401 && !retried) return sfetch(path, options, true);
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Spotify répond parfois en texte brut (ex : compte non autorisé dans l'app développeur).
  }
  if (!res.ok) {
    const reason = data?.error?.reason;
    if (reason === "NO_ACTIVE_DEVICE" || res.status === 404) {
      throw new NoDeviceError("Aucun appareil Spotify actif : garde la fenêtre Jarvis ouverte (son lecteur intégré se connecte tout seul) ou ouvre Spotify sur un appareil.");
    }
    if (reason === "PREMIUM_REQUIRED") throw new Error("Le contrôle de la musique demande Spotify Premium.");
    if (res.status === 403 && !data) throw new Error("Ton compte Spotify n'est pas autorisé : ajoute ton e-mail dans « User Management » sur developer.spotify.com (voir README).");
    if (res.status === 429) throw new Error("Spotify limite les requêtes. Réessaie dans un instant.");
    if (res.status === 403) throw new Error("Spotify a refusé cette commande pour le moment.");
    throw new Error(data?.error?.message || `Erreur Spotify ${res.status}`);
  }
  return data;
}

export async function nowPlaying() {
  const data = await sfetch("/me/player?additional_types=episode");
  if (!data || !data.item) return { playing: false };
  const item = data.item;
  return {
    playing: data.is_playing,
    title: item.name,
    artist: (item.artists || []).map((a) => a.name).join(", ") || item.show?.name || "",
    album: item.album?.name || "",
    image: item.album?.images?.[0]?.url || item.images?.[0]?.url || null,
    progressMs: data.progress_ms,
    durationMs: item.duration_ms,
    device: data.device?.name,
    volume: data.device?.volume_percent,
    url: item.external_urls?.spotify,
  };
}

const withDevice = (path, id) => path + (path.includes("?") ? "&" : "?") + "device_id=" + encodeURIComponent(id);

// Commande sur l'appareil actif ; s'il n'y en a pas, on se rabat sur le lecteur intégré de Jarvis.
async function onActiveOrJarvis(path, options, cmd) {
  try {
    return await sfetch(path, options);
  } catch (err) {
    if (!(err instanceof NoDeviceError) || !playerDeviceId) throw err;
    if (cmd === "play") return sfetch("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [playerDeviceId], play: true }) });
    return sfetch(withDevice(path, playerDeviceId), options);
  }
}

export async function control(cmd, value) {
  const run = (path, method) => onActiveOrJarvis(path, { method }, cmd);
  switch (cmd) {
    case "play":
      await run("/me/player/play", "PUT");
      break;
    case "pause":
      await run("/me/player/pause", "PUT");
      break;
    case "next":
      await run("/me/player/next", "POST");
      break;
    case "previous":
      await run("/me/player/previous", "POST");
      break;
    case "volume": {
      if (!Number.isFinite(Number(value))) throw new Error("Volume invalide (0 à 100).");
      const v = Math.max(0, Math.min(100, Math.round(Number(value))));
      await run(`/me/player/volume?volume_percent=${v}`, "PUT");
      break;
    }
    case "shuffle":
      await run(`/me/player/shuffle?state=${value ? "true" : "false"}`, "PUT");
      break;
    default:
      throw new Error(`Commande inconnue : ${cmd}`);
  }
  return { ok: true, cmd };
}

// Cherche un titre / artiste / album / playlist et le lance.
export async function searchAndPlay(query, type = "track") {
  const allowed = ["track", "artist", "album", "playlist"];
  if (!allowed.includes(type)) type = "track";
  const data = await sfetch(`/search?${new URLSearchParams({ q: query, type, limit: "1" })}`);
  const item = data?.[`${type}s`]?.items?.find(Boolean);
  if (!item) return { ok: false, message: `Rien trouvé pour "${query}".` };
  // Pour un titre, on lance son album à partir de ce titre : la musique continue ensuite.
  const body =
    type !== "track"
      ? { context_uri: item.uri }
      : item.album?.uri && item.album.album_type !== "single"
        ? { context_uri: item.album.uri, offset: { uri: item.uri } }
        : { uris: [item.uri] };
  const where = await playOnJarvis(body);
  return {
    ok: true,
    on: where,
    playing: item.name,
    by: (item.artists || []).map((a) => a.name).join(", ") || item.owner?.display_name || "",
    type,
  };
}

// Lance un contenu sur le lecteur Jarvis s'il existe, sinon sur l'appareil actif.
async function playOnJarvis(body) {
  const options = { method: "PUT", body: JSON.stringify(body) };
  let where = "Jarvis";
  if (playerDeviceId) {
    // "Joue …" : la musique sort de Jarvis (lecteur intégré), comme demandé.
    try {
      await sfetch(withDevice("/me/player/play", playerDeviceId), options);
    } catch (err) {
      if (!(err instanceof NoDeviceError)) throw err;
      playerDeviceId = null; // lecteur fermé entre-temps : on joue sur l'appareil actif
      await sfetch("/me/player/play", options);
      where = "appareil actif";
    }
  } else {
    await sfetch("/me/player/play", options);
    where = "appareil actif";
  }
  return where;
}

// ---------- Bibliothèque de l'utilisateur ----------
let playlistCache = { at: 0, list: null };
export async function myPlaylists(force = false) {
  if (!force && playlistCache.list && Date.now() - playlistCache.at < 5 * 60_000) return playlistCache.list;
  const out = [];
  let url = "/me/playlists?limit=50";
  for (let page = 0; url && page < 4; page++) {
    const data = await sfetch(url);
    for (const p of data?.items || []) {
      if (p) out.push({ id: p.id, name: p.name, uri: p.uri, tracks: p.tracks?.total ?? null, owner: p.owner?.display_name || "", image: p.images?.[0]?.url || null });
    }
    url = data?.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
  }
  playlistCache = { at: Date.now(), list: out };
  return out;
}

const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// "Mets ma playlist Chill" : d'abord dans SES playlists, sinon une playlist publique.
export async function playPlaylist(name, shuffle = false) {
  const wanted = norm(name);
  const mine = await myPlaylists();
  const found = mine.find((p) => norm(p.name) === wanted) || mine.find((p) => norm(p.name).includes(wanted) || (wanted.length > 3 && wanted.includes(norm(p.name))));
  if (!found) {
    const r = await searchAndPlay(name, "playlist");
    return { ...r, note: "Pas trouvée dans tes playlists : j'ai lancé une playlist publique." };
  }
  const where = await playOnJarvis({ context_uri: found.uri });
  if (shuffle) await control("shuffle", true).catch(() => {});
  return { ok: true, on: where, playing: found.name, type: "ta playlist", tracks: found.tracks };
}

// Titres likés : on lance jusqu'à 50 de ses derniers titres likés.
export async function playLiked(shuffle = true) {
  const data = await sfetch("/me/tracks?limit=50");
  let uris = (data?.items || []).map((i) => i.track?.uri).filter(Boolean);
  if (!uris.length) return { ok: false, message: "Aucun titre liké sur ce compte." };
  if (shuffle) uris = uris.sort(() => Math.random() - 0.5);
  const where = await playOnJarvis({ uris });
  return { ok: true, on: where, playing: "tes titres likés", count: uris.length };
}
