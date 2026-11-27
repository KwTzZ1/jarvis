// ================== JARVIS : page Widgets ==================
// Deux pages côte à côte (Assistant / Widgets) qu'on fait glisser,
// et un tableau de widgets qu'on peut déplacer, redimensionner et empiler.

// ---------- Pages qui glissent ----------
const pager = $("#pager");
const track = $("#track");
let page = [0, 1, 2].includes(Number(localStorage.getItem("page"))) ? Number(localStorage.getItem("page")) : 0;

const PAGE_IDS = ["pageAssistant", "pageWidgets", "pageWeb"];
const LAST_PAGE = PAGE_IDS.length - 1;
function goTo(p, animate = true) {
  page = Math.max(0, Math.min(LAST_PAGE, p));
  track.style.transition = animate ? "" : "none";
  track.style.transform = `translateX(${(-page * 100) / PAGE_IDS.length}%)`;
  document.querySelectorAll(".tab").forEach((t) => {
    const on = Number(t.dataset.page) === page;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  // La page cachée ne doit pas prendre le focus clavier.
  PAGE_IDS.forEach((id, i) => ($("#" + id).inert = page !== i));
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
const SWIPE_BACKGROUNDS = ".page, .layout, .col, .center, .chat, .board, .board-page, .board-toolbar, .track, .chips, .web-tabs";
pager.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.target.closest("input, textarea, select, button, a, label, .add-menu, .msg, .draft")) return;
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
  music: { title: "Spotify", icon: "music", size: "m", render: (b) => renderMusicInto(b, cache.music) },
  agenda: { title: "Agenda", icon: "calendar", size: "t", render: (b) => renderListWidget(b, "events") },
  mails: { title: "Mails non lus", icon: "mail", size: "t", render: (b) => renderListWidget(b, "emails") },
  tasks: { title: "Tâches", icon: "tasks", size: "t", render: (b) => renderListWidget(b, "tasks") },
  timers: { title: "Minuteurs", icon: "timer", size: "s", render: renderTimersWidget },
  memory: { title: "Mémoire", icon: "bookmark", size: "s", render: renderMemoryWidget },
  shortcuts: { title: "Raccourcis", icon: "zap", size: "m", render: renderShortcutsWidget },
  discord: { title: "Discord", icon: "message", size: "t", render: renderDiscordWidget },
};
const SIZES = ["s", "m", "t", "l"];
const SIZE_LABELS = { s: "petit", m: "large", t: "haut", l: "grand" };

// Quelles données redessinent quels widgets.
const WIDGET_DEPS = {
  data: ["weather", "agenda", "mails", "tasks", "memory"],
  music: ["music"],
  timers: ["timers"],
  reply: ["ask"],
  tick: ["clock"],
  discord: ["discord"],
  status: ["discord"],
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
}, 20_000);
hooks.status.push(() => {
  const d = state.status?.discord;
  if (d?.ok && !discordState.channels && !discordState.loading) loadDiscord();
});

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
  for (const m of discordState.messages) {
    const li = el("li");
    const head = el("div", "when", `${m.author}${m.bot ? " (bot)" : ""} · ${new Date(m.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`);
    li.append(head, el("div", "dc-text", m.content || "(vide)"));
    list.append(li);
  }
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
  w.append(head, body);
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
$("#board").addEventListener("pointerdown", (e) => {
  if (!boardEditing || (e.pointerType === "mouse" && e.button !== 0)) return;
  const w = e.target.closest(".widget");
  if (!w || e.target.closest("button, input, a")) return;
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
