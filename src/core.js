/* ── core.js : logique pure (parse, filtres, optimiseur, démo). Testable sous Node. ───────── */

const CONDITIONS = ['Mint', 'Near Mint', 'Slightly Played', 'Moderately Played', 'Played', 'Heavily Played', 'Poor'];
const COND_SHORT = { 'Mint': 'MT', 'Near Mint': 'NM', 'Slightly Played': 'SP', 'Moderately Played': 'MP', 'Played': 'PL', 'Heavily Played': 'HP', 'Poor': 'PO' };
const BASIC_NAMES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
  'snow covered plains', 'snow covered island', 'snow covered swamp', 'snow covered mountain', 'snow covered forest', 'snow covered wastes']);

function normPart(s) {
  return String(s || '').replace(/æ/gi, 'ae').replace(/œ/gi, 'oe').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’‘`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function normName(s) { return String(s || '').split('//').map(normPart).filter(Boolean).join(' // '); }
function frontName(s) { return normName(s).split(' // ')[0]; }

/** Langue d'une carte de collection : code de l'app (fr en de es it pt jp zh-CN) depuis un code (FR, ja, fra…) ou un nom (French, Français…), '' si inconnue. */
const LANG_ALIAS = { fr: 'fr', fra: 'fr', fre: 'fr', french: 'fr', francais: 'fr', en: 'en', eng: 'en', english: 'en', anglais: 'en', de: 'de', deu: 'de', ger: 'de', german: 'de', allemand: 'de', deutsch: 'de',
  es: 'es', spa: 'es', spanish: 'es', espagnol: 'es', it: 'it', ita: 'it', italian: 'it', italien: 'it', pt: 'pt', por: 'pt', portuguese: 'pt', portugais: 'pt', ja: 'jp', jp: 'jp', jpn: 'jp', japanese: 'jp', japonais: 'jp', zh: 'zh-CN', zhs: 'zh-CN', zht: 'zh-CN', zhcn: 'zh-CN', zhtw: 'zh-CN', cn: 'zh-CN', chs: 'zh-CN', cht: 'zh-CN', chinese: 'zh-CN', chinois: 'zh-CN', simplifiedchinese: 'zh-CN', chinesesimplified: 'zh-CN', traditionalchinese: 'zh-CN', chinesetraditional: 'zh-CN' };
const cardLang = x => LANG_ALIAS[String(x == null ? '' : x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')] || '';
/** Code court d'une langue pour l'affichage et le texte de la collection : « FR », « EN »… ; le chinois s'écrit « ZH » (lettres seules : le code CardTrader « zh-CN » a un tiret). */
const langCode = l => (l === 'zh-CN' ? 'ZH' : String(l || '').toUpperCase());

const HEADER_RE = /^(commander|companion|deck|main(board)?|sideboard|maybeboard|considering|about|name|creatures?|lands?|artifacts?|enchantments?|instants?|sorceries|sorcery|planeswalkers?|battles?|other|tokens?)\s*(\(\d+\))?\s*:?\s*$/i;

/** Une ligne de decklist → undefined (vide) · { ignored: true } (commentaire, en-tête : + quiet ; invalide : signalée) · { qty, name, key }. */
function parseLine(raw) {
  const line = String(raw == null ? '' : raw).trim();
  if (!line) return undefined;
  if (/^(\/\/|#)/.test(line) || /^SB:/i.test(line) || HEADER_RE.test(line)) return { ignored: true, quiet: true };   // commentaire, banc, en-tête : volontaire, pas signalé
  let qty = 1, name = line;
  const m = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
  if (m) { qty = parseInt(m[1], 10); name = m[2]; }
  let lang = '';
  name = name.replace(/\s+\*([A-Za-z]+(?:-[A-Za-z]+)?)\*\s*$/, (_, t) => { if (t.length > 1) lang = cardLang(t); return ''; })      // « *FR* » : langue ; « *F* » (foil) : ignoré
    .replace(/\s+\([A-Za-z0-9]{2,8}\)(\s+[A-Za-z0-9★-]+)?\s*$/, '')
    .trim();
  if (!name || qty < 1 || qty > 999) return { ignored: true };
  const key = normName(name);
  return key ? (lang ? { qty, name, key, lang } : { qty, name, key }) : { ignored: true };
}

/** Lit une decklist (EDHREC, Moxfield, Archidekt, MTGO). Terrains de base séparés. */
function parseDeck(text) {
  const cards = new Map();
  const basics = new Map();
  let lines = 0, ignored = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const p = parseLine(raw);
    if (!p) continue;
    lines++;
    if (p.ignored) { if (!p.quiet) ignored++; continue; }
    const bucket = BASIC_NAMES.has(p.key) ? basics : cards;
    const cur = bucket.get(p.key);
    if (cur) cur.qty += p.qty; else bucket.set(p.key, { key: p.key, name: p.name, qty: p.qty });
  }
  const c = [...cards.values()], b = [...basics.values()];
  const copies = c.reduce((a, x) => a + x.qty, 0);
  const basicCopies = b.reduce((a, x) => a + x.qty, 0);
  return { cards: c, basics: b, lines, ignored, copies: copies + basicCopies, basicCopies };
}

/** Retire de la decklist toutes les lignes d'une carte. Retourne le nouveau texte et les lignes retirées (pour annuler). */
function dropCard(text, key) {
  const kept = [], removed = [];
  String(text || '').split('\n').forEach((raw, i) => { const p = parseLine(raw); if (p && !p.ignored && p.key === key) removed.push({ i, raw }); else kept.push(raw); });
  return { text: kept.join('\n'), removed };
}
/** Remet des lignes retirées par dropCard, à leur place d'origine (ou à la fin si la liste a rétréci). */
function restoreLines(text, removed) {
  const lines = String(text || '').split('\n');
  for (const { i, raw } of removed.slice().sort((a, b) => a.i - b.i)) lines.splice(Math.min(i, lines.length), 0, raw);
  return lines.join('\n');
}

/** Ordre d'affichage. items : { name, i (rang dans la liste), cost (centimes ou null) } ; sans prix → toujours en fin de liste. */
function sortCards(items, mode) {
  const byI = (a, b) => a.i - b.i, arr = items.slice();
  if (mode === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || byI(a, b));
  else if (mode === 'price-desc' || mode === 'price-asc') {
    const sg = mode === 'price-desc' ? -1 : 1;
    arr.sort((a, b) => ((a.cost == null) - (b.cost == null)) || (a.cost != null && sg * (a.cost - b.cost)) || byI(a, b));
  } else arr.sort(byI);
  return arr;
}

/** Page d'une carte sur CardTrader (par identifiant de blueprint). */
const ctCardUrl = bpId => 'https://www.cardtrader.com/cards/' + encodeURIComponent(bpId);

/** Une offre passe-t-elle les critères (état, foil, hors vendeurs en vacances, etc.) ? */
function passes(o, f) {
  if (!o || o.vac || o.graded || o.signed || o.altered) return false;
  if ((o.bundle || 1) > 1) return false;
  const ci = CONDITIONS.indexOf(o.cond), mi = CONDITIONS.indexOf(f.cond);
  if (ci < 0 || ci > mi) return false;
  if (f.foil === 'no' && o.foil) return false;
  if (f.foil === 'yes' && !o.foil) return false;
  return o.price > 0 && o.qty > 0;
}

/** Produit CardTrader (/marketplace/products) → offre normalisée. */
function normalizeProduct(p, info) {
  const h = p.properties_hash || {};
  const u = p.user || {};
  const e = p.expansion || {};
  return {
    id: p.id, productId: p.id, bpId: p.blueprint_id,
    sellerId: u.id, seller: u.username || '?', country: u.country_code || '', hub: !!u.can_sell_via_hub, type: u.user_type || '',
    price: p.price ? p.price.cents : 0, cur: p.price ? p.price.currency : 'EUR', qty: p.quantity || 0,
    cond: h.condition, foil: !!h.mtg_foil, lang: h.mtg_language || '',
    signed: !!h.signed, altered: !!h.altered, graded: !!p.graded, vac: !!p.on_vacation, bundle: p.bundle_size || 1,
    set: e.code || (info && info.set) || '', setName: e.name_en || (info && info.setName) || '',
    num: (info && info.num) || h.collector_number || '', img: (info && info.img) || null,
    sset: (info && info.set) || '',                           // code d'extension Scryfall (celui de CardTrader peut différer)
    ref: info ? (h.mtg_foil ? info.ef : info.eu) ?? null : null,   // prix de référence Cardmarket (Scryfall, centimes) de cette impression, foil ou non
  };
}

/* ── Optimiseur ─────────────────────────────────────────────────────────────────────────── */
const byPrice = (a, b) => (a.price - b.price) || (b.qty - a.qty) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function allocate(sorted, qty, allowed) {
  const parts = []; let need = qty, cost = 0;
  for (const o of sorted) {
    if (need <= 0) break;
    if (allowed && !allowed.has(o.sellerId)) continue;
    const n = Math.min(need, o.qty);
    if (n > 0) { parts.push({ offer: o, n }); need -= n; cost += o.price * n; }
  }
  return { parts, short: need, cost };
}

function sellersOf(keys, alloc) {
  const m = new Map();
  for (const k of keys) for (const p of alloc[k].parts) {
    let s = m.get(p.offer.sellerId);
    if (!s) { s = new Set(); m.set(p.offer.sellerId, s); }
    s.add(k);
  }
  return m;
}

function summarize(keys, alloc, ship, mode) {
  let items = 0; const sellers = new Map(); const picks = {}; const missing = [], partial = [];
  for (const k of keys) {
    const a = alloc[k]; picks[k] = a; items += a.cost;
    if (!a.parts.length) missing.push(k); else if (a.short > 0) partial.push(k);
    for (const p of a.parts) {
      const o = p.offer;
      let g = sellers.get(o.sellerId);
      if (!g) { g = { sellerId: o.sellerId, seller: o.seller, country: o.country, hub: o.hub, items: [], subtotal: 0, count: 0 }; sellers.set(o.sellerId, g); }
      g.items.push({ key: k, offer: o, n: p.n }); g.subtotal += o.price * p.n; g.count += p.n;
    }
  }
  const sellerCount = sellers.size;
  const shipCents = mode === 'direct' ? ship * sellerCount : 0;
  return { mode, items, ship: shipCents, total: items + shipCents, sellerCount, picks, missing, partial,
    sellers: [...sellers.values()].sort((a, b) => b.subtotal - a.subtotal) };
}

function localSearch(keys, qtyOf, sorted, alloc, ship, locked) {
  const offersBySeller = new Map();
  for (const k of keys) for (const o of sorted[k]) {
    let s = offersBySeller.get(o.sellerId);
    if (!s) { s = new Set(); offersBySeller.set(o.sellerId, s); }
    s.add(k);
  }
  for (let iter = 0; iter < 60; iter++) {
    let improved = false;
    // 1) supprimer un vendeur : ses cartes sont reprises chez les autres vendeurs déjà utilisés
    const order = [...sellersOf(keys, alloc).entries()].sort((a, b) => a[1].size - b[1].size);
    for (const [s] of order) {
      const cur = sellersOf(keys, alloc);
      const mine = cur.get(s);
      if (!mine) continue;
      let blocked = false;
      for (const k of mine) if (locked.has(k)) { blocked = true; break; }
      if (blocked) continue;
      const allowed = new Set(cur.keys()); allowed.delete(s);
      let delta = -ship, ok = true; const next = {};
      for (const k of mine) {
        const na = allocate(sorted[k], qtyOf[k], allowed);
        if (na.short > alloc[k].short) { ok = false; break; }
        delta += na.cost - alloc[k].cost; next[k] = na;
      }
      if (ok && delta < 0) { Object.assign(alloc, next); improved = true; }
    }
    // 2) ajouter un vendeur : on le prend s'il économise plus que son port
    const used = sellersOf(keys, alloc);
    const cands = [...offersBySeller.entries()].filter(([s]) => !used.has(s)).sort((a, b) => b[1].size - a[1].size).slice(0, 80);
    for (const [t, ks] of cands) {
      const cur = sellersOf(keys, alloc);
      if (cur.has(t)) continue;
      const allowed = new Set(cur.keys()); allowed.add(t);
      let delta = ship; const next = {};
      for (const k of ks) {
        if (locked.has(k)) continue;
        const na = allocate(sorted[k], qtyOf[k], allowed);
        const d = na.cost - alloc[k].cost;
        if (na.short <= alloc[k].short && (d < 0 || na.short < alloc[k].short)) { next[k] = na; delta += d; }
      }
      if (Object.keys(next).length && delta < 0) { Object.assign(alloc, next); improved = true; }
    }
    if (!improved) break;
  }
}

/**
 * demand: [{key, qty}] ; offersByKey: {key: [offre]} (déjà filtrées par critères)
 * opts: {mode:'zero'|'direct', ship:centimes, forced:{key: offerId}}
 */
function optimize(demand, offersByKey, opts) {
  const mode = opts.mode === 'direct' ? 'direct' : 'zero';
  const ship = mode === 'direct' ? (opts.ship || 0) : 0;
  const forced = opts.forced || {};
  const keys = [], qtyOf = {}, sorted = {}, alloc = {}, locked = new Set();
  for (const d of demand) {
    keys.push(d.key); qtyOf[d.key] = d.qty;
    sorted[d.key] = (offersByKey[d.key] || []).filter(o => mode !== 'zero' || o.hub).slice().sort(byPrice);
  }
  for (const k of keys) {
    const fo = forced[k] ? sorted[k].find(o => o.id === forced[k]) : null;
    if (fo) {
      const n = Math.min(qtyOf[k], fo.qty);
      const rest = allocate(sorted[k].filter(o => o !== fo), qtyOf[k] - n, null);
      alloc[k] = { parts: [{ offer: fo, n }, ...rest.parts], short: rest.short, cost: fo.price * n + rest.cost };
      locked.add(k);
    } else alloc[k] = allocate(sorted[k], qtyOf[k], null);
  }
  const base = summarize(keys, alloc, ship, mode);
  if (mode === 'direct') localSearch(keys, qtyOf, sorted, alloc, ship, locked);
  const out = summarize(keys, alloc, ship, mode);
  out.baseline = { items: base.items, total: base.total, sellers: base.sellerCount };
  return out;
}

/* ── Démo : offres simulées, déterministes ───────────────────────────────────────────────── */
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const DEMO_SELLERS = [
  { id: 101, name: 'cartes_du_midi', country: 'FR', hub: true }, { id: 102, name: 'magic_boutique', country: 'FR', hub: true },
  { id: 103, name: 'lotus_noir_fr', country: 'FR', hub: false }, { id: 104, name: 'tcg_bordeaux', country: 'FR', hub: true },
  { id: 105, name: 'carta_viva', country: 'IT', hub: true }, { id: 106, name: 'singles_roma', country: 'IT', hub: true },
  { id: 107, name: 'kartenhain', country: 'DE', hub: true }, { id: 108, name: 'mox_und_mehr', country: 'DE', hub: false },
  { id: 109, name: 'cartomania_es', country: 'ES', hub: true }, { id: 110, name: 'brussels_cards', country: 'BE', hub: true },
  { id: 111, name: 'poldeck', country: 'PL', hub: true }, { id: 112, name: 'lusa_magic', country: 'PT', hub: true },
  { id: 113, name: 'tulip_tcg', country: 'NL', hub: true }, { id: 114, name: 'alsace_cartes', country: 'FR', hub: false },
];
const DEMO_SETS = [['cmm', 'Commander Masters'], ['c21', 'Commander 2021'], ['mh2', 'Modern Horizons 2'], ['2x2', 'Double Masters 2022'],
  ['fdn', 'Foundations'], ['clb', "Commander Legends: Battle for Baldur's Gate"], ['ncc', 'New Capenna Commander'], ['dmu', 'Dominaria United']];
const DEMO_BASE = { 'sol ring': 1.6, 'swords to plowshares': 2.4, 'path to exile': 3.2, 'sword of fire and ice': 31, 'sword of light and shadow': 9,
  'sword of hearth and home': 4.5, 'sun titan': 3.1, 'mother of runes': 5.5, 'giver of runes': 1.2, 'arcane signet': 1.1, 'restoration angel': 3.4,
  'skyclave apparition': 3.5, 'flickerwisp': 0.5, 'panharmonicon': 2.2, 'fellwar stone': 1.4, 'pearl medallion': 1.8, 'teleportation circle': 0.7,
  'ephemerate': 0.9, 'monumental henge': 2.6, 'minas tirith': 2.1, 'emeria the sky ruin': 1.3, 'cloister gargoyle': 0.4, 'felidar guardian': 0.5 };

/** Offres simulées pour une carte. lang='fr' : ~8 % des cartes n'en ont aucune (sert à tester le repli EN). */
/** Offre « prix Cardmarket » (sans token CardTrader) : une seule par carte, au prix tendance, qui passe tous les filtres (langue, état, Zero). */
function cmOffer(card, cents, opts) {
  const id = 'cm:' + card.key;
  return { id, productId: id, bpId: null, sellerId: 'cm', seller: 'Cardmarket', country: '', hub: true, type: 'cm', cm: true,
    price: cents, cur: 'EUR', qty: 999, cond: opts.cond === 'Mint' ? 'Mint' : 'Near Mint', foil: opts.foil === 'yes', lang: opts.lang,
    signed: false, altered: false, graded: false, vac: false, bundle: 1, set: '', setName: '', num: '', img: null, ref: null };
}
/** Lien de recherche Cardmarket d'une carte (langue du site : fr ou en). */
const cmUrl = (name, lang) => `https://www.cardmarket.com/${lang === 'fr' ? 'fr' : 'en'}/Magic/Products/Search?searchString=${encodeURIComponent(String(name || '').split('//')[0].trim())}`;
function makeDemoOffers(card, lang) {
  const key = card.key;
  const r = mulberry32(hash32(key + '|' + lang));
  const noLang = lang !== 'en' && (hash32(key + '|nolang') % 100) < 8;
  if (noLang) return [];
  const rb = mulberry32(hash32(key + '|base'));
  const base = DEMO_BASE[key] != null ? DEMO_BASE[key] : 0.18 + Math.pow(rb(), 3) * 6.5;
  const out = [];
  for (const s of DEMO_SELLERS) {
    if (r() > 0.56) continue;
    const n = 1 + (r() < 0.25 ? 1 : 0);
    for (let j = 0; j < n; j++) {
      const cond = ['Near Mint', 'Near Mint', 'Slightly Played', 'Slightly Played', 'Moderately Played', 'Played'][Math.floor(r() * 6)];
      const mult = { 'Near Mint': 1, 'Slightly Played': 0.92, 'Moderately Played': 0.82, 'Played': 0.7 }[cond];
      const foil = r() < 0.12;
      const price = Math.max(5, Math.round(base * (0.88 + r() * 0.55) * mult * (foil ? 2.3 : 1) * 100));
      const set = DEMO_SETS[Math.floor(r() * DEMO_SETS.length)];
      const id = hash32(key + '|' + s.id + '|' + j + '|' + lang);
      out.push({ id, productId: id, bpId: hash32(key + set[0]), sellerId: s.id, seller: s.name, country: s.country, hub: s.hub, type: 'normal',
        price, cur: 'EUR', qty: 1 + Math.floor(r() * 4), cond, foil, lang, signed: false, altered: false, graded: false, vac: false, bundle: 1,
        set: set[0], setName: set[1], num: String(1 + Math.floor(r() * 380)), img: null, ref: Math.max(5, Math.round(base * (foil ? 2.3 : 1) * 100)) });
    }
  }
  return out;
}

/* ── Decks enregistrés : normalisation, historique de prix, temps relatif ───────────────────── */
const HISTORY_MAX = 40, NAME_MAX = 120, TEXT_MAX = 60000;
const OPT_LANGS = ['fr', 'en', 'de', 'es', 'it', 'pt', 'jp', 'zh-CN'];
const OPT_FOIL = ['no', 'any', 'yes'];
const OPT_MODE = ['zero', 'direct', 'cm'];

/** Options de recherche : on ne garde que des valeurs connues (le document est lu depuis le cloud). */
function sanitizeOpts(o) {
  o = o || {};
  const ship = Number(o.ship);
  return {
    lang: OPT_LANGS.includes(o.lang) ? o.lang : 'fr',
    cond: CONDITIONS.includes(o.cond) ? o.cond : 'Slightly Played',
    foil: OPT_FOIL.includes(o.foil) ? o.foil : 'no',
    mode: OPT_MODE.includes(o.mode) ? o.mode : 'zero',
    ship: Number.isFinite(ship) ? Math.max(0, Math.min(5000, Math.round(ship))) : 280,
    fallbackEn: o.fallbackEn !== false,
  };
}

/** Nom proposé : la première carte de la liste (le commandant, dans un export EDHREC). */
function suggestName(text) {
  const d = parseDeck(text);
  const first = d.cards[0];
  return first ? first.name.slice(0, NAME_MAX) : 'Nouveau deck';
}

/** Deux relevés sont comparables s'ils portent sur le même mode, le même nombre de cartes trouvées et les mêmes critères. */
const sameKind = (a, b) => a.mode === b.mode && a.found === b.found && (a.sig || '') === (b.sig || '');

/** Ajoute un relevé de prix. Même nature, même total, moins de 30 min : on rafraîchit la date au lieu d'empiler. */
function pushHistory(history, entry) {
  const h = (Array.isArray(history) ? history : []).filter(e => e && Number.isFinite(e.at) && Number.isFinite(e.total)).slice();
  const last = h[h.length - 1];
  if (last && sameKind(last, entry) && last.total === entry.total && entry.at - last.at < 30 * 60 * 1000) h[h.length - 1] = entry;
  else h.push(entry);
  return h.slice(-HISTORY_MAX);
}

/** Variation entre le dernier relevé et le précédent comparable. */
function priceDelta(history) {
  const h = Array.isArray(history) ? history : [];
  const last = h[h.length - 1]; if (!last) return null;
  for (let i = h.length - 2; i >= 0; i--) {
    const p = h[i];
    if (sameKind(p, last)) return { mode: last.mode, total: last.total, prev: p.total, diff: last.total - p.total, at: last.at, prevAt: p.at };
  }
  return { mode: last.mode, total: last.total, prev: null, diff: 0, at: last.at, prevAt: null };
}

/** Série de prix comparable au dernier relevé, pour le mini-graphique. */
function priceSeries(history) {
  const h = Array.isArray(history) ? history : []; const last = h[h.length - 1]; if (!last) return [];
  return h.filter(e => sameKind(e, last)).map(e => e.total);
}

/* ── Prix gardés carte par carte + regroupements du deck viewer ───────────────────────────── */
const SNAP_MAX = 400, SNAP_STATES = ['ok', 'none', 'nohub', 'nf', 'basic', 'own'];
/** Relevé compact d'une recherche : { at, mode, lang, sig, items:[{k,n,q,s, c,l,d,st,nu,sn,im,cm,mc,tl,cl,sl,fb,sh, rf,ow,cmd}], pv, pa }. null si inutilisable.
 *  rf : prix de référence Cardmarket par exemplaire (centimes) · ow : exemplaires déjà possédés · cmd : commandant · pv/pa : prix unitaires du relevé précédent et sa date. */
function sanitizeSnap(x) {
  if (!x || typeof x !== 'object' || !Array.isArray(x.items) || !Number.isFinite(x.at)) return null;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const int = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
  const items = [];
  for (const i of x.items) {
    if (items.length >= SNAP_MAX) break;
    if (!i || typeof i.k !== 'string' || typeof i.n !== 'string' || !i.k || !i.n) continue;
    const o = { k: str(i.k, 80), n: str(i.n, 100), q: int(i.q, 1, 999) || 1, s: SNAP_STATES.includes(i.s) ? i.s : 'none' };
    const c = int(i.c, 0, 100000000); if (c != null && o.s === 'ok') o.c = c;
    for (const [f, n] of [['l', 8], ['d', 8], ['st', 12], ['nu', 12], ['sn', 80], ['im', 200], ['mc', 60], ['tl', 120], ['cl', 6], ['sl', 60]]) { const v = str(i[f], n); if (v) o[f] = v; }
    const cm = int(i.cm, 0, 99); if (cm != null) o.cm = cm;
    const sh = int(i.sh, 1, 999); if (sh != null) o.sh = sh;
    const rf = int(i.rf, 1, 10000000); if (rf != null && o.s === 'ok') o.rf = rf;
    const ow = int(i.ow, 1, 999); if (ow != null) o.ow = Math.min(ow, o.q);
    if (i.fb) o.fb = 1;
    if (i.cmd) o.cmd = 1;
    items.push(o);
  }
  if (!items.length) return null;
  const out = { at: x.at, mode: OPT_MODE.includes(x.mode) ? x.mode : 'zero', lang: str(x.lang, 8), sig: str(x.sig, 40), items };
  if (x.pv && typeof x.pv === 'object' && !Array.isArray(x.pv) && Number.isFinite(x.pa)) {
    const pv = {}; let n = 0;
    for (const k of Object.keys(x.pv)) { if (n >= SNAP_MAX) break; const v = x.pv[k]; if (Number.isFinite(v) && v >= 0.5 && k && k.length <= 80) { pv[k] = Math.min(10000000, Math.round(v)); n++; } }
    if (n) { out.pv = pv; out.pa = x.pa; }
  }
  return out;
}
/** Le plus récent de plusieurs relevés (cloud / appareil), ou null. */
const newestSnap = (...a) => a.filter(Boolean).sort((p, q) => q.at - p.at)[0] || null;

const TYPE_ORDER = ['Créatures', 'Planeswalkers', 'Batailles', 'Artefacts', 'Enchantements', 'Éphémères', 'Rituels', 'Terrains', 'Autres'];
/** Famille d'une carte d'après sa ligne de type (Artifact Creature → Créatures ; Artifact Land → Terrains). */
function typeBucket(tl) {
  const t = String(tl || '').toLowerCase();
  if (t.includes('creature')) return 'Créatures';
  if (t.includes('planeswalker')) return 'Planeswalkers';
  if (t.includes('battle')) return 'Batailles';
  if (t.includes('land')) return 'Terrains';
  if (t.includes('artifact')) return 'Artefacts';
  if (t.includes('enchantment')) return 'Enchantements';
  if (t.includes('instant')) return 'Éphémères';
  if (t.includes('sorcery')) return 'Rituels';
  return 'Autres';
}
const isLand = i => i.s === 'basic' || (i.tl ? typeBucket(i.tl) === 'Terrains' : false);
const byName = (a, b) => (a.dn || a.n).localeCompare(b.dn || b.n, 'fr', { sensitivity: 'base' });      // dn : nom affiché si différent de n (carte française)
const byCmcName = (a, b) => ((a.cm ?? 99) - (b.cm ?? 99)) || byName(a, b);
const sumGroup = items => ({ count: items.reduce((a, i) => a + i.q, 0), cost: items.reduce((a, i) => a + (i.c || 0), 0) });
/**
 * Regroupe les cartes pour le viewer. sort : 'mana' (colonnes par coût converti, terrains à part) · 'price' (du plus cher au moins cher) · 'type'.
 * ref : relevé de référence (valeur estimée, pas d'offres) : « Sans prix » au lieu de « Sans offre ». sb : carte de la réserve, groupe « Réserve » avant « Introuvables », toujours en fin de liste. Retourne [{ id, label, items, count, cost }] — les groupes vides n'existent pas.
 */
function groupSnap(items, sort, ref) {
  const list = items.filter(i => !i.sb), side = items.filter(i => i.sb), out = [];
  const add = (id, label, arr) => { if (arr.length) out.push({ id, label, items: arr, ...sumGroup(arr) }); };
  const nf = list.filter(i => i.s === 'nf').sort(byName), rest = list.filter(i => i.s !== 'nf');
  if (sort === 'price') {
    const priced = rest.filter(i => i.s === 'ok').sort((a, b) => (b.c - a.c) || byName(a, b));
    add('p', 'Du plus cher au moins cher', priced);
    add('own', 'Dans ta collection', rest.filter(i => i.s === 'own').sort(byName));
    add('np', ref ? 'Sans prix' : 'Sans offre', rest.filter(i => i.s === 'none' || i.s === 'nohub').sort(byName));
    add('b', 'Terrains de base', rest.filter(i => i.s === 'basic').sort(byName));
  } else if (sort === 'type') {
    const by = new Map(TYPE_ORDER.map(t => [t, []]));
    for (const i of rest) by.get(i.s === 'basic' ? 'Terrains' : typeBucket(i.tl)).push(i);
    for (const t of TYPE_ORDER) add('t-' + t, t, by.get(t).sort((a, b) => (a.s === 'basic') - (b.s === 'basic') || byCmcName(a, b)));
  } else {
    const nonLand = rest.filter(i => !isLand(i)), lands = rest.filter(isLand);
    for (let m = 0; m <= 7; m++) add('m' + m, m === 7 ? '7 et plus' : String(m), nonLand.filter(i => Math.min(i.cm ?? 0, 7) === m).sort(byName));
    add('land', 'Terrains', lands.sort((a, b) => (a.s === 'basic') - (b.s === 'basic') || byName(a, b)));
  }
  add('sb', 'Réserve', side.sort(byName));        // réserve (Standard) : à part, quel que soit le tri
  add('nf', 'Introuvables', nf);
  return out;
}
/** Courbe de mana : nombre d'exemplaires par coût (0 à 7+), hors terrains. */
function curveOf(items) {
  const c = new Array(8).fill(0);
  for (const i of items) if (i.s !== 'nf' && !isLand(i)) c[Math.min(i.cm ?? 0, 7)] += i.q;
  return c;
}
/** Fraîcheur d'un relevé : 'fresh' (< 24 h) ou 'old'. */
const snapAge = (snap, now) => ((now || Date.now()) - snap.at >= 24 * 3600e3 ? 'old' : 'fresh');

/** Document deck propre (même forme en local et dans Firestore). */
function deckDoc(x, now) {
  now = Number.isFinite(now) ? now : Date.now();
  const text = String(x.text || '').slice(0, TEXT_MAX);
  const name = String(x.name || '').trim().slice(0, NAME_MAX) || suggestName(text);
  const cards = parseDeck(text).cards.length;
  const history = (Array.isArray(x.history) ? x.history : []).filter(e => e && Number.isFinite(e.at) && Number.isFinite(e.total)).slice(-HISTORY_MAX)
    .map(e => ({ at: e.at, total: Math.round(e.total), mode: OPT_MODE.includes(e.mode) ? e.mode : 'zero', found: Math.max(0, e.found | 0), count: Math.max(0, e.count | 0), sig: typeof e.sig === 'string' ? e.sig.slice(0, 40) : '' }));
  const out = { name, text, opts: sanitizeOpts(x.opts), cards, history, createdAt: Number.isFinite(x.createdAt) ? x.createdAt : now, updatedAt: now };
  const snap = sanitizeSnap(x.snap); if (snap) out.snap = snap;          // prix gardés carte par carte (viewer) : absent tant qu'aucune recherche n'a été enregistrée
  return out;
}

/** Lecture tolérante d'un document venu du stockage (local ou cloud). */
function readDeck(id, d) {
  d = d || {};
  const n = (v, f) => Number.isFinite(v) ? v : f;
  const out = deckDoc({ name: d.name, text: d.text, opts: d.opts, history: d.history, snap: d.snap, createdAt: n(d.createdAt, 0) }, n(d.updatedAt, 0));
  out.id = String(id); return out;
}

/** « à l'instant », « il y a 3 h », « hier », « 12 sept. » */
function relTime(ts, now) {
  now = now || Date.now();
  const s = Math.round((now - ts) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 45) return 'à l\'instant';
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 7 * 86400) return rtf.format(-Math.round(s / 86400), 'day');
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Ancienneté d'une date 'AAAA-MM-JJ' en mots : « aujourd'hui », « hier », « il y a 5 jours », « il y a 3 semaines », « il y a 2 mois », « il y a 1 an » ('' si illisible). */
function agoDay(day, now) {
  const t = Date.parse(String(day || '') + 'T12:00:00Z'); if (!Number.isFinite(t)) return '';
  const d = Math.max(0, Math.floor(((now || Date.now()) - t) / 86400000));
  if (d < 1) return 'aujourd\'hui'; if (d < 2) return 'hier'; if (d < 14) return 'il y a ' + d + ' jours';
  if (d < 60) return 'il y a ' + Math.floor(d / 7) + ' semaines';
  if (d < 365) return 'il y a ' + Math.floor(d / 30.44) + ' mois';
  const y = Math.floor(d / 365.25); return 'il y a ' + y + ' an' + (y > 1 ? 's' : '');
}

/** Identifiant de document : valable pour Firestore, sans dépendre d'une API. */
function newDeckId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let out = '';
  try { const b = new Uint8Array(20); crypto.getRandomValues(b); for (const x of b) out += a[x % a.length]; }
  catch (e) { for (let i = 0; i < 20; i++) out += a[Math.floor(Math.random() * a.length)]; }
  return out;
}

