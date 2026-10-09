// E2E service worker : cache des images Scryfall (hors ligne, sans re-téléchargement) et notification push « recherche terminée ».
// cards.scryfall.io est redirigé vers un faux serveur https local (les routes Playwright n'interceptent pas le service worker).
import './setup-env.mjs';
import http from 'node:http';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const ok = m => console.log('✓', m);

const DIR = (await import('node:os')).tmpdir() + '/sw-e2e-' + Date.now(); mkdirSync(DIR, { recursive: true });
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', DIR + '/k.pem', '-out', DIR + '/c.pem', '-days', '2', '-subj', '/CN=cards.scryfall.io'], { stdio: 'ignore' });
const SVG = n => `<svg xmlns="http://www.w3.org/2000/svg" width="146" height="204"><rect width="146" height="204" fill="#456"/><text x="10" y="100">${n}</text></svg>`;
const hits = {}; let imgUp = true;
const sockets = new Set();
const img = https.createServer({ key: readFileSync(DIR + '/k.pem'), cert: readFileSync(DIR + '/c.pem') }, (req, res) => {
  hits[req.url] = (hits[req.url] || 0) + 1;
  const host = String(req.headers.host || '').split(':')[0];
  if (host === 'cdn.jsdelivr.net' || host === 'www.gstatic.com') { res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }); return res.end('/* ' + req.url + ' */'); }
  if (host === 'fonts.googleapis.com') { res.writeHead(200, { 'content-type': 'text/css', 'access-control-allow-origin': '*' }); return res.end('/* v' + hits[req.url] + ' */'); }
  if (req.url === '/small/front/a/b/cors-no.jpg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(SVG('no cors')); }   // sans en-tête CORS
  if (/\/big-\d+\.jpg$/.test(req.url)) { const s = SVG(req.url); res.writeHead(200, { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' }); return res.end(s + '<!--' + 'x'.repeat(40000 - s.length - 7) + '-->'); }   // 40 000 octets pile
  res.writeHead(200, { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(SVG(req.url));
});
img.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
await new Promise(r => img.listen(18803, '127.0.0.1', r));

const up = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":1,"name":"t"}'); });
await new Promise(r => up.listen(0, '127.0.0.1', r));
const proxy = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: '18802', CARDTRADER_TOKEN: 'tok', CT_UPSTREAM: `http://127.0.0.1:${up.address().port}/api/v2` }, stdio: 'ignore' });
process.on('exit', () => { try { proxy.kill(); } catch {} });
await new Promise(r => setTimeout(r, 700));
const URL0 = 'http://127.0.0.1:18802/';

const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox', '--host-resolver-rules=MAP cards.scryfall.io 127.0.0.1:18803,MAP cdn.jsdelivr.net 127.0.0.1:18803,MAP fonts.googleapis.com 127.0.0.1:18803,MAP www.gstatic.com 127.0.0.1:18803', '--ignore-certificate-errors', '--no-proxy-server'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['notifications'] });
const p = await ctx.newPage(), errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p.route(/(fonts\.(googleapis|gstatic)|www\.gstatic)\.com/, r => r.abort());
await p.goto(URL0);
await p.evaluate(() => navigator.serviceWorker.ready);
await p.reload(); await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 });
ok('service worker actif et page contrôlée');

const base = 'https://cards.scryfall.io/small/front/a/b/';
const load = urls => p.evaluate(us => Promise.all(us.map(u => new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = u; }))), urls);
const U = ['sol-ring', 'wrath-of-god', 'llanowar-elves'].map(n => base + n + '.jpg');

