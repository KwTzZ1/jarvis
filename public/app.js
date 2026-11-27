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
  status: null,
};

// ---------- Utilitaires ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
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
  toast._t = setTimeout(() => (t.hidden = true), 5000);
}

function setMode(mode) {
  const r = $("#reactor");
  r.classList.remove("listening", "thinking", "speaking");
  if (mode) r.classList.add(mode);
  const labels = { listening: "À l'écoute…", thinking: "Analyse…", speaking: "Réponse", wake: `Dis « ${state.name} »` };
  $("#state").textContent = labels[mode] || (state.wakeOn ? labels.wake : "En ligne");
}

const fmtTime = (d) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
function fmtWhen(iso, allDay) {
  const d = new Date(iso);
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
async function loadStatus() {
  const s = await api("/api/status");
  state.status = s;
  state.name = s.name;
  document.title = s.name.toUpperCase();
  $("#brandName").textContent = s.name.toUpperCase();
  $("#modelName").textContent = s.ai ? s.model.replace("claude-", "").replace(/-(\d)-(\d)$/, " $1.$2") : "clé manquante";
  $("#connAi").className = "conn " + (s.ai ? "ok" : "");
  setConn("#connGoogle", s.google, "google");
  setConn("#connSpotify", s.spotify, "spotify");
  updateCost(s.usage);
  if (!state.listening && !state.busy) setMode(null);
}

function setConn(sel, info, service) {
  const row = $(sel);
  const btn = row.querySelector("button");
  row.className = "conn " + (info.connected ? "ok" : info.configured ? "warn" : "");
  btn.textContent = info.connected ? "Déconnecter" : "Connecter";
  btn.onclick = async () => {
    if (info.connected) {
      await api(`/auth/${service}/logout`, { method: "POST" });
      await loadStatus();
      refreshAll();
      refreshMusic();
    } else if (!info.configured) {
      toast(`Renseigne d'abord les identifiants ${service === "google" ? "Google" : "Spotify"} dans les réglages.`, true);
      openSettings();
    } else {
      location.href = `/auth/${service}`;
    }
  };
}

function updateCost(u) {
  if (!u) return;
  $("#costValue").textContent = u.cost.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " $";
  $("#cost").title = `Coût IA de la session : ${u.input} jetons envoyés, ${u.output} reçus, ${u.searches} recherches web`;
}

// ---------- Widgets ----------
const emptyLi = (text) => el("li", "empty", text);

function renderList(ul, result, renderItem, emptyText) {
  ul.replaceChildren();
  if (result.error === "not_connected") return ul.append(emptyLi("Connecte Google pour voir ça."));
  if (result.error) return ul.append(emptyLi("Erreur : " + result.error));
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
    const label = i === 0 ? "auj." : new Date(day.date).toLocaleDateString("fr-FR", { weekday: "short" });
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
    x.onclick = async () => renderMemory((await api(`/api/memory/${i}`, { method: "DELETE" })).memory);
    li.append(x);
    ul.append(li);
  });
}

async function refreshAll() {
  try {
    const d = await api("/api/dashboard");
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
      const li = el("li");
      li.append(el("div", "t", senderName(m.from)));
      li.append(el("div", "s", m.subject));
      li.title = m.snippet;
      li.style.cursor = "pointer";
      li.onclick = () => send(`Résume-moi le mail de ${senderName(m.from)} intitulé "${m.subject}" (id ${m.id}).`);
      return li;
    }, "Boîte de réception à jour.");
    renderList($("#tasks"), d.tasks, (t) => {
      const li = el("li", "task");
      const cb = el("input");
      cb.type = "checkbox";
      cb.title = "Marquer comme fait";
      cb.onchange = async () => {
        li.style.opacity = 0.4;
        try {
          await api(`/api/tasks/${encodeURIComponent(t.id)}/complete`, { method: "POST" });
          setTimeout(refreshAll, 400);
        } catch (e) {
          toast(e.message, true);
          li.style.opacity = 1;
          cb.checked = false;
        }
      };
      const txt = el("div");
      txt.append(el("div", "t", t.title));
      if (t.due) txt.append(el("div", "when", "Pour " + new Date(t.due).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })));
      li.append(cb, txt);
      return li;
    }, "Aucune tâche en cours.");
  } catch (e) {
    console.error(e);
  }
}

