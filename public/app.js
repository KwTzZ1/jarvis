// ================== JARVIS : interface ==================
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
// Élément contenant une icône suivie d'un texte.
const withIcon = (tag, cls, iconName, text, size = 14) => {
  const e = el(tag, cls);
  e.append(iconEl(iconName, size), document.createTextNode(text));
  return e;
};

const state = {
  name: "Jarvis",
  history: [],
  voiceOn: localStorage.getItem("voiceOn") !== "0",
  wakeOn: false,
  busy: false,
  listening: false,
  speaking: false,
  offline: false,
  status: null,
  noKeyMsg: null,
};

// Dernières données reçues, partagées entre la page principale et les widgets.
const cache = { dashboard: null, music: null };
// Petits "abonnements" : les widgets se redessinent quand les données changent.
const hooks = { data: [], music: [], timers: [], reply: [], tick: [], status: [], discord: [], images: [] };
const emit = (name) => hooks[name].forEach((fn) => {
  try {
    fn();
  } catch (e) {
    console.error("widget", name, e);
  }
});


// ---------- Utilitaires ----------
// Ouvre un lien dans le navigateur habituel de l'utilisateur (là où il est connecté à GitHub, Railway…).
function openExternal(url) {
  return api("/api/open-external", { method: "POST", body: { url } }).catch((e) => toast(e.message, true));
}
// L'extension de Jarvis est-elle active ? (elle permet d'afficher tous les sites dans l'onglet Web)
const framesUnlocked = () => document.documentElement.dataset.jarvisFrames === "1";
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error("Le serveur Jarvis ne répond pas. Relance Jarvis depuis le raccourci du Bureau.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function toast(msg, isError = false) {
  const t = $("#toast");
  t.replaceChildren(iconEl(isError ? "alert" : "check", 18), document.createTextNode(msg));
  t.className = "toast" + (isError ? " err" : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), isError ? 8000 : 4000);
}

function setMode(mode) {
  const r = $("#reactor");
  r.classList.remove("listening", "thinking", "speaking", "offline");
  if (state.offline) {
    r.classList.add("offline");
    $("#state").textContent = "Hors ligne";
    return;
  }
  if (mode) r.classList.add(mode);
  const labels = { listening: "À l'écoute…", thinking: "Analyse…", speaking: "Réponse" };
  $("#state").textContent = labels[mode] || (state.wakeOn ? `Dis « ${state.name} »` : "En ligne");
}
// Remet l'état "au repos" sans couper une écoute ou une réponse en cours.
function idleMode() {
  if (state.listening || awaitingCommand) setMode("listening");
  else if (state.busy) setMode("thinking");
  else if (state.speaking) setMode("speaking");
  else setMode(null);
}

// "2026-11-28" doit rester le 28 en heure locale (et pas minuit UTC).
const parseDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T00:00:00") : new Date(s));
const fmtTime = (d) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
function fmtWhen(iso, allDay) {
  const d = parseDate(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const day = same(d, today) ? "Aujourd'hui" : same(d, tomorrow) ? "Demain" : d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  return allDay ? `${day} · journée` : `${day} · ${fmtTime(d)}`;
}
function senderName(from) {
  const m = from.match(/^"?([^"<]+?)"?\s*</);
  return m ? m[1] : from;
}

// ---------- Horloge ----------
function tick() {
  const now = new Date();
  $("#clockTime").textContent = now.toLocaleTimeString("fr-FR");
  $("#clockDate").textContent = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  emit("tick");
}
setInterval(tick, 1000);
tick();

