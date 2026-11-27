// Images : création gratuite (Pollinations, sans compte) et images jointes au chat.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "images");
const INDEX = path.join(DIR, "index.json");
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

// Formats : la version gratuite limite la surface à 768 × 768 pixels.
const FORMATS = { carre: [768, 768], paysage: [1024, 576], portrait: [576, 1024] };
let lastRequest = 0;

const readIndex = () => {
  try {
    return JSON.parse(fs.readFileSync(INDEX, "utf8"));
  } catch {
    return [];
  }
};

export function listImages() {
  return readIndex().filter((i) => fs.existsSync(path.join(DIR, i.file)));
}

export function imagePath(file) {
  // Uniquement nos propres fichiers : 16 caractères hexadécimaux + .jpg
  if (!/^[a-f0-9]{16}\.jpg$/.test(file)) return null;
  const p = path.join(DIR, file);
  return fs.existsSync(p) ? p : null;
}

export async function generateImage(prompt, format = "carre") {
  const text = String(prompt || "").trim().slice(0, 600);
  if (!text) throw new Error("Décris l'image à créer.");
  const wait = 45_000 - (Date.now() - lastRequest);
  if (wait > 0) throw new Error(`Le service gratuit autorise une image toutes les 45 secondes : réessaie dans ${Math.ceil(wait / 1000)} s.`);
  const [width, height] = FORMATS[format] || FORMATS.carre;
  const seed = Math.floor(Math.random() * 1e9);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?${new URLSearchParams({ width, height, seed, safe: "true" })}`;
  lastRequest = Date.now();
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new Error("Le service d'images gratuit ne répond pas (ou met trop de temps). Réessaie dans un moment.");
  }
  if (res.status === 402 || res.status === 429) {
    const after = Number(res.headers.get("retry-after")) || 45;
    throw new Error(`Le service d'images gratuit demande d'attendre ${after} s avant la prochaine image.`);
  }
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) throw new Error("Le service d'images a refusé cette demande (contenu non autorisé ou service indisponible).");
  const buf = Buffer.from(await res.arrayBuffer());
  const file = crypto.randomBytes(8).toString("hex") + ".jpg";
  fs.writeFileSync(path.join(DIR, file), buf);
  const entry = { file, prompt: text, format, createdAt: new Date().toISOString() };
  const index = readIndex();
  index.unshift(entry);
  fs.writeFileSync(INDEX, JSON.stringify(index.slice(0, 200), null, 2));
  return { ...entry, url: `/api/images/${file}` };
}

export function deleteImage(file) {
  const p = imagePath(file);
  if (p) fs.unlinkSync(p);
  fs.writeFileSync(INDEX, JSON.stringify(readIndex().filter((i) => i.file !== file), null, 2));
}

// ---------- Images jointes au chat ----------
const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

// Garde au plus 3 images valides (moins de 5 Mo chacune).
export function cleanAttachments(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((d) => typeof d === "string" && d.length < 7_000_000)
    .map((d) => d.match(DATA_URL))
    .filter(Boolean)
    .slice(0, 3)
    .map((m) => ({ mediaType: m[1], data: m[2], dataUrl: m[0] }));
}
