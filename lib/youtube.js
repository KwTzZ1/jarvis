// YouTube : recherche via l'API officielle (clé gratuite, ~100 recherches/jour),
// lecture dans le lecteur intégrable de YouTube (le site normal refuse d'être affiché dans une autre appli).

export const youtubeConfigured = () => Boolean(process.env.YOUTUBE_API_KEY);

function duration(iso) {
  const m = String(iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const [h, min, s] = [m[1], m[2], m[3]].map((x) => Number(x || 0));
  return (h ? `${h}:${String(min).padStart(2, "0")}` : String(min)) + ":" + String(s).padStart(2, "0");
}

const decode = (s) => String(s || "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function yt(path, params) {
  if (!youtubeConfigured()) throw new Error("Ajoute une clé YouTube (gratuite) dans les réglages pour chercher des vidéos (voir README).");
  let res;
  try {
    res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: process.env.YOUTUBE_API_KEY })}`, { signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new Error("Impossible de joindre YouTube. Vérifie ta connexion internet.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const reasons = [...(data.error?.errors || []).map((e) => e.reason), ...(data.error?.details || []).map((d) => d.reason)];
  if (reasons.includes("quotaExceeded")) throw new Error("Quota YouTube du jour atteint (environ 100 recherches). Ça repart demain.");
  if (reasons.includes("accessNotConfigured") || reasons.includes("SERVICE_DISABLED")) throw new Error("Active « YouTube Data API v3 » dans ton projet Google Cloud (voir README).");
  if (reasons.includes("keyInvalid") || reasons.includes("API_KEY_INVALID") || res.status === 400) throw new Error("Clé YouTube refusée : vérifie-la dans les réglages.");
  throw new Error(data.error?.message || `Erreur YouTube ${res.status}`);
}

export async function searchVideos(q, max = 12) {
  const query = String(q || "").trim().slice(0, 200);
  if (!query) return [];
  const s = await yt("search", { part: "snippet", type: "video", videoEmbeddable: "true", maxResults: String(max), q: query, regionCode: "FR", relevanceLanguage: "fr", safeSearch: "moderate" });
  const items = (s.items || []).filter((i) => i.id?.videoId);
  if (!items.length) return [];
  // Durées (1 unité de quota seulement).
  const v = await yt("videos", { part: "contentDetails", id: items.map((i) => i.id.videoId).join(",") }).catch(() => ({ items: [] }));
  const durations = Object.fromEntries((v.items || []).map((x) => [x.id, duration(x.contentDetails?.duration)]));
  return items.map((i) => ({
    id: i.id.videoId,
    title: decode(i.snippet.title),
    channel: decode(i.snippet.channelTitle),
    thumb: i.snippet.thumbnails?.medium?.url || i.snippet.thumbnails?.default?.url || null,
    duration: durations[i.id.videoId] || "",
    live: i.snippet.liveBroadcastContent === "live",
  }));
}
