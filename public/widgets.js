// ================== JARVIS : page Widgets ==================
// Deux pages côte à côte (Assistant / Widgets) qu'on fait glisser,
// et un tableau de widgets qu'on peut déplacer, redimensionner et empiler.

// ---------- Pages qui glissent ----------
const pager = $("#pager");
const track = $("#track");
const PAGE_IDS = ["pageAssistant", "pageWidgets", "pageWeb", "pageProjects"];
const LAST_PAGE = PAGE_IDS.length - 1;
let page = Math.min(LAST_PAGE, Math.max(0, Number(localStorage.getItem("page")) || 0));
track.style.setProperty("--pages", PAGE_IDS.length);

// Petit "swoosh" de changement d'onglet (son synthétisé, rien à télécharger).
function switchSound(direction) {
  if (state.status && state.status.uiSounds === false) return;
  try {
    const ctx = (switchSound.ctx ||= routeAudio(new AudioContext(), true));
    const t = ctx.currentTime;
    // Souffle filtré qui glisse vers l'aigu ou le grave selon le sens.
    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.18), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(direction > 0 ? 700 : 2600, t);
    filter.frequency.exponentialRampToValueAtTime(direction > 0 ? 2600 : 700, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t);
    // Petit "clic" cristallin à l'arrivée.
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(direction > 0 ? 1320 : 990, t + 0.12);
    og.gain.setValueAtTime(0.0001, t + 0.12);
    og.gain.exponentialRampToValueAtTime(0.06, t + 0.13);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(og).connect(ctx.destination);
    o.start(t + 0.12);
    o.stop(t + 0.24);
  } catch {}
}

function goTo(p, animate = true) {
  const target = Math.max(0, Math.min(LAST_PAGE, p));
  if (animate && target !== page) switchSound(target - page);
  page = target;
  track.style.transition = animate ? "" : "none";
  track.style.transform = `translateX(${(-page * 100) / PAGE_IDS.length}%)`;
  document.querySelectorAll(".tab").forEach((t) => {
    const on = Number(t.dataset.page) === page;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  // La page cachée ne doit pas prendre le focus clavier.
  PAGE_IDS.forEach((id, i) => ($("#" + id).inert = page !== i));
  document.body.dataset.page = String(page);
  localStorage.setItem("page", String(page));
  if (page !== 1) closeAddMenu();
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => goTo(Number(t.dataset.page))));
// Le navigateur peut faire défiler ce conteneur tout seul (focus sur un élément de l'autre page) :
// on l'en empêche, c'est la transformation CSS qui gère l'affichage.
pager.addEventListener("scroll", () => {
  if (pager.scrollLeft || pager.scrollTop) pager.scrollLeft = pager.scrollTop = 0;
});

// Balayage au doigt, au stylet ou à la souris (en attrapant le fond de la page).
let swipe = null;
const SWIPE_BACKGROUNDS = ".page, .stage, .core-stage, .glance, .core-clock, .layout, .col, .center, .chat, .board, .board-page, .board-toolbar, .track, .chips, .web-tabs, .projects-page, .projects";
pager.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.target.closest("input, textarea, select, button, a, label, .add-menu, .msg, .draft, .widget-head, .rs-handle")) return;
  if (boardEditing && e.target.closest(".widget")) return; // en mode Modifier, on déplace les widgets
  if (e.pointerType === "mouse" && !e.target.matches(SWIPE_BACKGROUNDS)) return; // garder la sélection de texte
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
});
window.addEventListener("pointermove", (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dx) < 12) return;
    if (Math.abs(dy) > Math.abs(dx)) {
      swipe = null; // geste vertical : on laisse défiler
      return;
    }
    swipe.active = true;
    track.style.transition = "none";
    document.body.classList.add("swiping");
  }
  swipe.dx = dx;
  const width = pager.clientWidth;
  let offset = -page * width + dx;
  // Effet élastique quand on tire au-delà des bords.
  const min = -LAST_PAGE * width;
  if (offset > 0) offset /= 3;
  if (offset < min) offset = min + (offset - min) / 3;
  track.style.transform = `translateX(${offset}px)`;
});
function endSwipe(e) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const { active, dx } = swipe;
  swipe = null;
  document.body.classList.remove("swiping");
  if (!active) return;
  const threshold = Math.min(120, pager.clientWidth * 0.15);
  goTo(dx < -threshold ? page + 1 : dx > threshold ? page - 1 : page);
}
window.addEventListener("pointerup", endSwipe);
window.addEventListener("pointercancel", endSwipe);

// Pavé tactile : balayage horizontal à deux doigts.
let wheelSum = 0;
let wheelLock = 0;
let wheelReset;
pager.addEventListener(
  "wheel",
  (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Date.now() < wheelLock) return;
    wheelSum += e.deltaX;
    clearTimeout(wheelReset);
    wheelReset = setTimeout(() => (wheelSum = 0), 250);
    if (Math.abs(wheelSum) > 90) {
      goTo(page + (wheelSum > 0 ? 1 : -1));
      wheelSum = 0;
      wheelLock = Date.now() + 700;
    }
  },
  { passive: true },
);

// Clavier : Ctrl + flèche gauche / droite (hors champ de texte).
document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey || e.shiftKey || isTyping()) return;
  if (e.key === "ArrowRight") goTo(page + 1);
  else if (e.key === "ArrowLeft") goTo(page - 1);
  else return;
  e.preventDefault();
});

// ---------- Les widgets disponibles ----------
const WIDGET_TYPES = {
  clock: { title: "Horloge", icon: "clock", size: "s", render: renderClockWidget },
  ask: { title: "Demande à Jarvis", icon: "message", size: "m", render: renderAskWidget },
  weather: { title: "Météo", icon: "cloud-sun", size: "m", render: (b) => renderWeatherInto(b, cache.dashboard?.weather) },
  music: { title: "Playlists Spotify", icon: "music", size: "l", render: renderSpotifyWidget },
  spsearch: { title: "Spotify", icon: "headphones", size: "t", render: renderSpotifySearchWidget },
  agenda: { title: "Agenda", icon: "calendar", size: "t", render: (b) => renderListWidget(b, "events") },
  mails: { title: "Mails non lus", icon: "mail", size: "t", render: renderMailWidget },
  tasks: { title: "Tâches", icon: "tasks", size: "t", render: (b) => renderListWidget(b, "tasks") },
  timers: { title: "Minuteurs", icon: "timer", size: "s", render: renderTimersWidget },
  memory: { title: "Mémoire", icon: "bookmark", size: "s", render: renderMemoryWidget },
  shortcuts: { title: "Raccourcis", icon: "zap", size: "m", render: renderShortcutsWidget },
  discord: { title: "Discord", icon: "message", size: "t", render: renderDiscordWidget },
  images: { title: "Mes images", icon: "image", size: "m", render: renderImagesWidget },
  system: { title: "Système", icon: "server", size: "s", render: renderSystemWidget },
  notes: { title: "Bloc-notes", icon: "edit", size: "m", render: renderNotesWidget },
  remote: { title: "Télécommande PC", icon: "zap", size: "m", render: renderRemoteWidget },
  apps: { title: "Applis", icon: "grid", size: "l", render: renderAppsWidget },
};
const SIZES = ["s", "m", "t", "l"];
const SIZE_LABELS = { s: "petit", m: "large", t: "haut", l: "grand" };

