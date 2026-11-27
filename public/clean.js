// Interface épurée : tiroir d'infos, mode conversation (la sphère se fait petite quand on discute)
// et ligne « coup d'œil » (météo, prochain rendez-vous, mails, musique).
(() => {
  const stage = document.querySelector("#pageAssistant .stage");
  const chat = document.getElementById("chat");
  const input = document.getElementById("input");
  if (!stage || !chat) return;

  // ---------- Tiroir d'infos ----------
  const openDrawer = () => document.body.classList.add("drawer-open");
  const closeDrawer = () => document.body.classList.remove("drawer-open");
  document.getElementById("drawerBtn")?.addEventListener("click", () => document.body.classList.toggle("drawer-open"));
  document.getElementById("drawerClose")?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());
  // Clic en dehors du tiroir : il se ferme.
  document.addEventListener("pointerdown", (e) => {
    if (document.body.classList.contains("drawer-open") && !e.target.closest("#drawer, #drawerBtn, .gl-item")) closeDrawer();
  });
  new MutationObserver(closeDrawer).observe(document.body, { attributes: true, attributeFilter: ["data-page"] });

  // ---------- Mode conversation ----------
  // Au repos : grande sphère, l'heure, et seulement la dernière réponse en sous-titre.
  // Dès qu'on discute : la sphère se réduit en haut et la discussion prend la place. Retour au repos après 2 min.
  let idle;
  function setConvo(on) {
    stage.classList.toggle("convo", on);
    document.body.classList.toggle("convo", on);
  }
  function touch() {
    setConvo(true);
    clearTimeout(idle);
    idle = setTimeout(function check() {
      if (document.activeElement === input || state.busy || state.speaking) idle = setTimeout(check, 30_000);
      else setConvo(false);
    }, 120_000);
  }
  new MutationObserver(() => chat.querySelector(".msg.user") && touch()).observe(chat, { childList: true });
  input?.addEventListener("focus", () => chat.querySelector(".msg.user") && touch());

  // ---------- Coup d'œil ----------
  const glance = document.getElementById("glance");
  function item(icon, strong, rest, title) {
    const b = el("button", "gl-item");
    b.type = "button";
    b.title = title || "Ouvrir l'aperçu";
    b.append(iconEl(icon, 14), el("b", null, strong));
    if (rest) b.append(el("span", null, rest));
    b.onclick = openDrawer;
    return b;
  }
  function renderGlance() {
    if (!glance) return;
    const d = cache.dashboard || {};
    const items = [];
    const w = d.weather?.data;
    if (w?.now) items.push(item(w.now.icon || "cloud", `${w.now.temp}°`, w.city || "", w.now.description));
    const ev = Array.isArray(d.events?.data) ? d.events.data[0] : null;
    if (ev) items.push(item("calendar", fmtWhen(ev.start, ev.allDay), ev.title, "Prochain rendez-vous"));
    const mails = d.emails?.data;
    if (Array.isArray(mails) && mails.length) items.push(item("mail", String(mails.length), mails.length > 1 ? "mails non lus" : "mail non lu"));
    const mu = cache.music?.data;
    if (mu?.title) items.push(item(mu.playing ? "music" : "pause", mu.title, mu.artist, "En cours sur Spotify"));
    glance.replaceChildren(...items);
  }
  hooks.data.push(renderGlance);
  hooks.music.push(renderGlance);
  renderGlance();
})();