// ---------- Statut / connexions ----------
function applyStatus(s) {
  if (!s) return;
  state.status = s;
  state.name = s.name;
  document.title = s.name.toUpperCase();
  $("#brandName").textContent = s.name.toUpperCase();
  const first = !state.status;
  const prevProvider = state.status?.provider;
  state.status = s;
  state.name = s.name;
  document.title = s.name.toUpperCase();
  $("#brandName").textContent = s.name.toUpperCase();

  // Voyants : vert = l'IA a vraiment répondu, orange = pas encore vérifiée, rouge = absente ou bloquée.
  // La ligne de l'IA "en service" (celle qui répondra à la prochaine question) est mise en avant.
  const model = s.model.replace("claude-", "").replace(/-(\d+)-(\d+)$/, " $1.$2");
  $("#modelName").textContent = !s.ai ? "clé manquante" : s.aiOk === false ? (s.aiReason === "credit" ? "sans crédit" : "clé refusée") : model;
  $("#connAi").className = "conn " + (!s.ai || s.aiOk === false ? "" : s.aiOk ? "ok" : "warn") + (s.provider === "claude" ? " active" : "");
  $("#connAi").title = !s.ai
    ? "Renseigne ta clé Claude dans les réglages."
    : s.aiOk === false
      ? s.aiMessage + (s.aiDetail ? `\n\nDétail technique : ${s.aiDetail}` : "")
      : s.aiOk
        ? "Clé valide, Claude répond."
        : "Vérification en cours…";

  const f = s.free;
  $("#freeName").textContent = !f.configured ? "non configurée" : f.ok === false ? "indisponible" : f.model.replace(/^openai\//, "");
  $("#connFree").className = "conn " + (!f.configured || f.ok === false ? "" : f.ok ? "ok" : "warn") + (s.provider === "groq" ? " active" : "");
  $("#connFree").title = !f.configured
    ? "IA gratuite : ajoute une clé Groq dans les réglages (gratuit sur console.groq.com)."
    : f.ok === false
      ? f.message
      : "IA gratuite (Groq) : moins douée que Claude, mais gratuite. Environ 1 000 questions par jour.";

  setConn("#connGoogle", s.google, "google");
  setConn("#connSpotify", s.spotify, "spotify");
  setDiscordConn(s.discord);
  updateCost(s.usage);
  emit("status");

  // Bloqué = aucune IA ne peut répondre. Dès que ça se débloque, on le dit (une seule fois).
  const providerOk = s.provider === "claude" ? s.aiOk : s.provider === "groq" ? f.ok : false;
  if (!s.provider || providerOk === false) state.aiBlocked = true;
  else if (state.aiBlocked && providerOk === true) onAiReady(s.provider);
  // L'IA en service a changé en cours de route (crédit épuisé, crédit ajouté…) : on prévient.
  if (!first && prevProvider && s.provider && prevProvider !== s.provider && !state.aiBlocked) {
    addMsg("bot", s.provider === "groq" ? "Claude n'est pas disponible : je passe sur l'IA gratuite (Groq) en attendant." : "Je repasse sur Claude.", "info");
  }
}

async function loadStatus() {
  try {
    applyStatus(await api("/api/status"));
    if (state.offline) {
      state.offline = false;
      toast("Reconnecté au serveur Jarvis.");
      refreshAll();
      refreshMusic();
    }
  } catch {
    if (!state.offline) {
      state.offline = true;
      toast("Le serveur Jarvis ne répond plus. Relance Jarvis depuis le raccourci du Bureau.", true);
    }
  }
  idleMode();
}

// L'IA vient d'être débloquée : on retire l'avertissement et on le signale (une seule fois).
function onAiReady(provider) {
  if (!state.aiBlocked) return;
  state.aiBlocked = false;
  if (state.noKeyMsg) {
    state.noKeyMsg.remove();
    state.noKeyMsg = null;
  }
  addMsg("bot", provider === "groq" ? "C'est réglé : l'IA gratuite est prête. Que puis-je faire pour toi ?" : "C'est réglé : Claude fonctionne. Que puis-je faire pour toi ?");
  toast("IA opérationnelle.");
}

// Affiche (ou remplace) l'avertissement qui explique pourquoi l'IA ne peut pas répondre.
function showAiWarning(text) {
  if (state.noKeyMsg) state.noKeyMsg.remove();
  state.noKeyMsg = addMsg("bot", text, "error");
}

function setConn(sel, info, service) {
  const row = $(sel);
  const btn = row.querySelector("button");
  const label = service === "google" ? "Google" : "Spotify";
  row.className = "conn " + (info.connected ? "ok" : info.configured ? "warn" : "");
  btn.textContent = info.connected ? "Déconnecter" : "Connecter";
  btn.title = info.connected ? `Déconnecter ${label}` : info.configured ? `Connecter ton compte ${label}` : `Renseigne d'abord les identifiants ${label} dans les réglages`;
  btn.onclick = async () => {
    if (info.connected) {
      if (!confirm(`Déconnecter ${label} ? Il faudra te reconnecter pour retrouver ces infos.`)) return;
      try {
        await api(`/auth/${service}/logout`, { method: "POST" });
      } catch (e) {
        return toast(e.message, true);
      }
      await loadStatus();
      refreshAll();
      refreshMusic();
    } else if (!info.configured) {
      toast(`Renseigne d'abord le Client ID et le Client secret ${label} dans les réglages.`, true);
      openSettings(label);
    } else {
      location.href = `/auth/${service}`;
    }
  };
}

// Discord : pas de connexion de compte, juste un bot à inviter sur ses serveurs.
function setDiscordConn(d) {
  if (!d) return;
  const row = $("#connDiscord");
  const btn = row.querySelector("button");
  row.className = "conn " + (!d.configured || d.ok === false ? "" : d.ok ? "ok" : "warn");
  row.title = !d.configured ? "Ajoute le jeton de ton bot Discord dans les réglages." : d.ok === false ? d.message : d.bot ? `Bot « ${d.bot} »` : "Vérification…";
  const canInvite = d.configured && d.ok && d.invite;
  btn.textContent = canInvite ? "Inviter" : "Régler";
  btn.title = canInvite ? "Ajouter ton bot à un de tes serveurs Discord" : "Régler Discord";
  btn.onclick = () => (canInvite ? openExternal(d.invite) : openSettings());
}

function updateCost(u) {
  if (!u) return;
  $("#costValue").textContent = u.cost.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " $";
  $("#cost").title = `Coût IA (Claude) depuis le démarrage : ${u.input} jetons envoyés, ${u.output} reçus, ${u.searches} recherches web` + (u.freeRequests ? `\nIA gratuite : ${u.freeRequests} requêtes (0 $)` : "");
}

// ---------- Widgets ----------
const emptyLi = (text) => el("li", "empty", text);

function renderList(ul, result, renderItem, emptyText) {
  ul.replaceChildren();
  if (result.error === "not_connected") return ul.append(emptyLi("Connecte Google pour voir ça."));
  if (result.error) return ul.append(emptyLi(result.error));
  if (!result.data.length) return ul.append(emptyLi(emptyText));
  result.data.forEach((item) => ul.append(renderItem(item)));
}

function renderWeatherInto(box, w) {
  box.replaceChildren();
  if (!w) return (box.textContent = "Chargement…");
  if (w.error) return (box.textContent = "Météo indisponible : " + w.error);
  const d = w.data;
  const now = el("div", "w-now");
  const ic = el("div", "w-icon");
  ic.append(iconEl(d.now.icon, 44));
  const info = el("div");
  info.append(el("div", "w-temp", `${d.now.temp}°`));
  info.append(el("div", "w-desc", `${d.now.description}, ressenti ${d.now.feelsLike}°`));
  info.append(withIcon("div", "w-desc inline-ic", "wind", `${d.city} · ${d.now.wind} km/h`, 12));
  now.append(ic, info);
  const days = el("div", "w-days");
  d.days.forEach((day, i) => {
    const c = el("div", "w-day");
    const label = i === 0 ? "auj." : parseDate(day.date).toLocaleDateString("fr-FR", { weekday: "short" });
    c.append(el("b", null, label), iconEl(day.icon, 20), document.createTextNode(`${day.min}° / ${day.max}°`));
    c.title = `${day.description}${day.rain != null ? `, ${day.rain} % de risque de pluie` : ""}`;
    days.append(c);
  });
  box.append(now, days);
}

function renderMemoryInto(ul, mem) {
  ul.replaceChildren();
  if (!mem) return ul.append(emptyLi("Chargement…"));
  if (!mem.length) return ul.append(emptyLi("Rien en mémoire pour l'instant."));
  mem.forEach((m, i) => {
    const li = el("li");
    li.append(el("span", null, m));
    const x = el("button", "x-btn");
    x.append(iconEl("x", 14));
    x.title = "Oublier";
    x.onclick = async () => {
      try {
        const r = await api(`/api/memory/${i}?text=${encodeURIComponent(m)}`, { method: "DELETE" });
        if (cache.dashboard) cache.dashboard.memory = r.memory;
        renderMemoryInto($("#memory"), r.memory);
        emit("data");
      } catch (e) {
        toast(e.message, true);
      }
    };
    li.append(x);
    ul.append(li);
  });
}

function eventItem(e) {
  const li = el("li");
  li.append(el("div", "when", fmtWhen(e.start, e.allDay)));
  li.append(el("div", "t", e.title));
  if (e.location) li.append(withIcon("div", "s", "pin", e.location, 12));
  return li;
}

function mailItem(m) {
  const li = el("li", "clickable");
  li.append(el("div", "t", senderName(m.from)));
  li.append(el("div", "s", m.subject));
  li.title = "Clique pour que je te le résume.\n\n" + m.snippet;
  li.onclick = () => send(`Résume-moi le mail de ${senderName(m.from)} intitulé "${m.subject}" (id ${m.id}).`);
  return li;
}

function taskItem(t) {
  const li = el("li", "task");
  const cb = el("input");
  cb.type = "checkbox";
  cb.title = "Marquer comme fait";
  cb.onchange = async () => {
    cb.disabled = true;
    li.style.opacity = 0.4;
    try {
      await api(`/api/tasks/${encodeURIComponent(t.id)}/complete`, { method: "POST" });
      setTimeout(refreshAll, 400);
    } catch (e) {
      toast(e.message, true);
      li.style.opacity = 1;
      cb.checked = false;
      cb.disabled = false;
    }
  };
  const txt = el("div");
  txt.append(el("div", "t", t.title));
  // Google Tasks stocke l'échéance à minuit UTC : on l'affiche donc en UTC pour garder le bon jour.
  if (t.due) txt.append(el("div", "when", "Pour " + new Date(t.due).toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })));
  li.append(cb, txt);
  return li;
}

const LISTS = {
  events: [eventItem, "Rien de prévu cette semaine."],
  emails: [mailItem, "Boîte de réception à jour."],
  tasks: [taskItem, "Aucune tâche en cours."],
};
// kind : "events" | "emails" | "tasks"
function renderListInto(ul, kind) {
  const result = cache.dashboard?.[kind];
  if (!result) {
    ul.replaceChildren(emptyLi("Chargement…"));
    return;
  }
  renderList(ul, result, ...LISTS[kind]);
}

let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  try {
    const d = await api("/api/dashboard");
    cache.dashboard = d;
    applyStatus(d.status);
    renderWeatherInto($("#weather"), d.weather);
    renderMemoryInto($("#memory"), d.memory);
    renderListInto($("#events"), "events");
    renderListInto($("#emails"), "emails");
    renderListInto($("#tasks"), "tasks");
    emit("data");
  } catch (e) {
    console.error(e);
  } finally {
    refreshing = false;
  }
}

// Menu "Mes playlists" + "Titres likés", gardé entre deux rafraîchissements (le menu ne se ferme pas tout seul).
const spotifyLib = { playlists: null, loading: false };
async function loadPlaylists() {
  if (spotifyLib.playlists || spotifyLib.loading) return;
  spotifyLib.loading = true;
  try {
    spotifyLib.playlists = (await api("/api/spotify/playlists")).playlists;
    document.querySelectorAll(".sp-lib").forEach(fillPlaylistSelect);
  } catch {
    spotifyLib.playlists = null;
  } finally {
    spotifyLib.loading = false;
  }
  if (spotifyLib.playlists) emit("music"); // les widgets se redessinent une fois, avec les playlists
}
function fillPlaylistSelect(lib) {
  const sel = lib.querySelector("select");
  if (!spotifyLib.playlists || sel.dataset.filled) return;
  for (const p of spotifyLib.playlists) {
    const o = el("option", null, p.name + (p.tracks != null ? ` (${p.tracks})` : ""));
    o.value = p.name;
    sel.append(o);
  }
  sel.dataset.filled = "1";
}
function buildSpotifyLib() {
  const lib = el("div", "sp-lib");
  const sel = el("select");
  const first = el("option", null, "Mes playlists…");
  first.value = "";
  sel.append(first);
  sel.onchange = async () => {
    if (!sel.value) return;
    const name = sel.value;
    sel.value = "";
    try {
      await api("/api/spotify/play", { method: "POST", body: { playlist: name } });
      toast(`Lecture : ${name}`);
      setTimeout(refreshMusic, 800);
    } catch (e) {
      toast(e.message, true);
    }
  };
  const liked = el("button", "proj-link");
  liked.type = "button";
  liked.title = "Lancer tes titres likés (aléatoire)";
  liked.append(iconEl("heart", 14), document.createTextNode("Titres likés"));
  liked.onclick = async () => {
    try {
      await api("/api/spotify/play", { method: "POST", body: { liked: true } });
      toast("Lecture : tes titres likés");
      setTimeout(refreshMusic, 800);
    } catch (e) {
      toast(e.message, true);
    }
  };
  lib.append(sel, liked);
  fillPlaylistSelect(lib);
  return lib;
}