/* Export Node pour les tests. */
/* ── Langue des offres, repli anglais, récapitulatif ──────────────────────────────────────── */
/** Offres dans la langue demandée s'il y en a, sinon toutes (repli). Évite qu'une offre EN moins chère masque une offre FR. */
function preferLang(list, lang) { const w = list.filter(o => o.lang === lang); return w.length ? w : list; }

/**
 * Remplace une ligne de panier devenue indisponible : offres de remplacement qui couvrent `need` exemplaires, au moindre coût.
 * offers : offres déjà filtrées par l'appelant (critères, langue, mode, hors offres écartées).
 * opts : {mode, prefer:Set<sellerId> (vendeurs déjà dans le panier : en Direct, le port est déjà payé), ship:centimes}
 * Retourne [{offer, n}] ; la somme des n peut être inférieure à `need` si le stock manque.
 */
function replaceParts(offers, need, opts = {}) {
  const mode = opts.mode === 'direct' ? 'direct' : 'zero', ship = mode === 'direct' ? (opts.ship || 0) : 0, prefer = opts.prefer || new Set();
  const pool = offers.filter(o => o && o.qty > 0 && o.price > 0 && (mode !== 'zero' || o.hub));
  const eff = o => o.price + (ship && !prefer.has(o.sellerId) ? ship / Math.max(1, Math.min(need, o.qty)) : 0);  // nouveau vendeur = un port de plus, réparti sur ses exemplaires
  pool.sort((a, b) => (eff(a) - eff(b)) || byPrice(a, b));
  return allocate(pool, need, null).parts;
}

