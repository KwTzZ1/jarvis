// Protocoles : routines lancées d'un mot (« Jarvis, mode jeu »), avec un bandeau qui suit les étapes.
// Aussi : commandes instantanées traitées sans passer par l'IA (volume, veille, ne pas déranger…),
// éditeur de protocoles et effet « fête » (sphère arc-en-ciel et confettis).
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const THEME_NAMES = { jarvis: "Jarvis", mark: "Mark", emeraude: "Émeraude", glace: "Glace", nebuleuse: "Nébuleuse" };
  const MEDIA = { play: "Lecture", pause: "Pause", next: "Suivant", previous: "Précédent" };
  const P = (window.jarvisProtocols = { list: [], apps: [], load, run, edit, party });

  async function load(force) {
    if (P.list.length && !force) return P.list;
    try {
      P.list = (await api("/api/protocols")).protocols || [];
      emit("protocols");
    } catch {
      // Serveur occupé : on réessaiera.
    }
    return P.list;
  }
  async function apps() {
    if (!P.apps.length) P.apps = (await api("/api/apps").catch(() => ({ apps: [] }))).apps || [];
    return P.apps;
  }

  // ---------- Étapes ----------
  const appLabel = (id) => P.apps.find((a) => a.id === id)?.label || id;
  function stepLabel(s) {
    switch (s.type) {
      case "say": return "Annonce";
      case "app": return appLabel(s.value);
      case "music": return `Musique : ${s.value}`;
      case "media": return MEDIA[s.value] || "Musique";
      case "volume": return `Volume ${s.value} %`;
      case "theme": return `Thème ${THEME_NAMES[s.value] || s.value}`;
      case "timer": return `Minuteur ${s.value} min`;
      case "ambient": return "Mode veille";
      case "dnd": return s.value === "off" ? "Fin du « ne pas déranger »" : "Ne pas déranger";
      case "party": return "Fête";
      case "web": return "Site web";
      case "lock": return "Verrouillage";
      case "wait": return `Pause ${s.value} s`;
      default: return s.type;
    }
  }
  const spotifyOn = () => !!state.status?.spotify?.connected;
  const STEPS = {
    say: (s, o) => {
      if (o.fromAi) return; // l'IA annonce déjà le protocole
      addMsg("bot", s.value);
      speak(s.value);
    },
    app: (s) => api(`/api/app/${s.value}`, { method: "POST" }),
    music: (s) => api("/api/spotify/play", { method: "POST", body: { query: s.value } }).then(() => setTimeout(refreshMusic, 1500)),
    media: (s) =>
      spotifyOn()
        ? api(`/api/music/${s.value}`, { method: "POST" }).then(() => setTimeout(refreshMusic, 700))
        : api(`/api/pc/${s.value === "next" ? "next" : s.value === "previous" ? "previous" : "play_pause"}`, { method: "POST" }),
    volume: (s) => api("/api/volume", { method: "POST", body: { level: s.value } }).then((v) => dispatchEvent(new CustomEvent("jarvis-volume", { detail: v }))),
    theme: (s) => {
      window.__themeOverride = s.value; // gardé jusqu'au prochain démarrage (le thème enregistré reste le même)
      window.jarvisCore?.setTheme(s.value);
    },
    timer: (s) => startTimer(s.value * 60, s.label || "Minuteur"),
    ambient: () => window.jarvisAmbient?.open(),
    dnd: (s) => window.jarvisDnd?.set(s.value !== "off"),
    party: (s) => party(s.value),
    web: (s) => window.openInJarvis?.(s.value),
    lock: () => api("/api/pc/lock", { method: "POST" }),
    wait: (s) => sleep(s.value * 1000),
  };

  // Bandeau « PROTOCOLE » : chaque étape s'allume quand elle est faite.
  function hud(p) {
    document.querySelector(".proto-hud")?.remove();
    const box = el("div", "proto-hud");
    box.style.setProperty("--pc", p.color || "#5fc3ff");
    const ic = el("span", "proto-hud-ic");
    ic.append(iconEl(p.icon || "zap", 22));
    const head = el("div", "proto-hud-head");
    head.append(el("small", null, "Protocole"), el("b", null, p.name));
    const steps = el("div", "proto-hud-steps");
    p.steps.forEach((s) => steps.append(el("i", null, stepLabel(s))));
    const top = el("div", "proto-hud-top");
    top.append(ic, head);
    box.append(top, steps);
    document.body.append(box);
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("on")));
    return {
      step: (i, ok) => steps.children[i]?.classList.add(ok ? "done" : "fail"),
      close: () => {
        box.classList.remove("on");
        setTimeout(() => box.remove(), 700);
      },
    };
  }

  async function run(p, opts = {}) {
    if (typeof p === "string") p = (await load()).find((x) => x.id === p);
    if (!p) return;
    await apps();
    window.sfx?.("launch");
    const h = hud(p);
    for (let i = 0; i < p.steps.length; i++) {
      let ok = true;
      try {
        await STEPS[p.steps[i].type]?.(p.steps[i], opts);
      } catch (e) {
        ok = false;
        console.warn("Protocole : étape impossible", p.steps[i], e);
      }
      h.step(i, ok);
      await sleep(220);
    }
    setTimeout(h.close, 1600);
  }

  // ---------- Effet fête : sphère arc-en-ciel qui danse et pluie de confettis ----------
  function party(seconds = 20) {
    window.jarvisCore?.party?.(seconds);
    confetti();
    setTimeout(confetti, 1400);
  }
  function confetti() {
    const c = el("canvas", "confetti");
    document.body.append(c);
    const ctx = c.getContext("2d");
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colors = ["#ff5a46", "#ffd166", "#06d6a0", "#5fc3ff", "#b07cff", "#ff70c8", "#ffffff"];
    const bits = Array.from({ length: 170 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.25,
      y: innerHeight * 0.42,
      vx: (Math.random() - 0.5) * 17,
      vy: -Math.random() * 15 - 5,
      r: Math.random() * 6.3,
      vr: (Math.random() - 0.5) * 0.35,
      w: 6 + Math.random() * 7,
      h: 3 + Math.random() * 5,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const end = performance.now() + 4200;
    (function frame(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.vy += 0.32;
        b.vx *= 0.985;
        b.x += b.vx;
        b.y += b.vy;
        b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.globalAlpha = Math.max(0, Math.min(1, (end - now) / 900));
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2)) + 1);
        ctx.restore();
      }
      if (now < end) requestAnimationFrame(frame);
      else c.remove();
    })(performance.now());
  }

  // ---------- Commandes instantanées (sans IA : rien à payer, réponse immédiate) ----------
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9%' ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const FILLER = /^(?:(?:jarvis|ok|hey|dis|peux tu|tu peux|lance|lancer|active|activer|demarre|enclenche|mets|met|passe|en|le|la|les|l'|un|une|mode|protocole|routine)\s+)+/;
  const coreOf = (s) => norm(s).replace(/^jarvis /, "").replace(FILLER, "").replace(/\s+(stp|svp|s'il te plait)$/, "").trim();
  function say(user, text) {
    addMsg("user", user);
    if (!text) return;
    addMsg("bot", text);
    speak(text);
  }
  const setVol = (body) =>
    api("/api/volume", { method: "POST", body }).then((v) => {
      dispatchEvent(new CustomEvent("jarvis-volume", { detail: v }));
      return v;
    });
  window.localCommand = (raw) => {
    const n = norm(raw).replace(/^jarvis /, "");
    if (!n || n.length > 80) return false;
    // Un protocole (« mode jeu », « lance le protocole fête », « bonne nuit »…).
    const c = coreOf(raw);
    const p = c && P.list.find((x) => [x.name, ...x.triggers].some((t) => coreOf(t) === c));
    if (p) {
      addMsg("user", raw);
      run(p);
      return true;
    }
    // Volume du PC.
    let m;
    if ((m = /^(?:(?:mets|met|regle|passe|monte|baisse) )?(?:le )?(?:volume|son)(?: du pc)? (?:a |au |sur )?(\d{1,3}) ?(?:%|pour ?cent)?$/.exec(n))) {
      const level = Math.min(100, +m[1]);
      addMsg("user", raw);
      setVol({ level }).then((v) => (addMsg("bot", `Volume à ${v.level} %.`), speak(`Volume à ${v.level} pour cent.`))).catch((e) => toast(e.message, true));
      return true;
    }
    if ((m = /^(?:(?:monte|augmente)(?: le (?:son|volume))?(?: de (\d{1,2}))?|plus fort|un peu plus fort)$/.exec(n)) || (m = /^(?:(?:baisse|diminue)(?: le (?:son|volume))?(?: de (\d{1,2}))?|moins fort|un peu moins fort)$/.exec(n))) {
      const down = /baisse|diminue|moins/.test(n);
      const step = (+m[1] || 10) * (down ? -1 : 1);
      addMsg("user", raw);
      api("/api/volume")
        .then((v) => setVol({ level: Math.max(0, Math.min(100, v.level + step)) }))
        .then((v) => addMsg("bot", `Volume à ${v.level} %.`))
        .catch((e) => toast(e.message, true));
      return true;
    }
    if (/^(?:coupe le son|coupe le volume|mute|sourdine|mets en sourdine|silence)$/.test(n)) {
      addMsg("user", raw);
      setVol({ muted: true }).then(() => addMsg("bot", "Son coupé.")).catch((e) => toast(e.message, true));
      return true;
    }
    if (/^(?:remets le son|remet le son|reactive le son|rallume le son|unmute)$/.test(n)) {
      addMsg("user", raw);
      setVol({ muted: false }).then((v) => (addMsg("bot", `Son remis, volume à ${v.level} %.`), speak("Son remis."))).catch((e) => toast(e.message, true));
      return true;
    }
    // Veille, ne pas déranger, aide.
    if (/^(?:mode veille|veille|ecran de veille|mets toi en veille|passe en veille)$/.test(n)) {
      say(raw, "Mode veille. Je reste à l'écoute.");
      setTimeout(() => window.jarvisAmbient?.open(), 1600);
      return true;
    }
    if (/^(?:(?:active |mets )?(?:le )?(?:mode )?ne pas deranger|mode silencieux)$/.test(n)) {
      say(raw, "Ne pas déranger activé : je ne parle plus de moi-même.");
      window.jarvisDnd?.set(true);
      return true;
    }
    if (/^(?:desactive|coupe|arrete|enleve|retire|fin du) (?:le )?(?:mode )?ne pas deranger$/.test(n)) {
      window.jarvisDnd?.set(false);
      say(raw, "Ne pas déranger désactivé.");
      return true;
    }
    if (/^(?:aide|commandes|raccourcis|qu'est ce que tu sais faire|que sais tu faire)$/.test(n)) {
      addMsg("user", raw);
      window.jarvisHelp?.();
      return true;
    }
    return false;
  };

  // ---------- Éditeur ----------
  const STEP_DEFS = [
    ["say", "Dire une phrase"],
    ["app", "Ouvrir une appli"],
    ["music", "Lancer de la musique"],
    ["media", "Lecture / pause"],
    ["volume", "Régler le volume"],
    ["theme", "Changer de thème"],
    ["timer", "Lancer un minuteur"],
    ["dnd", "Ne pas déranger"],
    ["ambient", "Mode veille"],
    ["party", "Effet fête"],
    ["web", "Ouvrir un site"],
    ["lock", "Verrouiller le PC"],
    ["wait", "Attendre"],
  ];
  const ICON_CHOICES = ["zap", "gamepad", "briefcase", "moon", "party", "music", "sun", "heart", "home", "headphones", "sparkles", "timer"];
  const COLOR_CHOICES = ["#5fc3ff", "#ff5a46", "#ffb347", "#3fdc9e", "#b07cff", "#ea6ad6", "#9fc3ff", "#f5f5f5"];
  const DEFAULT_VALUE = { say: "", app: "discord", music: "", media: "pause", volume: 50, theme: "jarvis", timer: 25, dnd: "on", party: 20, web: "https://", wait: 3 };
  const select = (pairs, value) => {
    const s = el("select");
    for (const [v, l] of pairs) s.append(new Option(l, v));
    s.value = value;
    return s;
  };

  async function edit(p) {
    await apps();
    document.querySelector(".pe-bg")?.remove();
    const isNew = !p;
    const draft = JSON.parse(JSON.stringify(p || { id: "", name: "", icon: "zap", color: "#5fc3ff", triggers: [], steps: [{ type: "say", value: "" }] }));
    const bg = el("div", "pe-bg");
    const box = el("div", "pe");
    bg.append(box);
    const head = el("div", "pe-head");
    const title = el("h3", null, isNew ? "Nouveau protocole" : `Protocole « ${draft.name} »`);
    const x = el("button", "x-btn");
    x.type = "button";
    x.title = "Fermer";
    x.append(iconEl("x", 16));
    head.append(title, x);

    const body = el("div", "pe-body");
    const row = (label, control, help) => {
      const f = el("div", "pe-field");
      f.append(el("label", null, label), control);
      if (help) f.append(el("small", null, help));
      body.append(f);
      return f;
    };
    const name = el("input");
    name.value = draft.name;
    name.maxLength = 40;
    name.placeholder = "Mode cinéma";
    row("Nom", name);
    const trig = el("input");
    trig.value = draft.triggers.join(", ");
    trig.placeholder = "mode cinéma, on regarde un film";
    row("Phrases pour le lancer", trig, "Séparées par des virgules. Dis « Jarvis » puis une de ces phrases.");

    const icons = el("div", "pe-icons");
    for (const ic of ICON_CHOICES) {
      const b = el("button", "pe-icon" + (ic === draft.icon ? " on" : ""));
      b.type = "button";
      b.append(iconEl(ic, 18));
      b.onclick = () => {
        draft.icon = ic;
        icons.querySelectorAll(".pe-icon").forEach((y) => y.classList.toggle("on", y === b));
      };
      icons.append(b);
    }
    row("Icône", icons);
    const colors = el("div", "pe-colors");
    for (const col of COLOR_CHOICES) {
      const b = el("button", "pe-color" + (col === draft.color ? " on" : ""));
      b.type = "button";
      b.style.setProperty("--c", col);
      b.title = col;
      b.onclick = () => {
        draft.color = col;
        colors.querySelectorAll(".pe-color").forEach((y) => y.classList.toggle("on", y === b));
      };
      colors.append(b);
    }
    row("Couleur", colors);

    const stepsBox = el("div", "pe-steps");
    row("Étapes (dans l'ordre)", stepsBox);
    const addStep = el("button", "proj-link set-link pe-add");
    addStep.type = "button";
    addStep.append(iconEl("plus", 14), document.createTextNode("Ajouter une étape"));
    addStep.onclick = () => {
      draft.steps.push({ type: "say", value: "" });
      drawSteps();
    };
    body.append(addStep);

    function valueControl(s) {
      const wrap = el("div", "pe-val");
      const set = (k, v) => (s[k] = v);
      if (s.type === "say" || s.type === "music" || s.type === "web") {
        const i = el("input");
        i.value = s.value ?? "";
        i.placeholder = { say: "Mode cinéma activé, bon film !", music: "lofi focus, un artiste, une playlist…", web: "https://www.netflix.com" }[s.type];
        i.oninput = () => set("value", i.value);
        wrap.append(i);
      } else if (s.type === "app") {
        const sel = select(P.apps.map((a) => [a.id, a.label]), s.value);
        sel.onchange = () => set("value", sel.value);
        wrap.append(sel);
      } else if (s.type === "media") {
        const sel = select(Object.entries(MEDIA), s.value);
        sel.onchange = () => set("value", sel.value);
        wrap.append(sel);
      } else if (s.type === "theme") {
        const sel = select(Object.entries(THEME_NAMES), s.value);
        sel.onchange = () => set("value", sel.value);
        wrap.append(sel);
      } else if (s.type === "dnd") {
        const sel = select([["on", "Activer"], ["off", "Désactiver"]], s.value);
        sel.onchange = () => set("value", sel.value);
        wrap.append(sel);
      } else if (s.type === "volume") {
        const r = el("input");
        Object.assign(r, { type: "range", min: 0, max: 100, step: 5, value: s.value });
        const out = el("span", "pe-unit", `${s.value} %`);
        r.oninput = () => (set("value", +r.value), (out.textContent = `${r.value} %`));
        wrap.append(r, out);
      } else if (s.type === "timer" || s.type === "party" || s.type === "wait") {
        const i = el("input");
        Object.assign(i, { type: "number", min: 1, max: s.type === "timer" ? 600 : s.type === "party" ? 120 : 30, value: s.value });
        i.oninput = () => set("value", +i.value);
        wrap.append(i, el("span", "pe-unit", s.type === "timer" ? "min" : "s"));
        if (s.type === "timer") {
          const l = el("input");
          l.value = s.label || "";
          l.placeholder = "Nom du minuteur";
          l.oninput = () => set("label", l.value);
          wrap.append(l);
        }
      } else wrap.append(el("span", "pe-none", "Rien à régler"));
      return wrap;
    }
    function drawSteps() {
      stepsBox.replaceChildren();
      draft.steps.forEach((s, i) => {
        const r = el("div", "pe-step");
        r.append(el("span", "pe-num", String(i + 1)));
        const type = select(STEP_DEFS, s.type);
        type.onchange = () => {
          draft.steps[i] = { type: type.value, value: DEFAULT_VALUE[type.value] };
          if (type.value === "timer") draft.steps[i].label = draft.name || "Minuteur";
          drawSteps();
        };
        r.append(type, valueControl(s));
        const tools = el("div", "pe-tools");
        const mk = (icon, title, fn, disabled) => {
          const b = el("button", "pe-tool");
          b.type = "button";
          b.title = title;
          b.disabled = !!disabled;
          b.append(iconEl(icon, 14));
          b.onclick = fn;
          tools.append(b);
        };
        mk("chevron-up", "Monter", () => (([draft.steps[i - 1], draft.steps[i]] = [draft.steps[i], draft.steps[i - 1]]), drawSteps()), i === 0);
        mk("chevron-down", "Descendre", () => (([draft.steps[i + 1], draft.steps[i]] = [draft.steps[i], draft.steps[i + 1]]), drawSteps()), i === draft.steps.length - 1);
        mk("trash", "Retirer", () => (draft.steps.splice(i, 1), drawSteps()));
        r.append(tools);
        stepsBox.append(r);
      });
    }
    drawSteps();

    const err = el("p", "pe-err");
    err.hidden = true;
    const foot = el("div", "pe-foot");
    const del = el("button", "btn ghost pe-del");
    del.type = "button";
    del.append(iconEl("trash", 14), document.createTextNode("Supprimer"));
    if (isNew) del.style.display = "none";
    const test = el("button", "btn ghost");
    test.type = "button";
    test.append(iconEl("play", 14), document.createTextNode("Essayer"));
    const ok = el("button", "btn");
    ok.type = "button";
    ok.textContent = "Enregistrer";
    foot.append(del, el("span", "pe-space"), test, ok);
    box.append(head, body, err, foot);
    document.body.append(bg);
    name.focus();

    const close = () => bg.remove();
    x.onclick = close;
    bg.addEventListener("mousedown", (e) => e.target === bg && close());
    bg.addEventListener("keydown", (e) => e.key === "Escape" && (e.stopPropagation(), close()));
    const collect = () => ({
      ...draft,
      name: name.value.trim(),
      triggers: trig.value.split(",").map((t) => t.trim()).filter(Boolean),
      steps: draft.steps.filter((s) => !["say", "music", "web"].includes(s.type) || String(s.value || "").trim()),
    });
    const persist = async (list) => {
      P.list = (await api("/api/protocols", { method: "PUT", body: { protocols: list } })).protocols;
      emit("protocols");
    };
    test.onclick = () => {
      const d = collect();
      if (!d.steps.length) return showErr("Ajoute au moins une étape.");
      run({ ...d, name: d.name || "Essai" });
    };
    const showErr = (m) => ((err.textContent = m), (err.hidden = false));
    ok.onclick = async () => {
      const d = collect();
      if (!d.name) return showErr("Donne un nom au protocole.");
      if (!d.steps.length) return showErr("Ajoute au moins une étape.");
      const list = P.list.slice();
      const i = list.findIndex((y) => y.id && y.id === d.id);
      if (i >= 0) list[i] = d;
      else list.push({ ...d, id: "" });
      try {
        await persist(list);
        toast(`Protocole « ${d.name} » enregistré.`);
        close();
      } catch (e) {
        showErr(e.message);
      }
    };
    del.onclick = async () => {
      if (!confirm(`Supprimer le protocole « ${draft.name} » ?`)) return;
      try {
        await persist(P.list.filter((y) => y.id !== draft.id));
        toast("Protocole supprimé.");
        close();
      } catch (e) {
        showErr(e.message);
      }
    };
  }

  // ---------- Palette (Ctrl+K) ----------
  (window.paletteExtras ||= []).push((add) => {
    for (const p of P.list) add(p.icon || "zap", `Protocole : ${p.name}`, () => run(p), "Protocole");
    add("plus", "Créer un protocole", () => edit(), "Protocole");
    add("party", "Effet fête", () => party(20), "Fun");
    for (const [id, label] of Object.entries(THEME_NAMES))
      add("sparkles", `Thème : ${label}`, () => {
        window.__themeOverride = id;
        window.jarvisCore?.setTheme(id);
      }, "Thème");
    for (const lvl of [0, 20, 40, 60, 80, 100]) add(lvl ? "volume" : "volume-x", `Volume du PC à ${lvl} %`, () => setVol({ level: lvl }).catch((e) => toast(e.message, true)), "Volume");
  });

  load();
})();
