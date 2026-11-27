// Noyau de Jarvis : sphère de particules qui réagit à son état (repos, écoute, réflexion, parole)
// + séquence de démarrage. Dessin léger sur canvas, mis en pause hors de la page Assistant.
(() => {
  const canvas = document.getElementById("coreCanvas");
  const reactor = document.getElementById("reactor");
  if (!canvas || !reactor) return;
  const ctx = canvas.getContext("2d");
  window.jarvisCore = window.jarvisCore || { analyser: null };

  // Points répartis régulièrement sur une sphère (spirale de Fibonacci).
  const N = 620;
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    const j = 0.94 + Math.random() * 0.1; // léger désordre : plus organique
    pts.push({ x: Math.cos(a) * r * j, y: y * j, z: Math.sin(a) * r * j, k: Math.random() * 6.28 });
  }
  // Poussière : petites traînées qui s'échappent de la sphère.
  const DUST = 150;
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

  const COLORS = { idle: [40, 150, 255], listening: [70, 215, 255], thinking: [110, 160, 255], speaking: [185, 105, 255], offline: [110, 125, 140] };
  const mode = () => {
    const c = reactor.classList;
    if (typeof state !== "undefined" && state.speaking && !c.contains("offline")) return "speaking"; // suit la voix, même si l'affichage change
    return c.contains("offline") ? "offline" : c.contains("listening") ? "listening" : c.contains("thinking") ? "thinking" : c.contains("speaking") ? "speaking" : "idle";
  };

  let energy = 0.2, spin = 0, color = [40, 150, 255];
  const buf = new Uint8Array(128);
  function voiceLevel() {
    const an = window.jarvisCore.analyser;
    if (!an) return null;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += (buf[i] - 128) ** 2;
    return Math.min(1, Math.sqrt(sum / buf.length) / 40);
  }

  const isMini = () => !!document.body.dataset.page && document.body.dataset.page !== "0";
  let skip = false;

  function frame(now) {
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize(); // filet si l'observateur n'a rien vu
    if (document.hidden || !W) return setTimeout(() => requestAnimationFrame(frame), 400);
    // En mini (autres pages) : une image sur deux suffit.
    if (isMini() && (skip = !skip)) return requestAnimationFrame(frame);
    const t = now / 1000;
    const m = mode();
    const level = voiceLevel();
    const target = { idle: 0.18 + 0.05 * Math.sin(t * 1.3), listening: 0.6, thinking: 0.42, speaking: 0.35 + (level ?? 0.25 + 0.25 * Math.abs(Math.sin(t * 9) * Math.sin(t * 4.3))) * 0.65, offline: 0.05 }[m];
    energy += (target - energy) * 0.1;
    spin += { idle: 0.0025, listening: 0.006, thinking: 0.022, speaking: 0.007, offline: 0.0008 }[m];
    const want = COLORS[m];
    color = color.map((c, i) => c + (want[i] - c) * 0.06);
    const [cr, cg, cb] = color.map(Math.round);
    const rgb = `${cr},${cg},${cb}`;
    const cx = W / 2, cy = H / 2;
    const rad = R * (1 + energy * 0.12);

    ctx.clearRect(0, 0, W, H);
    // Halo lumineux autour de la sphère.
    const halo = ctx.createRadialGradient(cx, cy, rad * 0.75, cx, cy, rad * 1.5);
    halo.addColorStop(0, `rgba(${rgb},0)`);
    halo.addColorStop(0.28, `rgba(${rgb},${0.28 + energy * 0.35})`);
    halo.addColorStop(0.42, `rgba(${rgb},${0.1 + energy * 0.12})`);
    halo.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    // Intérieur sombre légèrement teinté.
    const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    inner.addColorStop(0, "rgba(2,8,16,.92)");
    inner.addColorStop(0.85, `rgba(${rgb},.07)`);
    inner.addColorStop(1, `rgba(${rgb},.22)`);
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, 6.283);
    ctx.fill();

    // Particules de la sphère, regroupées par luminosité (4 passes de dessin seulement).
    const cosY = Math.cos(spin), sinY = Math.sin(spin);
    const tilt = 0.35 + Math.sin(t * 0.2) * 0.1;
    const cosX = Math.cos(tilt), sinX = Math.sin(tilt);
    const bins = [[], [], [], []];
    const amp = m === "speaking" ? 0.07 + energy * 0.22 : m === "listening" ? 0.1 : 0.06;
    const tt = t * (m === "speaking" ? 2.6 : m === "thinking" ? 1.4 : 0.6);
    const jit = m === "speaking" ? energy * 0.05 : 0.008;
    for (const p of pts) {
      // Déformation organique : la forme bouge lentement, et vibre quand Jarvis parle.
      const n = Math.sin(p.x * 2.7 + tt) * Math.sin(p.y * 3.1 - tt * 0.8) * Math.sin(p.z * 2.3 + tt * 1.2);
      const d = 1 + amp * n + jit * Math.sin(p.k + t * 11);
      const px = p.x * d, py = p.y * d, pz = p.z * d;
      const x1 = px * cosY - pz * sinY;
      const z1 = px * sinY + pz * cosY;
      const y2 = py * cosX - z1 * sinX;
      const z2 = py * sinX + z1 * cosX;
      const s = rad;
      const depth = (z2 + 1) / 2;
      bins[Math.max(0, Math.min(3, Math.floor(depth * 4)))].push(cx + x1 * s, cy + y2 * s);
    }
    const alphas = [0.12, 0.3, 0.6, 0.95];
    const sizes = [1, 1.3, 1.6, 2];
    bins.forEach((b, i) => {
      ctx.fillStyle = i === 3 ? `rgba(${Math.min(255, cr + 150)},${Math.min(255, cg + 90)},255,${alphas[i]})` : `rgba(${rgb},${alphas[i]})`;
      const sz = sizes[i];
      for (let j = 0; j < b.length; j += 2) ctx.fillRect(b[j] - sz / 2, b[j + 1] - sz / 2, sz, sz);
    });

    // Anneau net sur le bord.
    ctx.strokeStyle = `rgba(${rgb},${0.12 + energy * 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, 6.283);
    ctx.stroke();

    // Traînées qui s'échappent (plus rapides quand Jarvis parle ou écoute).
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${rgb},.55)`;
    ctx.beginPath();
    const speed = 1 + energy * 4;
    for (const d of dust) {
      d.r += d.v * speed;
      if (d.r > 2.4) newDust(d).r = 1.02;
      const r1 = rad * d.r, r2 = rad * (d.r + d.len * (0.6 + energy));
      if (d.r > 1.9) continue;
      ctx.moveTo(cx + Math.cos(d.a) * r1, cy + Math.sin(d.a) * r1);
      ctx.lineTo(cx + Math.cos(d.a) * r2, cy + Math.sin(d.a) * r2);
    }
    ctx.stroke();

    // Réflexion : deux arcs qui tournent autour.
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
    // Écoute : onde qui s'élargit.
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
  requestAnimationFrame(frame);

  // ---------- Mini-sphère : hors de l'Assistant, elle se réduit et file en bas à droite ----------
  const slot = document.querySelector(".core-wrap");
  const orb = document.createElement("div");
  orb.className = "orb";
  orb.append(...slot.childNodes);
  document.body.append(orb);
  const MINI = 92;
  function place() {
    const page = document.getElementById("pageAssistant");
    const sr = slot.getBoundingClientRect();
    const pr = page.getBoundingClientRect();
    const size = sr.width;
    orb.style.width = orb.style.height = size + "px";
    const mini = isMini();
    document.body.classList.toggle("orb-mini", mini);
    if (!mini) orb.style.transform = `translate(${sr.left - pr.left}px, ${sr.top}px)`;
    else {
      const k = MINI / size;
      orb.style.transform = `translate(${innerWidth - MINI - 26}px, ${innerHeight - MINI - 26}px) scale(${k})`;
    }
    orb.title = mini ? "Retour à l'assistant" : "Clique pour parler";
  }
  new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ["data-page"] });
  new ResizeObserver(place).observe(slot);
  addEventListener("resize", place);
  place();
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
