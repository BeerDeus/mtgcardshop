#!/usr/bin/env node
// Deck Deal — proxy local (aucune dépendance, Node ≥ 18).
//   CARDTRADER_TOKEN=xxxxx node proxy.mjs          → http://localhost:8787
//   HOST=0.0.0.0 APP_KEY=un-secret node proxy.mjs  → accessible depuis le téléphone (clé obligatoire)
// Le token reste côté serveur. Seules les routes utiles sont relayées ; l'achat (cart/purchase) est bloqué.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = (process.env.CARDTRADER_TOKEN || '').trim();
const APP_KEY = (process.env.APP_KEY || '').trim();
const UPSTREAM = (process.env.CT_UPSTREAM || 'https://api.cardtrader.com/api/v2').replace(/\/+$/, '') + '/'; // surchargeable pour les tests
const PAGE = ['deck-deal.html', 'dist/deck-deal.html'].map(f => join(here, f)).find(existsSync);

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
if (!LOOPBACK.has(HOST) && !APP_KEY) {
  console.error('Refus de démarrer : HOST=' + HOST + ' expose ton token CardTrader. Définis APP_KEY=un-secret.');
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
async function badKey(req, res) {
  const k = ipOf(req), now = Date.now();
  if (BAD.size > 1000) for (const [kk, v] of BAD) if (now - v.first > BAD_WIN && v.until < now) BAD.delete(kk);
  let e = BAD.get(k);
  if (!e || (now - e.first > BAD_WIN && e.until < now)) e = { n: 0, first: now, until: 0 };
  e.n++;
  if (e.n >= BAD_MAX && req.headers['x-forwarded-for']) e.until = now + BAD_LOCK;
  BAD.set(k, e);
  await new Promise(r => setTimeout(r, Number(process.env.BAD_KEY_DELAY_MS ?? 400)));
  return json(res, 401, { error: 'bad_app_key' });
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

async function api(req, res, url) {
  if (APP_KEY) {
    if (isLocked(req)) return json(res, 429, { error: 'too_many_attempts', message: 'Trop de clés invalides : réessaie dans quelques minutes.' }, { 'Retry-After': '300' });
    if (!safeEq(String(req.headers['x-app-key'] || ''), APP_KEY)) return badKey(req, res);
  }
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
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__ping') return json(res, 200, { ok: true, app: 'deckdeal', needsKey: !!APP_KEY, hasToken: !!TOKEN });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!PAGE) return json(res, 404, { error: 'page_missing', message: 'Place deck-deal.html à côté de proxy.mjs.' });
      const html = await readFile(PAGE);
      res.writeHead(200, { ...SEC, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
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
  if (APP_KEY) console.log('Clé d\'accès requise (APP_KEY) — à saisir dans Réglages.');
  if (APP_KEY && APP_KEY.length < 12) console.warn('⚠ APP_KEY courte (' + APP_KEY.length + ' caractères) : prends 16 caractères ou plus.');
  if (!PAGE) console.log('⚠ deck-deal.html introuvable à côté du proxy.');
});