async function refreshMusic() {
  const box = $("#music");
  try {
    const r = await api("/api/music");
    box.replaceChildren();
    if (r.error === "not_connected") return (box.textContent = "Connecte Spotify pour voir et contrôler ta musique.");
    if (r.error) return (box.textContent = "Erreur : " + r.error);
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
    fill.style.width = m.durationMs ? `${(100 * m.progressMs) / m.durationMs}%` : "0";
    bar.append(fill);
    const controls = el("div", "controls");
    [["previous", "prev"], [m.playing ? "pause" : "play", m.playing ? "pause" : "play"], ["next", "next"]].forEach(([cmd, ic]) => {
      const b = el("button");
      b.append(iconEl(ic, 16));
      b.onclick = async () => {
        try {
          await api(`/api/music/${cmd}`, { method: "POST" });
          setTimeout(refreshMusic, 500);
        } catch (e) {
          toast(e.message, true);
        }
      };
      controls.append(b);
    });
    box.append(np, bar, controls);
  } catch (e) {
    box.textContent = "Erreur : " + e.message;
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

async function send(text) {
  text = (text || "").trim();
  if (!text || state.busy) return;
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
    (r.actions || []).forEach(handleAction);
    speak(r.reply);
  } catch (e) {
    typing.remove();
    addMsg("bot", "Petit souci technique : " + e.message, "error");
    state.history.pop();
    setMode(null);
  } finally {
    state.busy = false;
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
      const w = window.open(a.url, "_blank", "noopener");
      if (!w) {
        // Fenêtre bloquée par le navigateur : on affiche un lien à la place.
        const card = el("div", "msg bot link-card");
        card.dataset.name = state.name.toUpperCase();
        const link = el("a", "inline-ic", "Ouvrir " + new URL(a.url).hostname);
        link.append(iconEl("external", 14));
        link.href = a.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.style.color = "var(--cyan)";
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
    try {
      const to = node.querySelector(".d-to").value;
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

// ---------- Minuteurs ----------
const timers = [];
function startTimer(seconds, label) {
  timers.push({ end: Date.now() + seconds * 1000, label });
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
    li.append(el("span", "left", (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")));
    const x = el("button", "x-btn");
    x.append(iconEl("x", 14));
    x.title = "Annuler";
    x.onclick = () => {
      timers.splice(timers.indexOf(t), 1);
      renderTimers();
    };
    li.append(x);
    ul.append(li);
  });
}
setInterval(() => {
  for (const t of [...timers]) {
    if (Date.now() >= t.end) {
      timers.splice(timers.indexOf(t), 1);
      beep();
      const msg = `${t.label} : c'est l'heure !`;
      addMsg("bot", msg).prepend(iconEl("timer", 16));
      speak(msg, true);
      toast(msg);
    }
  }
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

function speak(text, force = false) {
  if (!("speechSynthesis" in window) || (!state.voiceOn && !force)) return setMode(null);
  const clean = text.replace(/[*_#`>]/g, "").replace(/https?:\/\/\S+/g, "le lien");
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "fr-FR";
  if (frVoice) u.voice = frVoice;
  u.rate = 1.05;
  u.onstart = () => setMode("speaking");
  u.onend = u.onerror = () => setMode(state.listening ? "listening" : null);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function renderVoiceToggle() {
  $("#voiceToggle").classList.toggle("off", !state.voiceOn);
  $("#voiceToggle").replaceChildren(iconEl(state.voiceOn ? "volume" : "volume-x"));
}
$("#voiceToggle").onclick = () => {
  state.voiceOn = !state.voiceOn;
  localStorage.setItem("voiceOn", state.voiceOn ? "1" : "0");
  renderVoiceToggle();
  if (!state.voiceOn) stopSpeaking();
};

// ---------- Voix : reconnaissance ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let recMode = null; // "command" | "wake"
let awaitingCommand = false;

function newRecognizer(continuous) {
  const r = new SR();
  r.lang = "fr-FR";
  r.interimResults = true;
  r.continuous = continuous;
  return r;
}

function startCommand() {
  if (!SR) return toast("La reconnaissance vocale nécessite Chrome ou Edge.", true);
  stopRecognition();
  stopSpeaking();
  recMode = "command";
  rec = newRecognizer(false);
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (const res of e.results) {
      if (res.isFinal) finalText = res[0].transcript;
      else interim += res[0].transcript;
    }
    $("#input").value = finalText || interim;
  };
  rec.onend = () => {
    $("#micBtn").classList.remove("on");
    state.listening = false;
    recMode = null;
    setMode(null);
    const text = $("#input").value.trim();
    if (text) {
      $("#input").value = "";
      send(text);
    }
    if (state.wakeOn) setTimeout(startWake, 400);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") toast("Autorise le micro pour parler à " + state.name + ".", true);
  };
  rec.start();
  state.listening = true;
  $("#micBtn").classList.add("on");
  setMode("listening");
}

// Écoute permanente : réagit quand on prononce le nom de l'assistant.
function startWake() {
  if (!SR || !state.wakeOn || state.busy || recMode) return;
  recMode = "wake";
  rec = newRecognizer(true);
  const wake = state.name.toLowerCase();
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const t = res[0].transcript.toLowerCase();
      if (!res.isFinal) {
        if (t.includes(wake)) setMode("listening");
        continue;
      }
      if (awaitingCommand) {
        awaitingCommand = false;
        send(res[0].transcript);
        continue;
      }
      const idx = t.indexOf(wake);
      if (idx >= 0) {
        const command = res[0].transcript.slice(idx + wake.length).replace(/^[\s,.!?]+/, "").trim();
        if (command.length > 2) send(command);
        else {
          awaitingCommand = true;
          beepShort();
          setMode("listening");
        }
      }
    }
  };
  rec.onend = () => {
    if (recMode === "wake") recMode = null;
    if (state.wakeOn) setTimeout(startWake, 300);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") {
      state.wakeOn = false;
      $("#wakeToggle").classList.remove("on");
      toast("Autorise le micro pour l'écoute permanente.", true);
    }
  };
  try {
    rec.start();
  } catch {}
  setMode(null);
}

function stopRecognition() {
  if (rec) {
    const r = rec;
    rec = null;
    recMode = null;
    r.onend = null;
    try {
      r.abort();
    } catch {}
  }
}

$("#wakeToggle").onclick = () => {
  if (!SR) return toast("L'écoute permanente nécessite Chrome ou Edge.", true);
  state.wakeOn = !state.wakeOn;
  $("#wakeToggle").classList.toggle("on", state.wakeOn);
  if (state.wakeOn) {
    toast(`Écoute permanente activée : dis « ${state.name}, … »`);
    startWake();
  } else {
    stopRecognition();
    setMode(null);
  }
};

const toggleMic = () => (state.listening ? rec?.stop() : startCommand());
$("#micBtn").onclick = toggleMic;
$("#reactor").onclick = toggleMic;

// Maintenir Espace (hors champ texte) pour parler.
const typing = () => ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat && !typing() && $("#settings").hidden) {
    e.preventDefault();
    if (!state.listening) startCommand();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space" && state.listening && recMode === "command" && !typing()) rec?.stop();
});

// ---------- Réglages ----------
async function openSettings() {
  const { fields } = await api("/api/settings");
  const box = $("#settingsFields");
  box.replaceChildren();
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
      input.value = f.value;
    } else {
      input = el("input");
      input.type = f.secret ? "password" : "text";
      input.value = f.value;
      input.placeholder = f.placeholder || "";
      input.autocomplete = "off";
      input.spellcheck = false;
    }
    input.id = "set_" + f.key;
    input.name = f.key;
    row.append(label, input);
    if (f.help) row.append(el("div", "help", f.help));
    box.append(row);
  }
  $("#settings").hidden = false;
}
const closeSettings = () => ($("#settings").hidden = true);
$("#settingsBtn").onclick = openSettings;
$("#settingsClose").onclick = closeSettings;
$("#settings").onclick = (e) => e.target.id === "settings" && closeSettings();
document.addEventListener("keydown", (e) => e.key === "Escape" && closeSettings());
$("#settingsForm").onsubmit = async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(new FormData(e.target).entries());
  try {
    await api("/api/settings", { method: "POST", body: { values } });
    closeSettings();
    toast("Réglages enregistrés.");
    await loadStatus();
    refreshAll();
  } catch (err) {
    toast(err.message, true);
  }
};

// ---------- Formulaire & boutons ----------
$("#composer").onsubmit = (e) => {
  e.preventDefault();
  const v = $("#input").value;
  $("#input").value = "";
  send(v);
};
document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => send(c.dataset.prompt)));
document.querySelector("[data-refresh]").onclick = refreshAll;

// ---------- Démarrage ----------
(async function init() {
  hydrateIcons();
  renderVoiceToggle();

  const params = new URLSearchParams(location.search);
  if (params.get("connected")) toast(`${params.get("connected") === "google" ? "Google" : "Spotify"} connecté.`);
  if (params.get("error")) toast(params.get("error"), true);
  if (params.toString()) history.replaceState(null, "", "/");

  try {
    await loadStatus();
  } catch {
    toast("Le serveur ne répond pas. Relance Jarvis.", true);
    return;
  }
  const hour = new Date().getHours();
  const who = state.status.userName ? " " + state.status.userName : "";
  const hello = hour < 6 ? `Encore debout${who} ?` : (hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir") + who + ".";
  addMsg("bot", `${hello} ${state.name} en ligne, tous les systèmes sont opérationnels. Que puis-je faire pour toi ?`);
  if (!state.status.ai) {
    addMsg("bot", "Ma clé API Claude n'est pas encore configurée. Ouvre les réglages en haut à droite pour la renseigner.", "error");
  }

  refreshAll();
  refreshMusic();
  setInterval(refreshMusic, 10000);
  setInterval(refreshAll, 5 * 60 * 1000);
  setInterval(loadStatus, 60 * 1000);
})();
