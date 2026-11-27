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

// Photo d'un artiste (pour la recherche d'images).
export async function artistImage(name) {
  const data = await sfetch(`/search?${new URLSearchParams({ q: name, type: "artist", limit: "3" })}`);
  const a = (data?.artists?.items || []).find((x) => x.images?.length);
  return a ? { url: a.images[0].url, title: a.name, source: "Spotify", link: a.external_urls?.spotify } : null;
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
    uri: item.uri,
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
    case "seek": {
      if (!Number.isFinite(Number(value))) throw new Error("Position invalide.");
      await run(`/me/player/seek?position_ms=${Math.max(0, Math.round(Number(value)))}`, "PUT");
      break;
    }
    default:
      throw new Error(`Commande inconnue : ${cmd}`);
  }
  return { ok: true, cmd };
}

// Cherche un titre / artiste / album / playlist et le lance.
const simplify = (str) => String(str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\(.*?\)|\[.*?\]|feat\..*$/g, "").replace(/[^a-z0-9]/g, "");

// Cherche et lance. Pour un titre : recherche "titre + artiste", choix du résultat qui correspond
// vraiment (pas juste le premier), lecture du titre exact, puis vérification de ce qui joue.
export async function searchAndPlay(query, type = "track", artist = "") {
  const allowed = ["track", "artist", "album", "playlist"];
  if (!allowed.includes(type)) type = "track";
  const q = String(query || "").trim();
  const a = String(artist || "").trim();
  const search = async (text) => (await sfetch(`/search?${new URLSearchParams({ q: text, type, limit: "10" })}`))?.[`${type}s`]?.items?.filter(Boolean) || [];
  let items = [];
  if (type === "track" && a) items = await search(`track:${q} artist:${a}`);
  if (!items.length) items = await search(a ? `${q} ${a}` : q);
  if (!items.length) return { ok: false, message: `Rien trouvé pour "${[q, a].filter(Boolean).join(" - ")}".` };

  let item = items[0];
  if (type === "track") {
    const wantT = simplify(q.replace(new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), ""));
    const wantA = simplify(a);
    const score = (t) =>
      (simplify(t.name) === wantT ? 4 : simplify(t.name).includes(wantT) || wantT.includes(simplify(t.name)) ? 2 : 0) +
      (wantA && (t.artists || []).some((x) => simplify(x.name) === wantA) ? 3 : 0);
    item = items.reduce((best, t) => (score(t) > score(best) ? t : best), items[0]);
  }
  // Titre : on joue CE titre (lancer l'album "à partir du titre" pouvait démarrer au mauvais morceau).
  const where = await playOnJarvis(type === "track" ? { uris: [item.uri] } : { context_uri: item.uri });
  const result = {
    ok: true,
    on: where,
    playing: item.name,
    by: (item.artists || []).map((x) => x.name).join(", ") || item.owner?.display_name || "",
    type,
  };
  // Vérification : ce qui joue vraiment (pour ne jamais annoncer un autre titre).
  await new Promise((r) => setTimeout(r, 900));
  const now = await nowPlaying().catch(() => null);
  if (now?.title) result.reellement_en_lecture = `${now.title} - ${now.artist}`;
  return result;
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

function findMine(list, name) {
  const wanted = norm(name);
  return list.find((p) => norm(p.name) === wanted) || list.find((p) => norm(p.name).includes(wanted) || (wanted.length > 3 && wanted.includes(norm(p.name))));
}

const trackInfo = (t) => ({ name: t.name, artist: (t.artists || []).map((x) => x.name).join(", "), uri: t.uri, image: t.album?.images?.at(-1)?.url || null, duration: t.duration_ms || 0 });

// Contenu d'une playlist pour le widget ("liked" = titres likés). Petit cache de 2 minutes.
const viewCache = new Map();
export async function playlistView(id) {
  const hit = viewCache.get(id);
  if (hit && Date.now() - hit.at < 120_000) return hit.view;
  let view;
  if (id === "liked") {
    const tracks = [];
    let url = "/me/tracks?limit=50";
    for (let page = 0; url && page < 6; page++) {
      const data = await sfetch(url);
      for (const it of data?.items || []) if (it.track?.uri) tracks.push(trackInfo(it.track));
      url = data?.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
    }
    view = { id, name: "Titres likés", image: null, tracks };
  } else {
    const p = (await myPlaylists()).find((x) => x.id === id);
    view = { id, name: p?.name || "Playlist", image: p?.image || null, tracks: await playlistItems(id) };
  }
  viewCache.set(id, { at: Date.now(), view });
  return view;
}

