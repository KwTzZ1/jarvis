// ================== JARVIS : onglet Web (petit navigateur) ==================
// Recherche Google et sites affichés dans Jarvis. Beaucoup de sites interdisent d'être affichés
// dans une autre appli : on le détecte (côté serveur) et on propose de les ouvrir dans une fenêtre.

// Moteur choisi dans les réglages (Google par défaut, Bing en secours).
const ENGINES = {
  google: { home: "https://www.google.com/?igu=1", search: (q) => `https://www.google.com/search?${new URLSearchParams({ q, igu: "1" })}` },
  bing: { home: "https://www.bing.com/", search: (q) => `https://www.bing.com/search?${new URLSearchParams({ q })}` },
};
const engine = () => ENGINES[state.status?.webEngine] || ENGINES.google;
const HOME = ENGINES.google.home;
const web = {
  tabs: [],
  current: null,
};

function loadWebTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem("webTabs") || "null");
    if (Array.isArray(saved) && saved.length) {
      web.tabs = saved
        .filter((t) => t && typeof t.url === "string")
        .slice(0, 12)
        .map((t) => ({ id: uid(), url: t.url, label: t.label || "Onglet", history: [t.url], index: 0, view: null }));
    }
  } catch {}
  if (!web.tabs.length) web.tabs = [newTabData(HOME, "Google")];
  const cur = Number(localStorage.getItem("webCurrent")) || 0;
  web.current = web.tabs[Math.min(cur, web.tabs.length - 1)].id;
}
function saveWebTabs() {
  localStorage.setItem("webTabs", JSON.stringify(web.tabs.map((t) => ({ url: t.url, label: t.label }))));
  localStorage.setItem("webCurrent", String(web.tabs.findIndex((t) => t.id === web.current)));
}
function newTabData(url, label) {
  return { id: uid(), url, label, history: [url], index: 0, view: null };
}
const currentTab = () => web.tabs.find((t) => t.id === web.current);

// Texte tapé -> adresse : un site si ça ressemble à une adresse, sinon une recherche Google.
function toUrl(input) {
  const text = input.trim();
  if (!text) return engine().home;
  if (/^https?:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return "https://" + text;
  // "youtube daft punk" ou "yt daft punk" -> recherche YouTube dans Jarvis.
  const yt = text.match(/^(youtube|yt)\s+(.+)$/i);
  if (yt) return `https://www.youtube.com/results?${new URLSearchParams({ search_query: yt[2] })}`;
  return engine().search(text);
}
function labelFor(url) {
  try {
    const u = new URL(url);
    if (/(google|bing)\./.test(u.hostname) && u.searchParams.get("q")) return "Recherche : " + u.searchParams.get("q");
    if (/google\./.test(u.hostname)) return "Google";
    if (/bing\./.test(u.hostname)) return "Bing";
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) {
      const q = u.searchParams.get("search_query");
      return q ? "YouTube : " + q : "YouTube";
    }
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "Onglet";
  }
}

// Vue d'un onglet : un cadre (iframe) par onglet, gardé en vie quand on change d'onglet.
function ensureView(tab) {
  if (tab.view) return tab.view;
  const view = el("div", "web-frame");
  view.dataset.id = tab.id;
  $("#webView").append(view);
  tab.view = view;
  return view;
}

async function showUrl(tab, url) {
  const view = ensureView(tab);
  // YouTube a sa propre vue dans Jarvis (le site normal refuse d'être affiché ici).
  // Avec l'extension de Jarvis, le vrai YouTube s'affiche : la vue YouTube maison ne sert que sans elle.
  const ytInfo = framesUnlocked() ? null : youtubeTarget(url);
  if (ytInfo) {
    tab.url = url;
    return renderYouTube(view, tab, ytInfo);
  }
  view.replaceChildren(el("div", "web-loading", "Chargement…"));
  let info = { url, embeddable: true };
  try {
    info = await api(`/api/web/check?url=${encodeURIComponent(url)}`);
  } catch (e) {
    view.replaceChildren(blockedCard(url, e.message));
    return;
  }
  tab.url = info.url;
  if (!info.embeddable && !framesUnlocked()) {
    view.replaceChildren(blockedCard(info.url));
    return;
  }
  const frame = el("iframe");
  // Pas de "allow-top-navigation" : un site affiché ne peut pas faire quitter Jarvis.
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads");
  frame.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  frame.src = info.url;
  view.replaceChildren(frame);
}