// Quelles données redessinent quels widgets.
const WIDGET_DEPS = {
  data: ["weather", "agenda", "mails", "tasks", "memory"],
  music: ["music", "spsearch"],
  timers: ["timers"],
  reply: ["ask"],
  tick: ["clock"],
  discord: ["discord"],
  status: ["discord", "spsearch"],
  images: ["images"],
};
for (const [hook, types] of Object.entries(WIDGET_DEPS)) hooks[hook].push(() => renderTypes(types));

function renderTypes(types) {
  document.querySelectorAll("#board .widget-body").forEach((body) => {
    if (types.includes(body.dataset.type)) WIDGET_TYPES[body.dataset.type].render(body);
  });
}

function renderClockWidget(body) {
  let time = body.querySelector(".wc-time");
  if (!time) {
    body.replaceChildren();
    time = el("div", "wc-time");
    body.append(time, el("div", "wc-date"));
  }
  const now = new Date();
  time.textContent = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  body.querySelector(".wc-date").textContent = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function renderListWidget(body, kind) {
  let ul = body.querySelector("ul");
  if (!ul) {
    ul = el("ul", "list");
    body.replaceChildren(ul);
  }
  renderListInto(ul, kind);
}

// Spotify : ce qui joue + tes playlists en vignettes cliquables (mises à jour en direct).
function renderSpotifyWidget(body) {
  let now = body.querySelector(".spw-now");
  if (!now) {
    now = el("div", "spw-now");
    const lib = el("div", "spw-lib");
    lib.append(el("div", "spw-label", "Tes playlists"), el("div", "spw-grid"));
    const pl = el("div", "spw-pl");
    pl.hidden = true;
    body.replaceChildren(now, lib, pl);
    body.classList.add("spw");
  }
  const grid = body.querySelector(".spw-grid");
  renderMusicInto(now, cache.music);
  now.querySelector(".sp-lib")?.remove(); // le menu déroulant est remplacé par les vignettes
  // Une playlist est ouverte : on affiche ses titres (avec celui qui joue en surbrillance).
  const open = body.dataset.open;
  body.querySelector(".spw-lib").hidden = !!open;
  body.querySelector(".spw-pl").hidden = !open;
  if (open) return markPlaying(body);
  const sp = state.status?.spotify;
  if (!sp?.connected) return grid.replaceChildren();
  if (!sp.scopesOk) return grid.replaceChildren(el("div", "muted", "Reconnecte Spotify pour voir tes playlists."));
  if (!spotifyLib.playlists) {
    loadPlaylists(); // préviendra les widgets une fois chargé (pas de boucle)
    return grid.replaceChildren(el("div", "muted", "Chargement…"));
  }
  if (grid.dataset.count === String(spotifyLib.playlists.length)) return;
  grid.dataset.count = String(spotifyLib.playlists.length);
  const liked = el("button", "spw-card liked");
  liked.type = "button";
  liked.title = "Titres likés";
  const lc = el("div", "spw-cover");
  lc.append(iconEl("heart", 26));
  liked.append(lc, el("span", null, "Titres likés"));
  liked.onclick = () => openPlaylist(body, { id: "liked", name: "Titres likés", image: null });
  grid.replaceChildren(liked);
  for (const p of spotifyLib.playlists) {
    const c = el("button", "spw-card");
    c.type = "button";
    c.title = `${p.name}${p.tracks != null ? ` · ${p.tracks} titres` : ""}`;
    const cover = el("div", "spw-cover");
    if (p.image) {
      const img = el("img");
      img.src = p.image;
      img.alt = "";
      img.loading = "lazy";
      cover.append(img);
    } else cover.append(iconEl("music", 22));
    c.append(cover, el("span", null, p.name));
    c.onclick = () => openPlaylist(body, p);
    grid.append(c);
  }
}

// Clic sur une playlist : elle se lance et s'ouvre dans le widget avec tous ses titres.
const playlistViews = new Map();
function loadPlaylistView(id) {
  const hit = playlistViews.get(id);
  if (hit && Date.now() - hit.at < 120_000) return hit.promise;
  const promise = api(`/api/spotify/playlist/${encodeURIComponent(id)}`);
  playlistViews.set(id, { at: Date.now(), promise });
  promise.catch(() => playlistViews.delete(id));
  return promise;
}

function playFromPlaylist(p, position = 0) {
  return api("/api/spotify/play", { method: "POST", body: { playlistId: p.id, position } }).then(
    () => setTimeout(refreshMusic, 800),
    (e) => toast(e.message, true),
  );
}

const fmtDuration = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}` : "");

function openPlaylist(body, p) {
  body.dataset.open = p.id;
  const pl = body.querySelector(".spw-pl");
  const back = el("button", "spw-back");
  back.type = "button";
  back.title = "Retour aux playlists";
  back.append(iconEl("chevron-left", 18));
  back.onclick = () => {
    delete body.dataset.open;
    renderSpotifyWidget(body);
  };
  const cover = el("div", "spw-cover spw-pl-cover" + (p.id === "liked" ? " liked" : ""));
  if (p.image) {
    const img = el("img");
    img.src = p.image;
    img.alt = "";
    cover.append(img);
  } else cover.append(iconEl(p.id === "liked" ? "heart" : "music", 18));
  const info = el("div", "spw-pl-info");
  const count = el("div", "spw-pl-count", "Chargement des titres…");
  info.append(el("div", "spw-pl-name", p.name), count);
  const playAll = el("button", "mini-icon spw-playall");
  playAll.type = "button";
  playAll.title = "Lire depuis le début";
  playAll.append(iconEl("play", 14));
  playAll.onclick = () => playFromPlaylist(p, 0);
  const head = el("div", "spw-pl-head");
  head.append(back, cover, info, playAll);
  const list = el("ol", "spw-tracks");
  pl.replaceChildren(head, list);
  renderSpotifyWidget(body);
  // Lancement immédiat (les titres likés en aléatoire, comme avant).
  if (p.id === "liked") api("/api/spotify/play", { method: "POST", body: { liked: true } }).then(() => setTimeout(refreshMusic, 800), (e) => toast(e.message, true));
  else playFromPlaylist(p, 0).then(() => toast(`Lecture : ${p.name}`));
  loadPlaylistView(p.id).then(
    (v) => {
      if (body.dataset.open !== p.id) return;
      count.textContent = `${v.tracks.length} titre${v.tracks.length > 1 ? "s" : ""}`;
      const frag = document.createDocumentFragment();
      v.tracks.forEach((t, i) => {
        const li = el("li");
        const b = el("button", "spw-track");
        b.type = "button";
        b.dataset.uri = t.uri;
        b.title = `${t.name} — ${t.artist}`;
        const pic = el("div", "spw-t-pic");
        if (t.image) {
          const img = el("img");
          img.src = t.image;
          img.alt = "";
          img.loading = "lazy";
          pic.append(img);
        }
        const txt = el("div", "spw-t-txt");
        txt.append(el("div", "spw-t-name", t.name), el("div", "spw-t-artist", t.artist));
        b.append(el("span", "spw-t-num", String(i + 1)), pic, txt, el("span", "spw-t-dur", fmtDuration(t.duration)));
        b.onclick = () => playFromPlaylist(p, i);
        li.append(b);
        frag.append(li);
      });
      list.replaceChildren(frag);
      if (!v.tracks.length) list.append(el("li", "muted", "Playlist vide."));
      markPlaying(body);
    },
    (e) => body.dataset.open === p.id && ((count.textContent = "Titres indisponibles"), list.replaceChildren(el("li", "muted", e.message))),
  );
}

// Spotify : recherche en direct (dès qu'on tape), recherches récentes, écoute et ajout à une playlist.
const spsRecent = () => JSON.parse(localStorage.getItem("spsRecent") || "[]");
const spsRemember = (q) => q && localStorage.setItem("spsRecent", JSON.stringify([q, ...spsRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6)));
function renderSpotifySearchWidget(body) {
  const sp = state.status?.spotify;
  if (!sp?.connected) return body.replaceChildren(el("div", "muted", "Connecte Spotify dans les réglages."));
  if (body.querySelector(".sps-form")) return markPlaying(body);
  body.classList.add("sps");
  const form = el("form", "sps-form");
  const input = el("input");
  input.type = "search";
  input.placeholder = "Titre, artiste, album…";
  input.autocomplete = "off";
  const clear = el("button", "sps-clear");
  clear.type = "button";
  clear.title = "Effacer";
  clear.hidden = true;
  clear.append(iconEl("x", 13));
  form.append(iconEl("search", 16), input, clear);
  const list = el("ul", "sps-list");
  body.replaceChildren(form, list);
  let timer;
  let seq = 0;
  const showHome = () => {
    const recent = spsRecent();
    if (!recent.length) {
      const empty = el("li", "sps-empty");
      empty.append(iconEl("headphones", 30), el("div", null, "Cherche un titre, un artiste ou un album"), el("small", null, "Clique un résultat pour l'écouter, + pour l'ajouter à une playlist"));
      return list.replaceChildren(empty);
    }
    const li = el("li", "sps-recent");
    const chips = el("div", "sps-chips");
    for (const q of recent) {
      const c = el("button", "sps-chip", q);
      c.type = "button";
      c.onclick = () => ((input.value = q), run(q));
      chips.append(c);
    }
    li.append(el("div", "sps-label", "Recherches récentes"), chips);
    list.replaceChildren(li);
  };
  const run = async (q) => {
    const id = ++seq;
    clear.hidden = !q;
    if (!q) return showHome();
    list.replaceChildren(...Array.from({ length: 4 }, () => el("li", "sps-skel")));
    try {
      const { tracks } = await api(`/api/spotify/search?q=${encodeURIComponent(q)}`);
      if (id !== seq) return; // une recherche plus récente est déjà partie
      if (!tracks.length) return list.replaceChildren(el("li", "sps-empty", `Aucun résultat pour « ${q} ».`));
      list.replaceChildren(...tracks.map((t) => searchResult(t, () => spsRemember(q))));
      markPlaying(body);
    } catch (err) {
      if (id === seq) list.replaceChildren(el("li", "sps-empty", err.message));
    }
  };
  input.oninput = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    clear.hidden = !q;
    timer = setTimeout(() => run(q), q ? 380 : 0);
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(timer);
    spsRemember(input.value.trim());
    run(input.value.trim());
  };
  clear.onclick = () => ((input.value = ""), run(""), input.focus());
  showHome();
}

function searchResult(t, onUse) {
  const li = el("li");
  const row = el("div", "spw-track sps-row");
  row.dataset.uri = t.uri;
  const pic = el("button", "sps-cover");
  pic.type = "button";
  pic.title = "Écouter";
  if (t.image) {
    const img = el("img");
    img.src = t.image;
    img.alt = "";
    img.loading = "lazy";
    pic.append(img);
  }
  const eq = el("span", "sps-eq");
  eq.append(el("i"), el("i"), el("i"));
  pic.append(eq, iconEl("play", 16));
  const txt = el("div", "spw-t-txt");
  txt.append(el("div", "spw-t-name", t.name), el("div", "spw-t-artist", t.artist));
  const play = () => {
    onUse?.();
    api("/api/spotify/track", { method: "POST", body: { uri: t.uri } }).then(() => setTimeout(refreshMusic, 800), (e) => toast(e.message, true));
  };
  pic.onclick = play;
  txt.onclick = play;
  const add = el("button", "sps-add");
  add.type = "button";
  add.title = "Ajouter à une playlist";
  add.append(iconEl("plus", 15));
  add.onclick = () => (onUse?.(), togglePlaylistPicker(li, t));
  row.append(pic, txt, el("span", "spw-t-dur", fmtDuration(t.duration)), add);
  li.append(row);
  return li;
}

// Petit menu sous le titre : choisir une playlist ou en créer une.
function togglePlaylistPicker(li, t) {
  const open = li.querySelector(".sps-pick");
  document.querySelectorAll(".sps-pick").forEach((p) => p.remove());
  if (open) return;
  const box = el("div", "sps-pick");
  const done = (msg) => (toast(msg), box.remove(), playlistViews.clear());
  const fail = (e) => toast(e.message, true);
  const fill = () => {
    box.replaceChildren();
    const mine = spotifyLib.playlists || [];
    for (const p of mine) {
      const b = el("button", "sps-pl", p.name);
      b.type = "button";
      b.onclick = () => api("/api/spotify/track", { method: "POST", body: { uri: t.uri, playlistId: p.id } }).then(() => done(`Ajouté à ${p.name}`), fail);
      box.append(b);
    }
    const nb = el("form", "sps-new");
    const name = el("input");
    name.placeholder = "Nouvelle playlist…";
    const ok = el("button", "mini-icon");
    ok.type = "submit";
    ok.title = "Créer et ajouter";
    ok.append(iconEl("plus", 13));
    nb.append(name, ok);
    nb.onsubmit = (e) => {
      e.preventDefault();
      if (!name.value.trim()) return;
      api("/api/spotify/track", { method: "POST", body: { uri: t.uri, newPlaylist: name.value.trim() } }).then((r) => {
        spotifyLib.playlists = null;
        loadPlaylists();
        done(`Playlist « ${r.name} » créée`);
      }, fail);
    };
    box.append(nb);
  };
  if (!state.status?.spotify?.canEdit) box.append(el("div", "hint", "Pour ajouter à tes playlists : Réglages > Spotify > Déconnecter puis Connecter (nouvelle autorisation)."));
  else if (spotifyLib.playlists) fill();
  else {
    box.append(el("div", "muted", "Chargement…"));
    loadPlaylists().then(fill);
  }
  li.append(box);
}

// Système : processeur, mémoire, disque (toutes les 3 s quand la page Widgets est visible).
let systemData = null;
function renderSystemWidget(body) {
  if (!body.querySelector(".sys")) {
    const box = el("div", "sys");
    for (const [k, label] of [["cpu", "Processeur"], ["ram", "Mémoire"], ["disk", "Disque C:"]]) {
      const row = el("div", "sys-row");
      row.dataset.k = k;
      const bar = el("div", "sys-bar");
      bar.append(el("span"));
      row.append(el("div", "sys-top"), bar);
      row.firstChild.append(el("span", null, label), el("b", "sys-val", "…"));
      box.append(row);
    }
    box.append(el("div", "sys-foot muted"));
    body.replaceChildren(box);
  }
  const s = systemData;
  if (!s) return;
  const go = (b) => (b / 1073741824).toFixed(1).replace(".", ",") + " Go";
  const set = (k, pct, text) => {
    const row = body.querySelector(`.sys-row[data-k="${k}"]`);
    row.querySelector(".sys-val").textContent = text;
    const bar = row.querySelector(".sys-bar span");
    bar.style.width = (pct ?? 0) + "%";
    bar.classList.toggle("hot", pct > 85);
  };
  set("cpu", s.cpu, s.cpu == null ? "…" : s.cpu + " %");
  set("ram", Math.round((100 * s.ram.used) / s.ram.total), `${go(s.ram.used)} / ${go(s.ram.total)}`);
  if (s.disk) set("disk", Math.round(100 - (100 * s.disk.free) / s.disk.total), `${go(s.disk.free)} libres`);
  body.querySelector(".sys-foot").textContent = `Allumé depuis ${Math.floor(s.uptime / 3600)} h ${String(Math.floor((s.uptime % 3600) / 60)).padStart(2, "0")}`;
}
setInterval(() => {
  if (page !== 1 || document.hidden || !document.querySelector('#board .widget-body[data-type="system"]')) return;
  api("/api/system").then((s) => ((systemData = s), renderTypes(["system"])), () => {});
}, 3000);

// Télécommande : son, lecture, verrouillage, presse-papiers et liens envoyés au PC (pratique depuis le téléphone).
// Lanceur d'applis : les icônes viennent des programmes installés ; un clic ouvre l'appli sur le PC.
function renderAppsWidget(body) {
  if (body.querySelector(".apps")) return;
  const box = el("div", "apps");
  body.append(box);
  api("/api/apps")
    .then(({ apps }) => {
      for (const a of apps.filter((x) => x.installed)) {
        const b = el("button", "app-tile");
        b.type = "button";
        b.title = `Ouvrir ${a.label}`;
        const ic = el("span", "app-ic");
        const letter = () => {
          const b0 = el("b", null, a.id === "capture" ? "" : a.label[0]);
          if (a.id === "capture") b0.append(iconEl("image", 20));
          return b0;
        };
        if (a.icon) {
          const img = el("img");
          img.src = a.icon;
          img.alt = "";
          img.onerror = () => img.replaceWith(letter());
          ic.append(img);
        } else ic.append(letter());
        const SHORT = { parametres: "Réglages", calculatrice: "Calculette", blocnotes: "Bloc-notes", explorateur: "Fichiers", taches: "Tâches", capture: "Capture", epic: "Epic" };
        b.append(ic, el("span", "app-name", SHORT[a.id] || a.label));
        b.onclick = () => {
          b.classList.remove("launch");
          void b.offsetWidth;
          b.classList.add("launch");
          window.sfx?.("launch");
          api(`/api/app/${a.id}`, { method: "POST" }).catch((e) => toast(e.message, true));
        };
        box.append(b);
      }
    })
    .catch((e) => box.append(el("p", "empty", e.message)));
}

function renderRemoteWidget(body) {
  if (body.querySelector(".rmt")) return;
  const box = el("div", "rmt");
  const pad = el("div", "rmt-pad");
  const act = (action) => api(`/api/pc/${action}`, { method: "POST" }).catch((e) => toast(e.message, true));
  for (const [action, icon, title] of [["volume_down", "volume", "Son −"], ["mute", "volume-x", "Couper le son"], ["volume_up", "volume", "Son +"], ["previous", "prev", "Précédent"], ["play_pause", "play", "Lecture / pause"], ["next", "next", "Suivant"]]) {
    const b = el("button", "rmt-btn");
    b.type = "button";
    b.title = title;
    b.append(iconEl(icon, 18));
    if (action === "volume_down" || action === "volume_up") b.append(el("b", null, action === "volume_up" ? "+" : "−"));
    b.onclick = () => act(action);
    pad.append(b);
  }
  const lock = el("button", "btn ghost rmt-lock");
  lock.type = "button";
  lock.append(iconEl("key", 14), document.createTextNode("Verrouiller le PC"));
  lock.onclick = () => confirm("Verrouiller le PC maintenant ?") && act("lock");
  const field = el("input");
  field.placeholder = "Texte ou lien à envoyer au PC…";
  const row = el("div", "rmt-row");
  const copy = el("button", "mini-btn", "Copier sur le PC");
  copy.type = "button";
  copy.onclick = () => field.value.trim() && api("/api/clipboard", { method: "POST", body: { text: field.value } }).then((r) => toast(r.message), (e) => toast(e.message, true));
  const open = el("button", "mini-btn", "Ouvrir sur le PC");
  open.type = "button";
  open.onclick = () => /^https?:\/\//i.test(field.value.trim()) ? api("/api/open-external", { method: "POST", body: { url: field.value.trim() } }).then(() => toast("Lien ouvert sur le PC."), (e) => toast(e.message, true)) : toast("Colle un lien qui commence par http.", true);
  const get = el("button", "mini-btn", "Récupérer");
  get.type = "button";
  get.title = "Récupérer ce qui est copié sur le PC";
  get.onclick = () => api("/api/clipboard").then(async (r) => {
    field.value = r.text || "";
    if (!r.text) return toast("Presse-papiers du PC vide.");
    try {
      await navigator.clipboard.writeText(r.text);
      toast("Copié ici aussi.");
    } catch {
      field.select();
    }
  }, (e) => toast(e.message, true));
  row.append(copy, open, get);
  box.append(pad, field, row, lock);
  body.replaceChildren(box);
}

// Bloc-notes : gardé sur ce PC, enregistré pendant que tu écris.
function renderNotesWidget(body) {
  if (body.querySelector("textarea")) return;
  const area = el("textarea", "notes-area");
  area.placeholder = "Tes notes… (enregistrées automatiquement)";
  area.value = localStorage.getItem("jarvisNotes") || "";
  let t;
  area.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => localStorage.setItem("jarvisNotes", area.value), 400);
  };
  body.replaceChildren(area);
}

function markPlaying(body) {
  const uri = cache.music?.data?.uri;
  body.querySelectorAll(".spw-track[data-uri]").forEach((b) => b.classList.toggle("playing", !!uri && b.dataset.uri === uri));
}

// Mails : expéditeur, objet, aperçu et heure ; clic = résumé par Jarvis.
function renderMailWidget(body) {
  const r = cache.dashboard?.emails;
  let ul = body.querySelector("ul");
  if (!ul) {
    ul = el("ul", "list mail-list");
    body.replaceChildren(ul);
  }
  ul.replaceChildren();
  if (!r) return ul.append(emptyLi("Chargement…"));
  if (r.error === "not_connected") return ul.append(emptyLi("Connecte Google pour voir tes mails."));
  if (r.error) return ul.append(emptyLi(r.error));
  if (!r.data.length) return ul.append(emptyLi("Boîte de réception à jour."));
  for (const m of r.data) {
    const name = senderName(m.from);
    const li = el("li", "mail-item");
    const d = new Date(m.date);
    const when = isNaN(d) ? "" : d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const av = el("div", "mail-av", (name.match(/[\p{L}\p{N}]/u)?.[0] || "?").toUpperCase());
    av.style.setProperty("--h", [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
    const top = el("div", "mail-top");
    top.append(el("span", "mail-from", name), el("span", "mail-when", when));
    const main = el("div", "mail-main");
    main.append(top, el("div", "mail-subject", m.subject || "(sans objet)"), el("div", "mail-snip", m.snippet));
    const open = el("button", "mail-open");
    open.type = "button";
    open.title = "Ouvrir dans Gmail";
    open.append(iconEl("external", 14));
    open.onclick = (e) => (e.stopPropagation(), openExternal(`https://mail.google.com/mail/u/0/#inbox/${m.id}`));
    li.append(av, main, open);
    li.title = "Clique pour que Jarvis le résume";
    li.onclick = () => (goTo(0), send(`Résume-moi le mail de ${name} intitulé "${m.subject}" (id ${m.id}).`));
    ul.append(li);
  }
}
// Mails et agenda rafraîchis toutes les minutes quand la page Widgets est ouverte.
setInterval(() => {
  if (page === 1 && document.visibilityState === "visible") refreshAll();
}, 60_000);

