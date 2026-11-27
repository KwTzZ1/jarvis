# JARVIS

Assistant personnel pour Windows, avec une interface façon HUD. Tu lui parles à la voix ou par écrit, et il gère :

- **IA Claude** : la conversation, la réflexion et la recherche web
- **IA gratuite (Groq)** : prend le relais si Claude n'a pas de crédit, ou sert seule si tu ne veux rien payer
- **Google Agenda** : voir et ajouter des événements
- **Gmail** : lire, résumer et préparer des réponses (rien ne part sans ton clic sur « Envoyer »)
- **Google Tasks** : ta liste de tâches
- **Spotify** : ce qui joue, pause, suivant, volume, et lancer un titre, un artiste ou une playlist
- **Météo** : gratuite, sans compte
- **Discord** : lire tes salons et y écrire, via ton propre bot
- **Onglet Web** : recherche Google ou Bing et sites directement dans Jarvis, avec YouTube intégré
- **Onglet Projets** : tous tes projets (sites, bots, applis) avec leurs liens, que Jarvis connaît aussi
- **Images** : joins des images (il les voit) et demande-lui d'en créer

Et aussi :

- le **mot de réveil** (« Jarvis, … »)
- la **mémoire** (« retiens que… »)
- les **minuteurs**
- l'**ouverture de sites**
- le **briefing du matin**
- un **compteur de coût de l'IA** en direct
- un **onglet Widgets** : une deuxième page (balaye vers la gauche) où tu ranges, redimensionnes et empiles tes widgets

---

## Installation

