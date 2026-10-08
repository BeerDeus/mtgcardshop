#!/usr/bin/env node
// Mana Orbit — proxy local (aucune dépendance, Node ≥ 18).
//   CARDTRADER_TOKEN=xxxxx node proxy.mjs          → http://localhost:8787
//   HOST=0.0.0.0 ALLOWED_UIDS=<uid Firebase> node proxy.mjs  → accessible depuis le téléphone, réservé à ton compte Firebase
//   HOST=0.0.0.0 APP_KEY=un-secret node proxy.mjs  → variante : clé partagée à saisir dans Réglages
// Le token reste côté serveur. Seules les routes utiles sont relayées ; l'achat (cart/purchase) est bloqué.
//   Alertes de prix : mêmes clés VAPID, ou le compte de service FCM pour l'appli Android (ALERTS=0 pour couper).
//   Notifications « recherche terminée » (facultatif) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (voir gen-vapid.mjs).
//   Notifications dans l'appli Android (facultatif) : FCM_SERVICE_ACCOUNT (JSON du compte de service Firebase, ou son base64) ou FCM_SERVICE_ACCOUNT_FILE.
import http from 'node:http';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { gunzipSync, gzip, brotliCompress, constants as zc } from 'node:zlib';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createPublicKey, createPrivateKey, verify as rsaVerify, sign as dsaSign, randomBytes, createHash, createECDH, createCipheriv, hkdfSync } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const gzipA = promisify(gzip), brotliA = promisify(brotliCompress);
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = (process.env.CARDTRADER_TOKEN || '').trim();
const APP_KEY = (process.env.APP_KEY || '').trim();
const UPSTREAM = (process.env.CT_UPSTREAM || 'https://api.cardtrader.com/api/v2').replace(/\/+$/, '') + '/'; // surchargeable pour les tests
const PAGE = ['deck-deal.html', 'dist/deck-deal.html'].map(f => join(here, f)).find(existsSync);
const PWA = process.env.PWA_DIR || join(here, 'pwa');                       // surchargeable pour les tests (dossier temporaire)
// Bloc d'annonces AdMob du bandeau de l'appli Android (ca-app-pub-…/…), donné à l'appli par /__ping ; vide : bandeau de test de Google.
const ADMOB_RAW = (process.env.ADMOB_BANNER_ID || '').trim(), ADMOB_BANNER = /^ca-app-pub-\d+\/\d+$/.test(ADMOB_RAW) ? ADMOB_RAW : '';

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
  ['/edh.bin.gz', ['edh.bin.gz', 'application/octet-stream', 'public, max-age=86400', 'pre']],                          // même contenu en binaire compact (EDH2, déjà compressé par le générateur : envoyé tel quel avec Content-Encoding: gzip, ou décompressé si le client n'accepte pas gzip)
  ['/privacy', ['privacy.html', 'text/html; charset=utf-8', 'public, max-age=3600']],                                    // politique de confidentialité (lien de la fiche Google Play) et suppression de compte
  ['/privacy.html', ['privacy.html', 'text/html; charset=utf-8', 'public, max-age=3600']],
  ['/prices.tsv', ['prices.tsv.gz', 'text/tab-separated-values; charset=utf-8', 'public, max-age=3600', 'pre', 'px']],          // prix « à partir de » (gen-prices.mjs, relu depuis GitHub) : servi seulement une fois récupéré
  ['/fr-names.tsv', ['fr-names.tsv', 'text/tab-separated-values; charset=utf-8', 'public, max-age=86400', true]],      // catalogue des noms de cartes en français (généré par gen-fr-names.mjs) ; 4e valeur : compressé en gzip si le client l'accepte
]);

// ── Données EDHREC (edh.bin.gz) : le serveur récupère tout seul la dernière version générée par GitHub Actions (lundi et jeudi), sans redéploiement ──
// Au démarrage puis toutes les 6 h : lecture conditionnelle (ETag) du fichier du dépôt ; il n'est gardé que s'il est lisible (gzip + EDH2), assez fourni et plus récent
// que celui servi. Copie gardée en mémoire et dans .data/ (non versionné : ne gêne jamais un « git pull » de déploiement). Panne ou fichier douteux : on garde l'ancien.
const EDH_SRC = (process.env.EDH_SOURCE_URL === undefined ? 'https://raw.githubusercontent.com/BeerDeus/mtgcardshop/main/pwa/edh.bin.gz' : process.env.EDH_SOURCE_URL).trim();      // '' : désactivé
const EDH_EVERY = Number(process.env.EDH_SYNC_MS) || 6 * 3600000, EDH_FIRST = process.env.EDH_SYNC_FIRST_MS === undefined ? 5000 : Number(process.env.EDH_SYNC_FIRST_MS);
const EDH_DIR = process.env.EDH_DATA_DIR || join(here, '.data'), EDH_COPY = join(EDH_DIR, 'edh.bin.gz'), EDH_REPO = join(PWA, 'edh.bin.gz');
let EDHB = null; try { EDHB = createRequire(import.meta.url)('./edhbin.cjs'); } catch (e) { /* sans lecteur : contrôle minimal (gzip + EDH2) */ }
let EDH_LIVE = null;                         // { buf, at, decks, cmds } : copie plus récente que celle du dépôt, servie à la place
const EDH_ST = { from: 'none', at: '', decks: 0, cmds: 0, bytes: 0, check: '', err: '' };
let edhEtag = '', edhBusy = false;
/** Contrôle un fichier edh.bin.gz : { at, decks, cmds } ou lève une erreur. */
function edhInfo(buf) {
  const raw = gunzipSync(buf);
  if (raw.length < 12 || raw.toString('latin1', 0, 4) !== 'EDH2') throw new Error('pas un fichier EDH2');
  if (!EDHB) return { at: '', decks: 0, cmds: 0 };
  const u = EDHB.edhUnpack(raw); return { at: String(u.at || ''), decks: u.dk.length, cmds: u.cmds.length };
}
async function edhLocal(f) { try { const buf = await readFile(f); return { buf, ...edhInfo(buf) }; } catch (e) { return null; } }
async function edhBoot() {
  const [repo, copy] = await Promise.all([edhLocal(EDH_REPO), edhLocal(EDH_COPY)]), best = copy && (!repo || copy.at > repo.at) ? copy : null;
  if (best) { EDH_LIVE = best; Object.assign(EDH_ST, { from: 'copie', at: best.at, decks: best.decks, cmds: best.cmds, bytes: best.buf.length }); }
  else if (repo) Object.assign(EDH_ST, { from: 'dépôt', at: repo.at, decks: repo.decks, cmds: repo.cmds, bytes: repo.buf.length });
}
async function edhSync() {
  if (!EDH_SRC || edhBusy) return; edhBusy = true; EDH_ST.check = new Date().toISOString();
  try {
    const r = await fetch(EDH_SRC, { headers: { 'User-Agent': 'deckdeal-proxy', ...(edhEtag ? { 'If-None-Match': edhEtag } : {}) }, signal: AbortSignal.timeout(90000) });
    if (r.status === 304) { EDH_ST.err = ''; return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 40e6) throw new Error('fichier trop gros');
    const m = edhInfo(buf);
    if (EDHB && (m.decks < 50 || m.cmds < 100)) throw new Error(`fichier trop maigre (${m.decks} decks, ${m.cmds} commandants) : ignoré`);
    if (EDH_ST.decks && m.decks < EDH_ST.decks / 2) throw new Error(`${m.decks} decks contre ${EDH_ST.decks} servis : ignoré`);
    edhEtag = r.headers.get('etag') || ''; EDH_ST.err = '';
    if (EDH_ST.at && m.at && m.at <= EDH_ST.at) return;                       // déjà à jour
    EDH_LIVE = { buf, ...m }; Object.assign(EDH_ST, { from: 'GitHub', at: m.at, decks: m.decks, cmds: m.cmds, bytes: buf.length });
    console.log(`EDH : données du ${m.at} récupérées (${m.decks} decks, ${m.cmds} commandants, ${(buf.length / 1048576).toFixed(2)} Mo)`);
    try { await mkdir(EDH_DIR, { recursive: true }); await writeFile(EDH_COPY + '.tmp', buf); await rename(EDH_COPY + '.tmp', EDH_COPY); } catch (e) { /* dossier en lecture seule : la copie en mémoire suffit jusqu'au redémarrage */ }
  } catch (e) { EDH_ST.err = String(e && e.message || e); console.warn('EDH : mise à jour impossible (' + EDH_ST.err + ')'); }
  finally { edhBusy = false; }
}

