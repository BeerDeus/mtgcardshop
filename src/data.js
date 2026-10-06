/* ── data.js : réseau (Scryfall, CardTrader), cache, pipelines live et démo ─────────────────── */

const CTX = { proxy: false, needsKey: false, needsLogin: false, jobs: false, alerts: false, vapid: "", token: '', appKey: '', idToken: null };

const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal && signal.aborted) return rej(abortErr());
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(abortErr()); }, { once: true });
});
function abortErr() { const e = new Error('Annulé'); e.name = 'AbortError'; return e; }
function netErr(code, msg, extra) { const e = new Error(msg); e.code = code; Object.assign(e, extra || {}); return e; }

/** File d'attente cadencée : `rate` requêtes/s, `conc` en parallèle, ralentit seule sur 429/503. */
class Limiter {
  constructor({ rate = 6, conc = 4, min = 1, max = 10 } = {}) {
    Object.assign(this, { rate, conc, min, max, queue: [], active: 0, next: 0, count: 0, stamps: [], cool: 0 });
  }
  /** prio : requête demandée par un geste (aperçu d'une carte…) : passe devant les lectures de fond (collection, catalogue) qui attendent. */
  schedule(fn, signal, prio) {
    return new Promise((res, rej) => {
      const job = { fn, res, rej, signal, prio: !!prio };
      if (prio) { let i = 0; while (i < this.queue.length && this.queue[i].prio) i++; this.queue.splice(i, 0, job); } else this.queue.push(job);
      this.pump();
    });
  }
  pump() {
    while (this.queue.length && this.active < this.conc) {
      const job = this.queue.shift(); this.active++;
      const now = performance.now(); const at = Math.max(now, this.next);
      this.next = at + 1000 / this.rate;
      setTimeout(() => this.run(job), Math.max(0, at - now));
    }
  }
  async run(job) {
    try {
      if (job.signal && job.signal.aborted) throw abortErr();
      const r = await job.fn();
      this.count++; this.stamps.push(performance.now());
      job.res(r);
    } catch (e) { job.rej(e); }
    finally { this.active--; this.pump(); }
  }
  slow() { this.rate = Math.max(this.min, this.rate * 0.5); this.cool = performance.now() + 5000; }
  /** Pause globale : aucune requête de cette file ne part avant `ms` (429 → toutes les requêtes en attente respectent le délai). */
  pause(ms) { this.next = Math.max(this.next, performance.now() + ms); }
  speedUp() { if (performance.now() > this.cool) this.rate = Math.min(this.max, this.rate + 0.3); }
  rps() { const t = performance.now(); this.stamps = this.stamps.filter(s => t - s < 5000); return this.stamps.length / 5; }
}
const limCT = new Limiter({ rate: 6, conc: 5, max: 9 });
const limJob = new Limiter({ rate: 4, conc: 2, min: 2, max: 4 });   // suivi des tâches du serveur (léger : une requête toutes les ~0,7 s)
const limScry = new Limiter({ rate: 1.8, conc: 1, min: 0.5, max: 1.8 }); // Scryfall : /cards/search et /named limités à 2 req/s

const hostOf = u => { try { return new URL(u, typeof location !== 'undefined' ? location.href : 'http://x').host; } catch (e) { return ''; } };
/** Attentes (ms) avant nouvel essai. Scryfall bloque 30 s après un 429 : inutile (et risqué) de réessayer plus vite. */
const BACKOFF = { net: [700, 1400, 2100], scry: [1500, 6000, 31000], cool429: 30000, coolNet: 120000, maxGate: 130000 };
/** Cooldown Scryfall mémorisé (localStorage) : relancer pendant un blocage prolongerait la sanction. */
const SCRY_KEY = 'deckdeal:scry-until';
const scryUntil = () => { try { return Number(localStorage.getItem(SCRY_KEY)) || 0; } catch (e) { return 0; } };
const setScryUntil = t => { try { localStorage.setItem(SCRY_KEY, String(Math.min(t, Date.now() + BACKOFF.maxGate))); } catch (e) { /* stockage indisponible */ } };
const scryLeft = () => Math.max(0, Math.min(scryUntil() - Date.now(), BACKOFF.maxGate));

async function httpJson(lim, url, init, signal, retries = 4, prio = false) {
  const host = hostOf(url), scry = /scryfall/.test(host);
  for (let a = 0, n = 0; ;) {
    let r;
    try { r = await lim.schedule(() => fetch(url, Object.assign({}, init, { signal })), signal, prio); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      // Coupure passagère (réseau mobile, 429 sans en-têtes CORS…) : on ralentit puis on retente, sauf si l'appareil est hors ligne.
      lim.slow();
      const waits = scry ? BACKOFF.scry : BACKOFF.net;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (n < waits.length && !offline) { const w = waits[n++]; if (lim.onWait) lim.onWait(w, 'net'); await sleep(w, signal); continue; }
      if (scry && !offline) setScryUntil(Date.now() + BACKOFF.coolNet); // blocage probable : on évite de marteler à la relance
      throw netErr('network', 'Connexion impossible', { cause: e, host, offline });
    }
    if (r.status === 429 || r.status === 503) {
      lim.slow();
      if (a >= (scry ? 2 : retries)) throw netErr('rate', 'Trop de requêtes, réessaie dans un instant', { status: r.status, host });
      const ra = Number(r.headers.get('retry-after'));
      const wait = r.status === 429 && scry ? (Number.isFinite(ra) && r.headers.has('retry-after') ? Math.min(60000, ra * 1000) : BACKOFF.cool429) : 900 * (a + 1);
      lim.pause(wait); if (scry) setScryUntil(Date.now() + wait); if (lim.onWait) lim.onWait(wait, 'rate');
      await sleep(wait, signal); a++; continue;
    }
    if (r.status === 401 || r.status === 403) {
      let reason = ''; try { const b = await r.json(); reason = (b && b.error) || ''; } catch (e) { /* corps absent */ }
      throw netErr('auth', 'Accès refusé', { status: r.status, host, reason });   // reason : auth_required · forbidden · bad_token · token_expired · bad_app_key
    }
    if (r.status === 404) throw netErr('404', 'Introuvable', { status: 404 });
    if (!r.ok) {
      if (r.status >= 500 && a < retries) { await sleep(700 * (a + 1), signal); a++; continue; }
      let detail = '';
      try { const b = await r.json(); const m = b && (b.error || b.message || b.errors); detail = m ? (typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 160) : ''; } catch (e) { /* corps absent */ }
      throw netErr('http', 'Erreur ' + r.status + (detail ? ' : ' + detail : ''), { status: r.status, host, detail });
    }
    lim.speedUp();
    return r.json();
  }
}

