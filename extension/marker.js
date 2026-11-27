// Sur les pages Jarvis : demande à l'extension d'autoriser l'affichage des sites dans cet onglet,
// puis signale à Jarvis que c'est actif (attribut data-jarvis-frames sur la page).
chrome.runtime.sendMessage({ type: "jarvis-hello" }, (res) => {
  if (chrome.runtime.lastError || !res?.ok) return;
  document.documentElement.dataset.jarvisFrames = "1";
  window.dispatchEvent(new Event("jarvis-frames-ready"));
});