Prérequis : [Node.js](https://nodejs.org) (version LTS) et Google Chrome ou Microsoft Edge.

1. Double-clique sur **`Installer Jarvis.bat`**.
2. Un raccourci **Jarvis** apparaît sur le Bureau et dans le menu Démarrer.
3. Lance Jarvis. Il s'ouvre dans sa propre fenêtre, et une icône apparaît près de l'horloge.
   Clic droit sur cette icône : *Ouvrir*, *Redémarrer le serveur*, *Ouvrir le dossier*, *Quitter*.

Pour que Jarvis se lance au démarrage de Windows, tape ceci dans un terminal ouvert dans le dossier :

```powershell
powershell -ExecutionPolicy Bypass -File launcher\install.ps1 -Demarrage
```

Toutes les clés se règlent dans l'application, avec le bouton **Réglages** en haut à droite.

---

## 1. Clé IA

Il faut au moins une des deux clés : Claude (payant, le plus malin) ou Groq (gratuit, plus simple).
Avec les deux, laisse **Réglages > IA utilisée** sur « Automatique » : Claude répond, et l'IA gratuite prend le relais s'il n'a plus de crédit.

### Claude (payant)

1. Crée un compte sur https://platform.claude.com.
2. Dans **Billing**, ajoute un peu de crédit (5 $ suffisent pour longtemps).
3. Dans **API Keys**, clique **Create Key**, puis colle la clé dans **Réglages > Clé API Claude**.

**Coût :** par défaut, Jarvis utilise Claude Haiku 5.5, le modèle le plus économique. Une question coûte en général moins d'un dixième de centime, soit environ 1 € pour 1 000 questions. Une recherche web ajoute environ 1 centime.
Pour un assistant plus malin, choisis Sonnet 5.5 dans les réglages.

Sans crédit, la clé est reconnue mais l'IA refuse de répondre : le voyant « IA Claude » passe au rouge (« sans crédit »). Dès que tu ajoutes du crédit, Jarvis le détecte tout seul dans la minute.

### IA gratuite : Groq

1. Crée un compte gratuit sur https://console.groq.com.
2. Dans **API Keys**, clique **Create API Key**, puis colle la clé (elle commence par `gsk_`) dans **Réglages > Clé Groq**.

Modèle par défaut : GPT-OSS 120B. Il est moins doué que Claude, mais il sait utiliser l'agenda, les mails, Spotify, la météo, les minuteurs, etc.
Limites de l'offre gratuite (indiquées par Groq) : environ 30 requêtes par minute et 1 000 par jour. Une question simple en utilise une, une question qui utilise un outil (météo, agenda…) en utilise deux ou trois. Si tu enchaînes très vite, Jarvis attend quelques secondes tout seul.
Pas de recherche web avec l'IA gratuite. Les réponses venant de Groq portent l'étiquette « IA GRATUITE ».
Confidentialité : selon Groq, les requêtes ne sont pas conservées par défaut (sauf jusqu'à 30 jours en cas d'abus ou de panne). Elles passent tout de même par leurs serveurs aux États-Unis, mails compris si tu lui demandes de les lire.

## 2. Google : Agenda, Gmail, Tâches

1. Va sur https://console.cloud.google.com et crée un projet « Jarvis ».
2. Dans **APIs et services > Bibliothèque**, active :
   - Google Calendar API
   - Gmail API
   - Google Tasks API
3. Dans **Écran de consentement OAuth** (ou *Google Auth Platform*) :
   - choisis le type **Externe**, nomme l'app *Jarvis* ;
   - ajoute **ton adresse Gmail comme utilisateur test**.
4. Dans **Clients** (ou *Identifiants*), crée un **ID client OAuth** de type **Application Web** :
   - URI de redirection autorisé : `http://localhost:3000/auth/google/callback`
5. Colle le Client ID et le Client secret dans **Réglages > Google**, puis clique **Connecter**.
   - Google affiche « Application non validée » : c'est normal, c'est ta propre app. Clique **Paramètres avancés**, puis **Accéder à Jarvis**.

Tant que l'app Google est en mode test, la connexion expire environ tous les 7 jours. Il suffit de recliquer sur **Connecter**.

## 3. Spotify

1. Va sur https://developer.spotify.com/dashboard et clique **Create app**.
2. Redirect URI : `http://127.0.0.1:3000/auth/spotify/callback` (bien `127.0.0.1`, pas `localhost`). Coche **Web API** et **Web Playback SDK**.
   Si les cases sont grisées, c'est que le compte connecté n'est pas Premium : Spotify réserve son API aux comptes Premium.
3. Dans **User Management**, ajoute l'e-mail de ton compte Spotify (si Spotify refuse la connexion).
4. Colle le Client ID et le Client secret dans **Réglages > Spotify**, puis clique **Connecter**.

**Lecteur intégré (Premium) :** une fois Spotify connecté, Jarvis devient lui-même un appareil Spotify, « Jarvis (PC) ».
Dis « joue Daft Punk » : la musique sort directement de Jarvis, sans ouvrir l'appli Spotify. Pause, suivant, volume et le widget Spotify le pilotent.
La fenêtre Jarvis doit rester ouverte (elle peut être réduite) : c'est elle qui joue le son.
Si tu avais connecté Spotify avec une ancienne version, clique **Déconnecter** puis **Connecter** pour accorder l'autorisation de lecture.

## 4. Discord (bot)

Discord interdit de piloter un compte normal (« self-bot », risque de bannissement). Jarvis passe donc par **ton propre bot**, la méthode officielle : il lit et écrit dans les salons des serveurs où tu l'invites. Les messages privés ne sont pas accessibles.

1. Va sur https://discord.com/developers/applications, clique **New Application** et nomme-la `Jarvis`.
2. Dans l'onglet **Bot** :
   - clique **Reset Token** et copie le jeton ;
   - plus bas, active **Message Content Intent** (sinon le bot voit les messages vides), puis **Save Changes**.
3. Colle le jeton dans **Réglages > Discord**, puis **Enregistrer**.
4. Dans Connexions, clique **Inviter** à côté de Discord, choisis ton serveur et valide. Il faut être administrateur du serveur, ou avoir le droit de gérer le serveur.

Ensuite :
- le **widget Discord** affiche un salon (menu en haut du widget) et permet d'y écrire ;
- tu peux dire « lis mes derniers messages Discord », ou « envoie sur #général que j'arrive » : un brouillon s'affiche et rien ne part sans ton clic sur **Envoyer**.

Les messages sont postés au nom du bot.

## 5. YouTube

Le site youtube.com refuse d'être affiché dans une autre appli, mais son lecteur vidéo l'accepte. Jarvis a donc sa propre vue YouTube :
- recherche avec vignettes ;
- lecture dans Jarvis ;
- « mets la vidéo de … » à la voix.

Pour chercher, il faut une **clé YouTube gratuite** (environ 100 recherches par jour) :
1. Dans ton projet Google Cloud (le même que pour l'agenda), active **YouTube Data API v3** : https://console.cloud.google.com/apis/library/youtube.googleapis.com
2. Dans **APIs et services > Identifiants**, clique **Créer des identifiants > Clé API**, puis copie-la.
3. Colle-la dans **Réglages > YouTube**.

Sans clé, les liens YouTube collés dans la barre d'adresse se lisent quand même.

## 6. Onglet Web

**Tous les sites s'affichent** (YouTube complet, Reddit, journaux, liens cliqués dans Google…). Comment ça marche :
- La fenêtre Jarvis est ouverte par un petit « gardien » (`launcher/window.mjs`), qui y charge l'extension `extension/` de Jarvis.
- Cette extension retire, **uniquement pour les sites affichés dans l'onglet Web de Jarvis**, l'interdiction « pas d'affichage dans une autre appli ». Ton Chrome habituel n'est pas concerné.
- Dans l'onglet Web, tu n'es connecté à rien (comme en navigation privée). Les liens qui demandent d'être connecté (GitHub privé, Railway, claude.ai) s'ouvrent donc dans **ton navigateur habituel**. C'est aussi le rôle du bouton en haut à droite de la barre d'adresse.

Troisième page : barre d'adresse, plusieurs onglets, précédent, suivant, recharger, accueil.
- Tape une recherche ou une adresse. La recherche passe par Google, ou Bing (au choix dans **Réglages > Recherche**).
- Beaucoup de grands sites (YouTube en page normale, Reddit, la plupart des journaux…) **refusent d'être affichés dans une autre appli**. Jarvis le détecte et propose « Ouvrir dans une fenêtre ».
- Les liens YouTube sont convertis en lecteur vidéo, qui, lui, s'affiche.
- Quand tu dis « ouvre … », le site arrive dans cet onglet.
- Si Google affiche une page « trafic inhabituel », passe sur Bing dans les réglages.

---

## 7. Images

- **Joindre une image :**
  - trombone à gauche de la zone de texte, Ctrl+V pour coller une capture, ou glisser-déposer ;
  - 3 images maximum par message ;
  - Claude les voit directement. Avec l'IA gratuite, Jarvis passe tout seul sur un modèle gratuit qui voit les images (Qwen 3.8 chez Groq).
- **Créer une image :**
  - dis « fais-moi une image de … » ;
  - c'est gratuit et sans compte, via Pollinations ;
  - limites : une image toutes les 45 secondes, petit logo en bas à droite, et une image est visible par toute personne qui a son lien ;
  - les images sont gardées dans `data/images` et dans le widget « Mes images ».
- **Trouver une vraie photo :**
  - dis « montre-moi Werenoi », « à quoi ressemble la tour Eiffel » ;
  - Jarvis cherche sur Wikipédia, Openverse (photos libres) et Spotify pour les artistes, puis affiche une petite galerie ; clique une photo pour ouvrir sa source.
- Les images jointes sont envoyées en meilleure qualité (jusqu'à 2000 px) pour que Jarvis puisse lire les captures d'écran ; s'il ne peut pas lire un texte, il le dit au lieu d'inventer.

## 8. Onglet Projets

- Une carte par projet : statut, étiquettes, et boutons Site (ouvert dans l'onglet Web), GitHub, Hébergement et Dossier (ouvre l'explorateur).
- La pastille verte ou rouge indique si le site répond.
- **Synchroniser GitHub** ajoute les dépôts qui manquent ; il utilise l'outil `gh` connecté sur le PC.
- Jarvis connaît la liste : « quels sont mes projets ? », « ouvre le site de KwMail », « ouvre le dossier de Jarvis ».
- La liste est enregistrée dans `data/projects.json`, sur ton PC uniquement.

## Spotify : playlists et titres likés

« Mets ma playlist Chill » cherche d'abord dans **tes** playlists. « Mets mes titres likés » lance tes coups de cœur. Le widget Spotify a aussi un menu « Mes playlists ».
Spotify ne laisse pas les nouvelles applis lire ses propres playlists automatiques (Découvertes de la semaine, Daylist, Mix…).

## Palette de commandes (Ctrl+K)

Appuie sur **Ctrl+K** (ou clique « Rechercher » en haut) et tape ce que tu veux : « météo », « manette » (une playlist), « kwmail » (un projet), « réglages », « suivant »… puis Entrée.
Si rien ne correspond, tu peux demander à Jarvis ou chercher sur le web.

## Exemples

- « Ouvre Discord », « lance Steam », « ouvre la calculatrice » (liste fermée : Discord, Steam, Spotify, Epic Games, Paramètres, Calculatrice, Bloc-notes, Explorateur, Gestionnaire des tâches, Capture d'écran)
- « Comment va mon PC ? » (processeur, mémoire, disque)
- « Jarvis, fais-moi mon briefing »
- « Qu'est-ce que j'ai demain ? »
- « Ajoute un rendez-vous chez le coiffeur samedi à 14 h »
- « Réponds à Thomas que je suis d'accord pour vendredi »
- « Ajoute acheter du lait à ma liste »
- « Mets la playlist Lofi Beats », « Monte le son à 60 »
- « Rappelle-moi d'appeler maman dans 20 minutes »
- « Retiens que mon équipe préférée c'est le PSG »
- « Quelles sont les dernières actus sur la PS5 ? »

## L'interface

- **Au centre, la sphère** : un réseau de points reliés qui tourne et ondule. Elle passe au **violet mauve** quand Jarvis parle, s'agite quand il écoute ou réfléchit. Clique dessus pour parler.
- **En discussion**, la sphère se fait petite en haut et la conversation prend la place ; au bout de 2 minutes sans échange, elle reprend sa place au centre avec l'heure.
- **Sur les autres onglets**, elle se réduit en bas à droite : un clic dessus ramène à l'Assistant.
- **Ligne d'infos** sous la barre du haut : météo, prochain rendez-vous, mails non lus, musique en cours. Un clic (ou le bouton ☰ en haut à gauche) ouvre l'**Aperçu** avec tout le détail (agenda, mails, tâches, minuteurs, mémoire, connexions).

## Onglet Widgets

- Passe d'une page à l'autre avec les onglets en haut, en **balayant** (doigt, pavé tactile à deux doigts, ou en attrapant le fond de la page à la souris) ou avec **Ctrl + flèche droite / gauche**.
- **Ajouter** : horloge, météo, Spotify, agenda, mails, tâches, minuteurs (boutons 5, 10 et 25 min), mémoire, raccourcis, et « Demande à Jarvis » pour lui parler sans changer de page.
- **Modifier** :
  - attrape un widget pour le déplacer ;
  - lâche-le **au centre d'un autre** pour les **empiler** (les flèches du widget passent de l'un à l'autre) ;
  - icônes en haut à droite : taille (petit, large, haut, grand), défaire la pile, supprimer.
- La disposition est gardée sur ce PC. « Disposition par défaut » remet tout comme au début.
- **Sans passer par Modifier** :
  - attrape un widget par son titre pour le déplacer ;
  - tire le coin en bas à droite pour changer sa taille ;
  - **pince** (deux doigts sur écran tactile) ou **Ctrl + molette** sur un widget pour l'agrandir ou le réduire.
- **En direct** :
  - Spotify : titre en cours avec une timeline (clique ou glisse pour avancer), pochettes de tes playlists ; un clic lance la playlist et l'ouvre dans le widget avec tous ses titres (clic sur un titre pour le jouer, flèche pour revenir) ;
  - **Spotify (recherche)** : cherche un titre, ▶ pour l'écouter, + pour l'ajouter à une de tes playlists ou en créer une nouvelle (la première fois : Réglages → Spotify → Déconnecter puis Connecter, pour donner l'autorisation de modifier tes playlists) ;
  - **Système** : processeur, mémoire et disque en direct (barre rouge au-delà de 85 %) ;
  - **Bloc-notes** : tes notes, enregistrées automatiquement sur ce PC ;
  - Discord : messages du salon mis à jour toutes les 5 secondes, avec avatars ; les nouveaux s'allument ;
  - Mails : expéditeur, heure, objet et début du message ;
  - le reste se met à jour toutes les minutes tant que la page Widgets est ouverte.

## Voix

Réglages → **Voix** : choisis la voix, la vitesse et la hauteur (plus grave = plus « majordome »), puis « Tester ».
Le bouton **Style Jarvis** règle tout en un clic (voix masculine, grave et posée).

**Voix naturelle (Piper)** : si Piper est installé dans `%LOCALAPPDATA%\Jarvis\piper` (avec ses voix dans `voices/`), Jarvis parle avec une voix naturelle générée sur ton PC, sans internet. Choix du « Moteur » dans Réglages → Voix (Tom = homme, UPMC = autre voix), ou retour à la voix du navigateur.

**Images dans le chat** : clique sur une image (envoyée ou reçue) pour l'afficher en grand ; flèches pour passer de l'une à l'autre, Échap pour fermer.

## Performances

Jarvis consomme peu quand il ne sert pas :
- pas d'effet de flou en arrière-plan (très coûteux pour la carte graphique) ;
- les pages qui ne sont pas à l'écran ne sont pas dessinées, et les animations s'arrêtent sur les autres pages et quand la fenêtre est réduite ;
- dans l'onglet Web, un seul site est actif à la fois : les autres onglets se rechargent quand on revient dessus.

**Raccourcis :**
- maintiens **Espace**, ou clique sur le réacteur, pour parler ;
- l'icône **ondes** active l'écoute permanente ;
- l'icône **haut-parleur** coupe ou remet la voix.

---

## Sur ton téléphone

1. Réglages → **Téléphone** → « Activé (même Wi-Fi) » → Enregistrer.
2. Rouvre les réglages : un **QR code** apparaît. Scanne-le avec l'appareil photo du téléphone (même Wi-Fi que le PC).
3. Dans le navigateur du téléphone : « Ajouter à l'écran d'accueil » pour l'avoir comme une appli.

- La première fois, Windows peut demander d'autoriser Node.js : accepte pour les **réseaux privés**.
- L'accès est protégé par un code secret contenu dans le QR code. « Changer le code » déconnecte tous les téléphones.
- Depuis le téléphone, les réglages sont bloqués. Le micro ne marche pas (le navigateur l'interdit sans HTTPS) : écris tes demandes.

## Télécommande du PC

- Widget **Télécommande PC** (idéal depuis le téléphone) : son −/muet/+, précédent/lecture/suivant (marche avec YouTube, Netflix, Spotify…), verrouiller le PC.
- **Envoyer au PC** : colle un texte ou un lien, puis « Copier sur le PC » (presse-papiers) ou « Ouvrir sur le PC ». « Récupérer » rapatrie ce qui est copié sur le PC.
- À la voix ou par écrit : « baisse le son », « mets pause », « verrouille le PC », « copie ce lien sur le PC : … », « qu'est-ce que j'ai copié ? ».

## Sécurité

- Tout tourne sur ton PC. Le serveur n'écoute que ta machine (127.0.0.1).
- Les clés et les connexions sont dans `data/`, qui est exclu de Git. Ne partage jamais ce dossier.
- Les mails ne partent jamais sans ta confirmation.

## Structure

```
server.js            serveur local (routes, connexions)
lib/agent.js         le cerveau IA (Claude) et ses outils (c'est ici qu'on ajoute des pouvoirs)
lib/groq.js          l'IA gratuite (Groq), avec les mêmes outils
lib/config.js        réglages modifiables depuis l'interface
lib/google.js        Agenda, Gmail, Tâches
lib/spotify.js       Spotify
lib/weather.js       Météo (Open-Meteo)
lib/discord.js       Discord (bot)
lib/youtube.js       recherche YouTube
lib/images.js        création d'images (Pollinations) et images jointes
lib/projects.js      onglet Projets
lib/web.js           Onglet Web : vérifie si un site accepte d'être affiché
public/              interface (HTML, CSS, JS, icônes SVG)
public/widgets.js    onglet Widgets (pages qui glissent, déplacer, empiler)
public/web.js        onglet Web (petit navigateur)
public/player.js     lecteur Spotify intégré (Premium)
public/projects.js   onglet Projets
public/palette.js    palette de commandes (Ctrl+K)
extension/           extension Chrome de Jarvis (affichage de tous les sites dans l'onglet Web)
launcher/window.mjs  gardien de la fenêtre (charge l'extension)
public/fonts/        polices Orbitron, Exo 2, Share Tech Mono (licence OFL)
launcher/            lanceur Windows, icône près de l'horloge, installation
```

Pour développer : `npm run dev` (redémarre tout seul à chaque modification).