// ---------- YouTube dans Jarvis ----------
function youtubeTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") return { v: u.pathname.slice(1), q: "" };
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  if (u.pathname.startsWith("/embed/")) return { v: u.pathname.split("/")[2], q: "" };
  if (u.pathname.startsWith("/shorts/")) return { v: u.pathname.split("/")[2], q: "" };
  return { v: u.searchParams.get("v") || "", q: u.searchParams.get("search_query") || "" };
}

const ytResults = new Map(); // recherche -> résultats (évite de dépenser le quota en revenant en arrière)

async function renderYouTube(view, tab, { v, q }) {
  const wrap = el("div", "yt");
  const bar = el("form", "yt-bar");
  bar.append(iconEl("youtube", 22));
  const input = el("input");
  input.placeholder = "Rechercher sur YouTube…";
  input.value = q;
  const go = el("button", "btn");
  go.type = "submit";
  go.textContent = "Rechercher";
  bar.append(input, go);
  bar.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value.trim()) navigate(`https://www.youtube.com/results?${new URLSearchParams({ search_query: input.value.trim() })}`);
  });
  wrap.append(bar);

  if (v && /^[\w-]{6,20}$/.test(v)) {
    const player = el("div", "yt-player");
    const frame = el("iframe");
    frame.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.src = `https://www.youtube-nocookie.com/embed/${v}?autoplay=1&rel=0`;
    player.append(frame);
    const out = el("button", "proj-link");
    out.type = "button";
    out.append(iconEl("external", 14), document.createTextNode("Ouvrir sur YouTube (commentaires, abonnement…)"));
    out.onclick = () => openExternal(`https://www.youtube.com/watch?v=${v}`);
    wrap.append(player, out);
  }

  const results = el("div", "yt-results");
  wrap.append(results);
  view.replaceChildren(wrap);
  const query = q || tab.ytQuery || "";
  if (q) tab.ytQuery = q;
  if (!state.status?.youtube) {
    results.append(el("div", "web-blocked-note", "Pour chercher des vidéos, ajoute une clé YouTube gratuite dans les réglages (le README explique comment). Les liens YouTube collés dans la barre d'adresse marchent déjà."));
    return;
  }
  if (!query) {
    if (!v) results.append(el("div", "web-blocked-note", "Tape une recherche ci-dessus."));
    return;
  }
  results.append(el("div", "web-loading", "Recherche…"));
  try {
    let videos = ytResults.get(query);
    if (!videos) {
      videos = (await api(`/api/youtube/search?q=${encodeURIComponent(query)}`)).videos;
      ytResults.set(query, videos);
    }
    results.replaceChildren();
    if (!videos.length) results.append(el("div", "web-blocked-note", "Aucune vidéo trouvée."));
    for (const vid of videos) {
      const card = el("button", "yt-card" + (vid.id === v ? " playing" : ""));
      card.type = "button";
      const thumb = el("div", "yt-thumb");
      if (vid.thumb) {
        const img = el("img");
        img.src = vid.thumb;
        img.alt = "";
        img.loading = "lazy";
        thumb.append(img);
      }
      if (vid.duration || vid.live) thumb.append(el("span", "yt-dur", vid.live ? "EN DIRECT" : vid.duration));
      card.append(thumb, el("div", "yt-title", vid.title), el("div", "yt-channel", vid.channel));
      card.onclick = () => {
        tab.ytQuery = query;
        navigate(`https://www.youtube.com/watch?v=${vid.id}`);
      };
      results.append(card);
    }
  } catch (e) {
    results.replaceChildren(el("div", "web-blocked-note", e.message));
  }
}

function blockedCard(url, reason) {
  const card = el("div", "web-blocked");
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  card.append(iconEl("globe", 40));
  card.append(el("h3", null, reason ? "Page indisponible" : `${host} refuse d'être affiché dans une autre appli`));
  card.append(el("p", "muted", reason || "C'est un choix du site (protection contre les fausses pages). Tu peux l'ouvrir dans une vraie fenêtre :"));
  const btn = el("button", "btn");
  btn.type = "button";
  btn.append(iconEl("external", 16), document.createTextNode(" Ouvrir " + host));
  btn.onclick = () => openExternal(url);
  card.append(btn);
  return card;
}

function navigate(input, { newTab = false } = {}) {
  const url = toUrl(input);
  let tab = currentTab();
  if (newTab || !tab) {
    tab = newTabData(url, labelFor(url));
    web.tabs.push(tab);
    web.current = tab.id;
  } else {
    // Nouvelle page : on coupe l'historique "suivant" comme un vrai navigateur.
    tab.history = tab.history.slice(0, tab.index + 1);
    tab.history.push(url);
    tab.index = tab.history.length - 1;
  }
  tab.url = url;
  tab.label = labelFor(url);
  saveWebTabs();
  renderWebTabs();
  showUrl(tab, url);
}

