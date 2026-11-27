// Spotify : connexion OAuth + lecture en cours, contrôle de la musique, recherche.
// Le contrôle (play/pause/suivant/volume) demande un compte Spotify Premium et une app Spotify ouverte quelque part.
import crypto from "crypto";
import { load, save, remove } from "./store.js";

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
];

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

export async function spotifyHandleCallback(code, state) {
  if (!pendingStates.delete(state)) throw new Error("État OAuth invalide, réessaie la connexion.");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Échec de connexion Spotify");
  save("spotify_tokens", { ...data, expires_at: Date.now() + data.expires_in * 1000 });
}

export function spotifyDisconnect() {
  remove("spotify_tokens");
}

async function accessToken() {
  const tokens = load("spotify_tokens", null);
  if (!tokens?.refresh_token) throw new Error("Spotify n'est pas connecté.");
  if (tokens.access_token && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error === "invalid_grant") spotifyDisconnect();
    throw new Error("Session Spotify expirée : reconnecte Spotify.");
  }
  save("spotify_tokens", { ...tokens, ...data, expires_at: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

async function sfetch(path, options = {}) {
  const token = await accessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const reason = data?.error?.reason;
    if (reason === "NO_ACTIVE_DEVICE") throw new Error("Aucun appareil Spotify actif : ouvre Spotify sur ton PC ou ton tel.");
    if (reason === "PREMIUM_REQUIRED") throw new Error("Le contrôle de la musique demande Spotify Premium.");
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

export async function control(cmd, value) {
  switch (cmd) {
    case "play":
      await sfetch("/me/player/play", { method: "PUT" });
      break;
    case "pause":
      await sfetch("/me/player/pause", { method: "PUT" });
      break;
    case "next":
      await sfetch("/me/player/next", { method: "POST" });
      break;
    case "previous":
      await sfetch("/me/player/previous", { method: "POST" });
      break;
    case "volume": {
      const v = Math.max(0, Math.min(100, Math.round(Number(value))));
      await sfetch(`/me/player/volume?volume_percent=${v}`, { method: "PUT" });
      break;
    }
    case "shuffle":
      await sfetch(`/me/player/shuffle?state=${value ? "true" : "false"}`, { method: "PUT" });
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
  const body = type === "track" ? { uris: [item.uri] } : { context_uri: item.uri };
  await sfetch("/me/player/play", { method: "PUT", body: JSON.stringify(body) });
  return {
    ok: true,
    playing: item.name,
    by: (item.artists || []).map((a) => a.name).join(", ") || item.owner?.display_name || "",
    type,
  };
}
