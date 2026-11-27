// Noyau de Jarvis (version HUD) :
// - sphère 3D de points reliés en maillage, imparfaite et vivante, qui passe au violet mauve quand Jarvis parle ;
// - cadran HUD : anneau des secondes, jauges du PC reliées au noyau ;
// - mini-sphère en bas à droite sur les autres onglets (un clic ramène à l'Assistant) ;
// - séquence de démarrage.
(() => {
  const canvas = document.getElementById("coreCanvas");
  const reactor = document.getElementById("reactor");
  if (!canvas || !reactor) return;
  const ctx = canvas.getContext("2d");
  window.jarvisCore = window.jarvisCore || { analyser: null };

  // ---------- Sphère « plexus » : points semés au hasard (avec des amas), reliés à leurs voisins ----------
  const rnd = () => {
    const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u);
    return [Math.cos(a) * r, u, Math.sin(a) * r];
  };
  const N = 700;
  const pts = [];
  const seeds = Array.from({ length: 10 }, rnd);
  for (let i = 0; i < N; i++) {
    let [x, y, z] = rnd();
    if (Math.random() < 0.45) {
      // Amas : le point se rapproche d'un centre (zones denses, comme un vrai réseau).
      const c = seeds[(Math.random() * seeds.length) | 0];
      x = c[0] + x * 0.38;
      y = c[1] + y * 0.38;
      z = c[2] + z * 0.38;
      const l = Math.hypot(x, y, z) || 1;
      (x /= l), (y /= l), (z /= l);
    }
    const r = 1 - Math.random() ** 2.5 * 0.16; // presque tous en surface, quelques-uns à l'intérieur
    pts.push({ x: x * r, y: y * r, z: z * r, k: Math.random() * 6.283, sx: 0, sy: 0, z2: 0, deg: 0, g: 1, sp: Math.random() ** 3, f: 7 + Math.random() * 9 });
  }
  // Liaisons : chaque point vers ses voisins proches (6 au plus), plus quelques longues lignes.
  const links = [];
  const near = pts.map(() => []);
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++) {
      const p = pts[i], q = pts[j];
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
      if (d < 0.058) near[i].push([d, j]);
    }
  near.forEach((list, i) => {
    list.sort((a, b) => a[0] - b[0]);
    for (const [, j] of list.slice(0, 6)) {
      links.push(i, j);
      pts[i].deg++;
      pts[j].deg++;
    }
  });
  for (let n = 0; n < 40; n++) {
    const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0;
    const p = pts[i], q = pts[j];
    if (i !== j && (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 < 0.45) links.push(i, j);
  }
  // Étincelles qui s'échappent de la sphère.
  const DUST = 160;
  const dust = [];
  const newDust = (d = {}) => Object.assign(d, { a: Math.random() * 6.283, r: 1 + Math.random() * 1.3, v: 0.0015 + Math.random() * 0.004, len: 0.02 + Math.random() * 0.07 });
  for (let i = 0; i < DUST; i++) dust.push(newDust());

  let W = 0, H = 0, R = 0;
  function resize() {
    // Taille réelle (sans le zoom de la mini-sphère), pour garder un dessin net.
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.32;
  }
  new ResizeObserver(resize).observe(canvas);

  // Bleu au repos, cyan à l'écoute, bleu profond en réflexion, VIOLET MAUVE quand il parle.
  const COLORS = { idle: [95, 195, 255], listening: [120, 232, 255], thinking: [105, 150, 255], speaking: [182, 104, 255], offline: [110, 125, 140] };
  const mode = () => {
    const c = reactor.classList;
    if (c.contains("offline")) return "offline";
    if (typeof state !== "undefined" && state.speaking) return "speaking"; // suit la voix, quoi qu'affiche l'écran
    return c.contains("listening") ? "listening" : c.contains("thinking") ? "thinking" : c.contains("speaking") ? "speaking" : "idle";
  };
  const isMini = () => !!document.body.dataset.page && document.body.dataset.page !== "0";

  let energy = 0.2, spin = 0, color = [95, 195, 255], skip = false, frameNo = 0, lastRgb = "", lvl = 0, emitA = 0, fAmt = 0, fx = 1, fy = 0;
  const tips = [];
  const buf = new Uint8Array(128);
  function voiceLevel() {
    const an = window.jarvisCore.analyser;
    if (!an) return null;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += (buf[i] - 128) ** 2;
    return Math.min(1, Math.sqrt(sum / buf.length) / 30);
  }

  const bins = [[], [], [], []];
  const ALPHA = [0.22, 0.42, 0.72, 1];
  const SIZE = [0.8, 1.1, 1.5, 2.1];

  function frame(now) {
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize(); // filet si l'observateur n'a rien vu
    if (document.hidden || !W) return setTimeout(() => requestAnimationFrame(frame), 400);
    const mini = isMini();
    const m = mode();
    // Au repos ou en mini, une image sur deux suffit (moitié moins de calcul) ; pleine vitesse quand il parle, écoute ou réfléchit.
    if ((mini || m === "idle" || m === "offline") && (skip = !skip)) return requestAnimationFrame(frame);
    const t = now / 1000;
    const level = voiceLevel();
    // Volume de la voix, lissé : monte vite, redescend doucement. Sans analyse du son : rythme de parole simulé.
    const raw = m === "speaking" ? level ?? Math.max(0, Math.sin(t * 9.1) * Math.sin(t * 3.7 + 1)) ** 0.7 * (0.65 + 0.35 * Math.sin(t * 1.3)) : 0;
    lvl = raw > lvl ? lvl + (raw - lvl) * 0.5 : lvl * 0.9;
    const target = {
      idle: 0.18 + 0.05 * Math.sin(t * 1.3),
      listening: 0.6,
      thinking: 0.42,
      speaking: 0.35 + lvl * 0.65,
      offline: 0.05,
    }[m];
    energy += (target - energy) * 0.1;
    spin += { idle: 0.003, listening: 0.006, thinking: 0.022, speaking: 0.008, offline: 0.0008 }[m];
    const want = COLORS[m];
    color = color.map((c, i) => c + (want[i] - c) * 0.07);
    const [cr, cg, cb] = color.map(Math.round);
    const rgb = `${cr},${cg},${cb}`;
    // Toute l'interface suit la couleur de la sphère (bleu, mauve quand il parle) ; mise à jour seulement si elle change.
    if (rgb !== lastRgb && frameNo++ % 4 === 0) document.documentElement.style.setProperty("--core-rgb", (lastRgb = rgb));
    const cx = W / 2, cy = H / 2;
    const rad = R * (1 + energy * 0.1);

    ctx.clearRect(0, 0, W, H);
    // Lueur très discrète derrière : c'est le réseau qui doit ressortir.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 1.35);
    glow.addColorStop(0, `rgba(${rgb},${0.05 + energy * 0.12})`);
    glow.addColorStop(0.7, `rgba(${rgb},${0.025 + energy * 0.05})`);
    glow.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Projection : rotation lente + surface qui ondule (forme imparfaite), plus fort quand il parle.
    const cosY = Math.cos(spin), sinY = Math.sin(spin);
    const tilt = 0.3 + Math.sin(t * 0.21) * 0.12;
    const cosX = Math.cos(tilt), sinX = Math.sin(tilt);
    const amp = m === "speaking" ? 0.04 + energy * 0.08 : m === "listening" ? 0.08 : 0.04;
    const tt = t * (m === "speaking" ? 2 : m === "thinking" ? 1.5 : 0.6);
    // Pics de la voix : une zone du contour (qui tourne doucement) lance des pointes au rythme de la voix,
    // une seconde zone, à l'opposé, répond plus faiblement.
    emitA += 0.004 + lvl * 0.02;
    const e1x = Math.cos(emitA) * 0.958, e1y = Math.sin(emitA) * 0.958, e1z = 0.287;
    const e2x = Math.cos(emitA + 2.7) * 0.98, e2y = Math.sin(emitA + 2.7) * 0.98, e2z = 0.196;
    const rays = lvl > 0.03 ? new Path2D() : null;
    // Point du PC survolé : la sphère s'illumine et se gonfle doucement de son côté.
    const fc = window.jarvisCore.focus;
    if (fc) (fx = fc[0]), (fy = fc[1]);
    fAmt += ((fc && !mini ? 1 : 0) - fAmt) * 0.1;
    const focusOn = fAmt > 0.01;
    for (const p of pts) {
      const n = Math.sin(p.x * 2.1 + tt) * Math.sin(p.y * 2.7 - tt * 0.8) * Math.sin(p.z * 1.9 + tt * 1.3) + 0.45 * Math.sin(p.x * 4.6 - tt * 1.6) * Math.sin(p.z * 4.1 + tt * 1.1);
      const d = 1 + amp * n + 0.004 * Math.sin(p.k + t * 11);
      const px = p.x * d, py = p.y * d, pz = p.z * d;
      const x1 = px * cosY - pz * sinY;
      const z1 = px * sinY + pz * cosY;
      const y2 = py * cosX - z1 * sinX;
      const z2 = py * sinX + z1 * cosX;
      let g = 1;
      if (rays) {
        const i1 = Math.max(0, (x1 * e1x + y2 * e1y + z2 * e1z - 0.5) * 2);
        const i2 = Math.max(0, (x1 * e2x + y2 * e2y + z2 * e2z - 0.6) * 2.5);
        const inf = i1 * i1 + 0.5 * i2 * i2;
        if (inf > 0) {
          g += lvl * inf * (0.12 + p.sp * 0.95) * (0.55 + 0.45 * Math.sin(t * p.f + p.k));
          if (g > 1.12) {
            rays.moveTo(cx + x1 * rad, cy + y2 * rad);
            rays.lineTo(cx + x1 * g * rad, cy + y2 * g * rad);
          }
        }
      }
      if (focusOn) {
        const dd = x1 * fx + y2 * fy;
        if (dd > 0.45 && z2 > -0.4) g += fAmt * (dd - 0.45) ** 2 * 0.45;
      }
      p.sx = cx + x1 * g * rad;
      p.sy = cy + y2 * g * rad;
      p.z2 = z2;
      p.g = g;
    }
    // Liaisons en trois couches (arrière, milieu, avant) pour la profondeur.
    const layers = [new Path2D(), new Path2D(), new Path2D()];
    const step = mini ? 4 : 2;
    for (let i = 0; i < links.length; i += step) {
      const a = pts[links[i]], b = pts[links[i + 1]];
      const z = (a.z2 + b.z2) / 2;
      const path = layers[z < -0.35 ? 0 : z < 0.3 ? 1 : 2];
      path.moveTo(a.sx, a.sy);
      path.lineTo(b.sx, b.sy);
    }
    const boost = 1 + energy * 1.3;
    [0.08, 0.17, 0.32].forEach((al, i) => {
      ctx.strokeStyle = `rgba(${rgb},${Math.min(1, al * boost)})`;
      ctx.lineWidth = i === 2 ? 0.8 : 0.6;
      ctx.stroke(layers[i]);
    });
    // Nœuds : plus brillants devant et là où le réseau est dense.
    for (const b of bins) b.length = 0;
    tips.length = 0;
    for (const p of pts) {
      const depth = Math.max(0, Math.min(1, (p.z2 + 1) / 2));
      let lum = depth * 0.8 + Math.min(p.deg, 10) * 0.02;
      if (focusOn) {
        const dd = ((p.sx - cx) * fx + (p.sy - cy) * fy) / rad;
        if (dd > 0.4) lum += fAmt * (dd - 0.4) * 1.2;
      }
      bins[lum > 0.75 ? 3 : lum > 0.5 ? 2 : lum > 0.28 ? 1 : 0].push(p.sx, p.sy);
      if (p.g > 1.15) tips.push(p.sx, p.sy);
    }
    const light = `${Math.min(255, cr + 110)},${Math.min(255, cg + 60)},255`;
    bins.forEach((b, i) => {
      ctx.fillStyle = `rgba(${i === 3 ? light : rgb},${ALPHA[i]})`;
      const s = SIZE[i];
      for (let j = 0; j < b.length; j += 2) ctx.fillRect(b[j] - s / 2, b[j + 1] - s / 2, s, s);
    });
    // Pointes : aiguilles lumineuses et têtes brillantes.
    if (rays) {
      ctx.strokeStyle = `rgba(${light},${0.3 + lvl * 0.6})`;
      ctx.lineWidth = 1;
      ctx.stroke(rays);
      ctx.fillStyle = `rgba(${light},.95)`;
      for (let j = 0; j < tips.length; j += 2) ctx.fillRect(tips[j] - 1.7, tips[j + 1] - 1.7, 3.4, 3.4);
    }

    // Étincelles (plus rapides quand il parle ou écoute).
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${rgb},${0.05 + energy * 0.6})`;
    ctx.beginPath();
    const speed = 1 + energy * 4;
    for (const d of dust) {
      d.r += d.v * speed;
      if (d.r > 2.4) {
        newDust(d).r = 1.02;
        if (lvl > 0.1) d.a = emitA + (Math.random() - 0.5) * 1.3;
      }
      if (d.r > 1.9) continue;
      const r1 = rad * d.r, r2 = rad * (d.r + d.len * (0.6 + energy));
      ctx.moveTo(cx + Math.cos(d.a) * r1, cy + Math.sin(d.a) * r1);
      ctx.lineTo(cx + Math.cos(d.a) * r2, cy + Math.sin(d.a) * r2);
    }
    ctx.stroke();

    if (m === "thinking") {
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(${rgb},.85)`;
      for (let i = 0; i < 2; i++) {
        const a = t * (2.4 + i) * (i ? -1 : 1);
        ctx.beginPath();
        ctx.arc(cx, cy, rad * (1.16 + i * 0.1), a, a + 1.1);
        ctx.stroke();
      }
    }
    if (m === "listening") {
      const ph = (t % 1.4) / 1.4;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${rgb},${0.7 * (1 - ph)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * (1 + ph * 0.6), 0, 6.283);
      ctx.stroke();
    }
    reactor.style.setProperty("--energy", energy.toFixed(3));
    requestAnimationFrame(frame);
  }

  // ---------- Mini-sphère : hors de l'Assistant, elle se réduit et file en bas à droite ----------
  const slot = document.querySelector(".core-wrap");
  const orb = document.createElement("div");
  orb.className = "orb";
  orb.append(...slot.childNodes);
  document.body.append(orb);
  const MINI = 78;
  const page0 = document.getElementById("pageAssistant");
  // Taille fixe : la sphère grandit, rétrécit ou file en bas à droite par une simple transformation (fluide).
  const BASE = 440;
  orb.style.width = orb.style.height = BASE + "px";
  function place() {
    const sr = slot.getBoundingClientRect();
    const pr = page0.getBoundingClientRect();
    const mini = isMini();
    document.body.classList.toggle("orb-mini", mini);
    if (!mini) orb.style.transform = `translate(${sr.left - pr.left}px, ${sr.top}px) scale(${sr.width / BASE})`;
    else orb.style.transform = `translate(${innerWidth - MINI - 18}px, ${innerHeight - MINI - 18}px) scale(${MINI / BASE})`;
    orb.title = mini ? "Retour à l'assistant" : "Clique pour parler";
  }

  new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ["data-page"] });
  // La sphère suit sa place quand le contenu autour change (réponse affichée, ligne d'infos…).
  const follow = new ResizeObserver(() => place());
  follow.observe(slot);
  document.querySelectorAll("#pageAssistant .stage > *").forEach((n) => follow.observe(n));
  addEventListener("resize", place);
  // Sur téléphone la page défile : la sphère suit sans délai.
  let scrollTimer;
  page0.addEventListener(
    "scroll",
    () => {
      orb.classList.remove("ready");
      place();
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => orb.classList.add("ready"), 200);
    },
    { passive: true },
  );
  place();
  requestAnimationFrame(frame);
  requestAnimationFrame(() => orb.classList.add("ready")); // pas d'animation au tout premier placement

  // ---------- Séquence de démarrage (une fois par lancement) ----------
  const boot = document.getElementById("boot");
  if (!boot) return;
  if (sessionStorage.getItem("jarvisBooted")) return boot.remove();
  sessionStorage.setItem("jarvisBooted", "1");
  boot.hidden = false;
  const lines = ["Initialisation du noyau", "Chargement des protocoles vocaux", "Connexion aux services", "Synchronisation de l'interface", "Tous les systèmes sont opérationnels"];
  const log = boot.querySelector(".boot-log");
  lines.forEach((l, i) =>
    setTimeout(() => {
      const row = document.createElement("div");
      row.className = "boot-line";
      row.innerHTML = `<span>${String(i + 1).padStart(2, "0")}</span>${l}<b>OK</b>`;
      log.append(row);
    }, 180 + i * 230),
  );
  setTimeout(() => boot.classList.add("done"), 180 + lines.length * 230 + 350);
  setTimeout(() => boot.remove(), 180 + lines.length * 230 + 1100);
})();