// ── Prix « à partir de » de chaque carte (prices.tsv.gz, tendance Cardmarket / TCGplayer) : générés chaque jour par GitHub Actions (branche data),
// relus ici toutes les 6 h comme les données EDHREC. L'app s'en sert quand l'utilisateur n'a pas de token CardTrader. Absent : l'app interroge Scryfall elle-même.
const PX_SRC = (process.env.PRICES_SOURCE_URL === undefined ? 'https://raw.githubusercontent.com/BeerDeus/mtgcardshop/data/prices.tsv.gz' : process.env.PRICES_SOURCE_URL).trim();      // '' : désactivé
const PX_COPY = join(EDH_DIR, 'prices.tsv.gz');
let PX_LIVE = null, pxEtag = '', pxBusy = false;
const PX_ST = { at: '', cards: 0, bytes: 0, check: '', err: '' };
/** Contrôle un fichier prices.tsv.gz : { at, cards } ou lève une erreur. */
function pxInfo(buf) {
  const raw = gunzipSync(buf), head = raw.toString('utf8', 0, Math.min(raw.length, 120)).split('\n')[0], m = /^#MOPX1 (\S+) (\d+)$/.exec(head);
  if (!m) throw new Error('pas un fichier de prix');
  return { at: m[1], cards: Number(m[2]) };
}
async function pxBoot() { try { const buf = await readFile(PX_COPY), m = pxInfo(buf); PX_LIVE = { buf, ...m }; Object.assign(PX_ST, { at: m.at, cards: m.cards, bytes: buf.length }); } catch (e) { /* pas encore de copie */ } }
async function pxSync() {
  if (!PX_SRC || pxBusy) return; pxBusy = true; PX_ST.check = new Date().toISOString();
  try {
    const r = await fetch(PX_SRC, { headers: { 'User-Agent': 'manaorbit-proxy', ...(pxEtag ? { 'If-None-Match': pxEtag } : {}) }, signal: AbortSignal.timeout(90000) });
    if (r.status === 304) { PX_ST.err = ''; return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 20e6) throw new Error('fichier trop gros');
    const m = pxInfo(buf);
    if (m.cards < 15000) throw new Error(`seulement ${m.cards} cartes : ignoré`);
    pxEtag = r.headers.get('etag') || ''; PX_ST.err = '';
    if (PX_ST.at && m.at <= PX_ST.at) return;
    PX_LIVE = { buf, ...m }; Object.assign(PX_ST, { at: m.at, cards: m.cards, bytes: buf.length });
    console.log(`Prix : relevé du ${m.at} (${m.cards} cartes, ${(buf.length / 1024).toFixed(0)} Ko)`);
    try { await mkdir(EDH_DIR, { recursive: true }); await writeFile(PX_COPY + '.tmp', buf); await rename(PX_COPY + '.tmp', PX_COPY); } catch (e) { /* lecture seule : la copie en mémoire suffit */ }
  } catch (e) { PX_ST.err = String(e && e.message || e); console.warn('Prix : mise à jour impossible (' + PX_ST.err + ')'); }
  finally { pxBusy = false; }
}

