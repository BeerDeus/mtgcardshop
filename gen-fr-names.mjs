#!/usr/bin/env node
// Génère le catalogue des noms de cartes imprimés dans une langue, servi tel quel à l'app (une requête, ≈ 1,3 Mo compressé par langue)
// à la place de ≈ 180 pages de l'API Scryfall téléchargées depuis chaque téléphone. Une ligne par carte : « nom imprimé \t nom anglais \t image » (image : chemin après /small/).
//   node gen-fr-names.mjs [fichier de sortie]                → pwa/fr-names.tsv (français, nom de fichier historique gardé : l'app le lit déjà)
//   node gen-fr-names.mjs --lang de [fichier de sortie]      → pwa/names-de.tsv (code de langue Scryfall : de es it pt ja zhs zht ko ru)
// (Node ≥ 18, aucune dépendance, ≈ 1 à 2 minutes par langue). Lancé chaque semaine par .github/workflows/fr-names.yml.
// Le fichier existant n'est remplacé que si le nouveau est plausible (≥ 5 000 lignes, 1 000 pour les langues peu imprimées ; ≈ 31 000 en français).
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const UA = 'DeckDeal-fr-names/1.0 (+https://github.com/BeerDeus/mtgcardshop)';
/** Langues imprimées de Scryfall acceptées (liste fermée, comme les routes /names-<langue>.tsv du serveur) → locale du tri et minimum de lignes. */
export const NAME_LANGS = { fr: ['fr', 5000], de: ['de', 5000], es: ['es', 5000], it: ['it', 5000], pt: ['pt', 5000], ja: ['ja', 5000], zhs: ['zh', 5000], zht: ['zh-Hant', 1000], ko: ['ko', 1000], ru: ['ru', 1000] };
/** Fichier servi pour une langue : fr-names.tsv pour le français (nom historique), names-<langue>.tsv pour les autres. */
export const namesFile = lang => (lang === 'fr' ? 'fr-names.tsv' : 'names-' + lang + '.tsv');
const imgOf = c => (c.image_uris && c.image_uris.small) || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris && c.card_faces[0].image_uris.small) || null;
/** Une carte Scryfall imprimée dans `lang` → « nom imprimé \t nom anglais \t image », ou '' (autre langue, pas de nom imprimé). */
export function namesRow(c, lang) {
  if (!c || (c.lang && c.lang !== lang)) return '';
  const f = c.card_faces || [], p = c.printed_name || (f.length > 1 ? f.map(x => x.printed_name || x.name).join(' // ') : '');
  if (!p || !c.name) return '';
  const u = imgOf(c) || '', m = /\/small\/([^?]+)/.exec(u);
  return p + '\t' + c.name + '\t' + (m ? m[1] : '');
}
/** Même ligne que frRow() de src/data.js (le test.mjs le vérifie). */
export const frRow = c => namesRow(c, 'fr');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url) {
  let last = '';
  for (let i = 0; i < 6; i++) {
    let r; try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json;q=0.9,*/*;q=0.8' } }); } catch (e) { last = 'réseau : ' + (e && e.message); await sleep(3000 * (i + 1)); continue; }
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    const body = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200); last = `HTTP ${r.status} ${body}`;
    if (r.status === 429 || r.status >= 500) { await sleep(Math.max(3000 * (i + 1), (Number(r.headers.get('retry-after')) || 0) * 1000)); continue; }
    break;
  }
  throw new Error('Scryfall : ' + last + ' · ' + url);
}
/** Arguments : [--lang xx] [fichier de sortie] → { lang, out } ; langue inconnue : erreur (jamais de requête construite avec). */
export function parseArgs(argv) {
  const a = argv.slice(), i = a.indexOf('--lang'), lang = i >= 0 ? String(a.splice(i, 2)[1] || '') : 'fr';
  if (!Object.prototype.hasOwnProperty.call(NAME_LANGS, lang)) throw new Error(`Langue inconnue « ${lang} » (attendu : ${Object.keys(NAME_LANGS).join(' ')})`);
  return { lang, out: a[0] || join(here, 'pwa', namesFile(lang)) };
}
async function main() {
  const { lang, out } = parseArgs(process.argv.slice(2)), [loc, min] = NAME_LANGS[lang];
  let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent('lang:' + lang) + '&unique=cards&order=name', pages = 0;
  const by = new Map();
  while (url) {
    const j = await getJson(url); if (!j) break;
    if (!pages) console.log(`  ${lang} : total annoncé ${j.total_cards} cartes`);
    for (const c of j.data || []) { const r = namesRow(c, lang); if (r) by.set(r.split('\t').slice(0, 2).join('\t'), r); }
    url = j.has_more && typeof j.next_page === 'string' && /^https:\/\/api\.scryfall\.com\//.test(j.next_page) ? j.next_page : '';
    if (++pages % 10 === 0) console.log(`  page ${pages} · ${by.size} cartes`);
    await sleep(250);                                       // Scryfall demande 50–100 ms au minimum entre deux requêtes ; on reste large
  }
  const rows = [...by.values()].sort((a, b) => a.localeCompare(b, loc));
  if (rows.length < min) { console.error(`${lang} : seulement ${rows.length} lignes : fichier existant conservé.`); process.exit(1); }
  mkdirSync(dirname(out), { recursive: true });
  const tmp = out + '.tmp'; writeFileSync(tmp, rows.join('\n') + '\n'); renameSync(tmp, out);
  console.log(`${lang} : ${rows.length} cartes (${pages} pages) → ${out}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e.message || e); process.exit(1); });
