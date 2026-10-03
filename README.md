# Deck Deal

Page (`deck-deal.html`) + proxy CardTrader (`proxy.mjs`, zéro dépendance, Node ≥ 18) lancé via `start.cjs`.

## Variables d'environnement (jamais dans le dépôt)

| Variable | Rôle |
|---|---|
| `CARDTRADER_TOKEN` | Token API CardTrader (reste côté serveur) |
| `APP_KEY` | Clé d'accès, obligatoire dès que `HOST` n'est pas local. À saisir dans Réglages › Clé du proxy |
| `HOST` | `0.0.0.0` en hébergement |
| `PORT` | Fourni par l'hébergeur (défaut 8787) |

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
- `APP_KEY` : 16 caractères ou plus recommandés (avertissement au démarrage sinon).
- Scryfall : 2 requêtes/s max sur `/cards/search`, pause automatique sur 429, résultats en cache 7 jours.
