# Deck Deal

Page (`deck-deal.html`) + proxy CardTrader (`proxy.mjs`, zéro dépendance, Node ≥ 18) lancé via `start.cjs`.

## Variables d'environnement (jamais dans le dépôt)

| Variable | Rôle |
|---|---|
| `CARDTRADER_TOKEN` | Token API CardTrader (reste côté serveur) |
| `ALLOWED_UIDS` | Identifiants Firebase autorisés (séparés par des virgules). Recommandé : c'est l'accès par compte |
| `ALLOWED_EMAILS` | Alternative à `ALLOWED_UIDS` : e-mails vérifiés autorisés. Moins sûr (un UID ne change jamais) |
| `FIREBASE_PROJECT_ID` | Projet Firebase des comptes (défaut `m2s-mtg`) |
| `APP_KEY` | Ancienne clé d'accès, facultative : sert de repli tant qu'elle est définie. À supprimer une fois la connexion par compte validée |
| `HOST` | `0.0.0.0` en hébergement. Refusé si ni `APP_KEY` ni `ALLOWED_UIDS`/`ALLOWED_EMAILS` n'est défini |
| `PORT` | Fourni par l'hébergeur (défaut 8787) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Facultatif : notifications « recherche terminée » (voir plus bas, `node gen-vapid.mjs`) |
| `FIREBASE_JWKS_URL` | Tests seulement : URL des clés publiques Google |

### Accès par compte Firebase (remplace `APP_KEY`)

Le navigateur envoie son jeton Firebase (`X-Firebase-Token`) ; le proxy vérifie la signature (clés publiques Google), l'audience, l'émetteur et l'expiration, puis compare l'UID à `ALLOWED_UIDS`.

1. Déployer, ouvrir le site, se connecter (icône compte).
2. Compte › « Accès au serveur » › copier ton identifiant (UID).
3. Hostinger › variables d'environnement › `ALLOWED_UIDS=<ton uid>` › redéployer.
4. Vérifier que la recherche marche une fois connecté, puis supprimer `APP_KEY` et redéployer.

Sans jeton valide : 401 (`auth_required`, `bad_token`, `token_expired`) ; compte non autorisé : 403 (`forbidden`).

## Lancer en local

    CARDTRADER_TOKEN=xxx node proxy.mjs   # http://localhost:8787

## Hostinger (Business / Cloud)

Node.js Web App › Import Git repository › framework « Other » › entry file `start.cjs`.
Ajouter le domaine dans Firebase › Authentication › Paramètres › Domaines autorisés.

## Garde-fous (optionnels)

| Variable | Défaut | Rôle |
|---|---|---|
| `CACHE_MAX_MB` | 48 | Plafond mémoire du cache des catalogues |
| `UP_CONC` | 6 | Requêtes simultanées max vers CardTrader |

