# JARVIS

Assistant personnel pour Windows, avec une interface façon HUD. Tu lui parles à la voix ou par écrit, et il gère :

- **IA Claude** : la conversation, la réflexion et la recherche web
- **Google Agenda** : voir et ajouter des événements
- **Gmail** : lire, résumer et préparer des réponses (rien ne part sans ton clic sur « Envoyer »)
- **Google Tasks** : ta liste de tâches
- **Spotify** : ce qui joue, pause, suivant, volume, et lancer un titre, un artiste ou une playlist
- **Météo** : gratuite, sans compte

Et aussi :

- le **mot de réveil** (« Jarvis, … »)
- la **mémoire** (« retiens que… »)
- les **minuteurs**
- l'**ouverture de sites**
- le **briefing du matin**
- un **compteur de coût de l'IA** en direct

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

## 1. Clé IA (obligatoire)

1. Crée un compte sur https://platform.claude.com.
2. Dans **Billing**, ajoute un peu de crédit (5 $ suffisent pour longtemps).
3. Dans **API Keys**, clique **Create Key**, puis colle la clé dans **Réglages > Clé API Claude**.

**Coût :** par défaut, Jarvis utilise Claude Haiku 5.5, le modèle le plus économique. Une question coûte en général moins d'un dixième de centime, soit environ 1 € pour 1 000 questions. Une recherche web ajoute environ 1 centime.
Pour un assistant plus malin, choisis Sonnet 5.5 dans les réglages.

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
2. Redirect URI : `http://127.0.0.1:3000/auth/spotify/callback` (bien `127.0.0.1`, pas `localhost`). Coche **Web API**.
3. Dans **User Management**, ajoute l'e-mail de ton compte Spotify.
4. Colle le Client ID et le Client secret dans **Réglages > Spotify**, puis clique **Connecter**.

Voir ce qui joue marche avec tous les comptes. **Contrôler** la musique demande **Spotify Premium** et Spotify ouvert sur un appareil.

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
lib/agent.js         le cerveau IA et ses outils (c'est ici qu'on ajoute des pouvoirs)
lib/config.js        réglages modifiables depuis l'interface
lib/google.js        Agenda, Gmail, Tâches
lib/spotify.js       Spotify
lib/weather.js       Météo (Open-Meteo)
public/              interface (HTML, CSS, JS, icônes SVG)
launcher/            lanceur Windows, icône près de l'horloge, installation
```

Pour développer : `npm run dev` (redémarre tout seul à chaque modification).
