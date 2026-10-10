/* Mana Orbit — service worker.
   • Page (navigation) : ouverture normale (adresse sans paramètre, ou ?open= des raccourcis de l'icône) → copie locale tout de suite, rafraîchie en arrière-plan ;
     si la version gardée diffère de celle qui tourne (DD_BUILD), la page l'apprend (message « dd-shell ») et propose « Recharger ».
     Réseau d'abord (copie locale si le réseau échoue ou traîne → l'app s'ouvre hors ligne) : adresse avec paramètres (partage ?p=,
     ?delete-account, notifications…), pas de copie, ou copie de plus de 7 jours (jamais bloqué sur une vieille version).
     Seule une vraie page de l'app (DD_BUILD présent) est gardée. /privacy et /api ne passent jamais par cette copie.
   • Icônes et manifeste : cache d'abord, rafraîchis en arrière-plan.
   • Images de cartes Scryfall (cards.scryfall.io) : cache d'abord → une carte déjà vue ne se retélécharge plus ; 60 Mo au plus (les plus anciennes partent).
   • Bibliothèques et polices aux adresses versionnées (SDK Firebase, Tesseract, fichiers de polices) : cache d'abord (elles ne changent jamais) ;
     feuille de style Google Fonts : copie locale tout de suite, rafraîchie en arrière-plan. → polices et scan disponibles hors ligne, démarrage plus rapide.
     Le cache vit dans le stockage du navigateur : il saute si tu effaces les données du site, puis se reremplit tout seul.
   • Notifications push « recherche terminée » (un toucher rouvre l'app et reprend la recherche) et alertes de prix (rouvre la feuille des alertes).
   • Jamais interceptés : /api/*, /__ping, tout autre domaine (CardTrader, Firebase, polices, API Scryfall),
     toute requête qui n'est pas un GET. Aucune donnée de recherche, token ou clé n'est mise en cache ici (jamais l'API Firestore ni l'authentification). */
const V = 'deckdeal-v1';
const SHELL = V + '-shell', STATIC = V + '-static', IMG = V + '-img', CDN = V + '-cdn';
const IMG_HOST = 'cards.scryfall.io', CDN_MAX = 80;
/** Images gardées : budget en octets (petites, normales, grandes et art_crop mélangées) ; le nombre borne aussi le coût de la mesure (≈ 0,1 s pour 1 200). */
const IMG_LIM = { bytes: 60 * 1024 * 1024, max: 3000 };
/** Copie de la page servie d'emblée tant qu'elle a moins de 7 jours (chaque ouverture réussie la rafraîchit) ; au-delà, réseau d'abord. */
const SHELL_TTL = 7 * 864e5, BUILD_RE = /const DD_BUILD = '([\w-]+)'/;
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
    try { await keepShell(sh, await fetch(new Request(ROOT, { cache: 'reload' }))); } catch (_) { /* pas grave : mis en cache à la première visite */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('deckdeal-') && k !== SHELL && k !== STATIC && k !== IMG && k !== CDN) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** Garde la réponse réseau de la page si c'est bien l'app (DD_BUILD présent : jamais une page d'erreur d'hébergeur ou de portail wifi),
 *  avec sa version (x-dd-build) et sa date (x-dd-at). Stockage plein : les images cèdent la place ; sinon l'ancienne copie est retirée
 *  (la prochaine ouverture passe par le réseau au lieu de rester sur une vieille version). Consomme r ; échoue seulement si le corps n'arrive pas. */
async function keepShell(cache, r) {
  if (!r || r.status !== 200 || r.type !== 'basic' || r.redirected) return;
  const html = await r.text(), m = BUILD_RE.exec(html);
  if (!m) return;
  const h = new Headers(r.headers); for (const k of ['content-encoding', 'content-length', 'vary']) h.delete(k);      // corps déjà décodé
  h.set('x-dd-build', m[1]); h.set('x-dd-at', String(Date.now()));
  const put = () => cache.put(ROOT, new Response(html, { status: 200, headers: h }));
  try { await put(); } catch (_) {
    try { await dropImages(); await put(); } catch (__) { await cache.delete(ROOT).catch(() => {}); }
  }
}
let shellCheck = Promise.resolve();                          // mise à jour en cours de la copie (attendue avant de répondre « dd-shell? »)
async function page(e) {
  const cache = await caches.open(SHELL), cached = await cache.match(ROOT);
  const net = fetch(e.request).then(async r => { await keepShell(cache, r.clone()); return r; });     // résolue une fois la page reçue en entier (et gardée)
  shellCheck = net.catch(() => {});
  e.waitUntil(shellCheck);                                   // la mise à jour finit même si on a servi la copie
  const u = new URL(e.request.url), age = cached ? Date.now() - Number(cached.headers.get('x-dd-at')) : NaN;
  const plain = !u.search || /^\?open=[a-z]+$/.test(u.search);    // ouverture normale, ou raccourci de l'icône de la PWA (?open=scan…)
  if (plain && age >= 0 && age < SHELL_TTL) return cached;   // copie locale tout de suite (rien à attendre du réseau)
  const share = /[?&]p=/.test(u.search);                     // lien de partage : il faut la version à jour (une ancienne copie ne sait pas l'ouvrir)
  const wait = new Promise((_, no) => setTimeout(no, cached && !share ? 4000 : 25000));
  try { const r = await Promise.race([net, wait]); if (r.ok || !cached) return r; } catch (_) { /* réseau absent ou trop lent */ }
  return cached || new Response('Mana Orbit est hors ligne et n\'a pas encore été ouvert avec du réseau.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
/** La page demande quelle version est gardée (après la mise à jour en cours, 30 s au plus) : différente de la sienne → mise à jour (pwa.js).
 *  « dd-update » : le serveur annonce une version plus récente (/__ping) → la copie est relue tout de suite sur le réseau (cache HTTP contourné),
 *  puis la réponse « dd-updated » (version gardée) part sur le port donné : la page peut alors se recharger sur la nouvelle version. */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'dd-update' && e.ports && e.ports[0]) {
    const port = e.ports[0];
    e.waitUntil((async () => {
      const cache = await caches.open(SHELL);
      try { const p = fetch(new Request(ROOT, { cache: 'reload' })).then(r => keepShell(cache, r)); shellCheck = p.catch(() => {}); await p; } catch (_) { /* hors ligne : la copie reste */ }
      const c = await cache.match(ROOT);
      port.postMessage({ type: 'dd-updated', build: (c && c.headers.get('x-dd-build')) || '' });
    })().catch(() => {}));
    return;
  }
  if (!e.data || e.data.type !== 'dd-shell?' || !e.source) return;
  e.waitUntil((async () => {
    await Promise.race([shellCheck, new Promise(r => setTimeout(r, 30000))]);
    const c = await (await caches.open(SHELL)).match(ROOT);
    e.source.postMessage({ type: 'dd-shell', build: (c && c.headers.get('x-dd-build')) || '' });
  })().catch(() => {}));
});

