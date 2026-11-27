// ================== JARVIS : onglet Projets ==================
const proj = { list: [], online: {}, loaded: false };

async function loadProjects() {
  try {
    proj.list = (await api("/api/projects")).projects;
    proj.loaded = true;
    renderProjects();
    // Pastilles "en ligne" : vérifiées en arrière-plan.
    api("/api/projects/status")
      .then((s) => {
        proj.online = s;
        renderProjects();
      })
      .catch(() => {});
  } catch (e) {
    $("#projects").replaceChildren(el("div", "board-empty", e.message));
  }
}

function projectButton(icon, label, title, onClick) {
  const b = el("button", "proj-link");
  b.type = "button";
  b.title = title;
  b.append(iconEl(icon, 14), document.createTextNode(label));
  b.onclick = onClick;
  return b;
}

function renderProjects() {
  const box = $("#projects");
  box.replaceChildren();
  if (!proj.list.length) {
    box.append(el("div", "board-empty", "Aucun projet. Clique « Synchroniser GitHub » ou « Ajouter »."));
    return;
  }
  for (const p of proj.list) {
    const card = el("article", "proj-card");
    const head = el("div", "proj-head");
    const avatar = el("div", "proj-avatar", p.name.slice(0, 2).toUpperCase());
    const titles = el("div", "proj-titles");
    titles.append(el("h3", null, p.name));
    const meta = el("div", "proj-meta");
    if (p.site) {
      const on = proj.online[p.id];
      const dot = el("span", "proj-dot " + (on === true ? "on" : on === false ? "off" : ""));
      dot.title = on === true ? "Le site répond" : on === false ? "Le site ne répond pas" : "Vérification…";
      meta.append(dot);
    }
    meta.append(el("span", "proj-status", p.status));
    p.tags.forEach((t) => meta.append(el("span", "proj-tag", t)));
    titles.append(meta);
    const tools = el("div", "proj-tools");
    const edit = el("button", "mini-icon");
    edit.type = "button";
    edit.title = "Modifier";
    edit.append(iconEl("edit", 14));
    edit.onclick = () => openProjectForm(p);
    const del = el("button", "mini-icon");
    del.type = "button";
    del.title = "Supprimer de la liste (ne supprime rien d'autre)";
    del.append(iconEl("x", 14));
    del.onclick = async () => {
      if (!confirm(`Retirer « ${p.name} » de la liste ? (Le projet lui-même n'est pas touché.)`)) return;
      await api(`/api/projects/${p.id}`, { method: "DELETE" }).catch((e) => toast(e.message, true));
      loadProjects();
    };
    tools.append(edit, del);
    head.append(avatar, titles, tools);
    card.append(head);
    if (p.description) card.append(el("p", "proj-desc", p.description));

    const links = el("div", "proj-links");
    // Site public : affiché dans l'onglet Web. Sites où il faut être connecté (GitHub privé, Railway,
    // claude.ai…) : ouverts dans le navigateur habituel, où la session est déjà ouverte.
    const needsLogin = (u) => /(^|\.)(github\.com|railway\.(com|app)|claude\.ai|vercel\.com|netlify\.app|discord\.com)$/i.test(new URL(u).hostname) && !/\.up\.railway\.app$/i.test(new URL(u).hostname);
    if (p.site)
      links.append(
        projectButton("globe", "Site", p.site, () => (needsLogin(p.site) ? openExternal(p.site) : window.openInJarvis(p.site))),
        projectButton("external", "", "Ouvrir le site dans ton navigateur", () => openExternal(p.site)),
      );
    if (p.repo) links.append(projectButton("github", "GitHub", p.repo + " (dans ton navigateur, où tu es connecté)", () => openExternal(p.repo)));
    if (p.host) links.append(projectButton("server", "Hébergement", p.host + " (dans ton navigateur, où tu es connecté)", () => openExternal(p.host)));
    if (p.folder)
      links.append(
        projectButton("folder", "Dossier", p.folder, () =>
          api(`/api/projects/${p.id}/open-folder`, { method: "POST" }).catch((e) => toast(e.message, true)),
        ),
      );
    if (!links.childElementCount) links.append(el("span", "muted small-note", "Aucun lien : clique sur le crayon pour en ajouter."));
    card.append(links);
    box.append(card);
  }
}

