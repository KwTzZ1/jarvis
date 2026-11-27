// Petit stockage local en fichiers JSON (dossier data/) : jetons de connexion, mémoire, réglages.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2), "utf8");
}

export function remove(name) {
  try {
    fs.unlinkSync(file(name));
  } catch {}
}