// Accès par compte Firebase : le navigateur envoie son jeton d'identité (X-Firebase-Token), le proxy en vérifie la signature Google
// puis compare l'UID (ou l'email vérifié) à la liste autorisée. Rien à retaper, rien à partager.
const csv = v => String(v || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
const FB_PROJECT = (process.env.FIREBASE_PROJECT_ID || 'm2s-mtg').trim();
const ALLOWED_UIDS = new Set(csv(process.env.ALLOWED_UIDS));
const ALLOWED_EMAILS = new Set(csv(process.env.ALLOWED_EMAILS).map(x => x.toLowerCase()));
const AUTH_FB = ALLOWED_UIDS.size + ALLOWED_EMAILS.size > 0;
const JWKS_URL = process.env.FIREBASE_JWKS_URL || 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'; // surchargeable pour les tests

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
// Serveur local (lié à la boucle locale) : seuls ces noms d'hôte sont servis, contre le « DNS rebinding » (une page piégée qui se fait passer pour localhost).
const LOCAL = LOOPBACK.has(HOST), LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
if (TOKEN && !LOOPBACK.has(HOST) && !APP_KEY && !AUTH_FB) {
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
const UP_CONC = Number(process.env.UP_CONC) || 12, UP_QUEUE_MAX = 200;
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
const JOB_CONC = 4, JOB_MAX_RUNNING = Number(process.env.JOB_MAX_RUNNING) || 8, JOB_MAX_KEPT = 4 * JOB_MAX_RUNNING, JOB_MAX_BPS = 3000, JOB_PAGE = 300;
const JOB_KEEP = Number(process.env.JOB_KEEP_MS ?? 15 * 60e3);
const OFFER_TTL = Number(process.env.OFFER_TTL_MS ?? 10 * 60e3), OFFER_TTL_EMPTY = Number(process.env.OFFER_TTL_EMPTY_MS ?? 3 * 3600e3);
const OFFERS_MAX = (Number(process.env.OFFERS_CACHE_MB) || 40) * 1024 * 1024;
// Token d'un utilisateur : 2 recherches en cours au plus (les places de JOB_MAX_RUNNING restent aux autres) ; résultats gardés par toutes les tâches : plafond mémoire.
const JOB_PER_TOKEN = Number(process.env.JOB_MAX_PER_TOKEN) || 2, JOB_RES_MAX = (Number(process.env.JOB_RESULTS_MB) || 64) * 1024 * 1024;
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
/** Empreinte d'un token CardTrader : seule forme gardée en mémoire au-delà d'une requête ou d'une recherche (jamais le token lui-même). */
const tokHash = t => createHash('sha256').update(String(t)).digest('base64url').slice(0, 22);

// Cadence des requêtes marketplace/products (tâches de fond ET relais direct) : un budget par token, la limite CardTrader étant propre à chaque compte.
// Clé : empreinte du token ; une entrée inactive depuis 60 s est oubliée à la création suivante.
const PACE = new Map();
const paceOf = tok => {
  const k = tokHash(tok); let p = PACE.get(k);
  if (!p) { const old = Date.now() - 60e3; for (const [kk, v] of PACE) if (v.at < old) PACE.delete(kk); p = { at: 0, slow: 0 }; PACE.set(k, p); }
  return p;
};
async function pace(tok = TOKEN) {
  const p = paceOf(tok), rate = p.slow > 0 ? Math.max(3, JOB_RATE * 0.6) : JOB_RATE; if (p.slow > 0) p.slow--;
  const now = Date.now(), at = Math.max(now, p.at); p.at = at + 1000 / rate;
  if (at > now) await sleepMs(at - now);
}
const throttle = (tok, ms) => { const p = paceOf(tok); p.slow = 40; p.at = Math.max(p.at, Date.now() + ms); };   // 429 : pause puis cadence réduite pendant 40 requêtes
/** Token CardTrader de l'utilisateur (en-tête X-CT-Token) : il cherche avec son propre compte, sans passer par le token du serveur. '' sinon. */
const userTok = req => { const t = String(req.headers['x-ct-token'] || '').trim(); return /^[A-Za-z0-9._~+/=-]{20,4096}$/.test(t) ? t : ''; };
// Token utilisateur que CardTrader a déjà accepté (une réponse 2xx depuis moins de 6 h) : lui seul lit les caches partagés (catalogues, offres),
// remplis avec d'autres tokens ; un token inventé n'obtient que la réponse de CardTrader. Empreintes seulement, 5 000 au plus (les plus anciennes sortent).
const CT_OK = new Map();
const tokOk = th => !th || (CT_OK.get(th) || 0) > Date.now() - CACHE_TTL;
function tokSeen(th) {
  if (!th) return;
  CT_OK.delete(th); while (CT_OK.size >= 5000) CT_OK.delete(CT_OK.keys().next().value);
  CT_OK.set(th, Date.now());
}

const offers = new Map(); let offersBytes = 0;
const okey = (bp, lang, foil) => bp + '|' + lang + '|' + foil;
function offersGet(k) {
  const e = offers.get(k); if (!e) return null;
  if (Date.now() - e.t > (e.products.length ? OFFER_TTL : OFFER_TTL_EMPTY)) { offers.delete(k); offersBytes -= e.size; return null; }
  return e;
}
/** Met en cache les offres d'un blueprint ; retourne leur taille (octets environ), comptée aussi dans le plafond des résultats de tâches. */
function offersSet(k, products) {
  const size = 96 + JSON.stringify(products).length;
  if (!(products.length ? OFFER_TTL : OFFER_TTL_EMPTY)) return size;
  const old = offers.get(k); if (old) offersBytes -= old.size;
  offers.delete(k); offers.set(k, { t: Date.now(), products, size }); offersBytes += size;
  for (const [kk, v] of offers) { if (offersBytes <= OFFERS_MAX) break; offers.delete(kk); offersBytes -= v.size; }
  return size;
}
// On ne garde que les champs lus par l'application (3× plus léger en mémoire et sur le réseau).
const pick = (o, keys) => o && Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const slim = p => ({ id: p.id, blueprint_id: p.blueprint_id, quantity: p.quantity, graded: p.graded, on_vacation: p.on_vacation, bundle_size: p.bundle_size,
  price: pick(p.price, ['cents', 'currency']), expansion: pick(p.expansion, ['code', 'name_en']),
  properties_hash: pick(p.properties_hash, ['condition', 'mtg_language', 'mtg_foil', 'signed', 'altered', 'collector_number']),
  user: pick(p.user, ['id', 'username', 'country_code', 'can_sell_via_hub', 'user_type']) });

const cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });
async function fetchProducts(bp, lang, foil, signal, tok = TOKEN) {
  const qs = new URLSearchParams({ blueprint_id: String(bp) }); if (lang) qs.set('language', lang);
  if (foil === 'no') qs.set('foil', 'false'); else if (foil === 'yes') qs.set('foil', 'true');
  const url = UPSTREAM + 'marketplace/products?' + qs, soft = m => Object.assign(new Error(m), { soft: true });
  for (let a = 0; ; a++) {
    if (signal.aborted) throw cancelled();
    await pace(tok); await upGate();
    if (signal.aborted) { upDone(); throw cancelled(); }
    const ctl = new AbortController(), onAbort = () => ctl.abort(), timer = setTimeout(() => ctl.abort(), 30000);
    signal.addEventListener('abort', onAbort, { once: true });
    let r, text;
    try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' }, signal: ctl.signal }); text = await r.text(); }
    catch (e) { if (signal.aborted) throw cancelled(); if (a < 3) { await sleepMs(800 * (a + 1)); continue; } throw soft('upstream_unreachable'); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); upDone(); }
    if (r.status === 429 || r.status >= 500) {
      if (r.status === 429) throttle(tok, Number(r.headers.get('retry-after')) * 1000 || 1100);
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
/** Cible reçue → forme sûre, ou null : abonnement Web Push du navigateur, ou { fcm: jeton } de l'appli Android (chacun seulement si son service est configuré). */
function parseTarget(s) {
  if (!s || typeof s !== 'object') return null;
  if ('fcm' in s) return FCM_ON && typeof s.fcm === 'string' && FCM_TOKEN_RE.test(s.fcm) ? { fcm: s.fcm } : null;
  const k = s.keys;
  if (!PUSH_ON || !pushEndpointOk(s.endpoint) || !k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(k.p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(k.auth)) return null;
  const ua = Buffer.from(k.p256dh, 'base64url');
  if (ua.length !== 65 || ua[0] !== 4) return null;
  try { const e = createECDH('prime256v1'); e.generateKeys(); e.computeSecret(ua); } catch (e) { return null; }   // point hors courbe
  return { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}
/** Clé d'une cible : dédoublonnage des notifications d'une tâche, identifiant d'un appareil abonné aux alertes. */
const pushKey = s => s.fcm ? 'fcm:' + s.fcm : s.endpoint;
/** Abonnement (ou jeton FCM) + texte reçus de l'appli → forme sûre, ou null (la recherche part quand même, sans notification). */
function parsePush(p) {
  if (!p || typeof p !== 'object') return null;
  const sub = parseTarget(p.sub); if (!sub) return null;
  const str = (v, n, d) => typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : d;
  const url = typeof p.url === 'string' && /^\.\/(\?[\w=&.%-]{0,60})?$/.test(p.url) ? p.url : './?resume=1';
  return { sub, title: str(p.title, 80, 'Recherche terminée'), body: str(p.body, 200, 'Les offres sont prêtes.'), url };
}
/** Envoi vers la cible : statut HTTP (404 / 410 = cible périmée, à retirer), 0 si le service est injoignable ou n'est plus configuré. */
async function sendPush(p) {
  if (p.sub.fcm) return FCM_ON ? sendFcm(p) : 0;
  if (!PUSH_ON) return 0;                                            // abonnement enregistré avant le retrait des clés VAPID : gardé, pas envoyé
  const u = new URL(p.sub.endpoint), body = encryptPush(Buffer.from(JSON.stringify({ title: p.title, body: p.body, url: p.url, ...(p.kind ? { kind: p.kind } : {}) })), p.sub.keys.p256dh, p.sub.keys.auth);
  for (let a = 0; a < 2; a++) {
    let r;
    try {
      r = await fetch(u, { method: 'POST', body, signal: AbortSignal.timeout(10000), redirect: 'manual',
        headers: { Authorization: vapidAuth(u.origin), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(p.ttl || 3600), Urgency: p.urgency || 'high', Topic: p.topic || 'deckdeal-run' } });
    } catch (e) { if (a === 0) { await sleepMs(1500); continue; } return 0; }
    if ((r.status === 429 || r.status >= 500) && a === 0) { await sleepMs(Math.min(5000, Number(r.headers.get('retry-after')) * 1000 || 1500)); continue; }
    return r.status;
  }
  return 0;
}

/* ── Notifications dans l'appli Android (Firebase Cloud Messaging, API HTTP v1), sans dépendance ─────────────────────────
   La WebView de l'appli n'a pas Web Push : l'appli envoie son jeton FCM ({ fcm }) partout où le navigateur envoie son abonnement.
   Compte de service Firebase (FCM_SERVICE_ACCOUNT : le JSON, ou ce JSON en base64 ; ou FCM_SERVICE_ACCOUNT_FILE : son chemin) →
   jeton d'accès OAuth2 (assertion JWT RS256 signée avec sa clé privée, gardé jusqu'à 5 min de son expiration) → POST messages:send.
   Jeton d'appareil refusé (UNREGISTERED, NOT_FOUND, jeton invalide) : statut 404, la cible est retirée comme un abonnement expiré. */
const FCM_BASE = (process.env.FCM_BASE_URL || 'https://fcm.googleapis.com').replace(/\/+$/, '');          // surchargeable pour les tests
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_RE = /^[A-Za-z0-9:_-]{100,4096}$/;
let fcmSa = null;
{
  const raw = (process.env.FCM_SERVICE_ACCOUNT || '').replace(/^\uFEFF/, '').trim(), file = (process.env.FCM_SERVICE_ACCOUNT_FILE || '').trim();
  if (raw || file) {
    const src = raw ? 'FCM_SERVICE_ACCOUNT' : 'FCM_SERVICE_ACCOUNT_FILE';
    try {
      let txt;
      try { txt = raw ? (raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) : readFileSync(file, 'utf8'); } catch (e) { throw new Error(src + ' : fichier illisible (' + e.message + ')'); }
      let j; try { j = JSON.parse(txt.replace(/^\uFEFF/, '')); } catch (e) { throw new Error(src + ' illisible : colle le JSON du compte de service (sur une ligne) ou ce JSON encodé en base64'); }
      if (!j || typeof j.client_email !== 'string' || typeof j.private_key !== 'string' || typeof j.project_id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(j.project_id)) throw new Error(src + ' : compte de service incomplet (project_id, client_email et private_key attendus)');
      let key; try { key = createPrivateKey(j.private_key.replace(/\\n/g, '\n')); } catch (e) { throw new Error(src + ' : private_key illisible'); }
      if (key.asymmetricKeyType !== 'rsa') throw new Error(src + ' : private_key doit être une clé RSA');
      const tokenUrl = String(process.env.FCM_TOKEN_URL || j.token_uri || 'https://oauth2.googleapis.com/token').trim();
      if (!/^https?:\/\/[^\s/]+\//.test(tokenUrl)) throw new Error(src + ' : token_uri invalide');
      fcmSa = { email: j.client_email, project: j.project_id, key, tokenUrl };
    } catch (e) { console.error('Notifications de l\'appli (FCM) désactivées : ' + e.message); fcmSa = null; }
  }
}
const FCM_ON = !!fcmSa;
const fcmAuth = { tok: '', exp: 0, run: null };
/** Assertion JWT signée (RS256), échangée contre un jeton d'accès (OAuth2, RFC 7523). */
function fcmJwt() {
  const now = Math.floor(Date.now() / 1000), enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({ iss: fcmSa.email, scope: FCM_SCOPE, aud: fcmSa.tokenUrl, iat: now, exp: now + 3600 });
  return unsigned + '.' + dsaSign('sha256', Buffer.from(unsigned), fcmSa.key).toString('base64url');
}
/** Jeton d'accès FCM, gardé jusqu'à 5 min de son expiration ; une seule demande à la fois. */
function fcmAccess() {
  if (fcmAuth.tok && Date.now() < fcmAuth.exp - 300e3) return Promise.resolve(fcmAuth.tok);
  if (!fcmAuth.run) fcmAuth.run = (async () => {
    const r = await fetch(fcmSa.tokenUrl, { method: 'POST', signal: AbortSignal.timeout(10000), redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: fcmJwt() }).toString() });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || typeof j.access_token !== 'string' || !j.access_token) throw new Error('jeton d\'accès refusé (' + r.status + (j && j.error ? ' ' + String(j.error).slice(0, 60) : '') + ')');
    fcmAuth.tok = j.access_token; fcmAuth.exp = Date.now() + (Number(j.expires_in) > 0 ? Number(j.expires_in) : 3600) * 1000;
    return fcmAuth.tok;
  })().finally(() => { fcmAuth.run = null; });
  return fcmAuth.run;
}
/** Jeton d'appareil à oublier : appli désinstallée, jeton renouvelé, autre projet Firebase, jeton mal formé. */
function fcmGone(status, e) {
  const det = Array.isArray(e && e.details) ? e.details : [], code = (det.find(d => d && d.errorCode) || {}).errorCode || (e && e.status) || '';
  if (status === 404 || code === 'UNREGISTERED' || code === 'NOT_FOUND' || code === 'SENDER_ID_MISMATCH') return true;
  return code === 'INVALID_ARGUMENT' && (/registration token/i.test(String(e && e.message || '')) || det.some(d => d && Array.isArray(d.fieldViolations) && d.fieldViolations.some(f => f && f.field === 'message.token')));
}
async function sendFcm(p) {
  const body = JSON.stringify({ message: { token: p.sub.fcm, notification: { title: p.title, body: p.body }, data: { url: p.url },
    android: { priority: 'HIGH', ttl: (p.ttl || 3600) + 's', collapse_key: p.topic || 'deckdeal-run' } } });   // ttl et collapse_key : équivalents des en-têtes TTL et Topic de Web Push
  for (let a = 0; a < 2; a++) {
    let tok, r;
    try { tok = await fcmAccess(); } catch (e) { console.warn('FCM : ' + e.message); return 0; }
    try {
      r = await fetch(`${FCM_BASE}/v1/projects/${fcmSa.project}/messages:send`, { method: 'POST', body, signal: AbortSignal.timeout(10000), redirect: 'manual',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' } });
    } catch (e) { if (a === 0) { await sleepMs(1500); continue; } return 0; }
    if (r.ok) { await r.arrayBuffer().catch(() => {}); return r.status; }
    const e = ((await r.json().catch(() => null)) || {}).error;
    if (fcmGone(r.status, e)) return 404;
    if (r.status === 401 && a === 0) { fcmAuth.tok = ''; continue; }                // jeton d'accès révoqué ou expiré : un nouveau, un seul essai
    if ((r.status === 429 || r.status >= 500) && a === 0) { await sleepMs(Math.min(5000, Number(r.headers.get('retry-after')) * 1000 || 1500)); continue; }
    console.warn('FCM : ' + r.status + (e && e.message ? ' ' + String(e.message).slice(0, 120) : ''));
    return r.status;
  }
  return 0;
}

/** Fin de tâche : si personne n'a relevé l'état final dans le délai de grâce (appli quittée, téléphone en veille), on prévient. */
function pushWhenDone(job) {
  if (!(PUSH_ON || FCM_ON) || job.status !== 'done' || !job.pushes.length) return;
  setTimeout(async () => {
    if (job.seenEnd) return;
    for (const p of job.pushes.splice(0)) {
      const st = await sendPush(p), via = p.sub.fcm ? ' FCM' : '';
      if (st && st < 300) console.log('push' + via + ' envoyé (' + st + ')'); else console.warn('push' + via + ' refusé (' + (st || 'réseau') + ')' + (st === 404 || st === 410 ? ' : abonnement expiré' : ''));
    }
  }, PUSH_GRACE).unref();
}

/* ── Alertes de prix (Web Push, ou FCM dans l'appli Android) ───────────────────────────────────────────────────────────
   L'appli enregistre ici, avec son abonnement push (ou son jeton FCM), la liste des cartes à surveiller (cartes manquantes de tes decks enregistrés,
   cartes suivies à la main, avec ou sans prix cible). Toutes les 6 h le serveur relit le prix tendance Cardmarket (champ `eur` de
   Scryfall, lots de 75 noms) et pousse une notification quand une carte :
   · chute d'au moins `thr` % (30 par défaut) ET d'au moins 0,50 € sous sa valeur habituelle (médiane des relevés précédents) ;
   · passe sous le prix cible fixé à la main.
   Une carte déjà signalée n'est plus signalée pendant 5 jours, sauf nouvelle chute de 15 % ou plus. Un seul message par appareil et par
   passage (plusieurs cartes = un résumé). Stocké dans .data/alerts.json (abonnements, listes, relevés), écriture atomique ; un
   abonnement refusé par le service de push (404 / 410, jeton FCM périmé) est retiré. Le serveur doit tourner en continu pour que les passages aient lieu.
   Route publique, donc bornée : enregistrements et contrôles à la demande comptés par IP, 10 appareils par IP, 64 Ko par liste, cartes au total plafonnées ;
   serveur plein : un nouvel appareil est refusé (507), jamais un abonné évincé (seulement un enregistrement sans prix ni notification réussie).
   « Vérifier les prix » ne relève que les cartes de cet appareil ; un relevé par carte et par heure au plus (sinon il remplace le dernier). */
const ALERTS_ON = (PUSH_ON || FCM_ON) && process.env.ALERTS !== '0';
const SCRY_UP = (process.env.SCRYFALL_UPSTREAM || 'https://api.scryfall.com').replace(/\/+$/, '');            // surchargeable pour les tests
const AL_EVERY = Number(process.env.ALERT_EVERY_MS) || 6 * 3600e3;
const AL_FIRST = process.env.ALERT_FIRST_MS === undefined ? 90e3 : Number(process.env.ALERT_FIRST_MS);
const AL_FILE = process.env.ALERT_FILE || join(EDH_DIR, 'alerts.json');
const AL_SEED = Number(process.env.ALERT_SEED_MS ?? 2500);
const AL_MIN_DROP = Number(process.env.ALERT_MIN_DROP_CENTS) || 50, AL_COOL = Number(process.env.ALERT_COOLDOWN_MS ?? 5 * 86400e3), AL_CHECK_GAP = Number(process.env.ALERT_CHECK_GAP_MS ?? 90e3);
const AL_MAX_ITEMS = 400, AL_MAX_SUBS = Number(process.env.ALERT_MAX_SUBS) || 500, AL_HIST_MAX = 48, AL_HIST_AGE = 14 * 86400e3, AL_HITS_KEEP = 20, AL_BASE_WIN = 12;
const AL_RATE = Number(process.env.ALERT_RATE_PER_H ?? 30), AL_PER_IP = Number(process.env.ALERT_MAX_PER_IP) || 10, AL_MAX_CARDS = Number(process.env.ALERT_MAX_CARDS) || 50000;
const AL_HIST_GAP = Number(process.env.ALERT_HIST_GAP_MS ?? 3600e3), AL_BODY_MAX = 64 * 1024, AL_STALE = 30 * 86400e3;
// ip : appareil → réseau qui l'a enregistré, en mémoire seulement (jamais écrit sur disque) ; sert au plafond par IP.
const AL = { subs: new Map(), px: new Map(), ip: new Map(), run: null, saveT: null, seedT: null, last: { at: 0, ok: 0, miss: 0, hits: 0, err: '' }, warned: false };
const alKey = name => String(name || '').split('//')[0].replace(/æ/gi, 'ae').replace(/œ/gi, 'oe').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’‘`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const alEur = c => (c / 100).toFixed(2).replace('.', ',') + ' €';
const alId = key => createHash('sha1').update(key).digest('hex').slice(0, 24);                  // key : pushKey(cible) → un enregistrement par abonnement ou jeton FCM
const alMedian = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

async function alLoad() {
  try {
    const j = JSON.parse(await readFile(AL_FILE, 'utf8'));
    for (const r of Array.isArray(j.subs) ? j.subs : []) if (r && r.id && r.sub && Array.isArray(r.items)) AL.subs.set(r.id, r);
    for (const [k, h] of Object.entries(j.px || {})) if (Array.isArray(h)) AL.px.set(k, h);
    if (j.last && typeof j.last === 'object') AL.last = { ...AL.last, ...j.last, err: '' };
  } catch (e) { if (e && e.code !== 'ENOENT') console.warn('Alertes : fichier illisible (' + e.message + '), repart de zéro'); }
}
function alSaveSoon() {
  if (AL.saveT) return;
  AL.saveT = setTimeout(async () => {
    AL.saveT = null;
    try {
      await mkdir(dirname(AL_FILE), { recursive: true });
      const tmp = AL_FILE + '.tmp';
      await writeFile(tmp, JSON.stringify({ v: 1, last: AL.last, subs: [...AL.subs.values()], px: Object.fromEntries(AL.px) }));
      await rename(tmp, AL_FILE);
    } catch (e) { if (!AL.warned) { AL.warned = true; console.warn('Alertes : écriture impossible (' + e.message + ') : les listes restent en mémoire jusqu\'au prochain redémarrage'); } }
  }, 1500);
  AL.saveT.unref();
}

/** Prix tendance (centimes) des noms demandés : Map clé → centimes, ou null si Scryfall ne connaît pas la carte / n'a pas de prix. */
async function alFetch(list) {
  const out = new Map();
  for (let i = 0; i < list.length; i += 75) {
    const chunk = list.slice(i, i + 75);
    const r = await fetch(SCRY_UP + '/cards/collection', { method: 'POST', signal: AbortSignal.timeout(20000), redirect: 'manual',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ identifiers: chunk.map(([, n]) => ({ name: String(n).split('//')[0].trim() })) }) });
    if (r.status === 429) throw new Error('Scryfall : trop de requêtes (429)');
    if (!r.ok) throw new Error('Scryfall : HTTP ' + r.status);
    const j = await r.json();
    const got = new Map();
    for (const c of j.data || []) got.set(alKey(c.name), eurC(c.prices && c.prices.eur));
    for (const [k] of chunk) out.set(k, got.has(k) ? got.get(k) : null);
    if (i + 75 < list.length) await sleepMs(120);
  }
  return out;
}
const eurC = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };

/** Cartes d'un abonnement qui méritent une alerte, d'après les relevés partagés. Met à jour l'état par carte (dernier envoi, ré-armement). */
function alEval(rec, now) {
  const hits = [], thr = rec.thr / 100;
  for (const it of rec.items) {
    const h = AL.px.get(it.nk); if (!h || !h.length) continue;
    const cur = h[h.length - 1][1], prev = h.slice(0, -1).slice(-AL_BASE_WIN).map(x => x[1]);
    if (it.t) {                                                                    // prix cible : une alerte, ré-armée quand le prix remonte
      if (cur > it.t) { it.arm = true; continue; }
      if (it.arm === false) continue;
      it.arm = false; it.nt = now; it.na = cur;
      hits.push({ k: it.k, n: it.n, why: 'target', t: it.t, to: cur, from: prev.length ? alMedian(prev) : cur, d: it.d || [], at: now });
      continue;
    }
    if (!prev.length) continue;
    const base = alMedian(prev), drop = base - cur;
    if (drop < AL_MIN_DROP || drop / base < thr) continue;
    if (it.nt && now - it.nt < AL_COOL && cur > (it.na || 0) * 0.85) continue;      // déjà signalée : seulement si elle rechute d'au moins 15 %
    it.nt = now; it.na = cur;
    hits.push({ k: it.k, n: it.n, why: 'drop', from: base, to: cur, pct: Math.round(drop / base * 100), d: it.d || [], at: now });
  }
  return hits;
}
function alMessage(hits) {
  if (hits.length === 1) {
    const h = hits[0], deck = h.d && h.d.length ? ' · manque à ' + h.d[0] : '';
    return h.why === 'target'
      ? { title: `${h.n} à ${alEur(h.to)}`, body: `Sous ton prix cible de ${alEur(h.t)} (tendance Cardmarket).` + deck }
      : { title: `${h.n} : −${h.pct} %`, body: `${alEur(h.from)} → ${alEur(h.to)} (tendance Cardmarket).` + deck };
  }
  const part = h => h.why === 'target' ? `${h.n} ${alEur(h.to)}` : `${h.n} −${h.pct} %`;
  return { title: `${hits.length} cartes en baisse`, body: hits.slice(0, 3).map(part).join(', ') + (hits.length > 3 ? ` et ${hits.length - 3} autre${hits.length > 4 ? 's' : ''}` : '') };
}

/** Un passage : relève les prix des cartes suivies, puis prévient chaque appareil concerné. `seed` : seulement les cartes jamais relevées (pas d'alerte) ;
    `rec` : un seul appareil (« Vérifier les prix »), résultat gardé dans rec.last. Les passages s'attendent les uns les autres, jamais deux à la fois. */
async function alTick(opt = {}) {
  if (!ALERTS_ON) return null;
  while (AL.run) await AL.run;
  AL.run = alPass(opt).finally(() => { AL.run = null; });
  return AL.run;
}
async function alPass({ seed = false, rec = null }) {
  const now = Date.now(), recs = rec ? [rec] : [...AL.subs.values()], out = { at: now, ok: 0, miss: 0, hits: 0, err: '' };
  try {
    const want = new Map();
    for (const r of recs) for (const it of r.items) if (!want.has(it.nk)) want.set(it.nk, it.n);
    const ask = [...want].filter(([k]) => !seed || !(AL.px.get(k) || []).length);
    if (!ask.length && seed) return AL.last;
    const got = ask.length ? await alFetch(ask) : new Map();
    for (const [k, c] of got) {
      if (c == null) { out.miss++; continue; }
      out.ok++; const h = AL.px.get(k) || [], l = h[h.length - 1];
      if (l && now - l[0] < AL_HIST_GAP) l[1] = c;                                // relevé de moins d'une heure : remplacé (contrôles répétés : la médiane garde sa profondeur)
      else h.push([now, c]);
      while (h.length > AL_HIST_MAX || (h.length > 2 && now - h[0][0] > AL_HIST_AGE)) h.shift();
      AL.px.set(k, h);
    }
    if (!seed && !rec) for (const k of [...AL.px.keys()]) if (!want.has(k)) AL.px.delete(k);
    if (seed) AL.last.err = '';
    else {
      for (const r of recs) {
        const hits = alEval(r, now); if (!hits.length) continue;
        r.hits = [...hits, ...(r.hits || [])].slice(0, AL_HITS_KEEP);
        const m = alMessage(hits), st = await sendPush({ sub: r.sub, title: m.title.slice(0, 80), body: m.body.slice(0, 200), url: './?alerts=1', kind: 'alert', topic: 'deckdeal-alert', ttl: 43200, urgency: 'normal' });
        if (st && st < 300) { out.hits++; r.pushed = now; console.log('alerte envoyée (' + hits.length + ' carte' + (hits.length > 1 ? 's' : '') + ')'); }
        else if (st === 404 || st === 410) { AL.subs.delete(r.id); console.warn('alerte : ' + (r.sub.fcm ? 'jeton FCM périmé' : 'abonnement expiré') + ', retiré'); }
        else console.warn('alerte refusée (' + (st || 'réseau') + ')');
      }
      if (!rec) AL.last = out;
    }
  } catch (e) { out.err = String(e && e.message || e).slice(0, 160); if (!rec) AL.last = { ...AL.last, err: out.err }; console.warn('Alertes : ' + out.err); }
  if (rec) rec.last = out;
  alSaveSoon();
  return rec ? out : AL.last;
}
function alSeedSoon() { if (AL.seedT) return; AL.seedT = setTimeout(() => { AL.seedT = null; alTick({ seed: true }); }, AL_SEED); AL.seedT.unref(); }

const alStr = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '';
/** Serveur plein : retire l'enregistrement le plus ancien qui ne peut être un abonné actif (aucune notification réussie, et aucune carte au prix connu
    depuis plus d'une heure, ou pas réenregistré depuis 30 jours alors que l'appli le refait toutes les 12 h). Faux si aucun : le nouveau venu est refusé. */
function alEvict(now, keep = '') {
  let pick = null;
  for (const r of AL.subs.values()) {
    if (r.id === keep || r.pushed || !(now - r.at > AL_STALE || (now - r.at > 3600e3 && !r.items.some(it => (AL.px.get(it.nk) || []).length)))) continue;
    if (!pick || r.at < pick.at) pick = r;
  }
  if (pick) { AL.subs.delete(pick.id); console.warn('Alertes : serveur plein, enregistrement inactif retiré'); }
  return !!pick;
}
async function alertsApi(req, res, path, url) {
  if (!ALERTS_ON) return json(res, 404, { error: 'alerts_disabled', message: PUSH_ON || FCM_ON ? 'Alertes désactivées (ALERTS=0).' : 'Notifications non configurées (clés VAPID ou compte de service FCM manquants).' });
  const sub = path.replace(/^alerts\/?/, '');
  const id = String(url.searchParams.get('id') || '');
  if (req.method === 'PUT' && !sub) {
    const wait = rateWait(req, 'alerts', AL_RATE, 3600e3); if (wait) return tooMany(res, wait);
    let b; try { b = JSON.parse((await readBody(req, AL_BODY_MAX)).toString('utf8') || '{}'); } catch (e) { return e.status === 413 ? tooLarge(res) : json(res, 400, { error: 'bad_request', message: 'JSON invalide' }); }
    const pu = parsePush({ sub: b && b.sub, url: './?alerts=1' });
    if (!pu) return json(res, 400, { error: 'bad_subscription', message: 'Abonnement push invalide ou refusé.' });
    const rid = alId(pushKey(pu.sub)), old = AL.subs.get(rid), oldItems = new Map(((old && old.items) || []).map(x => [x.nk, x])), net = clientOf(req), now = Date.now();
    const items = new Map();
    for (const x of Array.isArray(b.items) ? b.items : []) {
      if (items.size >= AL_MAX_ITEMS) break;
      const n = alStr(x && x.n, 150), nk = alKey(n); if (!nk || items.has(nk)) continue;
      const t = Number.isSafeInteger(x.t) && x.t > 0 && x.t <= 1e6 ? x.t : 0, d = (Array.isArray(x.d) ? x.d : []).map(y => alStr(y, 40)).filter(Boolean).slice(0, 3), prev = oldItems.get(nk) || {};
      items.set(nk, { k: alStr(x.k, 150) || nk, n, nk, ...(t ? { t } : {}), ...(d.length ? { d } : {}), ...(prev.nt ? { nt: prev.nt, na: prev.na } : {}), ...(t && prev.t === t && prev.arm === false ? { arm: false } : {}) });
    }
    if (!items.size) { AL.subs.delete(rid); alSaveSoon(); return json(res, 200, { ok: true, id: rid, watching: 0 }); }
    const thr = Math.min(80, Math.max(10, Math.round(Number(b.thr)) || 30));
    if (!old) {
      if (net && [...AL.subs.keys()].filter(k => AL.ip.get(k) === net).length >= AL_PER_IP) return json(res, 429, { error: 'too_many_devices', message: 'Trop d\'appareils enregistrés depuis ce réseau.' });
      if (AL.subs.size >= AL_MAX_SUBS && !alEvict(now)) return json(res, 507, { error: 'alerts_full', message: 'Le serveur surveille déjà le maximum d\'appareils : réessaie plus tard.' }, { 'Retry-After': '3600' });
    }
    const cards = () => { let n = items.size; for (const r of AL.subs.values()) if (r.id !== rid) n += r.items.length; return n; };
    while (cards() > AL_MAX_CARDS) if (!alEvict(now, rid)) return json(res, 507, { error: 'alerts_full', message: 'Le serveur surveille déjà le maximum de cartes : réessaie plus tard.' }, { 'Retry-After': '3600' });
    AL.subs.set(rid, { ...(old || {}), id: rid, sub: pu.sub, thr, at: now, items: [...items.values()], hits: (old && old.hits) || [] });
    if (net) { AL.ip.set(rid, net); if (AL.ip.size > 2 * AL_MAX_SUBS) for (const k of AL.ip.keys()) if (!AL.subs.has(k)) AL.ip.delete(k); }
    alSaveSoon(); alSeedSoon();
    return json(res, 200, { ok: true, id: rid, watching: items.size, thr, last: AL.last.at, next: AL.last.at ? AL.last.at + AL_EVERY : 0 });
  }
  const rec = AL.subs.get(id);
  if (req.method === 'GET' && !sub) {
    if (!rec) return json(res, 404, { error: 'not_registered', message: 'Cet appareil n\'est pas (ou plus) enregistré pour les alertes.' });
    const prices = {};
    for (const it of rec.items) { const h = AL.px.get(it.nk); if (h && h.length) prices[it.k] = { c: h[h.length - 1][1], b: h.length > 1 ? alMedian(h.slice(0, -1).slice(-AL_BASE_WIN).map(x => x[1])) : 0 }; }
    const last = rec.last && rec.last.at > AL.last.at ? rec.last : AL.last;          // le plus récent : passage de toutes les 6 h ou contrôle de cet appareil
    return json(res, 200, { id: rec.id, thr: rec.thr, watching: rec.items.length, priced: Object.keys(prices).length, last, next: AL.last.at ? AL.last.at + AL_EVERY : 0, every: AL_EVERY, prices, hits: rec.hits || [] });
  }
  if (req.method === 'DELETE' && !sub) { const had = AL.subs.delete(id); if (had) alSaveSoon(); return json(res, 200, { ok: true, removed: had }); }
  if (req.method === 'POST' && sub === 'check') {
    if (!rec) return json(res, 404, { error: 'not_registered', message: 'Cet appareil n\'est pas (ou plus) enregistré pour les alertes.' });
    const gap = (rec.checkAt || 0) + AL_CHECK_GAP - Date.now();
    if (gap > 0) return json(res, 200, { ok: true, skipped: true, retry: Math.ceil(gap / 1000), last: rec.last || AL.last });
    const wait = rateWait(req, 'alcheck', AL_RATE, 3600e3); if (wait) return tooMany(res, wait);
    rec.checkAt = Date.now(); const last = await alTick({ rec });
    return json(res, 200, { ok: !last.err, last, error: last.err || undefined });
  }
  return json(res, 405, { error: 'method_not_allowed' });
}

const jobs = new Map(); let jobBytes = 0;                            // jobBytes : résultats gardés par toutes les tâches (plafond JOB_RES_MAX)
function newJob({ lang, foil, bps, fresh, tok = TOKEN, th = '' }) {
  const sig = createHash('sha1').update([tok === TOKEN ? '' : tok, lang, foil, ...bps.slice().sort((a, b) => a - b)].join(',')).digest('hex');      // un token différent : une tâche à part (elle tourne avec ce token)
  const now = Date.now();
  let same = null;                                                    // la tâche la plus récente de même signature (en cours, ou terminée et encore valable)
  for (const j of jobs.values()) if (j.sig === sig && (j.status === 'running' || (j.status === 'done' && !fresh && now - j.end < OFFER_TTL)) && (!same || j.t0 > same.t0)) same = j;
  if (same) return { job: same, attached: true };
  const running = [...jobs.values()].filter(j => j.status === 'running');
  if (running.length >= JOB_MAX_RUNNING) return { busy: true };
  if (th && running.filter(j => j.th === th).length >= JOB_PER_TOKEN) return { busy: true, mine: true };
  // th : empreinte du token de l'utilisateur ('' : token du serveur) ; tok n'est gardé que le temps de la recherche (effacé dès la fin, l'échec ou l'annulation).
  const job = { id: randomBytes(12).toString('hex'), sig, tok, th, lang, foil, fresh: !!fresh, bps, queue: bps.slice(), total: bps.length, results: [], bytes: 0, done: 0, cached: 0, cacheAge: 0, oldest: Infinity, errors: 0, sent: 0, stamps: [],
    status: 'running', fatal: null, ctl: new AbortController(), t0: now, end: 0, pushes: [], seenEnd: false };
  jobs.set(job.id, job);
  runJob(job);
  return { job, attached: false };
}
const jobDrop = j => { jobs.delete(j.id); jobBytes -= j.bytes; };
const jobStop = (j, status) => { j.status = status; j.ctl.abort(); j.tok = null; j.end = Date.now(); };
/** Garde un résultat dans la limite JOB_RES_MAX : les tâches terminées les plus anciennes sont oubliées d'abord ; plafond encore dépassé, la tâche
    échoue (l'appli relance ce qui manque, lu dans le cache des offres, puis le lit elle-même). Faux si la tâche s'arrête. */
function jobKeep(job, res, size) {
  if (jobBytes + size > JOB_RES_MAX) for (const j of [...jobs.values()].filter(x => x.end).sort((a, b) => a.end - b.end)) { jobDrop(j); if (jobBytes + size <= JOB_RES_MAX) break; }
  if (jobBytes + size > JOB_RES_MAX) { jobStop(job, 'failed'); return false; }
  job.results.push(res); job.bytes += size; jobBytes += size; return true;
}
async function runJob(job) {
  const worker = async () => {
    while (job.status === 'running') {
      const bp = job.queue.shift(); if (bp === undefined) return;
      const k = okey(bp, job.lang, job.foil), hit = job.fresh || !tokOk(job.th) ? null : offersGet(k);       // cache partagé : seulement pour un token déjà accepté par CardTrader
      let products = null, error = null, size = 64;
      if (hit) { products = hit.products; size = hit.size; job.cached++; job.cacheAge = Math.max(job.cacheAge, Date.now() - hit.t); job.oldest = Math.min(job.oldest, hit.t); }
      else {
        try { const at = Date.now(); products = await fetchProducts(bp, job.lang, job.foil, job.ctl.signal, job.tok); tokSeen(job.th); size = offersSet(k, products); job.sent++; job.stamps.push(Date.now()); job.oldest = Math.min(job.oldest, at); }
        catch (e) {
          if (e.cancelled) return;
          if (e.fatal) { job.fatal = e.fatal; jobStop(job, 'failed'); return; }
          error = e.message || 'error'; job.errors++;
        }
      }
      if (job.status !== 'running' || !jobKeep(job, error ? { bp, error } : { bp, products }, size)) return;
      job.done++;
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(JOB_CONC, job.queue.length) }, worker)); }
  catch (e) { console.error('job:', e); if (job.status === 'running') job.status = 'failed'; }
  if (job.status === 'running') job.status = 'done';
  job.tok = null; job.end = job.end || Date.now();
  pushWhenDone(job);
}
function gcJobs() {
  const now = Date.now(), fin = [];
  for (const j of jobs.values()) {
    if (j.status === 'running' && now - j.t0 > 30 * 60e3) jobStop(j, 'cancelled');
    if (j.end && now - j.end > JOB_KEEP) jobDrop(j); else if (j.end) fin.push(j);
  }
  fin.sort((a, b) => a.end - b.end); while (fin.length > JOB_MAX_KEPT) jobDrop(fin.shift());
}
if (JOBS_ON) setInterval(gcJobs, 30e3).unref();

async function jobsApi(req, res, path, url, tok = TOKEN, th = '') {
  if (!JOBS_ON) return json(res, 404, { error: 'jobs_disabled' });
  const m = /^jobs(?:\/([a-f0-9]{24}))?$/.exec(path);
  if (!m) return json(res, 404, { error: 'not_found' });
  if (req.method === 'POST' && !m[1]) {
    if (th) { const wait = rateWait(req, 'jobs', USER_JOBS_H, 3600e3); if (wait) return tooMany(res, wait); }
    let b; try { b = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch (e) { return e.status === 413 ? tooLarge(res) : json(res, 400, { error: 'bad_request', message: 'JSON invalide' }); }
    const lang = b && b.lang == null ? '' : String(b && b.lang), foil = b && b.foil == null ? 'any' : String(b && b.foil);
    const ids = Array.isArray(b && b.bps) ? [...new Set(b.bps)] : [];
    if (!b || b.type !== 'offers' || !/^([a-z]{2}(-[A-Za-z]{2})?)?$/.test(lang) || !['no', 'yes', 'any'].includes(foil) || !ids.length || ids.length > JOB_MAX_BPS || !ids.every(x => Number.isSafeInteger(x) && x > 0))
      return json(res, 400, { error: 'bad_request', message: 'Paramètres invalides (type, lang, foil ou bps).' });
    const r = newJob({ lang, foil, bps: ids, fresh: !!b.fresh, tok, th });
    if (r.busy) return json(res, 429, { error: 'busy', message: r.mine ? 'Trop de recherches en cours avec ce token.' : 'Trop de recherches en cours sur le serveur.' }, { 'Retry-After': '10' });
    const pu = parsePush(b.push);
    if (pu && r.job.status === 'running' && r.job.pushes.length < 3 && !r.job.pushes.some(x => pushKey(x.sub) === pushKey(pu.sub))) r.job.pushes.push(pu);
    return json(res, 202, { id: r.job.id, total: r.job.total, attached: r.attached, status: r.job.status, push: !!pu });
  }
  const job = m[1] && jobs.get(m[1]);
  if (!job) return json(res, m[1] ? 404 : 405, { error: m[1] ? 'job_not_found' : 'method_not_allowed', message: m[1] ? 'Recherche introuvable (serveur redémarré ou trop ancienne).' : undefined });
  if (req.method === 'DELETE') { if (job.status === 'running') { jobStop(job, 'cancelled'); job.pushes.length = 0; } return json(res, 200, { id: job.id, status: job.status }); }
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
/** Essai invalide : compté pour l'IP (blocage au 15e) puis freiné. */
async function badHit(req) {
  const k = ipOf(req), now = Date.now();
  if (BAD.size > 1000) for (const [kk, v] of BAD) if (now - v.first > BAD_WIN && v.until < now) BAD.delete(kk);
  let e = BAD.get(k);
  if (!e || (now - e.first > BAD_WIN && e.until < now)) e = { n: 0, first: now, until: 0 };
  e.n++;
  if (e.n >= BAD_MAX && req.headers['x-forwarded-for']) e.until = now + BAD_LOCK;
  BAD.set(k, e);
  await new Promise(r => setTimeout(r, Number(process.env.BAD_KEY_DELAY_MS ?? 400)));
}
async function badKey(req, res, error = 'bad_app_key', status = 401) {
  await badHit(req);
  return json(res, status, { error, message: error === 'forbidden' ? 'Ce compte n\'est pas autorisé sur ce serveur.' : error === 'bad_token' ? 'Jeton de connexion invalide.' : undefined });
}

// Budgets par client sur les routes publiques coûteuses (seau de jetons : `cap` requêtes d'avance, rechargé de `cap` par période `per`).
// Client : l'IP ci-dessus, réseau /64 pour une IPv6 (une box en reçoit des milliards). Boucle locale sans X-Forwarded-For : clients indiscernables, pas de limite (comme BAD).
// Token d'un utilisateur : 360 relais par minute (le rythme maximal de l'appli, 6/s) ; 120 recherches par heure (un refus renvoie l'appli à la lecture depuis l'appareil).
const IMPORT_RATE = Number(process.env.IMPORT_RATE_PER_H ?? 30), USER_RATE = Number(process.env.USER_RATE_PER_MIN ?? 360), USER_JOBS_H = Number(process.env.USER_JOBS_PER_H ?? 120);
const BUCKETS = new Map();
/** Réseau d'une adresse : IPv4 telle quelle, préfixe /64 d'une IPv6. */
function netOf(ip) {
  const v4 = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(ip); if (v4 || !ip.includes(':')) return v4 ? v4[1] : ip;
  const [a, b] = ip.split('::'), h = a ? a.split(':') : [], t = b ? b.split(':') : [];
  const g = b === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return g.slice(0, 4).map(x => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64';
}
const clientOf = req => !req.headers['x-forwarded-for'] && /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '') ? '' : netOf(ipOf(req));
/** 0 : requête permise (un jeton consommé) ; sinon secondes à attendre. cap ≤ 0 : sans limite. */
function rateWait(req, name, cap, per) {
  const c = clientOf(req); if (!c || !(cap > 0)) return 0;
  const k = name + ' ' + c, now = Date.now(); let b = BUCKETS.get(k);
  if (!b) { if (BUCKETS.size > 10000) for (const [kk, v] of BUCKETS) if (now - v.t > v.per) BUCKETS.delete(kk); b = { n: cap, t: now, per }; BUCKETS.set(k, b); }
  b.n = Math.min(cap, b.n + (now - b.t) * cap / per); b.t = now;
  if (b.n >= 1) { b.n--; return 0; }
  return Math.max(1, Math.ceil((1 - b.n) * per / cap / 1000));
}
const tooMany = (res, s) => json(res, 429, { error: 'rate_limited', message: 'Trop de requêtes depuis ce réseau : réessaie dans quelques minutes.', retry: s }, { 'Retry-After': String(s) });
// Corps trop gros : réponse puis fermeture de la connexion (le reste du corps n'est jamais lu).
const tooLarge = res => json(res, 413, { error: 'too_large', message: 'Requête trop grosse.' }, { Connection: 'close' });

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

// Au-delà de `max` : lecture arrêtée (requête en pause), erreur 413 ; la réponse (tooLarge) ferme ensuite la connexion.
const readBody = (req, max = 256 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  const onData = c => { n += c.length; if (n > max) { req.off('data', onData); req.pause(); reject(Object.assign(new Error('too large'), { status: 413 })); } else chunks.push(c); };
  req.on('data', onData);
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


/** Ce visiteur peut-il chercher avec le token du serveur ? (compte autorisé, bonne clé, ou serveur local ouvert) Jeton Firebase refusé : sans pénalité
    (aucune devinette possible) ; mauvaise APP_KEY : comptée et freinée comme dans authorize, IP bloquée → false (sinon /__me servirait à deviner la clé). */
async function serverOk(req) {
  if (!TOKEN) return false;
  if (!APP_KEY && !AUTH_FB) return true;
  if (isLocked(req)) return false;
  const key = String(req.headers['x-app-key'] || ''), tok = String(req.headers['x-firebase-token'] || '');
  if (APP_KEY && key && safeEq(key, APP_KEY)) return true;
  if (AUTH_FB && tok) { try { await verifyIdToken(tok); return true; } catch (e) { /* jeton refusé */ } }
  if (APP_KEY && key) await badHit(req);
  return false;
}

/* ── Import d'une liste depuis un lien (menu « Partager » de l'appli EDHREC, Archidekt, Moxfield) ──────────────────────────
   Ouvert à tous (limité par IP), lecture seule, hôtes en liste blanche, aucune redirection suivie, 2 Mo et 8 s maximum. Le serveur renvoie la liste en texte
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
  const big = () => Object.assign(new Error('Réponse trop grosse'), { status: 413 });
  const len = Number(r.headers.get('content-length')); if (len > IMPORT_MAX) { r.body && r.body.cancel().catch(() => {}); throw big(); }
  const parts = []; let n = 0;                                          // lu en flux : une réponse sans longueur annoncée est coupée dès IMPORT_MAX
  if (r.body) {
    const rd = r.body.getReader();
    try { for (let c; !(c = await rd.read()).done;) { n += c.value.length; if (n > IMPORT_MAX) throw big(); parts.push(c.value); } }
    catch (e) { rd.cancel().catch(() => {}); throw e.status ? e : Object.assign(new Error('Site injoignable'), { status: 502 }); }
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (e) { throw Object.assign(new Error('Réponse illisible'), { status: 502 }); }
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
  const wait = rateWait(req, 'import', IMPORT_RATE, 3600e3); if (wait) return tooMany(res, wait);       // route publique : IMPORT_RATE_PER_H lectures par heure et par IP (un lien refusé d'office ne compte pas)
  try {
    const r = parse(await getJsonLimited(target, headers));
    if (!r.main.length && !r.cmd.length) return json(res, 422, { error: 'empty', message: 'Aucune carte trouvée dans cette liste.' });
    return json(res, 200, { site, name: r.name, count: r.cmd.length + r.main.length, text: toText(r.cmd.slice(0, 4), r.main.slice(0, IMPORT_LINES)) });
  } catch (e) { return json(res, e.status || 502, { error: 'import_failed', message: e.message }); }
}

async function api(req, res, url) {
  const path = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  // Serveur local sans compte : un POST d'une autre page (formulaire, text/plain : pas de pré-vérification CORS) ne doit rien déclencher.
  if (LOCAL && req.method === 'POST' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return json(res, 415, { error: 'bad_content_type', message: 'Content-Type: application/json attendu.' });
  // Ouvert à tous : import d'une liste depuis un lien, alertes de prix (Scryfall + push). Ni l'un ni l'autre n'utilise de token CardTrader.
  if (path === 'import') return importApi(req, res, url);
  if (path === 'alerts' || path.startsWith('alerts/')) return alertsApi(req, res, path, url);
  // CardTrader : avec le token de l'utilisateur (X-CT-Token), ou celui du serveur pour les comptes autorisés (ALLOWED_UIDS / APP_KEY).
  const ut = userTok(req);
  if (!ut && !(await authorize(req, res))) return;
  const tok = ut || TOKEN, th = ut ? tokHash(ut) : '';
  if (!tok) return json(res, 401, { error: 'no_token', message: 'Token CardTrader requis : ajoute le tien dans les réglages.' });
  if (path === 'jobs' || path.startsWith('jobs/')) return jobsApi(req, res, path, url, tok, th);
  const allowed = ALLOW[req.method];
  if (!allowed) return json(res, 405, { error: 'method_not_allowed' });
  if (!allowed.has(path)) return json(res, 403, { error: 'blocked', message: 'Route non autorisée par le proxy : ' + path });
  if (th) { const wait = rateWait(req, 'ct', 2 * USER_RATE, 120e3); if (wait) return tooMany(res, wait); }      // token d'un utilisateur : relais plafonnés par IP (USER_RATE par minute, rafale de 2 min)

  const target = UPSTREAM + path + url.search;
  const cacheable = req.method === 'GET' && (path === 'expansions' || path === 'blueprints/export');
  if (cacheable && tokOk(th)) {
    const hit = cache.get(target);
    if (hit && Date.now() - hit.t < CACHE_TTL) {
      res.writeHead(200, { ...SEC, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'x-cache': 'HIT' });
      return res.end(hit.body);
    }
  }

  const init = { method: req.method, headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } };
  if (req.method === 'POST') {
    init.body = await readBody(req);
    init.headers['Content-Type'] = 'application/json';
  }
  if (upQueue.length >= UP_QUEUE_MAX) return json(res, 503, { error: 'busy', message: 'Trop de requêtes en attente.' }, { 'Retry-After': '2' });
  if (path === 'marketplace/products') await pace(tok); // même budget que les tâches de fond
  await upGate();
  init.signal = AbortSignal.timeout(30000); // armé après l'attente en file, pas avant
  let up, body;
  try {
    try { up = await fetch(target, init); body = Buffer.from(await up.arrayBuffer()); }
    catch (e) { return json(res, 502, { error: 'upstream_unreachable', message: String(e && e.message || e) }); }
  } finally { upDone(); }
  const headers = { ...SEC, 'Content-Type': up.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' };
  const ra = up.headers.get('retry-after'); if (ra) headers['Retry-After'] = ra;
  if (up.ok) tokSeen(th);
  if (cacheable && up.ok) cacheSet(target, body);
  res.writeHead(up.status, headers);
  res.end(body);
}

/* ── Fichiers servis : lus et compressés une seule fois (gzip + brotli, hors du fil principal), ETag → 304 ──────────────────────
   Relus seulement si la date de modification change (un « git pull » de déploiement est pris en compte sans redémarrage).
   Brotli (≈ 20 % plus léger que gzip) n'est servi qu'une fois prêt : en attendant, gzip. */
const FILES = new Map();
const sha1Of = (() => { const memo = new WeakMap(); return buf => { let h = memo.get(buf); if (!h) { h = createHash('sha1').update(buf).digest('hex').slice(0, 20); memo.set(buf, h); } return h; }; })();
const notModified = (req, etag) => String(req.headers['if-none-match'] || '').split(',').some(t => t.trim().replace(/^W\//, '') === etag);
async function fileEntry(f, compress) {
  const mt = (await stat(f)).mtimeMs, cur = FILES.get(f);
  if (cur && cur.mt === mt) return cur;
  const raw = await readFile(f), e = { mt, raw, tag: sha1Of(raw), gz: null, br: null, gzP: null };
  if (compress) {
    e.gzP = gzipA(raw, { level: 9 }).then(b => (e.gz = b), () => null);
    brotliA(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: raw.length, [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT } }).then(b => { e.br = b; }, () => {});
  }
  FILES.set(f, e); return e;
}
async function sendFile(req, res, f, headers, compress) {
  const e = await fileEntry(f, compress), hd = { ...SEC, ...headers };
  const ae = String(req.headers['accept-encoding'] || ''), wantBr = compress && /\bbr\b/i.test(ae), wantGz = compress && /\bgzip\b/i.test(ae);
  if (wantGz && !e.gz && !(wantBr && e.br)) await e.gzP;
  const enc = wantBr && e.br ? 'br' : wantGz && e.gz ? 'gzip' : '', data = enc === 'br' ? e.br : enc ? e.gz : e.raw;
  if (compress) hd.Vary = 'Accept-Encoding';
  hd.ETag = '"' + e.tag + (enc ? '-' + enc : '') + '"';
  if (notModified(req, hd.ETag)) { delete hd['Content-Type']; res.writeHead(304, hd); return res.end(); }
  if (enc) hd['Content-Encoding'] = enc;
  hd['Content-Length'] = data.length; res.writeHead(200, hd);
  res.end(req.method === 'HEAD' ? undefined : data);
}
/** Prépare la page et les gros fichiers dès le démarrage : le premier visiteur n'attend pas la compression. */
function warmFiles() {
  if (PAGE) fileEntry(PAGE, true).catch(() => {});
  for (const st of STATIC.values()) if (st[3] === true) fileEntry(join(PWA, st[0]), true).catch(() => {});
}

const server = http.createServer(async (req, res) => {
  try {
    if (LOCAL && !LOCAL_HOSTS.test(String(req.headers.host || ''))) return json(res, 403, { error: 'bad_host', message: 'Serveur local : ouvre-le par http://localhost.' });
    // Servi en https par le reverse proxy de l'hébergeur : le navigateur s'en souvient 180 jours (jamais en http, où l'en-tête n'aurait pas de sens).
    if (String(req.headers['x-forwarded-proto'] || '').split(',').pop().trim().toLowerCase() === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    const url = new URL(String(req.url).replace(/^\/+/, '/'), 'http://x'); // « // » ou « //hôte/chemin » ne doivent pas être lus comme une URL absolue
    if (url.pathname === '/__me') return json(res, 200, { server: await serverOk(req) });
    if (url.pathname === '/__prices') return json(res, 200, { source: PX_SRC ? 'GitHub' : '', ...PX_ST });
    if (url.pathname === '/__ping') return json(res, 200, { ok: true, app: 'deckdeal', userToken: true, prices: !!PX_LIVE, needsKey: !!APP_KEY, needsLogin: AUTH_FB, hasToken: !!TOKEN, jobs: JOBS_ON, alerts: ALERTS_ON, push: PUSH_ON ? VAPID_PUB : '', adUnit: ADMOB_BANNER, fcm: FCM_ON });
    if (url.pathname === '/__edh') return json(res, 200, { source: EDH_SRC ? 'GitHub' : '', ...EDH_ST });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!PAGE) return json(res, 404, { error: 'page_missing', message: 'Place deck-deal.html à côté de proxy.mjs.' });
      return await sendFile(req, res, PAGE, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, true);
    }
    const st = (req.method === 'GET' || req.method === 'HEAD') && STATIC.get(url.pathname);
    if (st) {
      const src = st[4] === 'px' ? PX_LIVE : EDH_LIVE, f = join(PWA, st[0]), live = st[3] === 'pre' && src;
      if (!live && !existsSync(f)) return json(res, 404, { error: 'asset_missing', message: 'Dossier pwa/ absent à côté de proxy.mjs.' });
      const hd = { 'Content-Type': st[1], 'Cache-Control': st[2] };
      if (st[3] !== 'pre') return await sendFile(req, res, f, hd, !!st[3]);
      let data = live ? src.buf : await readFile(f); Object.assign(hd, SEC);
      hd.Vary = 'Accept-Encoding';
      const gz = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
      hd.ETag = '"' + sha1Of(data) + (gz ? '' : '-i') + '"';       // le navigateur revalide (304) au lieu de retélécharger
      if (notModified(req, hd.ETag)) { delete hd['Content-Type']; res.writeHead(304, hd); return res.end(); }
      if (gz) hd['Content-Encoding'] = 'gzip'; else { try { data = gunzipSync(data); } catch (e) { /* pas du gzip : tel quel */ } }
      hd['Content-Length'] = data.length; res.writeHead(200, hd);
      return res.end(req.method === 'HEAD' ? undefined : data);
    }
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    const st = e && e.status || 500;                                    // 500 : détail (chemins, erreurs système) dans le journal seulement
    if (st >= 500) console.error('Erreur ' + req.method + ' ' + String(req.url).split('?')[0].slice(0, 200) + ' :', e);
    if (res.headersSent) res.end();
    else if (st === 413) tooLarge(res);
    else json(res, st, { error: 'proxy_error', message: st >= 500 ? 'Erreur interne du serveur.' : String(e && e.message || e) });
  }
});

// Ne jamais laisser une erreur isolée faire tomber le site (l'hébergeur ne relance pas toujours le process).
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));
process.on('uncaughtException', e => console.error('uncaughtException:', e));

if (ALERTS_ON) await alLoad();                                  // abonnements et relevés avant d'accepter la première requête
server.listen(PORT, HOST, () => {
  warmFiles();
  console.log(`Mana Orbit → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(TOKEN ? 'Token CardTrader : OK' : '⚠ CARDTRADER_TOKEN manquant : mode démo uniquement');
  if (AUTH_FB) console.log(`Accès : compte Firebase « ${FB_PROJECT} » (${ALLOWED_UIDS.size} UID, ${ALLOWED_EMAILS.size} email${ALLOWED_EMAILS.size > 1 ? 's' : ''} vérifié${ALLOWED_EMAILS.size > 1 ? 's' : ''}).`);
  if (APP_KEY) console.log(AUTH_FB ? 'APP_KEY encore acceptée en secours : supprime-la une fois la connexion par compte validée.' : 'Clé d\'accès requise (APP_KEY) — à saisir dans Réglages.');
  if (APP_KEY && APP_KEY.length < 12) console.warn('⚠ APP_KEY courte (' + APP_KEY.length + ' caractères) : prends 16 caractères ou plus.');
  if (!PAGE) console.log('⚠ deck-deal.html introuvable à côté du proxy.');
  if (ADMOB_RAW && !ADMOB_BANNER) console.warn('⚠ ADMOB_BANNER_ID ignoré : attendu « ca-app-pub-…/… » (identifiant du bloc d\'annonces, pas celui de l\'appli).');
  if (FCM_ON) console.log(`Notifications de l'appli Android (FCM) : projet Firebase « ${fcmSa.project} ».`);
  if (ALERTS_ON) {
    const wait = Math.max(AL_FIRST, (AL.last.at || 0) + AL_EVERY - Date.now());
    setTimeout(() => { alTick(); setInterval(alTick, AL_EVERY).unref(); }, wait).unref();
    console.log(`Alertes de prix : ${AL.subs.size} appareil${AL.subs.size > 1 ? 's' : ''}, contrôle toutes les ${Math.round(AL_EVERY / 360000) / 10} h.`);
  }
  if (PX_SRC) pxBoot().then(() => { setTimeout(pxSync, EDH_FIRST + 2000).unref(); setInterval(pxSync, EDH_EVERY).unref(); });
  else pxBoot();
  if (EDH_SRC) edhBoot().catch(() => {}).then(() => { setTimeout(edhSync, EDH_FIRST).unref(); setInterval(edhSync, EDH_EVERY).unref(); });
});