/* ── Cache des images ────────────────────────────────────────────────────────────────────────── */
const r0 = await load(U);
assert.deepEqual(r0, [true, true, true]);
assert.deepEqual(U.map(u => hits[new URL(u).pathname]), [1, 1, 1], 'premier affichage : une requête réseau par image');
await p.waitForTimeout(300);
const cached = await p.evaluate(async () => { const ks = (await caches.keys()).filter(k => /-img$/.test(k)); const c = await caches.open(ks[0]); return { ks, n: (await c.keys()).length }; });
assert.equal(cached.ks.length, 1); assert.equal(cached.n, 3);
assert.deepEqual(await load(U), [true, true, true]);
assert.deepEqual(U.map(u => hits[new URL(u).pathname]), [1, 1, 1], 'deuxième affichage : servi par le cache, aucune requête');
ok('images Scryfall : mises en cache au premier affichage, ensuite servies sans réseau');

/* ── Bibliothèques versionnées et polices ────────────────────────────────────────────────────── */
{
  const get = u => p.evaluate(async u => { try { const r = await fetch(u); return r.ok ? await r.text() : 'HTTP ' + r.status; } catch (e) { return 'ERR'; } }, u);
  const JS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/x.js', FB = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js', NOVER = 'https://cdn.jsdelivr.net/npm/tesseract.js/dist/y.js', CSS = 'https://fonts.googleapis.com/css2?family=X';
  assert.match(await get(JS), /x\.js/); assert.match(await get(FB), /firebase-app/); assert.match(await get(NOVER), /y\.js/); assert.match(await get(CSS), /v1/);
  await p.waitForTimeout(300);
  assert.match(await get(JS), /x\.js/); assert.match(await get(FB), /firebase-app/); assert.match(await get(NOVER), /y\.js/);
  const h = u => hits[new URL(u).pathname + new URL(u).search];
  assert.equal(h(JS), 1, 'bibliothèque versionnée : servie par le cache'); assert.equal(h(FB), 1, 'SDK Firebase versionné : servi par le cache'); assert.equal(h(NOVER), 2, 'adresse sans version : jamais gardée');
  assert.match(await get(CSS), /v1/, 'feuille de style : la copie locale d\'abord'); await p.waitForTimeout(400); assert.equal(h(CSS), 2, 'puis rafraîchie en arrière-plan');
  assert.match(await get(CSS), /v2/, 'la version rafraîchie sert la fois suivante');
  ok('SDK Firebase, Tesseract et polices : cache d\'abord aux adresses versionnées, feuille de style rafraîchie en arrière-plan, adresses sans version jamais gardées');
}

