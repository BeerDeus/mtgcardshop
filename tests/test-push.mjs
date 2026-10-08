// Notifications push (Web Push chiffré, VAPID) et import de liens du proxy, avec faux services : aucun accès réseau réel.
import './setup-env.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, createPublicKey, verify as dsaVerify, generateKeyPairSync } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// ── faux CardTrader (marketplace/products)
const upCT = http.createServer((req, res) => { const bp = new URL(req.url, 'http://x').searchParams.get('blueprint_id'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ [bp]: [] })); });
// ── faux service de push (FCM) : garde chaque POST reçu
const pushed = []; let pushStatus = 201;
const upPush = http.createServer((req, res) => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => { pushed.push({ url: req.url, h: req.headers, body: Buffer.concat(c) }); res.writeHead(pushStatus); res.end(); }); });
// ── faux EDHREC / Archidekt / Moxfield
const imp = http.createServer((req, res) => {
  const send = (o, st = 200) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const u = req.url;
  if (u === '/edhrec/pages/average-decks/atraxa-praetors-voice.json') return send({ header: "Average Deck for Atraxa, Praetors' Voice", deck: { commander: ["Atraxa, Praetors' Voice"], commander_v2: [["Atraxa, Praetors' Voice", 1]], cards: { Artifact: [['Sol Ring', 1], ['Arcane Signet', 1]], Land: [['Forest', 4], ['Command Tower', 1]] } } });
  if (u === '/edhrec/pages/average-decks/old-shape.json') return send({ header: 'Average Deck for Old', deck: ['1 Sol Ring', '2 Island', '1 Lightning Greaves'] });
  if (u === '/edhrec/pages/average-decks/atraxa-praetors-voice/budget.json') return send({ header: 'Budget', deck: { cards: { Land: [['Swamp', 3]] } } });
  if (u === '/archidekt/api/decks/123/') return send({ name: 'Mon Archidekt', cards: [
    { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Krenko, Mob Boss' } } },
    { quantity: 1, categories: ['Ramp'], card: { oracleCard: { name: 'Sol Ring' } } },
    { quantity: 3, categories: [], card: { oracleCard: { name: 'Mountain' } } },
    { quantity: 1, categories: ['Maybeboard'], card: { oracleCard: { name: 'Wheel of Fortune' } } },
    { quantity: 1, categories: ['Sideboard'], card: { oracleCard: { name: 'Pyroclasm' } } }] });
  if (u === '/moxfield/v3/decks/all/AbCd_1') return send({ name: 'Mon Moxfield', boards: { commanders: { cards: { x: { quantity: 1, card: { name: 'Edgar Markov' } } } }, mainboard: { cards: { a: { quantity: 1, card: { name: 'Sol Ring' } }, b: { quantity: 2, card: { name: 'Swamp' } } }, } } });
  if (u === '/archidekt/api/decks/404/') return send({ detail: 'Not found' }, 404);
  if (u === '/archidekt/api/decks/500/') return send({ x: 1 }, 503);
  if (u === '/archidekt/api/decks/7/') return send({ name: 'vide', cards: [] });
  if (u === '/archidekt/api/decks/8/') { res.writeHead(302, { Location: 'http://127.0.0.1:1/x' }); return res.end(); }
  if (u === '/archidekt/api/decks/9/') { res.writeHead(200); return res.end('<html>pas du json</html>'); }
  send({ error: 'nf' }, 404);
});
for (const s of [upCT, upPush, imp]) await new Promise(r => s.listen(0, '127.0.0.1', r));
const port = s => s.address().port;

const procs = [], logs = new Map();
const start = (env, p) => new Promise((resolve, reject) => {
  const c = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: String(p), CT_UPSTREAM: `http://127.0.0.1:${port(upCT)}/api/v2`, CARDTRADER_TOKEN: 'tok', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; logs.set(p, () => out);
  c.stdout.on('data', d => { out += d; if (/Mana Orbit →/.test(out)) resolve(c); }); c.stderr.on('data', d => { out += d; });
  c.on('exit', code => { if (code) reject(new Error('exit ' + code + ': ' + out)); });
  procs.push(c);
});
process.on('exit', () => { for (const p of procs) try { p.kill(); } catch {} });
const J = async (B, path, init = {}, headers = {}) => { const r = await fetch(B + path, { ...init, headers: { 'Content-Type': 'application/json', ...headers } }); const t = await r.text(); let o; try { o = JSON.parse(t); } catch { o = t; } return { s: r.status, o, h: r.headers }; };
const post = (B, body) => J(B, '/api/jobs', { method: 'POST', body: JSON.stringify(body) });

// ── clés VAPID (même format que gen-vapid.mjs) et faux navigateur (abonnement)
const vk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
const VPUB = Buffer.concat([Buffer.from([4]), Buffer.from(vk.x, 'base64url'), Buffer.from(vk.y, 'base64url')]).toString('base64url');
const browser = () => { const e = createECDH('prime256v1'); e.generateKeys(); const auth = randomBytes(16); return { e, pub: e.getPublicKey(), auth, sub: { endpoint: `http://127.0.0.1:${port(upPush)}/send/abc123`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }; };
function decrypt(body, br) {                      // RFC 8291 côté navigateur
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], keyid = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65); assert.equal(keyid[0], 4);
  const ikm = Buffer.from(hkdfSync('sha256', br.e.computeSecret(keyid), br.auth, Buffer.concat([Buffer.from('WebPush: info\0'), br.pub, keyid]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  let n = plain.length; while (n > 0 && plain[n - 1] === 0) n--; assert.equal(plain[n - 1], 2, 'délimiteur de dernier enregistrement'); return plain.subarray(0, n - 1);
}
const env = { VAPID_PUBLIC_KEY: VPUB, VAPID_PRIVATE_KEY: vk.d, VAPID_SUBJECT: 'mailto:test@example.com', PUSH_ALLOW_HOSTS: `127.0.0.1:${port(upPush)}`, PUSH_GRACE_MS: '400', IMPORT_UPSTREAM: `http://127.0.0.1:${port(imp)}` };

await start(env, 18840); const B = 'http://127.0.0.1:18840';
let r = await J(B, '/__ping'); assert.equal(r.o.push, VPUB); console.log('✓ ping annonce la clé publique VAPID');
assert.match(r.h.get('permissions-policy'), /camera=\(self\)/); console.log('✓ caméra autorisée pour l\'appli (scan des cartes)');

// 1) recherche quittée → notification chiffrée, déchiffrable, signée VAPID
{
  const br = browser(); pushed.length = 0;
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: [5001, 5002, 5003], push: { sub: br.sub, title: 'Recherche terminée', body: 'Les offres de « Mon deck » sont prêtes.', url: './?resume=1' } });
  assert.equal(r.s, 202); assert.equal(r.o.push, true);
  await sleep(1800);
  assert.equal(pushed.length, 1, 'une notification, personne n\'a relevé la tâche');
  const m = pushed[0]; assert.equal(m.url, '/send/abc123');
  assert.equal(m.h['content-encoding'], 'aes128gcm'); assert.equal(m.h['content-type'], 'application/octet-stream'); assert.ok(Number(m.h.ttl) > 0); assert.equal(m.h.urgency, 'high');
  const msg = JSON.parse(decrypt(m.body, br).toString('utf8'));
  assert.deepEqual(msg, { title: 'Recherche terminée', body: 'Les offres de « Mon deck » sont prêtes.', url: './?resume=1' }); console.log('✓ push reçu, chiffré aes128gcm, contenu intact');
  const a = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(m.h.authorization); assert.ok(a, 'en-tête Authorization vapid'); assert.equal(a[4], VPUB);
  const hd = JSON.parse(Buffer.from(a[1], 'base64url')), cl = JSON.parse(Buffer.from(a[2], 'base64url'));
  assert.deepEqual(hd, { typ: 'JWT', alg: 'ES256' }); assert.equal(cl.aud, `http://127.0.0.1:${port(upPush)}`); assert.equal(cl.sub, 'mailto:test@example.com');
  const now = Math.floor(Date.now() / 1000); assert.ok(cl.exp > now + 3600 && cl.exp <= now + 24 * 3600, 'exp ≤ 24 h');
  const pk = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: vk.x, y: vk.y }, format: 'jwk' });
  assert.ok(dsaVerify('sha256', Buffer.from(a[1] + '.' + a[2]), { key: pk, dsaEncoding: 'ieee-p1363' }, Buffer.from(a[3], 'base64url')), 'signature ES256 valide'); console.log('✓ JWT VAPID : ES256 valide, aud / sub / exp corrects');
  // second avis : décodeur de la bibliothèque de référence (http_ece), si disponible
  const ref = process.env.WEBPUSH_DIR || new URL('../tests/node_modules', import.meta.url).pathname;
  if (existsSync(ref + '/http_ece')) { const ece = createRequire(ref + '/x.js')('http_ece'); const out = ece.decrypt(m.body, { version: 'aes128gcm', privateKey: br.e, authSecret: br.auth.toString('base64url') }); assert.equal(JSON.parse(out.toString()).title, 'Recherche terminée'); console.log('✓ déchiffré aussi par http_ece (bibliothèque de référence)'); }
  else console.log('· http_ece absent : contre-vérification ignorée');
}
// 2) l'appli relève le résultat final → pas de notification
{
  const br = browser(); pushed.length = 0;
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: [6001, 6002], push: { sub: br.sub } }); const id = r.o.id;
  for (let i = 0; i < 40; i++) { const g = await J(B, '/api/jobs/' + id); if (g.o.status !== 'running') break; await sleep(50); }
  await sleep(1200); assert.equal(pushed.length, 0); console.log('✓ appli ouverte (résultat relevé) : aucune notification');
}
// 3) annulation → pas de notification ; rattachement : l'abonnement du second appel est pris en compte
{
  const br = browser(); pushed.length = 0;
  r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: Array.from({ length: 80 }, (_, i) => 7000 + i), push: { sub: br.sub } });
  await J(B, '/api/jobs/' + r.o.id, { method: 'DELETE' }); await sleep(1200); assert.equal(pushed.length, 0); console.log('✓ recherche annulée : aucune notification');
  const b2 = browser(); const ids = Array.from({ length: 6 }, (_, i) => 8000 + i);
  const a = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: ids }); const c = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: ids, push: { sub: b2.sub, body: 'ok' } });
  assert.equal(c.o.attached, true); assert.equal(c.o.id, a.o.id); assert.equal(c.o.push, true);
  await sleep(1800); assert.equal(pushed.length, 1); assert.equal(JSON.parse(decrypt(pushed[0].body, b2).toString()).body, 'ok'); console.log('✓ rattachement à une tâche en cours : l\'abonnement est ajouté');
}
// 4) entrées refusées : la recherche part, sans notification
{
  const br = browser(); const bad = [
    { ...br.sub, endpoint: 'https://evil.example.com/x' }, { ...br.sub, endpoint: 'http://fcm.googleapis.com/x' }, { ...br.sub, endpoint: 'https://fcm.googleapis.com:8443/x' },
    { ...br.sub, endpoint: 'https://user:pw@fcm.googleapis.com/x' }, { ...br.sub, endpoint: 'https://fcm.googleapis.com.evil.com/x' },
    { endpoint: br.sub.endpoint, keys: { p256dh: 'AAAA', auth: br.sub.keys.auth } }, { endpoint: br.sub.endpoint, keys: { p256dh: br.sub.keys.p256dh, auth: 'x' } },
    { endpoint: br.sub.endpoint, keys: { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'), auth: br.sub.keys.auth } },   // point hors courbe
    { endpoint: br.sub.endpoint }, 'texte', null];
  pushed.length = 0;
  for (const [i, sub] of bad.entries()) { r = await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: [9100 + i], push: { sub } }); assert.equal(r.s, 202, 'cas ' + i); assert.equal(r.o.push, false, 'cas ' + i); await sleep(230); }
  await sleep(1200); assert.equal(pushed.length, 0); console.log('✓ endpoints / clés invalides : ignorés (liste blanche d\'hôtes, https, pas de port ni d\'identifiants, point sur la courbe)');
}
// 5) texte borné, URL de retour limitée
{
  const br = browser(); pushed.length = 0;
  await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: [9200], push: { sub: br.sub, title: 'T'.repeat(500), body: 'B\u0000\n'.repeat(300), url: 'https://evil.example.com/' } });
  await sleep(1500); const m = JSON.parse(decrypt(pushed[0].body, br).toString());
  assert.ok(m.title.length <= 80 && m.body.length <= 200 && !/[\u0000-\u001f]/.test(m.body)); assert.equal(m.url, './?resume=1'); console.log('✓ titre / texte bornés, URL externe remplacée par ./?resume=1');
}
// 6) service de push en erreur : le serveur ne plante pas
{
  const br = browser(); pushStatus = 410; pushed.length = 0;
  await post(B, { type: 'offers', lang: 'fr', foil: 'no', bps: [9300], push: { sub: br.sub } }); await sleep(1500);
  assert.equal(pushed.length, 1); assert.match(logs.get(18840)(), /abonnement expiré/); pushStatus = 201;
  r = await J(B, '/__ping'); assert.equal(r.s, 200); console.log('✓ 410 du service de push : journalisé, serveur intact');
}

