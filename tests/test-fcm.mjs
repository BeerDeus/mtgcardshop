// Notifications de l'appli Android par Firebase Cloud Messaging (API HTTP v1) : compte de service, jeton OAuth2 (JWT RS256) gardé en cache,
// message envoyé, jeton d'appareil périmé retiré, « recherche terminée » et alertes de prix vers une cible { fcm }, Web Push inchangé à côté.
// Faux serveur OAuth2, faux FCM, faux service Web Push et faux Scryfall : aucun accès réseau réel.
import './setup-env.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, generateKeyPairSync, verify as sigVerify } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('✓ ' + m);
const b64j = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// ── compte de service de test (clé RSA générée ici)
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = { type: 'service_account', project_id: 'mana-test', private_key_id: 'k1', private_key: PEM, client_email: 'fcm-sender@mana-test.iam.gserviceaccount.com', client_id: '1', token_uri: 'https://oauth2.googleapis.com/token' };

// ── faux serveur OAuth2 : vérifie l'assertion JWT et rend un jeton d'accès
const oauth = { hits: [], n: 0, expires: 3599, fail: 0 };
const upAuth = http.createServer((req, res) => {
  const c = []; req.on('data', x => c.push(x)); req.on('end', () => {
    const f = new URLSearchParams(Buffer.concat(c).toString()), jwt = String(f.get('assertion') || ''), [h, p, s] = jwt.split('.');
    let verified = false; try { verified = sigVerify('sha256', Buffer.from(h + '.' + p), publicKey, Buffer.from(s, 'base64url')); } catch (e) { /* invalide */ }
    oauth.hits.push({ url: req.url, ct: req.headers['content-type'], grant: f.get('grant_type'), header: b64j(h), claims: b64j(p), verified });
    if (oauth.fail) { res.writeHead(oauth.fail, { 'Content-Type': 'application/json' }); return res.end('{"error":"invalid_grant"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: 'ya29.test-' + (++oauth.n), expires_in: oauth.expires, token_type: 'Bearer' }));
  });
});
// ── faux FCM : réponse selon le préfixe du jeton d'appareil (GONE : désinscrit, BAD : jeton invalide, MISM : autre projet, DOWN : 500, BUSY : 429 une fois)
const fcm = { msgs: [], revoked: new Set(), busy: 0 };
const fcmErr = (res, code, status, errorCode, message, extra = []) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code, message, status, details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }, ...extra] } })); };
const upFcm = http.createServer((req, res) => {
  const c = []; req.on('data', x => c.push(x)); req.on('end', () => {
    let body = null; try { body = JSON.parse(Buffer.concat(c).toString()); } catch (e) { /* ignore */ }
    const auth = String(req.headers.authorization || ''), t = body && body.message && body.message.token || '';
    fcm.msgs.push({ url: req.url, method: req.method, auth, ct: req.headers['content-type'], body });
    if (fcm.revoked.has(auth.replace(/^Bearer /, ''))) return fcmErr(res, 401, 'UNAUTHENTICATED', 'THIRD_PARTY_AUTH_ERROR', 'Request had invalid authentication credentials.');
    if (t.startsWith('GONE')) return fcmErr(res, 404, 'NOT_FOUND', 'UNREGISTERED', 'Requested entity was not found.');
    if (t.startsWith('BAD')) return fcmErr(res, 400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token', [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token', description: 'Invalid registration token' }] }]);
    if (t.startsWith('MISM')) return fcmErr(res, 403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH', 'SenderId mismatch');
    if (t.startsWith('DOWN')) return fcmErr(res, 500, 'INTERNAL', 'INTERNAL', 'Internal error');
    if (t.startsWith('BUSY') && fcm.busy++ === 0) return fcmErr(res, 429, 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED', 'Quota exceeded', []);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: 'projects/mana-test/messages/' + fcm.msgs.length }));
  });
});
// ── faux service Web Push, faux CardTrader, faux Scryfall
const pushed = [];
const upPush = http.createServer((req, res) => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => { pushed.push({ url: req.url, h: req.headers, body: Buffer.concat(c) }); res.writeHead(201); res.end(); }); });
const upCT = http.createServer((req, res) => { const bp = new URL(req.url, 'http://x').searchParams.get('blueprint_id'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ [bp]: [] })); });
const price = new Map();
const upScry = http.createServer((req, res) => {
  const c = []; req.on('data', x => c.push(x)); req.on('end', () => {
    const b = JSON.parse(Buffer.concat(c).toString() || '{}'), data = [];
    for (const i of b.identifiers || []) { const p = price.get(i.name.toLowerCase()); if (p) data.push({ name: i.name, prices: { eur: p } }); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ object: 'list', not_found: [], data }));
  });
});
for (const s of [upAuth, upFcm, upPush, upCT, upScry]) await new Promise(r => s.listen(0, '127.0.0.1', r));
const port = s => s.address().port;
const TOKEN_URL = `http://127.0.0.1:${port(upAuth)}/token`, FCM_URL = `http://127.0.0.1:${port(upFcm)}`;