function renderMusicInto(box, r) {
  const keptLib = box.querySelector(".sp-lib");
  const withLib = () => {
    const sp = state.status?.spotify;
    if (!sp?.connected) return;
    if (!sp.scopesOk) {
      box.append(el("div", "hint", "Pour tes playlists et titres likés : Déconnecter puis Connecter Spotify (nouvelles autorisations)."));
      return;
    }
    loadPlaylists();
    box.append(keptLib || buildSpotifyLib());
  };
  box.replaceChildren();
  if (!r) return (box.textContent = "Chargement…");
  if (r.error === "not_connected") return (box.textContent = "Connecte Spotify pour voir et contrôler ta musique.");
  if (r.error) {
    box.textContent = r.error;
    return withLib();
  }
  const m = r.data;
  if (!m.title) {
    const sp = state.status?.spotify;
    box.textContent = sp && !sp.playerAllowed
      ? "Pour que la musique sorte de Jarvis : Déconnecter puis Connecter Spotify (nouvelle autorisation « lecture »)."
      : sp?.playerReady
        ? "Lecteur Jarvis prêt : dis « joue » suivi d'un titre ou d'un artiste."
        : "Rien en lecture. Demande-moi de mettre de la musique.";
    return withLib();
  }
  const np = el("div", "np");
  if (m.image) {
    const img = el("img");
    img.src = m.image;
    img.alt = "";
    np.append(img);
  }
  const meta = el("div", "meta");
  meta.append(el("div", "title", m.title), el("div", "artist", m.artist));
  if (m.device) meta.append(withIcon("div", "artist", "speaker", m.device, 12));
  np.append(meta);
  // Timeline : on peut cliquer ou glisser pour avancer dans le morceau.
  const bar = el("div", "sp-time");
  const seek = el("input", "sp-seek");
  seek.type = "range";
  seek.min = 0;
  seek.max = m.durationMs || 0;
  seek.step = 1000;
  seek.disabled = !m.durationMs;
  seek.oninput = () => {
    seek.dataset.dragging = "1";
    bar.querySelector(".sp-cur").textContent = fmtMs(Number(seek.value));
    paintSeek(seek);
  };
  seek.onchange = async () => {
    const pos = Number(seek.value);
    delete seek.dataset.dragging;
    if (cache.music?.data) Object.assign(cache.music.data, { progressMs: pos }), (cache.music.at = Date.now());
    try {
      await api("/api/music/seek", { method: "POST", body: { value: pos } });
      setTimeout(refreshMusic, 600);
    } catch (e) {
      toast(e.message, true);
    }
  };
  bar.append(el("span", "sp-cur"), seek, el("span", "sp-dur", fmtMs(m.durationMs)));
  const controls = el("div", "controls");
  [["previous", "prev", "Précédent"], [m.playing ? "pause" : "play", m.playing ? "pause" : "play", m.playing ? "Pause" : "Lecture"], ["next", "next", "Suivant"]].forEach(([cmd, ic, title]) => {
    const b = el("button");
    b.title = title;
    b.append(iconEl(ic, 16));
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api(`/api/music/${cmd}`, { method: "POST" });
        setTimeout(refreshMusic, 500);
      } catch (e) {
        toast(e.message, true);
        b.disabled = false;
      }
    };
    controls.append(b);
  });
  box.append(np, bar, controls);
  tickTimelines();
  withLib();
}

const fmtMs = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}` : "0:00");
const paintSeek = (s) => s.style.setProperty("--p", `${s.max > 0 ? (100 * s.value) / s.max : 0}%`);

// Fait avancer toutes les timelines chaque seconde (sans redemander à Spotify).
function tickTimelines() {
  const m = cache.music?.data;
  if (!m?.durationMs) return;
  const pos = Math.min(m.durationMs, m.progressMs + (m.playing ? Date.now() - (cache.music.at || Date.now()) : 0));
  document.querySelectorAll(".sp-time").forEach((bar) => {
    const seek = bar.querySelector(".sp-seek");
    if (seek.dataset.dragging) return;
    seek.value = pos;
    paintSeek(seek);
    bar.querySelector(".sp-cur").textContent = fmtMs(pos);
  });
  // Morceau terminé : on demande le suivant à Spotify.
  if (m.playing && pos >= m.durationMs && Date.now() - (cache.music.at || 0) > 1500) refreshMusic();
}
setInterval(() => !document.hidden && tickTimelines(), 1000);

async function refreshMusic() {
  try {
    cache.music = await api("/api/music");
    cache.music.at = Date.now(); // pour faire avancer la timeline entre deux mises à jour
    renderMusicInto($("#music"), cache.music);
    emit("music");
  } catch {
    // Serveur injoignable : loadStatus s'en charge.
  }
}

// ---------- Chat ----------
function scrollChat() {
  $("#chat").scrollTop = $("#chat").scrollHeight;
}

function addMsg(role, text, extraClass = "") {
  const m = el("div", `msg ${role} ${extraClass}`.trim(), text);
  if (role === "bot") m.dataset.name = state.name.toUpperCase();
  $("#chat").append(m);
  scrollChat();
  return m;
}

function addTyping() {
  const m = el("div", "msg bot typing");
  m.dataset.name = state.name.toUpperCase();
  m.append(el("span"), el("span"), el("span"));
  $("#chat").append(m);
  scrollChat();
  return m;
}

// ---------- Images jointes ----------
state.attachments = [];
const MAX_ATTACH = 3;

// Réduit l'image (1280 px max) pour un envoi rapide et peu coûteux.
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height)); // assez grand pour lire une capture d'écran
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function addAttachments(files) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  if (!images.length) return;
  for (const f of images) {
    if (state.attachments.length >= MAX_ATTACH) {
      toast(`${MAX_ATTACH} images maximum par message.`, true);
      break;
    }
    try {
      state.attachments.push(await shrinkImage(f));
    } catch {
      toast(`Image illisible : ${f.name || "image"}`, true);
    }
  }
  renderAttachments();
  $("#input").focus();
}

function renderAttachments() {
  const strip = $("#attachStrip");
  strip.replaceChildren();
  state.attachments.forEach((src, i) => {
    const item = el("div", "attach-item");
    const img = el("img");
    img.src = src;
    img.alt = "Image jointe";
    const x = el("button", "attach-x");
    x.type = "button";
    x.title = "Retirer";
    x.append(iconEl("x", 12));
    x.onclick = () => {
      state.attachments.splice(i, 1);
      renderAttachments();
    };
    item.append(img, x);
    strip.append(item);
  });
  strip.hidden = !state.attachments.length;
}

$("#attachBtn").addEventListener("click", () => $("#attachInput").click());
$("#attachInput").addEventListener("change", (e) => {
  addAttachments(e.target.files);
  e.target.value = "";
});
// Coller une image (capture d'écran, etc.) quand on est sur la page Assistant.
document.addEventListener("paste", (e) => {
  if (document.querySelector("#pageAssistant")?.inert) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    e.preventDefault();
    addAttachments(files);
  }
});
// Glisser-déposer sur la page Assistant.
const dropZone = document.querySelector("#pageAssistant");
dropZone.addEventListener("dragover", (e) => {
  if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) {
    e.preventDefault();
    dropZone.classList.add("dropping");
  }
});
dropZone.addEventListener("dragleave", (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove("dropping");
});
dropZone.addEventListener("drop", (e) => {
  dropZone.classList.remove("dropping");
  if (e.dataTransfer?.files?.length) {
    e.preventDefault();
    addAttachments(e.dataTransfer.files);
  }
});

// Retourne false si la demande n'a pas pu partir (Jarvis déjà occupé).
function send(text) {
  text = (text || "").trim();
  if (!text && !state.attachments.length) return true;
  if (state.busy) {
    toast("Patiente une seconde, je termine ma réponse.");
    return false;
  }
  const images = state.attachments.splice(0);
  renderAttachments();
  ask(text || "Décris cette image.", images);
  return true;
}

async function ask(text, images = []) {
  state.busy = true;
  stopSpeaking();
  const userBubble = addMsg("user", text);
  if (images.length) {
    const row = el("div", "msg-images");
    images.forEach((src) => {
      const img = el("img");
      img.src = src;
      img.alt = "Image jointe";
      row.append(img);
    });
    userBubble.prepend(row);
  }
  const entry = { role: "user", content: text, images: images.length ? images : undefined };
  state.history.push(entry);
  const typing = addTyping();
  setMode("thinking");
  try {
    const r = await api("/api/chat", { method: "POST", body: { history: state.history } });
    // Les images ne sont envoyées qu'une fois : ensuite on garde juste une mention dans l'historique.
    if (entry.images) {
      delete entry.images;
      entry.content += ` [${images.length} image(s) jointe(s)]`;
    }
    typing.remove();
    const bubble = addMsg("bot", r.reply);
    // Petite étiquette quand c'est l'IA gratuite qui a répondu.
    if (r.provider === "groq") bubble.dataset.name = state.name.toUpperCase() + " · IA GRATUITE";
    state.history.push({ role: "assistant", content: r.reply });
    state.history = state.history.slice(-30);
    state.lastReply = { text: r.reply, provider: r.provider };
    emit("reply");
    updateCost(r.usage);
    for (const a of r.actions || []) {
      try {
        handleAction(a);
      } catch (e) {
        console.error("Action impossible", a, e);
      }
    }
    state.busy = false;
    speak(r.reply);
  } catch (e) {
    typing.remove();
    addMsg("bot", e.message, "error");
    state.history.pop();
    // On remet les images dans la zone d'envoi pour pouvoir réessayer.
    if (images.length && !state.attachments.length) {
      state.attachments = images;
      renderAttachments();
    }
    state.busy = false;
    idleMode();
  } finally {
    state.busy = false;
    if (state.wakeOn && !recMode) startWake();
    loadStatus(); // met à jour le voyant de l'IA (clé validée ou refusée)
  }
}

function handleAction(a) {
  switch (a.type) {
    case "refresh":
    case "refresh_memory":
      refreshAll();
      break;
    case "refresh_music":
      setTimeout(refreshMusic, 700);
      break;
    case "timer":
      startTimer(a.seconds, a.label);
      break;
    case "open_url": {
      const url = new URL(a.url);
      if (!["http:", "https:"].includes(url.protocol)) break;
      // Ouvert dans l'onglet Web de Jarvis (ou proposé dans une fenêtre si le site refuse).
      if (window.openInJarvis) {
        window.openInJarvis(url.href);
        break;
      }
      const w = window.open(url.href, "_blank", "noopener");
      if (!w) {
        // Fenêtre bloquée par le navigateur : on affiche un lien à la place.
        const card = el("div", "msg bot link-card");
        card.dataset.name = state.name.toUpperCase();
        const link = el("a", "inline-ic", "Ouvrir " + url.hostname);
        link.append(iconEl("external", 14));
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener";
        card.append(link);
        $("#chat").append(card);
        scrollChat();
      }
      break;
    }
    case "email_draft":
      showDraft(a);
      break;
    case "discord_draft":
      showDiscordDraft(a);
      break;
    case "images":
      showFoundImages(a);
      break;
    case "image":
      showGeneratedImage(a);
      emit("images");
      break;
    case "youtube":
      // La recherche est gardée dans l'adresse : les autres résultats s'affichent sous la vidéo.
      if (window.openInJarvis) window.openInJarvis(`https://www.youtube.com/watch?${new URLSearchParams({ v: a.id, search_query: a.query || "" })}`);
      break;
  }
}

