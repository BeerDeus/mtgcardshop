// E2E notifications dans l'appli Android (Capacitor simulé : plugin PushNotifications) : activation → jeton FCM, cible { fcm } envoyée avec
// la recherche et pour les alertes, jeton renouvelé au lancement (alertes réinscrites), notification touchée (appli ouverte ou lancée par le
// toucher) → bonne feuille, notification reçue au premier plan → toast, états des Réglages propres à l'appli. Vrai proxy + faux OAuth2 / FCM.
import './setup-env.mjs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { chromium, startWorld, newPage, txt, ok, toInput } from './e2e-world.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await sleep(100); } return !!(await fn()); };
// ── faux OAuth2 et faux FCM
const fcmMsgs = [];
const upAuth = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"access_token":"ya29.e2e","expires_in":3599}'); }); });
const upFcm = http.createServer((req, res) => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => { try { fcmMsgs.push({ url: req.url, body: JSON.parse(Buffer.concat(c).toString()) }); } catch (e) { /* ignore */ } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"name":"projects/mana-e2e/messages/1"}'); }); });
const upScry = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"object":"list","not_found":[],"data":[]}'); }); });
for (const s of [upAuth, upFcm, upScry]) await new Promise(r => s.listen(0, '127.0.0.1', r));
const SA = { type: 'service_account', project_id: 'mana-e2e', client_email: 'fcm@mana-e2e.iam.gserviceaccount.com', private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
const dir = mkdtempSync(join(tmpdir(), 'push-native-'));
const world = await startWorld({ port: 18960, env: { FCM_SERVICE_ACCOUNT: JSON.stringify(SA), FCM_TOKEN_URL: `http://127.0.0.1:${upAuth.address().port}/token`, FCM_BASE_URL: `http://127.0.0.1:${upFcm.address().port}`, PUSH_GRACE_MS: '300',
  SCRYFALL_UPSTREAM: `http://127.0.0.1:${upScry.address().port}`, ALERT_FILE: join(dir, 'alerts.json'), ALERT_EVERY_MS: '3600000', ALERT_FIRST_MS: '3600000', ALERT_SEED_MS: '150', ALERT_CHECK_GAP_MS: '0' } });
const TOK1 = 'eA1:APA91b' + randomBytes(100).toString('base64url'), TOK2 = 'eB2:APA91b' + randomBytes(100).toString('base64url');
const alIdOf = t => createHash('sha1').update('fcm:' + t).digest('hex').slice(0, 24);      // identifiant d'appareil côté serveur

// ── coque Android simulée : plugin PushNotifications. Permission, jeton à rendre et toucher « au lancement » gardés dans localStorage (survivent
//    au rechargement). Comme le vrai plugin, un évènement émis sans personne à l'écoute attend le premier addListener.
const shell = tok => {
  const g = k => { try { return JSON.parse(localStorage.getItem('__t_' + k)); } catch (e) { return null; } }, s = (k, v) => localStorage.setItem('__t_' + k, JSON.stringify(v));
  const L = {}, held = {}, calls = [];
  const fire = (ev, data) => { if (L[ev] && L[ev].length) L[ev].forEach(f => f(data)); else (held[ev] = held[ev] || []).push(data); };
  window.__pn = { calls, fire, listeners: L };
  const launch = g('launch'); if (launch) { s('launch', null); fire('pushNotificationActionPerformed', { actionId: 'tap', notification: { id: 'm1', data: { url: launch, 'google.message_id': 'm1' } } }); }
  window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: n => n === 'PushNotifications', Plugins: { PushNotifications: {
    checkPermissions: async () => { calls.push('check'); return { receive: g('perm') || 'prompt' }; },
    requestPermissions: async () => { calls.push('request'); s('asked', (g('asked') || 0) + 1); if (g('perm') !== 'denied') s('perm', 'granted'); return { receive: g('perm') }; },
    register: async () => { calls.push('register'); setTimeout(() => fire('registration', { value: g('token') || tok }), 60); },
    unregister: async () => { calls.push('unregister'); },
    addListener: async (ev, fn) => { (L[ev] = L[ev] || []).push(fn); for (const d of (held[ev] || []).splice(0)) setTimeout(() => fn(d), 0); return { remove: async () => {} }; },
  } } };
  try {
    if (!localStorage.getItem('deckdeal:decks:v1')) localStorage.setItem('deckdeal:decks:v1', JSON.stringify([{ id: 'dA', name: 'Deck A', text: '1 Sol Ring\n1 Swords to Plowshares\n1 Wrath of God', updatedAt: Date.now() - 1000 }]));
  } catch (e) { /* ignore */ }
};
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const { ctx, p, errs } = await newPage(browser, world, { init: `(${shell})(${JSON.stringify(TOK1)})`, goto: false });
const reqs = []; p.on('request', r => { if (/\/api\/(alerts|jobs)(\?|$)/.test(r.url())) { let b = null; try { b = JSON.parse(r.postData() || 'null'); } catch (e) { /* ignore */ } reqs.push({ m: r.method(), u: r.url(), b }); } });
await p.goto(world.url); await p.waitForTimeout(1000);
const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('__t_' + k)), k);
const server = async id => { const r = await fetch(world.url + 'api/alerts?id=' + id); return r.status; };
const openSet = async () => { await p.click('#btnSettings'); await p.waitForSelector('#btnNotif'); await p.click('#btnNotif'); await p.waitForSelector('#pushBox #setPush', { timeout: 5000 }); await p.waitForSelector('#alertBox #setAlert', { timeout: 5000 }); };
const closeSheets = async () => { for (let i = 0; i < 3 && await p.$('.sheet-wrap'); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(350); } };
const alertsSheet = () => p.waitForFunction(() => [...document.querySelectorAll('.sheet-head h2')].some(h => /Alertes de prix/.test(h.textContent)), null, { timeout: 6000 });

