/* Deck Deal — service worker.
   • Page (navigation) : réseau d'abord, copie locale si le réseau échoue ou traîne → l'app s'ouvre hors ligne.
   • Icônes et manifeste : cache d'abord, rafraîchis en arrière-plan.
   • Images de cartes Scryfall (cards.scryfall.io) : cache d'abord → une carte déjà vue ne se retélécharge plus.
     Le cache vit dans le stockage du navigateur : il saute si tu effaces les données du site, puis se reremplit tout seul.
   • Notifications push « recherche terminée » : affichées ici, un toucher rouvre l'app et reprend la recherche.
   • Jamais interceptés : /api/*, /__ping, tout autre domaine (CardTrader, Firebase, polices, API Scryfall),
     toute requête qui n'est pas un GET. Aucune donnée de recherche, token ou clé n'est mise en cache ici. */
const V = 'deckdeal-v1';
const SHELL = V + '-shell', STATIC = V + '-static', IMG = V + '-img';
const IMG_HOST = 'cards.scryfall.io', IMG_MAX = 1200;
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
    for (const k of await caches.keys()) if (k.startsWith('deckdeal-') && k !== SHELL && k !== STATIC && k !== IMG) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function page(e) {
  const cache = await caches.open(SHELL), cached = await cache.match(ROOT);
  const net = fetch(e.request).then(async r => { if (r.ok && r.type === 'basic') await cache.put(ROOT, r.clone()); return r; });
  e.waitUntil(net.catch(() => {}));                          // laisse la mise à jour finir même si on a servi la copie
  const wait = new Promise((_, no) => setTimeout(no, cached ? 4000 : 25000));
  try { const r = await Promise.race([net, wait]); if (r.ok || !cached) return r; } catch (_) { /* réseau absent ou trop lent */ }
  return cached || new Response('Deck Deal est hors ligne et n\'a pas encore été ouvert avec du réseau.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
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

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) {
    if (u.protocol === 'https:' && u.hostname === IMG_HOST && (req.destination === 'image' || /\.(jpe?g|png|webp)$/i.test(u.pathname))) e.respondWith(cardImage(e));
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
  const title = String(d.title || 'Recherche terminée').slice(0, 80);
  e.waitUntil(self.registration.showNotification(title, {
    body: String(d.body || 'Les offres sont prêtes.').slice(0, 200),
    icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: 'deckdeal-run', renotify: true,
    data: { url: typeof d.url === 'string' && !/^[a-z]+:/i.test(d.url) ? d.url : './?resume=1' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './?resume=1', ROOT).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = all.find(c => c.url.startsWith(ROOT));
    if (mine) { try { await mine.focus(); } catch (_) { /* ignore */ } mine.postMessage({ type: 'resume' }); return; }
    await self.clients.openWindow(url);
  })());
});
