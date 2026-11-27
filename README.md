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
- **Onglet Web** : recherche Google ou Bing et sites directement dans Jarvis

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

## 5. Onglet Web

Troisième page : barre d'adresse, plusieurs onglets, précédent, suivant, recharger, accueil.
- Tape une recherche ou une adresse. La recherche passe par Google, ou Bing (au choix dans **Réglages > Recherche**).
- Beaucoup de grands sites (YouTube en page normale, Reddit, la plupart des journaux…) **refusent d'être affichés dans une autre appli**. Jarvis le détecte et propose « Ouvrir dans une fenêtre ».
- Les liens YouTube sont convertis en lecteur vidéo, qui, lui, s'affiche.
- Quand tu dis « ouvre … », le site arrive dans cet onglet.
- Si Google affiche une page « trafic inhabituel », passe sur Bing dans les réglages.

---

## Exemples

- « Jarvis, fais-moi mon briefing »
- « Qu'est-ce que j'ai demain ? »
- « Ajoute un rendez-vous chez le coiffeur samedi à 14 h »
- « Réponds à Thomas que je suis d'accord pour vendredi »
- « Ajoute acheter du lait à ma liste »
- « Mets la playlist Lofi Beats », « Monte le son à 60 »
- « Rappelle-moi d'appeler maman dans 20 minutes »
- « Retiens que mon équipe préférée c'est le PSG »
- « Quelles sont les dernières actus sur la PS5 ? »

## Onglet Widgets

- Passe d'une page à l'autre avec les onglets en haut, en **balayant** (doigt, pavé tactile à deux doigts, ou en attrapant le fond de la page à la souris) ou avec **Ctrl + flèche droite / gauche**.
- **Ajouter** : horloge, météo, Spotify, agenda, mails, tâches, minuteurs (boutons 5, 10 et 25 min), mémoire, raccourcis, et « Demande à Jarvis » pour lui parler sans changer de page.
- **Modifier** :
  - attrape un widget pour le déplacer ;
  - lâche-le **au centre d'un autre** pour les **empiler** (les flèches du widget passent de l'un à l'autre) ;
  - icônes en haut à droite : taille (petit, large, haut, grand), défaire la pile, supprimer.
- La disposition est gardée sur ce PC. « Disposition par défaut » remet tout comme au début.

**Raccourcis :**
- maintiens **Espace**, ou clique sur le réacteur, pour parler ;
- l'icône **ondes** active l'écoute permanente ;
- l'icône **haut-parleur** coupe ou remet la voix.

---

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
lib/web.js           Onglet Web : vérifie si un site accepte d'être affiché
public/              interface (HTML, CSS, JS, icônes SVG)
public/widgets.js    onglet Widgets (pages qui glissent, déplacer, empiler)
public/web.js        onglet Web (petit navigateur)
public/player.js     lecteur Spotify intégré (Premium)
public/fonts/        polices Orbitron, Exo 2, Share Tech Mono (licence OFL)
launcher/            lanceur Windows, icône près de l'horloge, installation
```

Pour développer : `npm run dev` (redémarre tout seul à chaque modification).