function showDraft(a) {
  const node = $("#emailDraftTpl").content.firstElementChild.cloneNode(true);
  hydrateIcons(node);
  node.querySelector(".d-to").value = a.to;
  node.querySelector(".d-subject").value = a.subject;
  node.querySelector(".d-body").value = a.body;
  const sendBtn = node.querySelector(".d-send");
  const cancelBtn = node.querySelector(".d-cancel");
  sendBtn.onclick = async () => {
    sendBtn.disabled = cancelBtn.disabled = true;
    sendBtn.textContent = "Envoi…";
    try {
      const to = node.querySelector(".d-to").value.trim();
      await api(`/api/email/${a.id}/send`, {
        method: "POST",
        body: { to, subject: node.querySelector(".d-subject").value, body: node.querySelector(".d-body").value },
      });
      node.replaceChildren(withIcon("div", "draft-title", "check", "Mail envoyé à " + to, 15));
      state.history.push({ role: "user", content: "(J'ai confirmé et envoyé le mail.)" });
      state.history.push({ role: "assistant", content: "Mail envoyé." });
    } catch (e) {
      toast(e.message, true);
      sendBtn.disabled = cancelBtn.disabled = false;
      sendBtn.textContent = "Envoyer";
    }
  };
  cancelBtn.onclick = async () => {
    await api(`/api/email/${a.id}/cancel`, { method: "POST" }).catch(() => {});
    node.replaceChildren(withIcon("div", "draft-title", "x", "Mail annulé.", 15));
    state.history.push({ role: "user", content: "(J'ai annulé ce mail.)" });
    state.history.push({ role: "assistant", content: "Mail annulé." });
  };
  $("#chat").append(node);
  scrollChat();
}

// Photos trouvées sur internet : petite galerie dans le chat.
function showFoundImages(a) {
  const card = el("div", "msg bot found-images");
  card.dataset.name = state.name.toUpperCase() + " · IMAGES";
  const grid = el("div", "found-grid");
  for (const it of a.items) {
    const fig = el("button", "found-item");
    fig.type = "button";
    fig.title = `${it.title} — ${it.source}`;
    const img = el("img");
    img.src = it.url;
    img.alt = it.title;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => fig.remove();
    img.onload = scrollChat;
    img.dataset.link = it.link || it.url;
    img.dataset.caption = `${it.title} — ${it.source}`;
    fig.append(img, el("span", null, it.source));
    grid.append(fig);
  }
  card.append(grid);
  $("#chat").append(card);
  scrollChat();
}

// Image créée par Jarvis : affichée dans le chat.
function showGeneratedImage(a) {
  const card = el("div", "msg bot gen-image");
  card.dataset.name = state.name.toUpperCase() + " · IMAGE";
  const img = el("img");
  img.src = a.url;
  img.alt = a.prompt;
  img.title = a.prompt;
  img.onload = scrollChat;
  const actions = el("div", "gen-actions");
  const open = el("button", "proj-link");
  open.type = "button";
  open.append(iconEl("external", 14), document.createTextNode("Agrandir"));
  open.onclick = () => img.click();
  const dl = el("a", "proj-link");
  dl.href = a.url;
  dl.download = "jarvis-image.jpg";
  dl.append(iconEl("arrow-up", 14), document.createTextNode("Télécharger"));
  dl.querySelector(".ic").style.transform = "rotate(180deg)";
  actions.append(open, dl);
  card.append(img, actions);
  $("#chat").append(card);
  scrollChat();
}

// Message Discord préparé par l'IA : envoyé seulement après clic.
function showDiscordDraft(a) {
  const node = el("div", "draft");
  node.append(withIcon("div", "draft-title", "message", `Message Discord pour ${a.channel}. Vérifie avant d'envoyer.`, 15));
  const text = el("textarea", "d-body");
  text.rows = 4;
  text.value = a.content;
  const actions = el("div", "draft-actions");
  const cancel = el("button", "btn ghost", "Annuler");
  const ok = el("button", "btn", "Envoyer");
  cancel.type = ok.type = "button";
  ok.onclick = async () => {
    ok.disabled = cancel.disabled = true;
    try {
      await api(`/api/discord/draft/${a.id}/send`, { method: "POST", body: { content: text.value } });
      node.replaceChildren(withIcon("div", "draft-title", "check", `Message envoyé sur ${a.channel}`, 15));
      emit("discord");
    } catch (e) {
      toast(e.message, true);
      ok.disabled = cancel.disabled = false;
    }
  };
  cancel.onclick = async () => {
    await api(`/api/discord/draft/${a.id}/cancel`, { method: "POST" }).catch(() => {});
    node.replaceChildren(withIcon("div", "draft-title", "x", "Message Discord annulé.", 15));
  };
  actions.append(cancel, ok);
  node.append(text, actions);
  $("#chat").append(node);
  scrollChat();
}