// ── Sans VAPID : aucune notification, l'appli est prévenue par /__ping
{
  await start({ ...env, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }, 18841); const B2 = 'http://127.0.0.1:18841';
  r = await J(B2, '/__ping'); assert.equal(r.o.push, '');
  const br = browser(); pushed.length = 0; r = await post(B2, { type: 'offers', lang: 'fr', foil: 'no', bps: [9400], push: { sub: br.sub } }); assert.equal(r.s, 202); assert.equal(r.o.push, false);
  await sleep(1200); assert.equal(pushed.length, 0); console.log('✓ sans clés VAPID : push désactivé, recherche normale');
  // clés incohérentes : refus clair au démarrage, serveur utilisable
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
  await start({ ...env, VAPID_PRIVATE_KEY: other.d }, 18842); r = await J('http://127.0.0.1:18842', '/__ping'); assert.equal(r.o.push, ''); await sleep(100);
  assert.match(logs.get(18842)(), /ne correspond pas/); console.log('✓ clé privée qui ne correspond pas à la publique : désactivé avec message');
  await start({ ...env, VAPID_SUBJECT: 'toi' }, 18843); r = await J('http://127.0.0.1:18843', '/__ping'); assert.equal(r.o.push, ''); assert.match(logs.get(18843)(), /VAPID_SUBJECT/); console.log('✓ VAPID_SUBJECT invalide : désactivé avec message');
}