/* ── Copie de la page : ouverte tout de suite, rafraîchie en arrière-plan, « Nouvelle version disponible » ──────────────────
   Relais devant le serveur (autre origine, donc son propre service worker) : délai, page réécrite (autre DD_BUILD), serveur coupé,
   sw.js modifié — sans toucher au dépôt. */
{
  const fw = { delay: 0, build: '', down: false, swTail: '', hits: 0 };
  const relay = http.createServer((q, r) => {
    const path = q.url.split('?')[0], pg = path === '/' || path === '/index.html', swjs = path === '/sw.js';
    if (pg && q.method === 'GET') fw.hits++;
    if (pg && fw.down) return q.socket.destroy();                       // serveur injoignable
    const h = { ...q.headers }; if (pg || swjs) { delete h['accept-encoding']; delete h['if-none-match']; }   // corps lisible, jamais de 304
    const go = () => {
      const u = http.request({ host: '127.0.0.1', port: 18802, path: q.url, method: q.method, headers: h }, x => {
        const edit = q.method === 'GET' && ((pg && fw.build) || (swjs && fw.swTail));
        if (!edit) { r.writeHead(x.statusCode, x.headers); return x.pipe(r); }
        const bufs = []; x.on('data', b => bufs.push(b)); x.on('end', () => {
          let body = Buffer.concat(bufs).toString('utf8');
          body = pg ? body.replace(/const DD_BUILD = '[\w-]+'/, `const DD_BUILD = '${fw.build}'`) : body + fw.swTail;
          const hd = { ...x.headers }; delete hd.etag; hd['content-length'] = Buffer.byteLength(body);
          r.writeHead(x.statusCode, hd); r.end(body);
        });
      });
      u.on('error', () => r.destroy()); q.pipe(u);
    };
    if (pg && fw.delay) setTimeout(go, fw.delay); else go();
  });
  await new Promise(r => relay.listen(18804, '127.0.0.1', r));
  const F = 'http://127.0.0.1:18804/';
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await c2.addInitScript(() => {                                         // relevé des toasts et des réponses du service worker
    window.__toasts = []; window.__sw = [];
    try { navigator.serviceWorker.addEventListener('message', e => window.__sw.push(e.data)); } catch (e) { /* ignore */ }
    document.addEventListener('DOMContentLoaded', () => { const t = document.querySelector('#toast'); if (t) new MutationObserver(() => { if (t.classList.contains('on')) window.__toasts.push(t.textContent); }).observe(t, { attributes: true, childList: true }); });
  });
  const q = await c2.newPage(), errs2 = [];
  q.on('pageerror', e => errs2.push('pageerror: ' + e.message));
  await q.route(/(fonts\.(googleapis|gstatic)|www\.gstatic)\.com/, r => r.abort());
  const build = () => q.evaluate(() => (typeof DD_BUILD === 'string' ? DD_BUILD : ''));
  const shell = () => q.evaluate(async () => { const k = (await caches.keys()).find(n => /-shell$/.test(n)), r = k && await (await caches.open(k)).match('./'); return r ? { build: r.headers.get('x-dd-build'), at: Number(r.headers.get('x-dd-at')), type: r.headers.get('content-type') } : null; });
  const dropShell = () => q.evaluate(async () => { const k = (await caches.keys()).find(n => /-shell$/.test(n)); await (await caches.open(k)).delete('./'); });
  const replied = () => q.waitForFunction(() => window.__sw.some(m => m && m.type === 'dd-shell'), null, { timeout: 15000 }).then(() => q.evaluate(() => window.__sw.find(m => m.type === 'dd-shell').build));
  const toldNew = () => q.evaluate(() => window.__toasts.some(t => /Nouvelle version/.test(t)));
  const waitShell = b => q.waitForFunction(async b => { const k = (await caches.keys()).find(n => /-shell$/.test(n)), r = k && await (await caches.open(k)).match('./'); return !!r && r.headers.get('x-dd-build') === b; }, b, { timeout: 8000, polling: 100 });

  await q.goto(F); await q.evaluate(() => navigator.serviceWorker.ready);
  await q.reload(); await q.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 });
  const B0 = await build(); let s = await shell();
  assert.ok(/^[0-9a-f]{8}$/.test(B0)); assert.equal(s.build, B0, 'version gardée avec la copie'); assert.ok(Date.now() - s.at < 60000); assert.match(s.type, /text\/html/);
  ok('copie de la page gardée avec sa version (DD_BUILD) et sa date');

  // ouverture normale, serveur très lent (6 s) : la copie tout de suite, la page quand même redemandée en arrière-plan, même version → pas de toast
  fw.delay = 6000; let h0 = fw.hits, t0 = Date.now();
  await q.reload({ waitUntil: 'domcontentloaded' }); let dt = Date.now() - t0;
  console.log('  ouverture avec serveur lent (6 s) :', dt, 'ms');
  assert.ok(dt < 2500, 'copie locale servie sans attendre le serveur : ' + dt + ' ms'); assert.equal(await build(), B0);
  assert.equal(await replied(), B0, 'le service worker répond après sa mise à jour'); assert.equal(fw.hits - h0, 1, 'page redemandée en arrière-plan');
  assert.equal(await toldNew(), false, 'même version : aucun toast'); fw.delay = 0;
  ok('ouverture normale : copie locale sans attendre le réseau, mise à jour en arrière-plan, pas de toast si rien n\'a changé');

  // nouvelle version sur le serveur : la copie s'ouvre, la nouvelle est gardée, toast « Nouvelle version disponible · Recharger », un toucher la lance
  fw.build = 'b1e2e000'; await q.reload();
  await q.waitForFunction(() => window.__toasts.some(t => /Nouvelle version disponible/.test(t)), null, { timeout: 15000 });
  assert.equal(await build(), B0, 'la page ouverte est la copie (version précédente)');
  assert.equal((await q.textContent('#toast .toast-act')).trim(), 'Recharger'); assert.equal((await shell()).build, 'b1e2e000', 'nouvelle version gardée');
  await q.screenshot({ path: 'shots/sw-nouvelle-version.png' });
  await Promise.all([q.waitForEvent('load'), q.click('#toast .toast-act')]);
  assert.equal(await build(), 'b1e2e000', '« Recharger » : la nouvelle version tourne');
  assert.equal(await replied(), 'b1e2e000'); assert.equal(await toldNew(), false, 'à jour : plus de toast');
  ok('nouvelle version : copie ouverte, nouvelle gardée en arrière-plan, toast « Nouvelle version disponible · Recharger », un toucher la lance');

  // pas de copie : la page vient du serveur (et elle est gardée) ; pas de copie et serveur coupé : message clair, pas de page blanche
  await dropShell(); fw.build = 'b2e2e000'; await q.reload();
  assert.equal(await build(), 'b2e2e000', 'pas de copie : page du serveur'); await waitShell('b2e2e000');
  assert.equal(await replied(), 'b2e2e000'); assert.equal(await toldNew(), false);
  await dropShell(); fw.down = true; await q.reload();
  assert.match(await q.textContent('body'), /hors ligne et n'a pas encore été ouvert/); fw.down = false;
  ok('pas de copie : réseau (page gardée ensuite) ; sans réseau non plus : message hors ligne');

  // copie de plus de 7 jours : réseau d'abord (jamais bloqué sur une vieille version), mais toujours là hors ligne ; 2 jours : servie d'emblée
  await q.goto(F); await waitShell('b2e2e000');
  const age = (b, days) => q.evaluate(async ([b, days]) => {
    const k = (await caches.keys()).find(n => /-shell$/.test(n)), c = await caches.open(k), html = await (await c.match('./')).text();
    await c.put('./', new Response(html.replace(/const DD_BUILD = '[\w-]+'/, `const DD_BUILD = '${b}'`), { headers: { 'content-type': 'text/html; charset=utf-8', 'x-dd-build': b, 'x-dd-at': String(Date.now() - days * 864e5) } }));
  }, [b, days]);
  fw.build = 'b3e2e000'; await age('vieille00', 8); await q.reload();
  assert.equal(await build(), 'b3e2e000', 'copie trop vieille : version du serveur');
  await waitShell('b3e2e000'); await age('vieille00', 8); fw.down = true; await q.reload();
  assert.equal(await build(), 'vieille00', 'hors ligne : la vieille copie ouvre quand même l\'app'); fw.down = false;
  await age('recente0', 2); await q.reload();
  assert.equal(await build(), 'recente0', 'copie de 2 jours : servie d\'emblée'); await waitShell('b3e2e000');
  ok('copie de plus de 7 jours : réseau d\'abord (copie gardée pour le hors ligne) ; plus récente : servie d\'emblée');

  // adresses spéciales : comportement d'avant (réseau d'abord) ; un lien de partage attend le serveur au-delà de 4 s
  fw.build = 'b4e2e000';
  for (const qs of ['?delete-account', '?p=e2e-inconnu', '?resume=1']) { await q.goto(F + qs); assert.equal(await build(), 'b4e2e000', qs + ' : version du serveur, pas la copie'); }
  fw.build = 'b5e2e000'; fw.delay = 5000; t0 = Date.now();
  await q.goto(F + '?p=e2e-lent', { waitUntil: 'domcontentloaded' }); dt = Date.now() - t0; fw.delay = 0;
  assert.ok(dt > 4500, 'lien de partage : le serveur est attendu (' + dt + ' ms)'); assert.equal(await build(), 'b5e2e000');
  ok('?delete-account, ?p= (partage), ?resume : réseau d\'abord comme avant ; le partage attend le serveur lent');

  // /privacy n'est jamais la copie de l'app
  await q.goto(F + 'privacy'); assert.match(await q.textContent('body'), /Politique de confidentialité/); assert.equal(await build(), '');
  ok('/privacy : jamais servie par la copie de l\'app');

  // images : budget en octets (ici 100 000 au lieu de 60 Mo) → les plus anciennes partent, jusqu'à 85 %
  await q.goto(F); await q.waitForFunction(() => !!navigator.serviceWorker.controller);
  const w2 = c2.serviceWorkers().find(w => w.url().startsWith(F)); assert.ok(w2, 'worker du relais joignable');
  assert.equal(await w2.evaluate(() => IMG_LIM.bytes), 60 * 1024 * 1024, 'budget réel : 60 Mo');
  await w2.evaluate(() => { IMG_LIM.bytes = 100000; });
  const imgs = () => q.evaluate(async () => { const k = (await caches.keys()).find(k => /-img$/.test(k)); if (!k) return { out: [], total: 0 }; const c = await caches.open(k); const out = []; let total = 0; for (const k of await c.keys()) { const n = k.url.split('/').pop(); if (/^big-/.test(n)) out.push(n); total += (await (await c.match(k)).blob()).size; } return { out, total }; });
  for (const n of [1, 2, 3, 4, 5]) {
    const u = 'https://cards.scryfall.io/large/front/a/b/big-' + n + '.jpg';
    assert.equal(await q.evaluate(u => new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = u; }), u), true);
    await q.waitForFunction(n => caches.keys().then(ks => caches.open(ks.find(k => /-img$/.test(k)))).then(c => c.match('https://cards.scryfall.io/large/front/a/b/big-' + n + '.jpg')).then(Boolean), n, { polling: 50, timeout: 5000 });
    await q.waitForTimeout(150);
  }
  const kept = await imgs(); console.log('  images gardées :', kept.out.join(', '), '·', kept.total, 'octets');
  assert.deepEqual(kept.out, ['big-4.jpg', 'big-5.jpg'], 'les plus anciennes sont parties'); assert.ok(kept.total <= 100000);
  ok('images : plafond en octets, les plus anciennes partent d\'abord (descend à 85 % du budget)');

  // nouvelle version du service worker : prend la main tout de suite (skipWaiting + claim), images et copie de la page conservées
  await q.evaluate(() => { window.__cc = 0; navigator.serviceWorker.addEventListener('controllerchange', () => window.__cc++); });
  fw.swTail = '\n// e2e : nouvelle version du service worker\n'; const nextW = c2.waitForEvent('serviceworker');
  await q.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await q.waitForFunction(() => window.__cc > 0, null, { timeout: 10000 }); const w3 = await nextW;
  assert.deepEqual((await imgs()).out, ['big-4.jpg', 'big-5.jpg'], 'images conservées'); assert.equal((await shell()).build, 'b5e2e000', 'copie de la page conservée (rafraîchie à l\'installation)');
  fw.delay = 6000; t0 = Date.now(); await q.reload({ waitUntil: 'domcontentloaded' }); dt = Date.now() - t0; fw.delay = 0;
  assert.ok(dt < 2500, 'le nouveau service worker sert la copie d\'emblée : ' + dt + ' ms'); assert.equal(await build(), 'b5e2e000');
  ok('nouveau service worker : prend la main aussitôt, images et copie de la page conservées');

  // stockage plein (écriture de la copie refusée) : les images cèdent la place ; toujours refusée → l'ancienne copie est retirée
  await w3.evaluate(() => { const put = Cache.prototype.put; self.__putFail = 1; Cache.prototype.put = function (k, r) { if (self.__putFail > 0 && String(k.url || k) === ROOT) { self.__putFail--; return Promise.reject(new DOMException('plein', 'QuotaExceededError')); } return put.call(this, k, r); }; });
  await q.waitForTimeout(6500); fw.build = 'b6e2e000'; await q.reload();       // attente : la mise à jour du rechargement lent (6 s) ne doit pas consommer le refus
  assert.equal(await replied(), 'b6e2e000', 'refus une fois : nouvelle copie gardée après avoir retiré les images'); assert.deepEqual((await imgs()).out, [], 'images retirées');
  await w3.evaluate(() => { self.__putFail = 2; }); fw.build = 'b7e2e000'; await q.reload();
  assert.equal(await build(), 'b6e2e000'); assert.equal(await replied(), '', 'refus répété : plus de copie, pas de toast'); assert.equal(await shell(), null);
  await q.reload(); assert.equal(await build(), 'b7e2e000', 'ouverture suivante : la version du serveur'); await waitShell('b7e2e000');
  ok('stockage plein : les images cèdent la place à la page ; sinon la vieille copie est retirée (ouverture suivante par le réseau)');

  assert.deepEqual(errs2, []);
  await c2.close(); relay.close();
}

