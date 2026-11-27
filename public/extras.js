// Petits plus de l'interface : sons, thèmes de couleur, anneaux autour de la sphère (minuteur, musique)
// et raccourci clavier global (le lanceur Windows prévient la page, qui se met à écouter).
(() => {
  // ---------- Sons d'interface (synthétisés, rien à télécharger ; réglage « Sons de l'interface ») ----------
  let ctx = null;
  const last = {};
  function tone(f1, f2, start, dur, vol, type = "sine") {
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    if (f2 !== f1) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const SOUNDS = {
    tick: () => tone(2400, 2400, 0, 0.03, 0.02),
    open: () => (tone(660, 990, 0, 0.09, 0.05), tone(1320, 1320, 0.07, 0.08, 0.03)),
    close: () => tone(990, 560, 0, 0.1, 0.035),
    notif: () => (tone(880, 880, 0, 0.12, 0.045, "triangle"), tone(1320, 1320, 0.09, 0.16, 0.04, "triangle")),
    error: () => (tone(260, 210, 0, 0.12, 0.03, "square"), tone(260, 210, 0.15, 0.14, 0.025, "square")),
    listen: () => (tone(420, 1260, 0, 0.14, 0.06), tone(1680, 1680, 0.12, 0.08, 0.03)),
    reply: () => [0, 0.05, 0.1].forEach((d, i) => tone(1800 + i * 400, 1800 + i * 400, d, 0.035, 0.018)),
    launch: () => (tone(300, 1500, 0, 0.22, 0.05, "triangle"), tone(1500, 2200, 0.18, 0.08, 0.025)),
    theme: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, i * 0.06, 0.18, 0.035, "triangle")),
  };
  const sfx = (window.sfx = (name) => {
    if (state.status?.uiSounds === false || !SOUNDS[name]) return;
    const now = performance.now();
    if (now - (last[name] || 0) < 90) return; // pas de rafale
    last[name] = now;
    try {
      ctx ||= new AudioContext();
      if (ctx.state !== "running") return void ctx.resume(); // le navigateur attend un premier clic
      SOUNDS[name]();
    } catch {
      // Pas de son disponible : tant pis.
    }
  });
  const toast0 = toast;
  toast = function (msg, isError = false) {
    sfx(isError ? "error" : "notif");
    return toast0(msg, isError);
  };
  const setMode0 = setMode;
  let lastMode = "";
  setMode = function (mode) {
    if (mode === "listening" && lastMode !== "listening") sfx("listen");
    lastMode = mode || "";
    return setMode0.apply(this, arguments);
  };
  hooks.reply.push(() => sfx("reply"));
  let drawerOn = false;
  new MutationObserver(() => {
    const on = document.body.classList.contains("drawer-open");
    if (on !== drawerOn) sfx((drawerOn = on) ? "open" : "close");
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // ---------- Thèmes de couleur (réglage « Thème de couleur ») ----------
  const core = window.jarvisCore;
  // Pastilles à la place de la liste déroulante : un clic montre tout de suite le thème, « Enregistrer » le garde.
  window.themeSwatches = (select) => {
    const row = el("div", "theme-row");
    for (const o of select.options) {
      const t = core.themes[o.value];
      if (!t) continue;
      const b = el("button", "theme-sw" + (o.value === select.value ? " on" : ""));
      b.type = "button";
      b.title = o.textContent;
      b.style.setProperty("--a", `rgb(${t.idle})`);
      b.style.setProperty("--b", `rgb(${t.speaking})`);
      b.append(el("i"), el("span", null, o.textContent.replace(/\s*\(.*\)$/, "")));
      b.onclick = () => {
        select.value = o.value;
        row.querySelectorAll(".theme-sw").forEach((x) => x.classList.toggle("on", x === b));
        core.setTheme(o.value);
        sfx("theme");
      };
      row.append(b);
    }
    select.style.display = "none";
    return row;
  };
  hooks.status.push(() => state.status?.theme && core.setTheme(state.status.theme));
  // Réglages fermés sans enregistrer : on revient au thème enregistré.
  const closeSettings0 = closeSettings;
  closeSettings = function () {
    const r = closeSettings0.apply(this, arguments);
    core.setTheme(state.status?.theme || "jarvis");
    return r;
  };

  // ---------- Anneaux autour de la sphère : minuteur (extérieur) et musique (intérieur) ----------
  const rings = document.querySelector(".orb .hud-rings");
  const reactor = document.getElementById("reactor");
  if (rings && reactor) {
    rings.insertAdjacentHTML(
      "beforeend",
      '<circle class="ring-music" cx="100" cy="100" r="89.5" pathLength="100" transform="rotate(-90 100 100)"/><g class="ring-head"><circle cx="100" cy="10.5" r="2.3"/></g><circle class="ring-timer" cx="100" cy="100" r="93" pathLength="100" transform="rotate(-90 100 100)"/>',
    );
    const ringT = rings.querySelector(".ring-timer"), ringM = rings.querySelector(".ring-music"), head = rings.querySelector(".ring-head");
    const readout = el("div", "core-readout");
    reactor.append(readout);
    const two = (n) => String(n).padStart(2, "0");
    const fmtLeft = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return `${h ? `${h}:${two(m)}` : m}:${two(s % 60)}`;
    };
    // Saut (nouveau morceau, avance rapide) : pas d'animation, sinon l'anneau ferait le tour à l'envers.
    const jump = (...els) => {
      els.forEach((e) => e.classList.add("jump"));
      requestAnimationFrame(() => requestAnimationFrame(() => els.forEach((e) => e.classList.remove("jump"))));
    };
    let lastT = null, flashUntil = 0, lastMf = null, readKey = "";
    function ringsTick() {
      if (document.hidden) return;
      const now = Date.now();
      const t = timers.length ? timers.reduce((a, b) => (a.end <= b.end ? a : b)) : null;
      if (t && !t.start) t.start = now; // minuteur lancé avant cette version
      if (!t && lastT && now >= lastT.end - 1500) flashUntil = now + 2500; // terminé : l'anneau clignote
      lastT = t;
      const fl = flashUntil > now;
      const tf = t ? Math.max(0, Math.min(1, (t.end - now) / Math.max(1000, t.end - t.start))) : fl ? 1 : 0;
      ringT.style.strokeDasharray = `${(tf * 100).toFixed(2)} 100`;
      ringT.classList.toggle("on", !!t || fl);
      ringT.classList.toggle("flash", fl);
      ringT.classList.toggle("last", !!t && t.end - now <= 10_000);

      const m = cache.music?.data;
      const mf = m?.durationMs && m.title ? Math.min(1, (m.progressMs + (m.playing ? now - (cache.music.at || now) : 0)) / m.durationMs) : null;
      if (mf != null && lastMf != null && Math.abs(mf - lastMf) > 0.08) jump(ringM, head);
      lastMf = mf;
      ringM.classList.toggle("on", mf != null);
      ringM.classList.toggle("paused", mf != null && !m.playing);
      head.classList.toggle("on", mf != null && !!m.playing);
      if (mf != null) {
        ringM.style.strokeDasharray = `${(mf * 100).toFixed(2)} 100`;
        head.style.transform = `rotate(${(mf * 360).toFixed(2)}deg)`;
      }

      // Sous « JARVIS » : le minuteur en cours, sinon le titre qui joue.
      const key = t ? `t|${fmtLeft(t.end - now)}|${t.label}` : mf != null && m.playing ? `m|${m.title}` : "";
      if (key === readKey) return;
      readKey = key;
      readout.replaceChildren();
      if (t) readout.append(iconEl("timer", 14), el("b", null, fmtLeft(t.end - now)), el("span", null, t.label));
      else if (key) readout.append(iconEl("music", 14), el("span", null, m.title));
      readout.classList.toggle("on", !!key);
    }
    setInterval(ringsTick, 1000);
    hooks.music.push(ringsTick);
    hooks.timers.push(ringsTick);
    ringsTick();
  }

  // ---------- Réglages → Micro : autoriser la fenêtre à utiliser le micro, puis le tester ----------
  const BLOCKED = "Le micro est bloqué pour la fenêtre Jarvis. Clique sur « Ouvrir l'autorisation du micro », mets Micro sur « Autoriser », puis reviens ici.";
  window.micSection = (nav) => {
    const sec = el("section", "set-section");
    sec.id = "sec_Micro";
    const head = el("div", "set-head");
    const ic = el("div", "set-icon");
    ic.append(iconEl("mic", 20));
    const titles = el("div", "set-titles");
    titles.append(el("h4", null, "Micro"), el("p", null, "Pour que Jarvis t'entende, sa fenêtre doit pouvoir utiliser ton micro. Le son sert seulement à comprendre ce que tu dis."));
    const pill = el("span", "pill warn", "…");
    head.append(ic, titles, pill);
    const btn = el("button", "btn mic-btn");
    btn.type = "button";
    const bar = el("div", "mic-meter");
    const fill = el("i");
    bar.append(fill);
    const row = el("div", "mic-row");
    row.append(btn, bar);
    const info = el("div", "help mic-info", "Clique sur le bouton : la fenêtre te demandera l'autorisation (une seule fois).");
    const fix = el("div", "mic-fix");
    const fixText = el("p", "help", BLOCKED);
    const link = (icon, text, which, tip) => {
      const b = el("button", "proj-link set-link");
      b.type = "button";
      b.append(iconEl(icon, 14), document.createTextNode(text));
      b.onclick = () => api(`/api/open-settings/${which}`, { method: "POST" }).then(() => toast(tip)).catch((e) => toast(e.message, true));
      return b;
    };
    fix.append(
      fixText,
      link("mic", "Ouvrir l'autorisation du micro", "micro-fenetre", "Dans la page qui s'ouvre : Micro → Autoriser, puis reviens ici."),
      link("settings", "Réglages Windows du micro", "micro-windows", "Active l'accès au micro, y compris « Autoriser les applications de bureau »."),
    );
    sec.append(head, row, info, fix);

    const STATES = { granted: ["Autorisé", "on"], denied: ["Bloqué", "off"], prompt: ["À autoriser", "warn"] };
    function show(st, why) {
      const [label, cls] = STATES[st] || STATES.prompt;
      pill.textContent = label;
      pill.className = "pill " + cls;
      btn.replaceChildren(iconEl("mic", 16), document.createTextNode(st === "granted" ? "Tester le micro" : "Autoriser le micro"));
      fix.hidden = st !== "denied";
      fixText.textContent = why || BLOCKED;
      info.textContent =
        st === "granted" ? "Micro autorisé. « Tester le micro » : parle, la barre doit bouger." : st === "denied" ? "" : "Clique sur le bouton : la fenêtre te demandera l'autorisation (une seule fois).";
    }
    show("prompt");
    navigator.permissions
      ?.query({ name: "microphone" })
      .then((p) => {
        show(p.state);
        p.onchange = () => show(p.state); // autorisé ailleurs (page des réglages) : mis à jour tout seul
      })
      .catch(() => {});

    // Test : la barre suit ta voix pendant 6 secondes, puis le micro est relâché.
    function test(stream) {
      const track = stream.getAudioTracks()[0];
      info.textContent = `Micro utilisé : ${track?.label || "micro par défaut"}. Parle : la barre doit bouger.`;
      const ac = new AudioContext();
      const an = ac.createAnalyser();
      an.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const end = performance.now() + 6000;
      bar.classList.add("on");
      (function loop() {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        fill.style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 2.5).toFixed(1)}%`;
        if (performance.now() < end && sec.isConnected) return requestAnimationFrame(loop);
        stream.getTracks().forEach((t) => t.stop());
        ac.close();
        fill.style.width = "0%";
        bar.classList.remove("on");
      })();
    }
    btn.onclick = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        show("granted");
        sfx("open");
        test(stream);
      } catch (e) {
        if (e.name === "NotFoundError") return void (info.textContent = "Aucun micro trouvé : branche un micro ou un casque, puis réessaie.");
        const system = e.name === "NotReadableError" || /system/i.test(e.message);
        show("denied", system ? "Windows (ou une autre appli) empêche l'accès au micro : ouvre les réglages Windows du micro et active l'accès pour les applications de bureau." : BLOCKED);
        sfx("error");
      }
    };

    const navBtn = el("button", "set-nav-item");
    navBtn.type = "button";
    navBtn.append(iconEl("mic", 16), el("span", null, "Micro"));
    navBtn.onclick = () => sec.scrollIntoView({ behavior: "smooth", block: "start" });
    nav.append(navBtn);
    return sec;
  };

  // ---------- Raccourci clavier global : le lanceur Windows prévient la page, qui se met à écouter ----------
  const onPc = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
  if (!onPc) return;
  try {
    new EventSource("/api/events").addEventListener("listen", () => !state.listening && startCommand());
  } catch {
    // Navigateur sans EventSource : le raccourci ne fera que ramener la fenêtre.
  }
  const KEYS = { "ctrl+space": "Ctrl + Espace", "ctrl+alt+j": "Ctrl + Alt + J", "ctrl+shift+space": "Ctrl + Maj + Espace" };
  const input = document.getElementById("input");
  const base = input?.placeholder || "";
  hooks.status.push(() => {
    const k = KEYS[state.status?.hotkey];
    if (input) input.placeholder = k ? `${base}   ·   ${k} pour parler` : base;
  });
})();
