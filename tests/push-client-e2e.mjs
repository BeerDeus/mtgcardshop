// E2E notifications côté app : activation dans les Réglages, charge utile envoyée avec la recherche, page fermée en cours de route → push chiffré reçu.
// Le navigateur est simulé pour l'abonnement (pas de service FCM en test) ; le vrai proxy chiffre et envoie vers un faux service de push.
import './setup-env.mjs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, generateKeyPairSync } from 'node:crypto';
import { chromium, startWorld, newPage, done, txt, ok, toInput, toHome } from './e2e-world.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pushed = [];
const upPush = http.createServer((req, res) => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => { pushed.push({ url: req.url, h: req.headers, body: Buffer.concat(c) }); res.writeHead(201); res.end(); }); });
await new Promise(r => upPush.listen(0, '127.0.0.1', r));
const PORT_PUSH = upPush.address().port;

const vk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
const VPUB = Buffer.concat([Buffer.from([4]), Buffer.from(vk.x, 'base64url'), Buffer.from(vk.y, 'base64url')]).toString('base64url');
const br = (() => { const e = createECDH('prime256v1'); e.generateKeys(); const auth = randomBytes(16); return { e, pub: e.getPublicKey(), auth, sub: { endpoint: `http://127.0.0.1:${PORT_PUSH}/send/abc123`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }; })();
function decrypt(body) {                                   // RFC 8291 côté navigateur
  const salt = body.subarray(0, 16), idlen = body[20], keyid = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ikm = Buffer.from(hkdfSync('sha256', br.e.computeSecret(keyid), br.auth, Buffer.concat([Buffer.from('WebPush: info\0'), br.pub, keyid]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]); let n = plain.length; while (n > 0 && plain[n - 1] === 0) n--; return plain.subarray(0, n - 1).toString();
}

const world = await startWorld({ port: 18930, env: { VAPID_PUBLIC_KEY: VPUB, VAPID_PRIVATE_KEY: vk.d, VAPID_SUBJECT: 'mailto:test@example.com', PUSH_ALLOW_HOSTS: `127.0.0.1:${PORT_PUSH}`, PUSH_GRACE_MS: '300' } });
world.delay = 700;
// faux navigateur : permission et abonnement gardés dans le stockage de la page (survivent au rechargement)
const stub = arg => {
  const g = k => { try { return JSON.parse(localStorage.getItem('__t_' + k)); } catch (e) { return null; } }, s = (k, v) => localStorage.setItem('__t_' + k, JSON.stringify(v));
  Object.defineProperty(Notification, 'permission', { configurable: true, get: () => g('perm') || 'default' });
  Notification.requestPermission = async () => { s('perm', 'granted'); s('asked', (g('asked') || 0) + 1); return 'granted'; };
  const mgr = {
    getSubscription: async () => { const x = g('sub'); return x ? { endpoint: x.endpoint, toJSON: () => x, unsubscribe: async () => { s('sub', null); s('unsub', (g('unsub') || 0) + 1); return true; } } : null; },
    subscribe: async o => { s('key', Array.from(o.applicationServerKey)); s('uvo', o.userVisibleOnly); s('sub', arg.sub); return mgr.getSubscription(); },
  };
  Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { configurable: true, get: () => mgr });
};
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const A = await newPage(browser, world, { sw: true, init: `(${stub})(${JSON.stringify({ sub: br.sub })})`, goto: false });
const { ctx, p, errs } = A;
const jobBodies = []; p.on('request', r => { if (r.method() === 'POST' && /\/api\/jobs$/.test(r.url())) { try { jobBodies.push(JSON.parse(r.postData())); } catch (e) { /* ignore */ } } });
await p.goto(world.url); await p.waitForTimeout(900);
const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('__t_' + k)), k);
const openSet = async () => { await p.click('#btnSettings'); await p.waitForSelector('#btnNotif'); await p.click('#btnNotif'); await p.waitForSelector('#pushBox'); await p.waitForSelector('#setPush', { timeout: 5000 }); };
const closeSheet = async () => { for (let i = 0; i < 3 && await p.$('.sheet-wrap'); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(350); } };      // notifications puis réglages

/* ── Réglages ────────────────────────────────────────────────────────────────────────────────── */
await openSet(); assert.equal(await p.$eval('#setPush', c => c.checked), false);
assert.match(await txt(p, '#pushBox'), /Prévenir quand la recherche est finie/);
await p.screenshot({ path: 'shots/push-0-reglages.png' });
await p.click('label[for="setPush"] .switch'); await p.waitForFunction(() => document.querySelector('#setPush').checked, null, { timeout: 5000 });
assert.equal(await ls('asked'), 1, 'autorisation demandée une fois'); assert.equal(await ls('uvo'), true);
assert.deepEqual(await ls('key'), [...Buffer.from(VPUB, 'base64url')], 'abonnement créé avec la clé publique du serveur');
assert.match(await txt(p, '#toast'), /Notifications activées/);
ok('Réglages › Notifications : permission demandée, abonnement avec la clé VAPID du serveur');
await closeSheet(); await p.reload(); await p.waitForTimeout(900); await openSet();
assert.equal(await p.$eval('#setPush', c => c.checked), true, 'réglage retrouvé après rechargement'); await closeSheet();

