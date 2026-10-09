# Mana Orbit — développement

La doc produit est dans `README.md`. Ce fichier décrit le code, le build et les tests.

## Arborescence

| Chemin | Rôle |
|---|---|
| `src/` | Sources de la PWA : modules JS concaténés **dans l'ordre de `build.mjs`**, `style.css`, `body.html` (corps de la page). `src/package.json` les marque CommonJS (les tests Node les chargent avec `require`). |
| `build.mjs` | Assemble `src/*` → **`deck-deal.html`** (servi par le proxy, **versionné** : l'hébergeur ne lance aucun build) + `dist/deck-deal.artifact.html` (fragment, non versionné) ; recopie `src/edhbin.js` → `edhbin.cjs`. |
| `proxy.mjs`, `start.cjs` | Serveur de production (zéro dépendance). |
| `pwa/` | Service worker, manifeste, icônes ; `fr-names.tsv`, `names-<langue>.tsv` et `edh.bin.gz` sont générés par GitHub Actions. |
| `gen-*.mjs` | Générateurs (decks EDHREC, prix, noms imprimés en français et dans d'autres langues, clés VAPID). |
| `tests/` | Tests (Node, jsdom, navigateur) + `fixtures/` (photos de cartes synthétiques pour l'OCR). Dépendances de dev dans `tests/package.json` (jamais installées par l'hébergeur). |
| `tools/` | Outils hors tests : captures d'écran, banc OCR, icônes, génération des fixtures. |

Le `package.json` de la racine est celui du déploiement : **aucune dépendance**, ne pas en ajouter.

## Build

    node build.mjs        # → deck-deal.html (à committer avec les sources)

Toujours committer `src/` **et** `deck-deal.html` ensemble.

## Tests

    cd tests && npm ci && cd ..
    (cd tests && npm run fb)          # bundle Firebase des tests (tests/.tmp/fb-shared.js)
    node build.mjs
    bash tests/run-tests.sh           # tout, un par un (~22 min) → tests/run-tests.out + tests/logs/
    bash tests/run-tests.sh --node    # sans navigateur (~2 min)
    bash tests/run-tests.sh test.mjs art-e2e.mjs    # une sélection
    node tests/coll-e2e.mjs           # un seul test

- Navigateur : Chromium via `playwright-core` ; chemin du binaire dans `CHROMIUM` (défaut `/opt/pw-browsers/chromium`).
- Ne jamais lancer deux tests en même temps (ports fixes 188xx/189xx).
- `tests/setup-env.mjs` (importé en premier par chaque test) place le dossier courant à la racine et fait servir au proxy une **copie temporaire** de `pwa/` sans les fichiers générés (`PWA_DIR`) : aucun test ne touche au vrai `pwa/`.
- `rules-test.mjs` vérifie `firestore.rules` contre l'émulateur Firestore (Java 21), chaque branche permise et refusée. Lancé par la CI (`.github/workflows/rules.yml`, quand les règles ou leur test changent ; `RULES_REQUIRED=1` y fait d'un test ignoré un échec). En local :
  `npm i --no-save --prefix /tmp/rules-deps firebase-tools@15.31.0 @firebase/rules-unit-testing@5.0.2 firebase@12.19.0` puis `RULES_DEPS=/tmp/rules-deps/node_modules /tmp/rules-deps/node_modules/.bin/firebase emulators:exec --only firestore --project demo-deckdeal "node tests/rules-test.mjs"` ; sans émulateur il s'ignore (aussi dans `run-tests.sh`).
  Pas de `@firebase/rules-unit-testing` 6.x tant que les tests sont en firebase 12 (la 6 exige firebase 13 et Node 24).
- `scan-e2e.mjs` utilise Tesseract depuis `tests/node_modules` (`TESS_DIR` pour un autre dossier) ; `test-push.mjs` utilise `web-push` (`WEBPUSH_DIR`).
- `frnames-e2e.mjs` : noms français (decklist « 4 Foudre » au prix Cardmarket et ses vignettes, import en français, noms inconnus, coup d'œil après import, cartes sans langue, saisie « Anneau solaire », tuile de valeur sans CardTrader ; vraies lignes de `pwa/fr-names.tsv`).
- `intl-e2e.mjs` (navigateur) et `test-intl.mjs` (Node) : langue des cartes selon l'utilisateur, liens Cardmarket / CardTrader dans sa langue, catalogues `names-<langue>.tsv` (générateur et routes du serveur).
- `perf-e2e.mjs` : budget de performance d'une collection de 5 000 cartes, CPU ×4 (page en `file://`, faux Scryfall par routes Playwright, aucun port) ; marges ×3 pour la CI.
- `content-e2e.mjs` : « Prochaines extensions » (faux Scryfall `/sets`), Réglages › Aide et avis, demande de note. `sw-e2e.mjs` couvre aussi la copie locale de la page, le toast « Recharger », la copie de plus de 7 jours et les liens toujours réseau d'abord.
<!-- CARDZOOM (à venir) : zoom-e2e.mjs, si le test est ajouté. -->

## CI

`.github/workflows/tests.yml` : build à jour, puis **tous** les tests de `run-tests.sh` (~22 min) à chaque push, pull request et à la demande (onglet Actions › Tests › Run workflow). Un nouveau test s'ajoute dans les listes `NODE` / `BROWSER` de `tests/run-tests.sh` : la CI le lance d'office. Un push qui ne touche que les catalogues générés (`pwa/edh.bin.gz`, `pwa/fr-names.tsv`, `pwa/names-*.tsv`) ou des `.md` ne relance pas les tests.

`.github/workflows/rules.yml` (« Règles Firestore ») : `rules-test.mjs` contre l'émulateur (Java 21, `firebase-tools` 15.31.0, `@firebase/rules-unit-testing` 5.0.2, `firebase` de `tests/package.json`, installés à part avec `--no-save`), seulement quand `firestore.rules`, `tests/rules-test.mjs`, `tests/setup-env.mjs`, `tests/package.json` ou le workflow changent, et à la demande ; statut à part sur le commit. Il ne publie rien : des règles modifiées se republient à la main (console Firebase › Firestore › Règles).
