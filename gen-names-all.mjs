#!/usr/bin/env node
// Assemble les catalogues des noms imprimés (pwa/fr-names.tsv, pwa/names-de.tsv… générés par gen-fr-names.mjs) en un seul fichier compact : pwa/names-all.tsv.
// L'appli le télécharge une fois (en Wi-Fi) pour reconnaître au scan une carte d'une autre langue que la sienne sans passer par le serveur (src/scan.js › scanOther).
// Une ligne par nom anglais : « anglais \t fr \t de \t es \t it \t pt » ; une cellule = noms imprimés de la carte dans cette langue séparés par « | »
// (vide : pas de nom imprimé, ou le même qu'en anglais : le catalogue anglais le reconnaît déjà). Sans chemin d'image (≈ 3,5 Mo, ≈ 1,4 Mo compressé).
// 1re ligne : « # anglais \t fr \t de… » (langues des colonnes, lues par l'appli). Ordre stable (noms anglais triés par code de caractère) : un diff ne montre que les vrais changements.
//   node gen-names-all.mjs [dossier des catalogues] [fichier de sortie]      → pwa/ et pwa/names-all.tsv par défaut (Node ≥ 18, aucune dépendance, < 1 s)
// Lancé par .github/workflows/fr-names.yml après les catalogues de chaque langue. Le fichier existant n'est remplacé que si le nouveau est plausible (≥ 5 000 lignes).
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Langues des colonnes, dans l'ordre (celles que l'appli sait lire : core.js › NAMES_LANGS) → fichier source. */
export const ALL_LANGS = ['fr', 'de', 'es', 'it', 'pt'];
const fileOf = l => (l === 'fr' ? 'fr-names.tsv' : 'names-' + l + '.tsv');
/** Textes des catalogues { langue: « imprimé \t anglais \t image » par ligne } → contenu de names-all.tsv. Un catalogue tronqué (< 500 lignes, comme le serveur) est laissé de côté. */
export function namesAll(texts) {
  const by = new Map();                                                     // anglais → [noms imprimés par langue]
  for (const [i, l] of ALL_LANGS.entries()) {
    const rows = String(texts[l] || '').split('\n').filter(r => r && r[0] !== '#');
    if (rows.length < 500) continue;
    for (const r of rows) {
      const t = r.replace(/\r$/, '').split('\t'), p = (t[0] || '').trim(), en = (t[1] || '').trim();
      if (!p || !en || p === en || p.includes('|')) continue;              // même nom qu'en anglais : rien à chercher ailleurs ; « | » réservé au séparateur
      let e = by.get(en); if (!e) by.set(en, (e = ALL_LANGS.map(() => [])));
      if (!e[i].includes(p)) e[i].push(p);                                  // ordre du catalogue de la langue (nom imprimé trié) : celui que le serveur lit
    }
  }
  const out = [...by.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(en => en + '\t' + by.get(en).map(ps => ps.join('|')).join('\t'));
  return { text: '# anglais\t' + ALL_LANGS.join('\t') + '\n' + out.join('\n') + '\n', lines: out.length };
}
function main() {
  const [dir = join(here, 'pwa'), out = join(dir, 'names-all.tsv')] = process.argv.slice(2), texts = {};
  for (const l of ALL_LANGS) { const f = join(dir, fileOf(l)); if (existsSync(f)) texts[l] = readFileSync(f, 'utf8'); else console.warn(`${fileOf(l)} absent : colonne ${l} vide`); }
  const { text, lines } = namesAll(texts);
  if (lines < 5000) { console.error(`names-all : seulement ${lines} lignes : fichier existant conservé.`); process.exit(1); }
  const tmp = out + '.tmp'; writeFileSync(tmp, text); renameSync(tmp, out);
  console.log(`names-all : ${lines} noms anglais, ${(Buffer.byteLength(text) / 1048576).toFixed(2)} Mo → ${out}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
