#!/usr/bin/env node
// Deck Deal — proxy local (aucune dépendance, Node ≥ 18).
//   CARDTRADER_TOKEN=xxxxx node proxy.mjs          → http://localhost:8787
//   HOST=0.0.0.0 ALLOWED_UIDS=<uid Firebase> node proxy.mjs  → accessible depuis le téléphone, réservé à ton compte Firebase
//   HOST=0.0.0.0 APP_KEY=un-secret node proxy.mjs  → variante : clé partagée à saisir dans Réglages
// Le token reste côté serveur. Seules les routes utiles sont relayées ; l'achat (cart/purchase) est bloqué.
//   Notifications « recherche terminée » (facultatif) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (voir gen-vapid.mjs).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createPublicKey, createPrivateKey, verify as rsaVerify, sign as dsaSign, randomBytes, createHash, createECDH, createCipheriv, hkdfSync } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = (process.env.CARDTRADER_TOKEN || '').trim();
const APP_KEY = (process.env.APP_KEY || '').trim();
const UPSTREAM = (process.env.CT_UPSTREAM || 'https://api.cardtrader.com/api/v2').replace(/\/+$/, '') + '/'; // surchargeable pour les tests
const PAGE = ['deck-deal.html', 'dist/deck-deal.html'].map(f => join(here, f)).find(existsSync);

// Fichiers PWA servis depuis ./pwa : correspondance EXACTE sur cette liste (aucun chemin n'est construit depuis l'URL → pas de traversée).
const YEAR = 'public, max-age=604800', NOCACHE = 'no-cache';
const STATIC = new Map([
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8', NOCACHE]],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8', NOCACHE]],
  ['/icons/icon.svg', ['icons/icon.svg', 'image/svg+xml', YEAR]],
  ['/icons/icon-192.png', ['icons/icon-192.png', 'image/png', YEAR]],
  ['/icons/icon-512.png', ['icons/icon-512.png', 'image/png', YEAR]],
  ['/icons/maskable-512.png', ['icons/maskable-512.png', 'image/png', YEAR]],
  ['/icons/apple-touch-icon.png', ['icons/apple-touch-icon.png', 'image/png', YEAR]],
  ['/icons/favicon-32.png', ['icons/favicon-32.png', 'image/png', YEAR]],
  ['/edh.tsv', ['edh.tsv', 'text/tab-separated-values; charset=utf-8', 'public, max-age=86400', true]],                  // commandants EDHREC, decks moyens et prix (généré par gen-edhrec.mjs), gzip comme le catalogue français
  ['/fr-names.tsv', ['fr-names.tsv', 'text/tab-separated-values; charset=utf-8', 'public, max-age=86400', true]],      // catalogue des noms de cartes en français (généré par gen-fr-names.mjs) ; 4e valeur : compressé en gzip si le client l'accepte
]);

