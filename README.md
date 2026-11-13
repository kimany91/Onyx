# ONYX

Application TV style Netflix, branchée sur **Stremio** : mêmes addons, mêmes catalogues, mêmes sources.
Contrôlable à la télécommande de la TV **ou** depuis ton téléphone (app *Onyx Remote*).

| Composant | Fichier | Rôle |
|---|---|---|
| App TV | `onyx-tv.apk` | Android TV / Google TV (TV Onyx) |
| App téléphone | `onyx-remote.apk` | Regarder sur le téléphone, ou piloter la TV et y lancer un film |
| Windows | `Onyx-Setup.exe` / `Onyx-Portable.exe` | Tester l'app TV sur PC |

Les fichiers sont générés automatiquement à chaque modification et publiés dans
**Releases** (onglet à droite de la page GitHub du projet).

---

## 1. Installer sur la TV (une seule fois)

L'app n'a pas besoin d'être publiée sur le Play Store : on l'installe directement (« sideload »).
Une fois installée, elle reste sur la TV et se met à jour toute seule.

**Méthode clé USB (la plus simple)**
1. Télécharge `onyx-tv.apk` depuis la page *Releases* sur ton PC.
2. Copie-le sur une clé USB et branche-la sur la TV.
3. Sur la TV : *Paramètres › Sécurité / Applis › Sources inconnues* → autorise le **gestionnaire de fichiers**.
4. Ouvre la clé USB dans le gestionnaire de fichiers de la TV et lance `onyx-tv.apk` → **Installer**.

**Méthode sans clé** : installe l'app *Send Files to TV* (Play Store) sur la TV et le téléphone, puis
envoie `onyx-tv.apk` du téléphone vers la TV.

Onyx apparaît ensuite dans la liste des applications de la TV (bannière **ONYX**).

## 2. L'app téléphone (avec ou sans TV)

Installe `onyx-remote.apk` sur ton téléphone Android (autorise l'installation depuis le navigateur / fichiers).
L'app s'appelle **Onyx** et fonctionne **toute seule, sans TV** :
- onglet *Explorer* : catalogues, recherche, fiches, saisons/épisodes, sources ;
- lecture directement sur le téléphone avec le même lecteur que la TV (MKV, HEVC, sous-titres), reprise là où tu t'es arrêté ;
- onglet *Addons* : ses propres addons, ajout par URL, connexion au compte Stremio.

**Connecter la TV (optionnel)**
1. Sur la TV : menu de gauche › **Connexions** → un QR code s'affiche.
2. Dans l'app téléphone : **Scanner le QR code de la TV** (onglet *Télécommande* ou *Addons*).

Une fois la TV connectée, chaque source propose **« Regarder sur ce téléphone »** ou **« Lire sur la TV »**.
Le téléphone et la TV doivent être sur le **même Wi-Fi**. Depuis le téléphone tu peux aussi :
- utiliser le pavé directionnel / OK / Retour / Lecture-Pause, avancer/reculer ;
- **chercher un film et le lancer directement sur la TV** sans toucher la télécommande ;
- taper du texte sur la TV, ajouter des addons, connecter ton compte Stremio.

> Astuce : scanner le QR code avec l'appareil photo d'un téléphone (même un iPhone) ouvre aussi la télécommande dans le navigateur.

## 3. Stremio et les addons

- **Paramètres › Se connecter à Stremio** (ou onglet *Addons* de l'app téléphone, plus pratique pour taper) :
  tous les addons de ton compte Stremio sont récupérés automatiquement, ainsi que ta bibliothèque.
- **Addons › Ajouter par URL** : colle l'URL `…/manifest.json` d'un addon, exactement comme dans Stremio.
- **Addons › Catalogue d'addons / Communauté** : le catalogue officiel de Stremio.

Accueil et navigation (TV et téléphone) :
- rangées **Au cinéma** (films sortis ces 5 derniers mois, mise à jour automatique), **Les Classiques**,
  **Disney** et **Marvel**, en plus des catalogues de tes addons ;
- **Catégories sur place** (Action, Comédie, Horreur, Famille, Animation…) : barre de petites cartes en haut
  des rangées de l'accueil. Aller sur une catégorie (TV) ou la toucher (téléphone) affiche ses films juste
  en dessous, sans ouvrir de page. La carte « maison » tout à gauche remet le menu principal, tout comme la
  touche Retour ou un changement d'onglet. Plus d'onglets Films / Séries séparés : tout est sur l'accueil. Chaque carte a une icône 3D en métal poli : sélectionnée avec la télécommande (ou doigt
  posé dessus sur le téléphone), la carte s'illumine et l'icône tourne ; elle s'arrête quand on la quitte ;
- **Passer l'intro** : pendant les logos de studio au début d'un film (Disney, Warner, Marvel…), le générique
  d'une série ou le « précédemment », un bouton *Passer l'intro* apparaît en bas à droite (OK sur la
  télécommande, ou le bouton de l'app téléphone). Les temps viennent des bases communautaires gratuites
  TheIntroDB, SkipDB et IntroDB ; pour un film absent de ces bases, Onyx repère lui-même les logos en
  analysant les 2 premières minutes (passages au noir entre les logos, sans décoder la vidéo). Le saut est
  un simple déplacement dans la vidéo déjà chargée : rien ne recharge ;
- **lecture torrent sans pause** : la vidéo est servie bloc par bloc (16 ko) dès réception au lieu
  d'attendre des morceaux entiers de 4 à 16 Mo, et un morceau que libtorrent « oublie » (cas observé
  avec des sources lentes, qui bloquait le démarrage ou un saut pendant ~2 min) est relancé après 1,5 s.
  Banc d'essai avec une seule source à 700 ko/s : saut au milieu du film ~100 s → ~6 s, 0 coupure en lecture ;
- animations fluides partout (transitions de pages, affiches qui apparaissent en cascade, boutons à ressort) ;
- **ambiance du film** : quand un film est sélectionné, l'écran prend ses couleurs et des effets de lumière
  et d'animation propres à ce film : 36 effets (toiles, hyperespace, code Matrix, reflets sous l'eau, aurores,
  portail d'étincelles, éclairs, néons, rayons de lumière, sable, lanternes, grain de vieux film…), combinés
  pour ~1 360 films et séries connus (web/js/fx-data.js) ; les grands classiques ont un **effet signature**
  dessiné pour eux (fils de marionnette du Parrain, plume de Forrest Gump, trou noir d'Interstellar, ondes de
  Jurassic Park, noir et blanc + manteau rouge de La Liste de Schindler, Anneau du Seigneur des anneaux…,
  web/js/fx-signatures.js). Chaque fond reçoit aussi des lumières posées sur les zones claires de sa propre image.
  Un film sans lien évident n'a pas d'effet inventé : seulement ses couleurs et ses lumières ;
- **image du film vivante** : lent mouvement de caméra (zoom et léger glissement) sur l'image de fond ;
- **lancement d'un film** : transition sobre, l'image du film s'ouvre depuis la carte en plein écran avec un lent
  mouvement de caméra et le logo en fondu, pendant que le chargement a déjà commencé ;
- **sons d'interface** (créés dans l'app) pour la navigation, la validation, le retour et le lancement.
  Sons, ambiance et animation de lancement se désactivent dans *Paramètres › Application*.
