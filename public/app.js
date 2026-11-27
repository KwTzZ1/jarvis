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

// ---------- Utilitaires ----------
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
  const model = s.model.replace("claude-", "").replace(/-(\d+)-(\d+)$/, " $1.$2");
  $("#modelName").textContent = !s.ai ? "clé manquante" : s.aiOk === false ? "clé refusée" : model;
  // Vert : clé validée. Orange : pas encore vérifiée. Rouge : absente ou refusée.
  $("#connAi").className = "conn " + (!s.ai || s.aiOk === false ? "" : s.aiOk ? "ok" : "warn");
  $("#connAi").title = !s.ai ? "Renseigne ta clé dans les réglages." : s.aiOk === false ? s.aiMessage : s.aiOk ? "Clé API valide." : "Clé pas encore vérifiée.";
  setConn("#connGoogle", s.google, "google");
  setConn("#connSpotify", s.spotify, "spotify");
  updateCost(s.usage);
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

// La clé vient d'être validée : on retire l'avertissement.
function onAiReady() {
  if (state.noKeyMsg) {
    state.noKeyMsg.remove();
    state.noKeyMsg = null;
    addMsg("bot", "Clé API validée. Je suis prêt : que puis-je faire pour toi ?");
  }
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
      openSettings();
    } else {
      location.href = `/auth/${service}`;
    }
  };
}

function updateCost(u) {
  if (!u) return;
  $("#costValue").textContent = u.cost.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " $";
  $("#cost").title = `Coût IA depuis le démarrage : ${u.input} jetons envoyés, ${u.output} reçus, ${u.searches} recherches web`;
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

function renderWeather(w) {
  const box = $("#weather");
  box.replaceChildren();
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

function renderMemory(mem) {
  const ul = $("#memory");
  ul.replaceChildren();
  if (!mem.length) return ul.append(emptyLi("Rien en mémoire pour l'instant."));
  mem.forEach((m, i) => {
    const li = el("li");
    li.append(el("span", null, m));
    const x = el("button", "x-btn");
    x.append(iconEl("x", 14));
    x.title = "Oublier";
    x.onclick = async () => {
      try {
        renderMemory((await api(`/api/memory/${i}?text=${encodeURIComponent(m)}`, { method: "DELETE" })).memory);
      } catch (e) {
        toast(e.message, true);
      }
    };
    li.append(x);
    ul.append(li);
  });
}

let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  try {
    const d = await api("/api/dashboard");
    applyStatus(d.status);
    renderWeather(d.weather);
    renderMemory(d.memory);
    renderList($("#events"), d.events, (e) => {
      const li = el("li");
      li.append(el("div", "when", fmtWhen(e.start, e.allDay)));
      li.append(el("div", "t", e.title));
      if (e.location) li.append(withIcon("div", "s", "pin", e.location, 12));
      return li;
    }, "Rien de prévu cette semaine.");
    renderList($("#emails"), d.emails, (m) => {
      const li = el("li", "clickable");
      li.append(el("div", "t", senderName(m.from)));
      li.append(el("div", "s", m.subject));
      li.title = "Clique pour que je te le résume.\n\n" + m.snippet;
      li.onclick = () => send(`Résume-moi le mail de ${senderName(m.from)} intitulé "${m.subject}" (id ${m.id}).`);
      return li;
    }, "Boîte de réception à jour.");
    renderList($("#tasks"), d.tasks, (t) => {
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
    }, "Aucune tâche en cours.");
  } catch (e) {
    console.error(e);
  } finally {
    refreshing = false;
  }
}

async function refreshMusic() {
  const box = $("#music");
  try {
    const r = await api("/api/music");
    box.replaceChildren();
    if (r.error === "not_connected") return (box.textContent = "Connecte Spotify pour voir et contrôler ta musique.");
    if (r.error) return (box.textContent = r.error);
    const m = r.data;
    if (!m.title) return (box.textContent = "Rien en lecture. Demande-moi de mettre de la musique.");
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
    const bar = el("div", "bar");
    const fill = el("span");
    fill.style.width = m.durationMs ? `${Math.min(100, (100 * m.progressMs) / m.durationMs)}%` : "0";
    bar.append(fill);
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

// Retourne false si la demande n'a pas pu partir (Jarvis déjà occupé).
function send(text) {
  text = (text || "").trim();
  if (!text) return true;
  if (state.busy) {
    toast("Patiente une seconde, je termine ma réponse.");
    return false;
  }
  ask(text);
  return true;
}

async function ask(text) {
  state.busy = true;
  stopSpeaking();
  addMsg("user", text);
  state.history.push({ role: "user", content: text });
  const typing = addTyping();
  setMode("thinking");
  try {
    const r = await api("/api/chat", { method: "POST", body: { history: state.history } });
    typing.remove();
    addMsg("bot", r.reply);
    state.history.push({ role: "assistant", content: r.reply });
    state.history = state.history.slice(-30);
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
  const ul = $("#timers");
  $("#timersPanel").hidden = timers.length === 0;
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
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("fr"));
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
      u.rate = 1.05;
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
async function openSettings() {
  let fields;
  try {
    ({ fields } = await api("/api/settings"));
  } catch (e) {
    return toast(e.message, true);
  }
  const box = $("#settingsFields");
  box.replaceChildren();
  $("#settingsError").hidden = true;
  let group = null;
  for (const f of fields) {
    if (f.group !== group) {
      group = f.group;
      box.append(el("div", "set-group", group));
    }
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
    row.append(label, input);
    if (f.help) row.append(el("div", "help", f.help));
    box.append(row);
  }
  $("#settings").hidden = false;
  const key = $("#set_ANTHROPIC_API_KEY");
  if (key && !state.status?.ai) key.focus();
}
function closeSettings() {
  $("#settings").hidden = true;
}
$("#settingsBtn").addEventListener("click", openSettings);
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
  btn.textContent = values.ANTHROPIC_API_KEY ? "Vérification…" : "Enregistrement…";
  errBox.hidden = true;
  try {
    const r = await api("/api/settings", { method: "POST", body: { values } });
    applyStatus(r.status);
    if (r.ai && !r.ai.ok) {
      // On garde la fenêtre ouverte pour que l'erreur soit bien vue.
      errBox.replaceChildren(iconEl("alert", 16), document.createTextNode(r.ai.message));
      errBox.hidden = false;
      return;
    }
    closeSettings();
    if (r.ai?.ok) onAiReady();
    const disconnected = r.changed.some((k) => k.startsWith("GOOGLE_") || k.startsWith("SPOTIFY_"));
    toast(r.ai?.ok ? "Réglages enregistrés. Clé API Claude valide." : disconnected ? "Réglages enregistrés. Reconnecte le service dont tu as changé les identifiants." : "Réglages enregistrés.");
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
  if (!state.status.ai) {
    state.noKeyMsg = addMsg("bot", "Ma clé API Claude n'est pas encore configurée. Ouvre les réglages en haut à droite pour la renseigner.", "error");
  } else if (state.status.aiOk === false) {
    state.noKeyMsg = addMsg("bot", state.status.aiMessage || "Ma clé API Claude est refusée. Vérifie-la dans les réglages.", "error");
  }

  renderTimers();
  checkTimers(true);
  refreshAll();
  refreshMusic();
  setInterval(refreshMusic, 10000);
  setInterval(refreshAll, 5 * 60 * 1000);
  setInterval(loadStatus, 15000);
})();
