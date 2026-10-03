/* Deck Deal — service worker.
   • Page (navigation) : réseau d'abord, copie locale si le réseau échoue ou traîne → l'app s'ouvre hors ligne.
   • Icônes et manifeste : cache d'abord, rafraîchis en arrière-plan.
   • Jamais interceptés : /api/*, /__ping, tout ce qui vient d'un autre domaine (CardTrader, Scryfall, Firebase, polices),
     toute requête qui n'est pas un GET. Aucune donnée de recherche, token ou clé n'est mise en cache ici. */
const V = 'deckdeal-v1';
const SHELL = V + '-shell', STATIC = V + '-static';
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
    for (const k of await caches.keys()) if (k.startsWith('deckdeal-') && k !== SHELL && k !== STATIC) await caches.delete(k);
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

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  const r = rel(u); if (r === null) return;
  if (r.startsWith('api/') || r === '__ping') return;        // jamais : données vivantes et clés
  if (req.mode === 'navigate') { if (r === '' || r === 'index.html') e.respondWith(page(e)); return; }
  if (ASSETS.includes(r)) e.respondWith(asset(e, r));
});