/** Offres exploitables dans un mode : Zero = vendeurs « hub » seulement ; langue demandée prioritaire (sauf choix manuel `keepAll`). */
function forMode(list, mode, lang, keepAll) {
  const l = mode === 'zero' ? list.filter(o => o.hub) : list;
  return keepAll ? l : preferLang(l, lang);
}

/** La carte a-t-elle au moins une offre utilisable dans ce mode, dans la langue demandée ? (sinon : repli anglais utile) */
function needsEnglish(offers, opts) {
  return !offers.some(o => passes(o, opts) && (opts.mode !== 'zero' || o.hub) && o.lang === opts.lang);
}

/**
 * Récapitulatif d'un résultat.
 * items : [{state:'ok'|'none'|'nohub'|'notfound'|'loading', qty, short, parts:[{lang, n}]}]
 * → {total, found, copies, byLang:{lang:{cards, copies}}, none, nohub, notfound, partial, loading}
 */
function recapOf(items) {
  const r = { total: items.length, found: 0, copies: 0, byLang: {}, none: 0, nohub: 0, notfound: 0, partial: 0, loading: 0 };
  for (const it of items) {
    if (it.state === 'ok') {
      r.found++;
      if (it.short > 0) r.partial++;
      const parts = it.parts || [];
      for (const p of parts) { r.copies += p.n; const b = r.byLang[p.lang || '?'] || (r.byLang[p.lang || '?'] = { cards: 0, copies: 0 }); b.copies += p.n; }
      const top = (parts[0] && parts[0].lang) || '?';
      (r.byLang[top] || (r.byLang[top] = { cards: 0, copies: 0 })).cards++;
    } else if (it.state === 'none') r.none++;
    else if (it.state === 'nohub') r.nohub++;
    else if (it.state === 'notfound') r.notfound++;
    else r.loading++;
  }
  return r;
}


/* ── Prix de référence Cardmarket (donnés par Scryfall) ──────────────────────────────────────── */
/** « 1.23 » (euros, texte Scryfall) → 123 centimes ; null si absent ou nul. */
const eurCents = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };
/** Référence la moins chère parmi les impressions (foil ou non) : sert quand l'impression de l'offre n'a pas de prix. */
function minRef(bps, foil) {
  let m = null;
  for (const b of bps || []) { const v = foil ? b.ef : b.eu; if (Number.isFinite(v) && v > 0 && (m == null || v < m)) m = v; }
  return m;
}
/** Prix retenu pour une carte (parts : [{offer, n}]) comparé à la référence Cardmarket. Retourne null sans référence exploitable.
 *  level : good (au plus 5 % au-dessus) · ok · warn (plus de 40 % au-dessus ET au moins 0,30 €). unit/ref : centimes par exemplaire. */
function refInfo(parts, bps) {
  let n = 0, cost = 0, ref = 0;
  for (const p of parts || []) {
    const r = Number.isFinite(p.offer.ref) && p.offer.ref > 0 ? p.offer.ref : minRef(bps, p.offer.foil);
    if (r == null) return null;
    n += p.n; cost += p.offer.price * p.n; ref += r * p.n;
  }
  if (!n || !ref) return null;
  const unit = cost / n, rf = ref / n, diff = unit - rf;
  return { unit: Math.round(unit), ref: Math.round(rf), diff: Math.round(diff), pct: Math.round(diff / rf * 100), level: unit <= rf * 1.05 ? 'good' : (unit > rf * 1.4 && diff >= 30) ? 'warn' : 'ok' };
}
/** Total du relevé face à la référence, sur les cartes qui en ont une : { ref, cost, n, cards }. */
function refTotals(items) {
  let ref = 0, cost = 0, n = 0, cards = 0;
  for (const i of items) {
    if (i.s !== 'ok' || !i.rf || i.c == null) continue;
    const m = Math.max(1, i.q - (i.ow || 0) - (i.sh || 0));
    ref += i.rf * m; cost += i.c; n += m; cards++;
  }
  return { ref, cost, n, cards, pct: ref ? Math.round((cost - ref) / ref * 100) : 0 };
}

/* ── Évolution des prix carte par carte ────────────────────────────────────────────────────── */
/** Prix unitaire (centimes) d'une carte du relevé, ou null. */
const unitOf = i => (i.s === 'ok' && i.c != null ? Math.round(i.c / Math.max(1, i.q - (i.ow || 0) - (i.sh || 0))) : null);
/** Prix unitaires d'un relevé, à garder dans le suivant : { clé: centimes }. */
function pvOf(snap) {
  if (!snap) return null;
  const pv = {}; let n = 0;
  for (const i of snap.items) { const u = unitOf(i); if (u != null && u > 0 && n < SNAP_MAX) { pv[i.k] = u; n++; } }
  return n ? pv : null;
}
/** Variations par rapport au relevé précédent : Map(clé → { unit, prev, diff, tot }) ; tot = écart sur le prix payé pour la quantité demandée. */
function snapDeltas(items, pv) {
  const out = new Map(); if (!pv) return out;
  for (const i of items) {
    const u = unitOf(i), p = pv[i.k];
    if (u != null && Number.isFinite(p) && p !== u) out.set(i.k, { unit: u, prev: p, diff: u - p, tot: (u - p) * Math.max(1, i.q - (i.ow || 0) - (i.sh || 0)) });
  }
  return out;
}
/** Plus fortes variations : { up: [...], down: [...] } (n par sens), triées par écart total. */
function topMovers(items, deltas, n = 3) {
  const by = new Map(items.map(i => [i.k, i])), all = [...deltas].map(([k, d]) => ({ item: by.get(k), ...d })).filter(x => x.item);
  return { up: all.filter(x => x.tot > 0).sort((a, b) => b.tot - a.tot).slice(0, n), down: all.filter(x => x.tot < 0).sort((a, b) => a.tot - b.tot).slice(0, n) };
}

/* ── Commandant ───────────────────────────────────────────────────────────────────────────────── */
/** Cartes sous un en-tête « Commander » de la liste (export Archidekt, MTGO…). Vide si la liste n'en a pas. */
function commanderKeys(text) {
  const out = []; let on = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { on = false; continue; }
    if (/^(commanders?|commandants?)\s*(\(\d+\))?\s*:?\s*$/i.test(line)) { on = true; continue; }
    if (HEADER_RE.test(line)) { on = false; continue; }
    if (on) { const p = parseLine(line); if (p && !p.ignored && !out.includes(p.key)) out.push(p.key); }
  }
  return out;
}
/** Sans en-tête : la première carte de la liste (export EDHREC) est le commandant si elle est légendaire (créature ou planeswalker). */
const canLead = tl => /legendary/i.test(String(tl || '')) && /(creature|planeswalker)/i.test(String(tl || ''));

/* ── Créateur de deck (Standard / Commander) ──────────────────────────────────────────────────── */
const DK_FORMATS = {
  standard: { label: 'Standard', size: 60, copies: 4, side: 15, hint: '60 cartes, 4 exemplaires d\'une même carte au maximum (terrains de base exclus), réserve de 15 facultative.' },
  commander: { label: 'Commander', size: 100, copies: 1, side: 0, hint: '100 cartes dont ton commandant, un seul exemplaire de chaque carte (terrains de base exclus).' },
};
/** Format noté en tête d'une liste par le créateur (« // Deck Deal : commander »), '' sinon. */
function dkFormat(text) { const m = String(text || '').match(/^\/\/\s*Deck Deal\s*:\s*(standard|commander)\b/im); return m ? m[1].toLowerCase() : ''; }
/** Format d'un deck : celui noté par le créateur, sinon « commander » si la liste a un en-tête Commander, sinon ''. */
const dkFmtOf = text => dkFormat(text) || (commanderKeys(text).length ? 'commander' : '');
/** Un deck passe-t-il le filtre de l'écran « Mes decks » ? f = { fmt ('' = tous | 'commander' | 'standard'), colors (« WU » : le deck doit avoir toutes ces couleurs, d'après ses terrains de base) }. */
function dkMatch(text, f) {
  const fmt = f && f.fmt, colors = (f && f.colors) || '';
  if (fmt && dkFmtOf(text) !== fmt) return false;
  if (colors) { const have = dkColors(text); for (const c of colors) if (!have.includes(c)) return false; }
  return true;
}
/** Lignes « SB: 2 Negate » d'une liste : [{ key, name, qty }] (réserve, additionnée par carte). Le reste de la liste ne les voit pas (parseLine les ignore). */
function dkSideCards(text) {
  const out = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.trim().match(/^SB:\s*(.+)$/i); if (!m) continue;
    const p = parseLine(m[1]); if (!p || p.ignored) continue;
    const k = ownKey(p.name), cur = out.get(k); if (cur) cur.qty += p.qty; else out.set(k, { key: k, name: p.name, qty: p.qty });
  }
  return [...out.values()];
}
/* Carte de présentation d'un deck (liste des decks) : ligne de commentaire « // Deck Deal cover : Sol Ring » dans le texte, donc synchronisée avec lui sans champ de plus. */
const COVER_LINE = '// Deck Deal cover : ', COVER_RE = /^\s*\/\/\s*Deck Deal cover\s*:\s*(.*?)\s*$/i;
function dkCover(text) { for (const l of String(text || '').split(/\r?\n/)) { const m = l.match(COVER_RE); if (m && m[1]) return m[1]; } return ''; }
/** Texte avec cette carte de présentation (juste après la ligne de format) ; name vide : la retire. */
function dkSetCover(text, name) {
  const lines = String(text || '').split(/\r?\n/).filter(l => !COVER_RE.test(l)), n = String(name || '').trim();
  if (n) { const at = lines.findIndex(l => /^\s*\/\/\s*Deck Deal\s*:/i.test(l)); lines.splice(at >= 0 ? at + 1 : 0, 0, COVER_LINE + n); }
  return lines.join('\n');
}
/** Carte qui illustre un deck : { key, name, auto } — celle choisie (si elle y est encore), sinon le commandant, sinon la carte la plus chère hors terrains (metaOf(clé) → { eu, tl }), sinon la première. null : deck vide. */
function dkCoverCard(text, metaOf) {
  const pd = parseDeck(text), pool = [...pd.cards, ...dkSideCards(text)];
  if (!pool.length) return null;
  const pick = (c, auto) => ({ key: ownKey(c.key), name: c.name, auto });
  const want = ownKey(dkCover(text));
  if (want) { const c = pool.find(x => ownKey(x.key) === want); if (c) return pick(c, false); }
  const cmd = commanderKeys(text).map(k => pd.cards.find(c => c.key === k)).find(Boolean); if (cmd) return pick(cmd, true);
  let best = null, bp = -1, any = null, ap = -1;
  for (const c of pd.cards) {
    const m = metaOf(ownKey(c.key)), eu = m && Number.isFinite(m.eu) ? m.eu : -1;
    if (eu > ap) { any = c; ap = eu; }
    if (eu > bp && !(m && /\bland\b/i.test(m.tl || ''))) { best = c; bp = eu; }
  }
  return pick(best || any || pd.cards[0] || pool[0], true);
}
/** Liste du créateur → texte : { fmt, main:[{ name, qty }], side:[{ name, qty }], cmdr:[{ name }], cover (nom de la carte de présentation, facultatif) }.
 *  Même syntaxe que les exports du marché (en-tête « Commander », lignes « SB: ») : le reste de l'app la lit sans rien savoir du créateur. */
function dkBuildText({ fmt, main, side, cmdr, cover }) {
  const out = ['// Deck Deal : ' + (fmt === 'commander' ? 'commander' : 'standard')];
  if (cover) out.push(COVER_LINE + cover);
  if (fmt === 'commander' && cmdr && cmdr.length) { out.push('Commander'); cmdr.forEach(c => out.push('1 ' + c.name)); out.push(''); }
  out.push('Deck');
  (main || []).forEach(c => out.push(c.qty + ' ' + c.name));
  if (fmt !== 'commander' && side && side.length) { out.push(''); side.forEach(c => out.push('SB: ' + c.qty + ' ' + c.name)); }
  return out.join('\n');
}
/** Texte → { fmt ('' si inconnu), main, side, cmdr } : cartes dans l'ordre de la liste, doublons additionnés, clé = clé de collection (face avant).
 *  Lit aussi les listes venues d'ailleurs : en-têtes « Commander » / « Sideboard », lignes « SB: », sections (Creatures, Lands…) ; « Maybeboard » est laissé de côté. */
