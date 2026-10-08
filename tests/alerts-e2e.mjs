// E2E alertes de prix côté app : activation (permission + abonnement), liste envoyée au serveur (cartes manquantes des decks, suivi à la main,
// exclusion), mise à jour quand la collection change, seuil, contrôle manuel → notification chiffrée reçue, coupure, lien de notification.
// Vrai proxy + faux Scryfall (relevés serveur) + faux service de push ; le navigateur simule l'abonnement.
import './setup-env.mjs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, generateKeyPairSync } from 'node:crypto';
import { chromium, startWorld, newPage, txt, ok, done, toInput, toHome } from './e2e-world.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const price = new Map([['sol ring', '3.00'], ['swords to plowshares', '1.20'], ['wrath of god', '2.50'], ['arcane signet', '1.00'], ['craterhoof behemoth', '9.00']]);
const upScry = http.createServer((req, res) => {
  const c = []; req.on('data', x => c.push(x)); req.on('end', () => {
    const b = JSON.parse(Buffer.concat(c).toString() || '{}'), data = [];
    for (const i of b.identifiers || []) { const p = price.get(i.name.toLowerCase()); if (p) data.push({ name: i.name, prices: { eur: p } }); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ object: 'list', not_found: [], data }));
  });
});
const pushed = [];
const upPush = http.createServer((req, res) => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => { pushed.push({ url: req.url, h: req.headers, body: Buffer.concat(c) }); res.writeHead(201); res.end(); }); });
for (const s of [upScry, upPush]) await new Promise(r => s.listen(0, '127.0.0.1', r));
const PORT_PUSH = upPush.address().port;
const vk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
const VPUB = Buffer.concat([Buffer.from([4]), Buffer.from(vk.x, 'base64url'), Buffer.from(vk.y, 'base64url')]).toString('base64url');
const br = (() => { const e = createECDH('prime256v1'); e.generateKeys(); const auth = randomBytes(16); return { e, pub: e.getPublicKey(), auth, sub: { endpoint: `http://127.0.0.1:${PORT_PUSH}/send/alerts-e2e`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }; })();
function decrypt(body) {
  const salt = body.subarray(0, 16), idlen = body[20], keyid = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ikm = Buffer.from(hkdfSync('sha256', br.e.computeSecret(keyid), br.auth, Buffer.concat([Buffer.from('WebPush: info\0'), br.pub, keyid]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]); let n = plain.length; while (n > 0 && plain[n - 1] === 0) n--; return JSON.parse(plain.subarray(0, n - 1).toString());
}
const dir = mkdtempSync(join(tmpdir(), 'alerts-e2e-'));
const world = await startWorld({ port: 18952, env: { VAPID_PUBLIC_KEY: VPUB, VAPID_PRIVATE_KEY: vk.d, VAPID_SUBJECT: 'mailto:test@example.com', PUSH_ALLOW_HOSTS: `127.0.0.1:${PORT_PUSH}`,
  SCRYFALL_UPSTREAM: `http://127.0.0.1:${upScry.address().port}`, ALERT_FILE: join(dir, 'alerts.json'), ALERT_EVERY_MS: '3600000', ALERT_FIRST_MS: '3600000', ALERT_SEED_MS: '150', ALERT_CHECK_GAP_MS: '0' } });
const stub = arg => {
  const g = k => { try { return JSON.parse(localStorage.getItem('__t_' + k)); } catch (e) { return null; } }, s = (k, v) => localStorage.setItem('__t_' + k, JSON.stringify(v));
  Object.defineProperty(Notification, 'permission', { configurable: true, get: () => g('perm') || 'default' });
  Notification.requestPermission = async () => { s('perm', 'granted'); s('asked', (g('asked') || 0) + 1); return 'granted'; };
  const mgr = {
    getSubscription: async () => { const x = g('sub'); return x ? { endpoint: x.endpoint, toJSON: () => x, unsubscribe: async () => { s('sub', null); s('unsub', (g('unsub') || 0) + 1); return true; } } : null; },
    subscribe: async o => { s('sub', arg.sub); return mgr.getSubscription(); },
  };
  Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { configurable: true, get: () => mgr });
  try {
    if (!localStorage.getItem('deckdeal:decks:v1')) localStorage.setItem('deckdeal:decks:v1', JSON.stringify([
      { id: 'dA', name: 'Deck A', text: '1 Sol Ring\n1 Arcane Signet\n1 Swords to Plowshares', updatedAt: Date.now() - 1000 },
      { id: 'dB', name: 'Deck B', text: '1 Sol Ring\n1 Wrath of God', updatedAt: Date.now() - 2000 }]));
    if (!localStorage.getItem('deckdeal:coll:v1')) localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '1 Arcane Signet', u: 1, s: '', b: null }));
  } catch (e) { /* ignore */ }
};
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const { p, errs } = await newPage(browser, world, { sw: true, init: `(${stub})(${JSON.stringify({ sub: br.sub })})`, goto: false });
await p.goto(world.url); await p.waitForTimeout(1200);
const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('__t_' + k)), k);
const server = async id => { const r = await fetch(world.url + '/api/alerts?id=' + id); return { s: r.status, o: await r.json() }; };
const myId = () => p.evaluate(() => AC.id);
const sheetGone = () => p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 4000 });
const openSet = async () => { await p.click('#btnSettings'); await p.waitForSelector('#alertBox #setAlert', { timeout: 5000 }); };