function renderMemoryWidget(body) {
  let ul = body.querySelector("ul");
  if (!ul) {
    ul = el("ul", "list small");
    body.replaceChildren(ul);
  }
  renderMemoryInto(ul, cache.dashboard?.memory);
}

function renderTimersWidget(body) {
  let ul = body.querySelector("ul");
  if (!ul) {
    ul = el("ul", "list");
    const quick = el("div", "quick");
    [[5, "5 min"], [10, "10 min"], [25, "25 min (focus)"]].forEach(([min, label]) => {
      const b = el("button", "chip small-chip", label);
      b.type = "button";
      b.onclick = () => startTimer(min * 60, min === 25 ? "Session de focus" : `Minuteur ${min} min`);
      quick.append(b);
    });
    body.replaceChildren(ul, quick);
  }
  renderTimersInto(ul);
  if (!timers.length) ul.replaceChildren(emptyLi("Aucun minuteur. Lance-en un :"));
}

function renderShortcutsWidget(body) {
  if (body.childElementCount) return;
  const wrap = el("div", "chips left");
  document.querySelectorAll("#pageAssistant .chips .chip").forEach((chip) => {
    const b = chip.cloneNode(true);
    b.addEventListener("click", () => send(chip.dataset.prompt));
    wrap.append(b);
  });
  body.append(wrap);
}