function dkParse(text) {
  const main = new Map(), side = new Map(), cmdr = [];
  let sec = 'main';
  const add = (m, p) => { const k = ownKey(p.name), cur = m.get(k); if (cur) cur.qty += p.qty; else m.set(k, { key: k, name: p.name, qty: p.qty }); };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { if (sec === 'cmdr') sec = 'main'; continue; }
    if (/^(\/\/|#)/.test(line)) continue;
    const sb = line.match(/^SB:\s*(.+)$/i);
    if (sb) { const p = parseLine(sb[1]); if (p && !p.ignored) add(side, p); continue; }
    if (HEADER_RE.test(line)) {
      sec = /^(commanders?|commandants?)\b/i.test(line) ? 'cmdr' : /^(sideboard|companion)\b/i.test(line) ? 'side' : /^(maybeboard|considering)\b/i.test(line) ? 'skip' : 'main';
      continue;
    }
    const p = parseLine(line); if (!p || p.ignored || sec === 'skip') continue;
    if (sec === 'cmdr') { const k = ownKey(p.name); if (!cmdr.some(c => c.key === k)) cmdr.push({ key: k, name: p.name }); }
    else add(sec === 'side' ? side : main, p);
  }
  return { fmt: dkFormat(text), main: [...main.values()], side: [...side.values()], cmdr, cover: dkCover(text) };
}
/** Valeur estimée d'un deck : prix tendance Cardmarket (centimes) × exemplaires de chaque carte du deck, terrains de base et réserve exclus, cartes possédées comprises.
 *  metaOf(clé) → infos de la carte { eu } ; null/undefined = pas encore lue (à chercher : « missing »). → { cents, known (cartes chiffrées), total (cartes différentes), missing: [{ key, name }], noPrice (lues mais sans prix) } */
function dkValue(text, metaOf) {
  let cents = 0, known = 0, noPrice = 0; const missing = [], cards = parseDeck(text).cards;
  for (const c of cards) {
    const k = ownKey(c.key), m = metaOf(k);
    if (!m) missing.push({ key: k, name: c.name }); else if (Number.isFinite(m.eu)) { cents += m.eu * c.qty; known++; } else noPrice++;
  }
  return { cents: Math.round(cents), known, total: cards.length, missing, noPrice };
}
/** Couleurs d'un deck d'après ses terrains de base (« WUBRG », dans cet ordre ; Wastes ignorés) : '' si le deck n'en a pas. */
function dkColors(text) {
  const have = new Set(), by = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
  for (const b of parseDeck(text).basics) { const c = by[b.key.replace(/^snow covered /, '')]; if (c && b.qty > 0) have.add(c); }
  return [...'WUBRG'].filter(c => have.has(c)).join('');
}
/** Vérifie un deck du créateur. d = { main, side, cmdr } (comme dkParse) ; metaOf(clé) → { ci } ou null (identité de couleur, si connue).
 *  Retourne { n (cartes du deck, commandant compris), side, size, issues: [{ lv: 'bad'|'warn', t }] } : « bad » = règle enfreinte, « warn » = deck pas fini. */
function dkCheck(fmt, d, metaOf) {
  const f = DK_FORMATS[fmt] || DK_FORMATS.standard, main = d.main || [], side = d.side || [], cmdr = d.cmdr || [], issues = [];
  const sum = a => a.reduce((x, c) => x + c.qty, 0), n = sum(main) + cmdr.length, ns = sum(side);
  const plural = (q, w) => q + ' ' + w + (q > 1 ? 's' : '');
  if (fmt === 'commander') {
    if (!cmdr.length) issues.push({ lv: 'bad', t: 'Aucun commandant : choisis-en un.' });
    else if (cmdr.length > 2) issues.push({ lv: 'bad', t: 'Deux commandants au maximum (partenaires).' });
    if (n < f.size) issues.push({ lv: 'warn', t: `Il manque ${plural(f.size - n, 'carte')} pour arriver à ${f.size}.` });
    else if (n > f.size) issues.push({ lv: 'bad', t: `${plural(n - f.size, 'carte')} en trop (${f.size} exactement).` });
    for (const c of main) {
      if (BASIC_NAMES.has(c.key)) continue;
      if (c.qty > 1) issues.push({ lv: 'bad', t: `${c.name} : ${c.qty} exemplaires (un seul en Commander).` });
      if (cmdr.some(x => x.key === c.key)) issues.push({ lv: 'bad', t: `${c.name} est déjà ton commandant.` });
    }
    for (const c of cmdr) { const m = metaOf && metaOf(c.key); if (m && m.cd === 0) issues.push({ lv: 'warn', t: `${c.name} ne peut normalement pas être commandant.` }); }      // cd : 0 = carte lue sur Scryfall et non éligible (absent = pas encore lue)
    const ci = new Set(); let known = cmdr.length > 0;
    for (const c of cmdr) { const m = metaOf && metaOf(c.key); if (m && typeof m.ci === 'string') for (const x of m.ci) ci.add(x); else known = false; }
    if (known) for (const c of main) { const m = metaOf(c.key); if (m && typeof m.ci === 'string' && [...m.ci].some(x => !ci.has(x))) issues.push({ lv: 'warn', t: `${c.name} sort de l'identité de couleur du commandant.` }); }
  } else {
    if (n < f.size) issues.push({ lv: 'warn', t: `Il manque ${plural(f.size - n, 'carte')} (${f.size} minimum).` });
    if (ns > f.side) issues.push({ lv: 'bad', t: `Réserve de ${ns} cartes (${f.side} au maximum).` });
    const tot = new Map(), nm = new Map();
    for (const c of [...main, ...side]) { if (BASIC_NAMES.has(c.key)) continue; tot.set(c.key, (tot.get(c.key) || 0) + c.qty); nm.set(c.key, c.name); }
    for (const [k, q] of tot) if (q > f.copies) issues.push({ lv: 'bad', t: `${nm.get(k)} : ${q} exemplaires (${f.copies} au maximum).` });
  }
  return { n, side: ns, size: f.size, issues };
}

/* ── Collection : lecture CSV / texte, cartes possédées ──────────────────────────────────────── */
/** Clé d'une carte pour la collection : nom de la première face, normalisé (« Fire // Ice » et « Fire » se rejoignent). */
const ownKey = name => frontName(name);
const COLL_MAX = 20000;

function csvSplit(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out.map(x => x.trim());
}
const NAME_COLS = ['name', 'card name', 'card', 'cardname', 'nom', 'nom de la carte', 'carte'];
const LANG_COLS = ['language', 'langue', 'lang', 'card language'];
const QTY_COLS = ['quantity', 'qty', 'count', 'amount', 'quantite', 'reg qty', 'total qty', 'owned'];
const colNorm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Repère de date d'ajout dans le texte de la collection : « 3 Sol Ring (Dh7zqkx) *FR* », secondes en base 36. Une ligne que l'ancienne version lit encore : elle y voit un code d'extension et l'ignore. */
const DATE_MARK_RE = /\s+\(D([0-9a-z]{5,7})\)(?=(?:\s+\*[A-Za-z]+(?:-[A-Za-z]+)?\*)?\s*$)/;
const dateNowSec = () => Math.floor(Date.now() / 1000);
/* ── Une carte, plusieurs langues : entrée { n, q (total), l (langue la plus fournie), x? { langue: exemplaires } (seulement avec plusieurs langues), d? } ───
   Chaque langue est une « ligne » (« 2 Sol Ring *FR* » + « 1 Sol Ring *EN* » dans le texte) ; la langue '' = non précisée. Les totaux (q) servent partout ailleurs (decks, paniers, valeur). */
const LINE_RANK = ['fr', 'en', 'de', 'es', 'it', 'pt', 'jp', 'zh-CN', ''];
const lineRank = l => { const i = LINE_RANK.indexOf(l || ''); return i < 0 ? LINE_RANK.length : i; };
/** Lignes d'une entrée : [[langue, exemplaires]] dans l'ordre d'affichage (fr, en, autres, non précisée) ; toujours au moins une ligne si la carte existe. */
function collLines(x) {
  if (!x || !(x.q > 0)) return [];
  const ls = x.x ? Object.entries(x.x).filter(e => e[1] > 0) : [[x.l || '', x.q]];
  return ls.sort((a, b) => lineRank(a[0]) - lineRank(b[0]));
}
/** Langue la plus fournie d'une liste de lignes ('' si c'est la non précisée) ; à égalité la première dans l'ordre d'affichage. */
const collDomLang = lines => { let d = null; for (const e of lines) if (!d || e[1] > d[1]) d = e; return d ? d[0] : ''; };
/** Entrée reconstruite depuis ses lignes (base : n, d… gardés) : q = total, x seulement avec plusieurs langues, l = langue la plus fournie. null s'il ne reste rien. */
function collFromLines(base, lines) {
  const m = new Map();
  for (const [l, q] of lines) if (q > 0) m.set(l || '', Math.min(9999, (m.get(l || '') || 0) + q));
  if (!m.size) return null;
  const ls = [...m].sort((a, b) => lineRank(a[0]) - lineRank(b[0])), out = { ...base }; delete out.x; delete out.l;
  out.q = ls.reduce((a, e) => a + e[1], 0);
  const dom = collDomLang(ls); if (dom) out.l = dom;
  if (ls.length > 1) out.x = Object.fromEntries(ls);
  return out;
}
/** Union de deux répartitions de la même carte sans état commun connu : plus grande quantité par langue précisée ; les exemplaires « non précisée » ne s'ajoutent pas à une langue connue de l'autre côté (c'est probablement la même carte). */
function unionLines(la, lb) {
  const m = new Map(); let ta = 0, tb = 0;
  for (const [g, q] of la) { ta += q; if (g) m.set(g, q); }
  for (const [g, q] of lb) { tb += q; if (g) m.set(g, Math.max(m.get(g) || 0, q)); }
  const spec = [...m.values()].reduce((a, q) => a + q, 0), none = Math.max(0, Math.max(ta, tb) - spec);
  return [...m, ...(none ? [['', none]] : [])];
}
/** Empreinte des lignes d'une entrée (comparaison, fusion). */
const collSig = x => collLines(x).map(e => e[0] + ':' + e[1]).join(',');

/**
 * Lit une collection : export CSV (ManaBox, Moxfield, Archidekt, Deckbox, Dragon Shield, TCGplayer…) ou texte « 3 Sol Ring ».
 * Retourne { items:[{k, n, q, l?, d?}] (l : langue si le fichier la donne : colonne « Language », ou « *FR* » en fin de ligne ; d : date d'ajout en secondes, seulement avec o.dates : repère « (Dxxxxxx) » écrit par collToText), lines, skipped, format:'csv'|'text', copies }. Les quantités d'une même carte (impressions différentes) s'additionnent.
 */
function parseCollection(text, o) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  let i0 = 0; while (i0 < lines.length && (!lines[i0].trim() || /^sep=.$/i.test(lines[i0].trim()))) i0++;
  const first = lines[i0] || '';
  let delim = null, nameCol = -1, qtyCol = -1, langCol = -1;
  for (const d of [',', ';', '\t']) {
    const cols = csvSplit(first, d).map(colNorm);
    if (cols.length < 2) continue;
    const ni = cols.findIndex(c => NAME_COLS.includes(c));
    if (ni < 0) continue;
    delim = d; nameCol = ni; langCol = cols.findIndex(c => LANG_COLS.includes(c));
    for (const want of QTY_COLS) { const qi = cols.findIndex(c => c === want); if (qi >= 0) { qtyCol = qi; break; } }
    if (qtyCol < 0) qtyCol = cols.findIndex(c => /(quantity|qty|count)/.test(c) && !/(trade|tradelist|wish)/.test(c));
    break;
  }
  const map = new Map(); let n = 0, skipped = 0;
  const add = (name, q, l, d) => {
    name = String(name || '').trim(); q = Math.max(1, Math.min(9999, Math.round(q) || 1));
    const k = ownKey(name); if (!name || !k) { skipped++; return; }
    const cur = map.get(k), lg = l || ''; if (cur) { cur.b.set(lg, Math.min(9999, (cur.b.get(lg) || 0) + q)); if (d && !(cur.d <= d)) cur.d = d; } else if (map.size < COLL_MAX) map.set(k, { k, n: name, b: new Map([[lg, q]]), ...(d ? { d } : {}) });      // une ligne par langue
  };
  if (delim) {
    for (let i = i0 + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue; n++;
      const c = csvSplit(lines[i], delim), name = c[nameCol];
      if (!name) { skipped++; continue; }
      add(name, qtyCol >= 0 ? parseInt(c[qtyCol], 10) || 1 : 1, langCol >= 0 ? cardLang(c[langCol]) : '');
    }
  } else {
    for (let raw of lines) {
      let d = 0;
      if (o && o.dates) raw = raw.replace(DATE_MARK_RE, (_, t) => { d = parseInt(t, 36) || 0; return ''; });
      const p = parseLine(raw); if (!p) continue; n++;
      if (p.ignored) { skipped++; continue; }
      add(p.name, p.qty, p.lang, d);
    }
  }
  const items = [...map.values()].map(({ b, ...base }) => collFromLines(base, [...b]));
  return { items, lines: n, skipped, format: delim ? 'csv' : 'text', copies: items.reduce((a, x) => a + x.q, 0) };
}

/** Fusionne des cartes dans une collection (objet clé → { n, q, … }). mode : 'add' (somme) · 'replace' (remplace le reste, garde les infos Scryfall déjà lues). Retourne la nouvelle collection. */
function mergeColl(base, add, mode, now) {
  const out = mode === 'replace' ? {} : { ...base }, t = now || dateNowSec();
  for (const it of add) {
    const prev = base[it.k], cur = out[it.k], lines = collLines(cur).map(e => e.slice()), dom = collDomLang(lines);
    for (const [l, q] of collLines(it)) {
      const lang = l || dom;      // sans langue précisée, les exemplaires rejoignent la langue déjà connue de la carte ; une langue lue (scan, CSV) a sa propre ligne
      const e = lines.find(x => x[0] === lang); if (e) e[1] = Math.min(9999, e[1] + q); else lines.push([lang, q]);
    }
    out[it.k] = collFromLines({ ...(prev || {}), n: (prev && prev.n) || it.n, ...(!prev && (it.d || t) ? { d: it.d || t } : {}) }, lines);       // date d'ajout : posée à la première entrée de la carte, jamais modifiée ensuite (une carte retirée puis ré-ajoutée en reçoit une nouvelle)
  }
  return out;
}
/** Texte compact d'une collection (une carte par ligne, « 3 Sol Ring ») pour le cloud, et son inverse. dates : ajoute la date d'ajout « (Dxxxxxx) » (stockage et compte ; pas l'export). */
const collToText = (coll, dates) => Object.values(coll).filter(x => x && x.q > 0 && x.n).sort((a, b) => a.n.localeCompare(b.n, 'en')).flatMap(x => collLines(x).map(([l, q]) => q + ' ' + x.n + (dates && x.d > 0 ? ' (D' + Math.floor(x.d).toString(36) + ')' : '') + (l ? ' *' + langCode(l) + '*' : ''))).join('\n');
const collFromText = text => { const o = {}; for (const it of parseCollection(text, { dates: true }).items) o[it.k] = { n: it.n, q: it.q, ...(it.l ? { l: it.l } : {}), ...(it.x ? { x: it.x } : {}), ...(it.d ? { d: it.d } : {}) }; return o; };

/** Même carte au même état (quantité, langue) ? Deux absences sont identiques. */
const sameEntry = (a, b) => (!a && !b) || (!!a && !!b && collSig(a) === collSig(b));
/**
 * Fusion à trois : base (dernier état connu du compte), local (cet appareil), remote (compte maintenant). Carte par carte, sans horloge :
 * · rien de changé ici depuis la base → on prend le compte (ajouts, retraits et quantités de l'autre appareil) ;
 * · changé seulement ici → on garde ici ;
 * · changé pareil des deux côtés → cette valeur (rejouer une fusion ne double rien) ;
 * · changé différemment : une modification l'emporte sur un retrait ; deux modifications de quantité s'additionnent (compte + ce qui a bougé ici), langue d'ici si elle a changé ; sans base, la plus grande quantité.
 * Retourne une nouvelle collection (clé → { n, q, l? }).
 */
function merge3(base, local, remote) {
  const out = {}, b0 = base || {}, l0 = local || {}, r0 = remote || {};
  for (const k of new Set([...Object.keys(l0), ...Object.keys(r0)])) {
    const b = b0[k], l = l0[k], r = r0[k];
    let v;
    if (sameEntry(l, b)) v = r;
    else if (sameEntry(r, b)) v = l;
    else if (sameEntry(l, r)) v = l;
    else if (!l) v = r;
    else if (!r) v = l;
    else {      // changé des deux côtés : ligne par ligne (une langue = une ligne) ; deux changements de quantité d'une même ligne s'additionnent
      const B = new Map(collLines(b)), L = new Map(collLines(l)), R = new Map(collLines(r)); let lines = [];
      if (!b) lines = unionLines(collLines(l), collLines(r));      // première connexion : pas d'état commun
      else for (const g of new Set([...B.keys(), ...L.keys(), ...R.keys()])) {
        const bq = B.get(g) || 0, lq = L.get(g) || 0, rq = R.get(g) || 0;
        lines.push([g, lq === rq ? lq : Math.max(0, rq + (lq - bq))]);
      }
      v = collFromLines({ ...r, ...l, n: l.n || r.n }, lines) || undefined;
    }
    if (v && v.q > 0) {
      out[k] = { ...v };
      const ds = [l, r, b].map(x => x && x.d).filter(d => d > 0);      // la date d'ajout survit à un appareil qui ne la connaît pas (ancienne version) : la plus ancienne connue
      if (ds.length) out[k].d = Math.min(...ds);
    }
  }
  return out;
}
/** Union de deux collections (première connexion : appareil + compte) : pour chaque carte, la plus grande quantité. */
function unionColl(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    const cur = out[k]; if (!cur) { out[k] = { ...v }; continue; }
    out[k] = collFromLines({ ...v, ...cur }, unionLines(collLines(cur), collLines(v)));      // langue par langue : la plus grande quantité
  }
  return out;
}
/** Deux collections contiennent-elles la même chose (clés, quantités, langues) ? */
function sameColl(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!b[k] || collSig(b[k]) !== collSig(a[k])) return false;
  return true;
}

/** Pose sur chaque carte de la liste : own (déjà possédées, au plus la quantité demandée) et need (à acheter). owned : clé de carte → exemplaires, ou null. */
function applyOwned(cards, owned) {
  for (const c of cards) {
    const o = owned ? Math.max(0, Math.floor(Number(owned(ownKey(c.key))) || 0)) : 0;
    c.own = Math.min(o, c.qty); c.need = c.qty - c.own;
  }
  return cards;
}