- pendant la lecture, **flèche retour en haut à gauche** pour quitter le film.

Addons conseillés (en tête du catalogue sur la TV, dans « Plus » sur le téléphone) : **Comet** (https://cometfortheweebs.midnightignite.me/manifest.json, sources torrent/debrid
rapides ; pour tes réglages, colle ton lien Comet personnel), **Anime Kitsu** (animes) et **Watch Next** (rangée
« À voir ensuite » sur chaque fiche ; ses liens ne sont jamais pris pour des vidéos).

Lecture « comme Netflix » (TV, téléphone et PC) :
- tu appuies sur **Lecture** ou sur un épisode : Onyx récupère les fichiers de tous tes addons et
  **choisit tout seul** celui qui correspond à ta langue et à ta qualité (pas de liste à trier) ;
- **Langue & qualité** : audio (langue de l'appareil par défaut, VO, anglais, espagnol…), sous-titres
  et qualité (Auto, 4K, 1440p, 1080p, 720p, SD). Le choix est mémorisé pour chaque série / film ;
- pendant la lecture, bouton **⚙ Langue & qualité** (ou touche Menu de la télécommande) : si le fichier
  contient déjà la langue (MULTI), la piste change instantanément ; sinon Onyx charge un autre fichier
  et **reprend exactement au même endroit** ;
- si un fichier ne se lit pas, Onyx passe automatiquement au suivant, au même endroit ;
- épisodes vus, position de lecture et « Reprendre » sont **partagés entre la TV et le téléphone**
  (dès qu'ils sont connectés) et avec ton **compte Stremio** si tu es connecté ;
- l'épisode suivant se lance tout seul à la fin ;
- le choix manuel d'un fichier reste disponible (bouton *Sources* sur la TV, « Choisir un fichier
  manuellement » sur le téléphone).

**Torrents (ex. Comet sans debrid)** : les apps Android TV et téléphone ont leur **propre moteur torrent**
(libtorrent), comme le serveur de Stremio, sans rien installer d'autre :
- le fichier est téléchargé dans l'ordre, en commençant par le début et la fin (index MKV/MP4) ;
  la lecture démarre dès les premiers morceaux, **quelle que soit la taille du fichier** ;
- dès qu'une fiche est ouverte, Onyx **précharge** la meilleure source (début + fin seulement), donc
  « Lecture » démarre quasi instantanément ; l'épisode suivant est préchargé à 85 % de l'épisode en cours ;
- en « Auto », Onyx vise le 1080p pour les torrents (démarrage bien plus rapide qu'un 4K de 15 Go) ;
- Comet liste beaucoup de torrents « morts » (sans personne pour les partager) : avant de lancer, Onyx
  **teste jusqu'à 8 torrents en parallèle** (1 à 3 s) et lance le mieux classé qui a vraiment des sources ;
- les addons lents (Comet met parfois 15-30 s à chercher) sont attendus au lieu d'afficher « aucune source » ;
- trackers publics à jour (ngosang/trackerslist) chargés au démarrage, réseau DHT mémorisé d'un lancement
  à l'autre (les pairs sont trouvés en quelques secondes) ;
- **écran de chargement cinématique** : images du film ou de la série qui défilent, logo, et une barre
  qui montre la vraie progression (sources, vérification, connexion aux pairs, mise en mémoire) jusqu'à la lecture ;
- si une source n'a pas de pairs ou ne répond pas, Onyx passe automatiquement à la suivante ;
- **pas de rechargements pendant le film** : le film en cours n'est jamais supprimé, ~90 s de film sont
  téléchargées en priorité devant la lecture, le lecteur garde jusqu'à 3 min d'avance, et un saut
  avant/arrière reprend en moins d'une seconde (les parties déjà téléchargées sont instantanées) ;
- **taille des fichiers** : seuls le début et la fin sont nécessaires pour démarrer, donc un film de 10 Go
  démarre aussi vite qu'un de 1 Go. Par contre, regarder tout le film occupe sa taille sur l'appareil
  (vidé au film suivant) : Onyx évite les fichiers plus gros que l'espace libre quand une autre version existe ;
- pendant le chargement, le lecteur affiche les pairs connectés, le débit et la progression.

Avec un compte **debrid** (Real-Debrid, AllDebrid, TorBox…) configuré dans Comet / Torrentio, les fichiers
marqués ⚡ (déjà en cache) démarrent instantanément et sont choisis en priorité ; les ⬇️ (pas en cache) sont évités.

L'audio DTS / TrueHD / E-AC3 est décodé par FFmpeg quand la TV ne sait pas le faire.
Sur la version Windows, les torrents passent par le serveur de Stremio (`Paramètres › Serveur de streaming`,
par défaut `http://127.0.0.1:11470`, l'app Stremio ouverte sur le PC).

Onyx n'héberge aucun contenu : tout vient des addons que tu choisis d'installer.

## 4. Mises à jour automatiques

L'app TV et l'app téléphone vérifient s'il existe une nouvelle version **au démarrage, à chaque retour
dans l'app (au plus une fois par heure) et toutes les 3 h** quand elles restent ouvertes. La nouvelle version
est téléchargée puis installée automatiquement, et l'app se rouvre toute seule ensuite :
- la **toute première fois**, Android demande d'autoriser Onyx à « installer des applis inconnues »
  puis de confirmer « Mettre à jour » (règle d'Android, impossible à éviter) ;
- ensuite, sur **Android 12 et plus**, les mises à jour s'installent **sans rien toucher** ; sur les versions
  plus anciennes, il faut juste confirmer « Mettre à jour ».

Deux réglages à faire **une seule fois** sur GitHub pour que ça marche :

1. **Clé de signature** : *Settings › Secrets and variables › Actions › New repository secret*, créer
   `ONYX_KEYSTORE_PASSWORD` et `ONYX_KEYSTORE_BASE64` (valeurs fournies à part, à garder privées).
   Sans elles, chaque version est signée avec une clé différente et Android refuse la mise à jour.
2. **Visibilité** : *Settings › General › Danger Zone › Change visibility › Public*. Une TV ne peut pas
   lire les *Releases* d'un dépôt privé. (Le dépôt ne contient aucun mot de passe.)

Après ces deux réglages, réinstalle une dernière fois les APK à la main : toutes les versions
suivantes arriveront toutes seules.

## 5. Version Windows (tester sur PC)

Télécharge `Onyx-Setup.exe` (ou `Onyx-Portable.exe`) depuis *Releases*.
Clavier : flèches = télécommande, Entrée = OK, Échap / Retour arrière = retour, F11 = plein écran.
La souris marche aussi. Le téléphone peut contrôler le PC avec le QR code de *Connexions*.

---

## Pour les développeurs

```
web/        interface TV (HTML/CSS/JS sans compilation) + interface téléphone (web/remote)
android/    projet Gradle : tv (WebView + ExoPlayer + serveur local), remote (scanner QR), core (mises à jour)
desktop/    Electron (Windows) + serveur local (même API que la TV)
```

- Tester l'interface : ouvrir `web/index.html` dans Chrome (taille 1280×720 ou plus).
- PC : `cd desktop && npm install && npm start`
- APK : `cd android && ./gradlew assembleRelease` (SDK Android requis)
- API de la TV (port 8765) : `GET /api/ping`, `GET /api/state`, `POST /api/cmd` (en-tête `X-Onyx-Token`).
- Signature des APK : la clé n'est **pas** dans le dépôt. La CI la lit dans deux secrets GitHub
  (*Settings › Secrets and variables › Actions*) : `ONYX_KEYSTORE_BASE64` (fichier .jks encodé en base64)
  et `ONYX_KEYSTORE_PASSWORD`. Toujours garder la même clé : sinon Android refuse d'installer une
  mise à jour par-dessus l'ancienne version. Sans ces secrets, les APK sont signés avec une clé temporaire.
  En local : variables d'environnement `ONYX_KEYSTORE_FILE` et `ONYX_KEYSTORE_PASSWORD`.