/* ── Activation ───────────────────────────────────────────────────────────────────────────── */
await openSet(); assert.equal(await p.$eval('#setAlert', c => c.checked), false);
assert.match(await txt(p, '#alertBox'), /Prévenir en cas de forte baisse/); assert.equal(await p.$('#btnAlertOpen'), null, 'rien à régler tant que c\'est coupé');
await p.$eval('#alertBox', el => el.scrollIntoView({ block: 'center', behavior: 'instant' })); await sleep(300); await p.screenshot({ path: 'shots/alerts-0-reglages.png' });
await p.click('label[for="setAlert"] .switch'); await p.waitForFunction(() => document.querySelector('#setAlert').checked && document.querySelector('#btnAlertOpen'), null, { timeout: 8000 });
assert.equal(await ls('asked'), 1, 'autorisation demandée'); assert.match(await txt(p, '#toast'), /Alertes de prix activées/);
await p.waitForFunction(() => AC.id && AC.info, null, { timeout: 6000 });
let srv = await server(await myId()); assert.equal(srv.s, 200); assert.equal(srv.o.watching, 3, 'Sol Ring, Swords, Wrath : Arcane Signet est déjà possédée');
assert.match(await txt(p, '#alertBox'), /3 cartes surveillées/); await p.screenshot({ path: 'shots/alerts-0b-reglages-actif.png' }); ok('activation : permission, abonnement, 3 cartes manquantes des decks envoyées au serveur');