function renderAskWidget(body) {
  let reply = body.querySelector(".ask-reply");
  if (!reply) {
    reply = el("div", "ask-reply");
    const form = el("form", "ask-form");
    const input = el("input");
    input.placeholder = "Pose ta question…";
    input.autocomplete = "off";
    const mic = el("button", "mini-icon");
    mic.type = "button";
    mic.title = "Parler";
    mic.append(iconEl("mic", 16));
    mic.onclick = () => toggleMic();
    const go = el("button", "mini-icon primary");
    go.type = "submit";
    go.title = "Envoyer";
    go.append(iconEl("arrow-up", 16));
    form.append(mic, input, go);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (send(input.value)) {
        input.value = "";
        reply.textContent = "Je réfléchis…";
        reply.classList.add("muted");
      }
    });
    body.replaceChildren(reply, form);
  }
  const last = state.lastReply;
  reply.classList.toggle("muted", !last);
  reply.textContent = last ? last.text : `Pose-moi une question ici, ou dis « ${state.name} ».`;
}

// ---------- Mes images (créées par Jarvis) ----------
const imagesState = { list: null, loading: false };
async function loadImages() {
  if (imagesState.loading) return;
  imagesState.loading = true;
  try {
    imagesState.list = (await api("/api/images")).images;
  } catch {
    imagesState.list = imagesState.list || [];
  } finally {
    imagesState.loading = false;
  }
  renderTypes(["images"]);
}
hooks.images.push(() => setTimeout(loadImages, 300));