- Clé invalide : délai de 400 ms, puis blocage 5 min de l'IP après 15 essais (nécessite `X-Forwarded-For`).
- `APP_KEY` (si conservée) : 16 caractères ou plus recommandés (avertissement au démarrage sinon).
- Scryfall : 2 requêtes/s max ; les cartes sont cherchées par lots de 12 noms (une recherche `(!"A" or !"B" …)` au lieu d'une par carte, soit ~10 requêtes pour un deck de 100 cartes), repli carte par carte pour les noms approximatifs ; pause automatique sur 429 ; résultats en cache 7 jours.

## Lecture des offres en tâche de fond

CardTrader limite `marketplace/products` à 10 requêtes/s (1 blueprint par requête) : ~9 req/s est le plafond, une recherche de 700 offres prend donc ~80 s la première fois. Le serveur fait la boucle à la place de l'appareil (`POST /api/jobs`, suivi par `GET /api/jobs/<id>?from=n`, annulation `DELETE`) :

- la lecture continue si l'app passe en arrière-plan ou se ferme ; relancer la même recherche se rattache à la tâche en cours ou terminée (aucune requête CardTrader en plus) ;
- cache serveur des offres : 10 min pour les offres, 3 h pour « aucune offre » ; l'alerte « Prix lus il y a N min » propose « Actualiser les prix » (relit tout) quand les données ont plus d'1 min 30 ;
- une seule cadence vers CardTrader (tâches + relais direct) ; 429 → pause puis cadence réduite ; jeton CardTrader refusé → échec signalé ;
- « Arrêter » annule la tâche côté serveur ; fermer la page ne l'annule pas ;
- serveur sans tâches (`JOBS=0`, ancienne version) ou tâches refusées : l'appareil lit lui-même les offres, comme avant.

| Variable | Défaut | Rôle |
|---|---|---|
| `JOBS` | 1 | `0` désactive les tâches de fond (repli : lecture depuis l'appareil) |
| `JOB_RATE` | 9 | Requêtes/s vers CardTrader (plafonné à 9,6) |
| `OFFER_TTL_MS` | 600000 | Durée de vie du cache des offres |
| `OFFER_TTL_EMPTY_MS` | 10800000 | Durée de vie du cache des blueprints sans offre |
| `OFFERS_CACHE_MB` | 40 | Plafond mémoire du cache des offres |
| `JOB_KEEP_MS` | 900000 | Conservation des tâches terminées |

Limite à connaître : le cache et les tâches vivent en mémoire du processus. Si l'hébergeur le redémarre ou le met en veille pendant une lecture, l'app relance la tâche pour ce qui manque (le cache est alors perdu).

## Deck viewer et prix gardés

Chaque recherche live d'un deck enregistré garde les prix carte par carte (carte retenue, langue, état, vendeur, extension, coût de mana, type, image) : sur l'appareil (`deckdeal:snaps:v1`, 30 decks max) et, si les règles Firestore le permettent, dans le document du deck (champ `snap`, synchronisé entre appareils).

- Liste « Mes decks » › **Voir** : viewer plein écran du deck, sans nouvelle recherche. Aussi dans les résultats : bouton **Viewer** (recherche en cours).
- Tri **Mana** (colonnes par coût, terrains à part, courbe de mana cliquable), **Prix** (du plus cher au moins cher) ou **Type** ; le choix est mémorisé.
- Toucher une carte l'ouvre en grand (langue de l'offre) ; précédent / suivant par boutons, flèches du clavier ou glissement ; prix, état et vendeur sous l'image.
- **Commandant** mis en avant en tête ; **Réf. Cardmarket** par carte (prix de référence Scryfall, écart en % : bon prix / correct / cher) ; recherche + filtres couleur, famille, coût.
- **Historique** de prix par deck (40 relevés max, comparés à conditions égales : mode, langue, état, foil, cartes trouvées, nombre de cartes possédées) : courbe, écart du total et écart par carte.
- Âge des prix affiché (« Prix du 4 oct. · il y a 3 jours »), en orange après 24 h ; **Actualiser** relit tout (cache serveur ignoré) puis propose de revenir au viewer.

**Règles Firestore à republier** (Firebase › Firestore › Règles, contenu de `firestore.rules`) pour synchroniser les prix entre appareils : le champ `snap` a été ajouté à la liste autorisée. Tant que ce n'est pas fait, l'app renvoie le deck sans `snap` (aucune erreur visible) et garde les prix sur l'appareil seulement.

## Carte en grand

Toucher l'image d'une carte l'affiche en grand (précédent / suivant dans l'ordre de la liste), dans la langue de l'offre retenue (Scryfall `/cards/<ext>/<n°>/<langue>`) ; si Scryfall n'a pas la version française, l'anglaise est affichée avec une mention. Cartes double face : bouton « Retourner ».

## Ma collection (cartes possédées)

Bouton **Ma collection** sur l'accueil. Les cartes possédées sont retirées de la recherche (« déjà possédée », aucune offre lue) et du panier ; l'option se coupe dans la liste. Sauvegarde sur l'appareil (`deckdeal:coll:v1`) et, connecté, dans Firestore (`users/<uid>/meta/collection`, le plus récent gagne ; première connexion : union des deux). Les infos des cartes (coût, type, couleurs, image, prix de réf.) viennent de Scryfall, gardées sur l'appareil.

