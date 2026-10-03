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

## Installation (PWA)

`pwa/` contient le manifeste, le service worker et les icônes, servis par `proxy.mjs` en liste blanche (aucun autre fichier du dépôt n'est exposé).
Le dossier doit être déployé avec `proxy.mjs`.

- Chrome / Edge / Android : bannière « Installer Deck Deal » sur l'accueil, ou Réglages › Application, ou icône d'installation de la barre d'adresse. Fenêtre dédiée, icône, lancement direct.
- iPhone / iPad : Apple n'autorise que Safari › Partager › « Sur l'écran d'accueil ».
- Hors ligne : l'interface s'ouvre (mode démo utilisable) ; la recherche live a besoin du réseau. `/api/*` n'est jamais mis en cache.
- Le service worker (`pwa/sw.js`) charge la page en réseau d'abord : un nouveau déploiement est pris au rechargement suivant.
