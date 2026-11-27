// ================== JARVIS : lecteur Spotify intégré ==================
// Avec Spotify Premium, cette page devient un appareil Spotify ("Jarvis (PC)").
// "Joue …" fait sortir la musique d'ici, sans l'appli Spotify. La fenêtre doit rester ouverte.

const playerState = { started: false, player: null, deviceId: null, retries: 0 };

const PLAYER_ERRORS = {
  initialization_error: "Le lecteur intégré ne peut pas démarrer (protection des contenus du navigateur). Réessaie dans une minute : Chrome finit parfois de l'installer au premier lancement.",
  authentication_error: "Spotify refuse le lecteur intégré : clique Déconnecter puis Connecter à côté de Spotify.",
  account_error: "Le lecteur intégré demande un compte Spotify Premium.",
  playback_error: "Spotify n'a pas pu lire ce morceau.",
};

function loadSpotifySdk() {
  if (document.querySelector("script[data-spotify-sdk]")) return;
  window.onSpotifyWebPlaybackSDKReady = startPlayer;
  const s = document.createElement("script");
  s.src = "https://sdk.scdn.co/spotify-player.js";
  s.dataset.spotifySdk = "1";
  s.onerror = () => {
    playerState.started = false; // pas d'internet : on retentera au prochain statut
    document.querySelector("script[data-spotify-sdk]")?.remove();
  };
  document.head.append(s);
}

async function declareDevice(id) {
  playerState.deviceId = id;
  try {
    await api("/api/spotify/device", { method: "POST", body: { id } });
  } catch {}
  loadStatus();
}

function startPlayer() {
  const player = new Spotify.Player({
    name: `${state.name} (PC)`,
    volume: 0.7,
    getOAuthToken: (cb) => api("/api/spotify/token").then((r) => cb(r.token), () => {}),
  });
  playerState.player = player;

  player.addListener("ready", ({ device_id }) => {
    playerState.retries = 0;
    declareDevice(device_id);
  });
  player.addListener("not_ready", () => declareDevice(null));
  // Changement de morceau, pause… : on met à jour les widgets tout de suite.
  player.addListener("player_state_changed", () => setTimeout(refreshMusic, 300));
  for (const kind of Object.keys(PLAYER_ERRORS)) {
    player.addListener(kind, ({ message }) => {
      console.warn("Lecteur Spotify :", kind, message);
      toast(PLAYER_ERRORS[kind], true);
      if (kind === "initialization_error" && playerState.retries++ < 3) {
        setTimeout(() => player.connect(), 60_000);
      }
    });
  }
  player.connect();

  // Les navigateurs bloquent le son tant qu'on n'a pas cliqué ou tapé sur la page : on "réveille" le lecteur au premier geste.
  const wake = () => player.activateElement?.();
  document.addEventListener("pointerdown", wake, { once: true, capture: true });
  document.addEventListener("keydown", wake, { once: true, capture: true });
}

// Démarre le lecteur dès que Spotify est connecté avec la bonne autorisation ; l'arrête si on se déconnecte.
hooks.status.push(() => {
  const sp = state.status?.spotify;
  if (sp?.playerAllowed && !playerState.started) {
    playerState.started = true;
    if (window.Spotify?.Player) startPlayer();
    else loadSpotifySdk();
  } else if (!sp?.connected && playerState.player) {
    playerState.player.disconnect();
    playerState.player = null;
    playerState.started = false;
    playerState.deviceId = null;
  }
});

// Fermeture de la fenêtre : on prévient le serveur que l'appareil Jarvis disparaît.
window.addEventListener("pagehide", () => {
  if (playerState.deviceId) navigator.sendBeacon?.("/api/spotify/device", new Blob([JSON.stringify({ id: null })], { type: "application/json" }));
});
