// ================== JARVIS : palette de commandes (Ctrl+K) ==================
// On tape ce qu'on veut faire ("météo", "chill", "kwmail", "réglages"…) et Entrée.
const normText = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function paletteActions(query) {
  const acts = [];
  const add = (icon, label, run, hint = "") => acts.push({ icon, label, run, hint });
  add("message", "Aller à l'assistant", () => goTo(0), "Page");
  add("grid", "Aller aux widgets", () => goTo(1), "Page");
  add("globe", "Aller au navigateur", () => goTo(2), "Page");
  add("folder", "Aller aux projets", () => goTo(3), "Page");
  add("settings", "Ouvrir les réglages", () => openSettings(), "Réglages");
  for (const [g, meta] of Object.entries(SECTIONS)) add(meta.icon, `Réglages : ${meta.title}`, () => openSettings(g.replace(/[^a-z]/gi, "")), "Réglages");
  add("sunrise", "Briefing du jour", () => (goTo(0), send("Fais-moi mon briefing : météo du jour, mon agenda d'aujourd'hui et demain, mes mails non lus importants et mes tâches.")), "Jarvis");
  add("calendar", "Ma semaine", () => (goTo(0), send("Qu'est-ce que j'ai de prévu cette semaine ?")), "Jarvis");
  add("mail", "Résumer mes mails", () => (goTo(0), send("Résume mes mails non lus.")), "Jarvis");
  add("cloud-sun", "Météo", () => (goTo(0), send("Quel temps fait-il aujourd'hui et demain ?")), "Jarvis");
  add("heart", "Lancer mes titres likés", () => api("/api/spotify/play", { method: "POST", body: { liked: true } }).then(() => toast("Lecture : tes titres likés"), (e) => toast(e.message, true)), "Musique");
  add("pause", "Pause / reprise de la musique", () => api(`/api/music/${cache.music?.data?.playing ? "pause" : "play"}`, { method: "POST" }).then(() => setTimeout(refreshMusic, 500), (e) => toast(e.message, true)), "Musique");
  add("next", "Titre suivant", () => api("/api/music/next", { method: "POST" }).then(() => setTimeout(refreshMusic, 500), (e) => toast(e.message, true)), "Musique");
  for (const p of spotifyLib.playlists || []) {
    add("music", `Playlist : ${p.name}`, () => api("/api/spotify/play", { method: "POST", body: { playlist: p.name } }).then(() => toast(`Lecture : ${p.name}`), (e) => toast(e.message, true)), "Musique");
  }
  for (const p of (typeof proj !== "undefined" && proj.list) || []) {
    const url = p.site || p.repo || p.host;
    if (url) add("folder", `Projet : ${p.name}`, () => (p.site ? window.openInJarvis(p.site) : openExternal(url)), p.site ? "Site" : "GitHub");
  }
  add(state.voiceOn ? "volume-x" : "volume", state.voiceOn ? "Couper la voix de Jarvis" : "Remettre la voix de Jarvis", () => $("#voiceToggle").click(), "Voix");
  add("plus", "Nouvel onglet web", () => (goTo(2), window.openInJarvis("")), "Web");

  const q = normText(query.trim());
  let list = acts;
  if (q) {
    const words = q.split(/\s+/);
    list = acts.filter((a) => words.every((w) => normText(a.label + " " + a.hint).includes(w)));
    // Toujours proposer : demander à Jarvis, ou chercher sur le web.
    list.push({ icon: "message", label: `Demander à Jarvis : « ${query.trim()} »`, run: () => (goTo(0), send(query.trim())), hint: "Entrée" });
    list.push({ icon: "globe", label: `Chercher sur le web : « ${query.trim()} »`, run: () => window.openInJarvis(query.trim()), hint: "Web" });
  }
  return list.slice(0, 12);
}

function openPalette() {
  if (document.querySelector(".palette-bg")) return;
  if (state.status?.spotify?.connected) loadPlaylists();
  const bg = el("div", "palette-bg");
  const box = el("div", "palette");
  const input = el("input");
  input.placeholder = "Que veux-tu faire ? (météo, une playlist, un projet, réglages…)";
  const ul = el("ul");
  box.append(input, ul);
  bg.append(box);
  document.body.append(bg);
  let items = [];
  let sel = 0;
  const render = () => {
    items = paletteActions(input.value);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    ul.replaceChildren(
      ...items.map((a, i) => {
        const li = el("li", i === sel ? "on" : "");
        li.append(iconEl(a.icon, 16), el("span", null, a.label), el("small", null, a.hint));
        li.onmouseenter = () => {
          sel = i;
          ul.querySelectorAll("li").forEach((x, j) => x.classList.toggle("on", j === i));
        };
        li.onclick = () => run(a);
        return li;
      }),
    );
  };
  const close = () => bg.remove();
  const run = (a) => {
    close();
    a.run();
  };
  input.addEventListener("input", () => {
    sel = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") sel = Math.min(items.length - 1, sel + 1);
    else if (e.key === "ArrowUp") sel = Math.max(0, sel - 1);
    else if (e.key === "Enter" && items[sel]) return run(items[sel]);
    else if (e.key === "Escape") return close();
    else return;
    e.preventDefault();
    ul.querySelectorAll("li").forEach((x, j) => x.classList.toggle("on", j === sel));
    ul.querySelector("li.on")?.scrollIntoView({ block: "nearest" });
  });
  bg.addEventListener("mousedown", (e) => e.target === bg && close());
  render();
  input.focus();
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
  }
});
$("#paletteBtn")?.addEventListener("click", openPalette);
hydrateIcons(document.querySelector(".top-actions"));
