// Importé en premier par chaque test : le proxy lancé par les tests lit un dossier pwa/ temporaire (manifeste, sw.js, icônes)
// SANS les fichiers générés par GitHub Actions (fr-names.tsv, edh.bin.gz) : les tests les créent eux-mêmes et ne touchent jamais au vrai pwa/.
// Le dossier courant devient la racine du dépôt (les tests lancent « node proxy.mjs » et lisent deck-deal.html).
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
process.chdir(root);
if (!process.env.PWA_DIR) {
  const dir = mkdtempSync(join(tmpdir(), 'deckdeal-pwa-'));
  for (const f of ['manifest.webmanifest', 'sw.js', 'privacy.html', 'icons']) cpSync(join(root, 'pwa', f), join(dir, f), { recursive: true });
  process.env.PWA_DIR = dir;
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
}