/* ── Cache (IndexedDB, repli mémoire) ─────────────────────────────────────────────────────── */
const Cache = (() => {
  const mem = new Map(); let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        if (typeof indexedDB === 'undefined') return res(null);
        const r = indexedDB.open('deckdeal', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function get(k, maxAge) {
    const m = mem.get(k); if (m && Date.now() - m.t < maxAge) return m.v;
    const d = await db(); if (!d) return null;
    return new Promise(res => {
      try {
        const rq = d.transaction('kv').objectStore('kv').get(k);
        rq.onsuccess = () => { const v = rq.result; if (v && Date.now() - v.t < maxAge) { mem.set(k, v); res(v.v); } else res(null); };
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  async function set(k, v) {
    const rec = { v, t: Date.now() }; mem.set(k, rec);
    const d = await db(); if (!d) return;
    try { d.transaction('kv', 'readwrite').objectStore('kv').put(rec, k); } catch (e) { /* quota */ }
  }
  async function clear() {
    mem.clear(); const d = await db(); if (!d) return;
    try { d.transaction('kv', 'readwrite').objectStore('kv').clear(); } catch (e) { /* ignore */ }
  }
  return { get, set, clear };
})();
const DAY = 86400000;

/* ── Scryfall : toutes les impressions papier d'une carte ─────────────────────────────────── */
const imgOf = c => (c.image_uris && c.image_uris.small) || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris && c.card_faces[0].image_uris.small) || null;

/** Données de la carte (communes à toutes ses impressions) : coût converti, coût de mana, type, couleurs — pour le deck viewer. */
const eurOf = c => ({ eu: eurCents(c.prices && c.prices.eur), ef: eurCents(c.prices && c.prices.eur_foil) });   // prix de référence Cardmarket (euros → centimes), null si Scryfall n'en a pas
const metaOf = c => { const f0 = (c.card_faces && c.card_faces[0]) || {}; return { cmc: Number.isFinite(c.cmc) ? c.cmc : 0, mc: String(c.mana_cost || f0.mana_cost || '').slice(0, 60), tl: String(c.type_line || '').slice(0, 120), cl: (c.colors || f0.colors || []).join('') }; };

async function scryPrints(name, signal, exactDone = false) { // exactDone : la recherche exacte a déjà eu lieu dans un lot réussi → inutile de la refaire
  const search = async n => {
    const q = '!"' + n.replace(/"/g, '') + '" game:paper';
    let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(q) + '&unique=prints&order=released&include_extras=true&include_variations=true';
    const out = [];
    while (url && out.length < 600) {
      let j;
      try { j = await httpJson(limScry, url, { headers: { Accept: 'application/json' } }, signal); }
      catch (e) { if (e.code === '404') return out; throw e; }
      for (const c of j.data || []) {
        if (c.oversized || c.set_type === 'memorabilia') continue;
        out.push({ id: c.id, set: c.set, setName: c.set_name, num: c.collector_number, img: imgOf(c), name: c.name, ...eurOf(c), ...metaOf(c) });
      }
      url = j.has_more ? j.next_page : null;
    }
    return out;
  };
  let prints = exactDone ? [] : await search(name);
  if (!prints.length) { // nom approximatif (virgule oubliée, accent…) : on demande à Scryfall le nom exact
    try {
      const j = await httpJson(limScry, 'https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(name), { headers: { Accept: 'application/json' } }, signal);
      if (j && j.name) prints = await search(j.name);
    } catch (e) { if (e.name === 'AbortError' || e.code === 'network') throw e; }
  }
  return prints;
}

/** Plusieurs cartes en une seule recherche : (!"A" or !"B" …). Retourne Map(clé de deck → impressions) ; une carte
 *  absente du résultat n'est pas dans la Map (l'appelant la cherche alors seule, avec repli sur le nom approchant). */
const SCRY_JSON = { headers: { Accept: 'application/json' } };
const SCRY_BATCH = { names: 12, chars: 800, pages: 14 };
async function scryPrintsBatch(cards, signal) {
  const q = '(' + cards.map(c => '!"' + c.name.replace(/"/g, '') + '"').join(' or ') + ') game:paper';
  let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(q) + '&unique=prints&order=released&include_extras=true&include_variations=true';
  // nom de face (normalisé) → clés de deck concernées : « Fire // Ice », « Fire » ou « Ice » retombent tous sur la bonne carte
  const byFace = new Map();
  for (const c of cards) for (const f of new Set([c.key, frontName(c.key)])) { const a = byFace.get(f); if (a) a.push(c.key); else byFace.set(f, [c.key]); }
  const keysOf = name => {
    const out = new Set();
    for (const f of [normName(name), ...String(name).split('//').map(normPart)]) for (const k of byFace.get(f) || []) out.add(k);
    return out;
  };
  const got = new Map();
  for (let pages = 1; url; pages++) {
    if (pages > SCRY_BATCH.pages) throw netErr('batch', 'Lot trop volumineux'); // résultats tronqués : on se replie sur la recherche carte par carte
    let j;
    try { j = await httpJson(limScry, url, SCRY_JSON, signal); }
    catch (e) { if (e.code === '404') break; throw e; }
    for (const c of j.data || []) {
      if (c.oversized || c.set_type === 'memorabilia') continue;
      const pr = { id: c.id, set: c.set, setName: c.set_name, num: c.collector_number, img: imgOf(c), name: c.name, ...eurOf(c), ...metaOf(c) };
      for (const k of keysOf(c.name)) { let a = got.get(k); if (!a) got.set(k, a = []); if (a.length < 600) a.push(pr); }
    }
    url = j.has_more ? j.next_page : null;
  }
  return got;
}
/** Découpe en lots : ≤ 12 noms et ≤ 800 caractères de requête (l'URL reste courte). */
function scryChunks(cards) {
  const out = []; let cur = [], len = 0;
  for (const c of cards) {
    const l = c.name.length + 8;
    if (cur.length && (cur.length >= SCRY_BATCH.names || len + l > SCRY_BATCH.chars)) { out.push(cur); cur = []; len = 0; }
    cur.push(c); len += l;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Image de carte en grand, dans la langue de l'offre (Scryfall ne l'a pas toujours : repli sur l'anglais, signalé par `missing`). */
const SCRY_LANG = { fr: 'fr', en: 'en', de: 'de', es: 'es', it: 'it', pt: 'pt', jp: 'ja', kr: 'ko', ru: 'ru', 'zh-CN': 'zhs', 'zh-TW': 'zht' };
const bigOf = u => u && (u.large || u.normal || u.small);
const facesOf = c => c.image_uris ? [bigOf(c.image_uris)].filter(Boolean) : (c.card_faces || []).map(f => bigOf(f.image_uris)).filter(Boolean);
async function scryImage({ set, num, lang }, signal) {
  const sl = SCRY_LANG[lang] || 'en';
  if (!set || !num) return null;
  const key = 'im:' + set + ':' + num + ':' + sl;
  const hit = await Cache.get(key, 7 * DAY); if (hit) return hit;
  const base = 'https://api.scryfall.com/cards/' + encodeURIComponent(set) + '/' + encodeURIComponent(num);
  const get = async l => {
    try { const j = await httpJson(limScry, base + (l === 'en' ? '' : '/' + l), SCRY_JSON, signal, 4, true); const urls = facesOf(j); return urls.length ? { urls, lang: j.lang || l } : null; }
    catch (e) { if (e.code === '404') return null; throw e; }
  };
  let r = await get(sl);
  if (!r && sl !== 'en') { r = await get('en'); if (r) r.missing = sl; }
  if (r) await Cache.set(key, r);
  return r;
}

/** Toutes les impressions papier d'une carte dans une langue, les plus récentes d'abord : [{ set, num, sn (extension), y (année), th (vignette), urls (grande image de chaque face), fx (particularités) }].
 *  [] si Scryfall n'en a pas dans cette langue. Gardées 7 jours. */
async function scryArtPrints(name, lang, signal) {
  const sl = SCRY_LANG[lang] || 'en', n = String(name || '').split('//')[0].trim();
  if (!n || n.includes('"')) return [];
  const key = 'pr2:' + ownKey(n) + ':' + sl, hit = await Cache.get(key, 7 * DAY); if (hit) return hit;
  const out = await scryPrintsIn(n, sl, signal);
  if (sl !== 'en') {      // impressions qui n'existent qu'en anglais (promos, séries spéciales…) : après celles de la langue affichée, marquées « anglais »
    const have = new Set(out.map(p => p.set + '/' + p.num));
    for (const p of await scryPrintsIn(n, 'en', signal)) if (!have.has(p.set + '/' + p.num)) out.push({ ...p, l: 'en', fx: [...p.fx, 'anglais'] });
  }
  await Cache.set(key, out);
  return out;
}
async function scryPrintsIn(n, sl, signal) {
  let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent('!"' + n + '" lang:' + sl + ' game:paper') + '&unique=prints&order=released&dir=desc';
  const out = [], seen = new Set();
  for (let pg = 0; url && pg < 3; pg++) {
    let j; try { j = await httpJson(limScry, url, SCRY_JSON, signal, 4, true); } catch (e) { if (e.code === '404') j = { data: [] }; else throw e; }
    for (const c of j.data || []) {
      const urls = facesOf(c), im = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {}, id = c.set + '/' + c.collector_number;
      if (!urls.length || seen.has(id)) continue; seen.add(id);
      const fe = c.frame_effects || [], fx = [c.full_art ? 'plein art' : '', c.border_color === 'borderless' ? 'sans bordure' : '', fe.includes('extendedart') ? 'étendue' : '', fe.includes('showcase') ? 'showcase' : '', c.promo ? 'promo' : ''].filter(Boolean);
      out.push({ set: c.set, num: c.collector_number, sn: c.set_name || '', y: String(c.released_at || '').slice(0, 4), th: im.small || urls[0], urls, fx, l: sl });
    }
    url = j.has_more ? j.next_page : '';
  }
  return out;
}

/** Infos Scryfall d'une liste de cartes par leur nom (75 par requête) : Map(clé de collection → { cm, mc, tl, cl, ci, cd, im, eu } | null si inconnue). */
async function scryCollection(names, signal, onProgress) {
  const out = new Map(), uniq = [...new Map(names.map(n => [ownKey(n), n])).entries()];
  for (let i = 0; i < uniq.length; i += 75) {
    const chunk = uniq.slice(i, i + 75);
    const body = JSON.stringify({ identifiers: chunk.map(([, n]) => ({ name: String(n).split('//')[0].trim() })) });
    const j = await httpJson(limScry, 'https://api.scryfall.com/cards/collection', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body }, signal);
    for (const c of j.data || []) { const m = metaOf(c); out.set(ownKey(c.name), { cm: m.cmc, mc: m.mc, tl: m.tl, cl: m.cl, ci: (c.color_identity || []).join(''), cd: canBeCommander(c), im: imgOf(c) || '', eu: eurCents(c.prices && c.prices.eur) }); }
    for (const [k] of chunk) if (!out.has(k)) out.set(k, null);
    if (onProgress) onProgress(Math.min(uniq.length, i + 75), uniq.length);
  }
  return out;
}
/** Tous les noms de cartes (anglais) : sert à reconnaître un nom lu par OCR. Gardé 14 jours sur l'appareil (~1 Mo). */
async function scryCatalogNames(signal) {
  const hit = await Cache.get('sc:names', 14 * DAY); if (hit && hit.length > 1000) return hit;
  const j = await httpJson(limScry, 'https://api.scryfall.com/catalog/card-names', SCRY_JSON, signal);
  const list = Array.isArray(j && j.data) ? j.data.filter(x => typeof x === 'string') : [];
  if (list.length > 1000) await Cache.set('sc:names', list);
  return list;
}
/** Cartes imprimées en langue `lang` dont le nom contient ces mots (2 au plus, lettres seules) : [{ name (anglais), printed }]. Expérimental : sert aux cartes françaises. */
async function scryForeign(words, lang, signal) {
  const w = (words || []).map(x => String(x).replace(/[^\p{L}]/gu, '')).filter(x => x.length >= 3).slice(0, 2);
  if (!w.length) return [];
  const q = 'lang:' + lang + ' ' + w.map(x => 'name:' + x).join(' ');
  let j;
  try { j = await httpJson(limScry, 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(q) + '&unique=cards&order=name', SCRY_JSON, signal); }
  catch (e) { if (e.code === '404') return []; throw e; }
  return (j.data || []).slice(0, 30).map(c => ({ name: c.name, printed: c.printed_name || c.name, img: imgOf(c) || '' }));
}
/* ── Catalogue des noms français (reconnaissance des cartes françaises, hors ligne et tolérante aux fautes de lecture) ──────────
   Scryfall n'a pas de liste de noms imprimés : on parcourt la recherche « lang:fr » (175 cartes par page, ~180 pages (≈ 31 000 cartes mesurées), 2 requêtes/s). Fait une seule fois,
   gardé sur l'appareil (« nom imprimé \t nom anglais \t image », ~2,5 Mo), repris là où il en était si interrompu, puis complété des nouveautés tous les 14 jours. */
const FR_KEY = 'sc:fr', FR_PART = 'sc:fr:part', FR_FRESH = 14 * DAY, FR_PAGES = 180, FR_STATIC = 'fr-names.tsv';
/** Une carte Scryfall imprimée en français → « nom imprimé \t nom anglais \t image » (image : chemin après /small/, sans paramètre), ou '' sans nom imprimé. */
function frRow(c) {
  if (!c || (c.lang && c.lang !== 'fr')) return '';
  const f = c.card_faces || [], p = c.printed_name || (f.length > 1 ? f.map(x => x.printed_name || x.name).join(' // ') : '');
  if (!p || !c.name) return '';
  const u = imgOf(c) || '', m = /\/small\/([^?]+)/.exec(u);
  return p + '\t' + c.name + '\t' + (m ? m[1] : '');
}
const frRowKey = r => r.split('\t').slice(0, 2).join('\t');
/** Suit les pages d'une recherche (next_page) : onPage(lignes de la page, total annoncé, page suivante) après chaque page. Retourne toutes les lignes. */
async function scryFrPages(url, signal, onPage) {
  const rows = [];
  while (url) {
    let j; try { j = await httpJson(limScry, url, SCRY_JSON, signal); } catch (e) { if (e.code === '404') break; throw e; }   // 404 : aucune carte (mise à jour sans nouveauté)
    const got = (j.data || []).map(frRow).filter(Boolean); for (const r of got) rows.push(r);
    url = j.has_more && typeof j.next_page === 'string' && /^https:\/\/api\.scryfall\.com\//.test(j.next_page) ? j.next_page : '';
    if (onPage) await onPage(got, j.total_cards || 0, url);
  }
  return rows;
}
const frSearchUrl = q => 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(q) + '&unique=cards&order=name';
/** Catalogue français sur l'appareil, s'il est complet : { rows, at } ou null. */
async function scryFrCached() { const c = await Cache.get(FR_KEY, 3650 * DAY); return c && Array.isArray(c.rows) && c.rows.length > 500 ? c : null; }
/** Catalogue prêt à l'emploi servi par le site (fr-names.tsv, régénéré chaque semaine par GitHub Actions : mêmes lignes « imprimé \t anglais \t image », ≈ 1,3 Mo compressé) :
 *  1 requête au lieu de ≈ 180 chez Scryfall. null s'il manque ou s'il est trop court (appli ouverte hors http, fichier pas encore généré) → on pagine chez Scryfall. */
async function scryFrStatic(signal) {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  let r; try { r = await fetch(new URL(FR_STATIC, location.href).href, { signal, cache: 'no-cache' }); } catch (e) { if (e.name === 'AbortError') throw e; return null; }
  if (!r.ok) return null;
  let t; try { t = await r.text(); } catch (e) { if (e.name === 'AbortError') throw e; return null; }
  const rows = t.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l && l[0] !== '#' && l.split('\t').length >= 2);
  if (rows.length < 500) return null;
  const rec = { rows, at: Date.now() }; await Cache.set(FR_KEY, rec); await Cache.set(FR_PART, null); return rec;
}
/** Télécharge (ou reprend, ou met à jour) le catalogue : retourne { rows, at }. onProgress(fait, total). Une mise à jour qui échoue garde l'ancien catalogue. */
async function scryFrCatalog(signal, onProgress) {
  const hit = await scryFrCached();
  if (hit && Date.now() - hit.at < FR_FRESH) return hit;
  const pre = await scryFrStatic(signal); if (pre) return pre;                     // fichier du site d'abord (rapide), Scryfall seulement s'il manque
  if (hit) {
    const since = new Date(hit.at - 30 * DAY).toISOString().slice(0, 10);          // nouveautés : impressions françaises sorties depuis le dernier passage (30 jours de marge)
    try {
      const add = await scryFrPages(frSearchUrl('lang:fr date>=' + since), signal);
      const by = new Map(hit.rows.map(r => [frRowKey(r), r])); for (const r of add) by.set(frRowKey(r), r);
      const rec = { rows: [...by.values()], at: Date.now() }; await Cache.set(FR_KEY, rec); return rec;
    } catch (e) { if (e.name === 'AbortError') throw e; return hit; }
  }
  const part = await Cache.get(FR_PART, 30 * DAY);                                  // reprise d'un téléchargement interrompu
  let rows = part && Array.isArray(part.rows) ? part.rows : [], url = part && part.next ? part.next : frSearchUrl('lang:fr'), pages = 0, total = part && part.total || 0;
  if (part && part.next === '') url = '';
  if (url) {
    await scryFrPages(url, signal, async (got, t, next) => {
      for (const r of got) rows.push(r); if (t) total = t; pages++;
      if (onProgress) onProgress(rows.length, total || FR_PAGES * 175);
      if (pages % 8 === 0 && next) await Cache.set(FR_PART, { rows: rows.slice(), next, total });      // copie : le point de reprise ne grossit pas avec les pages suivantes
    });
  }
  const seen = new Set(); rows = rows.filter(r => { const k = frRowKey(r); if (seen.has(k)) return false; seen.add(k); return true; });
  if (rows.length < 500) throw netErr('http', 'Catalogue français incomplet');
  const rec = { rows, at: Date.now() }; await Cache.set(FR_KEY, rec); await Cache.set(FR_PART, null);
  return rec;
}
/** Images (petites) de cartes dans une autre langue que l'anglais : Map(clé de collection → url, '' si Scryfall n'a pas la carte dans cette langue). Une recherche pour 12 noms. */
async function scryLangImages(names, lang, signal, onProgress, prio = false) {
  const sl = SCRY_LANG[lang], out = new Map();
  if (!sl || sl === 'en') return out;
  const uniq = [...new Map(names.map(n => [ownKey(n), String(n).split('//')[0].trim()])).entries()].filter(([, n]) => n && !n.includes('"'));
  for (let i = 0; i < uniq.length; i += 12) {
    const chunk = uniq.slice(i, i + 12), q = '(' + chunk.map(([, n]) => '!"' + n + '"').join(' or ') + ') lang:' + sl;
    let j; try { j = await httpJson(limScry, 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(q) + '&unique=cards', SCRY_JSON, signal, 4, prio); }
    catch (e) { if (e.code === '404') j = { data: [] }; else throw e; }
    for (const c of j.data || []) { const u = imgOf(c); if (u) out.set(ownKey(c.name), u); }
    for (const [k] of chunk) if (!out.has(k)) out.set(k, '');
    if (onProgress) onProgress(Math.min(uniq.length, i + 12), uniq.length);
  }
  return out;
}

/* ── CardTrader ───────────────────────────────────────────────────────────────────────────── */
async function ct(path, { method = 'GET', params, body, signal, lim = limCT } = {}) {
  if (!CTX.proxy && !CTX.token) throw netErr('notoken', 'Token CardTrader manquant');
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const url = CTX.proxy ? 'api/' + path + qs : 'https://api.cardtrader.com/api/v2/' + path + qs;
  const call = async force => {
    const headers = { Accept: 'application/json' };
    if (CTX.proxy) {
      if (CTX.appKey) headers['x-app-key'] = CTX.appKey;
      if (CTX.needsLogin && CTX.idToken) { const t = await CTX.idToken(force); if (t) headers['x-firebase-token'] = t; } // jeton Firebase : le proxy vérifie que c'est bien ton compte
    } else headers.Authorization = 'Bearer ' + CTX.token;
    if (body) headers['Content-Type'] = 'application/json';
    return httpJson(lim, url, { method, headers, body: body ? JSON.stringify(body) : undefined }, signal);
  };
  try { return await call(false); }
  catch (e) { if (e.code === 'auth' && e.reason === 'token_expired' && CTX.idToken) return call(true); throw e; } // jeton périmé : on force son renouvellement, une seule fois
}

async function getExpansions(signal) {
  let list = await Cache.get('ct:expansions', 3 * DAY);
  if (!list) {
    const j = await ct('expansions', { signal });
    list = (Array.isArray(j) ? j : []).filter(e => e.game_id === 1).map(e => ({ id: e.id, code: String(e.code || '').toLowerCase(), name: e.name }));
    await Cache.set('ct:expansions', list);
  }
  const byCode = new Map(), byName = new Map();
  for (const e of list) { byCode.set(e.code, e.id); byName.set(normPart(e.name), e.id); }
  return { byCode, byName };
}

async function getBlueprints(expId, signal) {
  let list = await Cache.get('ct:bp:' + expId, 7 * DAY);
  if (!list) {
    const j = await ct('blueprints/export', { params: { expansion_id: expId }, signal });
    list = (Array.isArray(j) ? j : []).map(b => ({ id: b.id, name: b.name, sid: b.scryfall_id || null }));
    await Cache.set('ct:bp:' + expId, list);
  }
  const byScry = new Map(), byName = new Map();
  for (const b of list) {
    if (b.sid) byScry.set(b.sid, b);
    const f = frontName(b.name);
    if (!byName.has(f)) byName.set(f, []);
    byName.get(f).push(b);
  }
  return { byScry, byName };
}

function mapBlueprints(card, prints, exps, bpIndex) {
  const out = new Map(); const front = frontName(card.name);
  for (const p of prints) {
    const eid = exps.byCode.get(p.set) || exps.byName.get(normPart(p.setName));
    const idx = eid && bpIndex.get(eid); if (!idx) continue;
    const direct = idx.byScry.get(p.id);
    const hits = direct ? [direct] : (idx.byName.get(front) || []);
    for (const b of hits) if (!out.has(b.id)) out.set(b.id, { id: b.id, set: p.set, setName: p.setName, num: p.num, img: p.img, eu: p.eu ?? null, ef: p.ef ?? null });
  }
  return [...out.values()];
}

async function fetchBpRaw(id, lang, foil, signal) {
  const params = { blueprint_id: id };
  if (lang) params.language = lang;
  if (foil === 'no') params.foil = 'false'; else if (foil === 'yes') params.foil = 'true';
  const j = await ct('marketplace/products', { params, signal });
  return Array.isArray(j) ? j : Object.values(j || {}).flat();
}
async function fetchBpOffers(bp, lang, foil, signal) { return (await fetchBpRaw(bp.id, lang, foil, signal)).map(p => normalizeProduct(p, bp)); }

/**
 * Lecture des offres de plusieurs blueprints par une TÂCHE DU SERVEUR : une seule cadence vers CardTrader (≤ 10 req/s),
 * la boucle continue même si l'application passe en arrière-plan ou se ferme, et un cache court évite de relire deux fois.
 * Relancer la même recherche se rattache à la tâche en cours (ou terminée). onItem({bp, products|error}) · onInfo(état de la tâche).
 */
async function jobOffers(ids, lang, foil, { fresh = false, signal, onItem, onInfo, push = null }) {
  const want = new Set(ids), kill = id => { ct('jobs/' + id, { method: 'DELETE', lim: limJob }).catch(() => {}); };
  const down = (e, why) => Object.assign(netErr('jobs', why || 'Tâches du serveur indisponibles', { cause: e }), { jobsDown: true });
  for (let attempt = 0; want.size; attempt++) {
    if (attempt >= 3) throw down(null, 'Recherche serveur interrompue à plusieurs reprises');
    let st;
    try { st = await ct('jobs', { method: 'POST', body: { type: 'offers', lang: lang || '', foil: foil === 'no' || foil === 'yes' ? foil : 'any', bps: [...want], fresh: !!fresh && attempt === 0, push: push || undefined }, signal, lim: limJob }); }
    catch (e) { if (e.name === 'AbortError' || e.code === 'auth' || e.code === 'network') throw e; throw down(e); }   // 404 (désactivées) · 429 (serveur occupé) · 400 : on retombe sur la lecture depuis l'appareil
    const onAbort = () => kill(st.id); signal && signal.addEventListener('abort', onAbort, { once: true });
    let from = 0, lost = false, bad = 0;
    try {
      for (;;) {
        let r;
        try { r = await ct('jobs/' + st.id, { params: { from }, signal, lim: limJob }); bad = 0; }
        catch (e) {
          if (e.name === 'AbortError' || e.code === 'auth') throw e;
          if (e.code === '404') { lost = true; break; }                              // serveur redémarré : on relance pour ce qui manque
          if (++bad > 8) throw e;                                                    // réseau mobile capricieux : la tâche continue côté serveur, on retente
          await sleep(2000, signal); continue;
        }
        for (const it of r.items) if (want.delete(it.bp)) onItem(it);
        from = r.next; if (onInfo) onInfo(r, !!st.attached);
        if (r.status === 'failed' && r.fatal) throw netErr('auth', 'Accès refusé', { status: r.fatal, host: '', reason: '' });
        if (r.status !== 'running' && from >= r.count) { if (r.status === 'cancelled' || r.status === 'failed') lost = true; break; }
        if (from >= r.count) await sleep(650, signal);                               // plus rien de nouveau : on laisse le serveur avancer
      }
    } finally { signal && signal.removeEventListener('abort', onAbort); }
    if (!lost) return;                                                               // tâche terminée : ce qui manquerait encore sera lu depuis l'appareil
  }
}

/**
 * Une passe d'offres pour un groupe de cartes dans une langue : tâche serveur si le serveur la propose, sinon blueprint par blueprint.
 * entries : [{ c, bps, img }] · onCard(entry, offers) quand TOUTES les offres d'une carte sont arrivées · onTick(done, total, info) · retourne { total, cacheAge, mode }
 */
async function offersPass(entries, lang, opts, signal, onCard, onTick) {
  const owners = new Map(), ids = [], pend = new Map(), acc = new Map(), seen = new Set(); let done = 0, cacheAge = 0, firstInfo = true, mode = 'client';
  for (const e of entries) {
    pend.set(e, e.bps.length); acc.set(e, []);
    for (const bp of e.bps) { if (!owners.has(bp.id)) { owners.set(bp.id, []); ids.push(bp.id); } owners.get(bp.id).push({ e, bp }); }
  }
  const total = ids.length;
  for (const e of entries) if (!e.bps.length) onCard(e, []);
  const got = (id, raw) => {
    if (seen.has(id)) return; seen.add(id); done++;
    for (const { e, bp } of owners.get(id)) { if (raw) acc.get(e).push(...raw.map(p => normalizeProduct(p, bp))); const n = pend.get(e) - 1; pend.set(e, n); if (n === 0) onCard(e, acc.get(e)); }
  };
  if (total && CTX.proxy && CTX.jobs) {
    try {
      mode = 'job';
      await jobOffers(ids, lang, opts.foil, { fresh: opts.fresh, push: opts.push, signal, onItem: it => { got(it.bp, it.error ? null : it.products); },
        onInfo: (r, attached) => {
          // Âge des prix servis « d'avance » : cache lu au lancement ; ou, si on se rattache à une tâche existante, âge de ses données à cet instant (relevé une seule fois).
          const a = attached ? (firstInfo ? r.dataAge : 0) : r.cacheAge; firstInfo = false; cacheAge = Math.max(cacheAge, a || 0);
          onTick(done, total, { mode, sent: r.sent, cached: r.cached, rps: r.rps, cacheAge });
        } });
    } catch (e) { if (!e.jobsDown) throw e; CTX.jobs = false; mode = 'client'; }   // tâches indisponibles : on continue depuis l'appareil
  }
  const rest = ids.filter(id => !seen.has(id));
  if (rest.length) {
    if (mode === 'job') mode = 'client';
    await pool(rest, 5, async id => {
      let raw = null;
      try { raw = await fetchBpRaw(id, lang, opts.foil, signal); }
      catch (e) { if (e.name === 'AbortError' || e.code === 'auth' || e.code === 'network' || e.code === 'notoken') throw e; }
      got(id, raw); onTick(done, total, { mode: 'client' });
    });
  }
  return { total, cacheAge, mode };
}

async function pool(items, n, fn) {
  let i = 0; const errs = [];
  const worker = async () => { while (i < items.length) { const it = items[i++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return errs;
}

/**
 * Pipeline live. hooks : step(id,state,detail) · progress(frac) · rate(rps,total) · card(key,payload)
 * payload : {offers, bps, img, notFound, fellBack}
 */
async function runLive(cards, opts, hooks, signal) {
  const total = cards.length;
  hooks.step('prints', 'run', '0 / ' + total);
  const printsOf = {}; let done = 0;
  const label = () => done + ' / ' + total;
  // Pause visible quand Scryfall demande de ralentir (429) ou ne répond plus, au lieu d'un écran qui semble figé.
  limScry.onWait = (ms, kind) => hooks.step('prints', 'run', (kind === 'rate' ? 'Scryfall demande une pause · ' : 'Nouvelle tentative · ') + Math.ceil(ms / 1000) + ' s');
  // Cooldown mémorisé d'un essai précédent : on attend au lieu de relancer pendant le blocage.
  let gate = null;
  const scryGate = () => {
    if (!scryLeft()) return null;
    return gate || (gate = (async () => {
      try { for (let l; (l = scryLeft()) > 0;) { hooks.step('prints', 'run', 'Scryfall en pause · ' + Math.ceil(l / 1000) + ' s'); await sleep(Math.min(1000, l), signal); } }
      finally { gate = null; hooks.step('prints', 'run', label()); }
    })());
  };
  try {
    // 1) cache (3 jours) · 2) recherche groupée par lots · 3) carte par carte pour les absentes (nom approximatif, lot en échec)
    await pool(cards, 6, async c => { const pr = await Cache.get('sc:' + c.key, 3 * DAY); if (pr && pr.length && pr[0].cmc !== undefined && pr[0].eu !== undefined) { printsOf[c.key] = pr; done++; } });   // 3 jours (les prix de référence bougent) ; anciennes entrées sans coût de mana ou sans prix : relues une fois
    hooks.step('prints', 'run', label()); hooks.progress(0.15 * done / total);
    const single = [];
    for (const chunk of scryChunks(cards.filter(c => !printsOf[c.key]))) {
      await scryGate();
      let got = null;
      if (chunk.length > 1) { // une carte seule : inutile de passer par un lot
        try { got = await scryPrintsBatch(chunk, signal); }
        catch (e) { if (e.name === 'AbortError' || e.code === 'network' || e.code === 'rate' || e.code === 'auth') throw e; }
      }
      for (const c of chunk) {
        const pr = got && got.get(c.key);
        if (pr && pr.length) { printsOf[c.key] = pr; done++; await Cache.set('sc:' + c.key, pr); } else single.push([c, !!got]);
      }
      hooks.step('prints', 'run', label()); hooks.progress(0.15 * done / total);
    }
    await pool(single, 3, async ([c, exactDone]) => {
      await scryGate();
      const pr = await scryPrints(c.name, signal, exactDone); if (pr.length) await Cache.set('sc:' + c.key, pr);
      printsOf[c.key] = pr; done++;
      hooks.step('prints', 'run', label()); hooks.progress(0.15 * done / total);
    });
  } finally { limScry.onWait = null; }
  hooks.step('prints', 'done', total + ' cartes');

  hooks.step('catalog', 'run', 'Extensions…');
  const exps = await getExpansions(signal);
  const skip = opts.skip || new Set();                     // cartes déjà possédées en totalité : on lit leurs impressions (image, coût) mais pas leurs offres
  const needed = new Set();
  for (const c of cards) if (!skip.has(c.key)) for (const p of printsOf[c.key]) {
    const eid = exps.byCode.get(p.set) || exps.byName.get(normPart(p.setName)); if (eid) needed.add(eid);
  }
  const bpIndex = new Map(); let bd = 0; const ids = [...needed];
  await pool(ids, 4, async id => {
    bpIndex.set(id, await getBlueprints(id, signal)); bd++;
    hooks.step('catalog', 'run', bd + ' / ' + ids.length + ' extensions'); hooks.progress(0.15 + 0.25 * bd / ids.length);
  });
  hooks.step('catalog', 'done', ids.length + ' extensions');

  const plan = cards.map(c => ({ c, bps: mapBlueprints(c, printsOf[c.key], exps, bpIndex) }));
  const store = {}; const entries = [];
  for (const { c, bps } of plan) {
    const p0 = printsOf[c.key][0] || {}, img = p0.img || null, meta = p0.cmc !== undefined ? { cm: p0.cmc, mc: p0.mc, tl: p0.tl, cl: p0.cl } : null;
    if (!printsOf[c.key].length) { hooks.card(c.key, { offers: [], bps: [], img, notFound: true }); continue; }
    if (skip.has(c.key)) { hooks.card(c.key, { offers: [], bps: [], img, meta, skipped: true }); continue; }
    store[c.key] = { bps, img }; entries.push({ c, bps, img, meta });
  }
  const reqTotal = entries.reduce((a, e) => a + e.bps.length, 0) || 1, t0 = performance.now();
  hooks.step('offers', 'run', '0 / ' + reqTotal);
  // Progression : en mode serveur, la cadence et le nombre de requêtes sont ceux du serveur ; sinon ceux de cet appareil.
  const tick = base => (done, total, info) => {
    hooks.step('offers', 'run', done + ' / ' + total); hooks.progress(base.from + (base.to - base.from) * done / Math.max(1, total));
    if (info && info.mode === 'job') { hooks.hint(true); hooks.rate(info.rps || 0, info.sent || 0, info.cached ? info.cached + ' depuis le cache' : ''); } else { hooks.hint(false); hooks.rate(limCT.rps(), limCT.count); }
  };
  const first = await offersPass(entries, opts.lang, opts, signal, (e, offers) => hooks.card(e.c.key, { offers, bps: e.bps, img: e.img, meta: e.meta }), tick({ from: 0.4, to: 0.95 }));
  hooks.cacheAge(first.cacheAge);
  hooks.step('offers', 'done', first.mode === 'job' ? 'sur le serveur · ' + Math.max(1, Math.round((performance.now() - t0) / 1000)) + ' s' : first.total + ' requêtes · ' + Math.max(1, Math.round((performance.now() - t0) / 1000)) + ' s');

  if (opts.fallbackEn && opts.lang !== 'en') {
    const miss = entries.filter(e => e.bps.length && hooks.needsEn(e.c.key));
    if (miss.length) {
      hooks.step('fallback', 'run', '0 / ' + miss.length); let fd = 0;
      const second = await offersPass(miss, 'en', opts, signal, (e, offers) => {
        fd++; hooks.step('fallback', 'run', fd + ' / ' + miss.length);
        hooks.card(e.c.key, { offers, bps: e.bps, img: e.img, meta: e.meta, fellBack: true });
      }, (done, total, info) => { hooks.progress(0.95 + 0.05 * fd / miss.length); if (info && info.mode === 'job') hooks.rate(info.rps || 0, info.sent || 0, info.cached ? info.cached + ' depuis le cache' : ''); });
      hooks.cacheAge(second.cacheAge);
      hooks.step('fallback', 'done', miss.length + ' cartes');
    } else hooks.step('fallback', 'skip', 'Inutile');
  } else hooks.step('fallback', 'skip', 'Désactivé');
  hooks.hint(false);
  hooks.progress(1);
}

/** Recherche en anglais pour une seule carte (depuis la fiche carte). */
async function searchOneEnglish(card, st, opts, signal) {
  const all = [];
  await Promise.all((st.bps || []).map(async bp => { try { all.push(...await fetchBpOffers(bp, 'en', opts.foil, signal)); } catch (e) { if (e.name === 'AbortError') throw e; } }));
  return all;
}

/* ── Pipeline démo : mêmes hooks, données simulées ────────────────────────────────────────── */
async function runDemo(cards, opts, hooks, signal) {
  const total = cards.length;
  hooks.step('prints', 'run', '0 / ' + total);
  for (let i = 0; i < total; i++) { await sleep(14 + (hash32(cards[i].key) % 16), signal); hooks.step('prints', 'run', (i + 1) + ' / ' + total); hooks.progress(0.15 * (i + 1) / total); }
  hooks.step('prints', 'done', total + ' cartes');
  hooks.step('catalog', 'run', 'Extensions…');
  const nExp = 9; for (let i = 1; i <= nExp; i++) { await sleep(70, signal); hooks.step('catalog', 'run', i + ' / ' + nExp + ' extensions'); hooks.progress(0.15 + 0.25 * i / nExp); }
  hooks.step('catalog', 'done', nExp + ' extensions');
  hooks.step('offers', 'run', '0 / ' + total);
  let reqs = 0; const t0 = performance.now();
  const skip = opts.skip || new Set();
  for (let i = 0; i < total; i++) {
    const c = cards[i];
    if (skip.has(c.key)) { hooks.card(c.key, { offers: [], bps: [], img: null, skipped: true }); hooks.step('offers', 'run', (i + 1) + ' / ' + total); hooks.progress(0.4 + 0.55 * (i + 1) / total); continue; }
    await sleep(38 + (hash32(c.key + 'z') % 70), signal);
    reqs += 4 + (hash32(c.key) % 7);
    hooks.card(c.key, { offers: makeDemoOffers(c, opts.lang), bps: [{ id: 1 }], img: null });
    hooks.step('offers', 'run', (i + 1) + ' / ' + total);
    hooks.progress(0.4 + 0.55 * (i + 1) / total);
    hooks.rate(reqs / Math.max(1, (performance.now() - t0) / 1000), reqs);
  }
  hooks.step('offers', 'done', reqs + ' requêtes simulées');
  if (opts.fallbackEn && opts.lang !== 'en') {
    const miss = cards.filter(c => !skip.has(c.key) && hooks.needsEn(c.key));
    if (miss.length) {
      hooks.step('fallback', 'run', '0 / ' + miss.length);
      for (let i = 0; i < miss.length; i++) {
        await sleep(160, signal);
        hooks.card(miss[i].key, { offers: makeDemoOffers(miss[i], 'en'), bps: [{ id: 1 }], img: null, fellBack: true });
        hooks.step('fallback', 'run', (i + 1) + ' / ' + miss.length); hooks.progress(0.95 + 0.05 * (i + 1) / miss.length);
      }
      hooks.step('fallback', 'done', miss.length + ' cartes');
    } else hooks.step('fallback', 'skip', 'Inutile');
  } else hooks.step('fallback', 'skip', 'Désactivé');
  hooks.progress(1);
}

/* ── Panier ───────────────────────────────────────────────────────────────────────────────── */
/** Contenu du panier CardTrader : lignes {productId, quantity, name} + sous-total. Aucun achat, lecture seule. */
async function cartRead(signal) {
  const cart = await ct('cart', { signal });
  const items = [];
  for (const sc of (cart && cart.subcarts) || []) for (const it of sc.cart_items || []) {
    const pid = Number(it.product && it.product.id), q = Number(it.quantity);
    if (Number.isFinite(pid) && pid > 0 && q > 0) items.push({ productId: pid, quantity: q, name: (it.product && it.product.name_en) || String(pid) });
  }
  return { items, subtotal: cart && cart.subtotal };
}

/** Vide le panier : l'API n'a pas de « tout supprimer », on retire chaque ligne (quantité exacte lue dans le panier). */
async function cartClear(items, signal, onItem) {
  const failed = []; let ok = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try { await ct('cart/remove', { method: 'POST', body: { product_id: it.productId, quantity: it.quantity }, signal }); ok++; }
    catch (e) {
      if (e.name === 'AbortError' || e.code === 'auth' || e.code === 'network') throw e;
      failed.push({ name: it.name, reason: e.message });
    }
    if (onItem) onItem(i + 1, items.length);
  }
  return { ok, failed };
}

/**
 * Ajoute les offres au panier. Si une offre n'est plus disponible, essaie des offres de remplacement (part.alt(exclus, besoin) → [{offer,n}]).
 * Retourne {ok, failed:[{name,reason}], replaced:[{name, from, n, to:[{offer,n}], missing}], gone:[productId]}.
 * Garde-fou : si les remplacements échouent à leur tour avec le même message sur 2 lignes de suite, l'erreur n'est pas propre à l'offre
 * (adresse, compte…) : on arrête d'en essayer d'autres et on la signale telle quelle.
 */
async function cartFill(parts, mode, address, signal, onItem, demo) {
  const failed = [], replaced = [], gone = [], added = []; let ok = 0, streak = 0, noAlt = false;
  const fatal = e => e.name === 'AbortError' || e.code === 'auth' || e.code === 'network' || e.code === 'notoken';
  const add = async (offer, n) => {
    if (demo) { await sleep(70, signal); if (hash32(String(offer.id)) % 23 === 0) throw netErr('gone', 'Plus disponible'); return; }
    const body = { product_id: offer.productId, quantity: n, via_cardtrader_zero: mode === 'zero' };
    if (address) { body.shipping_address = address; body.billing_address = address; }
    await ct('cart/add', { method: 'POST', body, signal });
  };
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i], { offer, n, name } = part;
    try { await add(offer, n); ok++; added.push({ k: part.key, n: name, q: n, l: offer.lang || '' }); }
    catch (e) {
      if (fatal(e)) throw e;
      let handled = false;
      if (part.alt && !noAlt) {
        const tried = new Set([offer.productId]), used = []; let need = n, lastMsg = null, altFailed = 0;
        for (let round = 0; round < 4 && need > 0; round++) {
          const cand = part.alt(tried, need); if (!cand.length) break;
          for (const c of cand) {
            tried.add(c.offer.productId);
            try { await add(c.offer, c.n); used.push(c); need -= c.n; added.push({ k: part.key, n: name, q: c.n, l: c.offer.lang || '' }); }
            catch (e2) { if (fatal(e2)) throw e2; lastMsg = e2.message; altFailed++; break; }   // on recalcule avec ce qui reste
          }
        }
        if (used.length) {
          gone.push(offer.productId); handled = true;
          replaced.push({ name, from: offer, n, to: used, missing: Math.max(0, need) });
          if (need > 0) failed.push({ name, reason: `${need} exemplaire${need > 1 ? 's' : ''} sans remplacement disponible` });
          else ok++;
          streak = 0;
        } else if (altFailed && lastMsg === e.message) { if (++streak >= 2) noAlt = true; }   // même erreur partout : probablement pas l'offre
        else streak = 0;
      }
      if (!handled) failed.push({ name, reason: e.message });
    }
    onItem(i + 1, parts.length);
  }
  return { ok, failed, replaced, gone, added };
}
