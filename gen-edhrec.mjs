#!/usr/bin/env node
// Génère pwa/edh.tsv : les commandants les plus joués (EDHREC), le deck moyen de chacun, quelques decks réels (Archidekt) et le prix Cardmarket
// de chaque carte (tendance Scryfall). L'app le télécharge une fois (≈ 0,5 Mo compressé) et compare tout à ta collection, sans réseau.
//   node gen-edhrec.mjs [fichier de sortie]        (Node ≥ 18, aucune dépendance ; ≈ 10 à 20 minutes pour 1 000 commandants)
//   EDH_TOP=1000 · EDH_ARCH=3 (decks Archidekt par commandant, 0 = désactivé) · EDH_ARCH_TOP=100 · EDH_DEBUG=edh-debug (dossier des échantillons)
// Lancé chaque semaine par .github/workflows/edhrec.yml. Le fichier existant n'est remplacé que si le nouveau est plausible.
// Aucune API officielle chez EDHREC : on lit les mêmes fichiers JSON que son site, lentement (≈ 3 requêtes par seconde au plus), avec un User-Agent qui s'annonce.
import { writeFileSync, renameSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const UA = 'DeckDeal-edhrec/1.0 (+https://github.com/BeerDeus/mtgcardshop)';
const TOP = Math.max(1, Number(process.env.EDH_TOP) || 1000), ARCH = process.env.EDH_ARCH === undefined ? 3 : Math.max(0, Number(process.env.EDH_ARCH) || 0), ARCH_TOP = Number(process.env.EDH_ARCH_TOP) || 100;
const DEBUG = process.env.EDH_DEBUG || '';
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
/** Page de liste de commandants → [{ slug, names, decks, ci }] (ceux qui ont un nombre de decks). */
export function commandersOf(j) {
  const out = [];
  for (const cv of cardviewsOf(j)) {
    const decks = Number(cv.num_decks); if (!slugOk(cv.sanitized) || !Number.isFinite(decks) || decks <= 0) continue;
    const names = String(cv.name).split(/\s+\+\s+/).map(cleanName).filter(Boolean); if (!names.length) continue;
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
/** Texte du fichier (format décrit dans parseEdh de src/core.js). cmds : [{ slug, names, decks, ci }] · decks : [{ slug, src, label, url, cards }] · price : Map(nom → centimes) · img : Map(slug → chemin). */
export function buildEdh({ at, cmds, decks, price, img }) {
  const L = [`#edh\t1\t${at}`];
  for (const c of cmds) { L.push(['C', c.slug, c.decks, c.ci, ...c.names.map(tab)].join('\t')); const i = img && img.get(c.slug); if (i) L.push(`I\t${c.slug}\t${i}`); }
  for (const d of decks) { L.push(['D', d.slug, d.src, tab(d.label), /^https:\/\//.test(d.url || '') ? d.url : ''].join('\t')); for (const [n, q] of d.cards) L.push(`K\t${q}\t${tab(n)}`); }
  for (const [n, c] of price || []) if (c > 0) L.push(`P\t${Math.round(c)}\t${tab(n)}`);
  return L.join('\n') + '\n';
}

/* ── Réseau ───────────────────────────────────────────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = ms => (GAP == null ? ms : Math.min(ms, 20));      // tests : pas d'attente réelle entre les essais
const log = (...a) => { const s = a.join(' '); console.log(s); if (DEBUG) { try { mkdirSync(DEBUG, { recursive: true }); appendFileSync(join(DEBUG, 'log.txt'), s + '\n'); } catch { /* ignore */ } } };
let nSamples = 0;
const sample = (name, data) => { if (!DEBUG || (!/^(avg|archidekt)/.test(name) && ++nSamples > 6)) return; try { mkdirSync(DEBUG, { recursive: true }); writeFileSync(join(DEBUG, name.replace(/[^\w.-]+/g, '_') + '.json'), JSON.stringify(data, null, 1).slice(0, 60000)); } catch { /* ignore */ } };
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

/* ── 1) Commandants : liste EDHREC (période, pages suivantes), sinon par identité de couleur, sinon Scryfall ────────────── */
const LISTS = ['commanders/year', 'commanders/past2years', 'commanders/month', 'commanders/week', 'commanders'];
const COLOR_NAMES = {   // identité → noms que EDHREC peut utiliser dans ses adresses (on essaie dans l'ordre)
  '': ['colorless'], W: ['white', 'mono-white', 'w'], U: ['blue', 'mono-blue', 'u'], B: ['black', 'mono-black', 'b'], R: ['red', 'mono-red', 'r'], G: ['green', 'mono-green', 'g'],
  WU: ['azorius', 'wu'], UB: ['dimir', 'ub'], BR: ['rakdos', 'br'], RG: ['gruul', 'rg'], WG: ['selesnya', 'gw'], WB: ['orzhov', 'wb'], UR: ['izzet', 'ur'], BG: ['golgari', 'bg'], WR: ['boros', 'rw'], UG: ['simic', 'gu'],
  WUB: ['esper', 'wub'], UBR: ['grixis', 'ubr'], BRG: ['jund', 'brg'], WRG: ['naya', 'rgw'], WUG: ['bant', 'gwu'],
  WBG: ['abzan', 'wbg'], WUR: ['jeskai', 'urw'], UBG: ['sultai', 'bgu'], WBR: ['mardu', 'rwb'], URG: ['temur', 'gur'],
  WUBR: ['yore-tiller', 'wubr'], UBRG: ['glint-eye', 'ubrg'], WBRG: ['dune-brood', 'wbrg'], WURG: ['ink-treader', 'wurg'], WUBG: ['witch-maw', 'wubg'], WUBRG: ['five-color', 'wubrg'],
};
async function crawlList(path, out, stat) {
  let next = path + '.json', pages = 0;
  while (next && pages < 60) {
    let j; try { j = await getJson(EDH_BASE + next); } catch (e) { stat.push(`${next} → ${e.message}`); break; }
    if (!j) { stat.push(`${next} → 404`); break; }
    const list = commandersOf(j);
    if (!pages) { sample('list-' + path, j); const lists = j && j.container && j.container.json_dict && j.container.json_dict.cardlists, cv = cardviewsOf(j)[0]; stat.push(`forme : ${Object.keys(j).slice(0, 12).join(',')} · cardlists ${Array.isArray(lists) ? lists.length + ' (' + Object.keys(lists[0] || {}).join(',') + ')' : 'absent'} · carte ${cv ? Object.keys(cv).slice(0, 14).join(',') : 'aucune'}`); }
    stat.push(`${next} → ${list.length} commandants${moreOf(j) ? ' · suite ' + moreOf(j) : ''}`);
    let add = 0; for (const c of list) if (!out.has(c.slug)) { out.set(c.slug, c); add++; }
    pages++; const more = moreOf(j); next = more && more !== next && add ? more : '';
  }
}
async function discover() {
  const out = new Map(), stat = [];
  for (const p of LISTS) { await crawlList(p, out, stat); if (out.size >= TOP) break; }
  log(`  listes : ${out.size} commandants`); for (const s of stat) log('   ·', s);
  if (out.size < TOP) {      // la liste globale s'arrête à N : on complète couleur par couleur
    const st2 = [];
    for (const [ci, names] of Object.entries(COLOR_NAMES)) {
      const before = out.size;
      for (const n of names) { const tmp = new Map(); await crawlList('commanders/' + n, tmp, st2); if (tmp.size) { for (const [k, c] of tmp) if (!out.has(k)) out.set(k, { ...c, ci: c.ci || ci }); break; } }
      log(`  couleur ${ci || 'incolore'} : +${out.size - before}`);
      if (out.size >= TOP * 1.6) break;
    }
    for (const s of st2.slice(0, 60)) log('   ·', s);
  }
  return [...out.values()].sort((a, b) => b.decks - a.decks);
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
  let n = 0;
  for (const c of cmds) {
    n++;
    let j; try { j = await getJson(EDH_BASE + 'average-decks/' + c.slug + '.json'); } catch (e) { skipped.push(`${c.slug}: ${e.message}`); if (skipped.length > 40 && !decks.length) throw new Error('EDHREC ne répond pas aux decks moyens : ' + skipped.slice(-3).join(' | ')); continue; }
    if (!j) { skipped.push(c.slug + ': 404'); continue; }
    if (!decks.length) sample('avg-' + c.slug, j);
    const cards = avgLines(j, c.names), total = cards.reduce((a, x) => a + x[1], 0);
    if (total < 40) { skipped.push(`${c.slug}: ${total} cartes`); continue; }
    decks.push({ slug: c.slug, src: 'edhrec', label: 'Deck moyen', url: 'https://edhrec.com/average-decks/' + c.slug, cards });
    kept.push(c);
    if (n % 50 === 0) log(`  decks moyens : ${decks.length} lus sur ${n} essayés`);
  }
  log(`  decks moyens : ${decks.length} ; ignorés : ${skipped.length}`); for (const s of skipped.slice(0, 25)) log('   ·', s);
  return { decks, kept };
}

/* ── 3) Decks réels Archidekt (facultatif, tolérant : un échec n'arrête rien) ──────────────────────────── */
async function archidekt(cmds, decks) {
  if (!ARCH) return 0;
  const AR = ARCH_BASE, hd = { Accept: 'application/json' };
  let added = 0, fails = 0, tried = 0;
  for (const c of cmds.slice(0, ARCH_TOP)) {
    tried++;
    try {
      const q = AR + 'decks/v3/?' + new URLSearchParams({ commanders: c.names[0], formats: '3', orderBy: '-viewCount', pageSize: String(ARCH + 2) });
      const list = archidektList(await getJson(q, { gap: 900, headers: hd, tries: 3 })); if (!decks.some(d => d.src === 'archidekt')) sample('archidekt-search-' + c.slug, list);
      let got = 0;
      for (const l of list) {
        if (got >= ARCH) break;
        const d = archidektDeck(await getJson(AR + 'decks/' + l.id + '/', { gap: 900, headers: hd, tries: 3 }));
        if (!d.cmd.some(x => c.names.some(y => normKey(x) === normKey(y))) || d.cards.reduce((a, x) => a + x[1], 0) < 60) continue;
        decks.push({ slug: c.slug, src: 'archidekt', label: [d.name, d.views ? nf(d.views) + ' vues' : ''].filter(Boolean).join(' · '), url: 'https://archidekt.com/decks/' + l.id, cards: d.cards }); got++; added++;
      }
    } catch (e) { fails++; if (fails <= 5) log('   · archidekt', c.slug, e.message); if (fails >= 6 && !added) { log('  Archidekt injoignable ou format inattendu : abandon de cette source'); break; } }
  }
  log(`  decks Archidekt : ${added} (${tried} commandants essayés, ${fails} erreurs)`); return added;
}
const nf = n => Number(n).toLocaleString('fr-FR');

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

async function main() {
  const out = process.argv[2] || join(here, 'pwa', 'edh.tsv');
  log(`Génération : top ${TOP}, Archidekt ${ARCH ? ARCH + ' deck(s) pour les ' + ARCH_TOP + ' premiers' : 'désactivé'}`);
  let cmds = await discover();
  if (cmds.length < Math.min(TOP, MIN_CMDS)) { log('  liste EDHREC insuffisante : complétée par le classement Scryfall'); const seen = new Set(cmds.map(c => c.slug)); cmds = cmds.concat((await discoverScryfall()).filter(c => !seen.has(c.slug))); }
  if (!cmds.length) throw new Error('Aucun commandant trouvé (voir le journal)');
  const top = cmds.slice(0, TOP);
  log(`${cmds.length} commandants au total ; decks moyens pour les ${top.length} premiers`);
  const { decks, kept } = await avgDecks(top);
  await archidekt(kept, decks);
  const names = new Set(); for (const c of cmds) for (const n of c.names) names.add(n); for (const d of decks) for (const [n] of d.cards) names.add(n);
  log(`Scryfall : prix de ${names.size} cartes`);
  const { price, meta } = await scryInfo([...names]);
  const img = new Map(), priceByName = new Map();
  for (const c of cmds) { const m = meta.get(normKey(c.names[0])); if (m) { if (m.img) img.set(c.slug, m.img); if (!c.ci && m.ci) c.ci = m.ci; } }
  const usedKeys = new Set(); for (const d of decks) for (const [n] of d.cards) usedKeys.add(normKey(n)); for (const c of cmds) for (const n of c.names) usedKeys.add(normKey(n));
  const dispName = new Map(); for (const d of decks) for (const [n] of d.cards) if (!dispName.has(normKey(n))) dispName.set(normKey(n), n); for (const c of cmds) for (const n of c.names) if (!dispName.has(normKey(n))) dispName.set(normKey(n), n);
  for (const k of usedKeys) if (price.has(k)) priceByName.set(dispName.get(k) || k, price.get(k));
  const text = buildEdh({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), cmds: cmds.filter(c => c.decks > 0 || decks.some(d => d.slug === c.slug)), decks: decks.sort((a, b) => (cmds.findIndex(c => c.slug === a.slug) - cmds.findIndex(c => c.slug === b.slug)) || (a.src === b.src ? 0 : a.src === 'edhrec' ? -1 : 1)), price: priceByName, img });
  if (decks.length < MIN_DECKS || cmds.length < MIN_CMDS) throw new Error(`Résultat trop maigre (${decks.length} decks, ${cmds.length} commandants) : fichier existant conservé`);
  mkdirSync(dirname(out), { recursive: true });
  const tmp = out + '.tmp'; writeFileSync(tmp, text); renameSync(tmp, out);
  log(`${cmds.length} commandants, ${decks.length} decks, ${priceByName.size} prix → ${out} (${(text.length / 1048576).toFixed(2)} Mo)`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { log('ERREUR : ' + (e.message || e)); process.exit(1); });