// ---------- Fenêtre Ajouter / Modifier ----------
function openProjectForm(p = null) {
  const bg = el("div", "modal-bg");
  const form = el("form", "modal");
  form.noValidate = true;
  const head = el("div", "modal-head");
  head.append(withIcon("h3", null, "folder", p ? `Modifier ${p.name}` : "Nouveau projet", 16));
  const close = el("button", "icon-btn");
  close.type = "button";
  close.title = "Fermer";
  close.append(iconEl("x"));
  head.append(close);
  const body = el("div", "modal-body");
  const fields = [
    ["name", "Nom", "text", "ex : KwMail"],
    ["description", "Description", "text", "À quoi il sert, en une phrase"],
    ["site", "Site (adresse publique)", "text", "ex : https://kwmail.up.railway.app"],
    ["repo", "GitHub", "text", "https://github.com/…"],
    ["host", "Hébergement", "text", "Page Railway, Vercel…"],
    ["folder", "Dossier sur le PC", "text", "C:\\Users\\…\\mon-projet"],
    ["tags", "Étiquettes", "text", "bot, site, discord… (séparées par des virgules)"],
  ];
  for (const [key, label, type, placeholder] of fields) {
    const row = el("div", "field");
    const l = el("label", null, label);
    l.htmlFor = "proj_" + key;
    const input = el("input");
    input.id = "proj_" + key;
    input.name = key;
    input.type = type;
    input.placeholder = placeholder;
    input.value = p ? (key === "tags" ? p.tags.join(", ") : p[key] || "") : "";
    row.append(l, input);
    body.append(row);
  }
  const srow = el("div", "field");
  const sl = el("label", null, "Statut");
  sl.htmlFor = "proj_status";
  const sel = el("select");
  sel.id = "proj_status";
  sel.name = "status";
  ["en ligne", "en développement", "terminé", "en pause"].forEach((s) => {
    const o = el("option", null, s);
    o.value = s;
    sel.append(o);
  });
  sel.value = p?.status || "en développement";
  srow.append(sl, sel);
  body.append(srow);
  const err = el("div", "form-error");
  err.hidden = true;
  const foot = el("div", "modal-foot");
  foot.append(el("span", "hint", "Enregistré sur ton PC. Jarvis s'en sert pour répondre sur tes projets."));
  const save = el("button", "btn", "Enregistrer");
  save.type = "submit";
  foot.append(save);
  form.append(head, body, err, foot);
  bg.append(form);
  document.body.append(bg);
  form.querySelector("input").focus();

  const shut = () => bg.remove();
  close.onclick = shut;
  let downOnBg = false;
  bg.addEventListener("mousedown", (e) => (downOnBg = e.target === bg));
  bg.addEventListener("click", (e) => downOnBg && e.target === bg && shut());
  bg.addEventListener("keydown", (e) => e.key === "Escape" && shut());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    save.disabled = true;
    try {
      await api(p ? `/api/projects/${p.id}` : "/api/projects", { method: p ? "PUT" : "POST", body: values });
      shut();
      toast(p ? "Projet modifié." : "Projet ajouté.");
      loadProjects();
    } catch (ex) {
      err.replaceChildren(iconEl("alert", 16), document.createTextNode(ex.message));
      err.hidden = false;
      save.disabled = false;
    }
  });
}

$("#projAdd").addEventListener("click", () => openProjectForm());
$("#projSync").addEventListener("click", async () => {
  const b = $("#projSync");
  b.disabled = true;
  try {
    const r = await api("/api/projects/sync", { method: "POST" });
    toast(r.added ? `${r.added} dépôt(s) GitHub ajouté(s).` : "Tout est déjà à jour.");
    loadProjects();
  } catch (e) {
    toast(e.message, true);
  } finally {
    b.disabled = false;
  }
});

// Chargé au premier passage sur l'onglet (et rafraîchi à chaque visite).
hydrateIcons($("#pageProjects"));
new MutationObserver(() => {
  if (!$("#pageProjects").inert) loadProjects();
}).observe($("#pageProjects"), { attributes: true, attributeFilter: ["inert"] });
if (!$("#pageProjects").inert) loadProjects();