function step(delta) {
  const tab = currentTab();
  if (!tab) return;
  const i = tab.index + delta;
  if (i < 0 || i >= tab.history.length) return;
  tab.index = i;
  tab.url = tab.history[i];
  tab.label = labelFor(tab.url);
  saveWebTabs();
  renderWebTabs();
  showUrl(tab, tab.url);
}

function selectTab(id) {
  web.current = id;
  const tab = currentTab();
  if (!tab.view) showUrl(tab, tab.url); // onglet restauré : on le charge au premier affichage
  saveWebTabs();
  renderWebTabs();
}

function closeTab(id) {
  const i = web.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  web.tabs[i].view?.remove();
  web.tabs.splice(i, 1);
  if (!web.tabs.length) {
    const t = newTabData(HOME, "Google");
    web.tabs.push(t);
  }
  if (web.current === id) web.current = web.tabs[Math.max(0, i - 1)].id;
  selectTab(web.current);
}

function renderWebTabs() {
  const bar = $("#webTabs");
  bar.replaceChildren();
  for (const t of web.tabs) {
    const b = el("div", "web-tab" + (t.id === web.current ? " active" : ""));
    b.title = t.url;
    b.append(iconEl("globe", 13), el("span", "web-tab-label", t.label));
    const x = el("button", "x-btn");
    x.type = "button";
    x.title = "Fermer l'onglet";
    x.append(iconEl("x", 12));
    x.onclick = (e) => {
      e.stopPropagation();
      closeTab(t.id);
    };
    b.append(x);
    b.onclick = () => selectTab(t.id);
    bar.append(b);
  }
  const add = el("button", "web-tab-add");
  add.type = "button";
  add.title = "Nouvel onglet";
  add.append(iconEl("plus", 15));
  add.onclick = () => {
    navigate("", { newTab: true });
    $("#webUrl").focus();
  };
  bar.append(add);
  // Seule la vue de l'onglet actif est visible.
  document.querySelectorAll("#webView .web-frame").forEach((v) => (v.hidden = v.dataset.id !== web.current));
  const tab = currentTab();
  if (document.activeElement !== $("#webUrl")) $("#webUrl").value = tab && !Object.values(ENGINES).some((e) => e.home === tab.url) ? displayUrl(tab.url) : "";
  $("#webBack").disabled = !tab || tab.index <= 0;
  $("#webForward").disabled = !tab || tab.index >= tab.history.length - 1;
}
function displayUrl(url) {
  try {
    const u = new URL(url);
    if (/(google|bing)\./.test(u.hostname) && u.searchParams.get("q")) return u.searchParams.get("q");
    u.searchParams.delete("igu");
    return u.href;
  } catch {
    return url;
  }
}

// ---------- Barre d'adresse et boutons ----------
$("#webBar").addEventListener("submit", (e) => {
  e.preventDefault();
  navigate($("#webUrl").value);
  $("#webUrl").blur();
});
$("#webUrl").addEventListener("focus", () => $("#webUrl").select());
$("#webBack").addEventListener("click", () => step(-1));
$("#webForward").addEventListener("click", () => step(1));
$("#webReload").addEventListener("click", () => {
  const tab = currentTab();
  if (tab) showUrl(tab, tab.url);
});
$("#webHome").addEventListener("click", () => navigate(""));
$("#webOut").addEventListener("click", () => {
  const tab = currentTab();
  if (tab) openExternal(tab.url.replace(/[?&]igu=1/, ""));
});

// Jarvis ouvre les liens (« ouvre YouTube ») dans cet onglet plutôt que dans une autre fenêtre.
window.openInJarvis = (url = "") => {
  goTo(2);
  navigate(url, { newTab: true });
};

// ---------- Démarrage ----------
hydrateIcons($("#pageWeb"));
hydrateIcons(document.querySelector(".tabs"));
loadWebTabs();
renderWebTabs();
// On ne charge la page de l'onglet qu'au premier passage sur l'onglet Web (pas de chargement inutile).
let webStarted = false;
function startWebIfVisible() {
  if (page === 2 && !webStarted) {
    webStarted = true;
    selectTab(web.current);
  }
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setTimeout(startWebIfVisible, 0)));
new MutationObserver(startWebIfVisible).observe($("#pageWeb"), { attributes: true, attributeFilter: ["inert"] });
startWebIfVisible();

// L'extension vient de s'activer : les pages marquées "refusées" peuvent maintenant s'afficher.
window.addEventListener("jarvis-frames-ready", () => {
  for (const t of web.tabs) if (t.view?.querySelector(".web-blocked")) showUrl(t, t.url);
});