// hors ligne : le serveur d'images disparaît, les images déjà vues s'affichent encore
await new Promise(r => { img.close(r); for (const s of sockets) s.destroy(); });
await p.reload();
assert.deepEqual(await load(U), [true, true, true], 'images vues = disponibles sans réseau');
assert.deepEqual(await load([base + 'jamais-vue.jpg']), [false], 'image jamais vue : échec propre, sans exception');
ok('hors ligne : images déjà vues toujours affichées, inconnue = échec propre');
assert.equal(await p.evaluate(async () => (await (await caches.open((await caches.keys()).find(k => /-img$/.test(k)))).keys()).length), 3, 'rien de cassé n\'est mis en cache');

// jamais intercepté : l'API Scryfall et le reste (pas de cache hors images de cartes)
const keys = await p.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url); return out; });
assert.ok(keys.every(u => !/api\.scryfall\.com|\/api\/|__ping|identitytoolkit|securetoken|firestore\.googleapis/.test(u)), 'aucune donnée vivante en cache: ' + keys.filter(u => /api\.|\/api\/|ping|token|firestore/.test(u)).join(','));
ok('aucune requête API / donnée vivante mise en cache');

/* ── Push ────────────────────────────────────────────────────────────────────────────────────── */
const cdp = await ctx.newCDPSession(p); let regId = null;
cdp.on('ServiceWorker.workerRegistrationUpdated', e => { const r = (e.registrations || []).find(x => x.scopeURL.startsWith(URL0)); if (r) regId = r.registrationId; });
await cdp.send('ServiceWorker.enable'); await p.waitForTimeout(500);
assert.ok(regId, 'enregistrement SW trouvé');
await p.evaluate(() => { window.__msgs = []; navigator.serviceWorker.addEventListener('message', e => window.__msgs.push(e.data)); });
const push = data => cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(URL0).origin, registrationId: regId, data: JSON.stringify(data) });
const notifs = () => p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag, url: n.data && n.data.url })));
const waitNotif = async pred => { for (let i = 0; i < 40; i++) { const n = await notifs(); if (pred(n)) return n; await p.waitForTimeout(150); } return notifs(); };