// Accès par compte Firebase : le navigateur envoie son jeton d'identité (X-Firebase-Token), le proxy en vérifie la signature Google
// puis compare l'UID (ou l'email vérifié) à la liste autorisée. Rien à retaper, rien à partager.
const csv = v => String(v || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
const FB_PROJECT = (process.env.FIREBASE_PROJECT_ID || 'm2s-mtg').trim();
const ALLOWED_UIDS = new Set(csv(process.env.ALLOWED_UIDS));
const ALLOWED_EMAILS = new Set(csv(process.env.ALLOWED_EMAILS).map(x => x.toLowerCase()));
const AUTH_FB = ALLOWED_UIDS.size + ALLOWED_EMAILS.size > 0;
const JWKS_URL = process.env.FIREBASE_JWKS_URL || 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'; // surchargeable pour les tests

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
if (!LOOPBACK.has(HOST) && !APP_KEY && !AUTH_FB) {
  console.error('Refus de démarrer : HOST=' + HOST + ' expose ton token CardTrader. Définis ALLOWED_UIDS=<ton uid Firebase> (recommandé) ou APP_KEY=un-secret.');
  process.exit(1);
}

// Routes relayées : méthode → chemins autorisés. Tout le reste (dont cart/purchase) répond 403.
const ALLOW = {
  GET: new Set(['info', 'expansions', 'blueprints/export', 'marketplace/products', 'cart', 'shipping_methods']),
  POST: new Set(['cart/add', 'cart/remove']),
};

// Cache mémoire des catalogues (lourds, quasi statiques).
const CACHE_TTL = 6 * 3600 * 1000;
const CACHE_MAX = (Number(process.env.CACHE_MAX_MB) || 48) * 1024 * 1024; // plafond mémoire : évite qu'un hébergeur tue le process
const cache = new Map(); let cacheBytes = 0;
function cacheSet(k, body) {
  if (body.length > CACHE_MAX) return;
  const old = cache.get(k); if (old) cacheBytes -= old.body.length;
  cache.delete(k); cache.set(k, { t: Date.now(), body }); cacheBytes += body.length;
  for (const [kk, v] of cache) { if (cacheBytes <= CACHE_MAX) break; cache.delete(kk); cacheBytes -= v.body.length; } // plus ancien d'abord
}

// Concurrence vers CardTrader plafonnée : protège ton token d'un pic de requêtes (plusieurs onglets, boucle…).
const UP_CONC = Number(process.env.UP_CONC) || 6, UP_QUEUE_MAX = 200;
let upActive = 0; const upQueue = [];
const upGate = () => upActive < UP_CONC ? (upActive++, Promise.resolve()) : new Promise(r => upQueue.push(r));
const upDone = () => { const n = upQueue.shift(); if (n) n(); else upActive--; };

/* ── Recherche d'offres en tâche de fond ─────────────────────────────────────────────────────────
   Le navigateur envoie la liste des blueprints ; le serveur les interroge à cadence constante (la limite CardTrader est de
   10 requêtes/s sur marketplace/products) et le navigateur relève les résultats. Si l'appli est quittée ou mise en veille,
   la boucle continue ici ; la même recherche relancée se rattache à la tâche en cours ou lit le cache.
   Cache : offres 10 min, absences d'offres 3 h (un blueprint sans offre française l'est rarement une heure plus tard). */
const JOBS_ON = process.env.JOBS !== '0';
const JOB_RATE = Math.min(9.6, Math.max(1, Number(process.env.JOB_RATE) || 9));
const JOB_CONC = 4, JOB_MAX_RUNNING = 3, JOB_MAX_KEPT = 8, JOB_MAX_BPS = 3000, JOB_PAGE = 300;
const JOB_KEEP = Number(process.env.JOB_KEEP_MS ?? 15 * 60e3);
const OFFER_TTL = Number(process.env.OFFER_TTL_MS ?? 10 * 60e3), OFFER_TTL_EMPTY = Number(process.env.OFFER_TTL_EMPTY_MS ?? 3 * 3600e3);
const OFFERS_MAX = (Number(process.env.OFFERS_CACHE_MB) || 40) * 1024 * 1024;
const sleepMs = ms => new Promise(r => setTimeout(r, ms));

// Cadence commune à toutes les requêtes marketplace/products (tâches de fond ET relais direct) : un seul budget vers CardTrader.
let paceAt = 0, paceSlow = 0;
async function pace() {
  const rate = paceSlow > 0 ? Math.max(3, JOB_RATE * 0.6) : JOB_RATE; if (paceSlow > 0) paceSlow--;
  const now = Date.now(), at = Math.max(now, paceAt); paceAt = at + 1000 / rate;
  if (at > now) await sleepMs(at - now);
}
const throttle = ms => { paceSlow = 40; paceAt = Math.max(paceAt, Date.now() + ms); };   // 429 : pause puis cadence réduite pendant 40 requêtes

const offers = new Map(); let offersBytes = 0;
const okey = (bp, lang, foil) => bp + '|' + lang + '|' + foil;
function offersGet(k) {
  const e = offers.get(k); if (!e) return null;
  if (Date.now() - e.t > (e.products.length ? OFFER_TTL : OFFER_TTL_EMPTY)) { offers.delete(k); offersBytes -= e.size; return null; }
  return e;
}
function offersSet(k, products) {
  if (!(products.length ? OFFER_TTL : OFFER_TTL_EMPTY)) return;
  const size = 96 + JSON.stringify(products).length, old = offers.get(k); if (old) offersBytes -= old.size;
  offers.delete(k); offers.set(k, { t: Date.now(), products, size }); offersBytes += size;
  for (const [kk, v] of offers) { if (offersBytes <= OFFERS_MAX) break; offers.delete(kk); offersBytes -= v.size; }
}
// On ne garde que les champs lus par l'application (3× plus léger en mémoire et sur le réseau).
const pick = (o, keys) => o && Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const slim = p => ({ id: p.id, blueprint_id: p.blueprint_id, quantity: p.quantity, graded: p.graded, on_vacation: p.on_vacation, bundle_size: p.bundle_size,
  price: pick(p.price, ['cents', 'currency']), expansion: pick(p.expansion, ['code', 'name_en']),
  properties_hash: pick(p.properties_hash, ['condition', 'mtg_language', 'mtg_foil', 'signed', 'altered', 'collector_number']),
  user: pick(p.user, ['id', 'username', 'country_code', 'can_sell_via_hub', 'user_type']) });

const cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });
async function fetchProducts(bp, lang, foil, signal) {
  const qs = new URLSearchParams({ blueprint_id: String(bp) }); if (lang) qs.set('language', lang);
  if (foil === 'no') qs.set('foil', 'false'); else if (foil === 'yes') qs.set('foil', 'true');
  const url = UPSTREAM + 'marketplace/products?' + qs, soft = m => Object.assign(new Error(m), { soft: true });
  for (let a = 0; ; a++) {
    if (signal.aborted) throw cancelled();
    await pace(); await upGate();
    if (signal.aborted) { upDone(); throw cancelled(); }
    const ctl = new AbortController(), onAbort = () => ctl.abort(), timer = setTimeout(() => ctl.abort(), 30000);
    signal.addEventListener('abort', onAbort, { once: true });
    let r, text;
    try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json' }, signal: ctl.signal }); text = await r.text(); }
    catch (e) { if (signal.aborted) throw cancelled(); if (a < 3) { await sleepMs(800 * (a + 1)); continue; } throw soft('upstream_unreachable'); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); upDone(); }
    if (r.status === 429 || r.status >= 500) {
      if (r.status === 429) throttle(Number(r.headers.get('retry-after')) * 1000 || 1100);
      if (a < 4) { await sleepMs(r.status === 429 ? 0 : 700 * (a + 1)); continue; }
      throw soft('upstream_' + r.status);
    }
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('upstream_auth'), { fatal: r.status });
    if (!r.ok) throw soft('upstream_' + r.status);
    let j; try { j = JSON.parse(text); } catch (e) { throw soft('upstream_bad_json'); }
    return (Array.isArray(j) ? j : Object.values(j || {}).flat()).filter(Boolean).map(slim);
  }
}


