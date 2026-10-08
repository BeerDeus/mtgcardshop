/* Mana Orbit — service worker.
   • Page (navigation) : réseau d'abord, copie locale si le réseau échoue ou traîne → l'app s'ouvre hors ligne.
   • Icônes et manifeste : cache d'abord, rafraîchis en arrière-plan.
   • Images de cartes Scryfall (cards.scryfall.io) : cache d'abord → une carte déjà vue ne se retélécharge plus.
   • Bibliothèques et polices aux adresses versionnées (SDK Firebase, Tesseract, fichiers de polices) : cache d'abord (elles ne changent jamais) ;
     feuille de style Google Fonts : copie locale tout de suite, rafraîchie en arrière-plan. → polices et scan disponibles hors ligne, démarrage plus rapide.
     Le cache vit dans le stockage du navigateur : il saute si tu effaces les données du site, puis se reremplit tout seul.
   • Notifications push « recherche terminée » (un toucher rouvre l'app et reprend la recherche) et alertes de prix (rouvre la feuille des alertes).
   • Jamais interceptés : /api/*, /__ping, tout autre domaine (CardTrader, Firebase, polices, API Scryfall),
     toute requête qui n'est pas un GET. Aucune donnée de recherche, token ou clé n'est mise en cache ici (jamais l'API Firestore ni l'authentification). */