const procs = [];
const start = (env, p) => new Promise((resolve, reject) => {
  const c = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: String(p), CT_UPSTREAM: `http://127.0.0.1:${port(upCT)}/api/v2`, CARDTRADER_TOKEN: 'tok', JOB_MAX_RUNNING: '40', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; c.log = () => out;
  c.stdout.on('data', d => { out += d; if (/Mana Orbit →/.test(out)) resolve(c); }); c.stderr.on('data', d => { out += d; });
  c.on('exit', code => { if (code) reject(new Error('exit ' + code + ': ' + out)); });
  procs.push(c);
});
process.on('exit', () => { for (const p of procs) try { p.kill(); } catch {} });
const J = async (B, path, init = {}) => { const r = await fetch(B + path, { ...init, headers: { 'Content-Type': 'application/json' } }); const t = await r.text(); let o; try { o = JSON.parse(t); } catch { o = t; } return { s: r.status, o }; };
const job = (B, bps, push) => J(B, '/api/jobs', { method: 'POST', body: JSON.stringify({ type: 'offers', lang: 'fr', foil: 'no', bps, ...(push ? { push } : {}) }) });
const until = async (fn, ms = 4000) => { for (let t = 0; t < ms && !fn(); t += 50) await sleep(50); return fn(); };
const tok = tag => tag + ':APA91b' + randomBytes(96).toString('base64url');           // forme d'un jeton FCM (≈ 140 caractères)
const msgsFor = t => fcm.msgs.filter(m => m.body && m.body.message && m.body.message.token === t);

const dir = mkdtempSync(join(tmpdir(), 'fcm-'));
// Un relevé par carte et par seconde (une heure en production) : les contrôles d'appareils enchaînés partagent le même relevé.
const ALERT_ENV = { SCRYFALL_UPSTREAM: `http://127.0.0.1:${port(upScry)}`, ALERT_EVERY_MS: '3600000', ALERT_FIRST_MS: '3600000', ALERT_SEED_MS: '100', ALERT_CHECK_GAP_MS: '0', ALERT_COOLDOWN_MS: '5000', ALERT_HIST_GAP_MS: '1000' };
const env = { FCM_SERVICE_ACCOUNT: JSON.stringify(SA), FCM_TOKEN_URL: TOKEN_URL, FCM_BASE_URL: FCM_URL, PUSH_GRACE_MS: '300', ALERT_FILE: join(dir, 'a.json'), ...ALERT_ENV };

/* ── 1) FCM seul (pas de clés VAPID) ─────────────────────────────────────────────────────────────── */
const P1 = await start(env, 18870); const B = 'http://127.0.0.1:18870';
let r = await J(B, '/__ping'); assert.equal(r.o.fcm, true); assert.equal(r.o.push, ''); assert.equal(r.o.alerts, true, 'FCM suffit pour les alertes');
assert.match(P1.log(), /FCM\) : projet Firebase « mana-test »/); ok('ping : fcm: true, alertes actives sans clés VAPID');