/* ── Filtres : recherche texte, couleurs, famille, coût (viewer du deck et collection) ───────── */
const BASIC_COLOR = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
/** Couleurs d'une carte du viewer (« WU »), '' si incolore ; les terrains de base ont la couleur de leur mana. */
const itemColors = i => (i.s === 'basic' ? BASIC_COLOR[String(i.k).replace(/^snow covered /, '')] || '' : i.cl || '');
const itemType = i => (i.s === 'basic' ? 'Terrains' : typeBucket(i.tl));
const hasMeta = i => i.s === 'basic' || i.tl != null || i.cm != null;
/** f : { q:texte, colors:Set('W','U',… ,'C'), type:'Créatures'…, cmc:0..7 (7 = 7 et plus) } — champ absent ou vide = pas de filtre. */
function filterItems(items, f) {
  if (!f) return items;
  const q = normPart(f.q || ''), colors = f.colors && f.colors.size ? f.colors : null, type = f.type || '', cmc = f.cmc === '' || f.cmc == null ? null : Number(f.cmc), cmdr = f.cmdr === 'can' || f.cmdr === 'played' ? f.cmdr : '';
  if (!q && !colors && !type && cmc == null && !cmdr) return items;
  return items.filter(i => {
    if (q && !normPart(i.n).includes(q) && !(i.dn && normPart(i.dn).includes(q)) && !(i.fn && normPart(i.fn).includes(q))) return false;      // nom anglais, nom affiché (FR) ou nom français de la carte même si l'exemplaire est anglais
    if (cmdr && (i.cx || 0) < (cmdr === 'played' ? 2 : 1)) return false;      // cx : 0 pas commandant · 1 peut l'être · 2 joué comme commandant (EDHREC)
    if (colors || type || cmc != null) {
      if (!hasMeta(i)) return false;
      if (colors) { const c = itemColors(i); if (c ? ![...c].some(x => colors.has(x)) : !colors.has('C')) return false; }
      if (type && itemType(i) !== type) return false;
      if (cmc != null && Math.min(i.cm ?? 0, 7) !== cmc) return false;
    }
    return true;
  });
}
const filterActive = f => !!f && !!((f.q || '').trim() || (f.colors && f.colors.size) || f.type || (f.cmc !== '' && f.cmc != null) || f.cmdr);

/* ── Valeur de la collection dans le temps : relevés quotidiens, variations de prix carte par carte ─────────────── */
const VAL_MAX = 400;
const dayOf = t => Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 86400000);     // jour calendaire local
/** Ajoute un relevé { t, v (centimes), n (cartes), q (exemplaires) } : un seul par jour (le dernier remplace), trié, VAL_MAX au plus (les plus anciens partent). */
function histPush(hist, snap, max = VAL_MAX) {
  const out = (Array.isArray(hist) ? hist : []).filter(h => h && Number.isFinite(h.t) && Number.isFinite(h.v) && dayOf(h.t) !== dayOf(snap.t));
  out.push({ t: snap.t, v: Math.round(snap.v), n: snap.n | 0, q: snap.q | 0 });
  out.sort((a, b) => a.t - b.t);
  return out.length > max ? out.slice(out.length - max) : out;
}
/** Variation sur ~days jours : le relevé le plus proche de « maintenant − days » (écart toléré 60 % de la durée), jamais le dernier lui-même. { from, to, d, pct } ou null. */
function histDelta(hist, days) {
  if (!hist || hist.length < 2) return null;
  const to = hist[hist.length - 1], target = to.t - days * 86400000;
  let best = null;
  for (const h of hist) { if (h === to || h.t > to.t - days * 86400000 * 0.5) continue; if (!best || Math.abs(h.t - target) < Math.abs(best.t - target)) best = h; }
  if (!best || Math.abs(best.t - target) > days * 86400000 * 0.6) return null;
  return { from: best, to, d: to.v - best.v, pct: best.v > 0 ? (to.v - best.v) / best.v * 100 : null };
}
/** Prix de référence de départ pour les variations : base = { cur: { t, p: {clé: centimes} }, prev } ; la période courante dure 7 jours puis devient « précédente ». Retourne la nouvelle base. */
function baseRoll(base, prices, now, period = 7 * 86400000) {
  const snap = { t: now, p: prices };
  if (!base || !base.cur) return { cur: snap, prev: null };
  if (now - base.cur.t >= period) return { cur: snap, prev: base.cur };
  return base;
}
/** Référence à comparer aux prix actuels : la période précédente si elle existe, sinon la courante. */
const baseRef = base => (base && (base.prev || base.cur)) || null;
/** Cartes dont le prix a bougé depuis ref ({ t, p }) : items = [{ k, n, q, eu }]. thr : seuil en % ; un écart de moins de 20 centimes par exemplaire est ignoré.
 *  → { total (centimes, valeur de la collection actuelle : prix d'aujourd'hui − prix de la référence), list: [{ k, n, q, u0, u1, d (par exemplaire), lot, pct }] triée par |variation du lot|, all: tous les mouvements }. */
function pxMovers(items, ref, thr = 25) {
  const out = { total: 0, list: [], all: 0 };
  if (!ref || !ref.p) return out;
  for (const i of items) {
    const u0 = ref.p[i.k], u1 = i.eu;
    if (!(u0 > 0) || !(u1 > 0)) continue;
    const d = u1 - u0; out.total += d * i.q;
    if (!d) continue; out.all++;
    const pct = d / u0 * 100;
    if (Math.abs(pct) >= thr && Math.abs(d) >= 20) out.list.push({ k: i.k, n: i.n, q: i.q, u0, u1, d, lot: d * i.q, pct });
  }
  out.list.sort((a, b) => Math.abs(b.lot) - Math.abs(a.lot) || a.n.localeCompare(b.n));
  return out;
}

/* ── Achats (« J'ai acheté »), cartes engagées dans des decks, fusion des données annexes du compte ──────────────── */
const BUY_MAX = 800;
/** Panier en attente de validation : { at, items:[{k, n, q, l?}] } (k : clé de collection). added : cartes qui viennent d'être mises au panier CardTrader ({ n, q, l? }) ; replace : le panier avait été vidé avant, on repart de zéro. null si rien. */
function buyMerge(cart, added, replace, now) {
  const by = new Map();
  if (cart && !replace) for (const it of cart.items || []) if (it && it.k && it.q > 0) by.set(it.k, { ...it });
  for (const a of added || []) {
    const name = String((a && a.n) || '').trim(), k = ownKey(name), q = Math.floor(Number(a && a.q));
    if (!name || !k || !(q > 0)) continue;
    const cur = by.get(k), l = a.l ? cardLang(a.l) : '';
    by.set(k, { k, n: (cur && cur.n) || name, q: Math.min(999, (cur ? cur.q : 0) + q), ...(l ? { l } : cur && cur.l ? { l: cur.l } : {}) });
  }
  const items = [...by.values()].sort((x, y) => x.n.localeCompare(y.n, 'en')).slice(0, BUY_MAX);
  return items.length ? { at: Number.isFinite(now) ? now : Date.now(), items } : null;
}
/** Lecture tolérante du panier en attente (stockage local) ; null si illisible, vide ou vieux de plus de 30 jours. */
function buyClean(raw, now) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items) || !Number.isFinite(raw.at)) return null;
  if ((Number.isFinite(now) ? now : Date.now()) - raw.at > 30 * 86400000) return null;
  const items = raw.items.filter(i => i && typeof i.n === 'string' && i.n && ownKey(i.n) && i.q > 0).slice(0, BUY_MAX)
    .map(i => ({ k: ownKey(i.n), n: i.n.slice(0, 150), q: Math.min(999, Math.floor(i.q)), ...(cardLang(i.l) ? { l: cardLang(i.l) } : {}) }));
  return items.length ? { at: raw.at, items } : null;
}

const ENG_DECKS_MAX = 80, ENG_CARDS_MAX = 400, ENG_KEEP = 60 * 86400000;
/** Cartes engagées : { [idDeck]: { n: nom du deck, at: ms, q: { cléCarte: exemplaires } } }. q vide = deck démonté (la trace est gardée 60 jours pour que les autres appareils l'apprennent). */
function engClean(raw, now) {
  const out = {}; if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  now = Number.isFinite(now) ? now : Date.now();
  for (const [id, e] of Object.entries(raw)) {
    if (Object.keys(out).length >= ENG_DECKS_MAX) break;
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !e || typeof e !== 'object') continue;
    const at = Number.isFinite(e.at) ? e.at : 0, q = {}; let n = 0;
    for (const [k, v] of Object.entries(e.q && typeof e.q === 'object' && !Array.isArray(e.q) ? e.q : {})) { const c = Math.floor(Number(v)); if (k && k.length <= 120 && c > 0 && n < ENG_CARDS_MAX) { q[k] = Math.min(999, c); n++; } }
    if (!n && now - at > ENG_KEEP) continue;
    out[id] = { n: String(e.n || '').slice(0, 120), at, q };
  }
  return out;
}
/** Exemplaires de la carte k engagés dans les decks, sauf deck exceptId (le deck qu'on est en train de chercher peut utiliser ses propres cartes). */
function engTotal(eng, k, exceptId) {
  let t = 0; if (!eng) return 0;
  for (const id in eng) if (id !== exceptId) t += (eng[id].q && eng[id].q[k]) || 0;
  return t;
}
/** Exemplaires encore libres : possédés − engagés ailleurs. */
const engFree = (owned, eng, k, exceptId) => Math.max(0, (Number(owned) || 0) - engTotal(eng, k, exceptId));
/** Decks qui engagent la carte k : [{ id, n, q }]. */
function engDecksOf(eng, k) { const out = []; for (const id in eng || {}) { const q = (eng[id].q && eng[id].q[k]) || 0; if (q > 0) out.push({ id, n: eng[id].n, q }); } return out; }
/** Deck monté : pour chaque carte du texte (hors terrains de base), les exemplaires possédés, au plus la quantité du deck. ownedOf : clé → exemplaires possédés. */
function engSnapshot(text, ownedOf) {
  const want = new Map();      // clé → exemplaires voulus : deck + réserve (« SB: »), la réserve est dans la boîte du deck aussi
  for (const c of parseDeck(text).cards) { const k = ownKey(c.key); if (k && !BASIC_NAMES.has(k)) want.set(k, (want.get(k) || 0) + c.qty); }
  for (const c of dkSideCards(text)) if (c.key && !BASIC_NAMES.has(c.key)) want.set(c.key, (want.get(c.key) || 0) + c.qty);
  const q = {};
  for (const [k, w] of want) {
    const n = Math.min(w, Math.max(0, Math.floor(Number(ownedOf(k)) || 0)));
    if (n > 0) q[k] = Math.min(999, n);
  }
  return q;
}
/** Fusion de deux états engagés, deck par deck : la trace la plus récente gagne. */
function engMerge(a, b, now) {
  const out = { ...engClean(a, now) }, rb = engClean(b, now);
  for (const id in rb) if (!out[id] || rb[id].at > out[id].at) out[id] = rb[id];
  return engClean(out, now);
}
const engCanon = e => JSON.stringify(Object.keys(e).sort().map(id => [id, e[id].n, e[id].at, Object.keys(e[id].q).sort().map(k => [k, e[id].q[k]])]));
const engSame = (a, b) => engCanon(engClean(a, 0)) === engCanon(engClean(b, 0));
const engActive = eng => Object.entries(eng || {}).filter(([, e]) => e && e.q && Object.keys(e.q).length);

/** Fusion de deux historiques de valeur : un relevé par jour (le plus tardif de la journée l'emporte), les plus anciens partent au-delà de VAL_MAX. */
function histMerge(a, b, max = VAL_MAX) {
  const by = new Map();
  for (const h of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!h || !Number.isFinite(h.t) || !Number.isFinite(h.v)) continue;
    const d = dayOf(h.t), cur = by.get(d); if (!cur || h.t > cur.t) by.set(d, { t: h.t, v: Math.round(h.v), n: h.n | 0, q: h.q | 0 });
  }
  const out = [...by.values()].sort((x, y) => x.t - y.t);
  return out.length > max ? out.slice(out.length - max) : out;
}
const histSame = (a, b) => { const x = histMerge(a, []), y = histMerge(b, []); return x.length === y.length && x.every((h, i) => h.t === y[i].t && h.v === y[i].v); };