// ---------- Minuteurs (gardés même si on ferme la fenêtre) ----------
let timers = [];
try {
  timers = JSON.parse(localStorage.getItem("timers") || "[]").filter((t) => t && typeof t.end === "number");
} catch {
  timers = [];
}
const saveTimers = () => localStorage.setItem("timers", JSON.stringify(timers));

function startTimer(seconds, label) {
  timers.push({ end: Date.now() + seconds * 1000, label: String(label || "Minuteur").slice(0, 60) });
  saveTimers();
  renderTimers();
}
function renderTimers() {
  $("#timersPanel").hidden = timers.length === 0;
  renderTimersInto($("#timers"));
  emit("timers");
}
function renderTimersInto(ul) {
  ul.replaceChildren();
  timers.forEach((t) => {
    const left = Math.max(0, Math.round((t.end - Date.now()) / 1000));
    const li = el("li", "timer");
    li.append(el("span", null, t.label));
    const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    li.append(el("span", "left", (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0")));
    const x = el("button", "x-btn");
    x.append(iconEl("x", 14));
    x.title = "Annuler";
    x.onclick = () => {
      timers = timers.filter((o) => o !== t);
      saveTimers();
      renderTimers();
    };
    li.append(x);
    ul.append(li);
  });
}
function checkTimers(fromStartup = false) {
  const due = timers.filter((t) => Date.now() >= t.end);
  if (!due.length) return;
  timers = timers.filter((t) => !due.includes(t));
  saveTimers();
  for (const t of due) {
    const late = fromStartup && Date.now() - t.end > 5000;
    const msg = late ? `${t.label} : terminé pendant que la fenêtre était fermée.` : `${t.label} : c'est l'heure !`;
    if (!late) beep();
    addMsg("bot", msg).prepend(iconEl("timer", 16));
    if (!late) speak(msg, true);
    toast(msg);
  }
}
setInterval(() => {
  checkTimers();
  if (timers.length || !$("#timersPanel").hidden) renderTimers();
}, 1000);

function tone(freq, delays, duration, volume) {
  try {
    const ctx = new AudioContext();
    delays.forEach((delay) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.connect(g).connect(ctx.destination);
      g.gain.setValueAtTime(volume, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + duration);
    });
    setTimeout(() => ctx.close(), (Math.max(...delays) + duration) * 1000 + 200);
  } catch {}
}
const beep = () => tone(880, [0, 0.25, 0.5], 0.2, 0.25);
const beepShort = () => tone(1200, [0], 0.15, 0.15);

// ---------- Voix : synthèse ----------
let frVoice = null;
// Réglages de voix (gardés sur ce PC) : voix choisie, vitesse, ton (grave = plus "majordome").
const voicePrefs = Object.assign({ name: "", rate: 1.05, pitch: 0.75 }, JSON.parse(localStorage.getItem("voicePrefs") || "{}"));
const saveVoicePrefs = () => localStorage.setItem("voicePrefs", JSON.stringify(voicePrefs));
function pickVoice() {
  const all = speechSynthesis.getVoices();
  const chosen = voicePrefs.name && all.find((v) => v.name === voicePrefs.name);
  if (chosen) return (frVoice = chosen);
  const voices = all.filter((v) => v.lang.toLowerCase().startsWith("fr"));
  // Préférence pour les voix "naturelles" quand elles existent.
  frVoice =
    voices.find((v) => /natural|online/i.test(v.name) && /henri|paul|remy|male|homme/i.test(v.name)) ||
    voices.find((v) => /natural|online/i.test(v.name)) ||
    voices.find((v) => /google/i.test(v.name)) ||
    voices[0] ||
    null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

let speakId = 0;
function speak(text, force = false) {
  if (!("speechSynthesis" in window) || (!state.voiceOn && !force)) return idleMode();
  const clean = text.replace(/[*_#`>]/g, "").replace(/https?:\/\/\S+/g, "le lien").trim();
  if (!clean) return idleMode();
  // Chrome coupe les longues phrases (environ 15 s) : on lit le texte morceau par morceau.
  const parts = [];
  let cur = "";
  for (const piece of clean.match(/[^.!?…\n]+[.!?…]*\s*|\n+/g) || [clean]) {
    if (cur && (cur + piece).length > 180) {
      parts.push(cur);
      cur = piece;
    } else cur += piece;
  }
  if (cur.trim()) parts.push(cur);
  const id = ++speakId;
  speechSynthesis.cancel();
  state.speaking = true;
  setMode("speaking");
  const done = () => {
    if (id !== speakId) return;
    state.speaking = false;
    idleMode();
  };
  // Petit délai : Chrome ignore parfois une lecture lancée juste après cancel().
  setTimeout(() => {
    if (id !== speakId) return;
    parts.forEach((p, i) => {
      if (!p.trim()) return;
      const u = new SpeechSynthesisUtterance(p.trim());
      u.lang = "fr-FR";
      if (frVoice) u.voice = frVoice;
      u.rate = voicePrefs.rate;
      u.pitch = voicePrefs.pitch;
      if (i === parts.length - 1) u.onend = done;
      u.onerror = (e) => e.error !== "interrupted" && e.error !== "canceled" && done();
      speechSynthesis.speak(u);
    });
  }, 60);
  // Filet de sécurité si le navigateur n'envoie jamais "fin".
  setTimeout(done, Math.max(4000, clean.length * 120));
}
function stopSpeaking() {
  speakId++;
  state.speaking = false;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function renderVoiceToggle() {
  $("#voiceToggle").classList.toggle("off", !state.voiceOn);
  $("#voiceToggle").title = state.voiceOn ? "Voix activée (clique pour couper)" : "Voix coupée (clique pour réactiver)";
  $("#voiceToggle").replaceChildren(iconEl(state.voiceOn ? "volume" : "volume-x"));
}
$("#voiceToggle").onclick = () => {
  state.voiceOn = !state.voiceOn;
  localStorage.setItem("voiceOn", state.voiceOn ? "1" : "0");
  renderVoiceToggle();
  if (!state.voiceOn) {
    stopSpeaking();
    idleMode();
  }
};

// ---------- Voix : reconnaissance ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let recMode = null; // "command" | "wake"
let awaitingCommand = false;
let wakeErrors = 0;

const MIC_ERRORS = {
  "not-allowed": "Autorise le micro (icône à gauche de la barre d'adresse ou paramètres de Windows).",
  "service-not-allowed": "La reconnaissance vocale est bloquée par le navigateur.",
  "audio-capture": "Aucun micro détecté. Branche un micro puis réessaie.",
  network: "La reconnaissance vocale a besoin d'internet.",
};

function newRecognizer(continuous) {
  const r = new SR();
  r.lang = "fr-FR";
  r.interimResults = true;
  r.continuous = continuous;
  return r;
}

function startCommand() {
  if (!SR) return toast("La reconnaissance vocale nécessite Chrome ou Edge.", true);
  if (state.busy) return toast("Patiente une seconde, je termine ma réponse.");
  stopRecognition();
  stopSpeaking();
  recMode = "command";
  const r = newRecognizer(false);
  rec = r;
  let finalText = "";
  r.onresult = (e) => {
    let interim = "";
    for (const res of e.results) {
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    $("#input").value = (finalText + interim).trim();
  };
  r.onerror = (e) => {
    if (MIC_ERRORS[e.error]) toast(MIC_ERRORS[e.error], true);
    else if (e.error === "no-speech") toast("Je n'ai rien entendu.");
  };
  r.onend = () => {
    if (rec === r) rec = null;
    $("#micBtn").classList.remove("on");
    state.listening = false;
    recMode = null;
    idleMode();
    const text = $("#input").value.trim();
    if (text && send(text)) $("#input").value = "";
    if (state.wakeOn) setTimeout(startWake, 400);
  };
  try {
    r.start();
  } catch {
    recMode = null;
    return toast("Le micro est déjà utilisé. Réessaie dans un instant.", true);
  }
  state.listening = true;
  $("#micBtn").classList.add("on");
  setMode("listening");
}

// Mot de réveil : tolérant aux petites erreurs de transcription ("Jervis", "Jarvisse"…).
const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
function wakeVariants() {
  const n = normalize(state.name);
  const v = new Set([n]);
  if (n === "jarvis") ["jarvi", "jervis", "jarviss", "jarvisse", "djarvis", "charvis", "jarvice", "garvis"].forEach((x) => v.add(x));
  return v;
}
// Retourne la commande prononcée après le nom, "" si on a juste dit le nom, null si absent.
function extractCommand(transcript) {
  const words = transcript.trim().split(/\s+/);
  const norm = words.map(normalize);
  const targets = wakeVariants();
  for (let i = 0; i < words.length; i++) {
    let skip = 0;
    if (targets.has(norm[i])) skip = 1;
    else if (i + 1 < words.length && targets.has(norm[i] + norm[i + 1])) skip = 2;
    if (skip) return words.slice(i + skip).join(" ").replace(/^[\s,.!?;:]+/, "").trim();
  }
  return null;
}

// Écoute permanente : réagit quand on prononce le nom de l'assistant.
function startWake() {
  if (!SR || !state.wakeOn || recMode) return;
  recMode = "wake";
  const r = newRecognizer(true);
  rec = r;
  r.onresult = (e) => {
    // On ignore ce que l'on entend pendant que Jarvis réfléchit ou parle (sinon il s'entend lui-même).
    if (state.busy || state.speaking) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const transcript = res[0].transcript;
      if (!res.isFinal) {
        if (extractCommand(transcript) !== null) setMode("listening");
        continue;
      }
      wakeErrors = 0;
      if (awaitingCommand) {
        awaitingCommand = false;
        send(transcript);
        continue;
      }
      const command = extractCommand(transcript);
      if (command === null) {
        idleMode();
      } else if (command.length > 2) {
        send(command);
      } else {
        awaitingCommand = true;
        beepShort();
        setMode("listening");
        setTimeout(() => {
          if (awaitingCommand) {
            awaitingCommand = false;
            idleMode();
          }
        }, 8000);
      }
    }
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
      state.wakeOn = false;
      $("#wakeToggle").classList.remove("on");
      toast(MIC_ERRORS[e.error], true);
    } else if (e.error !== "no-speech" && e.error !== "aborted") {
      wakeErrors++;
    }
  };
  r.onend = () => {
    if (rec === r) rec = null;
    if (recMode === "wake") recMode = null;
    // Relance automatique, en ralentissant s'il y a des erreurs (ex : pas d'internet).
    if (state.wakeOn) setTimeout(startWake, wakeErrors ? Math.min(30000, 2000 * wakeErrors) : 300);
  };
  try {
    r.start();
  } catch {
    recMode = null;
  }
  idleMode();
}

function stopRecognition() {
  if (rec) {
    const r = rec;
    rec = null;
    recMode = null;
    r.onend = null;
    r.onresult = null;
    try {
      r.abort();
    } catch {}
  }
  state.listening = false;
  $("#micBtn").classList.remove("on");
}

$("#wakeToggle").onclick = () => {
  if (!SR) return toast("L'écoute permanente nécessite Chrome ou Edge.", true);
  state.wakeOn = !state.wakeOn;
  $("#wakeToggle").classList.toggle("on", state.wakeOn);
  $("#wakeToggle").title = state.wakeOn ? "Écoute permanente activée (clique pour l'arrêter)" : "Écoute permanente du mot de réveil";
  if (state.wakeOn) {
    wakeErrors = 0;
    toast(`Écoute permanente activée : dis « ${state.name}, … »`);
    startWake();
  } else {
    awaitingCommand = false;
    stopRecognition();
    idleMode();
  }
};

const toggleMic = () => (state.listening && recMode === "command" ? rec?.stop() : startCommand());
$("#micBtn").onclick = toggleMic;
$("#reactor").onclick = toggleMic;

// Maintenir Espace (hors champ texte) pour parler.
const isTyping = () => ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
let spaceTalk = false;
document.addEventListener("keydown", (e) => {
  if (viewer.node && !viewer.node.hidden) {
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowLeft") stepViewer(-1);
    else if (e.key === "ArrowRight") stepViewer(1);
    e.preventDefault();
    return;
  }
  if (e.key === "Escape") closeSettings();
  if (e.code !== "Space" || isTyping() || !$("#settings").hidden) return;
  e.preventDefault();
  if (e.repeat || spaceTalk) return;
  // On retire le focus d'un éventuel bouton : sinon Espace le "cliquerait" en relâchant.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  spaceTalk = true;
  if (!(state.listening && recMode === "command")) startCommand();
});
document.addEventListener("keyup", (e) => {
  if (e.code !== "Space" || !spaceTalk) return;
  e.preventDefault();
  spaceTalk = false;
  if (state.listening && recMode === "command") rec?.stop();
});

// ---------- Réglages ----------
// Présentation des sections des réglages : icône, explication, lien pour obtenir la clé, état.
const SECTIONS = {
  "Intelligence artificielle": {
    title: "IA Claude", icon: "zap", desc: "Le cerveau principal : le plus malin, payant (quelques centimes).",
    link: ["Obtenir une clé", "https://platform.claude.com/settings/keys"],
    status: (s) => (!s.ai ? ["Pas de clé", "off"] : s.aiOk === false ? [s.aiReason === "credit" ? "Sans crédit" : "Clé refusée", "off"] : s.aiOk ? ["Fonctionne", "on"] : ["Vérification…", "warn"]),
  },
  "IA gratuite (Groq)": {
    title: "IA gratuite", icon: "zap", desc: "Prend le relais gratuitement (environ 1 000 requêtes par jour).",
    link: ["Créer une clé gratuite", "https://console.groq.com/keys"],
    status: (s) => (!s.free?.configured ? ["Pas de clé", "off"] : s.free.ok === false ? ["Clé refusée", "off"] : s.free.ok ? ["Fonctionne", "on"] : ["Vérification…", "warn"]),
  },
  Personnalisation: { title: "Personnalisation", icon: "user", desc: "Nom de l'assistant, ton prénom, ta ville, le moteur de recherche et les sons." },
  Google: {
    title: "Google", icon: "calendar", desc: "Agenda, Gmail et tâches. Identifiants à créer une fois (voir README).",
    link: ["Console Google Cloud", "https://console.cloud.google.com/auth/clients"],
    status: (s) => (s.google?.connected ? ["Connecté", "on"] : s.google?.configured ? ["À connecter", "warn"] : ["Non réglé", "off"]),
  },
  Spotify: {
    title: "Spotify", icon: "music", desc: "Musique dans Jarvis (Premium), tes playlists et titres likés.",
    link: ["Tableau de bord Spotify", "https://developer.spotify.com/dashboard"],
    status: (s) => (s.spotify?.connected ? (s.spotify.scopesOk ? ["Connecté", "on"] : ["À reconnecter", "warn"]) : s.spotify?.configured ? ["À connecter", "warn"] : ["Non réglé", "off"]),
  },
  YouTube: {
    title: "YouTube", icon: "youtube", desc: "Recherche de vidéos par la voix (« mets la vidéo de … »). Gratuit.",
    link: ["Activer l'API YouTube", "https://console.cloud.google.com/apis/library/youtube.googleapis.com"],
    status: (s) => (s.youtube ? ["Clé enregistrée", "on"] : ["Pas de clé", "off"]),
  },
  Discord: {
    title: "Discord", icon: "message", desc: "Ton bot lit et écrit dans tes salons.",
    link: ["Portail développeur", "https://discord.com/developers/applications"],
    status: (s) => (!s.discord?.configured ? ["Pas de jeton", "off"] : s.discord.ok === false ? ["Jeton refusé", "off"] : s.discord.ok ? ["Fonctionne", "on"] : ["Vérification…", "warn"]),
  },
};

// Section "Voix" : choix parmi les voix disponibles, vitesse, ton, et bouton Tester.
function voiceSection(nav) {
  const sec = el("section", "set-section");
  sec.id = "sec_Voix";
  const head = el("div", "set-head");
  const ic = el("div", "set-icon");
  ic.append(iconEl("volume", 20));
  const titles = el("div", "set-titles");
  titles.append(el("h4", null, "Voix de Jarvis"), el("p", null, "Choisis sa voix, sa vitesse et son ton. Astuce majordome : voix d'homme, un peu plus lente et plus grave."));
  head.append(ic, titles);
  sec.append(head);
  const voices = speechSynthesis.getVoices().sort((a, b) => (b.lang.startsWith("fr") - a.lang.startsWith("fr")) || a.name.localeCompare(b.name));
  const row = (label, control) => {
    const r = el("div", "field");
    r.append(el("label", null, label), control);
    sec.append(r);
  };
  const sel = el("select");
  const auto = el("option", null, "Automatique (meilleure voix française)");
  auto.value = "";
  sel.append(auto);
  for (const v of voices) {
    const o = el("option", null, `${v.name.replace(/^Microsoft |^Google /, "")} (${v.lang})`);
    o.value = v.name;
    sel.append(o);
  }
  sel.value = voicePrefs.name;
  sel.onchange = () => {
    voicePrefs.name = sel.value;
    saveVoicePrefs();
    pickVoice();
  };
  row("Voix", sel);
  // Préréglage "Jarvis" : voix masculine posée, un peu grave, débit vif.
  const jarvis = el("button", "proj-link set-link");
  jarvis.type = "button";
  jarvis.append(iconEl("zap", 14), document.createTextNode("Style Jarvis (1 clic)"));
  jarvis.onclick = () => {
    const fr = voices.filter((v) => v.lang.toLowerCase().startsWith("fr"));
    const male = fr.find((v) => /natural|online/i.test(v.name) && /henri|remy|paul|claude|thomas|gerard|male|homme/i.test(v.name)) || fr.find((v) => /henri|remy|paul|claude|thomas|gerard/i.test(v.name));
    Object.assign(voicePrefs, { name: male?.name || "", rate: 1.05, pitch: 0.75 });
    saveVoicePrefs();
    pickVoice();
    closeSettings();
    openSettings().then(() => speak("Système Jarvis en ligne. À votre service.", true));
  };
  sec.append(jarvis);
  const slider = (key, min, max, step, fmt) => {
    const wrap = el("div", "field-input");
    const input = el("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = voicePrefs[key];
    const val = el("span", "range-val", fmt(voicePrefs[key]));
    input.oninput = () => {
      voicePrefs[key] = Number(input.value);
      val.textContent = fmt(voicePrefs[key]);
      saveVoicePrefs();
    };
    wrap.append(input, val);
    return wrap;
  };
  row("Vitesse", slider("rate", 0.7, 1.4, 0.05, (v) => `${Math.round(v * 100)} %`));
  row("Ton", slider("pitch", 0.5, 1.5, 0.05, (v) => (v < 0.95 ? "grave" : v > 1.05 ? "aigu" : "normal") + ` (${v.toFixed(2)})`));
  const test = el("button", "proj-link set-link");
  test.type = "button";
  test.append(iconEl("volume", 14), document.createTextNode("Tester la voix"));
  test.onclick = () => speak(`Bonsoir${state.status?.userName ? " " + state.status.userName : ""}. Tous les systèmes sont opérationnels. Que puis-je faire pour vous ?`, true);
  sec.append(test);
  const navBtn = el("button", "set-nav-item");
  navBtn.type = "button";
  navBtn.append(iconEl("volume", 16), el("span", null, "Voix"));
  navBtn.onclick = () => sec.scrollIntoView({ behavior: "smooth", block: "start" });
  nav.append(navBtn);
  return sec;
}

async function openSettings(focusSection) {
  let fields;
  try {
    ({ fields } = await api("/api/settings"));
  } catch (e) {
    return toast(e.message, true);
  }
  const s = state.status || {};
  const box = $("#settingsFields");
  box.replaceChildren();
  $("#settingsError").hidden = true;
  const layout = el("div", "set-layout");
  const nav = el("nav", "set-nav");
  const content = el("div", "set-content");
  layout.append(nav, content);
  box.append(layout);

  // Résumé : combien de services sont prêts.
  const groups = [...new Set(fields.map((f) => f.group))];
  const withStatus = groups.filter((g) => SECTIONS[g]?.status);
  const ready = withStatus.filter((g) => SECTIONS[g].status(s)[1] === "on").length;
  const summary = el("div", "set-summary");
  const bar = el("div", "set-progress");
  const fill = el("span");
  fill.style.width = `${Math.round((100 * ready) / Math.max(1, withStatus.length))}%`;
  bar.append(fill);
  summary.append(el("div", "set-summary-text", `${ready} service${ready > 1 ? "s" : ""} prêt${ready > 1 ? "s" : ""} sur ${withStatus.length}`), bar);
  nav.append(summary);

  for (const group of groups) {
    const meta = SECTIONS[group] || { title: group, icon: "settings" };
    const st = meta.status ? meta.status(s) : null;
    const id = "sec_" + group.replace(/[^a-z]/gi, "");

    const navBtn = el("button", "set-nav-item");
    navBtn.type = "button";
    navBtn.append(iconEl(meta.icon, 16), el("span", null, meta.title));
    if (st) navBtn.append(el("span", "dot " + st[1]));
    navBtn.onclick = () => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      nav.querySelectorAll(".set-nav-item").forEach((b) => b.classList.toggle("active", b === navBtn));
    };
    nav.append(navBtn);

    const sec = el("section", "set-section");
    sec.id = id;
    const head = el("div", "set-head");
    const ic = el("div", "set-icon");
    ic.append(iconEl(meta.icon, 20));
    const titles = el("div", "set-titles");
    titles.append(el("h4", null, meta.title));
    if (meta.desc) titles.append(el("p", null, meta.desc));
    head.append(ic, titles);
    if (st) head.append(el("span", "pill " + st[1], st[0]));
    sec.append(head);
    if (meta.link) {
      const a = el("button", "proj-link set-link");
      a.type = "button";
      a.append(iconEl("external", 14), document.createTextNode(meta.link[0]));
      a.onclick = () => openExternal(meta.link[1]);
      sec.append(a);
    }

    for (const f of fields.filter((x) => x.group === group)) {
      const row = el("div", "field");
      const label = el("label", null, f.label);
      label.htmlFor = "set_" + f.key;
      let input;
      if (f.options) {
        input = el("select");
        f.options.forEach(([v, l]) => {
          const o = el("option", null, l);
          o.value = v;
          input.append(o);
        });
        input.value = f.options.some(([v]) => v === f.value) ? f.value : f.options[0][0];
      } else {
        input = el("input");
        input.type = f.secret ? "password" : "text";
        input.value = f.value;
        input.placeholder = f.placeholder || "";
        input.autocomplete = f.secret ? "new-password" : "off";
        input.spellcheck = false;
        if (f.max) input.maxLength = f.max;
      }
      input.id = "set_" + f.key;
      input.name = f.key;
      const wrap = el("div", "field-input");
      wrap.append(input);
      if (f.secret) {
        // Œil : afficher la clé qu'on vient de coller pour vérifier qu'elle est complète.
        const eye = el("button", "eye");
        eye.type = "button";
        eye.title = "Afficher / masquer";
        eye.textContent = "Voir";
        eye.onclick = () => {
          input.type = input.type === "password" ? "text" : "password";
          eye.textContent = input.type === "password" ? "Voir" : "Masquer";
        };
        wrap.append(eye);
      }
      row.append(label, wrap);
      if (f.help) row.append(el("div", "help", f.help));
      sec.append(row);
    }
    content.append(sec);
  }
  content.append(voiceSection(nav));
  $("#settings").hidden = false;
  const target = focusSection && [...content.querySelectorAll(".set-section")].find((x) => x.id.includes(focusSection));
  if (target) target.scrollIntoView({ block: "start" });
  nav.querySelector(".set-nav-item")?.classList.add("active");
  const key = $("#set_ANTHROPIC_API_KEY");
  if (key && !s.ai && !s.free?.configured) key.focus();
}
function closeSettings() {
  $("#settings").hidden = true;
}
$("#settingsBtn").addEventListener("click", () => openSettings());
$("#settingsClose").addEventListener("click", closeSettings);
// Fermer en cliquant à côté de la fenêtre (uniquement si le clic a commencé ET fini sur le fond).
let downOnBackdrop = false;
$("#settings").addEventListener("mousedown", (e) => (downOnBackdrop = e.target === e.currentTarget));
$("#settings").addEventListener("click", (e) => {
  if (downOnBackdrop && e.target === e.currentTarget) closeSettings();
  downOnBackdrop = false;
});
$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#settingsSave");
  const errBox = $("#settingsError");
  const values = Object.fromEntries(new FormData(e.target).entries());
  btn.disabled = true;
  btn.textContent = values.ANTHROPIC_API_KEY || values.GROQ_API_KEY || values.DISCORD_BOT_TOKEN ? "Vérification…" : "Enregistrement…";
  errBox.hidden = true;
  const showError = (text) => {
    // On garde la fenêtre ouverte pour que l'erreur soit bien vue.
    errBox.replaceChildren(iconEl("alert", 16), document.createTextNode(text));
    errBox.hidden = false;
  };
  try {
    const r = await api("/api/settings", { method: "POST", body: { values } });
    applyStatus(r.status);
    // Erreurs à corriger dans cette fenêtre (clé mal copiée, etc.).
    const errors = [];
    if (r.ai && !r.ai.ok && r.ai.reason !== "credit") errors.push("Claude : " + r.ai.message);
    if (r.free && !r.free.ok) errors.push("IA gratuite : " + r.free.message);
    if (r.discord && !r.discord.ok) errors.push("Discord : " + r.discord.message);
    if (errors.length) return showError(errors.join("\n"));
    closeSettings();
    if (r.ai && !r.ai.ok && r.ai.reason === "credit") {
      // La clé est bonne : c'est le compte Anthropic qui manque de crédit.
      if (r.status.provider === "groq") {
        toast("Claude n'a pas de crédit : l'IA gratuite répond en attendant.");
      } else {
        showAiWarning(r.ai.message);
        toast("Clé enregistrée, mais ton compte Anthropic n'a pas de crédit.", true);
      }
      return;
    }
    const disconnected = r.changed.some((k) => k.startsWith("GOOGLE_") || k.startsWith("SPOTIFY_"));
    toast(
      r.ai?.ok || r.free?.ok || r.discord?.ok
        ? `Réglages enregistrés. ${[r.ai?.ok && "Clé Claude valide.", r.free?.ok && "Clé Groq valide.", r.discord?.ok && r.discord.message].filter(Boolean).join(" ")}`
        : disconnected
          ? "Réglages enregistrés. Reconnecte le service dont tu as changé les identifiants."
          : "Réglages enregistrés.",
    );
    refreshAll();
    refreshMusic();
  } catch (err) {
    errBox.replaceChildren(iconEl("alert", 16), document.createTextNode(err.message));
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Enregistrer";
  }
});

// ---------- Formulaire & boutons ----------
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (send($("#input").value)) $("#input").value = "";
});
document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => send(c.dataset.prompt)));
document.querySelector("[data-refresh]").addEventListener("click", refreshAll);
// Fenêtre réduite / cachée : on met les animations en pause (économie de processeur).
document.addEventListener("visibilitychange", () => document.body.classList.toggle("asleep", document.visibilityState !== "visible"));
// En revenant sur la fenêtre, on remet les infos à jour.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadStatus();
    refreshAll();
    refreshMusic();
  }
});

