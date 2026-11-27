// Chargé en premier : se place dans le dossier du projet (peu importe d'où on lance),
// lit le .env (optionnel) puis applique les réglages enregistrés depuis l'interface.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { ALL_KEYS, setFileValues, applyConfig } from "./config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

// Les variables d'environnement de Windows ne doivent pas interférer : un autre logiciel
// peut très bien définir CLAUDE_EFFORT, PORT ou ANTHROPIC_API_KEY pour lui-même.
const portOverride = process.env.JARVIS_PORT;
for (const key of ALL_KEYS) delete process.env[key];

let fileValues = {};
try {
  fileValues = dotenv.parse(fs.readFileSync(path.join(ROOT, ".env")));
} catch {
  // Pas de .env : tout se règle dans l'interface.
}
if (portOverride) fileValues.PORT = portOverride;
setFileValues(fileValues);
applyConfig();