/* ── Notifications push « recherche terminée » (Web Push : RFC 8030 · 8291 · 8292), sans dépendance ─────────────────────
   Le navigateur envoie son abonnement avec la recherche ; si plus personne ne relève la tâche à sa fin, le serveur pousse une
   notification chiffrée. Rien n'est stocké : l'abonnement vit avec la tâche (15 min) puis disparaît. */
const VAPID_PUB = (process.env.VAPID_PUBLIC_KEY || '').trim(), VAPID_PRIV = (process.env.VAPID_PRIVATE_KEY || '').trim(), VAPID_SUB = (process.env.VAPID_SUBJECT || '').trim();
const PUSH_GRACE = Number(process.env.PUSH_GRACE_MS ?? 4000);
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
const PUSH_EXTRA = new Set(csv(process.env.PUSH_ALLOW_HOSTS));        // tests uniquement : « 127.0.0.1:9999 »
let vapidKey = null;
if (VAPID_PUB || VAPID_PRIV || VAPID_SUB) {
  try {
    const pub = Buffer.from(VAPID_PUB, 'base64url');
    if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY illisible (65 octets en base64url attendus)');
    if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(VAPID_SUB)) throw new Error('VAPID_SUBJECT doit être « mailto:toi@exemple.fr » ou une adresse https://');
    const chk = createECDH('prime256v1'); chk.setPrivateKey(Buffer.from(VAPID_PRIV, 'base64url'));
    if (!chk.getPublicKey().equals(pub)) throw new Error('VAPID_PRIVATE_KEY ne correspond pas à VAPID_PUBLIC_KEY');
    vapidKey = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url'), d: VAPID_PRIV }, format: 'jwk' });
  } catch (e) { console.error('Notifications désactivées : ' + e.message); vapidKey = null; }
}
const PUSH_ON = !!vapidKey;
const jwtCache = new Map();
function vapidAuth(aud) {
  const now = Math.floor(Date.now() / 1000), c = jwtCache.get(aud);
  if (c && c.exp - now > 3600) return c.h;
  const exp = now + 12 * 3600, enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp, sub: VAPID_SUB });
  const sig = dsaSign('sha256', Buffer.from(unsigned), { key: vapidKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const h = `vapid t=${unsigned}.${sig}, k=${VAPID_PUB}`; jwtCache.set(aud, { exp, h }); return h;
}
/** Chiffrement du message (aes128gcm, RFC 8291) pour l'abonnement {p256dh, auth}. */
function encryptPush(payload, p256dh, auth) {
  const ua = Buffer.from(p256dh, 'base64url'), au = Buffer.from(auth, 'base64url');
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), secret = ecdh.computeSecret(ua), salt = randomBytes(16);
  const ikm = Buffer.from(hkdfSync('sha256', secret, au, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const gcm = createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([gcm.update(Buffer.concat([payload, Buffer.from([2])])), gcm.final(), gcm.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}
function pushEndpointOk(s) {
  if (typeof s !== 'string' || s.length > 700) return false;
  let u; try { u = new URL(s); } catch (e) { return false; }
  if (u.username || u.password) return false;
  if (PUSH_EXTRA.has(u.host)) return u.protocol === 'http:' || u.protocol === 'https:';
  return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some(re => re.test(u.hostname));
}
/** Abonnement + texte reçus du navigateur → forme sûre, ou null (la recherche part quand même, sans notification). */
function parsePush(p) {
  if (!PUSH_ON || !p || typeof p !== 'object') return null;
  const s = p.sub, k = s && s.keys;
  if (!s || !pushEndpointOk(s.endpoint) || !k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(k.p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(k.auth)) return null;
  const ua = Buffer.from(k.p256dh, 'base64url');
  if (ua.length !== 65 || ua[0] !== 4) return null;
  try { const e = createECDH('prime256v1'); e.generateKeys(); e.computeSecret(ua); } catch (e) { return null; }   // point hors courbe
  const str = (v, n, d) => typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : d;
  const url = typeof p.url === 'string' && /^\.\/(\?[\w=&.%-]{0,60})?$/.test(p.url) ? p.url : './?resume=1';
  return { sub: { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } }, title: str(p.title, 80, 'Recherche terminée'), body: str(p.body, 200, 'Les offres sont prêtes.'), url };
}
async function sendPush(p) {
  const u = new URL(p.sub.endpoint), body = encryptPush(Buffer.from(JSON.stringify({ title: p.title, body: p.body, url: p.url })), p.sub.keys.p256dh, p.sub.keys.auth);
  for (let a = 0; a < 2; a++) {
    let r;
    try {
      r = await fetch(u, { method: 'POST', body, signal: AbortSignal.timeout(10000), redirect: 'manual',
        headers: { Authorization: vapidAuth(u.origin), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high', Topic: 'deckdeal-run' } });
    } catch (e) { if (a === 0) { await sleepMs(1500); continue; } return 0; }
    if ((r.status === 429 || r.status >= 500) && a === 0) { await sleepMs(Math.min(5000, Number(r.headers.get('retry-after')) * 1000 || 1500)); continue; }
    return r.status;
  }
  return 0;
}
/** Fin de tâche : si personne n'a relevé l'état final dans le délai de grâce (appli quittée, téléphone en veille), on prévient. */
function pushWhenDone(job) {
  if (!PUSH_ON || job.status !== 'done' || !job.pushes.length) return;
  setTimeout(async () => {
    if (job.seenEnd) return;
    for (const p of job.pushes.splice(0)) {
      const st = await sendPush(p);
      if (st && st < 300) console.log('push envoyé (' + st + ')'); else console.warn('push refusé (' + (st || 'réseau') + ')' + (st === 404 || st === 410 ? ' : abonnement expiré' : ''));
    }
  }, PUSH_GRACE).unref();
}

const jobs = new Map();
function newJob({ lang, foil, bps, fresh }) {
  const sig = createHash('sha1').update([lang, foil, ...bps.slice().sort((a, b) => a - b)].join(',')).digest('hex');
  const now = Date.now();
  let same = null;                                                    // la tâche la plus récente de même signature (en cours, ou terminée et encore valable)
  for (const j of jobs.values()) if (j.sig === sig && (j.status === 'running' || (j.status === 'done' && !fresh && now - j.end < OFFER_TTL)) && (!same || j.t0 > same.t0)) same = j;
  if (same) return { job: same, attached: true };
  if ([...jobs.values()].filter(j => j.status === 'running').length >= JOB_MAX_RUNNING) return { busy: true };
  const job = { id: randomBytes(12).toString('hex'), sig, lang, foil, fresh: !!fresh, bps, queue: bps.slice(), total: bps.length, results: [], done: 0, cached: 0, cacheAge: 0, oldest: Infinity, errors: 0, sent: 0, stamps: [],
    status: 'running', fatal: null, ctl: new AbortController(), t0: now, end: 0, pushes: [], seenEnd: false };
  jobs.set(job.id, job);
  runJob(job);
  return { job, attached: false };
}
async function runJob(job) {
  const worker = async () => {
    while (job.status === 'running') {
      const bp = job.queue.shift(); if (bp === undefined) return;
      const k = okey(bp, job.lang, job.foil), hit = job.fresh ? null : offersGet(k);
      let products = null, error = null;
      if (hit) { products = hit.products; job.cached++; job.cacheAge = Math.max(job.cacheAge, Date.now() - hit.t); job.oldest = Math.min(job.oldest, hit.t); }
      else {
        try { const at = Date.now(); products = await fetchProducts(bp, job.lang, job.foil, job.ctl.signal); offersSet(k, products); job.sent++; job.stamps.push(Date.now()); job.oldest = Math.min(job.oldest, at); }
        catch (e) {
          if (e.cancelled) return;
          if (e.fatal) { job.fatal = e.fatal; job.status = 'failed'; job.ctl.abort(); return; }
          error = e.message || 'error'; job.errors++;
        }
      }
      job.results.push(error ? { bp, error } : { bp, products }); job.done++;
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(JOB_CONC, job.queue.length) }, worker)); }
  catch (e) { console.error('job:', e); if (job.status === 'running') job.status = 'failed'; }
  if (job.status === 'running') job.status = 'done';
  job.end = Date.now();
  pushWhenDone(job);
}
function gcJobs() {
  const now = Date.now(), fin = [];
  for (const [id, j] of jobs) {
    if (j.status === 'running' && now - j.t0 > 30 * 60e3) { j.status = 'cancelled'; j.ctl.abort(); j.end = now; }
    if (j.end && now - j.end > JOB_KEEP) jobs.delete(id); else if (j.end) fin.push(j);
  }
  fin.sort((a, b) => a.end - b.end); while (fin.length > JOB_MAX_KEPT) jobs.delete(fin.shift().id);
}
if (JOBS_ON) setInterval(gcJobs, 30e3).unref();

async function jobsApi(req, res, path, url) {
  if (!JOBS_ON) return json(res, 404, { error: 'jobs_disabled' });
  const m = /^jobs(?:\/([a-f0-9]{24}))?$/.exec(path);
  if (!m) return json(res, 404, { error: 'not_found' });
  if (req.method === 'POST' && !m[1]) {
    let b; try { b = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch (e) { return json(res, 400, { error: 'bad_request', message: 'JSON invalide' }); }
    const lang = b && b.lang == null ? '' : String(b && b.lang), foil = b && b.foil == null ? 'any' : String(b && b.foil);
    const ids = Array.isArray(b && b.bps) ? [...new Set(b.bps)] : [];
    if (!b || b.type !== 'offers' || !/^([a-z]{2}(-[A-Za-z]{2})?)?$/.test(lang) || !['no', 'yes', 'any'].includes(foil) || !ids.length || ids.length > JOB_MAX_BPS || !ids.every(x => Number.isSafeInteger(x) && x > 0))
      return json(res, 400, { error: 'bad_request', message: 'Paramètres invalides (type, lang, foil ou bps).' });
    const r = newJob({ lang, foil, bps: ids, fresh: !!b.fresh });
    if (r.busy) return json(res, 429, { error: 'busy', message: 'Trop de recherches en cours sur le serveur.' }, { 'Retry-After': '10' });
    const pu = parsePush(b.push);
    if (pu && r.job.status === 'running' && r.job.pushes.length < 3 && !r.job.pushes.some(x => x.sub.endpoint === pu.sub.endpoint)) r.job.pushes.push(pu);
    return json(res, 202, { id: r.job.id, total: r.job.total, attached: r.attached, status: r.job.status, push: !!pu });
  }
  const job = m[1] && jobs.get(m[1]);
  if (!job) return json(res, m[1] ? 404 : 405, { error: m[1] ? 'job_not_found' : 'method_not_allowed', message: m[1] ? 'Recherche introuvable (serveur redémarré ou trop ancienne).' : undefined });
  if (req.method === 'DELETE') { if (job.status === 'running') { job.status = 'cancelled'; job.ctl.abort(); job.end = Date.now(); job.pushes.length = 0; } return json(res, 200, { id: job.id, status: job.status }); }
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (job.status !== 'running') job.seenEnd = true;               // quelqu'un relève le résultat final : pas de notification
  const from = Math.max(0, Math.floor(Number(url.searchParams.get('from')) || 0));
  const items = job.results.slice(from, from + JOB_PAGE), now = Date.now();
  while (job.stamps.length && now - job.stamps[0] > 5000) job.stamps.shift();
  return json(res, 200, { id: job.id, status: job.status, total: job.total, done: job.done, cached: job.cached, cacheAge: Math.round(job.cacheAge / 1000), dataAge: job.oldest === Infinity ? 0 : Math.round((now - job.oldest) / 1000), errors: job.errors, sent: job.sent,
    rps: Math.round(job.stamps.length / Math.min(5, Math.max(1, (now - job.t0) / 1000)) * 10) / 10, count: job.results.length, from, next: from + items.length, items, fatal: job.fatal });
}

// En-têtes de sécurité sur toutes les réponses (pas de CSP : la page charge Firebase, Scryfall et Google Fonts).
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',   // caméra : scan des cartes de la collection
};
const json = (res, status, obj, extra = {}) => {
  const b = JSON.stringify(obj);
  res.writeHead(status, { ...SEC, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(b);
};

// Freine le brute-force de la clé : délai sur chaque mauvaise clé + blocage temporaire par IP.
// L'IP retenue est la DERNIÈRE de X-Forwarded-For (ajoutée par le reverse proxy de l'hébergeur, non falsifiable par le client).
// Sans X-Forwarded-For on ne sait pas distinguer les clients : délai seul, pas de blocage (sinon un tiers pourrait t'enfermer dehors).
const BAD = new Map(), BAD_MAX = 15, BAD_WIN = 10 * 60e3, BAD_LOCK = 5 * 60e3;
const ipOf = req => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '?';
const isLocked = req => { const e = BAD.get(ipOf(req)); return !!e && e.until > Date.now(); };
async function badKey(req, res, error = 'bad_app_key', status = 401) {
  const k = ipOf(req), now = Date.now();
  if (BAD.size > 1000) for (const [kk, v] of BAD) if (now - v.first > BAD_WIN && v.until < now) BAD.delete(kk);
  let e = BAD.get(k);
  if (!e || (now - e.first > BAD_WIN && e.until < now)) e = { n: 0, first: now, until: 0 };
  e.n++;
  if (e.n >= BAD_MAX && req.headers['x-forwarded-for']) e.until = now + BAD_LOCK;
  BAD.set(k, e);
  await new Promise(r => setTimeout(r, Number(process.env.BAD_KEY_DELAY_MS ?? 400)));
  return json(res, status, { error, message: error === 'forbidden' ? 'Ce compte n\'est pas autorisé sur ce serveur.' : error === 'bad_token' ? 'Jeton de connexion invalide.' : undefined });
}

/* ── Jeton Firebase (JWT RS256) : vérification sans dépendance ───────────────────────────────── */
const authErr = (code, message) => Object.assign(new Error(message || code), { authCode: code });
const jwk = { keys: new Map(), exp: 0, lastTry: 0 };
async function loadKeys(force) {
  const now = Date.now();
  if (!force && jwk.keys.size && jwk.exp > now) return;
  if (force && now - jwk.lastTry < 60e3 && jwk.keys.size) return;  // un jeton « inconnu » ne doit pas déclencher une avalanche de requêtes vers Google
  jwk.lastTry = now;
  let r;
  try { r = await fetch(JWKS_URL, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } }); } catch (e) { r = null; }
  if (!r || !r.ok) { if (jwk.keys.size) return; throw authErr('unavailable', 'Clés Firebase injoignables'); } // à défaut, on garde les anciennes clés
  const j = await r.json(), keys = new Map();
  for (const k of (j && j.keys) || []) { try { if (k.kid && k.kty === 'RSA') keys.set(k.kid, createPublicKey({ key: k, format: 'jwk' })); } catch (e) { /* clé illisible : ignorée */ } }
  if (!keys.size) { if (jwk.keys.size) return; throw authErr('unavailable', 'Aucune clé Firebase exploitable'); }
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  jwk.keys = keys; jwk.exp = now + Math.min(24 * 3600e3, Math.max(60e3, (m ? Number(m[1]) : 3600) * 1000));
}
const b64j = x => JSON.parse(Buffer.from(x, 'base64url').toString('utf8'));
/** Retourne {uid, email, emailVerified} ou lève une erreur {authCode: expired | invalid | forbidden | unavailable}. */
async function verifyIdToken(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3 || tok.length > 4096) throw authErr('invalid');
  let h, c;
  try { h = b64j(parts[0]); c = b64j(parts[1]); } catch (e) { throw authErr('invalid'); }
  if (!h || h.alg !== 'RS256' || typeof h.kid !== 'string') throw authErr('invalid');          // alg « none » ou HS256 : refusés d'office
  await loadKeys(false);
  let key = jwk.keys.get(h.kid);
  if (!key) { await loadKeys(true); key = jwk.keys.get(h.kid); }
  if (!key) throw authErr('invalid');
  let okSig = false;
  try { okSig = rsaVerify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url')); } catch (e) { okSig = false; }
  if (!okSig) throw authErr('invalid');
  const now = Math.floor(Date.now() / 1000), skew = 60;
  if (!c || c.aud !== FB_PROJECT || c.iss !== 'https://securetoken.google.com/' + FB_PROJECT) throw authErr('invalid');
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 128) throw authErr('invalid');
  if (!Number.isFinite(c.exp) || !Number.isFinite(c.iat) || c.iat > now + skew || (c.auth_time && c.auth_time > now + skew)) throw authErr('invalid');
  if (c.exp <= now) throw authErr('expired');
  const email = typeof c.email === 'string' ? c.email.toLowerCase() : '', emailVerified = c.email_verified === true;
  if (!(ALLOWED_UIDS.has(c.sub) || (email && emailVerified && ALLOWED_EMAILS.has(email)))) throw authErr('forbidden');
  return { uid: c.sub, email, emailVerified };
}

const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const readBody = (req, max = 256 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > max) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// Autorisation : compte Firebase autorisé OU clé APP_KEY (si l'une ou l'autre est configurée). Sans rien de configuré : ouvert (local uniquement).
// Aucun identifiant fourni → 401 sans pénalité (pas de devinette possible) ; identifiant faux → délai + blocage par IP.
async function authorize(req, res) {
  if (!APP_KEY && !AUTH_FB) return true;
  if (isLocked(req)) { json(res, 429, { error: 'too_many_attempts', message: 'Trop d\'essais invalides : réessaie dans quelques minutes.' }, { 'Retry-After': '300' }); return false; }
  const key = String(req.headers['x-app-key'] || ''), tok = String(req.headers['x-firebase-token'] || '');
  if (APP_KEY && key && safeEq(key, APP_KEY)) return true;
  if (AUTH_FB && tok) {
    try { await verifyIdToken(tok); return true; }
    catch (e) {
      const code = e && e.authCode;
      if (code === 'expired') { json(res, 401, { error: 'token_expired', message: 'Session expirée : le navigateur va la renouveler.' }); return false; }
      if (code === 'unavailable') { json(res, 503, { error: 'auth_unavailable', message: 'Vérification du compte impossible pour le moment.' }, { 'Retry-After': '5' }); return false; }
      await badKey(req, res, code === 'forbidden' ? 'forbidden' : 'bad_token', code === 'forbidden' ? 403 : 401); return false;
    }
  }
  if (!key && !tok) { json(res, 401, { error: 'auth_required', message: AUTH_FB ? 'Connecte-toi pour utiliser le proxy.' : 'Clé du proxy requise.', login: AUTH_FB, key: !!APP_KEY }); return false; }
  await badKey(req, res); return false;
}


/* ── Import d'une liste depuis un lien (menu « Partager » de l'appli EDHREC, Archidekt, Moxfield) ──────────────────────────
   Lecture seule, hôtes en liste blanche, aucune redirection suivie, 2 Mo et 8 s maximum. Le serveur renvoie la liste en texte
   « 1 Sol Ring » avec un en-tête « Commander » si le site le distingue. Archidekt et Moxfield : au mieux (leurs API peuvent changer). */
const IMPORT_UP = (process.env.IMPORT_UPSTREAM || '').replace(/\/+$/, '');          // tests uniquement
const IMPORT_MAX = 2 * 1024 * 1024, IMPORT_LINES = 450;
const UA = 'Mozilla/5.0 (compatible; DeckDeal/1.0)';
async function getJsonLimited(url, headers = {}) {
  let r;
  try { r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers }, redirect: 'manual', signal: AbortSignal.timeout(8000) }); }
  catch (e) { throw Object.assign(new Error('Site injoignable'), { status: 502 }); }
  if (r.status >= 300 && r.status < 400) throw Object.assign(new Error('Redirection non suivie'), { status: 502 });
  if (r.status === 404) throw Object.assign(new Error('Liste introuvable (privée ou lien incomplet ?)'), { status: 404 });
  if (!r.ok) throw Object.assign(new Error('Le site a refusé la lecture (' + r.status + ')'), { status: 502 });
  const len = Number(r.headers.get('content-length')); if (len > IMPORT_MAX) throw Object.assign(new Error('Réponse trop grosse'), { status: 413 });
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > IMPORT_MAX) throw Object.assign(new Error('Réponse trop grosse'), { status: 413 });
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw Object.assign(new Error('Réponse illisible'), { status: 502 }); }
}
const qn = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 && n < 100 ? n : 1; };
const cleanName = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 150) : '';
function toText(cmd, main) {
  const line = ([n, q]) => q + ' ' + n;
  const out = [];
  if (cmd.length) out.push('Commander', ...cmd.map(line), '');
  if (out.length) out.push('Deck');
  out.push(...main.map(line));
  return out.join('\n');
}
function fromEdhrec(j) {
  const d = j && j.deck, cmd = [], main = [];
  const add = (list, n, q) => { n = cleanName(n); if (n) list.push([n, qn(q)]); };
  if (Array.isArray(d)) for (const x of d) { const m = /^\s*(\d+)\s*x?\s+(.+?)\s*$/.exec(String(x)); if (m) add(main, m[2], m[1]); else add(main, String(x), 1); }
  else if (d && typeof d === 'object') {
    for (const x of d.commander_v2 || (d.commander || []).map(n => [n, 1])) add(cmd, x[0], x[1]);
    for (const list of Object.values(d.cards || {})) if (Array.isArray(list)) for (const x of list) add(main, x[0], x[1]);
  }
  if (!main.length && Array.isArray(j && j.archidekt)) for (const x of j.archidekt) add(main, x && x.c, x && x.q);
  const hdr = cleanName(j && j.header).replace(/^Average Deck for\s+/i, '');
  return { name: hdr || (cmd[0] && cmd[0][0]) || 'Deck EDHREC', cmd, main };
}
function fromArchidekt(j) {
  const cmd = [], main = [];
  for (const c of (j && j.cards) || []) {
    const cats = (c.categories || []).map(x => String(x).toLowerCase()), n = cleanName(c.card && c.card.oracleCard && c.card.oracleCard.name || c.card && c.card.name);
    if (!n || cats.some(x => /maybe|sideboard|considering/.test(x))) continue;
    (cats.includes('commander') ? cmd : main).push([n, qn(c.quantity)]);
  }
  return { name: cleanName(j && j.name) || 'Deck Archidekt', cmd, main };
}
function fromMoxfield(j) {
  const cmd = [], main = [], read = (board, list) => { for (const e of Object.values((board && (board.cards || board)) || {})) { const n = cleanName(e && e.card && e.card.name); if (n) list.push([n, qn(e.quantity)]); } };
  const b = j && j.boards;
  read(b ? b.commanders : j && j.commanders, cmd); read(b ? b.mainboard : j && j.mainboard, main);
  return { name: cleanName(j && j.name) || 'Deck Moxfield', cmd, main };
}
async function importApi(req, res, url) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  let u; try { u = new URL(String(url.searchParams.get('url') || '').trim()); } catch (e) { return json(res, 400, { error: 'bad_request', message: 'Lien invalide.' }); }
  const host = u.hostname.replace(/^www\./, '').toLowerCase(), segs = u.pathname.split('/').filter(Boolean);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return json(res, 400, { error: 'bad_request', message: 'Lien https attendu.' });
  const slug = /^[a-z0-9][a-z0-9-]{0,120}$/i, num = /^\d{1,10}$/, mox = /^[A-Za-z0-9_-]{4,40}$/;
  let site, target, parse, headers = {};
  if (host === 'edhrec.com' && ['average-decks', 'commanders'].includes(segs[0]) && slug.test(segs[1] || '') && segs.length <= 3 && (!segs[2] || slug.test(segs[2]))) {
    site = 'EDHREC'; parse = fromEdhrec;
    target = (IMPORT_UP ? IMPORT_UP + '/edhrec' : 'https://json.edhrec.com') + '/pages/average-decks/' + segs[1] + (segs[0] === 'average-decks' && segs[2] ? '/' + segs[2] : '') + '.json';
  } else if (host === 'archidekt.com' && segs[0] === 'decks' && num.test(segs[1] || '')) {
    site = 'Archidekt'; parse = fromArchidekt; target = (IMPORT_UP ? IMPORT_UP + '/archidekt' : 'https://archidekt.com') + '/api/decks/' + segs[1] + '/';
  } else if (host === 'moxfield.com' && segs[0] === 'decks' && mox.test(segs[1] || '')) {
    site = 'Moxfield'; parse = fromMoxfield; target = (IMPORT_UP ? IMPORT_UP + '/moxfield' : 'https://api2.moxfield.com') + '/v3/decks/all/' + segs[1]; headers = { Referer: 'https://moxfield.com/', Origin: 'https://moxfield.com' };
  } else return json(res, 400, { error: 'unsupported', message: 'Lien non pris en charge : EDHREC (average-decks), Archidekt ou Moxfield.' });
  try {
    const r = parse(await getJsonLimited(target, headers));
    if (!r.main.length && !r.cmd.length) return json(res, 422, { error: 'empty', message: 'Aucune carte trouvée dans cette liste.' });
    return json(res, 200, { site, name: r.name, count: r.cmd.length + r.main.length, text: toText(r.cmd.slice(0, 4), r.main.slice(0, IMPORT_LINES)) });
  } catch (e) { return json(res, e.status || 502, { error: 'import_failed', message: e.message }); }
}

