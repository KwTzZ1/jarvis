// Points interactifs autour de la sphère : processeur, carte graphique, mémoire, stockage, réseau et système.
// Survol (ou clic pour épingler) : fiche détaillée en direct. Les relevés ne tournent que lorsque les points sont à l'écran.
(() => {
  const page0 = document.getElementById("pageAssistant");
  const stage = page0?.querySelector(".stage");
  const coreStage = page0?.querySelector(".core-stage");
  const slot = coreStage?.querySelector(".core-wrap");
  if (!stage || !coreStage || !slot) return;

  const ICONS = {
    cpu: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
    gpu: '<rect x="2.5" y="6" width="19" height="11" rx="2"/><circle cx="9" cy="11.5" r="2.8"/><path d="M15 9.5h3.5M15 13.5h3.5M5.5 17v2.5M9 17v2.5"/>',
    ram: '<rect x="2.5" y="7" width="19" height="9" rx="1.5"/><path d="M6.5 10v3M10 10v3M13.5 10v3M17 10v3M5 16v2.5M19 16v2.5"/>',
    disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    net: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1.1"/>',
    sys: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  };
  const svgIcon = (k, s) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

  // Trois points à gauche, trois à droite, sur une orbite autour de la sphère (angles à l'écran, 0° = droite).
  const NODES = [
    { k: "cpu", label: "CPU", title: "Processeur", a: 218 },
    { k: "ram", label: "RAM", title: "Mémoire vive", a: 180 },
    { k: "disk", label: "Disque", title: "Stockage", a: 142 },
    { k: "gpu", label: "GPU", title: "Carte graphique", a: -38 },
    { k: "net", label: "Réseau", title: "Réseau", a: 0 },
    { k: "sys", label: "Système", title: "Système", a: 38 },
  ];

  // ---------- Mise en forme ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const nf = (v, d = 0, min = d) => Number(v).toLocaleString("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: d });
  const pct = (v) => `${Math.round(v)}\u202f%`;
  function fmtB(b, rate) {
    if (b == null || isNaN(b)) return "—";
    const u = ["o", "Ko", "Mo", "Go", "To"];
    let i = 0;
    if (rate) (b /= 1024), (i = 1); // débits : au moins en Ko/s
    while (b >= 1000 && i < 4) (b /= 1024), i++;
    return `${nf(b, b >= 0.05 && b < 10 && i ? 1 : 0, 0)} ${u[i]}${rate ? "/s" : ""}`;
  }
  function upParts(s) {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? [[d, "j"], [h, "h"]] : h ? [[h, "h"], [String(m).padStart(2, "0"), "min"]] : [[m, "min"]];
  }
  const fmtUp = (s) => upParts(s).map(([v, u]) => `${v} ${u}`).join(" ");
  const tcls = (t) => (t >= 80 ? "t-hot" : t >= 65 ? "t-warm" : "");
  const tC = (t) => (t == null ? null : `<span class="${tcls(t)}">${Math.round(t)} °C</span>`);
  const DDR = { 20: "DDR", 21: "DDR2", 24: "DDR3", 26: "DDR4", 30: "LPDDR4", 34: "DDR5", 35: "LPDDR5" };
  const MEDIA = { 3: "HDD", 4: "SSD" };
  const cleanCpu = (s) => s.replace(/\((R|TM)\)|\bCPU\b|Processor|\d+-Core|@.*$/gi, "").replace(/\s+/g, " ").trim();
  const cleanNic = (s) => s.replace(/\[R\]|\(R\)|\[\d+\]|_\d+$|Connection|Controller|Family|PCI-E NIC|Adapter/gi, "").replace(/\s+/g, " ").trim();
  const cleanBoard = (s) =>
    s.replace(/ASUSTeK COMPUTER INC\.?/i, "ASUS").replace(/Micro-Star International Co\., ?Ltd\.?/i, "MSI").replace(/Gigabyte Technology Co\., ?Ltd\.?/i, "Gigabyte").replace(/To be filled by O\.E\.M\.?/gi, "").trim();
  const PROC = {
    chrome: "Chrome", msedge: "Edge", msedgewebview2: "Edge WebView", brave: "Brave", firefox: "Firefox", opera: "Opera", Discord: "Discord", Code: "VS Code",
    claude: "Claude", Spotify: "Spotify", explorer: "Explorateur", node: "Node.js", "Memory Compression": "Compression mémoire", MsMpEng: "Antivirus Windows",
    svchost: "Services Windows", dwm: "Affichage Windows", steam: "Steam", steamwebhelper: "Steam", powershell: "PowerShell", "ms-teams": "Teams", obs64: "OBS",
  };
  const procName = (n) => PROC[n] || n.charAt(0).toUpperCase() + n.slice(1);

  // Petite courbe de l'historique (dernière minute environ).
  const hist = { cpu: [], gpu: [], ram: [], net: [] };
  const remember = (k, v) => {
    hist[k].push(v ?? 0);
    if (hist[k].length > 40) hist[k].shift();
  };
  function spark(vals, max) {
    if (vals.length < 2) return "";
    const W = 120, H = 34, top = max || Math.max(1, ...vals) * 1.15;
    const p = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - 2 - (Math.min(v, top) / top) * (H - 6)]);
    const line = p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
    const [lx, ly] = p[p.length - 1];
    return `<svg class="hwc-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="a" d="${line}L${W} ${H}L0 ${H}Z"/><path class="l" d="${line}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2"/></svg>`;
  }

  // ---------- Les points ----------
  const layer = document.createElement("div");
  layer.className = "hw";
  layer.setAttribute("role", "group");
  layer.setAttribute("aria-label", "État du PC");
  const lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  lines.setAttribute("class", "hw-lines");
  lines.setAttribute("aria-hidden", "true");
  layer.append(lines);
  NODES.forEach((n, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `hw-node ${Math.cos((n.a * Math.PI) / 180) < 0 ? "l" : "r"}`;
    b.style.setProperty("--i", i);
    b.setAttribute("aria-label", n.title);
    b.innerHTML = `<span class="hw-g"><svg viewBox="0 0 26 26"><circle class="tr" cx="13" cy="13" r="11"/><circle class="pr" cx="13" cy="13" r="11" pathLength="100"/></svg><i></i></span><span class="hw-t"><small>${n.label}</small><b>…</b></span>`;
    n.el = b;
    n.val = b.querySelector("b");
    n.arc = b.querySelector(".pr");
    n.u = [Math.cos((n.a * Math.PI) / 180), Math.sin((n.a * Math.PI) / 180)];
    layer.append(b);
  });
  coreStage.append(layer);

  // Place des points selon la taille de la sphère ; sans assez de place, on garde juste les pastilles, puis plus rien.
  function layout() {
    const s = slot.clientWidth;
    if (!s) return;
    const rho = s * 0.6 + 22, edge = s * 0.47;
    const half = page0.clientWidth / 2 - 14;
    layer.classList.toggle("tight", half < rho + 112);
    layer.classList.toggle("none", half < rho + 20);
    const pt = (a, r) => `${(Math.cos((a * Math.PI) / 180) * r).toFixed(1)} ${(Math.sin((a * Math.PI) / 180) * r).toFixed(1)}`;
    let svg = "";
    for (const n of NODES) {
      n.el.style.setProperty("--x", (n.u[0] * rho).toFixed(1) + "px");
      n.el.style.setProperty("--y", (n.u[1] * rho).toFixed(1) + "px");
      svg += `<path class="hw-ln" data-k="${n.k}" d="M${pt(n.a, rho - 15)}L${pt(n.a, edge)}"/>`;
    }
    // Orbite discrète qui relie les points de chaque côté.
    svg += `<path class="hw-arc" d="M${pt(146, rho)}A${rho.toFixed(1)} ${rho.toFixed(1)} 0 0 1 ${pt(214, rho)}"/>`;
    svg += `<path class="hw-arc" d="M${pt(-34, rho)}A${rho.toFixed(1)} ${rho.toFixed(1)} 0 0 1 ${pt(34, rho)}"/>`;
    lines.innerHTML = svg;
    if (openK) {
      lines.querySelector(`[data-k="${openK}"]`)?.classList.add("on");
      placeCard();
    }
  }
  const ro = new ResizeObserver(layout);
  ro.observe(slot);
  ro.observe(page0);

  // ---------- Valeurs affichées sur les points ----------
  let data = null, lastAt = 0;
  function setNode(k, p, html, warn, aria) {
    const n = NODES.find((x) => x.k === k);
    if (n.val.innerHTML !== html) n.val.innerHTML = html;
    n.arc.style.strokeDasharray = p == null ? "0 100" : `${Math.max(0, Math.min(100, p)).toFixed(1)} 100`;
    n.el.classList.toggle("warn", !!warn);
    n.el.setAttribute("aria-label", aria);
  }
  const tempTag = (t) => (t == null ? "" : `<em class="${tcls(t)}"> · ${Math.round(t)}°</em>`);
  function update(d) {
    data = d;
    lastAt = Date.now();
    const ramP = (100 * d.ram.used) / d.ram.total;
    const c = d.disk.drives.find((x) => /^C:/i.test(x.id)) || d.disk.drives[0];
    const diskP = c ? 100 - (100 * c.free) / c.total : null;
    remember("cpu", d.cpu.usage);
    remember("gpu", d.gpu.usage);
    remember("ram", ramP);
    remember("net", d.net.rx);
    setNode("cpu", d.cpu.usage, d.cpu.usage == null ? "…" : pct(d.cpu.usage) + tempTag(d.cpu.temp), d.cpu.usage >= 90 || d.cpu.temp >= 85, `Processeur : ${d.cpu.usage ?? "?"} %`);
    setNode("gpu", d.gpu.usage, d.gpu.usage == null ? "…" : pct(d.gpu.usage) + tempTag(d.gpu.temp), d.gpu.usage >= 95 || d.gpu.temp >= 83, `Carte graphique : ${d.gpu.usage ?? "?"} %`);
    setNode("ram", ramP, pct(ramP), ramP >= 90, `Mémoire : ${Math.round(ramP)} %`);
    setNode("disk", diskP, diskP == null ? "—" : pct(diskP), diskP >= 95, `Disque : ${diskP == null ? "?" : Math.round(diskP)} % utilisé`);
    const netP = d.net.rx == null ? null : Math.min(100, (Math.log10(1 + d.net.rx / 1024) / 5) * 100);
    setNode("net", netP, d.net.rx == null ? "…" : `↓ ${fmtB(d.net.rx, true)}`, false, `Réseau : ${fmtB(d.net.rx, true)} en réception`);
    setNode("sys", null, fmtUp(d.sys.uptime), false, `Système : allumé depuis ${fmtUp(d.sys.uptime)}`);
    layer.classList.add("on");
    if (openK) renderCard();
  }

  // ---------- Fiches détaillées ----------
  const head = (d, k, title, sub) =>
    `<div class="hwc-head"><span class="hwc-ico">${svgIcon(k, 17)}</span><div><small>${title}</small><b title="${esc(sub)}">${esc(sub)}</b></div><i class="hwc-live${d.live ? "" : " off"}" title="${d.live ? "En direct" : "Relevé en préparation"}"></i></div>`;
  const big = (value, unit, caption, chart) => `<div class="hwc-big"><div><b>${value}${unit ? `<span>${unit}</span>` : ""}</b><em>${caption}</em></div>${chart || ""}</div>`;
  const kv = (rows) => `<dl class="hwc-kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const bar = (p, warn) => `<div class="hwc-bar${warn ? " warn" : ""}"><i style="width:${Math.max(0, Math.min(100, p)).toFixed(1)}%"></i></div>`;
  const rateBig = (b) => fmtB(b, true).split(" ");

  const CARDS = {
    cpu: (d) => {
      const c = d.cpu;
      return (
        head(d, "cpu", "Processeur", cleanCpu(c.name) || "Processeur") +
        big(c.usage ?? "…", c.usage == null ? "" : "%", "utilisation", spark(hist.cpu, 100)) +
        kv([
          ["Fréquence", c.mhz ? `${nf(c.mhz / 1000, 2)} GHz` : c.baseMhz ? `${nf(c.baseMhz / 1000, 2)} GHz <span class="hwc-na">(base)</span>` : "—"],
          ["Cœurs", c.cores ? `${c.cores} cœurs · ${c.threads} threads` : `${c.threads} threads`],
          ["Température", tC(c.temp) || `<span class="hwc-na">non lue</span>`],
          d.sys.procs ? ["Processus", nf(d.sys.procs)] : null,
        ]) +
        (c.temp == null ? `<p class="hwc-hint">Windows ne donne pas la température du processeur. Lance LibreHardwareMonitor (gratuit) et Jarvis l'affichera ici tout seul.</p>` : "")
      );
    },
    gpu: (d) => {
      const g = d.gpu;
      const vp = g.used != null && g.total ? (100 * g.used) / g.total : null;
      return (
        head(d, "gpu", "Carte graphique", g.name || "Carte graphique") +
        big(g.usage ?? "…", g.usage == null ? "" : "%", "utilisation", spark(hist.gpu, 100)) +
        kv([["Température", tC(g.temp) || "—"], ["Mémoire vidéo", g.used != null ? `${fmtB(g.used)} / ${fmtB(g.total)}` : g.total ? fmtB(g.total) : "—"]]) +
        (vp != null ? bar(vp, vp >= 90) : "") +
        kv([g.fan != null ? ["Ventilateur", `${g.fan} %`] : null, g.mhz ? ["Fréquence", `${nf(g.mhz)} MHz`] : null, g.watts ? ["Consommation", `${nf(g.watts)} W`] : null])
      );
    },
    ram: (d) => {
      const r = d.ram, p = (100 * r.used) / r.total, mods = r.modules || [];
      const sub = [fmtB(r.total), DDR[mods[0]?.type], mods[0]?.mhz ? `${mods[0].mhz} MHz` : ""].filter(Boolean).join(" · ");
      const same = mods.length && mods.every((m) => m.size === mods[0].size);
      const top = (r.top || []).slice(0, 5), max = top[0]?.b || 1;
      return (
        head(d, "ram", "Mémoire vive", sub) +
        big(nf(r.used / 1073741824, 1), "Go", `sur ${fmtB(r.total)} · ${pct(p)}`, spark(hist.ram, 100)) +
        bar(p, p >= 90) +
        (mods.length ? kv([["Barrettes", same ? `${mods.length} × ${fmtB(mods[0].size)}` : mods.map((m) => fmtB(m.size)).join(" + ")]]) : "") +
        (top.length
          ? `<div class="hwc-sub">Les plus gourmands</div><ul class="hwc-top">${top
              .map((x) => `<li><i style="width:${((100 * x.b) / max).toFixed(0)}%"></i><span>${esc(procName(x.n))}</span><b>${fmtB(x.b)}</b></li>`)
              .join("")}</ul>`
          : "")
      );
    },
    disk: (d) => {
      const pd = d.disk.physical || [];
      const sub = pd.length ? pd.map((x) => [x.name, MEDIA[x.media]].filter(Boolean).join(" · ")).join(", ") : "Disques";
      return (
        head(d, "disk", "Stockage", sub) +
        d.disk.drives
          .map((x) => {
            const used = x.total - x.free, p = (100 * used) / x.total;
            return `<div class="hwc-drive"><div><b>${esc(x.id)}</b><span>${esc(x.label)}</span><em>${fmtB(x.free)} libres</em></div>${bar(p, p >= 92)}<small>${fmtB(used)} utilisés sur ${fmtB(x.total)}</small></div>`;
          })
          .join("") +
        kv([["Lecture", fmtB(d.disk.read, true)], ["Écriture", fmtB(d.disk.write, true)], d.disk.busy != null ? ["Activité", pct(d.disk.busy)] : null])
      );
    },
    net: (d) => {
      const n = d.net, [v, u] = n.rx == null ? ["…", ""] : rateBig(n.rx);
      return (
        head(d, "net", "Réseau", cleanNic(n.name) || "Connexion") +
        big(v, u, "en réception", spark(hist.net)) +
        kv([["Envoi", n.tx == null ? "—" : `↑ ${fmtB(n.tx, true)}`], n.ip ? ["IP locale", esc(n.ip)] : null])
      );
    },
    sys: (d) => {
      const s = d.sys;
      return (
        head(d, "sys", "Système", (s.os?.name || "Windows").replace(/^Microsoft\s+/i, "")) +
        big(upParts(s.uptime).map(([v, u]) => `${v}<span>${u}</span>`).join(" "), "", "allumé depuis") +
        kv([
          s.os?.version ? ["Version", `build ${esc(s.os.version.split(".").pop())}`] : null,
          s.board ? ["Carte mère", esc(cleanBoard(s.board))] : null,
          s.procs ? ["Processus", nf(s.procs)] : null,
          ["Jarvis", `${fmtB(s.jarvis)} de mémoire`],
        ])
      );
    },
  };

  const card = document.createElement("div");
  card.className = "hw-card";
  card.setAttribute("role", "tooltip");
  document.body.append(card);
  let openK = null, pinned = false, hideT = 0;

  function renderCard() {
    const n = NODES.find((x) => x.k === openK);
    if (!n) return;
    const body = data
      ? CARDS[n.k](data)
      : `<div class="hwc-head"><span class="hwc-ico">${svgIcon(n.k, 17)}</span><div><small>${n.title}</small><b>Lecture des capteurs…</b></div></div>`;
    // Au survol la fiche ne fait que s'afficher (elle ne bloque jamais la souris) ; épinglée, son bouton devient cliquable.
    card.classList.toggle("pinned", pinned);
    card.innerHTML = `${body}<div class="hwc-foot">${
      pinned ? `<span>Échap pour fermer</span><button type="button" data-act="taskmgr">Gestionnaire des tâches</button>` : "<span>Clic sur le point pour épingler la fiche</span>"
    }</div>`;
    placeCard();
  }
  // La fiche se met à côté du point, vers l'extérieur ; si elle y cacherait un autre point ou manque de place, côté sphère.
  function placeCard() {
    const n = NODES.find((x) => x.k === openK);
    if (!n) return;
    const g = n.el.querySelector(".hw-g").getBoundingClientRect();
    const w = card.offsetWidth, h = card.offsetHeight;
    const left = n.el.classList.contains("l");
    const y = Math.max(64, Math.min(innerHeight - h - 12, g.top + g.height / 2 - h / 2));
    const others = NODES.filter((x) => x !== n).map((x) => x.el.querySelector(".hw-g").getBoundingClientRect());
    const fits = (x) => x >= 10 && x + w <= innerWidth - 10;
    const free = (x) => !others.some((r) => r.right + 6 > x && r.left - 6 < x + w && r.bottom + 6 > y && r.top - 6 < y + h);
    const outX = left ? g.left - 14 - w : g.right + 14;
    const inX = left ? g.right + 14 : g.left - 14 - w;
    let x = [outX, inX].find((c) => fits(c) && free(c)) ?? [outX, inX].find(fits) ?? outX;
    const out = x === outX;
    x = Math.max(10, Math.min(innerWidth - w - 10, x));
    card.style.left = Math.round(x) + "px";
    card.style.top = Math.round(y) + "px";
    card.style.transformOrigin = left === out ? "right center" : "left center";
  }

  function show(k, pin) {
    clearTimeout(hideT);
    if (k !== openK || pin) window.sfx?.(pin ? "open" : "tick");
    if (k !== openK && pin === undefined) pinned = false; // survol d'un autre point : il prend la main
    if (pin !== undefined) pinned = pin;
    openK = k;
    const n = NODES.find((x) => x.k === k);
    NODES.forEach((x) => x.el.classList.toggle("open", x === n));
    lines.querySelectorAll(".hw-ln").forEach((p) => p.classList.toggle("on", p.dataset.k === k));
    window.jarvisCore = window.jarvisCore || {};
    window.jarvisCore.focus = n.u; // la sphère se tourne vers le point
    renderCard();
    card.classList.add("show");
    if (Date.now() - lastAt > 1200) poll();
  }
  function hide(now) {
    if (pinned && !now) return;
    clearTimeout(hideT);
    hideT = setTimeout(
      () => {
        openK = null;
        pinned = false;
        NODES.forEach((x) => x.el.classList.remove("open"));
        lines.querySelectorAll(".hw-ln.on").forEach((p) => p.classList.remove("on"));
        if (window.jarvisCore) window.jarvisCore.focus = null;
        card.classList.remove("show", "pinned");
      },
      now ? 0 : 160,
    );
  }
  NODES.forEach((n) => {
    n.el.addEventListener("pointerenter", () => show(n.k));
    n.el.addEventListener("pointerleave", () => hide());
    n.el.addEventListener("focus", () => openK !== n.k && show(n.k));
    n.el.addEventListener("blur", () => hide());
    n.el.addEventListener("click", () => (pinned && openK === n.k ? hide(true) : show(n.k, true)));
  });
  card.addEventListener("pointerenter", () => clearTimeout(hideT));
  card.addEventListener("pointerleave", () => hide());
  card.addEventListener("click", (e) => {
    if (!e.target.closest('[data-act="taskmgr"]')) return;
    api("/api/app/taches", { method: "POST" })
      .then((r) => toast(r.text || "Gestionnaire des tâches ouvert."))
      .catch((err) => toast(err.message, true));
  });
  document.addEventListener("pointerdown", (e) => pinned && !e.target.closest(".hw-node, .hw-card") && hide(true));
  document.addEventListener("keydown", (e) => e.key === "Escape" && openK && hide(true));

  // ---------- Relevés : seulement quand les points sont visibles ----------
  const narrow = matchMedia("(max-width: 760px)");
  const onAssistant = () => !document.body.dataset.page || document.body.dataset.page === "0";
  const visible = () => !document.hidden && !narrow.matches && onAssistant() && !stage.classList.contains("convo") && !layer.classList.contains("none");
  let timer = 0, busy = false;
  async function poll() {
    clearTimeout(timer);
    if (visible() && !busy) {
      busy = true;
      try {
        const r = await fetch("/api/hardware");
        if (r.ok) update(await r.json());
      } catch {
        // Serveur occupé : prochain essai au tour suivant.
      }
      busy = false;
    }
    timer = setTimeout(poll, openK ? 1500 : 2500);
  }
  const sync = () => (visible() ? Date.now() - lastAt > 2500 && poll() : hide(true));
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["data-page"] });
  new MutationObserver(sync).observe(stage, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", sync);
  layout();
  poll();
})();
