// Actualités : flux RSS publics (Le Monde, France Info, Numerama…), lus sans clé, gardés 15 minutes.
export const NEWS_FEEDS = {
  une: { label: "À la une", source: "Le Monde", url: "https://www.lemonde.fr/rss/une.xml" },
  info: { label: "En continu", source: "France Info", url: "https://www.francetvinfo.fr/titres.rss" },
  tech: { label: "Tech", source: "Numerama", url: "https://www.numerama.com/feed/" },
  jeux: { label: "Jeux vidéo", source: "jeuxvideo.com", url: "https://www.jeuxvideo.com/rss/rss.xml" },
  sport: { label: "Sport", source: "France Info", url: "https://www.francetvinfo.fr/sports.rss" },
  sciences: { label: "Sciences", source: "Futura", url: "https://www.futura-sciences.com/rss/actualites.xml" },
};

const cache = new Map(); // catégorie -> { at, items }
const TTL = 15 * 60_000;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", ocirc: "ô", ucirc: "û", icirc: "î", laquo: "«", raquo: "»", ndash: "–", mdash: "—" };
function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const stripTags = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const httpUrl = (u) => (/^https?:\/\//i.test(u || "") ? u.trim().replace(/&amp;/g, "&") : "");

function parseFeed(xml, source) {
  const items = [];
  for (const [block] of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)) {
    const tag = (name) => {
      const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
      return m ? decode(m[1]).trim() : "";
    };
    const title = stripTags(tag("title"));
    const link = httpUrl(tag("link")) || httpUrl(/<link[^>]*href="([^"]+)"/i.exec(block)?.[1]) || httpUrl(tag("guid"));
    if (!title || !link) continue;
    const body = tag("description") + " " + tag("content:encoded") + " " + tag("summary");
    const image =
      httpUrl(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i.exec(block)?.[1]) ||
      httpUrl(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i.exec(block)?.[1]) ||
      httpUrl(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]+)"/i.exec(block)?.[1]) ||
      httpUrl(/<img[^>]*src="([^"]+)"/i.exec(body)?.[1]);
    const when = Date.parse(tag("pubDate") || tag("published") || tag("updated") || tag("dc:date"));
    items.push({ title: title.slice(0, 200), link, image, summary: stripTags(body).slice(0, 240), date: Number.isFinite(when) ? when : null, source });
  }
  return items;
}

export async function getNews(cat = "une") {
  const feed = NEWS_FEEDS[cat] || NEWS_FEEDS.une;
  const key = NEWS_FEEDS[cat] ? cat : "une";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  let res;
  try {
    res = await fetch(feed.url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Jarvis/1.0" } });
  } catch {
    if (hit) return hit.items; // hors ligne : on garde les derniers titres
    throw new Error("Pas de connexion au site d'actualités.");
  }
  if (!res.ok) {
    if (hit) return hit.items;
    throw new Error(`Actualités indisponibles (${res.status}).`);
  }
  const items = parseFeed(await res.text(), feed.source)
    .filter((i) => !/bon plan|black friday|cyber monday|code promo|soldes|prix choc|meilleure offre|à prix cassé/i.test(i.title)) // pas de publicité
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .slice(0, 24);
  cache.set(key, { at: Date.now(), items });
  return items;
}
