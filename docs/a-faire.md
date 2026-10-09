# À faire

## Pour reprendre (nouvelle session)
- Lire d'abord ce fichier et `docs/passation.md` (état au 9 octobre, actions du propriétaire en attente), puis `README.md` (fonctionnement), `DEV.md` (build, tests, CI), `docs/android.md` (APK, widget, natif) et `docs/store/` (fiche Play Store, test fermé).
- Branche de travail, puis `main` (Hostinger déploie `main`). `node build.mjs` après chaque changement de `src/` ; `deck-deal.html` est committé.
- Tests : `bash tests/run-tests.sh` (tous, ~30 min) ou une sélection ; la CI GitHub (`tests.yml`, `rules.yml`) les relance à chaque push.
- Jamais dans le dépôt : `google-services.json`, la clé FCM, les variables Hostinger (voir `README.md`).
- Code natif (Java, XML Android) modifié → le propriétaire refait l'APK (`android-app` : `npm run setup` puis `npm run apk`). Le reste (site) arrive dans l'APK sans la refaire.

## Prochaines améliorations (prévues)
- **Deuxième widget Android « QR code d'échange » : fait le 9 octobre, à tester sur le téléphone (nouvelle APK).** `TradeWidget.java`, `res/layout/widget_trade.xml`, `res/xml/widget_trade_info.xml` ; le site envoie la matrice du QR (`src/widget.js`, `setTradeWidget`). Détail dans `docs/android.md` (« Widget « QR code d'échange » »).
  - À vérifier sur le téléphone : aperçu dans la liste des widgets, code net en 2 × 2 et agrandi, scan par un autre téléphone, pseudo dessous, « Crée ton lien d'échange » après « Arrêter le partage », mise à jour après « Nouveau lien », toucher → onglet Échange.
- **Bannière de pub : trouver l'emplacement qui gêne le moins.** Aujourd'hui : bandeau AdMob en haut (`TOP_CENTER`), 16 px d'écart sous lui (`src/ads.js`, `src/css/ads.css`).
  - Pistes à comparer (captures à 360 et 390 px) : en bas au-dessus de la barre d'action, seulement sur certains écrans (accueil, collection) et jamais pendant un scan ou une recherche, bannière « adaptative ancrée », bannière repliable.
  - Règles AdMob : pas collée aux boutons de navigation, jamais par-dessus le contenu, pas de clic accidentel ; mesurer la gêne sur les écrans les plus utilisés (scan, résultats, collection).
- **Proposition d'échange équilibrée** (plus tard) : cocher des cartes des deux côtés, balance de valeur, récapitulatif à partager.
- **Outils de partie** (plus tard, rien dans le code) : pas de compteur de vies dans Mana Orbit ; éventuellement un lien vers l'appli du propriétaire sur Google Play.
- **Langues, suites** : interface en fr, en, de, es, it, pt depuis le 9 octobre. Restent en français / anglais seulement : `pwa/manifest.webmanifest`, `pwa/privacy.html`, `<html lang>` et la description de `build.mjs`, la fiche Play Store (`docs/store/`), le texte d'aide « Nom français ou anglais » de la recherche de la liste publique. Poids : chaque langue ajoute ≈ 57 Ko compressés à la page (≈ 630 Ko en tout) : charger les dictionnaires à la demande si ça devient gênant. Japonais et chinois : clé de nom Unicode et modèles OCR à faire avant.
- Fait et validé par le propriétaire : système d'échange (« Pour toi », QR, valeurs), widget de valeur (4 tailles, courbe 4×2, bouton Scanner / Prix rapide).

## Si EDHREC ou Archidekt refusent (plan B, à préparer avant la production)
- **Interrupteur côté serveur** : une variable Hostinger (ex. `EDHREC_OFF=1`, `ARCHIDEKT_OFF=1`) annoncée par `/__ping`, et l'appli cache la fonction concernée, sans nouvelle APK.
- **Sources sans autorisation à demander**, pour garder « quels decks je peux monter, combien pour finir » :
  - decks préconstruits officiels (MTGJSON, licence MIT : toutes les listes Commander de Wizards) ;
  - decks générés par Mana Orbit depuis Scryfall (commandants populaires, cartes les plus jouées dans leurs couleurs, quotas terrains / mana / pioche / retraits) ;
  - cEDH : EDHTop16 / TopDeck.gg (API publique, crédit déjà affiché) ;
  - à terme : deck moyen « Mana Orbit » à partir des decks des utilisateurs, anonymisés (ligne à ajouter à la politique de confidentialité).

## Avant la publication sur le Play Store
- **Nom de domaine à soi** (avant la publication : liens d'échange et QR partagés le contiennent) : aujourd'hui `card.m2s-photo.fr`.
  - Choisir et réserver (pistes : `manaorbit.app`, `manaorbit.fr`, `mana-orbit.com`) ; vérifier que « Mana Orbit » n'est pas déjà déposé (INPI / EUIPO) ni pris sur le Play Store.
  - Hostinger : domaine pointé sur l'hébergement, HTTPS ; e-mail pro (contact@…) pour la fiche Play.
  - Firebase : domaine ajouté aux domaines autorisés (Authentication) ; lien de retour de l'e-mail de vérification.
  - APK : `server.url` / hôte dans `android-app` (`capacitor.config`) → nouvelle APK ; liens d'app éventuels.
  - Code : adresses en dur (`card.m2s-photo.fr`) dans `src/`, `proxy.mjs`, `pwa/` (manifest, privacy, sw), docs et fiche Play ; `shareUrl` des liens partagés.
  - QR code d'exemple de l'aperçu du widget d'échange (`res/drawable/widget_trade_preview_qr.xml`, l'adresse du site) : à régénérer avec `src/qr.js` ; `PRICES_URL` de `ValueRefreshJob.java`.
  - Ancien domaine : redirection 301 de `card.m2s-photo.fr` vers le nouveau en gardant le chemin et `?p=` (les liens et QR déjà partagés continuent de marcher).
  - `app-ads.txt` à la racine du nouveau domaine (AdMob refuse souvent les sous-domaines) ; politique de confidentialité et site web de la fiche Play sur le nouveau domaine.
  - Après la bascule : tests, CI, et un lien d'échange ouvert depuis l'ancien domaine pour vérifier la redirection.
- **EDHREC et Archidekt** : réponses aux deux mails toujours en attente (`docs/mails-partenaires.md`).
  - Lancer le test fermé sans attendre (pas public, accord non nécessaire) ; envoyer la relance avec une échéance claire.
  - Sans réponse à la mise en production : publier avec crédit et lien (déjà là), lecture hebdomadaire par le serveur seulement, et l'interrupteur ci-dessus prêt. En cas de refus : basculer sur le plan B.
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
- **Deux décisions** : (1) la collection Firestore `games` de l'autre appli du propriétaire est lisible par tout compte Mana Orbit connecté (`firestore.rules`) : la garder ou la fermer ; (2) les titres des decks Archidekt sont affichés tels quels dans la feuille d'un deck EDHREC : les masquer ou non (modération).
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