// recherche quittée → message FCM
const A = tok('devA');
r = await job(B, [5001, 5002], { sub: { fcm: A }, title: 'Recherche terminée', body: 'Les offres de « Mon deck » sont prêtes.', url: './?resume=1' });
assert.equal(r.s, 202); assert.equal(r.o.push, true);
assert.ok(await until(() => msgsFor(A).length === 1), 'message FCM envoyé'); await sleep(300); assert.equal(msgsFor(A).length, 1, 'un seul');
assert.equal(oauth.hits.length, 1, 'un jeton d\'accès demandé');
const h = oauth.hits[0];
assert.equal(h.url, '/token'); assert.match(h.ct, /application\/x-www-form-urlencoded/); assert.equal(h.grant, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
assert.deepEqual(h.header, { alg: 'RS256', typ: 'JWT' }); assert.equal(h.verified, true, 'signature RS256 vérifiée avec la clé publique de test');
assert.equal(h.claims.iss, SA.client_email); assert.equal(h.claims.scope, 'https://www.googleapis.com/auth/firebase.messaging'); assert.equal(h.claims.aud, TOKEN_URL);
const now = Math.floor(Date.now() / 1000); assert.equal(h.claims.exp - h.claims.iat, 3600); assert.ok(Math.abs(h.claims.iat - now) < 30);
ok('jeton d\'accès : assertion JWT RS256 (iss, scope, aud, iat/exp 1 h) vérifiée avec la clé du compte de service');
let m = msgsFor(A)[0];
assert.equal(m.method, 'POST'); assert.equal(m.url, '/v1/projects/mana-test/messages:send'); assert.equal(m.auth, 'Bearer ya29.test-1'); assert.match(m.ct, /application\/json/);
assert.deepEqual(m.body, { message: { token: A, notification: { title: 'Recherche terminée', body: 'Les offres de « Mon deck » sont prêtes.' }, data: { url: './?resume=1' }, android: { priority: 'HIGH', ttl: '3600s', collapse_key: 'deckdeal-run' } } });
ok('recherche quittée : POST messages:send, Bearer, corps { token, notification, data.url, android.priority HIGH }');

// jeton d'accès gardé ; app ouverte jusqu'au bout : rien ; rattachement : un seul message par jeton
const n0 = fcm.msgs.length;
r = await job(B, [5101], { sub: { fcm: A } }); await until(() => fcm.msgs.length > n0);
assert.equal(fcm.msgs.at(-1).auth, 'Bearer ya29.test-1'); assert.equal(oauth.hits.length, 1, 'jeton d\'accès réutilisé'); ok('jeton d\'accès gardé en cache');
assert.equal(fcm.msgs.at(-1).body.message.notification.title, 'Recherche terminée'); assert.equal(fcm.msgs.at(-1).body.message.data.url, './?resume=1'); ok('texte et lien par défaut');
const ids = [5201, 5202, 5203, 5204], c0 = msgsFor(A).length;
const a1 = await job(B, ids, { sub: { fcm: A }, body: 'un' }), a2 = await job(B, ids, { sub: { fcm: A }, body: 'deux' });
assert.equal(a2.o.attached, true); assert.equal(a2.o.id, a1.o.id); assert.equal(a2.o.push, true);
await until(() => msgsFor(A).length > c0); await sleep(600); assert.equal(msgsFor(A).length, c0 + 1, 'même jeton rattaché deux fois : un seul message'); ok('même jeton FCM sur une tâche : dédoublonné');
const R = tok('devR'); r = await job(B, [5301], { sub: { fcm: R } });
for (let i = 0; i < 40; i++) { const g = await J(B, '/api/jobs/' + r.o.id); if (g.o.status !== 'running') break; await sleep(40); }
await sleep(900); assert.equal(msgsFor(R).length, 0); ok('app ouverte (résultat relevé) : aucun message');

// cibles refusées : la recherche part, sans notification
const bad = [{ fcm: 'x'.repeat(99) }, { fcm: 'a'.repeat(4097) }, { fcm: tok('dev') + '+/=' }, { fcm: tok('dev') + ' x' }, { fcm: tok('dev') + '.' }, { fcm: 42 }, { fcm: null }, { fcm: [tok('dev')] }];
for (const [i, sub] of bad.entries()) { r = await job(B, [5400 + i], { sub }); assert.equal(r.s, 202, 'cas ' + i); assert.equal(r.o.push, false, 'cas ' + i); }
assert.equal((await job(B, [5450], { sub: { fcm: 'A'.repeat(100) } })).o.push, true, '100 caractères : accepté');
assert.equal((await job(B, [5451], { sub: { fcm: 'A1:_-'.repeat(819) + 'A' } })).o.push, true, '4096 caractères : accepté');
const web = (() => { const e = createECDH('prime256v1'); e.generateKeys(); return { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: e.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; })();
assert.equal((await job(B, [5452], { sub: web })).o.push, false, 'sans clés VAPID, un abonnement Web Push est refusé');
ok('jeton FCM : 100 à 4096 caractères [A-Za-z0-9:_-], chaîne seulement ; Web Push refusé sans clés VAPID');

// jetons d'appareil périmés : journalisés (tâche), retirés (alertes) ; erreurs passagères : retentées / gardées
const G = tok('GONE'); fcm.busy = 0; const Q = tok('BUSY');
await job(B, [5501], { sub: { fcm: G } }); await job(B, [5502], { sub: { fcm: Q } });
assert.ok(await until(() => msgsFor(G).length === 1 && msgsFor(Q).length === 2, 6000), '429 : un second essai');
await sleep(200); assert.match(P1.log(), /push FCM refusé \(404\) : abonnement expiré/); assert.match(P1.log(), /push FCM envoyé \(200\)/);
ok('tâche : jeton UNREGISTERED journalisé comme abonnement expiré ; 429 : retenté une fois');

// jeton d'accès révoqué (401) : un nouveau jeton, un second essai
fcm.revoked.add('ya29.test-1'); const V = tok('devV');
await job(B, [5601], { sub: { fcm: V } }); assert.ok(await until(() => msgsFor(V).length === 2, 6000));
assert.deepEqual(msgsFor(V).map(x => x.auth), ['Bearer ya29.test-1', 'Bearer ya29.test-2']); assert.equal(oauth.hits.length, 2); ok('401 : nouveau jeton d\'accès et nouvel essai');

/* ── 2) alertes de prix vers des cibles FCM ─────────────────────────────────────────────────────── */
price.set('sol ring', '3.00'); price.set('mana crypt', '100.00');
const items = [{ k: 'sol ring', n: 'Sol Ring', d: ['Deck A'] }, { k: 'mana crypt', n: 'Mana Crypt' }];
const reg = (sub, its = items) => J(B, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub, thr: 30, items: its }) });
const check = id => J(B, '/api/alerts/check?id=' + id, { method: 'POST', body: '{}' });
const AL1 = tok('devAl');
r = await reg({ fcm: AL1 }); assert.equal(r.s, 200); const ID = r.o.id; assert.match(ID, /^[a-f0-9]{24}$/);
r = await reg({ fcm: AL1 }, [items[0]]); assert.equal(r.o.id, ID, 'même jeton : même enregistrement'); assert.equal(r.o.watching, 1);
r = await reg({ fcm: AL1 }); assert.equal(r.o.id, ID); assert.equal(r.o.watching, 2); ok('alertes : jeton FCM accepté, un enregistrement par jeton (dédoublonné)');
r = await reg({ fcm: 'court' }); assert.equal(r.s, 400); assert.equal(r.o.error, 'bad_subscription');
r = await reg({ fcm: tok('dev'), endpoint: 'https://evil.example/x' }); assert.equal(r.s, 200, 'cible FCM : l\'endpoint éventuel est ignoré');
await J(B, '/api/alerts?id=' + r.o.id, { method: 'DELETE' });
const ALG = tok('GONE'), ALB = tok('BAD'), ALM = tok('MISM'), ALD = tok('DOWN');
const idG = (await reg({ fcm: ALG })).o.id, idB = (await reg({ fcm: ALB })).o.id, idM = (await reg({ fcm: ALM })).o.id, idD = (await reg({ fcm: ALD })).o.id;
await sleep(1500);
r = await J(B, '/api/alerts?id=' + ID); assert.equal(r.s, 200); assert.equal(r.o.prices['sol ring'].c, 300);
const k0 = fcm.msgs.length; r = await check(ID); assert.equal(r.o.ok, true); assert.equal(fcm.msgs.length, k0, 'prix stables : rien');
price.set('sol ring', '1.80');
r = await check(ID); assert.equal(r.o.ok, true);
m = msgsFor(AL1).at(-1); assert.ok(m, 'alerte envoyée par FCM');
assert.deepEqual(Object.keys(m.body.message).sort(), ['android', 'data', 'notification', 'token']);
assert.equal(m.body.message.notification.title, 'Sol Ring : −40 %'); assert.match(m.body.message.notification.body, /3,00 € → 1,80 € \(tendance Cardmarket\)\. · manque à Deck A/);
assert.deepEqual(m.body.message.data, { url: './?alerts=1' }); assert.deepEqual(m.body.message.android, { priority: 'HIGH', ttl: '43200s', collapse_key: 'deckdeal-alert' });
ok('baisse de prix : alerte FCM (titre, texte, lien ./?alerts=1, priorité haute)');
for (const id of [idG, idB, idM, idD]) { r = await check(id); assert.equal(r.o.ok, true); }                // « Vérifier les prix » ne concerne que l'appareil qui le demande
assert.equal(msgsFor(ALD).length, 2, '500 : retenté une fois');
assert.equal((await J(B, '/api/alerts?id=' + idG)).s, 404, 'UNREGISTERED : retiré');
assert.equal((await J(B, '/api/alerts?id=' + idB)).s, 404, 'jeton invalide : retiré');
assert.equal((await J(B, '/api/alerts?id=' + idM)).s, 404, 'autre projet Firebase : retiré');
assert.equal((await J(B, '/api/alerts?id=' + idD)).s, 200, 'erreur passagère (500) : gardé');
assert.equal((await J(B, '/api/alerts?id=' + ID)).s, 200);
assert.match(P1.log(), /alerte : jeton FCM périmé, retiré/); ok('jetons UNREGISTERED / invalide / autre projet retirés ; erreur serveur FCM : gardé');
r = await J(B, '/api/alerts?id=' + ID, { method: 'DELETE' }); assert.equal(r.o.removed, true); ok('désinscription par identifiant');
P1.kill();