/* ── Commander : éligibilité d'une carte, données EDHREC (edh.tsv), decks à compléter ─────────────────────────── */
/** Carte Scryfall → 1 si elle peut être commandant, sinon 0 : légendaire créature (face avant ; les deux faces d'une double face modale), Véhicule ou Vaisseau légendaire avec force/endurance, texte « can be your commander » ; légale en Commander. */
function canBeCommander(c) {
  if (!c) return 0;
  const lg = c.legalities && c.legalities.commander; if (lg && lg !== 'legal') return 0;
  const faces = Array.isArray(c.card_faces) && c.card_faces.length ? c.card_faces : [c];
  const txt = faces.map(f => f.oracle_text || '').join('\n') || String(c.oracle_text || '');
  if (/can be your commander/i.test(txt)) return 1;
  for (const f of c.layout === 'modal_dfc' ? faces : faces.slice(0, 1)) {
    const tl = String(f.type_line || (faces.length === 1 ? c.type_line : '') || '');
    if (!/\blegendary\b/i.test(tl)) continue;
    if (/\bcreature\b/i.test(tl)) return 1;
    if (/\b(vehicle|spacecraft)\b/i.test(tl) && (f.power != null || c.power != null)) return 1;
  }
  return 0;
}
/** Sans l'info précise (cartes lues avant l'ajout du champ) : d'après la ligne de type. */
const isCmdrType = tl => /\blegendary\b/i.test(String(tl || '')) && /\bcreature\b/i.test(String(tl || ''));
/** Classe « commander » d'une carte de la collection : { cx, ed } — cx 0 pas commandant · 1 peut l'être · 2 joué comme commandant dans des decks EDHREC (ed : nombre de decks). edh : résultat de parseEdh, ou null. */
function cmdrClass(i, edh) {
  const e = edh && edh.by && edh.by.get(i.k);
  if (e) return { cx: 2, ed: e.decks };
  return { cx: (i.cd != null ? i.cd : isCmdrType(i.tl)) ? 1 : 0, ed: 0 };
}
/** Lit le texte d'un edh.tsv en modèle { v, at, cmds:[{ slug, decks, ci, names, img }], decks:[{ slug, src, label, url, cards:[[nom, qté]] }], price:[[nom, centimes]], gc:[nom] } (voir edhPack). */
function edhModelFromTsv(text) {
  const m = { v: 0, at: '', cmds: [], decks: [], price: [], gc: [] }, bySlug = new Map();
  let cur = null;
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    const t = line.replace(/\r$/, '').split('\t'), tag = t[0];
    if (tag === '#edh') { m.v = Number(t[1]) || 0; m.at = t[2] || ''; }
    else if (tag === 'C' && t.length >= 5) {
      const names = t.slice(4).map(x => x.trim()).filter(Boolean); if (!names.length || !t[1]) continue;
      const c = { slug: t[1], decks: Math.max(0, Number(t[2]) || 0), ci: String(t[3] || '').replace(/[^WUBRG]/g, ''), names, img: '' };
      m.cmds.push(c); bySlug.set(c.slug, c);
    }
    else if (tag === 'I' && t.length >= 3) { const c = bySlug.get(t[1]); if (c && /^[\w\-./]+$/.test(t[2])) c.img = t[2]; }
    else if (tag === 'D' && t[1]) { const c = bySlug.get(t[1]); cur = c ? { slug: t[1], src: t[2] || 'edhrec', label: t[3] || '', url: /^https:\/\//.test(t[4] || '') ? t[4] : '', cards: [] } : null; if (cur) m.decks.push(cur); }
    else if (tag === 'K' && cur && t.length >= 3) { const n = t.slice(2).join('\t').trim(); if (n) cur.cards.push([n, Math.max(1, Math.min(99, Number(t[1]) || 1))]); }
    else if (tag === 'P' && t.length >= 3) { const v = Number(t[1]); if (v > 0) m.price.push([t.slice(2).join('\t').trim(), Math.round(v)]); }
    else if (tag === 'G' && t.length >= 2) { const n = t.slice(1).join('\t').trim(); if (n) m.gc.push(n); }
  }
  return m;
}
const EDHB = typeof module !== 'undefined' && module.exports ? require('./edhbin.js') : { edhPack, edhUnpack };
/** Types de decks, dans l'ordre d'affichage du filtre : deck moyen EDHREC, Budget, Premium, cEDH, Populaire (un seul deck récent), Archidekt (ancien fichier). */
const EDH_KINDS = ['avg', 'budget', 'premium', 'cedh', 'pop', 'arch'];
/** Un deck de l'index : ses cartes restent dans les grands tableaux de l'index ; `cards` ([[clé, nom, qté]], terrains de base compris, commandant exclu) n'est construit qu'à la demande.
 *  k : type ('avg' deck moyen · 'budget' · 'premium' · 'pop' · 'cedh' · 'arch' deck Archidekt d'un ancien fichier) · u : mise à jour 'AAAA-MM-JJ' ('' inconnue) · v : vues · p : prix du deck en centimes (0 inconnu). */
class EdhDeck {
  constructor(e, i, cmd, src, label, url, k, u, v, p) {
    this._e = e; this.i = i; this.cmd = cmd; this.slug = cmd.slug; this.src = src || 'edhrec'; this.label = label || '';
    this.k = EDH_KINDS.includes(k) ? k : this.src === 'edhrec' ? 'avg' : 'arch'; this.u = /^\d{4}-\d{2}-\d{2}$/.test(u || '') ? u : ''; this.v = Math.max(0, Number(v) || 0); this.p = Math.max(0, Number(p) || 0);
    this.url = url === 0 ? 'https://edhrec.com/average-decks/' + cmd.slug : typeof url === 'number' ? 'https://archidekt.com/decks/' + url : /^https:\/\//.test(url || '') ? url : '';
  }
  get cards() { const e = this._e, out = []; for (let j = e.off[this.i], z = e.off[this.i + 1]; j < z; j++) { const id = e.ids[j]; out.push([e.keys[id], e.names[id], e.qty[j]]); } return out; }
}
/** Index de recherche à partir d'un fichier EDH2 lu (edhUnpack) :
 *  { v, at, cmds:[{ slug, decks, ci, names, keys, ids, img, rank (1 = le plus joué), tier ('S'…'D'), i, th:[[indice de thème, decks EDHREC]] (du plus au moins fréquent), thSet }], by: clé → commandant, bySlug,
 *    themes:[{ slug, label, cmds, decks }] (thèmes EDHREC : nombre de commandants et de decks qui les ont ; ceux d'un commandant valent pour tous ses decks, Archidekt compris), themeIx: slug → indice, themeOrder: indices des thèmes présents, du plus au moins fréquent, decks:[EdhDeck], price: clé → centimes, gc: Set de clés,
 *    names / keys / idOf : carte ↔ numéro, off / ids / qty : entrées des decks, pr : prix par numéro, bs / gcA : terrain de base · Game Changer par numéro }. */
function edhIndex(raw) {
  const names = raw.names, nn = names.length, keys = new Array(nn), idOf = new Map(), bs = new Uint8Array(nn), gcA = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) { const k = ownKey(names[i]); keys[i] = k; if (!idOf.has(k)) idOf.set(k, i); if (BASIC_NAMES.has(k)) bs[i] = 1; }
  const themes = (raw.themes || []).map(t => ({ slug: String(t && t[0]), label: String((t && t[1]) || (t && t[0])), cmds: 0, decks: 0 })), themeIx = new Map(themes.map((t, i) => [t.slug, i]));
  const out = { v: raw.v, at: raw.at, rk: '', cmds: [], by: new Map(), bySlug: new Map(), decks: [], price: new Map(), gc: new Set(), names, keys, idOf, off: raw.off, ids: raw.ids, qty: raw.qty, pr: raw.pr, bs, gcA, themes, themeIx, themeOrder: [] };
  for (let i = 0; i < nn; i++) if (raw.pr[i] > 0) out.price.set(keys[i], raw.pr[i]);
  for (const id of raw.gc) { gcA[id] = 1; out.gc.add(keys[id]); }
  for (const r of raw.cmds) {
    const ck = r.names.map(ownKey), th = (r.th || []).filter(t => Array.isArray(t) && themes[t[0]] && t[1] > 0).map(t => [t[0], t[1]]).sort((a, b) => b[1] - a[1]);
    const c = { slug: r.slug, decks: r.decks, dm: r.dm || 0, ci: String(r.ci || '').replace(/[^WUBRG]/g, ''), names: r.names, keys: ck, ids: ck.map(k => idOf.get(k)).filter(x => x !== undefined), img: r.img && /^[\w\-./]+$/.test(r.img) ? FR_IMG + r.img : '', i: out.cmds.length, th, thSet: new Set(th.map(t => t[0])) };
    out.cmds.push(c); out.bySlug.set(c.slug, c);
    for (const t of th) themes[t[0]].cmds++;
    for (const k of c.keys) { const p = out.by.get(k); if (!p || c.decks > p.decks) out.by.set(k, c); }
  }
  out.rk = raw.rk === 'month' && out.cmds.some(c => c.dm > 0) ? 'month' : '';      // classement du mois (à jour) ; ancien fichier : compte long
  [...out.cmds].sort((a, b) => (out.rk ? (b.dm - a.dm) : 0) || b.decks - a.decks).forEach((c, i) => { c.rank = i + 1; c.tier = edhTier(c.rank); });      // le tri est stable : à égalité, l'ordre du fichier (celui d'EDHREC)
  raw.dk.forEach(([ci, src, label, url, k, u, v, p], i) => out.decks.push(new EdhDeck(out, i, out.cmds[ci], src, label, url, k, u, v, p)));
  for (const d of out.decks) for (const t of d.cmd.th) themes[t[0]].decks++;
  out.themeOrder = themes.map((t, i) => i).filter(i => themes[i].decks > 0).sort((a, b) => themes[b].decks - themes[a].decks || themes[a].label.localeCompare(themes[b].label));      // les plus présents d'abord
  return out;
}
/** Lit edh.tsv (généré par gen-edhrec.mjs ; ancien format, gardé en repli) :
 *    #edh \t version \t date
 *    C \t slug \t decks \t identité \t nom [\t nom 2]        un commandant (ou une paire), avec son nombre de decks EDHREC
 *    I \t slug \t chemin d'image                            petite image du commandant (après cards.scryfall.io/small/)
 *    D \t slug \t source \t libellé \t lien                  début d'un deck de ce commandant (source : edhrec · archidekt…)
 *    K \t quantité \t nom                                    une carte du deck courant (commandant exclu)
 *    P \t centimes \t nom                                    prix Cardmarket (tendance Scryfall) au moment de la génération
 *    G \t nom                                                une carte de la liste Game Changers (Scryfall `is:gamechanger`)
 *  Retourne l'index (voir edhIndex). */
function parseEdh(text) { return edhIndex(EDHB.edhUnpack(EDHB.edhPack(edhModelFromTsv(text), ownKey))); }
/** Lit un fichier binaire EDH2 (edh.bin) : même index que parseEdh. Lève une erreur si le fichier est illisible. */
function parseEdhBin(buf) { return edhIndex(EDHB.edhUnpack(buf)); }
/** Tier d'un commandant selon son rang de popularité (nombre de decks EDHREC) : S = les 30 premiers, A jusqu'à 150, B 500, C 1 500, D le reste. */
const EDH_TIERS = [['S', 30], ['A', 150], ['B', 500], ['C', 1500], ['D', Infinity]];
const edhTier = rank => (EDH_TIERS.find(t => rank <= t[1]) || EDH_TIERS[EDH_TIERS.length - 1])[0];
/** Bracket estimé d'un deck d'après son nombre de Game Changers : 0 → 2 (Core), 1 à 3 → 3 (Upgraded), 4 et plus → 4 (Optimized). Estimation : les autres critères du bracket (terrains détruits, tours supplémentaires, combos) ne sont pas lus. */
const edhBracket = n => (n <= 0 ? 2 : n <= 3 ? 3 : 4);
/** Mots d'une recherche de deck (sans accents ni ponctuation, comme les clés de cartes) ; [] si rien à chercher. */
const edhTokens = q => normName(q).replace(/ \/\/ /g, ' ').split(' ').filter(Boolean);
/** Le commandant (ou la paire) contient tous les mots (début de mot) : « tymna » et « thrasios triton » trouvent la paire Tymna + Thrasios. */
const edhWords = (s, toks) => { const w = ' ' + s; return toks.every(t => w.includes(' ' + t)); };      // chaque mot cherché commence un mot du nom : « smite » ne trouve pas « Prismite »
const edhCmdHas = (c, toks) => edhWords(c.keys.join(' '), toks);
/** Une ligne du classement. Les listes `missing`, `owned` et `gc` (longues, utiles seulement à la feuille d'un deck) ne sont calculées qu'au premier accès. */
class EdhRow {
  constructor(deck, cmd, total, have, cost, unpriced, mine, br, hit, e, own, eng, held) {
    this.deck = deck; this.cmd = cmd; this.total = total; this.have = have; this.eng = eng || 0; this.miss = total - have; this.cost = cost; this.unpriced = unpriced; this.mine = mine;
    this.tier = cmd.tier; this.rank = cmd.rank; this.br = br; this.hit = hit; this._e = e; this._o = own; this._h = held || null;
  }
  get missing() { edhDetail(this); return this.missing; }
  get owned() { edhDetail(this); return this.owned; }
  get gc() { edhDetail(this); return this.gc; }
}
function edhDetail(r) {
  const e = r._e, own = r._o, hold = r._h, c = r.cmd, d = r.deck, missing = [], owned = [], gcs = [];
  const one = (id, q) => {
    if (e.bs[id]) return;
    const h = Math.min(q, own[id]), m = q - h, g = e.gcA[id] === 1; if (g) gcs.push(e.names[id]);
    if (m) { const u = e.pr[id]; missing.push({ k: e.keys[id], n: e.names[id], q: m, u: u > 0 ? u : null, gc: g }); }
    if (h) owned.push({ k: e.keys[id], n: e.names[id], q: h, gc: g, eg: h - Math.min(h, Math.max(0, own[id] - (hold ? hold[id] : 0))) });      // eg : parmi ces exemplaires, ceux déjà réservés par un deck monté
  };
  for (const id of c.ids) one(id, 1);
  for (let j = e.off[d.i], z = e.off[d.i + 1]; j < z; j++) one(e.ids[j], e.qty[j]);
  missing.sort((a, b) => ((b.u || 0) * b.q - (a.u || 0) * a.q) || a.n.localeCompare(b.n));
  Object.defineProperties(r, { missing: { value: missing, configurable: true }, owned: { value: owned, configurable: true }, gc: { value: gcs, configurable: true } });
}
/** Decks EDHREC comparés à la collection. qty(clé) : exemplaires possédés. o : { held (clé → exemplaires réservés par des decks montés : sert à compter `eng`, les exemplaires possédés du deck déjà engagés ailleurs), cols:Set (identités de couleur permises : celle du commandant doit y tenir), mine (je possède un des commandants), budget (centimes, 0 = sans limite), tiers:Set ('S'…'D' : seulement ces tiers), themes:Set (identifiants de thèmes EDHREC : le commandant doit les avoir tous), sort: 'have' (le plus de cartes possédées) | 'miss' | 'cost' | 'pop' (meilleur rang : celui du mois si le fichier en a un), then (second tri, même choix : le premier se fait alors par paliers, voir EDH_SORT_STEP), kinds:Set (types de decks, voir EDH_KINDS), q (recherche : tous les mots), qm: 'cmd' (dans le nom du commandant) | 'card' (dans les cartes du deck, commandant compris, hors terrains de base) }.
 *  Terrains de base ignorés. Une ligne par deck : { deck, cmd, total, have, miss, cost, unpriced, mine, tier, rank, br (bracket estimé, 0 sans liste Game Changers), hit ([[clé, nom]] des cartes trouvées par une recherche « carte », sinon null), et à la demande : missing:[{ k, n, q, u, gc }], owned:[{ k, n, q, gc }], gc:[noms des Game Changers du deck, commandant compris] }.
 *  Calcul sur tableaux typés (un passage sur toutes les entrées de tous les decks) : quelques millisecondes pour 10 000 decks. */
function edhRank(edh, qty, o = {}) {
  const rows = []; if (!edh || !edh.decks || !edh.decks.length) return rows;
  const cols = o.cols && o.cols.size ? o.cols : null, card = o.qm === 'card'; let toks = o.q ? edhTokens(o.q) : null; if (toks && !toks.length) toks = null;
  const names = edh.names, keys = edh.keys, nn = names.length, own = new Uint16Array(nn), hold = typeof o.held === 'function' ? new Uint16Array(nn) : null;
  for (let i = 0; i < nn; i++) { const q = qty(keys[i]); if (q > 0) { own[i] = q > 65535 ? 65535 : q; if (hold) { const h = o.held(keys[i]); if (h > 0) hold[i] = h > 65535 ? 65535 : h; } } }
  const { off, ids, qty: qa, pr, bs, gcA } = edh, gset = edh.gc && edh.gc.size > 0;
  let thIx = null;      // thèmes demandés (identifiants) → indices ; un thème absent du fichier ne correspond à aucun deck
  if (o.themes && o.themes.size) { thIx = []; for (const t of o.themes) { const i = edh.themeIx && edh.themeIx.get(t); if (i === undefined) return rows; thIx.push(i); } }
  let hitF = null, cmdOk = null;
  if (toks && card) { hitF = new Uint8Array(nn); for (let i = 0; i < nn; i++) if (!bs[i] && edhWords(names[i].includes('//') ? normName(names[i]) : keys[i], toks)) hitF[i] = 1; }
  else if (toks) cmdOk = new Int8Array(edh.cmds.length);
  for (const d of edh.decks) {
    const c = d.cmd; let mine = false; for (const id of c.ids) if (own[id] > 0) { mine = true; break; }
    if (o.mine && !mine) continue;
    if (cols && ![...c.ci].every(x => cols.has(x))) continue;
    if (o.tiers && o.tiers.size && !o.tiers.has(c.tier)) continue;
    if (o.kinds && o.kinds.size && !o.kinds.has(d.k)) continue;
    if (thIx && !thIx.every(i => c.thSet.has(i))) continue;
    const a = off[d.i], z = off[d.i + 1]; let hit = null;
    if (hitF) {
      hit = []; for (const id of c.ids) if (hitF[id]) hit.push([keys[id], names[id]]);
      for (let j = a; j < z; j++) if (hitF[ids[j]]) hit.push([keys[ids[j]], names[ids[j]]]);
      if (!hit.length) continue;
    } else if (cmdOk) { if (!cmdOk[c.i]) cmdOk[c.i] = edhCmdHas(c, toks) ? 1 : -1; if (cmdOk[c.i] < 0) continue; }
    let total = 0, have = 0, cost = 0, unpriced = 0, gcN = 0, eng = 0;
    for (const id of c.ids) { if (bs[id]) continue; total++; if (gcA[id]) gcN++; if (own[id] > 0) { have++; if (hold && own[id] <= hold[id]) eng++; } else { const u = pr[id]; if (u > 0) cost += u; else unpriced++; } }
    for (let j = a; j < z; j++) {
      const id = ids[j]; if (bs[id]) continue;
      const q = qa[j], ow = own[id], h = ow < q ? ow : q; total += q; have += h; if (gcA[id]) gcN++;
      if (hold && h) { const fr = ow > hold[id] ? ow - hold[id] : 0; eng += h - (fr < h ? fr : h); }
      if (h < q) { const m = q - h, u = pr[id]; if (u > 0) cost += u * m; else unpriced += m; }
    }
    if (total < 20 || total > 105) continue;      // liste tronquée, ou faussée (cartes en trop : un deck de Commander en compte 100)
    if (o.budget > 0 && cost > o.budget) continue;
    const row = new EdhRow(d, c, total, have, cost, unpriced, mine, gset ? edhBracket(gcN) : 0, hit, edh, own, eng, hold); row.gcn = gset ? gcN : 0; rows.push(row);
  }
  const exact = EDH_SORT_BY, sort = exact[o.sort] ? o.sort : 'have', then = o.then && o.then !== sort && exact[o.then] ? o.then : '';
  const by = then ? (a, b) => (EDH_SORT_STEP[sort](a) - EDH_SORT_STEP[sort](b)) || exact[then](a, b) || exact[sort](a, b) : exact[sort];
  return rows.sort((a, b) => by(a, b) || (a.cmd.rank - b.cmd.rank) || a.cmd.names[0].localeCompare(b.cmd.names[0]));
}
/** Tris des decks EDHREC : have (le plus de cartes possédées), miss, cost (le moins cher à compléter), pop (meilleur rang : celui du mois si le fichier en a un). */
const EDH_SORT_BY = {
  have: (a, b) => (b.have - a.have) || (a.miss - b.miss) || (a.cost - b.cost), miss: (a, b) => (a.miss - b.miss) || (a.cost - b.cost),
  cost: (a, b) => (a.cost - b.cost) || (a.miss - b.miss), pop: (a, b) => (a.cmd.rank - b.cmd.rank) || (a.miss - b.miss),
};
/** Paliers d'un tri suivi d'un second (« Meilleur tier, puis moins cher ») : à palier égal, le second départage. Tier (S → D) · part possédée par tranches de 10 % · cartes manquantes par 10 · coût à compléter par tranches (30 / 60 / 100 / 200 / 400 €). */
const EDH_COST_STEPS = [0, 3000, 6000, 10000, 20000, 40000];
const EDH_SORT_STEP = {
  pop: r => 'SABCD'.indexOf(r.tier || 'D'), have: r => -Math.floor(10 * r.have / Math.max(1, r.total)), miss: r => Math.floor(r.miss / 10),
  cost: r => { const i = EDH_COST_STEPS.findIndex(x => r.cost <= x); return i < 0 ? EDH_COST_STEPS.length : i; },
};
/** Nombre de decks de `rows` (résultat d'edhRank) qui portent chaque thème, indexé comme edh.themes. Les compteurs de la liste des thèmes en dépendent : ils suivent tous les filtres en cours (couleurs, tiers, budget, recherche, thèmes déjà choisis). */
function edhThemeCounts(edh, rows) {
  const n = new Array(edh && edh.themes ? edh.themes.length : 0).fill(0);
  for (const r of rows || []) for (const t of r.cmd.th) n[t[0]]++;
  return n;
}
/** Indices des thèmes du fichier, du plus au moins présent dans `counts` ; à égalité : les thèmes déjà choisis (sel : Set de slugs), puis la présence dans tout le fichier, puis le nom. Ceux à zéro viennent en dernier. */
function edhThemeOrder(edh, counts, sel) {
  const th = edh.themes, pick = new Set(); for (const s of sel || []) { const i = edh.themeIx.get(s); if (i !== undefined) pick.add(i); }
  return (edh.themeOrder || []).slice().sort((a, b) => (counts[b] - counts[a]) || (pick.has(b) - pick.has(a)) || (th[b].decks - th[a].decks) || th[a].label.localeCompare(th[b].label));
}
/** Liste à charger dans la page de saisie : commandant(s) puis cartes du deck (terrains de base compris). */
function edhDeckText(d) {
  const c = d.cmd, cmd = c.names.map(n => '1 ' + n);
  return ['Commander', ...cmd, '', ...d.cards.filter(x => !c.keys.includes(x[0])).map(x => x[2] + ' ' + x[1])].join('\n');
}

