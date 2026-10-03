#!/usr/bin/env node
// Deck Deal — proxy local (aucune dépendance, Node ≥ 18).
//   CARDTRADER_TOKEN=xxxxx node proxy.mjs          → http://localhost:8787
//   HOST=0.0.0.0 ALLOWED_UIDS=<uid Firebase> node proxy.mjs  → accessible depuis le téléphone, réservé à ton compte Firebase
//   HOST=0.0.0.0 APP_KEY=un-secret node proxy.mjs  → variante : clé partagée à saisir dans Réglages
// Le token reste côté serveur. Seules les routes utiles sont relayées ; l'achat (cart/purchase) est bloqué.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createPublicKey, verify as rsaVerify } from 'node:crypto';

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

// En-têtes de sécurité sur toutes les réponses (pas de CSP : la page charge Firebase, Scryfall et Google Fonts).
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
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

async function api(req, res, url) {
  if (!(await authorize(req, res))) return;
  if (!TOKEN) return json(res, 401, { error: 'no_token', message: 'CARDTRADER_TOKEN absent côté proxy.' });

  const path = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
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
    if (url.pathname === '/__ping') return json(res, 200, { ok: true, app: 'deckdeal', needsKey: !!APP_KEY, needsLogin: AUTH_FB, hasToken: !!TOKEN });
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
      const data = await readFile(f);
      res.writeHead(200, { ...SEC, 'Content-Type': st[1], 'Cache-Control': st[2], 'Content-Length': data.length });
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
