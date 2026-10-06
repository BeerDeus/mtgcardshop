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
