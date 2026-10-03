# Deck Deal

Page (`deck-deal.html`) + proxy CardTrader (`proxy.mjs`, zéro dépendance, Node ≥ 18).

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

Node.js Web App › Import Git repository › framework « Other » › entry file `proxy.mjs`.
Ajouter le domaine dans Firebase › Authentication › Paramètres › Domaines autorisés.