const V = 'deckdeal-v1';
const SHELL = V + '-shell', STATIC = V + '-static', IMG = V + '-img', CDN = V + '-cdn';
const IMG_HOST = 'cards.scryfall.io', IMG_MAX = 1200, CDN_MAX = 80;
/** Ressources tierces immuables (adresse versionnée) ou presque (CSS Google Fonts) : 'imm' | 'swr' | null. */
function cdnKind(u) {
  if (u.protocol !== 'https:') return null;
  if (u.hostname === 'fonts.gstatic.com') return 'imm';
  if (u.hostname === 'fonts.googleapis.com' && u.pathname.startsWith('/css')) return 'swr';
  if (u.hostname === 'www.gstatic.com' && /^\/firebasejs\/\d+\.\d+\.\d+\//.test(u.pathname)) return 'imm';
  if (u.hostname === 'cdn.jsdelivr.net' && /^\/npm\/(@[\w.-]+\/)?[\w.-]+@\d[\w.-]*\//.test(u.pathname)) return 'imm';
  return null;
}
const BASE = new URL('./', self.location).pathname;       // portée (« / » en production)
const ROOT = new URL('./', self.location).href;
const ASSETS = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon.svg'];
const rel = u => (u.pathname.startsWith(BASE) ? u.pathname.slice(BASE.length) : null);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const st = await caches.open(STATIC), sh = await caches.open(SHELL);
    await Promise.all(ASSETS.map(a => st.add(new Request(a, { cache: 'reload' })).catch(() => {})));
    try { const r = await fetch(new Request(ROOT, { cache: 'reload' })); if (r.ok) await sh.put(ROOT, r); } catch (_) { /* pas grave : mis en cache à la première visite */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('deckdeal-') && k !== SHELL && k !== STATIC && k !== IMG && k !== CDN) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function page(e) {
  const cache = await caches.open(SHELL), cached = await cache.match(ROOT);
  const net = fetch(e.request).then(async r => { if (r.ok && r.type === 'basic') await cache.put(ROOT, r.clone()); return r; });
  e.waitUntil(net.catch(() => {}));                          // laisse la mise à jour finir même si on a servi la copie
  const share = /[?&]p=/.test(new URL(e.request.url).search);      // lien de partage : il faut la version à jour (une ancienne copie ne sait pas l'ouvrir)
  const wait = new Promise((_, no) => setTimeout(no, cached && !share ? 4000 : 25000));
  try { const r = await Promise.race([net, wait]); if (r.ok || !cached) return r; } catch (_) { /* réseau absent ou trop lent */ }
  return cached || new Response('Mana Orbit est hors ligne et n\'a pas encore été ouvert avec du réseau.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function asset(e, key) {
  const cache = await caches.open(STATIC), hit = await cache.match(key);
  const net = fetch(e.request).then(async r => { if (r.ok) await cache.put(key, r.clone()); return r; });
  e.waitUntil(net.catch(() => {}));
  return hit || net;
}

/** Image de carte : copie locale d'abord ; sinon réseau en CORS (réponse lisible, taille réelle) puis mise en cache. */
let trimming = false;
async function trimImages(cache) {
  if (trimming) return; trimming = true;
  try { const ks = await cache.keys(); for (const k of ks.slice(0, Math.max(0, ks.length - IMG_MAX))) await cache.delete(k); } catch (_) { /* ignore */ } finally { trimming = false; }
}
async function cardImage(e) {
  const req = e.request, cache = await caches.open(IMG), hit = await cache.match(req.url);
  if (hit) return hit;
  let r;
  try { r = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); }
  catch (_) { return fetch(req); }                           // CORS refusé ou réseau : on laisse faire le navigateur, sans cache
  if (r.ok && r.status === 200) { e.waitUntil(cache.put(req.url, r.clone()).then(() => trimImages(cache)).catch(() => {})); }
  return r;
}

/** Ressource tierce : réponse lisible (CORS) gardée ; opaque ou en erreur : servie sans être gardée. */
let cdnTrimming = false;
async function cdnTrim(cache) {
  if (cdnTrimming) return; cdnTrimming = true;
  try { const ks = await cache.keys(); for (const k of ks.slice(0, Math.max(0, ks.length - CDN_MAX))) await cache.delete(k); } catch (_) { /* ignore */ } finally { cdnTrimming = false; }
}
async function cdnFetch(e, cache) {
  let r;
  try { r = await fetch(e.request.url, { mode: 'cors', credentials: 'omit' }); } catch (_) { return fetch(e.request); }
  if (r.ok && r.status === 200 && r.type === 'cors') e.waitUntil(cache.put(e.request.url, r.clone()).then(() => cdnTrim(cache)).catch(() => {}));
  return r;
}
async function cdnAsset(e, kind) {
  const cache = await caches.open(CDN), hit = await cache.match(e.request.url);
  if (hit && kind === 'imm') return hit;
  if (hit) { e.waitUntil(cdnFetch(e, cache).catch(() => {})); return hit; }          // feuille de style : tout de suite, rafraîchie pour la prochaine fois
  return cdnFetch(e, cache);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) {
    if (u.protocol === 'https:' && u.hostname === IMG_HOST && (req.destination === 'image' || /\.(jpe?g|png|webp)$/i.test(u.pathname))) e.respondWith(cardImage(e));
    else { const k = cdnKind(u); if (k) e.respondWith(cdnAsset(e, k)); }
    return;
  }
  const r = rel(u); if (r === null) return;
  if (r.startsWith('api/') || r === '__ping') return;        // jamais : données vivantes et clés
  if (req.mode === 'navigate') { if (r === '' || r === 'index.html') e.respondWith(page(e)); return; }
  if (ASSETS.includes(r)) e.respondWith(asset(e, r));
});

/* ── Push « recherche terminée » ──────────────────────────────────────────────────────────────── */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { try { d = { body: e.data.text() }; } catch (__) { d = {}; } }
  const alert = d.kind === 'alert';
  const title = String(d.title || (alert ? 'Baisse de prix' : 'Recherche terminée')).slice(0, 80);
  e.waitUntil(self.registration.showNotification(title, {
    body: String(d.body || (alert ? 'Une carte surveillée a baissé.' : 'Les offres sont prêtes.')).slice(0, 200),
    icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: alert ? 'deckdeal-alert' : 'deckdeal-run', renotify: true,
    data: { kind: alert ? 'alert' : 'run', url: typeof d.url === 'string' && !/^[a-z]+:/i.test(d.url) ? d.url : (alert ? './?alerts=1' : './?resume=1') },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const nd = e.notification.data || {}, url = new URL(nd.url || './?resume=1', ROOT).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = all.find(c => c.url.startsWith(ROOT));
    if (mine) { try { await mine.focus(); } catch (_) { /* ignore */ } mine.postMessage({ type: nd.kind === 'alert' ? 'alerts' : 'resume' }); return; }
    await self.clients.openWindow(url);
  })());
});
