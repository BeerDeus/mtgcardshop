#!/usr/bin/env node
// Génère pwa/fr-names.tsv : le catalogue des noms de cartes imprimés en français, servi tel quel à l'app (une requête, < 1 Mo compressé)
// à la place de ≈ 140 pages de l'API Scryfall téléchargées depuis chaque téléphone. Une ligne par carte : « nom imprimé \t nom anglais \t image » (image : chemin après /small/).
//   node gen-fr-names.mjs [fichier de sortie]        (Node ≥ 18, aucune dépendance, ≈ 1 à 2 minutes)
// Lancé chaque semaine par .github/workflows/fr-names.yml. Le fichier existant n'est remplacé que si le nouveau est plausible (≥ 5 000 lignes).
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const UA = 'DeckDeal-fr-names/1.0 (+https://github.com/BeerDeus/mtgcardshop)';
const imgOf = c => (c.image_uris && c.image_uris.small) || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris && c.card_faces[0].image_uris.small) || null;
/** Même ligne que frRow() de src/data.js (le test.mjs le vérifie). */
export function frRow(c) {
  if (!c || (c.lang && c.lang !== 'fr')) return '';
  const f = c.card_faces || [], p = c.printed_name || (f.length > 1 ? f.map(x => x.printed_name || x.name).join(' // ') : '');
  if (!p || !c.name) return '';
  const u = imgOf(c) || '', m = /\/small\/([^?]+)/.exec(u);
  return p + '\t' + c.name + '\t' + (m ? m[1] : '');
}
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
async function main() {
  const out = process.argv[2] || join(here, 'pwa', 'fr-names.tsv');
  let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent('lang:fr') + '&unique=cards&order=name', pages = 0;
  const by = new Map();
  while (url) {
    const j = await getJson(url); if (!j) break;
    if (!pages) console.log(`  total annoncé : ${j.total_cards} cartes`);
    for (const c of j.data || []) { const r = frRow(c); if (r) by.set(r.split('\t').slice(0, 2).join('\t'), r); }
    url = j.has_more && typeof j.next_page === 'string' && /^https:\/\/api\.scryfall\.com\//.test(j.next_page) ? j.next_page : '';
    if (++pages % 10 === 0) console.log(`  page ${pages} · ${by.size} cartes`);
    await sleep(250);                                       // Scryfall demande 50–100 ms au minimum entre deux requêtes ; on reste large
  }
  const rows = [...by.values()].sort((a, b) => a.localeCompare(b, 'fr'));
  if (rows.length < 5000) { console.error(`Seulement ${rows.length} lignes : fichier existant conservé.`); process.exit(1); }
  mkdirSync(dirname(out), { recursive: true });
  const tmp = out + '.tmp'; writeFileSync(tmp, rows.join('\n') + '\n'); renameSync(tmp, out);
  console.log(`${rows.length} cartes (${pages} pages) → ${out}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e.message || e); process.exit(1); });
