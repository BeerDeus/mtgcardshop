# À faire

## Prochaines améliorations (prévues)
- **Système d'échanges** (liste d'échange, lien public) : à retravailler. Attentes à préciser.
- **Widget Android** (valeur de la collection : `ValueWidget`, `ManaOrbitPlugin.setWidget`, `src/widget.js`) : à améliorer. Attentes à préciser.
- **Proposition d'échange équilibrée** (plus tard) : cocher des cartes des deux côtés, balance de valeur, récapitulatif à partager.
- **Outils de partie** (plus tard, rien dans le code) : pas de compteur de vies dans Mana Orbit ; éventuellement un lien vers l'appli du propriétaire sur Google Play.

## Avant la publication sur le Play Store
- Attendre les réponses d'EDHREC et d'Archidekt (`docs/mails-partenaires.md`).
- AdMob : remplacer les identifiants de test par les vrais.
  - `admob_app_id` dans `android-app/android/app/src/main/res/values/strings.xml`.
  - `ADMOB_BANNER_ID` sur Hostinger.
- Créer la clé de signature release (`.jks`, à garder précieusement).
- Après le premier `.aab`, ajouter dans Firebase le SHA-1 de la clé de signature Play (`docs/android.md`).
- Vérifier auprès de l'URSSAF (ou d'un comptable) si l'édition d'une appli financée par la publicité doit être ajoutée aux activités de Martin Stuis EI.
- Compte développeur personnel récent : test fermé obligatoire (12 testeurs pendant 14 jours) avant la production.
- Play Console : remplir la fiche et le formulaire Sécurité des données d'après `docs/store/fiche.md`.
- **Test fermé** : étapes, groupe Google et textes dans `docs/store/test-ferme.md`. Envoyer d'abord la relance à EDHREC et Archidekt (`docs/mails-partenaires.md`).
- **AdMob pendant le test fermé** : `.aab` avec le vrai `admob_app_id`, mais `ADMOB_BANNER_ID` **vide** sur Hostinger jusqu'à la production (bandeau de test de Google, pas de trafic invalide).
  - Ne jamais toucher une vraie annonce ; appareils de test déclarés (`docs/android.md`).
  - Message de consentement Europe publié dans AdMob avant la production (`docs/android.md`, § 4).
- **app-ads.txt** : exigé par l'examen de l'appli dans AdMob (sans lui, annonces limitées).
  - À servir sur `https://card.m2s-photo.fr/app-ads.txt` (le site web de la fiche) : `proxy.mjs` n'a pas encore cette route (idée : variable `ADMOB_PUB_ID` → `google.com, pub-…, DIRECT, f08c47fec0942fa0`).
  - Si AdMob répond « sous-domaine non pris en charge » : le servir aussi sur `m2s-photo.fr/app-ads.txt`.
  - Relier l'appli AdMob à la fiche Play dès la production.
- **Contrôles de blocage AdMob** : bloquer les catégories sensibles (jeux d'argent, rencontres, argent facile…) : public de 13 ans et plus, et la Fan Content Policy interdit un sponsor nuisible à Wizards. `maxAdContentRating` est déjà à « accord parental » (`src/ads.js`).
- **Statut de professionnel (DSA)** : une appli qui rapporte (pub, achats) se déclare en général « professionnel » dans la Play Console ; adresse, téléphone et e-mail s'affichent alors sur la fiche dans l'UE. Utiliser les coordonnées de Martin Stuis EI.
- **Import Moxfield (à décider)** : l'import par lien (`proxy.mjs`, `/api/import`) lit l'API non documentée `api2.moxfield.com` avec un `Referer` qui imite moxfield.com. Moxfield n'a pas d'API publique : ça ressemble à du contournement.
  - Soit retirer Moxfield de l'import par lien (la liste collée et le CSV marchent toujours) ;
  - soit demander une autorisation écrite à Moxfield.
- **EDHTop16 / TopDeck.gg** : `gen-edhrec.mjs` lit l'API GraphQL publique d'EDHTop16 (données TopDeck.gg). Crédit et lien déjà dans Mentions et sources ; leur envoyer un mot de courtoisie.
- **Interrupteur EDHREC / Archidekt** : si l'un refuse, pouvoir couper sa fonction depuis le serveur, sans nouvelle APK (rien de tel aujourd'hui).
- **Politique de confidentialité** : une phrase sur « Signaler ce partage » et ce qu'il advient d'un lien signalé (règle Google sur le contenu publié par les utilisateurs).

## Plus tard : achat « Soutenir » (phase 2, après 4 à 8 semaines d'usage réel)
- **Ce que permet Wizards** (Fan Content Policy) : pub et dons, oui ; rendre payant l'accès au contenu ou une fonction, non.
  - Un achat unique qui retire seulement le bandeau se lit comme un don : zone grise, mais faible risque s'il ne débloque rien, ne s'appelle ni « Pro » ni « Premium », et si la version web reste complète et gratuite.
  - Pas de badge payant en v1 (EDHREC et Archidekt ont lu « aucune fonction payante »).
- **Google Play** : retirer la pub est un bien numérique, donc **Google Play Billing obligatoire**.
  - Aucun lien de don externe (Ko-fi, Buy Me a Coffee, Open Collective…) dans l'APK ni sur la fiche : en 2026, Google a bloqué les mises à jour d'AnkiDroid pour un lien Open Collective.
  - Un lien Ko-fi est possible sur le web seulement, caché quand `isNativeApp()`.
- **Technique** : produit non consommable `supporter` (≈ 3,99 €), via `@capgo/native-purchases` (Billing 9) ou environ 120 lignes Java dans `ManaOrbitPlugin`.
  - Accuser réception sous 3 jours (sinon remboursé), gérer l'état « en attente », relire `getPurchases()` à chaque lancement (réinstallation, remboursement).
  - `src/ads.js` : ajouter `|| AD.paid` à la condition qui retire le bandeau. Point d'accroche prévu dans `src/help.js` (`SUPPORTER_SKU`).
- **Avant de l'activer** : profil de paiement Play Console (Martin Stuis EI), produit intégré, comptes de test de licence ; IARC « Achats de biens numériques » → Oui (`docs/store/fiche.md`) ; politique de confidentialité ; prévenir EDHREC et Archidekt (la relance l'annonce déjà).
