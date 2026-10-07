#!/usr/bin/env node
// Génère pwa/edh.bin.gz : les commandants les plus joués (EDHREC), le deck moyen de chacun, des decks réels (Archidekt) et le prix Cardmarket
// de chaque carte (tendance Scryfall), au format binaire EDH2 (src/edhbin.js, copie edhbin.cjs) compressé en gzip. L'app le télécharge une fois
// (≈ 1 Mo pour 5 000 decks) et compare tout à ta collection, sans réseau. Une sortie en `.tsv` produit l'ancien format texte (tests, secours).
//   node gen-edhrec.mjs [fichier de sortie]        (Node ≥ 18, aucune dépendance ; ≈ 2 h 30 la 1re fois, puis ≈ 1 h à 1 h 20 grâce au cache des decks Archidekt)
//   EDH_TOP=2000 (commandants avec deck moyen) · EDH_ARCH=2 (decks Archidekt par commandant, 0 = désactivé) · EDH_ARCH_TOP=2000 · EDH_ARCH_ROT=4 (1 commandant sur 4 relu chaque semaine)
//   EDH_ARCH_MIN=130 (minutes pour Archidekt) · EDH_BUDGET=210 (minutes au total) · EDH_PREV=fichier précédent (cache des decks Archidekt, par défaut la sortie) · EDH_DEBUG=edh-debug
// Lancé chaque semaine par .github/workflows/edhrec.yml. Le fichier existant n'est remplacé que si le nouveau est plausible.
// Aucune API officielle chez EDHREC : on lit les mêmes fichiers JSON que son site, lentement (≈ 3 requêtes par seconde au plus), avec un User-Agent qui s'annonce.
import { writeFileSync, renameSync, mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { edhPack, edhUnpack } = createRequire(import.meta.url)(existsSync(join(here, 'edhbin.cjs')) ? './edhbin.cjs' : './src/edhbin.js');      // format binaire partagé avec l'appli
const UA = 'DeckDeal-edhrec/1.0 (+https://github.com/BeerDeus/mtgcardshop)';
const TOP = Math.max(1, Number(process.env.EDH_TOP) || 2000), ARCH = process.env.EDH_ARCH === undefined ? 2 : Math.max(0, Number(process.env.EDH_ARCH) || 0), ARCH_TOP = Number(process.env.EDH_ARCH_TOP) || 2000, ARCH_ROT = Math.max(1, Number(process.env.EDH_ARCH_ROT) || 4), ARCH_MS = (Number(process.env.EDH_ARCH_MIN) || 130) * 60000;
const DEBUG = process.env.EDH_DEBUG || '';
const LIST_MAX = Number(process.env.EDH_LIST) || 3000, MIN_DECKS_LISTED = 10, BUDGET_MS = (Number(process.env.EDH_BUDGET) || 210) * 60000, T0 = Date.now();      // commandants gardés dans la liste (3 000 max, ≥ 10 decks) ; durée maximale de la génération
const EDH_BASE = process.env.EDH_BASE || 'https://json.edhrec.com/pages/', SCRY = process.env.SCRY_BASE || 'https://api.scryfall.com/', ARCH_BASE = process.env.ARCH_BASE || 'https://archidekt.com/api/';
const MIN_DECKS = process.env.EDH_MIN_DECKS === undefined ? 50 : Number(process.env.EDH_MIN_DECKS), MIN_CMDS = process.env.EDH_MIN_CMDS === undefined ? 100 : Number(process.env.EDH_MIN_CMDS);
const GAP = process.env.EDH_GAP === undefined ? null : Number(process.env.EDH_GAP);      // tests : espacement imposé (0 = aucun)

/* ── Noms ─────────────────────────────────────────────────────────────────────────────────────── */
/** Même clé que ownKey() de src/core.js (le test.mjs le vérifie) : première face, sans accents ni ponctuation, minuscules. */
export function normKey(s) {
  const part = x => String(x || '').replace(/æ/gi, 'ae').replace(/œ/gi, 'oe').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’‘`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return String(s || '').split('//').map(part).filter(Boolean)[0] || '';
}
/** Adresse EDHREC d'un commandant (« Atraxa, Praetors' Voice » → atraxa-praetors-voice). */
export const edhSlug = name => normKey(name).replace(/ /g, '-');
const slugOk = s => /^[a-z0-9][a-z0-9-]{0,120}$/.test(String(s || ''));
const cleanName = n => String(n == null ? '' : n).replace(/\s*\*[A-Za-z]+\*/g, '').replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+\S+)?\s*$/, '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const qn = q => Math.max(1, Math.min(99, Math.round(Number(q) || 1)));
const ciOf = a => (Array.isArray(a) ? a : String(a || '').split('')).map(x => String(x).toUpperCase()).filter(x => 'WUBRG'.includes(x) && x.length === 1).sort((p, q) => 'WUBRG'.indexOf(p) - 'WUBRG'.indexOf(q)).filter((x, i, l) => l.indexOf(x) === i).join('');

/* ── Lecture des JSON EDHREC (tolérante : le format n'est pas documenté) ──────────────────────────────── */
/** Tous les objets « carte » d'une page EDHREC : { sanitized, name, num_decks, color_identity… }, où qu'ils soient. */
export function cardviewsOf(j) {
  const out = [], seen = new Set();
  const walk = (x, depth) => {
    if (!x || typeof x !== 'object' || depth > 8) return;
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (typeof x.sanitized === 'string' && typeof x.name === 'string' && !seen.has(x.sanitized)) { seen.add(x.sanitized); out.push(x); }
    for (const k of Object.keys(x)) if (typeof x[k] === 'object') walk(x[k], depth + 1);
  };
  const lists = j && j.container && j.container.json_dict && j.container.json_dict.cardlists;
  walk(Array.isArray(lists) ? lists : j, 0);
  return out;
}
/** Noms d'un commandant EDHREC : « A // B » est une paire (Partner, Friends forever…) quand l'adresse contient les deux noms (« kraum-…-tymna-the-weaver »), sinon une carte à deux faces (adresse = première face) : un seul nom. « A + B » : paire aussi. */
export function namesOf(name, slug) {
  const parts = String(name || '').split(/\s+(?:\/\/|\+)\s+/).map(cleanName).filter(Boolean);
  if (parts.length < 2) return parts;
  if (/\s\+\s/.test(name) || (slug !== edhSlug(parts[0]) && slug.includes(edhSlug(parts[1])))) return parts;
  return [cleanName(name)];
}
/** Page de liste de commandants → [{ slug, names, decks, ci }] (ceux qui ont un nombre de decks). */
export function commandersOf(j) {
  const out = [];
  for (const cv of cardviewsOf(j)) {
    const decks = Number(cv.num_decks); if (!slugOk(cv.sanitized) || !Number.isFinite(decks) || decks <= 0) continue;
    const names = namesOf(cv.name, cv.sanitized); if (!names.length) continue;
    out.push({ slug: cv.sanitized, names, decks: Math.round(decks), ci: ciOf(cv.color_identity) });
  }
  return out;
}
/** Lien « plus de résultats » d'une page de liste (clé more / next / pagination), chemin relatif à /pages/ ; '' s'il n'y en a pas. */
export function moreOf(j) {
  let found = '';
  const walk = (x, depth) => {
    if (found || !x || typeof x !== 'object' || depth > 6) return;
    for (const k of Object.keys(x)) {
      const v = x[k];
      if (/^(more|next|next_page)$/i.test(k) && typeof v === 'string' && /\.json$/.test(v) && !/^https?:\/\/(?!json\.edhrec\.com)/.test(v)) { found = v.replace(/^https?:\/\/json\.edhrec\.com/, '').replace(/^\/?(pages\/)?/, ''); return; }
      if (typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(j, 0); return found;
}
/** Deck moyen d'un commandant → [[nom, quantité]] sans le commandant lui-même. Accepte les formes connues : deck[] « 1 Sol Ring », deck{ commander_v2, cards }, archidekt[{ c, q }]. */
export function avgLines(j, cmdNames = []) {
  const out = [], drop = new Set(cmdNames.map(normKey));
  const add = (n, q) => { n = cleanName(n); if (n && !drop.has(normKey(n))) out.push([n, qn(q)]); };
  const d = j && j.deck;
  if (Array.isArray(d)) for (const x of d) { const m = /^\s*(\d+)\s*x?\s+(.+?)\s*$/.exec(String(x)); if (m) add(m[2], m[1]); else add(String(x), 1); }
  else if (d && typeof d === 'object') for (const list of Object.values(d.cards || {})) if (Array.isArray(list)) for (const x of list) add(x[0], x[1]);
  if (!out.length && Array.isArray(j && j.archidekt)) for (const x of j.archidekt) add(x && x.c, x && x.q);
  const by = new Map(); for (const [n, q] of out) { const k = normKey(n); if (by.has(k)) by.get(k)[1] += q; else by.set(k, [n, q]); }
  return [...by.values()];
}
/** Thèmes « généraux » d'EDHREC : ce qui distingue le style d'un deck (contrôle, gain de vie, défausse, meule…), par libellé EDHREC en minuscules. Les ~150 étiquettes d'EDHREC mêlent ces archétypes à des types de créatures
 *  (Cats, Wizards…), des mots-clés rares (Foretell, Mutate…) et des synergies très étroites (Pingers, Aikido…) : ces dernières sont écartées. Un libellé inconnu n'est simplement pas gardé. */
export const GENERAL_THEMES = new Set([
  'aggro', 'midrange', 'control', 'combo', 'tempo', 'stax', 'prison', 'pillow fort', 'voltron', 'storm', 'good stuff', 'toolbox', 'stompy', 'weenies', 'chaos', 'politics', 'group hug', 'group slug', 'hatebears', 'big mana', 'ramp',
  'spellslinger', 'counterspells', 'card draw', 'cantrips', 'x spells', 'flash', 'burn', 'lifegain', 'lifedrain', 'mill', 'self-mill', 'discard', 'wheels', 'theft', 'bounce', 'exile', 'land destruction', 'extra turns', 'forced combat',
  'tokens', 'aristocrats', 'sacrifice', 'reanimator', 'graveyard', 'blink', 'clones', '+1/+1 counters', 'proliferate', 'infect', 'poison', 'artifacts', 'equipment', 'auras', 'enchantress', 'planeswalkers', 'superfriends', 'vehicles',
  'landfall', 'lands matter', 'treasure', 'food', 'blood', 'monarch', 'curses', 'donate',
]);
/** Thèmes EDHREC d'un commandant (panels.taglinks de la page du deck moyen : [{ count, slug, value }], le nombre est celui des decks EDHREC du commandant qui ont ce thème) → [[slug, libellé, nombre]], du plus au moins fréquent.
 *  Seuls les thèmes généraux (GENERAL_THEMES) portés par au moins 1 % des decks du commandant (et 5 decks) sont gardés, 8 au plus. decks : nombre de decks du commandant (0 si inconnu : seul le plancher de 5 s'applique). */
export function themesOf(j, decks = 0) {
  const l = (j && j.panels && j.panels.taglinks) || (j && j.taglinks) || [], min = Math.max(5, Math.ceil((Number(decks) || 0) * 0.01)), seen = new Set(), out = [];
  for (const t of Array.isArray(l) ? l : []) {
    const slug = tab(t && t.slug).replace(/\s+/g, '-'), n = Math.round(Number(t && t.count)), label = tab(t && t.value).replace(/\s+/g, ' ').slice(0, 40);
    if (!slug || slug.length > 60 || !GENERAL_THEMES.has(label.toLowerCase()) || !(n >= min) || seen.has(slug)) continue; seen.add(slug); out.push([slug, label, n]);
  }
  return out.sort((a, b) => b[2] - a[2] || a[1].localeCompare(b[1])).slice(0, 8);
}
/** Deck Archidekt (/api/decks/{id}/) → { name, views, cmd:[noms], cards:[[nom, qté]] } ; banc, maybeboard et « considering » exclus. */
export function archidektDeck(j) {
  const cmd = [], by = new Map();
  for (const c of (j && j.cards) || []) {
    const cats = (c.categories || []).map(x => String(x).toLowerCase()), n = cleanName(c.card && c.card.oracleCard && c.card.oracleCard.name || c.card && c.card.name);
    if (!n || cats.some(x => /maybe|sideboard|considering/.test(x))) continue;
    if (cats.includes('commander')) { cmd.push(n); continue; }
    const k = normKey(n); if (by.has(k)) by.get(k)[1] += qn(c.quantity); else by.set(k, [n, qn(c.quantity)]);
  }
  return { name: cleanName(j && j.name), views: Number(j && j.viewCount) || 0, cmd, cards: [...by.values()] };
}
/** Page de recherche Archidekt → [{ id, name, views }] (accepte results[] ou decks[]). */
export function archidektList(j) {
  const l = (j && (j.results || j.decks)) || [];
  return (Array.isArray(l) ? l : []).map(d => ({ id: Number(d && d.id), name: cleanName(d && d.name), views: Number(d && d.viewCount) || 0 })).filter(d => d.id > 0);
}

/* ── Écriture ─────────────────────────────────────────────────────────────────────────────────── */
const tab = s => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim();
/** Texte du fichier (format décrit dans parseEdh de src/core.js). cmds : [{ slug, names, decks, ci }] · decks : [{ slug, src, label, url, cards }] · price : Map(nom → centimes) · img : Map(slug → chemin) · gc : noms des Game Changers. */
export function buildEdh({ at, cmds, decks, price, img, gc }) {
  const L = [`#edh\t1\t${at}`];
  for (const c of cmds) { L.push(['C', c.slug, c.decks, c.ci, ...c.names.map(tab)].join('\t')); const i = img && img.get(c.slug); if (i) L.push(`I\t${c.slug}\t${i}`); }
  for (const n of gc || []) if (tab(n)) L.push(`G\t${tab(n)}`);
  for (const d of decks) { L.push(['D', d.slug, d.src, tab(d.label), /^https:\/\//.test(d.url || '') ? d.url : ''].join('\t')); for (const [n, q] of d.cards) L.push(`K\t${q}\t${tab(n)}`); }
  for (const [n, c] of price || []) if (c > 0) L.push(`P\t${Math.round(c)}\t${tab(n)}`);
  return L.join('\n') + '\n';
}

/** Fichier binaire compressé (EDH2 + gzip). Mêmes paramètres que buildEdh ; price : Map(nom → centimes) · img : Map(slug → chemin) · gc : noms. */
export function buildBin({ at, cmds, decks, price, img, gc }) {
  const model = { v: 1, at, rk: cmds.some(c => c.dm > 0) ? 'month' : '', cmds: cmds.map(c => ({ slug: c.slug, decks: c.decks, dm: c.dm || 0, ci: c.ci, names: c.names, img: (img && img.get(c.slug)) || '', themes: c.themes || [] })), decks: decks.map(d => ({ slug: d.slug, src: d.src, label: d.label, url: /^https:\/\//.test(d.url || '') ? d.url : '', cards: d.cards })), price: price || [], gc: gc || [] };
  return gzipSync(Buffer.from(edhPack(model, normKey)), { level: 9 });
}

/* ── Réseau ───────────────────────────────────────────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = ms => (GAP == null ? ms : Math.min(ms, 20));      // tests : pas d'attente réelle entre les essais
const log = (...a) => { const s = a.join(' '); console.log(s); if (DEBUG) { try { mkdirSync(DEBUG, { recursive: true }); appendFileSync(join(DEBUG, 'log.txt'), s + '\n'); } catch { /* ignore */ } } };
let nSamples = 0;
const sample = (name, data) => { if (!DEBUG || (!/^(avg|archidekt|gc|edhtop)/.test(name) && ++nSamples > 6)) return; try { mkdirSync(DEBUG, { recursive: true }); writeFileSync(join(DEBUG, name.replace(/[^\w.-]+/g, '_') + '.json'), JSON.stringify(data, null, 1).slice(0, 60000)); } catch { /* ignore */ } };
let lastReq = 0;
/** GET JSON poli : espacement minimal gap ms entre deux requêtes, nouvel essai sur 429/5xx/réseau. null si 404 ; erreur (avec .status) sinon. */
async function getJson(url, { gap = 350, tries = 5, headers = {}, method = 'GET', body } = {}) {
  let last = '', status = 0;
  for (let i = 0; i < tries; i++) {
    const wait = lastReq + (GAP == null ? gap : GAP) - Date.now(); if (wait > 0) await sleep(wait); lastReq = Date.now();
    let r; try { r = await fetch(url, { method, body, headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } }); } catch (e) { last = 'réseau : ' + (e && e.message); status = 0; await sleep(backoff(2500 * (i + 1))); continue; }
    if (r.ok) { try { return await r.json(); } catch (e) { last = 'JSON illisible'; status = 502; break; } }
    status = r.status; if (r.status === 404 || r.status === 410) return null;
    last = `HTTP ${r.status} ${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`;
    if (r.status === 429 || r.status >= 500) { await sleep(backoff(Math.max(3000 * (i + 1), (Number(r.headers.get('retry-after')) || 0) * 1000))); continue; }
    break;
  }
  throw Object.assign(new Error(last + ' · ' + url), { status });
}

/* ── 1) Commandants : liste EDHREC du mois (classement et choix), complétée par la liste longue, puis par identité de couleur, sinon Scryfall ──────
   EDHREC : `commanders/year.json` est en fait « Past 2 Years » (en-tête et pages suivantes year-past2years-N) ; le mois est la seule vue « à jour ».
   Chaque commandant garde decks (compte long, sert aux seuils des thèmes et à l'affichage) et dm (decks du mois : 0 = absent de la liste du mois). */
const LISTS = ['commanders/year', 'commanders/past2years', 'commanders'];
const MONTH_LISTS = ['commanders/month', 'commanders/pastmonth'];
/** Période d'une page de liste EDHREC d'après son en-tête / tag (« Past Month », « pastmonth », « Past 2 Years »…) : 'month' | 'long' | ''. */
export function listPeriod(j) {
  const cl = j && j.container && j.container.json_dict && j.container.json_dict.cardlists, l = Array.isArray(cl) && cl[0] ? cl[0] : {};
  const t = [l.header, l.tag, j && j.header].filter(Boolean).join(' ').toLowerCase();
  return /month/.test(t) ? 'month' : /year|2 ?years|past2/.test(t) ? 'long' : '';
}
const COLOR_NAMES = {   // identité → noms que EDHREC peut utiliser dans ses adresses (on essaie dans l'ordre)
  '': ['colorless'], W: ['white', 'mono-white', 'w'], U: ['blue', 'mono-blue', 'u'], B: ['black', 'mono-black', 'b'], R: ['red', 'mono-red', 'r'], G: ['green', 'mono-green', 'g'],
  WU: ['azorius', 'wu'], UB: ['dimir', 'ub'], BR: ['rakdos', 'br'], RG: ['gruul', 'rg'], WG: ['selesnya', 'gw'], WB: ['orzhov', 'wb'], UR: ['izzet', 'ur'], BG: ['golgari', 'bg'], WR: ['boros', 'rw'], UG: ['simic', 'gu'],
  WUB: ['esper', 'wub'], UBR: ['grixis', 'ubr'], BRG: ['jund', 'brg'], WRG: ['naya', 'rgw'], WUG: ['bant', 'gwu'],
  WBG: ['abzan', 'wbg'], WUR: ['jeskai', 'urw'], UBG: ['sultai', 'bgu'], WBR: ['mardu', 'rwb'], URG: ['temur', 'gur'],
  WUBR: ['yore-tiller', 'wubr'], UBRG: ['glint-eye', 'ubrg'], WBRG: ['dune-brood', 'wbrg'], WURG: ['ink-treader', 'wurg'], WUBG: ['witch-maw', 'wubg'], WUBRG: ['five-color', 'wubrg'],
};
async function crawlList(path, out, stat, limit = Infinity, min = MIN_DECKS_LISTED, expect = '') {
  let next = path + '.json', pages = 0;
  while (next && pages < 80 && out.size < limit) {
    let j; try { j = await getJson(EDH_BASE + next); } catch (e) { stat.push(`${next} → ${e.message}`); break; }
    if (!j) { stat.push(`${next} → 404`); break; }
    const list = commandersOf(j);
    if (!pages && expect && listPeriod(j) !== expect) { stat.push(`${next} → période « ${listPeriod(j) || '?'} » au lieu de « ${expect} » : ignorée`); break; }
    if (!pages) { sample('list-' + path, j); const lists = j && j.container && j.container.json_dict && j.container.json_dict.cardlists, cv = cardviewsOf(j)[0]; stat.push(`forme : ${Object.keys(j).slice(0, 12).join(',')} · cardlists ${Array.isArray(lists) ? lists.length + ' (' + Object.keys(lists[0] || {}).join(',') + ')' : 'absent'} · carte ${cv ? Object.keys(cv).slice(0, 14).join(',') : 'aucune'}`); }
    if (pages < 3 || !moreOf(j)) stat.push(`${next} → ${list.length} commandants${moreOf(j) ? ' · suite ' + moreOf(j) : ''}`);
    let add = 0; for (const c of list) if (!out.has(c.slug) && c.decks >= min) { out.set(c.slug, c); add++; }
    pages++; const more = moreOf(j); next = more && more !== next && add ? more : '';
  }
}
async function discover() {
  const month = new Map(), long = new Map(), stat = [];
  for (const p of MONTH_LISTS) { await crawlList(p, month, stat, LIST_MAX, 1, 'month'); if (month.size) break; }
  for (const p of LISTS) { await crawlList(p, long, stat, LIST_MAX); if (long.size >= Math.max(TOP, month.size)) break; }
  // le mois d'abord (classement à jour), puis le reste de la liste longue ; decks = compte long quand EDHREC le donne, sinon celui du mois (commandant récent)
  const out = new Map();
  for (const c of [...month.values()].sort((a, b) => b.decks - a.decks)) { const l = long.get(c.slug); out.set(c.slug, { ...(l || c), dm: c.decks, decks: l ? l.decks : c.decks, ci: (l && l.ci) || c.ci }); }
  for (const c of long.values()) if (!out.has(c.slug)) out.set(c.slug, { ...c, dm: 0 });
  log(`  listes : ${out.size} commandants (${month.size} dans la liste du mois${month.size ? '' : ' : classement sur la liste longue'})`); for (const s of stat) log('   ·', s);
  if (out.size < TOP) {      // la liste globale s'arrête à N : on complète couleur par couleur
    const st2 = [];
    for (const [ci, names] of Object.entries(COLOR_NAMES)) {
      const before = out.size;
      for (const n of names) { const tmp = new Map(); await crawlList('commanders/' + n, tmp, st2, 400); if (tmp.size) { for (const [k, c] of tmp) if (!out.has(k)) out.set(k, { ...c, ci: c.ci || ci }); break; } }
      log(`  couleur ${ci || 'incolore'} : +${out.size - before}`);
      if (out.size >= TOP * 1.6) break;
    }
    for (const s of st2.slice(0, 60)) log('   ·', s);
  }
  return [...out.values()].sort((a, b) => (b.dm || 0) - (a.dm || 0) || b.decks - a.decks);      // mois d'abord, puis compte long
}
/** Dernier recours : les commandants les mieux classés par EDHREC d'après Scryfall (order:edhrec) ; nombre de decks inconnu (0 → lu sur la page du commandant). */
async function discoverScryfall() {
  const out = []; let url = SCRY + 'cards/search?q=' + encodeURIComponent('is:commander game:paper') + '&unique=cards&order=edhrec';
  while (url && out.length < TOP * 1.3) {
    const j = await getJson(url, { gap: 150 }); if (!j) break;
    for (const c of j.data || []) { const names = [String(c.name).split(' // ')[0]], slug = edhSlug(c.name); if (slugOk(slug)) out.push({ slug, names, decks: 0, ci: ciOf(c.color_identity) }); }
    url = j.has_more && typeof j.next_page === 'string' && j.next_page.startsWith(SCRY) ? j.next_page : '';
  }
  log(`  repli Scryfall : ${out.length} commandants`); return out;
}

/* ── 2) Deck moyen de chaque commandant ───────────────────────────────────────────────────────── */
async function avgDecks(cmds) {
  const decks = [], kept = [], skipped = [];
  let n = 0, nThemes = 0;
  for (const c of cmds) {
    n++; if (Date.now() - T0 > BUDGET_MS * 0.7) { log('  budget de temps atteint : decks moyens arrêtés à ' + decks.length); break; }
    let j; try { j = await getJson(EDH_BASE + 'average-decks/' + c.slug + '.json'); } catch (e) { skipped.push(`${c.slug}: ${e.message}`); if (skipped.length > 40 && !decks.length) throw new Error('EDHREC ne répond pas aux decks moyens : ' + skipped.slice(-3).join(' | ')); continue; }
    if (!j) { skipped.push(c.slug + ': 404'); continue; }
    if (!decks.length) sample('avg-' + c.slug, j);
    const cards = avgLines(j, c.names), total = cards.reduce((a, x) => a + x[1], 0);
    if (total < 40 || total > 105) { skipped.push(`${c.slug}: ${total} cartes`); continue; }      // un deck de Commander compte 100 cartes : au-delà, la liste est faussée
    decks.push({ slug: c.slug, src: 'edhrec', label: 'Deck moyen', url: 'https://edhrec.com/average-decks/' + c.slug, cards });
    c.themes = themesOf(j, c.decks); nThemes += c.themes.length ? 1 : 0; if (nThemes === 1 && c.themes.length) log(`  thèmes (exemple) ${c.slug} : ${c.themes.map(t => t[1] + ' ' + t[2]).join(', ')}`); else if (n === 1 && !c.themes.length) log(`  aucun thème lu pour ${c.slug} (clés : ${Object.keys(j.panels || {}).join(',') || '-'})`);      // les thèmes sont ceux du commandant : ils valent aussi pour ses decks Archidekt
    kept.push(c);
    if (n % 50 === 0) log(`  decks moyens : ${decks.length} lus sur ${n} essayés`);
  }
  log(`  decks moyens : ${decks.length} (dont ${nThemes} avec des thèmes EDHREC) ; ignorés : ${skipped.length}`); for (const s of skipped.slice(0, 25)) log('   ·', s);
  return { decks, kept };
}

/* ── 3) Decks réels Archidekt (facultatif, tolérant : un échec n'arrête rien ; incrémental) ──────────────────── */
const archId = url => Number((/archidekt\.com\/decks\/(\d+)/.exec(String(url || '')) || [])[1]) || 0;
const hash32 = s => { let x = 0; for (const ch of String(s)) x = (Math.imul(x, 31) + ch.charCodeAt(0)) >>> 0; return x; };
/** Les commandants du deck sont exactement ceux du commandant (ou de la paire) cherché : « Tymna + Thrasios » ne reprend pas un deck « Tymna + Kraum ». */
export const sameCmd = (deckCmd, names) => { const a = new Set(deckCmd.map(normKey)), b = new Set(names.map(normKey)); return a.size === b.size && [...a].every(x => b.has(x)); };
/** Decks Archidekt du fichier précédent : slug → [{ slug, src, label, url, cards:[[nom, qté]] }]. Vide si le fichier manque, n'est pas un EDH2 ou est illisible. */
export function loadPrev(file) {
  const out = new Map(); if (!file || !existsSync(file) || /\.tsv$/.test(file)) return out;
  try {
    let buf = readFileSync(file); if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    const r = edhUnpack(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
    r.dk.forEach(([ci, src, label, url], i) => {
      if (src !== 'archidekt' || !r.cmds[ci]) return;
      const cards = []; for (let j = r.off[i]; j < r.off[i + 1]; j++) cards.push([r.names[r.ids[j]], r.qty[j]]);
      const slug = r.cmds[ci].slug; if (!out.has(slug)) out.set(slug, []); out.get(slug).push({ slug, src, label, url: typeof url === 'number' ? 'https://archidekt.com/decks/' + url : String(url || ''), cards });
    });
  } catch (e) { log('  fichier précédent illisible (' + e.message + ') : cache Archidekt ignoré'); return new Map(); }
  return out;
}
/** Decks Archidekt du fichier précédent pour les commandants traités cette fois : base du garde-fou « forte baisse » (un top plus court que la dernière fois n'est pas une baisse). */
export const prevArch = (prev, cmds, n) => cmds.reduce((a, c) => a + Math.min((prev.get(c.slug) || []).length, n), 0);
/** Decks réels : ARCH par commandant pour les ARCH_TOP premiers. Les decks déjà lus (fichier précédent) sont gardés ; seuls les commandants qui n'ont pas leur quota et 1 sur ARCH_ROT chaque semaine sont recherchés de nouveau. Une erreur, ou le temps imparti, conserve l'ancien. */
async function archidekt(cmds, decks, prev = new Map()) {
  if (!ARCH) return 0;
  const AR = ARCH_BASE, hd = { Accept: 'application/json' }, week = Math.floor(Date.now() / 604800000), rot = c => ARCH_ROT <= 1 || (hash32(c.slug) + week) % ARCH_ROT === 0;
  const todo = [], keep = [];
  for (const c of cmds.slice(0, ARCH_TOP)) { const have = prev.get(c.slug) || []; (have.length < ARCH || rot(c) ? todo : keep).push([c, have]); }
  for (const [, have] of keep) decks.push(...have.slice(0, ARCH));
  todo.sort((x, y) => (x[1].length >= ARCH) - (y[1].length >= ARCH));      // d'abord ceux qui n'ont pas leur quota (tri stable : les plus populaires en tête)
  let fresh = 0, reused = 0, fails = 0, tried = 0, off = 0, rejected = 0, i = 0, abort = false;
  const until = Math.min(Date.now() + ARCH_MS, T0 + BUDGET_MS);
  log(`  Archidekt : ${keep.length} commandants gardés du fichier précédent, ${todo.length} à chercher`);
  for (; i < todo.length; i++) {
    const [c, have] = todo[i];
    if (Date.now() > until) { log(`  Archidekt : temps imparti atteint (${todo.length - i} commandants reportés, leurs anciens decks sont gardés)`); break; }
    tried++; let got = [];
    try {
      const q = AR + 'decks/v3/?' + new URLSearchParams({ ...ARCH_QUERY, [ARCH_CMD_PARAM]: c.names[0], orderBy: '-viewCount', pageSize: String(ARCH + 2) });
      const raw = await getJson(q, { gap: 900, headers: hd, tries: 2 }), list = archidektList(raw); if (tried === 1) sample('archidekt-search-' + c.slug, raw);
      const byId = new Map(have.map(d => [archId(d.url), d]));
      for (const l of list) {
        if (got.length >= ARCH) break;
        const old = byId.get(l.id); if (old) { got.push(old); reused++; continue; }      // déjà lu : pas de nouvelle requête
        const d = archidektDeck(await getJson(AR + 'decks/' + l.id + '/', { gap: 900, headers: hd, tries: 2 }));
        if (!sameCmd(d.cmd, c.names)) { if (c.names.length === 1) { off++; if (off >= 8 && !fresh && !reused) throw Object.assign(new Error('la recherche ne filtre pas par commandant'), { fatal: true }); } continue; }
        const size = d.cards.reduce((a, x) => a + x[1], 0); if (size < 90 || size > 101) { rejected++; continue; }      // deck incomplet, ou cartes en trop (jetons, sideboard mal classé) : 98 à 100 cartes hors commandant attendues
        got.push({ slug: c.slug, src: 'archidekt', label: [d.name, d.views ? nf(d.views) + ' vues' : ''].filter(Boolean).join(' · '), url: 'https://archidekt.com/decks/' + l.id, cards: d.cards }); fresh++;
      }
    } catch (e) {
      fails++; if (fails <= 5) log('   · archidekt', c.slug, e.message); got = [];
      if (e.fatal || (fails >= 4 && !fresh && !reused)) { log('  Archidekt injoignable ou format inattendu : abandon de cette source (les anciens decks sont gardés)'); abort = true; }
    }
    decks.push(...(got.length ? got : have.slice(0, ARCH)));
    if (abort) { i++; break; }
  }
  for (let j = i; j < todo.length; j++) decks.push(...todo[j][1].slice(0, ARCH));
  log(`  decks Archidekt : ${fresh} nouveaux, ${reused} déjà connus (${tried} commandants cherchés, ${fails} erreurs, ${rejected} écartés pour leur taille)`); return fresh + reused;
}
const nf = n => Number(n).toLocaleString('fr-FR');
// paramètres de la recherche Archidekt (validés par la sonde `--probe`)
const ARCH_QUERY = { deckFormat: '3' }, ARCH_CMD_PARAM = 'commanderName';      // sonde du 5 oct. 2026 : `commanders=` est ignoré par l'API, `commanderName=` filtre ; deckFormat 3 = Commander ; pageSize ignoré (60 decks par page)

/* ── 4) Prix et images via Scryfall (75 cartes par requête) ──────────────────────────────────────── */
async function scryInfo(names) {
  const price = new Map(), meta = new Map(), uniq = [...new Map(names.map(n => [normKey(n), String(n).split('//')[0].trim()])).entries()].filter(([, n]) => n && !n.includes('"'));
  let reqs = 0;
  for (let i = 0; i < uniq.length; i += 75) {
    const chunk = uniq.slice(i, i + 75);
    const j = await getJson(SCRY + 'cards/collection', { gap: 120, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers: chunk.map(([, n]) => ({ name: n })) }) });
    reqs++;
    for (const c of (j && j.data) || []) {
      const k = normKey(c.name), eur = Number((c.prices && (c.prices.eur || c.prices.eur_foil)) || 0), u = (c.image_uris && c.image_uris.small) || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris && c.card_faces[0].image_uris.small) || '', m = /\/small\/([^?]+)/.exec(u);
      if (eur > 0) price.set(k, Math.round(eur * 100)); meta.set(k, { img: m ? m[1] : '', ci: ciOf(c.color_identity) });
    }
    if (reqs % 40 === 0) log(`  scryfall : ${Math.min(uniq.length, i + 75)} / ${uniq.length} cartes`);
  }
  return { price, meta };
}

/* ── 5) Game Changers (brackets Commander) : recherche Scryfall, plusieurs écritures essayées ─────────────────── */
const GC_QUERIES = ['is:gamechanger', 'is:gamechangers', 'is:gc'];
/** Noms (première face) de la liste Game Changers. Vide si aucune requête ne donne un résultat plausible (20 à 150 cartes) : le bracket n'est alors pas calculé par l'appli. */
async function gameChangers() {
  for (const q of GC_QUERIES) {
    const out = []; let url = SCRY + 'cards/search?q=' + encodeURIComponent(q) + '&unique=cards';
    try {
      while (url && out.length < 400) {
        const j = await getJson(url, { gap: 150, tries: 2 }); if (!j) break; if (!out.length) sample('gc-' + q, j);
        for (const c of j.data || []) if (c && c.name) out.push(String(c.name).split(' // ')[0]);
        url = j.has_more && typeof j.next_page === 'string' && j.next_page.startsWith(SCRY) ? j.next_page : '';
      }
    } catch (e) { log(`  Game Changers « ${q} » : ${e.message}`); continue; }
    log(`  Game Changers « ${q} » : ${out.length} cartes${out.length ? ' (' + out.slice(0, 6).join(', ') + '…)' : ''}`);
    if (out.length >= 20 && out.length <= 150) return [...new Set(out)];
  }
  log('  Game Changers : liste indisponible (bracket non calculé)'); return [];
}

/** Sonde : Game Changers, champs des recherches et des decks Archidekt (dates, vues, bracket, prix), casse des noms, filtres bracket / date, schéma EDHTop16 (cEDH). Journal + échantillons sur la branche edh-debug. */
async function probe() {
  log('Sonde Game Changers'); const gc = await gameChangers(); log(`→ ${gc.length} Game Changers`);
  const AR = ARCH_BASE, hd = { Accept: 'application/json' }, keysOf = o => o && typeof o === 'object' ? Object.keys(o).join(',') : String(o);
  const show = (o, ks) => ks.map(k => k + '=' + JSON.stringify(o && o[k])).join(' ');
  const search = async (tag, v) => {
    const q = AR + 'decks/v3/?' + new URLSearchParams({ deckFormat: '3', ...v });
    try {
      const j = await getJson(q, { gap: 1200, headers: hd, tries: 2 }); sample('archidekt-probe-' + tag, j);
      const r = (j && j.results) || []; log(`  [${tag}] ${new URLSearchParams(v)} → ${r.length} decks · count=${j && j.count} · next=${!!(j && j.next)} · message=${j && j.message || ''}`);
      if (r[0]) { log('     clés : ' + keysOf(r[0])); for (const d of r.slice(0, 4)) log('     · ' + show(d, ['id', 'name', 'viewCount', 'updatedAt', 'createdAt', 'edhBracket', 'bracket', 'price', 'size'])); }
      return r;
    } catch (e) { log(`  [${tag}] ${new URLSearchParams(v)} → ${e.message}`); return []; }
  };
  log('Sonde Archidekt');
  const r = await search('base', { commanderName: 'Edgar Markov', orderBy: '-viewCount' });
  await search('page2', { commanderName: 'Edgar Markov', orderBy: '-viewCount', page: '2' });
  await search('updated', { commanderName: 'Edgar Markov', orderBy: '-updatedAt' });
  for (const [k, v] of [['b5', { edhBracket: '5' }], ['br5', { bracket: '5' }], ['upd', { updatedAfter: '2025-10-01' }], ['upd2', { updatedAtAfter: '2025-10-01' }], ['tag', { tags: 'cEDH' }]]) await search(k, { commanderName: 'Kinnan, Bonder Prodigy', orderBy: '-viewCount', ...v });
  for (const n of ['Sephiroth, Fabled SOLDIER', 'Sephiroth, Fabled Soldier', 'Esika, God of the Tree // The Prismatic Bridge', 'Esika, God of the Tree', 'Tymna the Weaver', 'Jace, Multiverse Architect']) await search('nom-' + edhSlug(n).slice(0, 20), { commanderName: n, orderBy: '-viewCount' });
  if (r[0]) {
    try {
      const d = await getJson(AR + 'decks/' + r[0].id + '/', { gap: 1200, headers: hd, tries: 2 }); sample('archidekt-probe-deck', d);
      log('  deck : clés ' + keysOf(d)); log('  deck : ' + show(d, ['id', 'name', 'viewCount', 'updatedAt', 'createdAt', 'edhBracket', 'bracket', 'price', 'deckFormat']));
      const c = d && d.cards && d.cards[0]; log('  carte : clés ' + keysOf(c) + ' · card : ' + keysOf(c && c.card) + ' · prix : ' + JSON.stringify(c && c.card && c.card.prices));
    } catch (e) { log('  deck : ' + e.message); }
  }
  log('Sonde EDHTop16');
  const gql = async (tag, query) => {
    try { const j = await getJson('https://edhtop16.com/api/graphql', { gap: 1200, tries: 2, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); sample('edhtop16-' + tag, j); log(`  [${tag}] → ${JSON.stringify(j).slice(0, 700)}`); return j; }
    catch (e) { log(`  [${tag}] → ${e.message}`); return null; }
  };
  await gql('schema', '{ __schema { queryType { fields { name args { name type { name kind ofType { name kind } } } } } } }');
  await gql('cmds', '{ commanders(first: 5, sortBy: POPULARITY, timePeriod: SIX_MONTHS) { edges { node { name colorId stats(filters: { timePeriod: SIX_MONTHS }) { count metaShare conversionRate } } } } }');
  await gql('enum', '{ a: __type(name: "TimePeriod") { enumValues { name } } b: __type(name: "CommandersSortBy") { enumValues { name } } c: __type(name: "Commander") { fields { name } } d: __type(name: "Entry") { fields { name } } }');
}
async function main() {
  const out = process.argv.slice(2).find(a => !a.startsWith('--')) || join(here, 'pwa', 'edh.bin.gz'), legacy = /\.tsv$/.test(out);
  const prev = ARCH && !legacy ? loadPrev(process.env.EDH_PREV || out) : new Map();
  log(`Génération : top ${TOP}, Archidekt ${ARCH ? ARCH + ' deck(s) pour les ' + ARCH_TOP + ' premiers' : 'désactivé'}`);
  let cmds = await discover();
  if (cmds.length < Math.min(TOP, MIN_CMDS)) { log('  liste EDHREC insuffisante : complétée par le classement Scryfall'); const seen = new Set(cmds.map(c => c.slug)); cmds = cmds.concat((await discoverScryfall()).filter(c => !seen.has(c.slug))); }
  if (!cmds.length) throw new Error('Aucun commandant trouvé (voir le journal)');
  const top = cmds.slice(0, TOP);
  log(`${cmds.length} commandants au total ; decks moyens pour les ${top.length} premiers`);
  const { decks, kept } = await avgDecks(top);
  await archidekt(kept, decks, prev);
  const prevTotal = prevArch(prev, kept.slice(0, ARCH_TOP), ARCH);
  const names = new Set(); for (const c of cmds) for (const n of c.names) names.add(n); for (const d of decks) for (const [n] of d.cards) names.add(n);
  log(`Scryfall : prix de ${names.size} cartes`);
  const { price, meta } = await scryInfo([...names]);
  const gc = await gameChangers();
  const img = new Map(), priceByName = new Map();
  for (const c of cmds) { const m = meta.get(normKey(c.names[0])); if (m) { if (m.img) img.set(c.slug, m.img); if (!c.ci && m.ci) c.ci = m.ci; } }
  const usedKeys = new Set(); for (const d of decks) for (const [n] of d.cards) usedKeys.add(normKey(n)); for (const c of cmds) for (const n of c.names) usedKeys.add(normKey(n));
  const dispName = new Map(); for (const d of decks) for (const [n] of d.cards) if (!dispName.has(normKey(n))) dispName.set(normKey(n), n); for (const c of cmds) for (const n of c.names) if (!dispName.has(normKey(n))) dispName.set(normKey(n), n);
  for (const k of usedKeys) if (price.has(k)) priceByName.set(dispName.get(k) || k, price.get(k));
  const order = new Map(cmds.map((c, i) => [c.slug, i])), model = { at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), cmds: cmds.filter(c => c.decks > 0 || decks.some(d => d.slug === c.slug)), decks: decks.sort((a, b) => (order.get(a.slug) - order.get(b.slug)) || (a.src === b.src ? 0 : a.src === 'edhrec' ? -1 : 1)), price: priceByName, img, gc };
  const payload = legacy ? Buffer.from(buildEdh(model)) : buildBin(model);
  if (decks.length < MIN_DECKS || cmds.length < MIN_CMDS) throw new Error(`Résultat trop maigre (${decks.length} decks, ${cmds.length} commandants) : fichier existant conservé`);
  const ar = decks.filter(d => d.src === 'archidekt').length; if (prevTotal >= 100 && ar < prevTotal * 0.7) throw new Error(`Decks Archidekt en forte baisse (${ar} contre ${prevTotal}) : fichier existant conservé`);
  mkdirSync(dirname(out), { recursive: true });
  const tmp = out + '.tmp'; writeFileSync(tmp, payload); renameSync(tmp, out);
  log(`${cmds.length} commandants, ${decks.length} decks (dont ${decks.filter(d => d.src === 'archidekt').length} Archidekt), ${priceByName.size} prix → ${out} (${(payload.length / 1048576).toFixed(2)} Mo)`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) (process.argv.includes('--probe') ? probe() : main()).catch(e => { log('ERREUR : ' + (e.message || e)); process.exit(1); });