/* ── Prix réels de la collection (offre CardTrader la moins chère) ─────────────────────────────── */
/** Prix unitaire d'une carte de la collection, en centimes : prix réel (rp, offre CardTrader la plus basse) s'il est connu, sinon l'estimation Cardmarket (eu), sinon null. */
const unitPrice = i => (Number.isFinite(i.rp) && i.rp > 0 ? i.rp : Number.isFinite(i.eu) && i.eu > 0 ? i.eu : null);
/** L'offre la moins chère qu'on achèterait vraiment : mêmes critères que la recherche (état, foil, hors vacances/gradées/lots…), vendeurs hub seulement en mode Zero, langue demandée. null si aucune. */
function cheapestOffer(offers, opts) {
  let best = null;
  for (const o of offers || []) {
    if (!passes(o, opts) || (opts.mode !== 'direct' && !o.hub) || (opts.lang && o.lang && o.lang !== opts.lang)) continue;
    if (!best || byPrice(o, best) < 0) best = o;
  }
  return best;
}
/** Signature des critères d'un prix réel (langue des offres, état, foil, mode) : si elle change, le prix est à relire. */
const pxSig = (lang, o) => [lang, o.cond, o.foil, o.mode === 'direct' ? 'direct' : 'zero'].join('|');
/** Prix réel (px : { p, t, s }) à relire ? absent, trop ancien (ttl ms) ou calculé avec d'autres critères. */
const pxStale = (px, sig, now, ttl) => !px || px.s !== sig || !(now - px.t <= ttl);

/* ── Statistiques de la collection ─────────────────────────────────────────────────────────── */
/** Prix unitaire selon la source : 'ct' = prix réel CardTrader, à défaut l'estimation Cardmarket ; 'cm' = estimation Cardmarket seule. { u, real } ou null. */
function srcPrice(i, src) {
  if (src === 'cm') return Number.isFinite(i.eu) && i.eu > 0 ? { u: i.eu, real: false } : null;
  const u = unitPrice(i);
  return u == null ? null : { u, real: Number.isFinite(i.rp) && i.rp > 0 };
}
/** items : [{ k, n, q, cm, tl, cl, eu, rp }] (cm/tl/cl/eu absents tant que Scryfall n'a pas répondu ; rp : prix réel CardTrader si lu). src : 'ct' (défaut) = prix réel sinon estimation, 'cm' = estimation Cardmarket pour tout. alt = valeur de l'autre source. */
function collStats(items, src) {
  src = src === 'cm' ? 'cm' : 'ct';
  const st = { src, unique: items.length, copies: 0, known: 0, unknown: 0, lands: 0, spells: 0, value: 0, valued: 0, real: 0, alt: { value: 0, valued: 0 }, curve: new Array(8).fill(0), colors: { W: 0, U: 0, B: 0, R: 0, G: 0, M: 0, C: 0 }, types: {}, top: [], topUnit: [] };
  for (const t of TYPE_ORDER) st.types[t] = 0;
  const valued = [];
  for (const i of items) {
    st.copies += i.q;
    if (i.tl == null && i.cm == null) { st.unknown++; continue; }
    st.known++;
    const t = typeBucket(i.tl); st.types[t] += i.q;
    const p = srcPrice(i, src), a = srcPrice(i, src === 'cm' ? 'ct' : 'cm');
    if (p) { st.value += p.u * i.q; st.valued++; if (p.real) st.real++; valued.push({ ...i, up: p.u, lot: p.u * i.q, rl: p.real }); }
    if (a) { st.alt.value += a.u * i.q; st.alt.valued++; }
    if (t === 'Terrains') { st.lands += i.q; continue; }
    st.spells += i.q;
    st.curve[Math.min(i.cm ?? 0, 7)] += i.q;
    const c = i.cl || ''; if (!c) st.colors.C += i.q; else if (c.length > 1) st.colors.M += i.q; else if (st.colors[c] != null) st.colors[c] += i.q; else st.colors.C += i.q;
  }
  st.top = valued.slice().sort((a, b) => b.lot - a.lot || b.up - a.up || a.n.localeCompare(b.n));           // « les plus chères » par lot (prix × exemplaires) : toutes, l'écran en affiche par tranches
  st.topUnit = valued.sort((a, b) => b.up - a.up || b.lot - a.lot || a.n.localeCompare(b.n));                // …ou par prix de la carte
  return st;
}

/* ── Reconnaissance d'un nom de carte dans un texte lu par OCR ───────────────────────────────── */
/** Distance de Levenshtein bornée : retourne max + 1 dès qu'elle dépasse max. */
function lev(a, b, max) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (!la) return lb; if (!lb) return la;
  let prev = new Array(lb + 1), cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i; let rowMin = i; const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      let v = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      const del = prev[j] + 1, ins = cur[j - 1] + 1;
      if (del < v) v = del; if (ins < v) v = ins;
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[lb];
}
/** Paires de lettres que l'OCR confond (stockées triées) : la substitution ne coûte que 0,5. */
const OCR_CONF = ['il', '1i', '1l', '0o', '5s', 'ce', 'uv', 'ft', 'hn', 'gq'];
const COST_PLAIN = new Float32Array(128 * 128).fill(1), COST_OCR = new Float32Array(128 * 128).fill(1);
for (let i = 0; i < 128; i++) COST_PLAIN[i * 128 + i] = COST_OCR[i * 128 + i] = 0;
for (const p of OCR_CONF) { const x = p.charCodeAt(0), y = p.charCodeAt(1); COST_OCR[x * 128 + y] = COST_OCR[y * 128 + x] = 0.5; }
let LEVW_A = new Float32Array(256), LEVW_B = new Float32Array(256);
/** Distance de Levenshtein bornée, pondérée pour l'OCR : lettres confondues (i/l, c/e, u/v…) et espaces ajoutés ou perdus = 0,5 (disc : false pour les mots courts, où une confusion peut changer le mot).
 *  Textes normalisés (a-z, 0-9, espace). Retourne max + 1 dès que la distance dépasse max. */