/* ── Feuille ─────────────────────────────────────────────────────────────────────────────── */
await sleep(500); await p.click('#btnAlertOpen'); await p.waitForSelector('.al-row');
assert.deepEqual(await p.$$eval('.al-list:not(.hits) .al-row .al-n b', e => e.map(x => x.textContent).sort()), ['Sol Ring', 'Swords to Plowshares', 'Wrath of God']);
assert.match(await txt(p, '.al-row[data-k="sol ring"] small'), /Manque à Deck A · Manque à Deck B/);
await p.waitForFunction(() => /3,00/.test(document.querySelector('.al-row[data-k="sol ring"] .al-px').textContent), null, { timeout: 6000 });
ok('feuille : cartes surveillées, decks concernés, prix relevé par le serveur');
// contrôle sans changement
await p.click('#alCheck'); await p.waitForFunction(() => /rien à signaler/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 }); assert.equal(pushed.length, 0);
// chute : notification
price.set('sol ring', '1.50'); await sleep(100);
await p.click('#alCheck'); await p.waitForFunction(() => /1 alerte envoyée/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 });
assert.equal(pushed.length, 1); const m = decrypt(pushed[0].body); assert.equal(m.title, 'Sol Ring : −50 %'); assert.match(m.body, /3,00 € → 1,50 €/); assert.equal(m.kind, 'alert'); assert.equal(m.url, './?alerts=1');
await p.waitForSelector('.al-list.hits .al-row'); assert.match(await txt(p, '.al-list.hits'), /Sol Ring/); assert.match(await txt(p, '.al-row[data-k="sol ring"] .al-px'), /1,50.*−50 %/);
await p.screenshot({ path: 'shots/alerts-1-feuille.png' });
ok('chute de 50 % : alerte reçue, liste « Dernières alertes », prix et variation affichés');

/* ── Suivi à la main, prix cible, exclusion ───────────────────────────────────────────────── */
await p.fill('#alName', 'Craterhoof Behemoth'); await p.fill('#alTarget', '5,5'); await p.click('#alAdd button');
await p.waitForSelector('.al-row[data-k="craterhoof behemoth"]', { timeout: 8000 });
assert.match(await txt(p, '.al-row[data-k="craterhoof behemoth"] small'), /Cible 5,50/); await p.waitForTimeout(600);
srv = await server(await myId()); assert.equal(srv.o.watching, 4);
await p.fill('#alName', 'Carte Qui Nexiste Pas'); await p.click('#alAdd button'); await p.waitForFunction(() => !document.querySelector('#alAddMsg').hidden, null, { timeout: 8000 });
assert.match(await txt(p, '#alAddMsg'), /introuvable/); assert.equal(await p.$('.al-row[data-k="carte qui nexiste pas"]'), null);
price.set('craterhoof behemoth', '5.00'); await p.click('#alCheck'); await p.waitForFunction(() => /1 alerte envoyée/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 });
const m2 = decrypt(pushed[1].body); assert.equal(m2.title, 'Craterhoof Behemoth à 5,00 €'); assert.match(m2.body, /Sous ton prix cible de 5,50 €/); ok('suivi à la main avec prix cible : alerte sous la cible, nom inconnu refusé');
await p.click('.al-row[data-k="wrath of god"] [data-rm]'); await p.waitForFunction(() => !document.querySelector('.al-row[data-k="wrath of god"]'));
assert.match(await txt(p, 'body'), /1 carte exclue de la surveillance/); await p.waitForTimeout(3400); srv = await server(await myId()); assert.equal(srv.o.watching, 3, 'carte exclue retirée de la liste du serveur');
await p.click('#alUnmute'); await p.waitForSelector('.al-row[data-k="wrath of god"]'); ok('exclusion d\'une carte de deck, puis rétablie');

/* ── Seuil et collection ─────────────────────────────────────────────────────────────────── */
await p.click('#alThr .seg-opt[data-v="40"], #alThr [data-v="40"]'); await p.waitForTimeout(3600); srv = await server(await myId()); assert.equal(srv.o.thr, 40); assert.equal(await p.evaluate(() => AC.thr), 40); ok('seuil de baisse réglé (40 %) et transmis');
await p.evaluate(() => collAdd([{ k: 'swords to plowshares', n: 'Swords to Plowshares', q: 1 }], 'add'));
await p.waitForTimeout(3800); srv = await server(await myId()); assert.equal(srv.o.watching, 3, 'Swords acquise : retirée ; Wrath rétablie : 3 (Sol Ring, Wrath, Craterhoof)');
await p.click('#alCheck'); await p.waitForFunction(() => !document.querySelector('.al-row[data-k="swords to plowshares"]'), null, { timeout: 8000 });
ok('carte ajoutée à la collection : plus surveillée');

