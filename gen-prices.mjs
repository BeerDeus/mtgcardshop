#!/usr/bin/env node
// Génère prices.tsv.gz : le prix « à partir de » de chaque carte Magic (tendance Cardmarket en euros et TCGplayer en dollars, la moins chère
// de ses impressions papier), lu dans le fichier complet de Scryfall (bulk data « default_cards », ≈ 500 Mo lus en flux, jamais en entier en mémoire).
// L'app le télécharge en une requête (≈ 400 Ko) au lieu d'interroger Scryfall carte par carte depuis chaque téléphone.
//   node gen-prices.mjs [fichier de sortie]        (Node ≥ 18, aucune dépendance)
// Lancé chaque jour par .github/workflows/prices.yml, publié sur la branche « data » (un seul commit, réécrit : aucun historique qui gonfle le dépôt).
// Le serveur (proxy.mjs) le relit toutes les 6 h et le sert sur /prices.tsv.
// Format : 1re ligne « #MOPX1 <date ISO> <nombre> », puis « nom \t centimes € \t centimes $ » (vide si aucun prix).
import { writeFileSync, renameSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const UA = 'ManaOrbit-prices/1.0 (+https://github.com/BeerDeus/mtgcardshop)';
const SKIP_SETS = new Set(['memorabilia', 'token', 'minigame', 'alchemy']);                 // bordures dorées, jetons, cartes numériques : pas des cartes qu'on achète pour jouer
const SKIP_LAYOUTS = new Set(['art_series', 'token', 'double_faced_token', 'emblem', 'vanguard', 'scheme', 'planar']);
const cents = v => { const n = Math.round(parseFloat(v) * 100); return Number.isFinite(n) && n > 0 ? n : 0; };

/** Ajoute une impression au tableau name → { e, u } (plus bas prix non foil ; foil seulement si la carte n'existe qu'en foil). */
export function pxAdd(map, c) {
  if (!c || !c.name || c.digital || c.oversized || c.border_color === 'gold' || SKIP_SETS.has(c.set_type) || SKIP_LAYOUTS.has(c.layout)) return;
  if (Array.isArray(c.games) && !c.games.includes('paper')) return;
  const p = c.prices || {}, e = cents(p.eur) || cents(p.eur_foil), u = cents(p.usd) || cents(p.usd_foil) || cents(p.usd_etched);
  if (!e && !u) { if (!map.has(c.name)) map.set(c.name, { e: 0, u: 0 }); return; }
  const cur = map.get(c.name);
  if (!cur) { map.set(c.name, { e, u }); return; }
  if (e && (!cur.e || e < cur.e)) cur.e = e;
  if (u && (!cur.u || u < cur.u)) cur.u = u;
}
export function pxText(map, at) {
  const rows = [...map.entries()].filter(([, v]) => v.e || v.u).sort((a, b) => a[0] < b[0] ? -1 : 1);
  return `#MOPX1 ${at} ${rows.length}\n` + rows.map(([n, v]) => n + '\t' + (v.e || '') + '\t' + (v.u || '')).join('\n') + '\n';
}
/** Lit un flux JSON Scryfall (un objet carte par ligne, entre « [ » et « ] ») et remplit le tableau. */
export async function pxStream(stream, map) {
  const dec = new TextDecoder(); let buf = '', n = 0;
  const line = l => { l = l.trim().replace(/,$/, ''); if (l.length < 2 || l[0] !== '{') return; try { pxAdd(map, JSON.parse(l)); n++; } catch (e) { /* ligne incomplète : ignorée */ } };
  for await (const chunk of stream) {
    buf += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  line(buf);
  return n;
}

/** Adresse du fichier à télécharger : download_uri (nom historique), ou tout champ « download… », ou toute adresse de data.scryfall.io. */
function dlUrl(m) {
  if (typeof m.download_uri === 'string') return m.download_uri;
  for (const [k, v] of Object.entries(m)) if (/download/i.test(k) && typeof v === 'string' && /^https:/.test(v)) return v;
  for (const v of Object.values(m)) if (typeof v === 'string' && /^https:\/\/data\.scryfall\.io\/.+\.json/.test(v)) return v;
  return '';
}
async function main() {
  const out = process.argv[2] || join(here, 'prices.tsv.gz');
  const H = { 'User-Agent': UA, Accept: 'application/json;q=0.9,*/*;q=0.8' };
  // Fichier « default_cards » : cherché dans la liste, sinon demandé directement (deux orthographes). En cas d'échec, ce qui a été reçu est affiché.
  let meta = null; const seen = [];
  for (const u of ['https://api.scryfall.com/bulk-data', 'https://api.scryfall.com/bulk-data/default_cards', 'https://api.scryfall.com/bulk-data/default-cards']) {
    let r, t = ''; try { r = await fetch(u, { headers: H }); t = await r.text(); } catch (e) { seen.push(u + ' → ' + e.message); continue; }
    let j = null; try { j = JSON.parse(t); } catch (e) { /* pas du JSON */ }
    const list = j && Array.isArray(j.data) ? j.data : j ? [j] : [];
    meta = list.find(x => x && /default/.test(String(x.type || x.name || '').toLowerCase())) || null;
    if (meta) { meta.dl = dlUrl(meta); if (meta.dl) break; }
    seen.push(`${u} → ${r.status} ${meta ? JSON.stringify(meta).slice(0, 900) : t.replace(/\s+/g, ' ').slice(0, 300)}`); meta = null;
  }
  if (!meta) throw new Error('Scryfall : fichier « default_cards » introuvable\n  ' + seen.join('\n  '));
  console.log(`  fichier Scryfall du ${meta.updated_at} (${Math.round((meta.size || 0) / 1048576)} Mo)`);
  const r = await fetch(meta.dl, { headers: H });
  if (!r.ok || !r.body) throw new Error('Scryfall : téléchargement refusé (' + r.status + ')');
  const map = new Map(), n = await pxStream(r.body, map), txt = pxText(map, String(meta.updated_at || new Date().toISOString()));
  const rows = txt.split('\n').length - 2;
  console.log(`  ${n} impressions lues, ${rows} cartes avec un prix`);
  if (rows < 15000) throw new Error(`seulement ${rows} cartes avec un prix : fichier ignoré`);
  const gz = gzipSync(Buffer.from(txt), { level: 9 });
  writeFileSync(out + '.tmp', gz); renameSync(out + '.tmp', out);
  console.log(`  ${out} : ${(gz.length / 1024).toFixed(0)} Ko`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e.message || e); process.exit(1); });