function renderImagesWidget(body) {
  if (!imagesState.list) {
    body.replaceChildren(el("div", "muted", "Chargement…"));
    loadImages();
    return;
  }
  const grid = el("div", "img-grid");
  if (!imagesState.list.length) {
    body.replaceChildren(el("div", "muted", "Aucune image pour l'instant. Demande : « fais-moi une image de… »."));
    return;
  }
  for (const i of imagesState.list.slice(0, 24)) {
    const a = el("a", "img-thumb");
    a.href = i.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = i.prompt;
    const img = el("img");
    img.src = i.url;
    img.alt = i.prompt;
    img.loading = "lazy";
    a.append(img);
    grid.append(a);
  }
  body.replaceChildren(grid);
}

// ---------- Discord ----------
const discordState = { channels: null, channelsAt: 0, current: localStorage.getItem("discordChannel") || null, messages: [], error: null, loading: false };

async function loadDiscord(force = false) {
  const d = state.status?.discord;
  if (!d?.configured || d.ok === false || discordState.loading) return;
  discordState.loading = true;
  try {
    if (force || !discordState.channels || Date.now() - discordState.channelsAt > 5 * 60_000) {
      const r = await api("/api/discord/channels");
      discordState.channels = r.channels;
      discordState.channelsAt = Date.now();
      if (!discordState.current || !r.channels.some((c) => c.id === discordState.current)) discordState.current = r.preferred || r.channels[0]?.id || null;
    }
    if (discordState.current) {
      const r = await api(`/api/discord/messages?channel=${encodeURIComponent(discordState.current)}`);
      discordState.messages = r.messages;
    }
    discordState.error = null;
  } catch (e) {
    discordState.error = e.message;
  } finally {
    discordState.loading = false;
  }
  renderTypes(["discord"]);
}
hooks.discord.push(() => loadDiscord(true));
// Rafraîchit les messages toutes les 20 s, seulement si un widget Discord est visible.
setInterval(() => {
  if (page === 1 && document.visibilityState === "visible" && document.querySelector('#board .widget-body[data-type="discord"]')) loadDiscord();
}, 5_000);
hooks.status.push(() => {
  const d = state.status?.discord;
  if (d?.ok && !discordState.channels && !discordState.loading) loadDiscord();
});