/* ── Réglages › Notifications : permission Android, jeton FCM ──────────────────────────────────── */
assert.equal(await p.evaluate(() => CTX.fcm), true, 'ping : le serveur annonce FCM');
await openSet(); assert.equal(await p.$eval('#setPush', c => c.checked), false);
const box0 = await txt(p, '#pushBox'); assert.match(box0, /Prévenir quand la recherche est finie/); assert.doesNotMatch(box0, /iPhone|navigateur|écran d'accueil/);
await p.click('label[for="setPush"] .switch'); await p.waitForFunction(() => document.querySelector('#setPush').checked && !document.querySelector('#setPush').disabled, null, { timeout: 6000 });
assert.match(await txt(p, '#toast'), /Notifications activées/); assert.equal(await ls('asked'), 1, 'autorisation Android demandée une fois');
assert.equal(await p.evaluate(() => localStorage.getItem('deckdeal:fcm')), TOK1, 'jeton FCM gardé'); assert.ok((await p.evaluate(() => window.__pn.calls)).includes('register'));
await p.screenshot({ path: 'shots/push-native-0-reglages.png' });
ok('Réglages › Notifications dans l\'appli : permission Android, register(), jeton FCM reçu par l\'évènement « registration »');

/* ── Réglages › Alertes de prix : la liste part avec { fcm } ───────────────────────────────────── */
const r0 = reqs.length;
await p.click('label[for="setAlert"] .switch'); await p.waitForFunction(() => document.querySelector('#setAlert').checked && AC.id && AC.info, null, { timeout: 8000 });
const put = reqs.slice(r0).find(x => x.m === 'PUT'); assert.ok(put, 'liste envoyée au serveur');
assert.deepEqual(put.b.sub, { fcm: TOK1 }, 'cible FCM à la place de l\'abonnement Web Push'); assert.equal(put.b.items.length, 3);
assert.equal(await p.evaluate(() => AC.id), alIdOf(TOK1)); assert.equal(await server(alIdOf(TOK1)), 200);
assert.equal(await ls('asked'), 1, 'déjà autorisé : pas de seconde demande'); assert.doesNotMatch(await txt(p, '#alertBox'), /VAPID|navigateur|iPhone/);
ok('alertes de prix : PUT /api/alerts avec { fcm: jeton }, appareil enregistré sur le serveur');
await closeSheets();

/* ── Notification touchée, appli ouverte ───────────────────────────────────────────────────────── */
await p.evaluate(() => window.__pn.fire('pushNotificationActionPerformed', { actionId: 'tap', notification: { id: 'm2', data: { url: './?alerts=1', 'google.message_id': 'm2' } } }));
await alertsSheet(); ok('toucher une alerte (pushNotificationActionPerformed) : la feuille des alertes s\'ouvre');
await closeSheets();
await p.evaluate(() => window.__pn.fire('pushNotificationActionPerformed', { actionId: 'tap', notification: { id: 'm3', data: { url: './?resume=1' } } }));
await p.waitForFunction(() => /Recherche terminée : relance-la/.test(document.querySelector('#toast').textContent), null, { timeout: 4000 }); ok('toucher « recherche terminée » : reprise de la recherche (resumeRun)');
/* ── Notification reçue au premier plan → toast « Voir » ──────────────────────────────────────── */
await p.evaluate(() => window.__pn.fire('pushNotificationReceived', { id: 'm4', title: 'Sol Ring : −40 %', body: '3,00 € → 1,80 € (tendance Cardmarket).', data: { url: './?alerts=1' } }));
await p.waitForFunction(() => /Sol Ring : −40 % · 3,00 € → 1,80 €/.test(document.querySelector('#toast').textContent) && document.querySelector('#toast .toast-act'), null, { timeout: 4000 });
await p.click('#toast .toast-act'); await alertsSheet(); ok('notification reçue appli ouverte : toast avec « Voir » → feuille des alertes');
await closeSheets();

/* ── Relance : jeton renouvelé par Firebase, et appli lancée par le toucher d'une alerte ───────── */
await p.evaluate(t => { localStorage.setItem('__t_token', JSON.stringify(t)); localStorage.setItem('__t_launch', JSON.stringify('./?alerts=1')); }, TOK2);
const r1 = reqs.length; await p.reload();
await alertsSheet(); ok('appli lancée par le toucher d\'une alerte (évènement gardé jusqu\'à l\'écoute) : feuille des alertes ouverte');
assert.ok(await until(async () => (await p.evaluate(() => localStorage.getItem('deckdeal:fcm'))) === TOK2), 'jeton renouvelé au lancement');
assert.ok(await until(() => reqs.slice(r1).some(x => x.m === 'PUT' && x.b && x.b.sub && x.b.sub.fcm === TOK2), 10000), 'liste renvoyée avec le nouveau jeton');
assert.ok(await until(async () => (await server(alIdOf(TOK1))) === 404 && (await server(alIdOf(TOK2))) === 200), 'ancien enregistrement supprimé, nouveau en place');
assert.equal(await p.evaluate(() => AC.id), alIdOf(TOK2)); ok('jeton renouvelé : alertes réinscrites avec le nouveau jeton, l\'ancien enregistrement retiré');
await closeSheets();

/* ── Recherche quittée en route : charge utile { fcm }, message FCM reçu ──────────────────────── */
const DECK = '1 Sol Ring\n1 Swords to Plowshares\n1 Arcane Signet\n1 Wrath of God\n1 Craterhoof Behemoth\n1 Command Tower\n1 Llanowar Elves';
world.delay = 700; await toInput(p); await p.fill('#deckText', DECK); await p.waitForTimeout(300);
const r2 = reqs.length; await toInput(p); await p.click('#btnRun');
assert.ok(await until(() => reqs.slice(r2).some(x => x.m === 'POST' && /\/api\/jobs$/.test(x.u))), 'recherche envoyée');
const jb = reqs.slice(r2).find(x => x.m === 'POST' && /\/api\/jobs$/.test(x.u)).b;
assert.deepEqual(jb.push.sub, { fcm: TOK2 }); assert.equal(jb.push.title, 'Recherche terminée'); assert.match(jb.push.body, /^Les offres de « .+ » sont prêtes\.$/); assert.equal(jb.push.url, './?resume=1');
assert.deepEqual(Object.keys(jb.push).sort(), ['body', 'sub', 'title', 'url']); ok('la recherche emporte { fcm: jeton } et le texte de la notification');
await sleep(400); await ctx.close();
assert.ok(await until(() => fcmMsgs.some(m => m.body.message.token === TOK2 && m.body.message.data.url === './?resume=1'), 30000), 'message FCM envoyé à la fin');
const fm = fcmMsgs.find(m => m.body.message.token === TOK2); assert.equal(fm.url, '/v1/projects/mana-e2e/messages:send'); assert.equal(fm.body.message.notification.title, 'Recherche terminée');
ok('appli quittée pendant la recherche : notification envoyée par FCM au jeton de l\'appareil');
world.delay = 0;

/* ── États propres à l'appli : permission refusée, serveur sans compte de service ─────────────── */
const D = await newPage(browser, world, { init: `localStorage.setItem('__t_perm', '"denied"');(${shell})(${JSON.stringify(TOK1)})`, goto: false });
await D.p.goto(world.url); await D.p.waitForTimeout(900);
await D.p.click('#btnSettings'); assert.equal(await D.p.$('#appBox'), null, 'appli Android : pas de rubrique « Application » (rien à installer)'); await D.p.click('#btnNotif'); await D.p.waitForSelector('#pushBox .status', { timeout: 5000 });
const bd = await txt(D.p, '#pushBox'); assert.match(bd, /réglages d'Android/); assert.doesNotMatch(bd, /navigateur|iPhone/);
await D.p.keyboard.press('Escape'); await D.p.waitForTimeout(350); await D.p.keyboard.press('Escape'); await D.p.waitForTimeout(350);
await D.p.evaluate(() => { CTX.fcm = false; }); await D.p.click('#btnSettings'); assert.equal(await D.p.$('#appBox'), null, 'appli Android : pas de rubrique « Application » (rien à installer)'); await D.p.click('#btnNotif'); await D.p.waitForSelector('#pushBox .status', { timeout: 5000 });
assert.match(await txt(D.p, '#pushBox'), /compte de service Firebase/); assert.match(await txt(D.p, '#alertBox'), /FCM_SERVICE_ACCOUNT/); assert.doesNotMatch(await txt(D.p, '#alertBox'), /VAPID/);
ok('Réglages dans l\'appli : refus → réglages d\'Android ; serveur sans FCM → conseil FCM_SERVICE_ACCOUNT (jamais VAPID, iPhone ni navigateur)');

assert.deepEqual(errs.filter(e => !/WebAssembly|worker|closed|Target/i.test(e)), []); assert.deepEqual(D.errs, []);
await browser.close(); world.stop(); for (const s of [upAuth, upFcm, upScry]) s.close();
console.log('\nPUSH NATIVE E2E OK'); process.exit(0);
