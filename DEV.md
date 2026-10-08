# Mana Orbit — développement

La doc produit est dans `README.md`. Ce fichier décrit le code, le build et les tests.

## Arborescence

| Chemin | Rôle |
|---|---|
| `src/` | Sources de la PWA : modules JS concaténés **dans l'ordre de `build.mjs`**, `style.css`, `body.html` (corps de la page). `src/package.json` les marque CommonJS (les tests Node les chargent avec `require`). |
| `build.mjs` | Assemble `src/*` → **`deck-deal.html`** (servi par le proxy, **versionné** : l'hébergeur ne lance aucun build) + `dist/deck-deal.artifact.html` (fragment, non versionné) ; recopie `src/edhbin.js` → `edhbin.cjs`. |
| `proxy.mjs`, `start.cjs` | Serveur de production (zéro dépendance). |
| `pwa/` | Service worker, manifeste, icônes ; `fr-names.tsv` et `edh.bin.gz` sont générés par GitHub Actions. |
| `gen-*.mjs` | Générateurs (decks EDHREC, noms français, clés VAPID). |
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
- `rules-test.mjs` (facultatif) vérifie `firestore.rules` contre l'émulateur Firestore (Java requis) :
  `cd tests && npm i --no-save --legacy-peer-deps firebase-tools @firebase/rules-unit-testing && cd .. && tests/node_modules/.bin/firebase emulators:exec --only firestore --project demo-deckdeal "node tests/rules-test.mjs"` ; sans émulateur il s'ignore.
- `scan-e2e.mjs` utilise Tesseract depuis `tests/node_modules` (`TESS_DIR` pour un autre dossier) ; `test-push.mjs` utilise `web-push` (`WEBPUSH_DIR`).

## CI

`.github/workflows/tests.yml` : build à jour à chaque push et pull request ; tests Node + jsdom (`run-tests.sh --node`) à chaque push ; **tous** les tests de `run-tests.sh` (~22 min) sur les pull requests et à la demande (onglet Actions › Tests › Run workflow). Un nouveau test s'ajoute dans les listes `NODE` / `BROWSER` de `tests/run-tests.sh` : la CI le lance d'office.
