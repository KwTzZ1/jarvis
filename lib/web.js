// Onglet Web : beaucoup de sites refusent d'être affichés à l'intérieur d'une autre page
// (en-têtes X-Frame-Options / frame-ancestors). On le vérifie avant de les ouvrir dans Jarvis.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36";
const cache = new Map(); // origine -> { embeddable, at }

// Adresse "jouable" dans Jarvis : YouTube et Google ont une version qui s'affiche dans une page.
export function embedVersion(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtube.com" && u.pathname === "/watch" && u.searchParams.get("v")) {
    return `https://www.youtube.com/embed/${encodeURIComponent(u.searchParams.get("v"))}?autoplay=1`;
  }
  if (host === "youtu.be" && u.pathname.length > 1) return `https://www.youtube.com/embed/${encodeURIComponent(u.pathname.slice(1))}?autoplay=1`;
  if (/^google\.[a-z.]+$/.test(host) && (u.pathname === "/search" || u.pathname === "/")) {
    u.searchParams.set("igu", "1"); // paramètre qui autorise Google dans une page
    return u.href;
  }
  return u.href;
}

function blocksFraming(headers) {
  const xfo = (headers.get("x-frame-options") || "").toLowerCase();
  if (xfo.includes("deny") || xfo.includes("sameorigin")) return true;
  const fa = (headers.get("content-security-policy") || "").match(/frame-ancestors([^;]*)/i);
  if (fa) {
    const sources = fa[1].trim().split(/\s+/);
    // Seuls "*" ou une source http(s) générique autorisent n'importe quel hôte, dont Jarvis en local.
    return !sources.some((s) => s === "*" || s === "http:" || s === "http://127.0.0.1:*" || s === "http://localhost:*");
  }
  return false;
}

export async function checkPage(raw) {
  const url = embedVersion(raw);
  if (!url) throw new Error("Adresse invalide.");
  const origin = new URL(url).origin + new URL(url).pathname.split("/").slice(0, 2).join("/");
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.at < 10 * 60_000) return { url, embeddable: hit.embeddable };
  let embeddable = true;
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
    embeddable = !blocksFraming(res.headers);
    res.body?.cancel?.().catch(() => {});
  } catch {
    // Site injoignable depuis ici : on tente quand même l'affichage, le navigateur dira s'il échoue.
  }
  cache.set(origin, { embeddable, at: Date.now() });
  return { url, embeddable };
}