await push({ title: 'Recherche terminée', body: 'Les offres de « Atraxa » sont prêtes.', url: './?resume=1' });
let n = await waitNotif(a => a.length === 1);
assert.deepEqual(n, [{ title: 'Recherche terminée', body: 'Les offres de « Atraxa » sont prêtes.', tag: 'deckdeal-run', url: './?resume=1' }]);
ok('push : notification affichée avec titre, texte et lien de reprise');

await push({ title: 'x'.repeat(300), body: 'b'.repeat(500), url: 'https://evil.example/phish' });
n = await waitNotif(a => a.length === 1 && a[0].title.length === 80);
assert.equal(n.length, 1, 'même tag : remplace la précédente'); assert.equal(n[0].title.length, 80); assert.equal(n[0].body.length, 200); assert.equal(n[0].url, './?resume=1', 'lien externe refusé');
for (const [i, url] of ['//evil.example/phish', '/\\evil.example', '/\t/evil.example', 'javascript:alert(1)'].entries()) {      // relatifs au protocole et variantes : un autre site
  await push({ title: 'lien ' + i, url }); n = await waitNotif(a => a.length === 1 && a[0].title === 'lien ' + i); assert.equal(n[0].url, './?resume=1', 'lien refusé : ' + JSON.stringify(url));
}
await push({ title: 'même site', url: new URL('?resume=1', URL0).href }); n = await waitNotif(a => a.length === 1 && a[0].title === 'même site'); assert.equal(n[0].url, new URL('?resume=1', URL0).href, 'adresse de l\'app elle-même : gardée');
await push(null); await p.waitForTimeout(0);
ok('push : textes bornés, un seul avis à la fois, lien externe refusé');