// ── Import de liens
const imp1 = u => J(B, '/api/import?url=' + encodeURIComponent(u));
r = await imp1('https://edhrec.com/average-decks/atraxa-praetors-voice'); assert.equal(r.s, 200); assert.equal(r.o.site, 'EDHREC'); assert.equal(r.o.name, "Atraxa, Praetors' Voice"); assert.equal(r.o.count, 5);
assert.equal(r.o.text, "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n4 Forest\n1 Command Tower"); console.log('✓ import EDHREC (average-decks) : commandant en tête, quantités');
r = await imp1('https://www.edhrec.com/commanders/atraxa-praetors-voice'); assert.equal(r.s, 200); assert.match(r.o.text, /^Commander\n1 Atraxa/); console.log('✓ import EDHREC depuis une page « commanders »');
r = await imp1('https://edhrec.com/average-decks/atraxa-praetors-voice/budget'); assert.equal(r.s, 200); assert.equal(r.o.text, '3 Swamp'); console.log('✓ variante /budget');
r = await imp1('https://edhrec.com/average-decks/old-shape'); assert.equal(r.o.text, '1 Sol Ring\n2 Island\n1 Lightning Greaves'); console.log('✓ ancien format EDHREC (liste de lignes)');
r = await imp1('https://archidekt.com/decks/123/mon-deck'); assert.equal(r.s, 200); assert.equal(r.o.text, 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring\n3 Mountain'); assert.equal(r.o.name, 'Mon Archidekt'); console.log('✓ import Archidekt : commandant, banc et maybeboard exclus');
r = await imp1('https://moxfield.com/decks/AbCd_1'); assert.equal(r.s, 200); assert.equal(r.o.text, 'Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n2 Swamp'); console.log('✓ import Moxfield');
for (const [u, st] of [['https://evil.example.com/decks/1', 400], ['http://edhrec.com/average-decks/x', 400], ['https://edhrec.com.evil.com/average-decks/x', 400], ['https://archidekt.com/decks/abc', 400], ['https://edhrec.com/average-decks/../../etc/passwd', 400], ['https://edhrec.com/average-decks/a/b/c', 400], ['https://user:pw@edhrec.com/average-decks/x', 400], ['https://edhrec.com:8443/average-decks/x', 400], ['pas un lien', 400], ['https://archidekt.com/decks/404/x', 404], ['https://archidekt.com/decks/500/x', 502], ['https://archidekt.com/decks/7/x', 422], ['https://archidekt.com/decks/8/x', 502], ['https://archidekt.com/decks/9/x', 502]]) { r = await imp1(u); assert.equal(r.s, st, u + ' → ' + r.s); assert.ok(r.o.message, u); }
console.log('✓ import : liens hors liste blanche refusés, 404 / 5xx / vide / redirection / réponse illisible gérés');
r = await J(B, '/api/import?url=' + encodeURIComponent('https://edhrec.com/average-decks/x'), { method: 'POST', body: '{}' }); assert.equal(r.s, 405); console.log('✓ import : GET uniquement');
// l'import est ouvert à tous (aucun token CardTrader en jeu), même sur un serveur protégé par une clé
await start({ ...env, APP_KEY: 'secret-secret-123', CARDTRADER_TOKEN: '', BAD_KEY_DELAY_MS: '0' }, 18844); const B3 = 'http://127.0.0.1:18844';
r = await J(B3, '/api/import?url=' + encodeURIComponent('https://archidekt.com/decks/123/x')); assert.equal(r.s, 200); assert.equal(r.o.site, 'Archidekt');
r = await J(B3, '/api/info'); assert.equal(r.s, 401, 'CardTrader reste protégé'); console.log('✓ import : ouvert sans clé ni compte, fonctionne sans token CardTrader ; CardTrader reste protégé');
console.log('\nPUSH + IMPORT OK'); process.exit(0);
