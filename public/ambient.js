// Mode veille (écran d'ambiance avec la sphère en grand), « ne pas déranger », annonces de Jarvis
// (rendez-vous qui approchent, nouveaux mails, PC qui chauffe), briefing parlé du matin et aide des raccourcis.
(() => {
  const prefs = Object.assign(
    { ambientAfter: 10, briefing: true, eventLead: 10, mails: true, heat: true, dndNight: true },
    JSON.parse(localStorage.getItem("annoncePrefs") || "{}"),
  );
  const savePrefs = () => localStorage.setItem("annoncePrefs", JSON.stringify(prefs));
  const two = (n) => String(n).padStart(2, "0");
  const hourText = (d) => `${d.getHours()} h${d.getMinutes() ? " " + two(d.getMinutes()) : ""}`;

  // ---------- Ne pas déranger : la nuit (23 h → 8 h) ou à la demande ----------
  const night = (d = new Date()) => d.getHours() >= 23 || d.getHours() < 8;
  function nextAt(hour) {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    if (d <= new Date()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const dnd = (window.jarvisDnd = {
    manual: JSON.parse(localStorage.getItem("dndManual") || "null"),
    active() {
      const m = this.manual;
      if (m && Date.now() < m.until) return m.on;
      return prefs.dndNight && night();
    },
    // Activé à la main : jusqu'à 8 h du matin. Désactivé à la main : jusqu'à 23 h.
    set(on) {
      this.manual = { on, until: on ? nextAt(8) : nextAt(23) };
      localStorage.setItem("dndManual", JSON.stringify(this.manual));
      window.renderGlance?.();
    },
    toggle() {
      this.set(!this.active());
      toast(this.active() ? "Ne pas déranger activé." : "Ne pas déranger désactivé.");
    },
  });

  // ---------- Annonces ----------
  function announce(text, icon = "bell") {
    const quiet = dnd.active();
    addMsg("bot", text, "info").prepend(iconEl(icon, 16));
    if (quiet) return;
    window.sfx?.("notif");
    if (state.voiceOn && !state.busy && !state.speaking && !state.listening) speak(text);
  }
  window.jarvisAnnounce = announce;

  // Rendez-vous qui approchent (une seule fois chacun).
  const announced = new Set(JSON.parse(localStorage.getItem("annonces") || "[]"));
  function checkEvents() {
    const lead = prefs.eventLead;
    const evs = cache.dashboard?.events?.data;
    if (!lead || !Array.isArray(evs)) return;
    for (const e of evs) {
      if (e.allDay || !e.start) continue;
      const mins = Math.round((Date.parse(e.start) - Date.now()) / 60000);
      const key = `${e.id || e.title}|${e.start}`;
      if (mins < 1 || mins > lead || announced.has(key)) continue;
      announced.add(key);
      localStorage.setItem("annonces", JSON.stringify([...announced].slice(-60)));
      announce(`Dans ${mins} minute${mins > 1 ? "s" : ""} : ${e.title}.`, "calendar");
    }
  }
  setInterval(checkEvents, 30_000);

  // Nouveaux mails (à chaque rafraîchissement des données).
  let seenMails = null;
  hooks.data.push(() => {
    const list = cache.dashboard?.emails?.data;
    if (!Array.isArray(list)) return;
    const fresh = seenMails ? list.filter((m) => !seenMails.has(m.id)) : [];
    seenMails = new Set([...(seenMails || []), ...list.map((m) => m.id)]);
    if (!prefs.mails || !fresh.length) return;
    if (fresh.length === 1) announce(`Nouveau mail de ${senderName(fresh[0].from)} : ${fresh[0].subject || "sans objet"}.`, "mail");
    else announce(`${fresh.length} nouveaux mails, dont un de ${senderName(fresh[0].from)}.`, "mail");
  });

  // PC qui chauffe (relevés des points autour de la sphère), au plus une fois par demi-heure.
  let heatAt = 0;
  addEventListener("jarvis-hw", (e) => {
    const d = e.detail;
    if (!prefs.heat || Date.now() - heatAt < 30 * 60_000) return;
    if (d.gpu?.temp >= 85) (heatAt = Date.now()), announce(`Attention : la carte graphique chauffe, ${Math.round(d.gpu.temp)} degrés.`, "alert");
    else if (d.cpu?.temp >= 90) (heatAt = Date.now()), announce(`Attention : le processeur chauffe, ${Math.round(d.cpu.temp)} degrés.`, "alert");
  });

  // Briefing du matin : une fois par jour, à la première ouverture (avant 14 h).
  function briefing(force) {
    const today = new Date().toDateString();
    const h = new Date().getHours();
    const d = cache.dashboard;
    const w = d?.weather?.data;
    if (!w) return force && toast("La météo n'est pas encore chargée, réessaie dans un instant.");
    if (!force) {
      if (!prefs.briefing || localStorage.getItem("briefDay") === today || h < 5 || h >= 14) return;
      localStorage.setItem("briefDay", today);
      if (dnd.active()) return;
    }
    const who = state.status?.userName ? " " + state.status.userName : "";
    const hello = h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
    const parts = [`${hello}${who}, voici ton briefing.`, `Il fait ${w.now.temp} degrés à ${w.city}, ${w.now.description}.`];
    const day = w.days?.[0];
    if (day) parts.push(`Jusqu'à ${day.max} degrés aujourd'hui${day.rain >= 50 ? ", prends un parapluie" : ""}.`);
    const evs = (Array.isArray(d.events?.data) ? d.events.data : []).filter((e) => new Date(e.start).toDateString() === today);
    if (evs.length) {
      const first = evs[0];
      const when = first.allDay ? "toute la journée" : `à ${hourText(new Date(first.start))}`;
      parts.push(evs.length === 1 ? `Un rendez-vous aujourd'hui, ${when} : ${first.title}.` : `${evs.length} rendez-vous aujourd'hui, le premier ${when} : ${first.title}.`);
    } else if (Array.isArray(d.events?.data)) parts.push("Rien de prévu dans ton agenda aujourd'hui.");
    const mails = d.emails?.data;
    if (Array.isArray(mails) && mails.length) parts.push(`Tu as ${mails.length} mail${mails.length > 1 ? "s" : ""} non lu${mails.length > 1 ? "s" : ""}.`);
    const tasks = d.tasks?.data;
    if (Array.isArray(tasks) && tasks.length) parts.push(`Et ${tasks.length} tâche${tasks.length > 1 ? "s" : ""} en cours.`);
    parts.push("Bonne journée !");
    const text = parts.join(" ");
    addMsg("bot", text).prepend(iconEl("sunrise", 16));
    if (state.voiceOn && !state.busy) speak(text);
  }
  hooks.data.push(() => setTimeout(briefing, 2500));

  // ---------- Mode veille ----------
  const amb = el("div", "amb");
  amb.id = "ambient";
  amb.hidden = true;
  amb.innerHTML = `<div class="amb-inner">
      <div class="amb-top"><span class="amb-date"></span><span class="amb-weather"></span></div>
      <div class="amb-orb"></div>
      <div class="amb-time"><b class="amb-hm">--:--</b><small class="amb-s">--</small></div>
      <div class="amb-sub"></div>
      <div class="amb-cards">
        <div class="amb-card amb-event"></div>
        <div class="amb-card amb-music"></div>
        <div class="amb-card amb-sys"></div>
      </div>
    </div>
    <div class="amb-hint">Bouge la souris ou appuie sur une touche pour revenir · dis « Jarvis » pour lui parler</div>`;
  document.body.append(amb);
  const $a = (s) => amb.querySelector(s);
  let active = false, enteredAt = 0, tick = 0, sysTick = 0, driftTick = 0, subTimer = 0;
  let lastInput = Date.now(), px = 0, py = 0;

  function card(box, icon, title, lines, img) {
    box.replaceChildren();
    if (img) {
      const i = el("img");
      i.src = img;
      i.alt = "";
      box.append(i);
    } else {
      const ic = el("span", "amb-ic");
      ic.append(iconEl(icon, 18));
      box.append(ic);
    }
    const t = el("div", "amb-txt");
    t.append(el("small", null, title));
    lines.filter(Boolean).forEach((l, i) => t.append(el(i ? "span" : "b", null, l)));
    box.append(t);
  }
  function update() {
    const now = new Date();
    $a(".amb-hm").textContent = `${two(now.getHours())}:${two(now.getMinutes())}`;
    $a(".amb-s").textContent = two(now.getSeconds());
    $a(".amb-date").textContent = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const w = cache.dashboard?.weather?.data;
    const wb = $a(".amb-weather");
    if (w?.now && wb.dataset.k !== `${w.now.temp}${w.now.icon}`) {
      wb.dataset.k = `${w.now.temp}${w.now.icon}`;
      wb.replaceChildren(iconEl(w.now.icon, 20), el("b", null, `${w.now.temp}°`), el("span", null, `${w.city} · ${w.now.description}`));
    }
    const evs = cache.dashboard?.events?.data;
    const next = Array.isArray(evs) ? evs.find((e) => (e.allDay ? new Date(e.start).toDateString() === now.toDateString() || Date.parse(e.start) > now : Date.parse(e.start) > now - 30 * 60_000)) : null;
    card($a(".amb-event"), "calendar", "Prochain rendez-vous", next ? [next.title, fmtWhen(next.start, next.allDay)] : ["Rien de prévu"]);
    const m = cache.music?.data;
    if (m?.title) {
      const pos = Math.min(m.durationMs || 0, m.progressMs + (m.playing ? Date.now() - (cache.music.at || Date.now()) : 0));
      card($a(".amb-music"), "music", m.playing ? "En écoute" : "En pause", [m.title, m.artist], m.image);
      const bar = el("i", "amb-bar");
      bar.style.setProperty("--p", `${m.durationMs ? ((100 * pos) / m.durationMs).toFixed(1) : 0}%`);
      $a(".amb-music .amb-txt").append(bar);
    } else card($a(".amb-music"), "music", "Musique", ["Rien en cours"]);
    // Après 10 minutes, tout s'atténue (moins de lumière la nuit, et moins d'usure de l'écran).
    amb.classList.toggle("dim", Date.now() - enteredAt > 10 * 60_000);
  }
  async function updateSys() {
    try {
      const s = await api("/api/system");
      const ram = Math.round((100 * s.ram.used) / s.ram.total);
      card($a(".amb-sys"), "zap", "PC", [`Processeur ${s.cpu ?? "?"} % · mémoire ${ram} %`, `Allumé depuis ${Math.floor(s.uptime / 3600)} h ${two(Math.floor((s.uptime % 3600) / 60))}`]);
    } catch {
      // Serveur occupé : prochain essai dans 5 s.
    }
  }
  // Léger déplacement de tout le contenu chaque minute (évite de marquer l'écran).
  const drift = () => ($a(".amb-inner").style.translate = `${Math.round((Math.random() - 0.5) * 24)}px ${Math.round((Math.random() - 0.5) * 18)}px`);

  function open() {
    if (active) return;
    if (!$("#settings").hidden) closeSettings();
    document.querySelector(".palette-bg, .pe-bg, .help-bg")?.remove();
    document.body.classList.remove("drawer-open");
    active = true;
    enteredAt = Date.now();
    amb.hidden = false;
    document.body.classList.add("ambient");
    update();
    updateSys();
    requestAnimationFrame(() => {
      amb.classList.add("on");
      window.jarvisCore?.place?.();
    });
    tick = setInterval(update, 1000);
    sysTick = setInterval(updateSys, 5000);
    driftTick = setInterval(drift, 60_000);
  }
  function close() {
    if (!active) return;
    active = false;
    amb.classList.remove("on", "dim");
    document.body.classList.remove("ambient");
    window.jarvisCore?.place?.();
    clearInterval(tick);
    clearInterval(sysTick);
    clearInterval(driftTick);
    setTimeout(() => !active && (amb.hidden = true), 700);
  }
  window.jarvisAmbient = { open, close, active: () => active };

  // Ce que dit Jarvis pendant la veille s'affiche en sous-titre.
  new MutationObserver((list) => {
    if (!active) return;
    for (const r of list) for (const n of r.addedNodes) {
      if (!n.classList?.contains("bot")) continue;
      const sub = $a(".amb-sub");
      sub.textContent = n.textContent.trim().slice(0, 260);
      sub.classList.add("on");
      clearTimeout(subTimer);
      subTimer = setTimeout(() => sub.classList.remove("on"), 14_000);
    }
  }).observe(document.getElementById("chat"), { childList: true });

  // Sortie au moindre geste ; entrée après un moment sans rien toucher.
  function onInput(e) {
    if (e.type === "pointermove") {
      const moved = Math.hypot(e.clientX - px, e.clientY - py) > 14;
      px = e.clientX;
      py = e.clientY;
      if (!moved) return;
    }
    if (active && Date.now() - enteredAt > 900) close();
    lastInput = Date.now();
  }
  for (const ev of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(ev, onInput, { passive: true, capture: true });
  setInterval(() => {
    const after = prefs.ambientAfter * 60_000;
    if (!after || active || document.hidden || Date.now() - lastInput < after) return;
    if (state.busy || state.speaking || state.listening || !$("#settings").hidden || document.querySelector(".palette-bg, .pe-bg, .help-bg, .modal-bg:not([hidden])")) return;
    open();
  }, 15_000);
  $("#ambientBtn")?.addEventListener("click", () => setTimeout(open, 150));

  // ---------- Aide : raccourcis et commandes vocales ----------
  function help() {
    if (document.querySelector(".help-bg")) return;
    const bg = el("div", "help-bg");
    const box = el("div", "help");
    const k = (keys) => keys.split("+").map((x) => `<kbd>${x.trim()}</kbd>`).join(" + ");
    const rows = (list) => list.map(([a, b]) => `<li><span>${a}</span><em>${b}</em></li>`).join("");
    box.innerHTML = `<div class="help-head"><h3>Raccourcis et commandes</h3><button type="button" class="x-btn" title="Fermer">×</button></div>
      <div class="help-cols">
        <section><h4>Clavier</h4><ul>${rows([
          [k("Ctrl + Espace"), "Parler à Jarvis depuis n'importe quelle appli"],
          [k("Espace"), "Maintenir pour parler (hors zone de texte)"],
          [k("Ctrl + K"), "Palette : tout faire en tapant quelques lettres"],
          [k("Ctrl + ←") + " " + k("→"), "Changer d'onglet"],
          [k("Échap"), "Fermer une fenêtre, une fiche, le mode veille"],
          [k("?"), "Cette aide"],
        ])}</ul></section>
        <section><h4>À dire (réponse immédiate)</h4><ul>${rows([
          ["« Jarvis, mode jeu »", "Lance un protocole (jeu, travail, bonne nuit, fête…)"],
          ["« Volume à 30 »", "Règle le volume du PC ; « monte le son », « coupe le son »"],
          ["« Mode veille »", "Écran d'ambiance avec la sphère en grand"],
          ["« Ne pas déranger »", "Plus d'annonces ni de bips automatiques"],
          ["« Aide »", "Ouvre cette fenêtre"],
        ])}</ul></section>
        <section><h4>À demander à Jarvis</h4><ul>${rows([
          ["« Quoi de neuf dans l'actu ? »", "Les titres du jour"],
          ["« Mets du Daft Punk »", "Musique sur Spotify"],
          ["« Rappelle-moi dans 20 minutes… »", "Minuteur avec anneau autour de la sphère"],
          ["« Comment va le PC ? »", "Processeur, mémoire, disque"],
          ["« Résume mes mails »", "Gmail, agenda et tâches Google"],
        ])}</ul></section>
        <section><h4>Souris</h4><ul>${rows([
          ["Points autour de la sphère", "Survol : fiche du PC ; clic : l'épingler"],
          ["Clic sur la sphère", "Parler"],
          ["Bouton lune (en haut)", "Mode veille"],
          ["Widgets → Ajouter", "Protocoles, Actualités, Applis…"],
        ])}</ul></section>
      </div>`;
    bg.append(box);
    document.body.append(bg);
    const closeHelp = () => bg.remove();
    box.querySelector(".x-btn").onclick = closeHelp;
    bg.addEventListener("mousedown", (e) => e.target === bg && closeHelp());
  }
  window.jarvisHelp = help;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return document.querySelector(".help-bg")?.remove();
    if (e.key === "?" && !isTyping() && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      help();
    }
  });

  // ---------- Réglages → Veille et annonces ----------
  window.annonceSection = (nav) => {
    const sec = el("section", "set-section");
    sec.id = "sec_Annonces";
    const head = el("div", "set-head");
    const ic = el("div", "set-icon");
    ic.append(iconEl("bell", 20));
    const titles = el("div", "set-titles");
    titles.append(el("h4", null, "Veille et annonces"), el("p", null, "Ce que Jarvis fait de lui-même : écran de veille, rappels de rendez-vous, nouveaux mails, briefing du matin."));
    head.append(ic, titles);
    sec.append(head);
    const field = (label, pairs, key, conv = (v) => v) => {
      const f = el("div", "field");
      const s = el("select");
      for (const [v, l] of pairs) s.append(new Option(l, v));
      s.value = String(prefs[key]);
      s.onchange = () => {
        prefs[key] = conv(s.value);
        savePrefs();
        if (key === "dndNight") window.renderGlance?.();
      };
      f.append(el("label", null, label), s);
      sec.append(f);
    };
    const bool = (v) => v === "true";
    field("Mode veille", [["0", "Jamais tout seul"], ["2", "Après 2 min sans rien toucher"], ["5", "Après 5 min"], ["10", "Après 10 min"], ["20", "Après 20 min"], ["30", "Après 30 min"]], "ambientAfter", Number);
    field("Briefing du matin", [["true", "Parlé à la première ouverture"], ["false", "Désactivé"]], "briefing", bool);
    field("Rappel de rendez-vous", [["0", "Désactivé"], ["5", "5 min avant"], ["10", "10 min avant"], ["15", "15 min avant"], ["30", "30 min avant"]], "eventLead", Number);
    field("Nouveaux mails", [["true", "Annoncés"], ["false", "Silencieux"]], "mails", bool);
    field("PC qui chauffe", [["true", "Alerte"], ["false", "Rien"]], "heat", bool);
    field("Ne pas déranger la nuit", [["true", "Oui, de 23 h à 8 h"], ["false", "Non"]], "dndNight", bool);
    const tryBtn = el("button", "proj-link set-link");
    tryBtn.type = "button";
    tryBtn.append(iconEl("moon", 14), document.createTextNode("Essayer le mode veille"));
    tryBtn.onclick = () => (closeSettings(), setTimeout(open, 300));
    sec.append(tryBtn);
    const navBtn = el("button", "set-nav-item");
    navBtn.type = "button";
    navBtn.append(iconEl("bell", 16), el("span", null, "Veille et annonces"));
    navBtn.onclick = () => sec.scrollIntoView({ behavior: "smooth", block: "start" });
    nav.append(navBtn);
    return sec;
  };

  // ---------- Palette ----------
  (window.paletteExtras ||= []).push((add) => {
    add("moon", "Mode veille", () => setTimeout(open, 200), "Écran");
    add(dnd.active() ? "bell" : "bell-off", dnd.active() ? "Désactiver « ne pas déranger »" : "Activer « ne pas déranger »", () => dnd.toggle(), "Annonces");
    add("keyboard", "Raccourcis et commandes vocales", help, "Aide");
    add("sunrise", "Briefing parlé maintenant", () => (goTo(0), briefing(true)), "Jarvis");
  });
  window.jarvisBriefing = () => briefing(true);
})();