// toucher la notification : ferme l'avis, rouvre/focus l'app et lui demande de reprendre la recherche
const sw = ctx.serviceWorkers().find(w => w.url().startsWith(URL0)); assert.ok(sw, 'worker joignable');
await sw.evaluate(async () => { const [x] = await self.registration.getNotifications(); self.dispatchEvent(new NotificationEvent('notificationclick', { notification: x, action: '' })); });
await p.waitForFunction(() => window.__msgs.some(m => m && m.type === 'resume'), null, { timeout: 5000 });
assert.deepEqual(await notifs(), [], 'avis fermé au toucher');
ok('toucher la notification : avis fermé, app prévenue (reprise de la recherche)');

// alerte de prix : avis à part (autre tag), lien propre, toucher → l'app ouvre la feuille des alertes
await push({ title: 'Sol Ring : −40 %', body: '3,00 € → 1,80 € (tendance Cardmarket).', url: './?alerts=1', kind: 'alert' });
n = await waitNotif(a => a.length === 1);
assert.deepEqual(n, [{ title: 'Sol Ring : −40 %', body: '3,00 € → 1,80 € (tendance Cardmarket).', tag: 'deckdeal-alert', url: './?alerts=1' }]);
await push({ title: 'Recherche terminée', body: 'Les offres sont prêtes.', url: './?resume=1' });
n = await waitNotif(a => a.length === 2); assert.deepEqual(n.map(x => x.tag).sort(), ['deckdeal-alert', 'deckdeal-run'], 'alerte et fin de recherche ne s\'écrasent pas');
await push({ kind: 'alert' }); n = await waitNotif(a => a.some(x => x.title === 'Baisse de prix')); assert.ok(n.some(x => x.title === 'Baisse de prix' && x.url === './?alerts=1'), 'titre et lien par défaut d\'une alerte');
await p.evaluate(() => { window.__msgs.length = 0; });
await sw.evaluate(async () => { const x = (await self.registration.getNotifications()).find(n => n.tag === 'deckdeal-alert'); self.dispatchEvent(new NotificationEvent('notificationclick', { notification: x, action: '' })); });
await p.waitForFunction(() => window.__msgs.some(m => m && m.type === 'alerts'), null, { timeout: 5000 });
assert.ok(!(await p.evaluate(() => window.__msgs)).some(m => m && m.type === 'resume'), 'une alerte ne relance pas la recherche');
ok('alerte de prix : avis distinct, toucher → l\'app ouvre les alertes (pas de reprise de recherche)');

assert.deepEqual(errs, []);
await browser.close(); proxy.kill(); up.close(); console.log('\nSW E2E OK'); process.exit(0);