/* ── Recherche avec l'app fermée en route ─────────────────────────────────────────────────────── */
const DECK = '1 Sol Ring\n1 Swords to Plowshares\n1 Arcane Signet\n1 Wrath of God\n1 Craterhoof Behemoth\n1 Command Tower\n1 Llanowar Elves';
await toInput(p); await p.fill('#deckText', DECK); await p.waitForTimeout(300);
const n0 = jobBodies.length; await toInput(p); await p.click('#btnRun');
await p.waitForFunction(() => /offres|Recherche|recherche|Lecture/i.test((document.querySelector('#progTitle') || {}).textContent || ''), null, { timeout: 5000 });
await sleep(500);
const pb = jobBodies[n0]; assert.ok(pb, 'recherche envoyée au serveur');
assert.equal(pb.type, 'offers'); assert.equal(pb.push.sub.endpoint, br.sub.endpoint); assert.deepEqual(pb.push.sub.keys, br.sub.keys);
assert.equal(pb.push.title, 'Recherche terminée'); assert.match(pb.push.body, /^Les offres de « .+ » sont prêtes\.$/); assert.equal(pb.push.url, './?resume=1');
assert.deepEqual(Object.keys(pb.push).sort(), ['body', 'sub', 'title', 'url'], 'rien d\'autre n\'est envoyé');
ok('la recherche emporte l\'abonnement et le texte de la notification');
assert.equal(pushed.length, 0, 'rien tant que l\'app est ouverte');
await ctx.close();                                         // l'app disparaît pendant la lecture des offres
for (let i = 0; i < 80 && !pushed.length; i++) await sleep(250);
assert.equal(pushed.length, 1, 'une notification envoyée à la fin'); await sleep(900); assert.equal(pushed.length, 1, 'et une seule');
const m = pushed[0]; assert.equal(m.url, '/send/abc123'); assert.equal(m.h['content-encoding'], 'aes128gcm'); assert.match(m.h.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/); assert.ok(Number(m.h.ttl) > 0); assert.equal(m.h['content-type'], 'application/octet-stream');
const msg = JSON.parse(decrypt(m.body)); assert.equal(msg.title, 'Recherche terminée'); assert.match(msg.body, /sont prêtes/); assert.equal(msg.url, './?resume=1');
ok('page fermée en cours de recherche : push chiffré (aes128gcm, VAPID) reçu et lisible, une seule fois');

/* ── App ouverte jusqu'au bout : pas de notification ; réglage coupé : rien d'envoyé ──────────── */
const B = await newPage(browser, world, { sw: true, init: `(${stub})(${JSON.stringify({ sub: br.sub })})`, goto: false });
B.p.on('request', r => { if (r.method() === 'POST' && /\/api\/jobs$/.test(r.url())) { try { jobBodies.push(JSON.parse(r.postData())); } catch (e) { /* ignore */ } } });
await B.p.goto(world.url); await B.p.waitForTimeout(900);
await B.p.evaluate(sub => { localStorage.setItem('__t_perm', '"granted"'); localStorage.setItem('__t_sub', JSON.stringify(sub)); }, br.sub);   // déjà abonné
const st = await B.p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:v1') || '{}')); st.push = true; await B.p.evaluate(s => localStorage.setItem('deckdeal:v1', JSON.stringify(s)), st);
await B.p.reload(); await B.p.waitForTimeout(900);
world.delay = 0; await toInput(B.p); await B.p.fill('#deckText', DECK); const n1 = jobBodies.length; await toInput(B.p); await B.p.click('#btnRun'); await done(B.p); await sleep(1500);
assert.ok(jobBodies[n1] && jobBodies[n1].push, 'la charge utile est jointe'); assert.equal(pushed.length, 1, 'app ouverte à la fin : aucune notification');
ok('app ouverte jusqu\'à la fin : pas de notification');
// réglage coupé
await B.p.click('#btnSettings'); await B.p.waitForSelector('#btnNotif'); await B.p.click('#btnNotif'); await B.p.waitForSelector('#setPush'); await B.p.click('label[for="setPush"] .switch'); await B.p.waitForFunction(() => !document.querySelector('#setPush').checked);
assert.equal(await B.p.evaluate(() => JSON.parse(localStorage.getItem('__t_unsub'))), 1, 'abonnement résilié'); await B.p.keyboard.press('Escape'); await B.p.waitForTimeout(350); await B.p.keyboard.press('Escape'); await B.p.waitForTimeout(350);
await B.p.click('#btnBack'); await B.p.waitForSelector('#deckText', { state: 'visible', timeout: 5000 });
await toInput(B.p); await B.p.fill('#deckText', DECK + '\n1 Ranger\'s Hawk'); const n2 = jobBodies.length; await toInput(B.p); await B.p.click('#btnRun'); await done(B.p); await sleep(800);
assert.ok(jobBodies[n2] && !('push' in jobBodies[n2]), 'réglage coupé : aucune charge utile'); assert.equal(pushed.length, 1);
ok('réglage coupé : abonnement résilié, plus rien envoyé');

assert.deepEqual(errs.filter(e => !/WebAssembly|worker|closed|Target/i.test(e)), []); assert.deepEqual(B.errs.filter(e => !/WebAssembly|worker/i.test(e)), []);
await browser.close(); world.stop(); upPush.close(); console.log('\nPUSH CLIENT E2E OK'); process.exit(0);