/* ── Serveur remis à zéro : l'app se réenregistre toute seule ───────────────────────────── */
const idR = await myId(); await fetch(world.url + '/api/alerts?id=' + idR, { method: 'DELETE' }); assert.equal((await server(idR)).s, 404);
await p.click('#alCheck'); for (let i = 0; i < 40 && (await server(idR)).s !== 200; i++) await sleep(200);
assert.equal((await server(idR)).s, 200, 'liste renvoyée au serveur'); assert.equal((await server(idR)).o.watching, 3); ok('serveur vidé (redéploiement) : la liste est renvoyée au contrôle suivant');

/* ── Coupure ─────────────────────────────────────────────────────────────────────────────── */
const alSheetGone = () => p.waitForFunction(() => ![...document.querySelectorAll('.sheet-head h2')].some(h => /Alertes de prix/.test(h.textContent)), null, { timeout: 4000 });
const id0 = await myId(); await p.click('#alOff'); await alSheetGone();
assert.equal((await server(id0)).s, 404, 'désinscrit côté serveur'); assert.equal(await p.evaluate(() => AC.on), false); assert.equal(await ls('unsub'), 1, 'abonnement push retiré (rien d\'autre ne s\'en sert)');
await p.waitForFunction(() => document.querySelector('#alertBox #setAlert') && !document.querySelector('#setAlert').checked, null, { timeout: 3000 });
ok('coupure : serveur prévenu, abonnement push retiré');

/* ── Partage de l'abonnement avec « recherche terminée » ───────────────────────────────────── */
await p.click('label[for="setAlert"] .switch'); await p.waitForFunction(() => document.querySelector('#setAlert').checked && AC.id, null, { timeout: 8000 });
await p.click('label[for="setPush"] .switch'); await p.waitForFunction(() => document.querySelector('#setPush').checked, null, { timeout: 5000 });
await p.click('label[for="setPush"] .switch'); await p.waitForFunction(() => !document.querySelector('#setPush').checked); await p.waitForTimeout(300);
assert.equal(await ls('unsub'), 1, 'recherche coupée mais alertes actives : l\'abonnement reste'); assert.ok(await ls('sub'));
ok('abonnement push partagé : couper « recherche terminée » ne coupe pas les alertes');
await p.keyboard.press('Escape'); await sheetGone();

/* ── Fiche d'une carte : « Prévenir si le prix baisse » ──────────────────────────────────── */
await toInput(p); await p.fill('#deckText', '1 Sol Ring'); await p.waitForTimeout(300); await toInput(p); await p.click('#btnRun'); await done(p);
await p.evaluate(() => openCardSheet('sol ring')); await p.waitForSelector('.watchbtn');
assert.match(await txt(p, '.watchbtn'), /Prévenir si le prix baisse/); await p.click('.watchbtn');
await p.waitForFunction(() => AC.watch['sol ring'], null, { timeout: 5000 }); assert.match(await txt(p, '.watchbtn'), /Ne plus surveiller/); assert.match(await txt(p, '#toast'), /tu seras prévenu/);
await p.click('.watchbtn'); await p.waitForFunction(() => !AC.watch['sol ring']); assert.match(await txt(p, '.watchbtn'), /Prévenir si le prix baisse/);
ok('fiche d\'une carte : suivi du prix en un toucher, retiré de même');

/* ── Lien de notification ────────────────────────────────────────────────────────────────── */
await p.goto(world.url + '/?alerts=1'); await p.waitForSelector('.sheet-wrap .al-list, .sheet-wrap .hint', { timeout: 8000 });
assert.match(await txt(p, '.sheet-head h2'), /Alertes de prix/); ok('notification touchée : la feuille des alertes s\'ouvre');

assert.deepEqual(errs, [], 'erreurs page : ' + errs.join(' | '));
await browser.close(); world.stop(); upScry.close(); upPush.close();
console.log('ALERTS E2E OK'); process.exit(0);