/* ── 3) Web Push et FCM côte à côte : Web Push inchangé ─────────────────────────────────────────── */
const vk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
const VPUB = Buffer.concat([Buffer.from([4]), Buffer.from(vk.x, 'base64url'), Buffer.from(vk.y, 'base64url')]).toString('base64url');
const br = (() => { const e = createECDH('prime256v1'); e.generateKeys(); const auth = randomBytes(16); return { e, pub: e.getPublicKey(), auth, sub: { endpoint: `http://127.0.0.1:${port(upPush)}/send/web1`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }; })();
function decrypt(body) {
  const salt = body.subarray(0, 16), idlen = body[20], keyid = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ikm = Buffer.from(hkdfSync('sha256', br.e.computeSecret(keyid), br.auth, Buffer.concat([Buffer.from('WebPush: info\0'), br.pub, keyid]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]); let n = plain.length; while (n > 0 && plain[n - 1] === 0) n--; return JSON.parse(plain.subarray(0, n - 1).toString());
}
await start({ ...env, ALERT_FILE: join(dir, 'b.json'), VAPID_PUBLIC_KEY: VPUB, VAPID_PRIVATE_KEY: vk.d, VAPID_SUBJECT: 'mailto:test@example.com', PUSH_ALLOW_HOSTS: `127.0.0.1:${port(upPush)}` }, 18871);
const B2 = 'http://127.0.0.1:18871';
r = await J(B2, '/__ping'); assert.equal(r.o.fcm, true); assert.equal(r.o.push, VPUB); assert.equal(r.o.alerts, true);
const W = tok('devW'); pushed.length = 0;
const ids2 = [6001, 6002, 6003];
await job(B2, ids2, { sub: br.sub, title: 'Recherche terminée', body: 'web', url: './?resume=1' }); r = await job(B2, ids2, { sub: { fcm: W }, body: 'appli' });
assert.equal(r.o.attached, true); assert.equal(r.o.push, true);
assert.ok(await until(() => pushed.length === 1 && msgsFor(W).length === 1)); await sleep(400); assert.equal(pushed.length, 1); assert.equal(msgsFor(W).length, 1);
assert.equal(pushed[0].url, '/send/web1'); assert.equal(pushed[0].h['content-encoding'], 'aes128gcm'); assert.match(pushed[0].h.authorization, /^vapid t=/);
assert.deepEqual(decrypt(pushed[0].body), { title: 'Recherche terminée', body: 'web', url: './?resume=1' }); assert.equal(msgsFor(W)[0].body.message.notification.body, 'appli');
ok('une tâche, un navigateur et une appli : Web Push chiffré (VAPID) d\'un côté, FCM de l\'autre');
price.set('sol ring', '3.00'); price.set('mana crypt', '100.00');
const idW = (await J(B2, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: br.sub, thr: 30, items }) })).o.id;
const W2 = tok('devW2'); const idF = (await J(B2, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: { fcm: W2 }, thr: 30, items }) })).o.id;
assert.notEqual(idW, idF); await sleep(1500); pushed.length = 0;
price.set('mana crypt', '60.00'); r = await J(B2, '/api/alerts/check?id=' + idF, { method: 'POST', body: '{}' }); assert.equal(r.o.ok, true); assert.equal(r.o.last.hits, 1);
assert.equal(pushed.length, 0, 'contrôle de l\'appli : le navigateur n\'est pas notifié'); assert.equal(msgsFor(W2).length, 1);
r = await J(B2, '/api/alerts/check?id=' + idW, { method: 'POST', body: '{}' }); assert.equal(r.o.ok, true); assert.equal(r.o.last.hits, 1);
assert.equal(pushed.length, 1); const wm = decrypt(pushed[0].body); assert.equal(wm.title, 'Mana Crypt : −40 %'); assert.equal(wm.url, './?alerts=1'); assert.equal(wm.kind, 'alert'); assert.equal(pushed[0].h.topic, 'deckdeal-alert');
assert.equal(msgsFor(W2).length, 1); assert.equal(msgsFor(W2)[0].body.message.notification.title, 'Mana Crypt : −40 %');
ok('alertes : l\'abonnement Web Push et le jeton FCM reçoivent chacun la même alerte, par leur propre service');

