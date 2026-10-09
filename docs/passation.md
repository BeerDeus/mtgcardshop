# Passation — reprise dans un nouveau chat

**À lire en premier : `docs/a-faire.md`** (section « Pour reprendre », puis « Prochaines améliorations »). Ce fichier-ci résume où on en est au 9 octobre 2026 au soir (mis à jour en fin de soirée : widget QR d'échange, emplacement de la pub).

## Le projet
- **Mana Orbit** : appli Magic: The Gathering (collection, scan, prix Cardmarket/CardTrader, decks EDHREC/Archidekt, échanges, alertes).
- PWA en ligne : https://card.m2s-photo.fr (Hostinger déploie `main` ; serveur Node `proxy.mjs`).
- APK Android (Capacitor 8, `android-app/`) qui charge le site en ligne : un changement de `src/` arrive sur le téléphone sans refaire l'APK ; seul le natif (Java, XML Android) en demande une nouvelle.
- But : que l'appli **s'autofinance** (pub, plus tard achat « Soutenir »), pas faire du profit.

## Façon de travailler (préférences du propriétaire)
- Réponses en français, directes, en listes, sans préambule ; code d'abord.
- Le propriétaire teste sur son téléphone : pousser sur `main` une fois les tests passés (branche de travail puis `main`).
- Commits en français, terminés par les lignes d'attribution de la session. Aucun nom de modèle ailleurs.
- Pas de pull request sauf demande.
- Jamais dans le dépôt : `google-services.json`, clé du compte de service FCM, variables Hostinger. Ne jamais demander ni taper de mot de passe.
- Poser des questions si une décision lui revient (il aime choisir entre 2–3 versions pour le visuel).

## Technique : l'essentiel
- `node build.mjs` assemble `src/*.js` (liste fixe), `src/css/*.css`, `src/i18n/<langue>.json` dans `deck-deal.html` (committé). Toujours reconstruire après un changement de `src/`.
- Version affichée dans Réglages = empreinte du contenu de la page (ex. `b966ea3e`), **pas** le numéro de commit.
- Tests : `bash tests/run-tests.sh [fichiers]` (tous ≈ 30 min). CI : `tests.yml` (tout), `rules.yml` (règles Firestore, émulateur), `fr-names.yml` (catalogues des noms, hebdo), `prices.yml`, `edhrec.yml`.
- Interface en 6 langues (fr, en, de, es, it, pt) : toute chaîne visible ajoutée doit l'être dans **les six** `src/i18n/*.json` (`tests/test-i18n-langs.mjs` le vérifie).
- Pièges déjà rencontrés :
  - un `// commentaire` inséré au milieu d'une ligne avale la suite : commentaires en fin de ligne seulement, puis `node --check` ;
  - `--` interdit dans un commentaire XML Android (Gradle refuse) : `tests/test-android-xml.mjs` le vérifie ;
  - Firestore refuse les tableaux imbriqués (historique de valeur stocké en objets) ;
  - une modification de `proxy.mjs` demande un **redémarrage de l'app Node sur Hostinger**.

## Fait pendant ce chat (tout est sur `main`, CI verte au commit `db65bce`)
- Aperçu de carte → grand format partout ; images dans le chiffrage Cardmarket d'un deck.
- Internationalisation : langue des cartes et des prix selon la langue de l'appli ; interface traduite en allemand, espagnol, italien, portugais.
- Prochaines extensions : lien Secret Lair, lien « Précommander » Cardmarket ; explication Mystery Booster / Commander.
- Decks : enregistrer dans « Mes decks » un deck reçu par lien ou un deck EDHREC/Archidekt ; onglet Decks réservé aux comptes Google ou e-mail vérifié (envoi du mail de vérification depuis l'appli).
- Collection vide : les onglets restent visibles avec « Scanne pour débuter ».
- « Partager » ouvre le menu de partage Android dans l'APK (WhatsApp, Messages, Messenger…), sinon partage du navigateur, sinon copie.
- Écran de lancement animé (mélange A + B, 60 i/s, animations sur le compositeur) : complet au démarrage, court (0,6 s) pour les liens et rechargements ; Firebase chargé après.
- Scan multilingue : langue de l'appli, puis anglais, puis les autres langues **sur l'appareil** (`pwa/names-all.tsv`, ≈ 1,4 Mo compressé, téléchargé en Wi‑Fi à l'ouverture du scan, gardé 14 jours) ; le serveur (`/api/names/find`) prend le relais tant que le fichier n'est pas là. Texte lu affiché sous « Nom non reconnu ».
- Correctifs : notification push sans contenu (service worker), tests instables en CI (sw, trade, motion, extras, de), workflow des catalogues qui se recale sur `main` avant d'envoyer.
- `docs/a-faire.md` mis à jour : 2e widget (QR du lien d'échange), emplacement de la bannière de pub, plan B EDHREC/Archidekt, nom de domaine, achat « Soutenir ».

## Fait ensuite (9 octobre, fin de soirée)
- **Widget Android « QR code d'échange »** (`TradeWidget.java`, `widget_trade*.xml`) : QR du lien public de la liste d'échange, pseudo et « Liste d'échange » dessous, fond blanc ; sans lien « Crée ton lien d'échange » ; toucher → onglet Échange. Le site envoie la matrice du QR (`src/widget.js`, `setTradeWidget`) quand le compte est connu et que le lien, le pseudo ou la langue changent. Astuces dans Réglages › Widget et la feuille du QR code. **Nouvelle APK à faire.**
  - Vérifié ici sans SDK Android : Java compilé contre le framework Android (Robolectric `android-all`), rendu du bitmap décodé par un lecteur QR indépendant (jsQR) = bon lien ; ressources XML relues (aapt2 inaccessible : dl.google.com bloqué). La vraie compilation des XML se fait à la construction de l'APK.
- **Pub : emplacement « C » choisi** : en haut, seulement sur les écrans de consultation (accueil, collection, Mes decks, liste d'un autre joueur) ; masquée pendant saisie, recherche, résultats, éditeur de deck (`adsBusy`, `src/ads.js`).
- Scan de « Fulmine » (italien, appli en français) : reconnu après le redémarrage Node.
- **Interrupteurs EDHREC / Archidekt** : `EDHREC_OFF=1` / `ARCHIDEKT_OFF=1` sur Hostinger (`README.md`), sans nouvelle APK. Fichier EDH filtré (`edhFilter`, `src/edhbin.js`) ou refusé (410), import de liens refusé, l'appli cache et efface.

## Actions du propriétaire en attente
- **Refaire l'APK** (`android-app` : `git pull`, `npm run setup`, puis `npm run apk` ou Run ▶) et tester le widget « QR code d'échange » : liste de contrôle dans `docs/a-faire.md`. Puis vérifier que le bandeau de pub n'apparaît plus pendant la saisie et les résultats.
- Firebase › Authentication › Modèles › Vérification de l'adresse e-mail : nom d'expéditeur « Mana Orbit », langue française.
- Firebase › Authentication › Domaines autorisés : `card.m2s-photo.fr` (et le futur domaine).
- **Mails EDHREC et Archidekt toujours sans réponse** (`docs/mails-partenaires.md`). Stratégie retenue :
  - lancer le test fermé sans attendre (pas public, accord non nécessaire) ;
  - envoyer une relance avec une échéance claire ;
  - sans réponse à la mise en production : publier avec crédit et lien (déjà là), lecture hebdomadaire par le serveur uniquement, interrupteur côté serveur prêt ;
  - en cas de refus : plan B (decks préconstruits MTGJSON, decks générés depuis Scryfall, EDHTop16 pour le cEDH) — détail dans `docs/a-faire.md`.

## Prochaine étape proposée
1. Retour du propriétaire sur le widget QR (nouvelle APK) et le bandeau « par moments ».
2. Préparation Play Store : nom de domaine, test fermé, AdMob réel (`docs/a-faire.md` › « Avant la publication »).