// Texte Discord lisible : **gras**, liens [texte](adresse), mentions et émojis personnalisés simplifiés.
function dcRich(text, cls) {
  const box = el("div", cls);
  const clean = String(text || "")
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/<@[!&]?\d+>/g, "@membre")
    .replace(/<#\d+>/g, "#salon")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1");
  for (const part of clean.split(/(\*\*[^*]+\*\*)/)) {
    if (/^\*\*[^*]+\*\*$/.test(part)) box.append(el("strong", null, part.slice(2, -2)));
    else if (part) box.append(document.createTextNode(part.replace(/__|~~|`/g, "")));
  }
  return box;
}

// Contenu intégré (carte colorée comme dans Discord).
function dcEmbed(e) {
  const box = el("div", "dc-embed");
  if (e.color) box.style.setProperty("--ec", e.color);
  if (e.author) box.append(el("div", "dc-e-author", e.author));
  if (e.title) {
    const title = dcRich(e.title, "dc-e-title" + (e.url ? " link" : ""));
    if (e.url) title.onclick = () => openExternal(e.url);
    box.append(title);
  }
  if (e.description) box.append(dcRich(e.description, "dc-e-desc"));
  if (e.fields?.length) {
    const grid = el("div", "dc-e-fields");
    for (const f of e.fields) {
      const c = el("div", "dc-e-field" + (f.inline ? " inline" : ""));
      c.append(el("div", "dc-e-name", f.name), dcRich(f.value, "dc-e-val"));
      grid.append(c);
    }
    box.append(grid);
  }
  if (e.image) {
    const img = el("img", "dc-e-img");
    img.src = e.image;
    img.alt = "";
    img.loading = "lazy";
    img.onclick = () => openViewer([{ src: e.image, caption: e.title || "", link: e.url || e.image }], 0);
    box.append(img);
  }
  if (e.footer) box.append(el("div", "dc-e-foot", e.footer));
  return box;
}

function renderDiscordWidget(body) {
  const d = state.status?.discord;
  const note = (text, linkLabel, href) => {
    const box = el("div", "muted", text);
    if (href) {
      const a = el("a", "inline-ic", " " + linkLabel);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.color = "var(--cyan)";
      box.append(a);
    }
    body.replaceChildren(box);
  };
  if (!d?.configured) return note("Ajoute le jeton de ton bot Discord dans les réglages (le README explique comment le créer).");
  if (d.ok === false) return note(d.message);
  if (discordState.error && !discordState.channels) return note(discordState.error);
  if (!discordState.channels) return note("Chargement…");
  if (!discordState.channels.length) return note("Ton bot n'est sur aucun serveur.", "L'inviter", d.invite);

  let select = body.querySelector(".dc-select");
  if (!select) {
    select = el("select", "dc-select");
    select.onchange = () => {
      discordState.current = select.value;
      localStorage.setItem("discordChannel", select.value);
      api("/api/discord/prefs", { method: "POST", body: { channel: select.value } }).catch(() => {});
      discordState.messages = [];
      loadDiscord();
    };
    const list = el("ul", "list dc-msgs");
    const form = el("form", "ask-form");
    const input = el("input");
    input.placeholder = "Écrire dans le salon…";
    input.maxLength = 2000;
    const go = el("button", "mini-icon primary");
    go.type = "submit";
    go.title = "Envoyer (en tant que ton bot)";
    go.append(iconEl("arrow-up", 16));
    form.append(input, go);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      go.disabled = true;
      try {
        await api("/api/discord/send", { method: "POST", body: { channel: discordState.current, content: text } });
        input.value = "";
        loadDiscord();
      } catch (err) {
        toast(err.message, true);
      } finally {
        go.disabled = false;
      }
    });
    body.replaceChildren(select, list, form);
    body.classList.add("dc-body");
  }
  // Liste des salons (regroupés par serveur).
  if (select.dataset.count !== String(discordState.channels.length)) {
    select.replaceChildren();
    let group = null;
    let og = null;
    for (const c of discordState.channels) {
      if (c.guild !== group) {
        group = c.guild;
        og = el("optgroup");
        og.label = c.guild;
        select.append(og);
      }
      const o = el("option", null, "#" + c.name);
      o.value = c.id;
      og.append(o);
    }
    select.dataset.count = String(discordState.channels.length);
  }
  select.value = discordState.current || "";
  const list = body.querySelector(".dc-msgs");
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
  list.replaceChildren();
  if (discordState.error) list.append(emptyLi(discordState.error));
  else if (!discordState.messages.length) list.append(emptyLi("Aucun message récent."));
  let prev = null;
  for (const m of discordState.messages) {
    const at = new Date(m.at);
    const grouped = prev && prev.author === m.author && at - new Date(prev.at) < 5 * 60_000;
    const li = el("li", "dc-msg" + (grouped ? " grouped" : "") + (discordState.seen && !discordState.seen.has(m.id) ? " fresh" : ""));
    const av = el("div", "dc-avatar");
    if (!grouped && m.avatar) {
      const img = el("img");
      img.src = m.avatar;
      img.alt = "";
      img.loading = "lazy";
      av.append(img);
    } else if (!grouped) av.textContent = m.author.slice(0, 1).toUpperCase();
    const main = el("div", "dc-main");
    if (!grouped) {
      const head = el("div", "dc-head");
      head.append(el("b", null, m.author));
      if (m.bot) head.append(el("span", "dc-bot", "BOT"));
      head.append(el("time", null, at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })));
      main.append(head);
    }
    if (m.content) main.append(dcRich(m.content, "dc-text"));
    for (const e of m.embeds || []) main.append(dcEmbed(e));
    const files = m.attachments || [];
    const pics = files.filter((f) => f.image);
    if (files.length) {
      const row = el("div", "dc-files");
      for (const f of files) {
        if (f.image) {
          const img = el("img", "dc-file-img");
          img.src = f.url;
          img.alt = f.name;
          img.loading = "lazy";
          img.onclick = () => openViewer(pics.map((x) => ({ src: x.url, caption: x.name, link: x.url })), pics.indexOf(f));
          row.append(img);
        } else {
          const b = el("button", "dc-file");
          b.type = "button";
          b.append(iconEl("paperclip", 13), el("span", null, f.name));
          b.onclick = () => openExternal(f.url);
          row.append(b);
        }
      }
      main.append(row);
    }
    if (!m.content && !(m.embeds || []).length && !files.length) main.append(el("div", "dc-text muted", "(message vide)"));
    li.append(av, main);
    list.append(li);
    prev = m;
  }
  discordState.seen = new Set(discordState.messages.map((m) => m.id));
  if (atBottom || !list.dataset.seen) list.scrollTop = list.scrollHeight;
  list.dataset.seen = "1";
}

// ---------- Disposition (sauvegardée sur ce PC) ----------
const uid = () => Math.random().toString(36).slice(2, 10);
function defaultBoard() {
  return [
    { stack: ["clock"], size: "s" },
    { stack: ["weather"], size: "m" },
    { stack: ["music"], size: "m" },
    { stack: ["ask"], size: "m" },
    { stack: ["agenda", "tasks"], size: "t" }, // exemple de pile : agenda + tâches
    { stack: ["mails"], size: "t" },
    { stack: ["timers"], size: "s" },
    { stack: ["shortcuts"], size: "m" },
    { stack: ["discord"], size: "t" },
    { stack: ["images"], size: "m" },
  ].map((s) => ({ id: uid(), cur: 0, ...s }));
}
function loadBoard() {
  try {
    const saved = JSON.parse(localStorage.getItem("board"));
    if (Array.isArray(saved)) {
      const slots = saved
        .map((s) => ({ id: String(s.id || uid()), size: SIZES.includes(s.size) ? s.size : "s", stack: (s.stack || []).filter((t) => WIDGET_TYPES[t]), cur: Number(s.cur) || 0 }))
        .filter((s) => s.stack.length);
      slots.forEach((s) => (s.cur = Math.min(Math.max(0, s.cur), s.stack.length - 1)));
      return slots;
    }
  } catch {}
  return defaultBoard();
}
let slots = loadBoard();
const saveBoard = () => localStorage.setItem("board", JSON.stringify(slots));
let boardEditing = false;

function slotElement(slot) {
  const type = slot.stack[slot.cur];
  const def = WIDGET_TYPES[type];
  const w = el("div", `widget size-${slot.size}${slot.stack.length > 1 ? " stacked" : ""}`);
  w.dataset.id = slot.id;

  const head = el("div", "widget-head");
  head.append(iconEl(def.icon, 14), el("span", "title", def.title));
  if (slot.stack.length > 1) {
    // Pile : flèches + points pour passer d'un widget à l'autre.
    const nav = el("div", "stack-nav");
    const prev = el("button", "mini-icon");
    prev.type = "button";
    prev.title = "Widget précédent de la pile";
    prev.append(iconEl("chevron-left", 14));
    prev.onclick = () => cycle(slot, -1);
    const dots = el("div", "stack-dots");
    slot.stack.forEach((t, i) => {
      const d = el("span", i === slot.cur ? "on" : "");
      d.title = WIDGET_TYPES[t].title;
      dots.append(d);
    });
    const next = el("button", "mini-icon");
    next.type = "button";
    next.title = "Widget suivant de la pile";
    next.append(iconEl("chevron-right", 14));
    next.onclick = () => cycle(slot, 1);
    nav.append(prev, dots, next);
    head.append(nav);
  }

  const tools = el("div", "edit-tools");
  const tool = (icon, title, fn) => {
    const b = el("button", "mini-icon");
    b.type = "button";
    b.title = title;
    b.append(iconEl(icon, 14));
    b.onclick = fn;
    tools.append(b);
  };
  tool("resize", `Taille : ${SIZE_LABELS[slot.size]} (clique pour changer)`, () => {
    slot.size = SIZES[(SIZES.indexOf(slot.size) + 1) % SIZES.length];
    saveBoard();
    renderBoard();
  });
  if (slot.stack.length > 1) tool("layers", "Défaire la pile", () => splitStack(slot));
  tool("x", slot.stack.length > 1 ? `Retirer « ${def.title} » de la pile` : "Supprimer ce widget", () => removeWidget(slot));
  head.append(tools);

  const body = el("div", "widget-body");
  body.dataset.type = type;
  const handle = el("div", "rs-handle");
  handle.title = "Tirer pour changer la taille";
  w.append(head, body, handle);
  return w;
}

function renderBoard() {
  const board = $("#board");
  board.classList.toggle("editing", boardEditing);
  board.replaceChildren(...slots.map(slotElement));
  if (!slots.length) board.append(el("div", "board-empty", "Aucun widget pour l'instant. Clique sur « Ajouter »."));
  document.querySelectorAll("#board .widget-body").forEach((b) => WIDGET_TYPES[b.dataset.type].render(b));
}

function cycle(slot, step) {
  slot.cur = (slot.cur + step + slot.stack.length) % slot.stack.length;
  saveBoard();
  renderBoard();
}

function splitStack(slot) {
  const i = slots.indexOf(slot);
  const parts = slot.stack.map((t) => ({ id: uid(), stack: [t], size: slot.size, cur: 0 }));
  slots.splice(i, 1, ...parts);
  saveBoard();
  renderBoard();
}

function removeWidget(slot) {
  if (slot.stack.length > 1) {
    slot.stack.splice(slot.cur, 1);
    slot.cur = Math.min(slot.cur, slot.stack.length - 1);
  } else {
    slots = slots.filter((s) => s !== slot);
  }
  saveBoard();
  renderBoard();
}

// ---------- Mode Modifier ----------
function setEditing(on) {
  boardEditing = on;
  const btn = $("#boardEdit");
  btn.replaceChildren(iconEl(on ? "check" : "edit", 15), document.createTextNode(on ? "Terminé" : "Modifier"));
  $("#boardReset").hidden = !on;
  $("#boardHint").textContent = on
    ? "Attrape un widget pour le déplacer. Lâche-le au centre d'un autre pour les empiler. Icônes en haut à droite : taille, défaire la pile, supprimer."
    : "Glisse vers la droite (ou Ctrl + ←) pour revenir à l'assistant.";
  renderBoard();
}
$("#boardEdit").addEventListener("click", () => setEditing(!boardEditing));
$("#boardReset").addEventListener("click", () => {
  if (!confirm("Remettre la disposition des widgets par défaut ?")) return;
  slots = defaultBoard();
  saveBoard();
  renderBoard();
});

// ---------- Ajouter un widget ----------
function closeAddMenu() {
  $("#addMenu").hidden = true;
}
$("#boardAdd").addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("#addMenu");
  if (!menu.hidden) return closeAddMenu();
  menu.replaceChildren();
  for (const [type, def] of Object.entries(WIDGET_TYPES)) {
    const item = el("button", "add-item");
    item.type = "button";
    item.append(iconEl(def.icon, 16), document.createTextNode(def.title));
    item.onclick = () => {
      slots.push({ id: uid(), stack: [type], size: def.size, cur: 0 });
      saveBoard();
      renderBoard();
      closeAddMenu();
      $("#pageWidgets").scrollTo({ top: $("#pageWidgets").scrollHeight, behavior: "smooth" });
      toast(`Widget « ${def.title} » ajouté.`);
    };
    menu.append(item);
  }
  menu.hidden = false;
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".add-wrap")) closeAddMenu();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeAddMenu());

// ---------- Déplacer / empiler (souris et doigt) ----------
let drag = null;
// Taille à partir d'un nombre de colonnes / lignes (1 ou 2).
const sizeFor = (cols, rows) => (cols > 1 ? (rows > 1 ? "l" : "m") : rows > 1 ? "t" : "s");
const dims = { s: [1, 1], m: [2, 1], t: [1, 2], l: [2, 2] };
function setSlotSize(id, size) {
  const slot = slots.find((s) => s.id === id);
  if (!slot || slot.size === size) return;
  slot.size = size;
  saveBoard();
}

// Redimensionner : on tire la poignée en bas à droite.
let resize = null;
$("#board").addEventListener("pointerdown", (e) => {
  const handle = e.target.closest(".rs-handle");
  if (!handle) return;
  e.preventDefault();
  e.stopPropagation();
  const w = handle.closest(".widget");
  const slot = slots.find((s) => s.id === w.dataset.id);
  const r = w.getBoundingClientRect();
  const [c, rw] = dims[slot.size];
  resize = { w, slot, x: e.clientX, y: e.clientY, cellW: r.width / c, cellH: r.height / rw, startW: r.width, startH: r.height, pointerId: e.pointerId };
  handle.setPointerCapture(e.pointerId);
  w.classList.add("resizing");
}, true);
$("#board").addEventListener("pointermove", (e) => {
  if (!resize || e.pointerId !== resize.pointerId) return;
  const cols = resize.startW + (e.clientX - resize.x) > resize.cellW * 1.5 ? 2 : 1;
  const rows = resize.startH + (e.clientY - resize.y) > resize.cellH * 1.5 ? 2 : 1;
  const size = sizeFor(cols, rows);
  resize.w.className = resize.w.className.replace(/size-\w/, "size-" + size);
  resize.size = size;
});
const endResize = (e) => {
  if (!resize || e.pointerId !== resize.pointerId) return;
  const { slot, size } = resize;
  resize = null;
  if (size) setSlotSize(slot.id, size);
  renderBoard();
};
$("#board").addEventListener("pointerup", endResize);
$("#board").addEventListener("pointercancel", endResize);

// Pincer (pavé tactile : Ctrl + molette, ce que fait le pincement) pour agrandir / réduire.
const GROW = { s: "m", m: "l", t: "l", l: "l" };
const SHRINK = { l: "m", m: "s", t: "s", s: "s" };
let pinchSum = 0;
let pinchLock = 0;
$("#board").addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    const w = e.target.closest(".widget");
    if (!w) return;
    e.preventDefault();
    if (Date.now() < pinchLock) return;
    pinchSum += e.deltaY;
    if (Math.abs(pinchSum) < 30) return;
    const slot = slots.find((s) => s.id === w.dataset.id);
    setSlotSize(slot.id, (pinchSum < 0 ? GROW : SHRINK)[slot.size]);
    pinchSum = 0;
    pinchLock = Date.now() + 350;
    renderBoard();
  },
  { passive: false },
);
// Pincer à deux doigts sur un écran tactile.
let touchPinch = null;
$("#board").addEventListener("touchstart", (e) => {
  if (e.touches.length !== 2) return;
  const w = e.touches[0].target.closest?.(".widget");
  if (!w || w !== e.touches[1].target.closest?.(".widget")) return;
  const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  touchPinch = { id: w.dataset.id, dist };
}, { passive: true });
$("#board").addEventListener("touchmove", (e) => {
  if (!touchPinch || e.touches.length !== 2) return;
  const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const ratio = dist / touchPinch.dist;
  if (ratio > 1.25 || ratio < 0.8) {
    const slot = slots.find((s) => s.id === touchPinch.id);
    setSlotSize(slot.id, (ratio > 1 ? GROW : SHRINK)[slot.size]);
    touchPinch.dist = dist;
    renderBoard();
  }
}, { passive: true });
$("#board").addEventListener("touchend", () => (touchPinch = null));

// Déplacer : on attrape un widget par son en-tête (ou n'importe où en mode Modifier).
$("#board").addEventListener("pointerdown", (e) => {
  if (resize || (e.pointerType === "mouse" && e.button !== 0)) return;
  const w = e.target.closest(".widget");
  if (!w || e.target.closest("button, input, a, select, textarea, .rs-handle")) return;
  if (!boardEditing && !e.target.closest(".widget-head")) return;
  e.preventDefault();
  drag = { id: w.dataset.id, el: w, x: e.clientX, y: e.clientY, moved: false, target: null, zone: null, pointerId: e.pointerId };
  w.setPointerCapture(e.pointerId);
});
$("#board").addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  drag.moved = true;
  drag.el.classList.add("dragging");
  drag.el.style.transform = `translate(${dx}px, ${dy}px)`;

  // Widget survolé : bord = déplacer avant/après, centre = empiler.
  const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains("widget") && n !== drag.el);
  clearDropMarks();
  drag.target = null;
  drag.zone = null;
  if (!under) return;
  const r = under.getBoundingClientRect();
  const rx = (e.clientX - r.left) / r.width;
  const ry = (e.clientY - r.top) / r.height;
  const zone = rx > 0.25 && rx < 0.75 && ry > 0.2 && ry < 0.8 ? "stack" : rx < 0.5 ? "before" : "after";
  drag.target = under;
  drag.zone = zone;
  under.classList.add(`drop-${zone}`);
  if (zone === "stack") {
    const label = el("div", "drop-label");
    label.append(iconEl("layers", 18), document.createTextNode("Empiler"));
    under.append(label);
  }
});
function clearDropMarks() {
  document.querySelectorAll("#board .drop-stack, #board .drop-before, #board .drop-after").forEach((n) => n.classList.remove("drop-stack", "drop-before", "drop-after"));
  document.querySelectorAll("#board .drop-label").forEach((n) => n.remove());
}
function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { id, moved, target, zone } = drag;
  drag = null;
  clearDropMarks();
  if (!moved || !target) return renderBoard();
  const from = slots.find((s) => s.id === id);
  const to = slots.find((s) => s.id === target.dataset.id);
  if (!from || !to) return renderBoard();
  slots = slots.filter((s) => s !== from);
  if (zone === "stack") {
    to.stack.push(...from.stack);
    to.cur = to.stack.length - from.stack.length; // on montre le widget qu'on vient de poser
    toast("Widgets empilés : utilise les flèches du widget pour passer de l'un à l'autre.");
  } else {
    const i = slots.indexOf(to);
    slots.splice(zone === "before" ? i : i + 1, 0, from);
  }
  saveBoard();
  renderBoard();
}
$("#board").addEventListener("pointerup", endDrag);
$("#board").addEventListener("pointercancel", endDrag);

// ---------- Démarrage ----------
hydrateIcons($("#pageWidgets"));
hydrateIcons(document.querySelector(".tabs"));
goTo(page, false);
renderBoard();