// Lance une playlist (ou les titres likés) à partir du titre n° position.
export async function playFrom(id, position = 0) {
  const pos = Math.max(0, Math.floor(Number(position) || 0));
  await control("shuffle", false).catch(() => {});
  let where;
  if (id === "liked") {
    const { tracks } = await playlistView("liked");
    if (!tracks.length) return { ok: false, message: "Aucun titre liké sur ce compte." };
    where = await playOnJarvis({ uris: tracks.slice(pos, pos + 100).map((t) => t.uri) });
  } else {
    where = await playOnJarvis({ context_uri: `spotify:playlist:${id}`, offset: { position: pos } });
  }
  return { ok: true, on: where };
}

// Titres d'une de SES playlists, avec leur date d'ajout (route "/items" depuis 2026).
async function playlistItems(id) {
  const out = [];
  let url = `/playlists/${id}/items?limit=50`;
  for (let page = 0; url && page < 10; page++) {
    const data = await sfetch(url);
    for (const it of data?.items || []) {
      const t = it.item || it.track;
      if (t?.uri && !it.is_local) out.push({ ...trackInfo(t), added_at: it.added_at || null });
    }
    url = data?.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
  }
  return out;
}

// Liste des titres d'une playlist (ex : les derniers ajoutés).
export async function playlistTracks(name, sort = "recent", limit = 15) {
  const found = findMine(await myPlaylists(), name);
  if (!found) throw new Error(`Playlist « ${name} » introuvable dans tes playlists.`);
  let items = await playlistItems(found.id);
  if (sort === "recent") items = [...items].sort((x, y) => String(y.added_at).localeCompare(String(x.added_at)));
  else if (sort === "oldest") items = [...items].sort((x, y) => String(x.added_at).localeCompare(String(y.added_at)));
  return { playlist: found.name, total: items.length, titres: items.slice(0, Math.min(50, limit)).map((t) => ({ titre: t.name, artiste: t.artist, ajoute_le: t.added_at?.slice(0, 10) })) };
}

// "Mets ma playlist Chill" : d'abord dans SES playlists, sinon une playlist publique.
// start = "debut" | "recent" (commence par le dernier titre ajouté) | nom d'un titre
// order = "normal" | "recent_first" (du plus récent au plus ancien) | "shuffle"
export async function playPlaylist(name, options = {}) {
  const opts = typeof options === "boolean" ? { order: options ? "shuffle" : "normal" } : options;
  const found = findMine(await myPlaylists(), name);
  if (!found) {
    const r = await searchAndPlay(name, "playlist");
    return { ...r, note: "Pas trouvée dans tes playlists : j'ai lancé une playlist publique." };
  }
  const start = opts.start || "debut";
  const order = opts.order || "normal";
  let where;
  let first = null;
  if (order === "recent_first") {
    const items = (await playlistItems(found.id)).sort((x, y) => String(y.added_at).localeCompare(String(x.added_at)));
    if (!items.length) return { ok: false, message: "Playlist vide." };
    where = await playOnJarvis({ uris: items.slice(0, 100).map((t) => t.uri) });
    first = items[0];
  } else if (start !== "debut") {
    const items = await playlistItems(found.id);
    let index = -1;
    if (start === "recent") {
      index = items.reduce((best, t, i) => (String(t.added_at) > String(items[best]?.added_at ?? "") ? i : best), 0);
    } else {
      const w = simplify(start);
      index = items.findIndex((t) => simplify(t.name) === w);
      if (index < 0) index = items.findIndex((t) => simplify(t.name).includes(w));
    }
    if (index < 0) index = 0;
    first = items[index];
    if (order === "shuffle") await control("shuffle", true).catch(() => {});
    else await control("shuffle", false).catch(() => {});
    where = await playOnJarvis({ context_uri: found.uri, offset: { position: index } });
  } else {
    await control("shuffle", order === "shuffle").catch(() => {});
    where = await playOnJarvis({ context_uri: found.uri });
  }
  const result = { ok: true, on: where, playlist: found.name, type: "ta playlist", ordre: order, premier_titre: first ? `${first.name} - ${first.artist}` : undefined };
  await new Promise((r) => setTimeout(r, 900));
  const now = await nowPlaying().catch(() => null);
  if (now?.title) result.reellement_en_lecture = `${now.title} - ${now.artist}`;
  return result;
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
