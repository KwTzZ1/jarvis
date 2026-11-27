// Projets de l'utilisateur (sites, bots, applis) : enregistrés dans data/projects.json, sur ce PC uniquement.
import fs from "fs";
import crypto from "crypto";
import { execFile, spawn } from "child_process";
import { load, save } from "./store.js";

const STATUSES = ["en ligne", "en développement", "terminé", "en pause"];

export const listProjects = () => load("projects", []);
const saveProjects = (list) => save("projects", list);

function cleanUrl(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const withProto = /^https?:\/\//i.test(s) ? s : "https://" + s;
  try {
    const u = new URL(withProto);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error();
    return u.href;
  } catch {
    throw new Error(`Lien invalide : ${s}`);
  }
}

function cleanProject(input, previous = {}) {
  const name = String(input.name ?? previous.name ?? "").trim().slice(0, 60);
  if (!name) throw new Error("Donne un nom au projet.");
  const tags = (Array.isArray(input.tags) ? input.tags : String(input.tags ?? previous.tags?.join(",") ?? "").split(","))
    .map((t) => String(t).trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 6);
  const status = STATUSES.includes(input.status) ? input.status : previous.status || "en développement";
  return {
    id: previous.id || crypto.randomBytes(6).toString("hex"),
    name,
    description: String(input.description ?? previous.description ?? "").trim().slice(0, 300),
    site: cleanUrl(input.site ?? previous.site),
    repo: cleanUrl(input.repo ?? previous.repo),
    host: cleanUrl(input.host ?? previous.host),
    folder: String(input.folder ?? previous.folder ?? "").trim().slice(0, 300),
    tags,
    status,
    createdAt: previous.createdAt || new Date().toISOString(),
  };
}

export function addProject(input) {
  const list = listProjects();
  const p = cleanProject(input);
  list.push(p);
  saveProjects(list);
  return p;
}

export function updateProject(id, input) {
  const list = listProjects();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) throw new Error("Projet introuvable.");
  list[i] = cleanProject(input, list[i]);
  saveProjects(list);
  return list[i];
}

export function removeProject(id) {
  saveProjects(listProjects().filter((p) => p.id !== id));
}

// Trouve un projet par son nom (tolérant : "kwmail", "KwMail", "le bot vinyle"…).
export function findProject(name) {
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const wanted = norm(name);
  const list = listProjects();
  return (
    list.find((p) => norm(p.name) === wanted) ||
    list.find((p) => norm(p.name).includes(wanted) || wanted.includes(norm(p.name))) ||
    list.find((p) => p.tags.some((t) => norm(t) === wanted)) ||
    null
  );
}

// Ajoute les dépôts GitHub qui manquent (via l'outil "gh" déjà connecté sur ce PC).
export function syncGithub() {
  return new Promise((resolve, reject) => {
    execFile("gh", ["repo", "list", "--limit", "100", "--json", "name,description,url,homepageUrl,isPrivate"], { timeout: 20_000, windowsHide: true }, (err, stdout) => {
      if (err) return reject(new Error("Impossible de lire GitHub : l'outil « gh » n'est pas installé ou pas connecté sur ce PC."));
      let repos;
      try {
        repos = JSON.parse(stdout);
      } catch {
        return reject(new Error("Réponse GitHub illisible."));
      }
      const list = listProjects();
      const known = new Set(list.map((p) => p.repo.toLowerCase()));
      let added = 0;
      for (const r of repos) {
        if (known.has(r.url.toLowerCase()) || known.has((r.url + "/").toLowerCase())) continue;
        list.push(cleanProject({ name: r.name, description: r.description || "", repo: r.url, site: r.homepageUrl || "", tags: r.isPrivate ? ["privé"] : ["public"] }));
        added++;
      }
      saveProjects(list);
      resolve({ added, total: list.length });
    });
  });
}

// Le site répond-il ? (pour la pastille verte / rouge)
export async function siteStatuses() {
  const out = {};
  await Promise.all(
    listProjects()
      .filter((p) => p.site)
      .map(async (p) => {
        try {
          const res = await fetch(p.site, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(7000) });
          res.body?.cancel?.().catch(() => {});
          out[p.id] = res.status < 500;
        } catch {
          out[p.id] = false;
        }
      }),
  );
  return out;
}

export function openFolder(id) {
  const p = listProjects().find((x) => x.id === id);
  if (!p?.folder) throw new Error("Aucun dossier renseigné pour ce projet.");
  if (!fs.existsSync(p.folder) || !fs.statSync(p.folder).isDirectory()) throw new Error("Ce dossier n'existe plus sur le PC.");
  spawn("explorer.exe", [p.folder], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  return { ok: true };
}