async function api(req, res, url) {
  if (!(await authorize(req, res))) return;
  if (url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '') === 'import') return importApi(req, res, url);   // n'a pas besoin du token CardTrader
  if (!TOKEN) return json(res, 401, { error: 'no_token', message: 'CARDTRADER_TOKEN absent côté proxy.' });

  const path = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  if (path === 'jobs' || path.startsWith('jobs/')) return jobsApi(req, res, path, url);
  const allowed = ALLOW[req.method];
  if (!allowed) return json(res, 405, { error: 'method_not_allowed' });
  if (!allowed.has(path)) return json(res, 403, { error: 'blocked', message: 'Route non autorisée par le proxy : ' + path });

  const target = UPSTREAM + path + url.search;
  const cacheable = req.method === 'GET' && (path === 'expansions' || path === 'blueprints/export');
  if (cacheable) {
    const hit = cache.get(target);
    if (hit && Date.now() - hit.t < CACHE_TTL) {
      res.writeHead(200, { ...SEC, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'x-cache': 'HIT' });
      return res.end(hit.body);
    }
  }

  const init = { method: req.method, headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json' } };
  if (req.method === 'POST') {
    init.body = await readBody(req);
    init.headers['Content-Type'] = 'application/json';
  }
  if (upQueue.length >= UP_QUEUE_MAX) return json(res, 503, { error: 'busy', message: 'Trop de requêtes en attente.' }, { 'Retry-After': '2' });
  if (path === 'marketplace/products') await pace(); // même budget que les tâches de fond
  await upGate();
  init.signal = AbortSignal.timeout(30000); // armé après l'attente en file, pas avant
  let up, body;
  try {
    try { up = await fetch(target, init); body = Buffer.from(await up.arrayBuffer()); }
    catch (e) { return json(res, 502, { error: 'upstream_unreachable', message: String(e && e.message || e) }); }
  } finally { upDone(); }
  const headers = { ...SEC, 'Content-Type': up.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' };
  const ra = up.headers.get('retry-after'); if (ra) headers['Retry-After'] = ra;
  if (cacheable && up.ok) cacheSet(target, body);
  res.writeHead(up.status, headers);
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(String(req.url).replace(/^\/+/, '/'), 'http://x'); // « // » ou « //hôte/chemin » ne doivent pas être lus comme une URL absolue
    if (url.pathname === '/__ping') return json(res, 200, { ok: true, app: 'deckdeal', needsKey: !!APP_KEY, needsLogin: AUTH_FB, hasToken: !!TOKEN, jobs: JOBS_ON, push: PUSH_ON ? VAPID_PUB : '' });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!PAGE) return json(res, 404, { error: 'page_missing', message: 'Place deck-deal.html à côté de proxy.mjs.' });
      const html = await readFile(PAGE);
      res.writeHead(200, { ...SEC, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
    }
    const st = (req.method === 'GET' || req.method === 'HEAD') && STATIC.get(url.pathname);
    if (st) {
      const f = join(here, 'pwa', st[0]);
      if (!existsSync(f)) return json(res, 404, { error: 'asset_missing', message: 'Dossier pwa/ absent à côté de proxy.mjs.' });
      let data = await readFile(f); const hd = { ...SEC, 'Content-Type': st[1], 'Cache-Control': st[2] };
      if (st[3]) {
        hd.Vary = 'Accept-Encoding';
        if (/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) { data = gzipSync(data); hd['Content-Encoding'] = 'gzip'; }
      }
      hd['Content-Length'] = data.length; res.writeHead(200, hd);
      return res.end(req.method === 'HEAD' ? undefined : data);
    }
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    if (!res.headersSent) json(res, e && e.status || 500, { error: 'proxy_error', message: String(e && e.message || e) });
    else res.end();
  }
});

// Ne jamais laisser une erreur isolée faire tomber le site (l'hébergeur ne relance pas toujours le process).
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));
process.on('uncaughtException', e => console.error('uncaughtException:', e));

server.listen(PORT, HOST, () => {
  console.log(`Deck Deal → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(TOKEN ? 'Token CardTrader : OK' : '⚠ CARDTRADER_TOKEN manquant : mode démo uniquement');
  if (AUTH_FB) console.log(`Accès : compte Firebase « ${FB_PROJECT} » (${ALLOWED_UIDS.size} UID, ${ALLOWED_EMAILS.size} email${ALLOWED_EMAILS.size > 1 ? 's' : ''} vérifié${ALLOWED_EMAILS.size > 1 ? 's' : ''}).`);
  if (APP_KEY) console.log(AUTH_FB ? 'APP_KEY encore acceptée en secours : supprime-la une fois la connexion par compte validée.' : 'Clé d\'accès requise (APP_KEY) — à saisir dans Réglages.');
  if (APP_KEY && APP_KEY.length < 12) console.warn('⚠ APP_KEY courte (' + APP_KEY.length + ' caractères) : prends 16 caractères ou plus.');
  if (!PAGE) console.log('⚠ deck-deal.html introuvable à côté du proxy.');
});