- **Importer** : fichier CSV (ManaBox, Moxfield, Archidekt, Deckbox, Dragon Shield… colonnes Name/Quantity reconnues, séparateur `,` `;` ou tabulation) ou liste texte « 3 Sol Ring ». Les quantités d'une même carte (éditions différentes) s'additionnent. Mode « Ajouter » ou « Remplacer ma collection ». Pour ~2000 cartes, le plus simple reste l'export CSV de ton appli actuelle (ManaBox exporte en un geste).
- **Ajouter à la main** : saisie assistée sur les noms Scryfall (35 000 noms, nom anglais ou français déjà connu de Scryfall).
- **Scanner** (voir plus bas), **Stats** (nombre de cartes, valeur de réf. Cardmarket, répartition couleur / famille / coût, plus chères), **recherche + filtres** couleur / famille / coût converti (aussi dans le viewer d'un deck).

**Règles Firestore à republier** (contenu de `firestore.rules`) : documents `meta/collection` et champs `snap.pv`/`snap.pa`, historique 40 relevés max par deck. Sans cela la collection reste sur l'appareil, sans erreur visible.

## Scan des cartes (OCR)

Collection › icône appareil photo. Seul le **nom** de la carte est lu (bande du titre), jamais le reste : le texte est comparé au catalogue Scryfall et c'est la carte officielle qui est ajoutée, avec sa miniature Scryfall pour vérifier d'un coup d'œil.

- ≥ 84 % de ressemblance : ajoutée ; 72–84 % : « à vérifier » (miniature + bouton ✓, jamais ajoutée seule) ; en dessous : ligne « nom non reconnu » avec « Saisir ». Rien n'est enregistré avant « Ajouter » ; quantités et suppression corrigeables.
- **1 carte à la fois** (le plus fiable) : cadre de la taille d'une carte, nom dans la bande ; en mode Auto, une carte tenue devant l'objectif n'est comptée qu'une fois.
- **Plusieurs côte à côte** : le cadre prend toute la largeur ; pose tes cartes en ligne, alignées par le haut (3 ou 4 tiennent bien), et tous les noms de la bande sont lus d'un coup. Chaque carte est ajoutée à sa première lecture sûre et ne recompte pas tant qu'elle reste dans le cadre ; retire-la du cadre puis repose-la pour en ajouter un exemplaire de plus (ou corrige la quantité dans la liste). **1 ligne / 2 lignes** (caméra) : avec « 2 lignes », une bande de noms est lue en haut de chaque moitié du cadre ; pose la 2e ligne dans la moitié basse, noms en haut. Une lecture douteuse n'apparaît « à vérifier » qu'après deux lectures concordantes. Marche en anglais **et en français** (voir ci-dessous).
- **Photos** (importer des photos prises avant) : « 1 carte à la fois » ou « Plusieurs côte à côte » (lecture par bandes sur toute l'image : autant de lignes et de colonnes que tu veux, chaque carte comptée une fois).
- **Français** (« Cartes en français ») : le nom imprimé est cherché chez Scryfall (`lang:fr`) puis converti en nom anglais. Compatible avec « Plusieurs côte à côte » : la bande est lue en une passe (segmentation auto de Tesseract), les mots sont regroupés par carte d'après leur position, et chaque groupe est cherché chez Scryfall (résultats mis en cache, nombre de recherches plafonné par lecture : un peu plus lent qu'en anglais).
- Tesseract.js (≈ 3 Mo de modèle) est chargé depuis le CDN jsDelivr au premier scan seulement ; la lecture se fait sur l'appareil, aucune image n'est envoyée. Il faut https pour la caméra (la page « Photos » marche partout).

## Notifications « recherche terminée »

Notification push (Web Push chiffré, VAPID, sans dépendance) quand la lecture des offres se termine alors que l'app n'est plus ouverte ; un toucher rouvre Deck Deal et reprend la recherche. Le serveur garde l'abonnement le temps de la recherche seulement, rien n'est stocké.

1. `node gen-vapid.mjs https://card.m2s-photo.fr` (affiche 3 lignes).
2. Hostinger › variables d'environnement : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` › redéployer. La clé privée ne va jamais dans GitHub.
3. Dans l'app : Réglages › Notifications › « Prévenir quand la recherche est finie ».

Android (Chrome, Edge, Firefox) : direct. iPhone / iPad : seulement si Deck Deal est installée sur l'écran d'accueil (iOS 16.4 ou plus). Si tu changes les clés, les abonnements existants s'arrêtent : on réactive l'option. `PUSH_GRACE_MS` (défaut 4000) : délai avant d'envoyer, pour ne pas notifier si l'app est encore là.

## Partage vers l'app et import de liens

Une fois l'app installée, elle apparaît dans le menu Partager d'Android : partager une liste de cartes (texte) ou un lien EDHREC (decks moyens), Archidekt ou Moxfield remplit la liste. Les liens passent par `GET /api/import?url=…` sur le serveur (lecture seule, liste blanche de sites, 2 Mo max, protégé comme le reste de l'API). EDHREC est fiable ; Archidekt et Moxfield dépendent de leurs API publiques (Moxfield peut refuser les serveurs : coller la liste en texte reste possible).

## Installation (PWA)

`pwa/` contient le manifeste, le service worker et les icônes, servis par `proxy.mjs` en liste blanche (aucun autre fichier du dépôt n'est exposé).
Le dossier doit être déployé avec `proxy.mjs`.

- Chrome / Edge / Android : bannière « Installer Deck Deal » sur l'accueil, ou Réglages › Application, ou icône d'installation de la barre d'adresse. Fenêtre dédiée, icône, lancement direct.
- iPhone / iPad : Apple n'autorise que Safari › Partager › « Sur l'écran d'accueil ».
- Hors ligne : l'interface s'ouvre (mode démo utilisable) ; la recherche live a besoin du réseau. `/api/*` n'est jamais mis en cache.
- Le service worker (`pwa/sw.js`) charge la page en réseau d'abord : un nouveau déploiement est pris au rechargement suivant.
- Images de cartes (`cards.scryfall.io`) : gardées par le service worker (1200 max, les plus anciennes sortent d'abord), donc plus de re-téléchargement et affichables hors ligne. Ce cache est dans le stockage du site : « effacer les données du site » le vide, il se remplit de nouveau tout seul. L'app demande le stockage persistant pour que le navigateur ne le purge pas.
- Notifications push et menu Partager : voir plus haut.