function levw(a, b, max, disc = true) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) * 0.5 > max) return max + 1;
  if (!la) return lb; if (!lb) return la;
  if (lb + 1 > LEVW_A.length) { LEVW_A = new Float32Array(lb + 64); LEVW_B = new Float32Array(lb + 64); }
  const T = disc ? COST_OCR : COST_PLAIN, sg = disc ? 0.5 : 1;
  let prev = LEVW_A, cur = LEVW_B;
  prev[0] = 0; for (let j = 1; j <= lb; j++) prev[j] = prev[j - 1] + (b.charCodeAt(j - 1) === 32 ? sg : 1);
  for (let i = 1; i <= la; i++) {
    const ca = a.charCodeAt(i - 1) & 127, ga = ca === 32 ? sg : 1, row = ca * 128; cur[0] = prev[0] + ga; let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = prev[j - 1] + T[row + (cb & 127)];
      const del = prev[j] + ga, ins = cur[j - 1] + (cb === 32 ? sg : 1);
      if (del < v) v = del; if (ins < v) v = ins;
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[lb];
}
const spaces = k => { let n = 0; for (let i = 0; i < k.length; i++) if (k.charCodeAt(i) === 32) n++; return n; };
/** Index des noms de cartes : { list:[{k, n}], by: Map(k → n) } ; k = première face normalisée. */
function nameIndex(names) {
  const by = new Map(), list = [];
  for (const n of names || []) { const k = frontName(n); if (k.length >= 2 && !by.has(k)) { by.set(k, n); list.push({ k, n, s: spaces(k) }); } }
  return { list, by };
}
/** Variantes d'une ligne lue par OCR : la ligne, puis sans les petits mots parasites de fin (coût de mana lu comme du texte) ou de début. */
function lineVariants(raw) {
  const clean = String(raw || '').replace(/[|_~=<>{}\[\]\\\/@#*•·®©™]+/g, ' '), key = normPart(clean), t = key.split(' ').filter(Boolean), out = [];
  if (!t.length) return out;
  const last = (clean.trim().split(/\s+/).pop() || '');
  out.push({ key: t.join(' '), penalty: 0 });
  if (t.length > 1 && t[t.length - 1].length <= 2) out.push({ key: t.slice(0, -1).join(' '), penalty: 0.03 });
  else if (t.length > 1 && /^[A-Z0-9]{3,4}$/.test(last)) out.push({ key: t.slice(0, -1).join(' '), penalty: 0.04 });   // coût de mana lu comme un mot en capitales (« LLB », « RHO », « WUBG »)
  if (t.length > 2 && t[t.length - 1].length <= 3 && t[t.length - 2].length <= 3) out.push({ key: t.slice(0, -2).join(' '), penalty: 0.05 });
  if (t.length > 2 && t[0].length <= 2) out.push({ key: t.slice(1).join(' '), penalty: 0.03 });
  return out;
}
/** Meilleur nom de carte pour une ligne : { name, score (0..1), key } ou null. ≥ 0.84 fiable · ≥ 0.72 à vérifier. */
function matchName(raw, idx, minScore = 0.72) {
  let best = null;
  for (const v of lineVariants(raw)) {
    if (v.key.length < 3) continue;
    let name = idx.by.get(v.key), d = 0, k = v.key; const vsp = name === undefined ? spaces(v.key) : 0;
    if (name === undefined) {
      let max = Math.max(1, Math.floor(v.key.length * 0.3)), bn = null;
      if (minScore > 0.8) max = Math.max(1, Math.min(max, Math.floor((1 - minScore) * v.key.length) + 1));   // seuil exigeant : on écarte tôt les noms trop différents
      for (const st of max > 4 ? [2, 4, max] : max > 2 ? [2, max] : [max]) {                              // recherche par paliers : une lecture propre est trouvée en quelques calculs, le résultat est le même qu'avec la borne maximale d'emblée
        let limit = st;
        for (const e of idx.list) {
          if (limit < 0) break;
          const dl = e.k.length - v.key.length, ad = dl < 0 ? -dl : dl, sp = dl < 0 ? vsp : e.s, cheap = ad < sp ? ad : sp;      // écart de longueur : au mieux des espaces à 0,5, le reste à 1
          if (cheap * 0.5 + (ad - cheap) > limit) continue;
          const dd = levw(v.key, e.k, limit, Math.min(e.k.length, v.key.length) >= 6);
          if (dd <= limit) { bn = e; d = dd; limit = dd - 0.1; }
        }
        if (bn) break;
      }
      if (!bn) continue;
      name = bn.n; k = bn.k;
    }
    const score = 1 - d / Math.max(v.key.length, k.length) - v.penalty;
    if (score >= minScore && (!best || score > best.score)) best = { name, score: Math.round(score * 1000) / 1000, key: ownKey(name) };
  }
  return best;
}
/** Plusieurs noms sur une même ligne (cartes côte à côte) : groupes de mots reconnus (≥ 0.9), sans chevauchement, dans l'ordre de lecture. */
function spanMatches(text, idx, minScore = 0.9) {
  const w = String(text || '').replace(/[|_~=<>{}\[\]\\\/@#*•·®©™]+/g, ' ').split(/\s+/).filter(Boolean);
  if (w.length < 2 || w.length > 16) return [];
  const found = [];
  for (let i = 0; i < w.length; i++) for (let j = Math.min(w.length, i + 7); j > i; j--) {
    const sp = w.slice(i, j).join(' '); if (sp.length < 5 || !/[A-Za-zÀ-ÿ]{3}/.test(sp)) continue;          // « Opt », « Fog » : trop courts pour être sûrs au milieu d'une ligne
    const m = matchName(sp, idx, minScore); if (m) found.push({ ...m, i, j, raw: sp });
  }
  found.sort((a, b) => b.score - a.score || (b.j - b.i) - (a.j - a.i));
  const used = new Array(w.length).fill(false), out = [];
  for (const f of found) { let free = true; for (let k = f.i; k < f.j; k++) if (used[k]) { free = false; break; } if (!free) continue; for (let k = f.i; k < f.j; k++) used[k] = true; out.push(f); }
  return out.sort((a, b) => a.i - b.i).map(({ i, j, ...m }) => m);
}
/** Lignes lues par OCR [{ text, y }] → cartes reconnues [{ name, key, score, q, raw }] (une même carte lue deux fois = 2 exemplaires).
 *  spans : une ligne peut contenir plusieurs noms (photo de plusieurs cartes côte à côte). */
function ocrMatches(lines, idx, spans = false) {
  const out = [], seen = new Map();
  for (const l of lines || []) {
    const text = String(l.text || '').trim(); if (text.length < 3 || text.length > (spans ? 140 : 60)) continue;
    const letters = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length; if (letters < text.length * 0.6) continue;
    const one = matchName(text, idx);
    let ms = one ? [one] : [];
    if (spans && (!one || one.score < 0.84)) { const sp = spanMatches(text, idx); if (sp.length) ms = sp; }
    for (const m of ms) {
      const cur = seen.get(m.key);
      if (cur) { cur.q++; if (m.score > cur.score) { cur.score = m.score; cur.raw = m.raw || text; } } else { const e = { ...m, q: 1, raw: m.raw || text }; seen.set(m.key, e); out.push(e); }
    }
  }
  return out;
}

/** Meilleure carte reconnue parmi des lignes lues : { name, key, score, raw } ou null. */
function bestMatch(lines, idx) { return ocrMatches(lines, idx, false).sort((a, b) => b.score - a.score)[0] || null; }
/** Préfixe des miniatures Scryfall gardées dans le catalogue français (seul le chemin « front/a/b/id.jpg » est stocké). */
const FR_IMG = 'https://cards.scryfall.io/small/';
/** Face avant d'un nom imprimé (« A // B » → « A ») : la collection ne garde que la face avant. */
const frFront = p => String(p).split(/\s+\/\/\s+/)[0].trim();
/** Nom anglais normalisé (ownKey) → nom imprimé français, sans l'index de recherche floue (léger) : sert à afficher les cartes FR de la collection. */
function frNames(rows) {
  const m = new Map();
  for (const r of rows || []) { const [p, en] = String(r).split('\t'); if (!p || !en) continue; const ek = frontName(en); if (ek && !m.has(ek)) m.set(ek, frFront(p)); }
  return m;
}
/** Catalogue français : lignes « nom imprimé \t nom anglais \t chemin de l'image » → { n, idx (recherche floue sur les noms imprimés), by (nom imprimé normalisé → { en, img }) }. */
function frCatalog(rows) {
  const by = new Map(), amb = new Set(), names = [], fr = new Map();
  for (const r of rows || []) {
    const [p, en, img] = String(r).split('\t'); if (!p || !en) continue;
    const ek = frontName(en); if (ek && !fr.has(ek)) fr.set(ek, frFront(p));      // nom anglais → nom imprimé français (affichage des cartes FR de la collection)
    const k = frontName(p); if (k.length < 2) continue;
    if (by.has(k)) { if (frontName(by.get(k).en) !== frontName(en)) amb.add(k); continue; }      // même nom français pour deux cartes différentes (≈ 0,1 %) : on garde la 1re mais on le sait
    by.set(k, { en, img: img || '' }); names.push(p);
  }
  return { n: names.length, idx: nameIndex(names), by, amb, fr };
}
function matchFr(lines, fc) {
  if (!fc || !fc.n) return null;
  const m = bestMatch(lines, fc.idx); if (!m) return null;
  const e = fc.by.get(frontName(m.name)); if (!e) return null;
  const dup = !!(fc.amb && fc.amb.has(frontName(m.name)));      // nom français partagé par plusieurs cartes : jamais « sûr », la photo permet de trancher
  return { name: e.en, key: ownKey(e.en), score: dup ? Math.min(m.score, 0.83) : m.score, raw: m.raw, card: 'fr', img: e.img ? (/^https?:/.test(e.img) ? e.img : FR_IMG + e.img) : '', ...(dup ? { amb: true } : {}) };
}
/** Départage une lecture française et une lecture anglaise du même texte : la plus sûre ; à égalité (nom identique dans les deux langues) le français, langue de la plupart des cartes. */
const bestOf = (fr, en) => (fr && (!en || fr.score >= en.score) ? fr : en || null);
/** Rectangle d'écran (x, y, w, h) dans un conteneur cw×ch qui affiche une vidéo vw×vh en « object-fit: cover » → rectangle en pixels de la vidéo. */
function coverMap(cw, ch, vw, vh, r) {
  const s = Math.max(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
  const x = Math.max(0, (r.x - ox) / s), y = Math.max(0, (r.y - oy) / s);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(1, Math.min(vw - x, r.w / s))), h: Math.round(Math.max(1, Math.min(vh - y, r.h / s))) };
}
/** Mots utiles d'un nom lu (≥ 4 lettres, le trait d'union et l'apostrophe séparent), les plus longs d'abord : sert à chercher le nom imprimé chez Scryfall. */
const frWords = text => [...new Set(String(text || '').replace(/[^\p{L}\s'’-]/gu, ' ').split(/[\s'’-]+/).filter(w => w.length >= 4))].sort((a, b) => b.length - a.length);
/** Fluidité de l'aperçu caméra : feed(date en ms de chaque image affichée) → { fps, low }.
 *  low = true (une seule fois, puis la mesure repart) quand il y a moins de `min` images/s pendant `hold` ms de suite. Une pause de plus de 5 s (onglet masqué) remet à zéro. */
function makeFpsWatch(min = 14, hold = 3000, win = 2000) {
  let t = [], lowSince = 0, last = 0;
  return {
    feed(now) {
      if (last && now - last > 5000) { t = []; lowSince = 0; }
      last = now; t.push(now); while (t.length && now - t[0] > win) t.shift();
      const span = now - t[0]; if (t.length < 3 || span < win * 0.75) return { fps: 0, low: false };
      const fps = (t.length - 1) * 1000 / span;
      if (fps >= min) { lowSince = 0; return { fps, low: false }; }
      if (!lowSince) lowSince = now;
      if (now - lowSince >= hold) { lowSince = 0; t = []; return { fps, low: true }; }
      return { fps, low: false };
    },
    reset() { t = []; lowSince = 0; last = 0; }
  };
}
/* ── Partage vers l'app (Web Share Target) ───────────────────────────────────────────────────── */
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
/** Paramètres reçus (title, text, url) → { text, urls } : le texte est gardé s'il ressemble à une decklist (3 cartes ou plus), les liens sont listés. */
function extractShared(p) {
  const text0 = String((p && p.text) || ''), urls = [];
  for (const part of [text0, (p && p.url) || '', (p && p.title) || '']) for (const m of String(part).matchAll(URL_RE)) { const u = m[0].replace(/[.,;:!?]+$/, ''); if (!urls.includes(u)) urls.push(u); }
  const body = text0.replace(URL_RE, '').trim();
  return { text: parseDeck(body).cards.length >= 3 ? body : '', urls };
}

/* ── Liste d'échange : doublons à proposer, cartes recherchées ─────────────────────────────────────────────
   Échangeable = possédé − exemplaires utilisés par tous les decks (additionnés : chaque deck peut être monté en même temps) − réserve de sécurité.
   Terrains de base jamais proposés ni cherchés. Les exemplaires gardés le sont d'abord dans l'ordre des langues de la collection (fr, en, …). */
/** Exemplaires utilisés par une liste de decks (textes) : Map clé → { n, q } (deck + réserve, commandant compris ; terrains de base exclus). */
function deckUse(texts) {
  const use = new Map();
  const add = (name, q) => { const k = ownKey(name); if (!k || BASIC_NAMES.has(k) || !(q > 0)) return; const cur = use.get(k); if (cur) cur.q += q; else use.set(k, { n: name, q }); };
  for (const t of texts || []) { for (const c of parseDeck(t).cards) add(c.name, c.qty); for (const c of dkSideCards(t)) add(c.name, c.qty); }
  return use;
}
/**
 * Cartes à échanger. coll : clé → { n, q, l?, x? } · use : deckUse(…) · keep : réserve gardée en plus des decks (0, 1, 2…) · kept : Set des clés que l'utilisateur garde.
 * Retourne { have: [{ k, n, q, lines: [[langue, exemplaires]] }], held: [{ k, n, q }] } (held : cartes gardées à la main qui auraient été proposées), triés par nom.
 */
function tradeLists(coll, use, keep, kept) {
  const have = [], held = [], kp = Math.max(0, Math.floor(Number(keep) || 0));
  for (const [k, x] of Object.entries(coll || {})) {
    if (!x || !(x.q > 0) || BASIC_NAMES.has(k)) continue;
    const u = use && use.get(k), hold = (u ? u.q : 0) + kp, spare = x.q - hold;
    if (spare <= 0) continue;
    if (kept && kept.has(k)) { held.push({ k, n: x.n, q: spare }); continue; }
    let skip = hold; const lines = [];
    for (const [l, q] of collLines(x)) { const g = Math.max(0, q - skip); skip = Math.max(0, skip - q); if (g) lines.push([l, g]); }
    have.push({ k, n: x.n, q: spare, lines });
  }
  const byN = (a, b) => a.n.localeCompare(b.n, 'en');
  return { have: have.sort(byN), held: held.sort(byN) };
}
/** Cartes recherchées : ce qui manque aux decks (somme des decks − possédé) + la liste de souhaits (wish : clé → { n, q, i?, w?, l? }, exemplaires voulus en plus ;
 *  i/w/l : illustration retenue — image, « Extension · CODE 123 », langue). [{ k, n, q, d (manque aux decks), w (souhait), p? { i, w, l } }] triés par nom. */
function tradeWant(coll, use, wish) {
  const out = new Map();
  for (const [k, u] of use || []) { const own = (coll && coll[k] && coll[k].q) || 0; if (u.q > own) out.set(k, { k, n: u.n, q: u.q - own, d: u.q - own, w: 0 }); }
  for (const [k, w] of Object.entries(wish || {})) {
    if (!w || BASIC_NAMES.has(k)) continue;
    const q = Math.max(1, Math.min(99, Math.floor(Number(w.q) || 1))), cur = out.get(k);
    const x = cur || { k, n: String(w.n || k), q: 0, d: 0, w: 0 };
    x.w = q; x.q += q; if (w.i) x.p = { i: w.i, ...(w.w ? { w: w.w } : {}), ...(w.l ? { l: w.l } : {}) };      // illustration choisie (carte en grand)
    if (!cur) out.set(k, x);
  }
  return [...out.values()].sort((a, b) => a.n.localeCompare(b.n, 'en'));
}

/* ── Export Cardmarket : une ligne « 2 Sol Ring » par carte (noms anglais), à coller dans une Wants list (Shopping Wizard) ── */
/** items : [{ n, q }] → texte ; cartes additionnées par nom, terrains de base exclus, quantités ≤ 0 ignorées. */
function cmText(items) {
  const m = new Map();
  for (const x of items || []) {
    const k = ownKey(x.n), q = Math.floor(Number(x.q) || 0); if (!k || q <= 0 || BASIC_NAMES.has(k)) continue;
    const cur = m.get(k); if (cur) cur.q += q; else m.set(k, { n: String(x.n).trim(), q });
  }
  return [...m.values()].map(x => x.q + ' ' + x.n).join('\n');
}
/** Cartes qui manquent à un deck (texte) : deck + réserve − owned(clé) ; owned absent = rien n'est possédé. [{ n, q }] */
function deckMissing(text, owned) {
  const need = new Map();
  const add = (name, q) => { const k = ownKey(name); if (!k || BASIC_NAMES.has(k)) return; const cur = need.get(k); if (cur) cur.q += q; else need.set(k, { n: name, q }); };
  for (const c of parseDeck(text).cards) add(c.name, c.qty);
  for (const c of dkSideCards(text)) add(c.name, c.qty);
  const out = [];
  for (const [k, x] of need) { const q = x.q - (owned ? Math.max(0, Number(owned(k)) || 0) : 0); if (q > 0) out.push({ n: x.n, q }); }
  return out;
}

/* ── Partage public (liste d'échange, deck) : document shares/{id}, lisible par quiconque a le lien. Le contenu vient d'un autre compte : tout est revérifié ici. ── */
const SHARE_IMG_RE = /^https:\/\/cards\.scryfall\.io\/(?![\w./-]*(?:\/\/|\.\.))[\w./-]+(\?\d+)?$/;      // images Scryfall seulement, sans « // » ni « .. »
const SHARE_LANGS = ['fr', 'en', 'de', 'es', 'it', 'pt', 'jp', 'zh-CN'];
/** Image Scryfall en petit format (vignettes) : …/large/… ou …/normal/… → …/small/… */
const SCRY_IMG = 'https://cards.scryfall.io/';
/** Adresse d'image raccourcie pour un partage : « small/front/6/d/….jpg » (sans le domaine ni le ?horodatage) ; '' si ce n'est pas une image Scryfall. */
const imgShort = u => { const s = String(u || ''); return SHARE_IMG_RE.test(s) ? s.slice(SCRY_IMG.length).replace(/\?\d+$/, '') : ''; };
const scrySmall = u => String(u || '').replace(/\/(large|normal|png|border_crop)\//, '/small/');
const shStr = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const shNum = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : null; };
/** Une carte d'un partage : { n, q, l?, f? (nom français), i? (image), c? (coût), t? (type), o? (couleurs), m? (symboles) } → item d'affichage, null si illisible. */
function shareCard(x) {
  if (!x || typeof x !== 'object') return null;
  const n = shStr(x.n, 160).trim(), q = shNum(x.q, 1, 9999); if (!n || q == null) return null;
  const it = { k: ownKey(n), n, q };
  if (!it.k) return null;
  if (SHARE_LANGS.includes(x.l)) it.l = x.l;
  const f = shStr(x.f, 160).trim(); if (f) { it.fn = f; if (it.l === 'fr') it.dn = f; }
  { const iv = shStr(x.i, 300), full = !iv || /^https:/.test(iv) ? iv : SCRY_IMG + iv; if (SHARE_IMG_RE.test(full)) it.im = full; }      // adresse complète ou raccourcie (imgShort)
  const pw = shStr(x.w, 90).trim(); if (pw) it.pw = pw;      // illustration recherchée : « Extension · CODE 123 »
  const c = shNum(x.c, 0, 99); if (c != null) it.cm = c;
  const t = shStr(x.t, 120); if (t) it.tl = t;
  const o = shStr(x.o, 5); if (/^[WUBRG]*$/.test(o)) it.cl = o;
  const m = shStr(x.m, 80); if (/^(\{[^{}]{1,6}\})*$/.test(m) && m) it.mc = m;
  return it;
}
/** Document de partage lu (champ d : JSON) → { kind: 'trade', at, have, want } | { kind: 'deck', at, name, text } ; null si illisible. */
function readShare(kind, d) {
  let o; try { o = typeof d === 'string' ? JSON.parse(d) : d; } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;
  const at = shNum(o.at, 0, 1e15) || 0;
  if (kind === 'trade') {
    const list = a => (Array.isArray(a) ? a.slice(0, 20000).map(shareCard).filter(Boolean) : []);
    return { kind, at, have: list(o.have), want: list(o.want), ...(o.cut ? { cut: true } : {}) };      // cut : liste tronquée par le propriétaire (trop longue)
  }
  if (kind === 'deck') {
    const text = shStr(o.text, 60000), name = shStr(o.name, 120).trim() || 'Deck';
    return parseDeck(text).cards.length || parseDeck(text).basics.length ? { kind, at, name, text } : null;
  }
  return null;
}

/* ── Main de départ ────────────────────────────────────────────────────────────────────────────── */
/** Terrain ? D'après la ligne de type de la face avant (« Land », « Legendary Land »… ; une carte modale « Sort // Terrain » n'en est pas un). */
const isLandType = tl => /\bland\b/i.test(String(tl || '').split('//')[0]);
/** Bibliothèque d'un deck : un élément par exemplaire (commandants retirés : ils restent dans la zone de commandement). */
function libraryOf(items) {
  const out = [];
  for (const it of items || []) if (!it.cmd && !it.sb) for (let i = 0; i < Math.min(it.q || 0, 99); i++) out.push(it);
  return out;
}
/** n cartes tirées au hasard sans remise (Fisher-Yates partiel). rnd() → [0, 1). */
function drawHand(lib, n, rnd) {
  const a = lib.slice(), m = Math.min(n, a.length), r = rnd || Math.random;
  for (let i = 0; i < m; i++) { const j = i + Math.floor(r() * (a.length - i)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a.slice(0, m);
}
/** Loi hypergéométrique : probabilité d'avoir exactement k terrains (k = 0..n) en tirant n cartes d'un paquet de N cartes dont L terrains. */
function handLandOdds(N, L, n = 7) {
  const m = Math.min(n, N), lc = (a, b) => { if (b < 0 || b > a) return -Infinity; let s = 0; for (let i = 1; i <= b; i++) s += Math.log(a - b + i) - Math.log(i); return s; };
  const tot = lc(N, m), out = [];
  for (let k = 0; k <= m; k++) { const v = lc(L, k) + lc(N - L, m - k) - tot; out.push(Number.isFinite(v) ? Math.exp(v) : 0); }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cmOffer, cmUrl, cmText, deckMissing, deckUse, tradeLists, tradeWant, shareCard, readShare, SHARE_IMG_RE, scrySmall, imgShort, isLandType, libraryOf, drawHand, handLandOdds,
    parseLine, dropCard, restoreLines, sortCards, ctCardUrl, replaceParts, preferLang, forMode, needsEnglish, recapOf, CONDITIONS, COND_SHORT, normPart, normName, frontName, parseDeck, passes, normalizeProduct, optimize, allocate,
    hash32, mulberry32, makeDemoOffers, DEMO_SELLERS,
    sanitizeOpts, suggestName, sameKind, pushHistory, priceDelta, priceSeries, deckDoc, readDeck, relTime, newDeckId, HISTORY_MAX,
    sanitizeSnap, newestSnap, typeBucket, groupSnap, curveOf, snapAge, TYPE_ORDER, SNAP_MAX,
    eurCents, minRef, refInfo, refTotals, unitOf, pvOf, snapDeltas, topMovers, commanderKeys, canLead, DK_FORMATS, dkFormat, dkValue, dkColors, dkSideCards, dkBuildText, dkParse, dkCheck, dkFmtOf, dkMatch, dkCover, dkSetCover, dkCoverCard,
    ownKey, cardLang, langCode, merge3, sameEntry, unitPrice, cheapestOffer, pxSig, pxStale, parseCollection, mergeColl, unionColl, sameColl, collToText, collFromText, applyOwned, itemColors, itemType, filterItems, filterActive, collStats, srcPrice, canBeCommander, isCmdrType, cmdrClass, parseEdh, parseEdhBin, edhModelFromTsv, edhIndex, edhTokens, edhCmdHas, edhRank, EDH_KINDS, EDH_SORT_STEP, agoDay, edhThemeCounts, edhThemeOrder, edhDeckText, edhTier, edhBracket, EDH_TIERS, dayOf, histPush, histDelta, baseRoll, baseRef, pxMovers, buyMerge, buyClean, engClean, engTotal, engFree, engDecksOf, engSnapshot, engMerge, engSame, engActive, histMerge, histSame,
    lev, levw, nameIndex, lineVariants, matchName, frCatalog, frNames, frFront, collLines, collFromLines, collDomLang, collSig, matchFr, bestOf, FR_IMG, spanMatches, ocrMatches, bestMatch, coverMap, makeFpsWatch, frWords, extractShared };
}
