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

Bouton **Ma collection** sur l'accueil. Les cartes possédées sont retirées de la recherche (« déjà possédée », aucune offre lue) et du panier ; l'option se coupe dans la liste. Sauvegarde sur l'appareil (`deckdeal:coll:v1`) et, connecté, dans Firestore (`users/<uid>/meta/collection`), **synchronisée en direct entre tes appareils** (voir « Plusieurs téléphones » ci-dessous). Les infos des cartes (coût, type, couleurs, image, prix de réf.) viennent de Scryfall, gardées sur l'appareil.

- **Importer** : fichier CSV (ManaBox, Moxfield, Archidekt, Deckbox, Dragon Shield… colonnes Name/Quantity reconnues, séparateur `,` `;` ou tabulation) ou liste texte « 3 Sol Ring ». Les quantités d'une même carte (éditions différentes) s'additionnent. Mode « Ajouter » ou « Remplacer ma collection ». Pour ~2000 cartes, le plus simple reste l'export CSV de ton appli actuelle (ManaBox exporte en un geste).
- **Ajouter à la main** : saisie assistée sur les noms Scryfall (35 000 noms, nom anglais ou français déjà connu de Scryfall).
- **Scanner** (voir plus bas), **Stats** (nombre de cartes, valeur, répartition couleur / famille / coût, plus chères ; **la valeur est par défaut la tendance Cardmarket (CM) ; un appui sur la tuile bascule sur CT** = prix réels CardTrader, estimation Cardmarket pour les cartes sans prix réel ; la valeur de l'autre source est affichée en regard, le choix est retenu sur l'appareil ; « **Les plus chères** » classées **par lot** (prix × exemplaires, quantité affichée) ou **par carte**, 10 à la fois puis « Afficher 10 de plus » jusqu'au bout), **recherche + filtres** couleur / famille / coût converti (aussi dans le viewer d'un deck).
- **Langue par carte** : une langue par carte (`fr en de es it pt jp`), posée par le scan (la dernière carte lue l'emporte) ou par la colonne « Language » d'un CSV, modifiable d'un appui sur la puce drapeau de la ligne (choix natif, « Non précisée » possible). Elle est gardée dans le texte de la collection (`3 Sol Ring *FR*`, donc aussi dans le compte). La carte s'affiche avec l'**image Scryfall de sa langue** (recherche par lots de 12 noms `(!"A" or !"B") lang:fr`, gardée sur l'appareil ; si Scryfall n'a pas cette langue : image anglaise, retenue).
- **Filtre « Commander »** (Cartes › Filtres) : **Peuvent l'être** (légendaire créature, Véhicule/Vaisseau légendaire avec F/E, texte « can be your commander », légale en Commander ; calculé par `canBeCommander` à la lecture Scryfall, avec repli sur la ligne de type pour les cartes lues avant, relues une fois en arrière-plan) et **Joués en commandant** (la carte est un commandant dans le fichier EDHREC ci-dessous ; pastille « Commander · 12 345 decks », tri « Decks EDHREC » activé tout seul).
- **Onglet Decks** (Ma collection › Cartes · Stats · **Decks**) : le deck moyen EDHREC des commandants les plus joués, comparé à ta collection : « 62 / 99 possédées · **37 à acheter** · ≈ 84 € », classé par moins de cartes manquantes (ou moins cher, ou populaires), couleurs permises (identité du commandant incluse dans ton choix), budget maximum, « J'ai le commandant ». Terrains de base ignorés ; prix = tendance Cardmarket **à la date du fichier** (affichée) ; cartes sans prix signalées. Un appui ouvre la feuille du deck (cartes à acheter, la plus chère d'abord ; déjà possédées) ; **« Chercher les manquantes »** charge le deck dans la page de saisie (commandant en tête) avec « Déduire ma collection » activé : la recherche CardTrader ne porte que sur les manquantes.
  - Données : **`/edh.tsv`** (une requête, gardé sur l'appareil 6 jours, copie ancienne utilisée si le site ne répond pas), tout le calcul est local et hors ligne. Format : `C` commandant (slug, decks EDHREC, identité, noms), `I` image, `D` deck (source `edhrec` ou `archidekt`, libellé, lien), `K` carte, `P` prix en centimes, `G` carte de la liste Game Changers (voir `parseEdh` dans `core.js`).
  - Généré par `gen-edhrec.mjs`, workflow **GitHub Actions** `.github/workflows/edhrec.yml` (chaque lundi, ou Actions › « Commandants EDHREC » › Run workflow avec `top` / `arch`) : liste EDHREC des commandants (période + pages suivantes, sinon couleur par couleur, sinon classement Scryfall `order:edhrec`), deck moyen de chacun (`average-decks/<slug>.json`), jusqu'à 3 decks réels Archidekt pour les 100 premiers (facultatif, abandonné proprement s'il échoue), prix Scryfall `eur` par lots de 75. ≈ 3 requêtes/s au plus, User-Agent qui s'annonce. **EDHREC n'a pas d'API publique** : on lit les JSON de son site, dont le format peut changer ; le générateur est tolérant, garde l'ancien fichier si le résultat est trop maigre et pousse son journal + des échantillons de réponses sur la branche `edh-debug`. Moxfield n'est pas interrogé (Cloudflare).
  - **Classement** : tri par défaut **Plus possédées** (le plus de cartes déjà à toi, à égalité le moins de cartes à acheter), puis **Moins cher** et **Meilleur tier**.
  - **Tier S / A / B / C / D** : badge sur chaque deck, d'après le **rang de popularité du commandant sur EDHREC** (nombre de decks) : S = les 30 premiers, A jusqu'au 150ᵉ, B 500ᵉ, C 1 500ᵉ, D au-delà (`EDH_TIERS` dans `core.js`). Ce n'est **pas** un classement de puissance. Boutons **S A B C D** pour filtrer (cumulables), rang « n° 12 » en pastille.
  - **Bracket estimé** (2 · 3 · 4) : nombre de **Game Changers** du deck (liste Scryfall `is:gamechanger`, lue par le générateur) : 0 → 2, 1 à 3 → 3, 4 et plus → 4. Estimation : terrains détruits, tours supplémentaires et combos ne sont pas lus (et le bracket 1 / 5 n'est pas deviné). Pastille « Game Changer » sur les cartes concernées de la feuille.
  - **Feuille d'un deck** : vignette de chaque carte (images lues sur Scryfall à l'ouverture, une seule fois par carte, gardées sur l'appareil ; ta collection fournit déjà les siennes), **appui = carte en grand** (même visionneuse que la collection : glisser ou flèches pour la carte suivante, 100 cartes de suite sans fermer), Échap garde la feuille ouverte.
- **Valeur dans le temps et alertes de prix** (`src/value.js`) : au plus une fois par 20 h (au lancement, au retour sur l'appli, à l'ouverture de la collection ; **pas en arrière-plan, appli fermée**), l'appli relit sur Scryfall le prix tendance Cardmarket (`eur`) de toutes les cartes (75 par requête, ~20 requêtes pour 1 500 cartes ; rien si la collection vient d'être lue en entier). Gardé **sur l'appareil seulement** (rien dans Firestore, donc pas de règles à republier, mais pas partagé entre téléphones) :
  - **un relevé de la valeur par jour** (`deckdeal:coll:hist` dans localStorage, 400 jours au plus, le dernier du jour remplace) → onglet Stats › **Valeur dans le temps** : courbe (axes = min / max réels), variation à **7 et 30 jours** (la valeur varie aussi quand tu ajoutes ou retires des cartes), bouton **Actualiser** (relit même s'il y a moins de 20 h) ;
  - **prix carte par carte de la semaine** (IndexedDB `coll:base`, période de 7 jours puis « précédente » : la comparaison porte sur 7 à 14 jours) → Stats › **Variations des prix** : cartes dont le prix a bougé d'au moins **10 / 25 / 50 %** (réglage mémorisé, 25 % par défaut) **et** de 0,20 € par exemplaire, classées par variation du lot, total « marché » hors cartes ajoutées depuis ;
  - **alerte** : bannière en haut de la collection (« 2 prix ont bougé de plus de 25 % · ▲ Sol Ring +50 % · … », **Voir** → Stats, **Ignorer** : écartée pour la journée, mémorisé), « N prix ont bougé » sous le bouton Ma collection de l'accueil, pastilles **▲ +50 % / ▼ −47 %** sur les lignes concernées de la liste. Pas de notification push : l'alerte se voit à l'ouverture de l'appli ;
  - la première semaine, pas de variation (une journée d'écart au moins), faute de point de comparaison ; premier relevé = lecture des cartes (rien de plus à faire).
- **Prix dans la liste « Cartes »** : à gauche de la quantité, **CM** (tendance Cardmarket, bleu) au-dessus et **CT** (offre CardTrader la moins chère, vert) en dessous, lisibles (14 px), plus rien de barré ; le tri par prix suit la source choisie dans Stats. « CM » = champ `eur` de Scryfall, le prix de l'impression par défaut de Scryfall (pas le minimum de toutes les impressions, contrairement à CT).
- **Prix réels** (bouton **€** de la collection) : pour chaque carte, l'offre CardTrader la moins chère aujourd'hui, avec le **même moteur et les mêmes critères que la recherche** (état minimum, foil, hors vacances / gradées / lots, vendeurs hub seulement en mode Zero, repli anglais coupé). Filtre de langue (effectifs affichés) : chaque carte est cherchée dans SA langue ; sans langue → celle de la recherche. « À actualiser » (jamais lue, plus de 2 jours, ou critères / langue changés) ou « Toutes » (relit sans le cache serveur de 10 min). Lecture par lots de 40 cartes, progression dans la collection et en pastille, bouton « Arrêter » (les prix déjà lus restent). Terrains de base ignorés. Le prix (tag vert `CT 7,50 €`, l'estimation Cardmarket est barrée) remplace l'estimation pour la **valeur**, le **tri par prix** et « **les plus chères** » ; « aucune offre » → l'estimation reste utilisée. Stockés sur l'appareil (`deckdeal:px:v1`), non synchronisés avec le compte.
- **Sauvegarde** : un bandeau dit l'état en toutes lettres (« Sauvegardée dans ton compte » · « Hors ligne : tes changements restent sur cet appareil… » · « Pas sauvegardée : seulement sur cet appareil » · erreur Firestore) ; **Exporter** télécharge la collection en texte réimportable.
- **Plusieurs téléphones, même compte** (ex. scan sur un vieux téléphone, le reste sur l'autre) : ajouts, retraits, quantités et langues passent d'un appareil à l'autre en quelques secondes, sans rien faire (toast « Autre appareil : +2 cartes »). Principe :
  - plus d'horloge ni de « le plus récent gagne » : chaque appareil retient `base` (dernier état du compte qu'il a vu, dans `deckdeal:coll:v1` champ `b`) et fusionne **carte par carte** (`merge3(base, appareil, compte)` dans `core.js`) ;
  - l'envoi est une **transaction Firestore** (lire le compte, fusionner, écrire ; rejouée si un autre appareil écrit entre-temps) : deux téléphones qui envoient en même temps ne s'écrasent pas ;
  - règles de fusion : une carte inchangée ici prend la valeur du compte ; changée seulement ici = gardée ; changée des deux côtés = écarts de quantité additionnés (+1 ici, +2 là-bas = +3), une modification l'emporte sur un retrait, langue d'ici si elle a changé ; même changement des deux côtés = pas de doublon ;
  - **hors ligne** : tout reste sur le téléphone (y compris après fermeture de l'app) et part au retour du réseau, fusionné ; retour au premier plan / réseau revenu = lecture immédiate du compte (les navigateurs mobiles endorment la connexion en arrière-plan) ;
  - protections : snapshot venant du cache du SDK ou arrivé en retard ignoré ; document du compte supprimé → reconstitué depuis les téléphones ; compte vidé d'un coup (≥ 10 cartes retirées, moitié ou plus) → toast **Annuler** qui rétablit tout ;
  - première connexion avec des cartes des deux côtés : union (plus grande quantité), toast « fusionnées ».
  - **Scan** : les cartes scannées n'entrent dans la collection (donc sur l'autre téléphone) qu'après **« Ajouter N cartes »**.
  - **Transition** : les deux téléphones doivent avoir chargé cette version (fermer / rouvrir l'app, 2 fois si c'est la PWA installée). Une ancienne version écrase tout le document du compte à chaque modification.

**Règles Firestore à republier** (contenu de `firestore.rules`) : documents `meta/collection` et champs `snap.pv`/`snap.pa`, historique 40 relevés max par deck. Sans cela l'écriture est refusée : la collection reste sur l'appareil et le bandeau de la collection l'indique (« Règles Firestore à publier »). Vérifier dans la console : Firestore › Données › `users/<uid>/meta/collection`.

## Scan des cartes (OCR)

Collection › icône appareil photo. Seul le **nom** de la carte est lu (bande du titre), jamais le reste : le texte est comparé au catalogue Scryfall et c'est la carte officielle qui est ajoutée, avec sa miniature Scryfall pour vérifier d'un coup d'œil.

- ≥ 84 % de ressemblance : ajoutée ; 72–84 % : « à vérifier » (miniature + bouton ✓, jamais ajoutée seule) ; en dessous : ligne « nom non reconnu » avec « Saisir ». Rien n'est enregistré avant « Ajouter » ; quantités et suppression corrigeables.
- **Aperçu sans calcul** : l'appareil photo n'affiche que l'image, aucun OCR ne tourne (le moteur ne démarre qu'au premier appui). Plus de gabarit de carte : une simple **bande** « Nom · mana » ; cadre le haut de la carte dedans (le mana est visible mais ignoré, seul le nom est lu) et appuie sur le **cercle** : la photo est prise, **lue en arrière-plan** pendant que l'aperçu continue ; tu enchaînes les cartes, une file d'attente (12 max) les lit une par une. Chaque capture apparaît tout de suite dans la liste (vignette + « Lecture… »), puis devient la carte reconnue. Un appui = un exemplaire.
- **Français d'abord** (plus de 90 % des cartes) : le texte lu est comparé **sur l'appareil** à deux catalogues, les noms **français imprimés** (≈ 31 000 cartes, voir ci-dessous) et les noms anglais ; la lecture la plus sûre gagne, **à égalité (nom identique en français et en anglais, ex. « Edgar Markov ») le français** ; un nom français partagé par deux cartes différentes (35 sur 31 000, ex. « Dépérissement ») n'est jamais « sûr » : « à vérifier » avec ta photo. Mesuré sur le vrai catalogue avec des fautes d'OCR simulées : bonne carte trouvée 99,9 % (texte exact), 99,0 % (2 fautes par nom), 97,5 % (3 fautes) ; fausse carte jugée « sûre » ≤ 0,13 %. Moteur OCR français d'abord, puis anglais seulement si rien de sûr ; polarité (texte clair/sombre) essayée aussi. Reconnaissance tolérante aux erreurs d'OCR : distance d'édition pondérée (confusions typiques `rn/m`, `l/I/1`, `0/O`, `q/g`… moins punies qu'une vraie différence), ligatures `œ`/`æ` dépliées, accents ignorés. Sans catalogue (pas encore téléchargé), repli sur la recherche Scryfall `lang:fr` mot par mot. **La langue de la carte lue est enregistrée** (`fr` ou `en`) : puce drapeau sur chaque ligne du scan (modifiable), miniature dans cette langue (image française lue dans le catalogue), puis `*FR*` dans la collection.
- **Catalogue des noms français** : Scryfall n'a pas de fichier « noms FR » (leurs exports font des Go). 1) L'app télécharge d'abord **`/fr-names.tsv`**, un fichier texte prêt à l'emploi servi par ton site (1 requête, ≈ 1,3 Mo compressé en gzip ; 2,8 Mo en texte, 30 953 cartes mesurées le 5 oct. 2026) ; **sans lui**, 2) elle pagine l'API Scryfall `lang:fr` (≈ 180 pages à 1,8 req/s, ≈ 15 à 20 Mo transférés (estimation), 3 à 5 min, reprise au point de sauvegarde toutes les 8 pages) ; en **réseau mobile ou économiseur de données** elle demande avant (≈ 15 à 20 Mo, bouton « Télécharger ») sauf si le fichier du site est là. Gardé sur l'appareil (IndexedDB, ≈ 2,8 Mo de texte), relu en local aux scans suivants ; rafraîchi tous les 14 jours (fichier du site, sinon seulement les nouveautés `date>=` ; un échec garde l'ancien). Le fichier est généré par `gen-fr-names.mjs` : workflow **GitHub Actions** `.github/workflows/fr-names.yml` (chaque lundi, ou onglet Actions › « Catalogue des noms français » › Run workflow ; commit `pwa/fr-names.tsv` seulement s'il change), ou à la main : `node gen-fr-names.mjs` puis commit. Si le fichier manque, rien ne casse : repli Scryfall.
- **Carte « à vérifier »** : ta **photo** (en bonne qualité, bande du nom) s'affiche juste au-dessus de la carte proposée pour comparer ; toucher la miniature d'une carte scannée l'ouvre **en grand** (avec la photo prise pour les cartes à vérifier), on passe d'une carte à l'autre.
- **Barres de l'écran de scan** : « Annuler / Ajouter N cartes » juste sous l'image de la caméra ; bouton rond de capture + « Photos » / « Appareil » tout en bas, sous la liste.
- **Vitesse** : à l'ouverture du scan, pendant que tu cadres, le catalogue des noms (anglais + français) et le moteur OCR français sont préparés (l'anglais ne se charge que si le français ne trouve rien) ; le premier appui n'attend plus leur démarrage (≈ 1,2 s sur l'ordinateur de test, plus sur téléphone avec téléchargement). Une lecture nette prend ≈ 0,15–0,5 s ; avec le catalogue français local, aucune requête réseau pendant la lecture. Ce temps préparatoire compte comme « occupé » pour la surveillance de l'aperçu.
- **Confidentialité / mémoire** : les photos ne sont jamais enregistrées (ni disque, ni cache, ni IndexedDB). Elles restent en mémoire le temps de la lecture, puis le canvas est vidé ; il ne reste qu'une vignette de ~4 Ko pour reconnaître une carte non lue.
- **Aide** : le texte d'aide de l'écran de scan se ferme (×) ; le choix est retenu d'un scan à l'autre et le bouton « ? » de l'en-tête la rouvre.
- **« Photos »** (galerie, plusieurs fichiers) et **« Appareil »** (ouvre l'appareil photo du téléphone) passent par la même file : une carte par photo. Utile si l'aperçu du navigateur saccade sur ton téléphone. Photo de la **carte entière en portrait** : seul le **tiers haut** de l'image est lu (nom et mana ; d'abord la bande du titre, puis tout le tiers haut), le reste n'est jamais lu. La photo tournée par l'appareil (EXIF) est redressée automatiquement ; la vignette gardée pour une carte non lue ne montre que ce tiers haut.
- **Aperçu lent** : l'image de la caméra est mesurée (images/s). La caméra est ouverte avec un **plancher de 24 i/s** (en lumière faible, l'exposition automatique ralentit sinon l'aperçu ; repli sur une simple préférence si l'appareil refuse). Sous 10 i/s pendant 3 s (hors lecture en cours et mise en route de la caméra), la caméra est **redémarrée** (arrêt complet puis réouverture) : 2 fois à l'identique, puis 2 fois en 720p (retenu pour les scans suivants) ; si ça rame encore, « Appareil » est mis en avant. Le compteur repart à zéro après 20 s d'aperçu fluide. Diagnostic : 5 appuis sur le titre (images/s, résolution réelle, plancher actif, redémarrages, durée de lecture, tâches longues) ; toucher le cadre de diagnostic remet le mode normal.
- Le moteur OCR ne produit que le texte et est recréé toutes les 300 lectures (la mémoire WebAssembly ne fait que grossir).
- Tesseract.js (≈ 3 Mo de modèle par langue : français d'abord, anglais seulement si besoin) est chargé depuis le CDN jsDelivr au premier appui seulement ; la lecture se fait sur l'appareil, aucune image n'est envoyée. Il faut https pour la caméra (« Photos » et « Appareil » marchent partout).

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
