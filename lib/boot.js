// Chargé en premier : se place dans le dossier du projet (peu importe d'où on lance),
// lit le .env puis applique les réglages enregistrés depuis l'interface.
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
dotenv.config({ quiet: true });

const { applyConfig } = await import("./config.js");
applyConfig();