async function asset(e, key) {
  const cache = await caches.open(STATIC), hit = await cache.match(key);
  const net = fetch(e.request).then(async r => { if (r.ok) await cache.put(key, r.clone()); return r; });
  e.waitUntil(net.catch(() => {}));
  return hit || net;
}

/** Image de carte : copie locale d'abord ; sinon réseau en CORS (réponse lisible, taille réelle) puis mise en cache.
 *  Budget : octets par adresse, mesurés une fois par démarrage du worker puis tenus à jour ; une file sérialise mesures et purges. */
let imgSizes = null, imgQ = Promise.resolve();
const sizeOf = async r => (r ? Number(r.headers.get('content-length')) || (await r.blob()).size : 0);
function imgKept(cache, url) { return (imgQ = imgQ.then(() => imgFit(cache, url)).catch(() => { imgSizes = null; })); }
function dropImages() { return (imgQ = imgQ.then(() => caches.delete(IMG)).catch(() => {}).then(() => { imgSizes = null; })); }
async function imgFit(cache, url) {
  if (!imgSizes) {                                           // keys() et matchAll() suivent le même ordre ; sinon, lecture une à une
    const ks = await cache.keys(), rs = await cache.matchAll(), m = new Map();
    for (let i = 0; i < ks.length; i++) m.set(ks[i].url, await sizeOf(rs[i] && rs[i].url === ks[i].url ? rs[i] : await cache.match(ks[i])));
    imgSizes = m;
  }
  if (!imgSizes.has(url)) imgSizes.set(url, await sizeOf(await cache.match(url)));
  let total = 0; for (const n of imgSizes.values()) total += n;
  if (total <= IMG_LIM.bytes && imgSizes.size <= IMG_LIM.max) return;
  for (const k of await cache.keys()) {                      // ordre d'arrivée : les plus anciennes d'abord, jusqu'à 85 % (pas une purge par image)
    if (total <= IMG_LIM.bytes * 0.85 && imgSizes.size <= IMG_LIM.max * 0.85) break;
    await cache.delete(k); total -= imgSizes.get(k.url) || 0; imgSizes.delete(k.url);
  }
}
async function cardImage(e) {
  const req = e.request, cache = await caches.open(IMG), hit = await cache.match(req.url);
  if (hit) return hit;
  let r;
  try { r = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); }
  catch (_) { return fetch(req); }                           // CORS refusé ou réseau : on laisse faire le navigateur, sans cache
  if (r.ok && r.status === 200) { e.waitUntil(cache.put(req.url, r.clone()).then(() => imgKept(cache, req.url)).catch(() => {})); }
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
  if (req.mode === 'navigate') { if (r === '' || r === 'index.html') e.respondWith(page(e)); return; }     // /privacy et le reste : jamais la copie de l'app
  if (ASSETS.includes(r)) e.respondWith(asset(e, r));
});

/* ── Push « recherche terminée » ──────────────────────────────────────────────────────────────── */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { try { d = { body: e.data.text() }; } catch (__) { d = {}; } }
  if (!d || typeof d !== 'object') d = {};      // « null », nombre, texte JSON : avis par défaut (d.kind lèverait une erreur et rien ne serait affiché)
  const alert = d.kind === 'alert';
  const title = String(d.title || (alert ? 'Baisse de prix' : 'Recherche terminée')).slice(0, 80);
  e.waitUntil(self.registration.showNotification(title, {
    body: String(d.body || (alert ? 'Une carte surveillée a baissé.' : 'Les offres sont prêtes.')).slice(0, 200),
    icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: alert ? 'deckdeal-alert' : 'deckdeal-run', renotify: true,
    data: { kind: alert ? 'alert' : 'run', url: sameOrigin(d.url) ? d.url : (alert ? './?alerts=1' : './?resume=1') },
  }));
});
/** Lien d'une notification : seulement vers l'app elle-même (« ./… », « /… » ou sa propre adresse). Résolu comme le ferait le navigateur, donc « //autre-site » et ses variantes (« /\… », tabulations) sont refusés. */
function sameOrigin(u) { try { return typeof u === 'string' && new URL(u, ROOT).origin === self.location.origin; } catch (_) { return false; } }
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