// ---------- Démarrage ----------
(async function init() {
  hydrateIcons();
  renderVoiceToggle();

  const params = new URLSearchParams(location.search);
  if (params.get("connected")) toast(`${params.get("connected") === "google" ? "Google" : "Spotify"} connecté.`);
  if (params.get("error")) toast(params.get("error"), true);
  if (params.toString()) history.replaceState(null, "", "/");

  await loadStatus();
  if (state.offline) {
    // Serveur pas encore prêt : on recharge la page dès qu'il répond.
    setInterval(() => api("/api/status").then(() => location.reload(), () => {}), 3000);
    return;
  }
  const hour = new Date().getHours();
  const who = state.status.userName ? " " + state.status.userName : "";
  const hello = hour < 6 ? `Encore debout${who} ?` : (hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir") + who + ".";
  addMsg("bot", `${hello} ${state.name} en ligne, tous les systèmes sont opérationnels. Que puis-je faire pour toi ?`);
  const s = state.status;
  if (!s.provider) {
    showAiWarning("Il me manque une clé d'IA. Ouvre les réglages en haut à droite : colle ta clé Claude, ou une clé Groq gratuite (console.groq.com).");
  } else if (s.provider === "claude" && s.aiOk === false) {
    const freeHint = !s.free.configured ? " En attendant, tu peux ajouter une clé Groq gratuite dans les réglages : je l'utiliserai à la place." : "";
    showAiWarning((s.aiMessage || "Ma clé API Claude est refusée. Vérifie-la dans les réglages.") + freeHint);
  } else if (s.provider === "groq" && s.free.ok === false) {
    showAiWarning(s.free.message);
  } else if (s.provider === "groq" && s.ai && s.aiOk === false) {
    addMsg("bot", "Claude n'a pas de crédit pour l'instant : je réponds avec l'IA gratuite (Groq) en attendant.", "info");
  }

  renderTimers();
  checkTimers(true);
  refreshAll();
  refreshMusic();
  setInterval(refreshMusic, 10000);
  setInterval(refreshAll, 5 * 60 * 1000);
  setInterval(loadStatus, 15000);
})();

// ---------- Visionneuse : un clic sur une image du chat l'affiche en grand ----------
const viewer = { list: [], i: 0, node: null };
const CHAT_IMAGES = ".msg-images img, .gen-image > img, .found-item img";

function viewerButton(cls, icon, title, onclick) {
  const b = el("button", "vw-btn " + cls);
  b.type = "button";
  b.title = title;
  b.append(iconEl(icon, 22));
  b.onclick = (e) => (e.stopPropagation(), onclick());
  return b;
}

function openViewer(list, i) {
  viewer.list = list;
  viewer.i = i;
  if (!viewer.node) {
    const n = el("div", "viewer");
    const img = el("img", "vw-img");
    img.alt = "";
    const bar = el("div", "vw-bar");
    n.append(img, bar, viewerButton("vw-close", "x", "Fermer (Échap)", closeViewer), viewerButton("vw-prev", "chevron-left", "Précédente", () => stepViewer(-1)), viewerButton("vw-next", "chevron-right", "Suivante", () => stepViewer(1)));
    n.onclick = (e) => e.target === n && closeViewer();
    document.body.append(n);
    viewer.node = n;
  }
  showViewerImage();
  viewer.node.hidden = false;
}

function showViewerImage() {
  const it = viewer.list[viewer.i];
  const n = viewer.node;
  n.querySelector(".vw-img").src = it.src;
  const multi = viewer.list.length > 1;
  n.querySelector(".vw-prev").hidden = !multi;
  n.querySelector(".vw-next").hidden = !multi;
  const bar = n.querySelector(".vw-bar");
  bar.replaceChildren();
  if (it.caption) bar.append(el("span", "vw-cap", it.caption));
  if (multi) bar.append(el("span", "vw-count", `${viewer.i + 1} / ${viewer.list.length}`));
  // Téléchargement seulement pour nos propres images (les autres s'ouvrent à leur source).
  if (it.src.startsWith("data:") || it.src.startsWith(location.origin)) {
    const dl = el("a", "proj-link");
    dl.href = it.src;
    dl.download = "jarvis-image.jpg";
    dl.append(document.createTextNode("Télécharger"));
    bar.append(dl);
  }
  if (it.link) {
    const src = el("button", "proj-link");
    src.type = "button";
    src.append(iconEl("external", 14), document.createTextNode("Voir la source"));
    src.onclick = () => openExternal(it.link);
    bar.append(src);
  }
}

function stepViewer(d) {
  if (viewer.list.length < 2) return;
  viewer.i = (viewer.i + d + viewer.list.length) % viewer.list.length;
  showViewerImage();
}

function closeViewer() {
  if (!viewer.node) return;
  viewer.node.hidden = true;
  viewer.node.querySelector(".vw-img").removeAttribute("src");
}

$("#chat").addEventListener("click", (e) => {
  const img = e.target.closest(CHAT_IMAGES);
  if (!img) return;
  const imgs = [...img.closest(".msg").querySelectorAll(CHAT_IMAGES)];
  openViewer(imgs.map((x) => ({ src: x.currentSrc || x.src, caption: x.dataset.caption || "", link: x.dataset.link })), imgs.indexOf(img));
});
