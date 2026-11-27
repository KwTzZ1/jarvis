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

  // ---------- Points de la sphère (spirale de Fibonacci, légèrement en désordre) ----------
  const N = 760;
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    const j = 0.96 + Math.random() * 0.08;
    pts.push({ x: Math.cos(a) * r * j, y: y * j, z: Math.sin(a) * r * j, k: Math.random() * 6.283, sx: 0, sy: 0, z2: 0 });
  }
  // Maillage : chaque point est relié à ses deux plus proches voisins (calculé une seule fois).
  const links = [];
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    let b1 = -1, b2 = -1, d1 = 9, d2 = 9;
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const q = pts[j];
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
      if (d < d1) (d2 = d1), (b2 = b1), (d1 = d), (b1 = j);
      else if (d < d2) (d2 = d), (b2 = j);
    }
    links.push(i, b1, i, b2);
  }
  // Étincelles qui s'échappent de la sphère.
  const DUST = 160;
  const dust = [];
  const newDust = (d = {}) => Object.assign(d, { a: Math.random() * 6.283, r: 1 + Math.random() * 1.3, v: 0.0015 + Math.random() * 0.004, len: 0.02 + Math.random() * 0.07 });
  for (let i = 0; i < DUST; i++) dust.push(newDust());

  let W = 0, H = 0, R = 0;
  function resize() {
    // Taille réelle (sans le zoom de la mini-sphère), pour garder un dessin net.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.32;
  }
  new ResizeObserver(resize).observe(canvas);

  // Bleu au repos, cyan à l'écoute, bleu profond en réflexion, VIOLET MAUVE quand il parle.
  const COLORS = { idle: [46, 160, 255], listening: [80, 220, 255], thinking: [90, 140, 255], speaking: [178, 100, 255], offline: [110, 125, 140] };
  const mode = () => {
    const c = reactor.classList;
    if (c.contains("offline")) return "offline";
    if (typeof state !== "undefined" && state.speaking) return "speaking"; // suit la voix, quoi qu'affiche l'écran
    return c.contains("listening") ? "listening" : c.contains("thinking") ? "thinking" : c.contains("speaking") ? "speaking" : "idle";
  };
  const isMini = () => !!document.body.dataset.page && document.body.dataset.page !== "0";

  let energy = 0.2, spin = 0, color = [46, 160, 255], skip = false, frameNo = 0;
  const buf = new Uint8Array(128);
  function voiceLevel() {
    const an = window.jarvisCore.analyser;
    if (!an) return null;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += (buf[i] - 128) ** 2;
    return Math.min(1, Math.sqrt(sum / buf.length) / 40);
  }

  const bins = [[], [], [], []];
  const ALPHA = [0.16, 0.36, 0.62, 0.95];
  const SIZE = [0.9, 1.2, 1.5, 1.9];

  function frame(now) {
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize(); // filet si l'observateur n'a rien vu
    if (document.hidden || !W) return setTimeout(() => requestAnimationFrame(frame), 400);
    const mini = isMini();
    if (mini && (skip = !skip)) return requestAnimationFrame(frame); // en mini : une image sur deux
    const t = now / 1000;
    const m = mode();
    const level = voiceLevel();
    const target = {
      idle: 0.18 + 0.05 * Math.sin(t * 1.3),
      listening: 0.6,
      thinking: 0.42,
      speaking: 0.35 + (level ?? 0.25 + 0.25 * Math.abs(Math.sin(t * 9) * Math.sin(t * 4.3))) * 0.65,
      offline: 0.05,
    }[m];
    energy += (target - energy) * 0.1;
    spin += { idle: 0.003, listening: 0.006, thinking: 0.022, speaking: 0.008, offline: 0.0008 }[m];
    const want = COLORS[m];
    color = color.map((c, i) => c + (want[i] - c) * 0.07);
    const [cr, cg, cb] = color.map(Math.round);
    const rgb = `${cr},${cg},${cb}`;
    if (frameNo++ % 5 === 0) orb.style.setProperty("--core-rgb", rgb); // les anneaux et le nom suivent la couleur
    const cx = W / 2, cy = H / 2;
    const rad = R * (1 + energy * 0.1);

    ctx.clearRect(0, 0, W, H);
    // Halo lumineux.
    const halo = ctx.createRadialGradient(cx, cy, rad * 0.82, cx, cy, rad * 1.5);
    halo.addColorStop(0, `rgba(${rgb},0)`);
    halo.addColorStop(0.16, `rgba(${rgb},${0.34 + energy * 0.36})`);
    halo.addColorStop(0.42, `rgba(${rgb},${0.08 + energy * 0.1})`);
    halo.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    // Cœur : fond sombre + lueur qui pulse au centre.
    ctx.fillStyle = "rgba(1,5,12,.86)";
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 1.02, 0, 6.283);
    ctx.fill();
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    core.addColorStop(0, `rgba(${rgb},${0.16 + energy * 0.32})`);
    core.addColorStop(0.45, `rgba(${rgb},.04)`);
    core.addColorStop(0.9, `rgba(${rgb},.1)`);
    core.addColorStop(1, `rgba(${rgb},.3)`);
    ctx.fillStyle = core;
    ctx.fill();

    // Projection des points : la surface ondule (forme imparfaite) et vibre plus fort quand il parle.
    const cosY = Math.cos(spin), sinY = Math.sin(spin);
    const tilt = 0.32 + Math.sin(t * 0.21) * 0.14;
    const cosX = Math.cos(tilt), sinX = Math.sin(tilt);
    const amp = m === "speaking" ? 0.08 + energy * 0.24 : m === "listening" ? 0.11 : 0.07;
    const tt = t * (m === "speaking" ? 2.6 : m === "thinking" ? 1.5 : 0.6);
    const jit = m === "speaking" ? energy * 0.05 : 0.008;
    for (const b of bins) b.length = 0;
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const n = Math.sin(p.x * 2.1 + tt) * Math.sin(p.y * 2.7 - tt * 0.8) * Math.sin(p.z * 1.9 + tt * 1.3) + 0.45 * Math.sin(p.x * 4.6 - tt * 1.6) * Math.sin(p.z * 4.1 + tt * 1.1);
      const d = 1 + amp * n + jit * Math.sin(p.k + t * 11);
      const px = p.x * d, py = p.y * d, pz = p.z * d;
      const x1 = px * cosY - pz * sinY;
      const z1 = px * sinY + pz * cosY;
      const y2 = py * cosX - z1 * sinX;
      const z2 = py * sinX + z1 * cosX;
      p.sx = cx + x1 * rad;
      p.sy = cy + y2 * rad;
      p.z2 = z2;
      if (mini && i & 1) continue;
      // Bord de la sphère très lumineux (comme un anneau), face avant moyenne, arrière discret.
      const depth = Math.max(0, Math.min(1, (z2 + 1) / 2));
      const rim = (1 - Math.min(1, Math.abs(z2))) ** 5;
      const lum = depth * 0.45 + rim * 0.65;
      bins[lum > 0.62 ? 3 : lum > 0.36 ? 2 : lum > 0.16 ? 1 : 0].push(p.sx, p.sy);
    }
    // Maillage sur la face avant.
    if (!mini) {
      ctx.beginPath();
      for (let i = 0; i < links.length; i += 2) {
        const a = pts[links[i]], b = pts[links[i + 1]];
        if (a.z2 < 0 || b.z2 < 0) continue;
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
      }
      ctx.strokeStyle = `rgba(${rgb},${0.09 + energy * 0.12})`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    const light = `${Math.min(255, cr + 120)},${Math.min(255, cg + 80)},255`;
    bins.forEach((b, i) => {
      ctx.fillStyle = `rgba(${i === 3 ? light : rgb},${ALPHA[i]})`;
      const s = SIZE[i];
      for (let j = 0; j < b.length; j += 2) ctx.fillRect(b[j] - s / 2, b[j + 1] - s / 2, s, s);
    });

    // Étincelles (plus rapides quand il parle ou écoute).
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${rgb},.55)`;
    ctx.beginPath();
    const speed = 1 + energy * 4;
    for (const d of dust) {
      d.r += d.v * speed;
      if (d.r > 2.4) newDust(d).r = 1.02;
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
  const MINI = 92;
  const page0 = document.getElementById("pageAssistant");
  function place() {
    const sr = slot.getBoundingClientRect();
    const pr = page0.getBoundingClientRect();
    const size = sr.width;
    orb.style.width = orb.style.height = size + "px";
    const mini = isMini();
    document.body.classList.toggle("orb-mini", mini);
    if (!mini) orb.style.transform = `translate(${sr.left - pr.left}px, ${sr.top}px)`;
    else orb.style.transform = `translate(${innerWidth - MINI - 26}px, ${innerHeight - MINI - 26}px) scale(${MINI / size})`;
    orb.title = mini ? "Retour à l'assistant" : "Clique pour parler";
    drawLinks();
  }

  // ---------- Jauges du PC autour du noyau, reliées par des traits ----------
  const stage = document.querySelector(".core-stage");
  const linksSvg = document.querySelector(".core-links");
  const gauges = [...document.querySelectorAll(".gauge")];
  function drawLinks() {
    if (!stage || !linksSvg || isMini()) return;
    const st = stage.getBoundingClientRect();
    const sr = slot.getBoundingClientRect();
    if (!st.width) return;
    const ox = sr.left - st.left + sr.width / 2, oy = sr.top - st.top + sr.height / 2;
    const ringR = sr.width * 0.57;
    let out = "";
    for (const g of gauges) {
      const r = g.querySelector("svg").getBoundingClientRect();
      if (!r.width) continue;
      const gx = r.left - st.left + r.width / 2, gy = r.top - st.top + r.height / 2;
      const side = gx < ox ? 1 : -1;
      const sx = gx + side * (r.width / 2 + 4), ex = sx + side * 18;
      const dx = ox - ex, dy = oy - gy, len = Math.hypot(dx, dy) || 1;
      const tx = ox - (dx / len) * ringR, ty = oy - (dy / len) * ringR;
      out += `<polyline points="${sx},${gy} ${ex},${gy} ${tx},${ty}"/><circle cx="${tx}" cy="${ty}" r="2"/>`;
    }
    linksSvg.innerHTML = out;
  }

  new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ["data-page"] });
  new ResizeObserver(place).observe(slot);
  if (stage) new ResizeObserver(drawLinks).observe(stage);
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

  // ---------- Cadran HUD : anneau des secondes ----------
  const sec = document.getElementById("hudSec");
  setInterval(() => {
    if (document.hidden || !sec) return;
    sec.style.strokeDasharray = `${new Date().getSeconds() + 1} 60`;
  }, 1000);

  const fmtH = (s) => (s >= 86400 ? `${Math.floor(s / 86400)}j` : `${Math.floor(s / 3600)}h`);
  function setGauge(k, pct, text) {
    const g = gauges.find((x) => x.dataset.k === k);
    if (!g) return;
    g.style.setProperty("--v", Math.max(0, Math.min(100, pct || 0)).toFixed(1));
    g.classList.toggle("hot", pct > 85 && k !== "up");
    g.querySelector("b").textContent = text;
  }
  async function refreshGauges() {
    if (document.hidden || isMini() || !gauges.length) return;
    try {
      const s = await (await fetch("/api/system")).json();
      setGauge("cpu", s.cpu, s.cpu == null ? "--" : s.cpu + "%");
      const ram = (100 * s.ram.used) / s.ram.total;
      setGauge("ram", ram, Math.round(ram) + "%");
      if (s.disk) {
        const used = 100 - (100 * s.disk.free) / s.disk.total;
        setGauge("disk", used, Math.round(used) + "%");
      }
      setGauge("up", (100 * (s.uptime % 86400)) / 86400, fmtH(s.uptime));
    } catch {
      // Serveur occupé : on réessaiera.
    }
  }
  refreshGauges();
  setInterval(refreshGauges, 3000);

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