/* ── 4) configuration : fichier, base64, cache jusqu'à 5 min de l'expiration, erreurs ─────────────── */
writeFileSync(join(dir, 'sa.json'), JSON.stringify({ ...SA, token_uri: TOKEN_URL }));
oauth.expires = 290; const h0 = oauth.hits.length;                                  // moins de 5 min de validité : redemandé à chaque envoi
await start({ FCM_SERVICE_ACCOUNT_FILE: join(dir, 'sa.json'), FCM_BASE_URL: FCM_URL, PUSH_GRACE_MS: '200', ALERT_FILE: join(dir, 'c.json'), ...ALERT_ENV }, 18872); const B3 = 'http://127.0.0.1:18872';
assert.equal((await J(B3, '/__ping')).o.fcm, true);
const F1 = tok('devF1'), F2 = tok('devF2'); await job(B3, [7001], { sub: { fcm: F1 } }); await until(() => msgsFor(F1).length === 1); await job(B3, [7002], { sub: { fcm: F2 } }); await until(() => msgsFor(F2).length === 1);
assert.equal(oauth.hits.length - h0, 2, 'jeton à moins de 5 min de son expiration : renouvelé'); assert.equal(oauth.hits.at(-1).claims.aud, TOKEN_URL, 'token_uri du compte de service');
ok('FCM_SERVICE_ACCOUNT_FILE (token_uri du fichier) ; jeton d\'accès renouvelé à moins de 5 min de son expiration');
oauth.expires = 3599; oauth.fail = 400; const F3 = tok('devF3');
await start({ FCM_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(SA)).toString('base64'), FCM_TOKEN_URL: TOKEN_URL, FCM_BASE_URL: FCM_URL, PUSH_GRACE_MS: '200', ALERT_FILE: join(dir, 'd.json'), ...ALERT_ENV }, 18873); const B4 = 'http://127.0.0.1:18873';
assert.equal((await J(B4, '/__ping')).o.fcm, true); ok('FCM_SERVICE_ACCOUNT en base64');
const P4 = procs.at(-1); await job(B4, [7101], { sub: { fcm: F3 } }); await sleep(900);
assert.equal(msgsFor(F3).length, 0); assert.match(P4.log(), /FCM : jeton d'accès refusé \(400 invalid_grant\)/); assert.equal((await J(B4, '/__ping')).s, 200); oauth.fail = 0;
ok('jeton d\'accès refusé : journalisé, rien envoyé, serveur intact');
for (const [i, [e, re]] of [
  [{ FCM_SERVICE_ACCOUNT: 'pas du json' }, /FCM_SERVICE_ACCOUNT illisible/],
  [{ FCM_SERVICE_ACCOUNT: JSON.stringify({ ...SA, private_key: undefined }) }, /compte de service incomplet/],
  [{ FCM_SERVICE_ACCOUNT: JSON.stringify({ ...SA, private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' }) }, /private_key illisible/],
  [{ FCM_SERVICE_ACCOUNT_FILE: join(dir, 'absent.json') }, /fichier illisible/],
].entries()) {
  const P = await start({ ...e, VAPID_PUBLIC_KEY: '', ALERT_FILE: join(dir, 'e' + i + '.json') }, 18874); const o = (await J('http://127.0.0.1:18874', '/__ping')).o;
  assert.equal(o.fcm, false); assert.equal(o.alerts, false); assert.match(P.log(), re); assert.match(P.log(), /Notifications de l'appli \(FCM\) désactivées/);
  assert.equal((await job('http://127.0.0.1:18874', [7200 + i], { sub: { fcm: tok('dev') } })).o.push, false);
  await new Promise(res => { P.once('exit', res); P.kill(); });
}
ok('compte de service illisible, incomplet, clé invalide, fichier absent : FCM désactivé avec un message clair, cibles { fcm } ignorées');

console.log('\nFCM OK'); process.exit(0);
