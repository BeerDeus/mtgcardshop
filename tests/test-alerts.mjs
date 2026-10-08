// Alertes de prix du proxy : enregistrement, relevés Scryfall, seuils (baisse en % et en €, prix cible), cooldown, résumé, abonnement expiré,
// persistance, limites (budget par IP, appareils par IP, serveur plein sans éviction d'un abonné, cartes au total, taille de la liste, un relevé par heure).
// Faux Scryfall et faux service de push : aucun accès réseau réel.
import './setup-env.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, generateKeyPairSync } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('✓ ' + m);
// ── faux Scryfall : POST /cards/collection
const price = new Map();                 // nom (minuscules) → « 3.00 » ; absent = inconnu
const scryReqs = []; let scryFail = 0;
const upScry = http.createServer((req, res) => {
  const c = []; req.on('data', x => c.push(x)); req.on('end', () => {
    if (scryFail) { res.writeHead(scryFail); return res.end('{}'); }
    const b = JSON.parse(Buffer.concat(c).toString() || '{}'); scryReqs.push({ url: req.url, h: req.headers, ids: b.identifiers });
    const data = [], nf = [];
    for (const i of b.identifiers || []) {
      const p = price.get(i.name.toLowerCase());
      if (p === undefined) nf.push(i); else data.push({ name: i.name === 'Delver of Secrets' ? 'Delver of Secrets // Insectile Aberration' : i.name, prices: { eur: p } });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ object: 'list', not_found: nf, data }));
  });
});
// ── faux service de push
const pushed = []; let goneStatus = 0;
const upPush = http.createServer((req, res) => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => { pushed.push({ url: req.url, h: req.headers, body: Buffer.concat(c) }); res.writeHead(goneStatus && req.url.endsWith('/devGone') ? goneStatus : 201); res.end(); }); });
for (const s of [upScry, upPush]) await new Promise(r => s.listen(0, '127.0.0.1', r));
const port = s => s.address().port;

const procs = [];
const start = (env, p) => new Promise((resolve, reject) => {
  const c = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: String(p), CARDTRADER_TOKEN: 'tok', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; c.stdout.on('data', d => { out += d; if (/Mana Orbit →/.test(out)) resolve(c); }); c.stderr.on('data', d => { out += d; });
  c.on('exit', code => { if (code) reject(new Error('exit ' + code + ': ' + out)); });
  c.log = () => out; procs.push(c);
});
process.on('exit', () => { for (const p of procs) try { p.kill(); } catch {} });
const J = async (B, path, init = {}, headers = {}) => { const r = await fetch(B + path, { ...init, headers: { 'Content-Type': 'application/json', ...headers } }); const t = await r.text(); let o; try { o = JSON.parse(t); } catch { o = t; } return { s: r.status, o, h: r.headers }; };

const vk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
const VPUB = Buffer.concat([Buffer.from([4]), Buffer.from(vk.x, 'base64url'), Buffer.from(vk.y, 'base64url')]).toString('base64url');
const browser = tag => { const e = createECDH('prime256v1'); e.generateKeys(); const auth = randomBytes(16); return { e, pub: e.getPublicKey(), auth, sub: { endpoint: `http://127.0.0.1:${port(upPush)}/send/${tag}`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }; };
function decrypt(body, br) {
  const salt = body.subarray(0, 16), idlen = body[20], keyid = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ikm = Buffer.from(hkdfSync('sha256', br.e.computeSecret(keyid), br.auth, Buffer.concat([Buffer.from('WebPush: info\0'), br.pub, keyid]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]); let n = plain.length; while (n > 0 && plain[n - 1] === 0) n--; return JSON.parse(plain.subarray(0, n - 1).toString());
}
const dir = mkdtempSync(join(tmpdir(), 'alerts-')), FILE = join(dir, 'alerts.json');
const env = { VAPID_PUBLIC_KEY: VPUB, VAPID_PRIVATE_KEY: vk.d, VAPID_SUBJECT: 'mailto:test@example.com', PUSH_ALLOW_HOSTS: `127.0.0.1:${port(upPush)}`, SCRYFALL_UPSTREAM: `http://127.0.0.1:${port(upScry)}`,
  ALERT_FILE: FILE, ALERT_EVERY_MS: '3600000', ALERT_FIRST_MS: '3600000', ALERT_SEED_MS: '120', ALERT_CHECK_GAP_MS: '0', ALERT_COOLDOWN_MS: '5000', ALERT_HIST_GAP_MS: '0' };
const set = o => { for (const [k, v] of Object.entries(o)) price.set(k.toLowerCase(), v); };
const check = (B, id) => J(B, '/api/alerts/check?id=' + id, { method: 'POST', body: '{}' });
const pushesFor = br => pushed.filter(p => p.url.endsWith(br.sub.endpoint.split('/').pop()));

// 0) sans clés VAPID : alertes indisponibles
await start({ ...env, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }, 18860);
let r = await J('http://127.0.0.1:18860', '/__ping'); assert.equal(r.o.alerts, false);
r = await J('http://127.0.0.1:18860', '/api/alerts', { method: 'PUT', body: '{}' }); assert.equal(r.s, 404); assert.equal(r.o.error, 'alerts_disabled'); ok('sans clés de notification : alertes indisponibles');
procs.pop().kill();

await start(env, 18861); const B = 'http://127.0.0.1:18861';
r = await J(B, '/__ping'); assert.equal(r.o.alerts, true); ok('ping annonce les alertes');
const A = browser('devA');
r = await J(B, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: { endpoint: 'https://evil.example/x', keys: A.sub.keys }, items: [{ k: 'sol ring', n: 'Sol Ring' }] }) });
assert.equal(r.s, 400); assert.equal(r.o.error, 'bad_subscription'); ok('abonnement vers un hôte inconnu refusé');
r = await J(B, '/api/alerts', { method: 'PUT', body: '{pas du json' }); assert.equal(r.s, 400);

// 1) enregistrement + premier relevé
set({ 'Sol Ring': '3.00', 'Arcane Signet': '1.00', 'Delver of Secrets': '2.00', "Commander's Sphere": '2.00', 'Mana Crypt': '100.00' });
const items = [
  { k: 'sol ring', n: 'Sol Ring', d: ['Deck A', 'Deck B'] }, { k: 'arcane signet', n: 'Arcane Signet' }, { k: 'delver of secrets', n: 'Delver of Secrets // Insectile Aberration' },
  { k: 'commanders sphere', n: "Commander's Sphere", t: 150, h: 1 }, { k: 'sol ring', n: 'Sol Ring' }, { k: 'inconnue', n: 'Carte Qui N\'existe Pas' },
];
r = await J(B, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: A.sub, thr: 30, items }) });
assert.equal(r.s, 200); assert.match(r.o.id, /^[a-f0-9]{24}$/); assert.equal(r.o.watching, 5, 'doublon de nom ignoré'); const ID = r.o.id; ok('liste enregistrée (5 cartes, doublon écarté)');
await sleep(700);
assert.equal(scryReqs.length, 1, 'un seul lot pour le premier relevé'); assert.equal(scryReqs[0].ids.length, 5);
assert.deepEqual(scryReqs[0].ids.map(i => i.name).sort(), ["Arcane Signet", "Carte Qui N'existe Pas", "Commander's Sphere", 'Delver of Secrets', 'Sol Ring'], 'nom de face avant « // »');
assert.match(scryReqs[0].h['user-agent'], /DeckDeal/); assert.match(scryReqs[0].h.accept, /json/);
r = await J(B, '/api/alerts?id=' + ID); assert.equal(r.s, 200); assert.equal(r.o.watching, 5); assert.equal(r.o.priced, 4, 'une carte sans prix');
assert.equal(r.o.prices['sol ring'].c, 300); assert.equal(r.o.prices['delver of secrets'].c, 200); assert.equal(pushed.length, 0, 'le relevé de départ ne notifie jamais'); ok('relevé de départ : prix lus, aucune notification');
r = await J(B, '/api/alerts?id=' + 'f'.repeat(24)); assert.equal(r.s, 404); assert.equal(r.o.error, 'not_registered');

// 2) contrôles
r = await check(B, ID); assert.equal(r.s, 200); assert.equal(r.o.ok, true); assert.equal(r.o.last.ok, 4); assert.equal(r.o.last.miss, 1); assert.equal(pushed.length, 0, 'prix stables : rien'); ok('contrôle sans changement : rien envoyé');
set({ 'Sol Ring': '1.80', 'Arcane Signet': '0.70' });                      // −40 % / −30 % mais seulement 0,30 €
r = await check(B, ID); assert.equal(r.o.ok, true);
let ps = pushesFor(A); assert.equal(ps.length, 1, 'Sol Ring seulement (Arcane Signet : chute trop petite en euros)');
let m = decrypt(ps[0].body, A); assert.equal(m.title, 'Sol Ring : −40 %'); assert.match(m.body, /3,00 € → 1,80 €/); assert.match(m.body, /manque à Deck A/); assert.equal(m.url, './?alerts=1'); assert.equal(m.kind, 'alert');
assert.equal(ps[0].h.topic, 'deckdeal-alert'); assert.match(ps[0].h.authorization, /^vapid t=/); assert.equal(ps[0].h.ttl, '43200'); ok('chute de 40 % : notification chiffrée, texte, lien, sujet dédié');
r = await J(B, '/api/alerts?id=' + ID); assert.equal(r.o.hits.length, 1); assert.equal(r.o.hits[0].to, 180); assert.equal(r.o.hits[0].pct, 40); assert.equal(r.o.prices['sol ring'].b, 300);
r = await check(B, ID); assert.equal(pushesFor(A).length, 1, 'même prix : pas de deuxième alerte (cooldown)'); ok('carte déjà signalée : pas de répétition');
set({ 'Sol Ring': '1.65' }); await check(B, ID); assert.equal(pushesFor(A).length, 1, 'encore −8 % seulement sous le prix signalé : toujours en cooldown'); ok('cooldown : pas de nouvelle alerte pour une petite rechute');
// 3) prix cible
set({ "Commander's Sphere": '1.40' }); await check(B, ID);
ps = pushesFor(A); assert.equal(ps.length, 2); m = decrypt(ps[1].body, A); assert.equal(m.title, "Commander's Sphere à 1,40 €"); assert.match(m.body, /Sous ton prix cible de 1,50 €/);
await check(B, ID); assert.equal(pushesFor(A).length, 2, 'cible : une seule alerte tant que le prix reste dessous');
set({ "Commander's Sphere": '2.00' }); await check(B, ID); set({ "Commander's Sphere": '1.20' }); await check(B, ID);
assert.equal(pushesFor(A).length, 3, 'ré-armée quand le prix est remonté au-dessus de la cible'); ok('prix cible : une alerte, ré-armée après remontée');
// 4) plusieurs cartes en un message
r = await J(B, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: A.sub, thr: 30, items: [...items, { k: 'mana crypt', n: 'Mana Crypt' }] }) }); assert.equal(r.o.watching, 6);
await sleep(500); set({ 'Delver of Secrets': '1.00', 'Mana Crypt': '60.00' });
await check(B, ID);
ps = pushesFor(A); m = decrypt(ps[ps.length - 1].body, A); assert.equal(m.title, '2 cartes en baisse', JSON.stringify(m)); assert.match(m.body, /Delver of Secrets \/\/ Insectile Aberration −50 %, Mana Crypt −40 %/, m.body); ok('plusieurs cartes : un seul message récapitulatif');

// 5) abonnement expiré
const Bx = browser('devGone');
r = await J(B, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: Bx.sub, thr: 30, items: [{ k: 'sol ring', n: 'Sol Ring' }, { k: 'mana crypt', n: 'Mana Crypt' }] }) }); const IDX = r.o.id; assert.notEqual(IDX, ID);
await sleep(300); set({ 'Mana Crypt': '30.00' }); goneStatus = 410; const pA = pushesFor(A).length; await check(B, IDX); goneStatus = 0;
assert.equal(pushesFor(A).length, pA, 'contrôle d\'un appareil : les autres ne sont pas notifiés');
assert.equal((await J(B, '/api/alerts?id=' + ID)).s, 200, 'les autres appareils ne sont pas touchés');
r = await J(B, '/api/alerts?id=' + IDX); assert.equal(r.s, 404, 'abonnement refusé (410) : retiré'); ok('abonnement expiré (410) retiré');

// 6) persistance au redémarrage
await sleep(1800); assert.ok(existsSync(FILE), 'fichier écrit'); const saved = JSON.parse(readFileSync(FILE, 'utf8')); assert.ok(saved.subs.some(s => s.id === ID)); assert.ok(!saved.subs.some(s => s.id === IDX));
procs.pop().kill(); await sleep(300);
await start(env, 18862); const B2 = 'http://127.0.0.1:18862';
r = await J(B2, '/api/alerts?id=' + ID); assert.equal(r.s, 200); assert.equal(r.o.watching, 6); assert.ok(r.o.priced >= 4); assert.ok(r.o.hits.length >= 3, 'alertes passées gardées'); ok('redémarrage : abonnements, relevés et alertes retrouvés');

// 7) limites
const many = Array.from({ length: 450 }, (_, i) => ({ k: 'carte ' + i, n: 'Carte Numero ' + i }));
for (let i = 0; i < 450; i++) price.set('carte numero ' + i, '1.00');
const C = browser('devC'); scryReqs.length = 0;
r = await J(B2, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: C.sub, items: many }) }); assert.equal(r.o.watching, 400, '400 cartes au plus');
await sleep(1500); assert.deepEqual(scryReqs.map(x => x.ids.length), [75, 75, 75, 75, 75, 26], 'lots de 75 noms (400 cartes + la carte inconnue de l\'autre appareil, redemandée tant qu\'elle n\'a pas de prix)'); ok('400 cartes au plus, relevés par lots de 75');
r = await J(B2, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: C.sub, items: [] }) }); assert.equal(r.o.watching, 0); r = await J(B2, '/api/alerts?id=' + r.o.id); assert.equal(r.s, 404, 'liste vide : désinscrit'); ok('liste vide = désinscription');

// 8) Scryfall en panne
const D = browser('devD'); r = await J(B2, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: D.sub, items: [{ k: 'sol ring', n: 'Sol Ring' }] }) }); const IDD = r.o.id; await sleep(400);
scryFail = 500; r = await check(B2, IDD); assert.equal(r.s, 200); assert.equal(r.o.ok, false); assert.match(r.o.error, /Scryfall/); scryFail = 0;
r = await check(B2, IDD); assert.equal(r.o.ok, true); ok('Scryfall en panne : erreur signalée, reprise au contrôle suivant');
r = await J(B2, '/api/alerts?id=' + IDD, { method: 'DELETE' }); assert.equal(r.o.removed, true); r = await J(B2, '/api/alerts?id=' + IDD); assert.equal(r.s, 404); ok('désactivation : abonnement supprimé');

// 9) accès : ouvert à tous (les alertes n'utilisent que Scryfall et le push), même sur un serveur protégé par une clé
await start({ ...env, APP_KEY: 'secret-secret-1234', ALERT_FILE: join(dir, 'k.json') }, 18863); const B3 = 'http://127.0.0.1:18863';
r = await J(B3, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: A.sub, items: [{ k: 'sol ring', n: 'Sol Ring' }] }) }); assert.equal(r.s, 200, 'sans clé : accepté');
r = await J(B3, '/api/info'); assert.equal(r.s, 401, 'CardTrader reste protégé'); ok('alertes ouvertes à tous ; CardTrader reste protégé');


// 10) limites d'une route publique : budget par IP, appareils par IP, serveur plein (jamais d'abonné évincé), taille de la liste
{
  const now = Date.now(), FK = join(dir, 'full.json'), sub = tag => browser(tag).sub;
  const rec = (id, at, items, extra = {}) => ({ id: id.repeat(24), sub: sub('old' + id), thr: 30, at, items: items.map(n => ({ k: n.toLowerCase(), n, nk: n.toLowerCase() })), hits: [], ...extra });
  writeFileSync(FK, JSON.stringify({ v: 1, last: { at: 0 }, px: { 'sol ring': [[now - 7200e3, 300]] }, subs: [
    rec('a', now - 7200e3, ['Zzz Carte Bidon']),                                      // inactif : aucune carte au prix connu, enregistré il y a 2 h → seul évinçable
    rec('b', now - 7200e3, ['Sol Ring']),                                             // abonné : carte au prix connu
    rec('c', now - 40 * 86400e3, ['Zzz Autre Bidon'], { pushed: now - 39 * 86400e3 }),  // ancien, mais une notification a déjà abouti
  ] }));
  await start({ ...env, ALERT_FILE: FK, ALERT_MAX_SUBS: '6', ALERT_MAX_PER_IP: '2', ALERT_RATE_PER_H: '6' }, 18864); const BL = 'http://127.0.0.1:18864';
  const put = (s, ip, its = [{ k: 'arcane signet', n: 'Arcane Signet' }]) => J(BL, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: s, items: its }) }, ip ? { 'x-forwarded-for': ip } : {});
  r = await put(sub('U1'), '1.1.1.1'); assert.equal(r.s, 200); const U1 = r.o.id;
  r = await put(sub('X1'), '9.9.9.9'); assert.equal(r.s, 200); r = await put(sub('X2'), '9.9.9.9'); assert.equal(r.s, 200);
  r = await put(sub('X3'), '9.9.9.9'); assert.equal(r.s, 429); assert.equal(r.o.error, 'too_many_devices'); ok('10 appareils par IP au plus (ici 2) : le suivant est refusé');
  r = await put(sub('X1'), '9.9.9.9', [{ k: 'sol ring', n: 'Sol Ring' }]); assert.equal(r.s, 200, 'appareil déjà enregistré : mise à jour permise');
  r = await put(sub('Y1'), '8.8.8.8'); assert.equal(r.s, 200, 'serveur plein (6) : l\'enregistrement inactif laisse sa place');
  assert.equal((await J(BL, '/api/alerts?id=' + 'a'.repeat(24))).s, 404, 'inactif évincé');
  r = await put(sub('Y2'), '8.8.8.8'); assert.equal(r.s, 507); assert.equal(r.o.error, 'alerts_full'); assert.ok(r.h.get('retry-after'));
  for (const id of ['b'.repeat(24), 'c'.repeat(24), U1]) assert.equal((await J(BL, '/api/alerts?id=' + id)).s, 200, 'abonné jamais évincé : ' + id);
  ok('serveur plein : nouvel appareil refusé (507), aucun abonné évincé ; seul un enregistrement sans prix ni notification laisse sa place');
  // budget : 6 enregistrements par heure et par IP (9.9.9.9 en a utilisé 4)
  for (let i = 0; i < 2; i++) assert.equal((await J(BL, '/api/alerts', { method: 'PUT', body: '{}' }, { 'x-forwarded-for': '9.9.9.9' })).s, 400);
  r = await put(sub('X1'), '9.9.9.9'); assert.equal(r.s, 429); assert.equal(r.o.error, 'rate_limited'); assert.ok(Number(r.h.get('retry-after')) > 0);
  assert.equal((await put(sub('U1'), '1.1.1.1')).s, 200, 'autre IP servie'); ok('enregistrements limités par IP et par heure (429 + Retry-After)');
  // contrôles à la demande : même budget, par appareil seulement
  for (let i = 0; i < 6; i++) { r = await J(BL, '/api/alerts/check?id=' + U1, { method: 'POST', body: '{}' }, { 'x-forwarded-for': '5.5.5.5' }); assert.equal(r.s, 200); assert.equal(r.o.last.ok, 1, 'les cartes de cet appareil seulement'); }
  r = await J(BL, '/api/alerts/check?id=' + U1, { method: 'POST', body: '{}' }, { 'x-forwarded-for': '5.5.5.5' }); assert.equal(r.s, 429); ok('contrôles à la demande limités par IP ; chacun ne relève que les cartes de l\'appareil');
  // liste de plus de 64 Ko : refusée sans être lue jusqu'au bout
  const huge = Array.from({ length: 400 }, (_, i) => ({ k: 'carte ' + i, n: 'Carte Numero ' + i + ' ' + 'x'.repeat(120), d: ['Deck ' + 'y'.repeat(35)] }));
  r = await put(sub('Z1'), '7.7.7.7', huge); assert.equal(r.s, 413); assert.equal(r.o.error, 'too_large'); ok('liste de plus de 64 Ko : 413');
}
// 11) cartes au total plafonnées (ALERT_MAX_CARDS) : un nouveau venu est refusé, une liste existante n'est pas perdue
{
  await start({ ...env, ALERT_FILE: join(dir, 'cards.json'), ALERT_MAX_CARDS: '5' }, 18866); const BC = 'http://127.0.0.1:18866';
  const its = n => Array.from({ length: n }, (_, i) => ({ k: 'c' + i, n: 'Carte ' + i }));
  const S1 = browser('cards1').sub, S2 = browser('cards2').sub;
  r = await J(BC, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: S1, items: its(3) }) }); assert.equal(r.s, 200); const C1 = r.o.id;
  r = await J(BC, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: S2, items: its(3) }) }); assert.equal(r.s, 507); assert.equal(r.o.error, 'alerts_full');
  r = await J(BC, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: S1, items: its(5) }) }); assert.equal(r.s, 200, 'sa propre liste ne compte pas deux fois');
  r = await J(BC, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: S1, items: its(6) }) }); assert.equal(r.s, 507);
  r = await J(BC, '/api/alerts?id=' + C1); assert.equal(r.o.watching, 5, 'liste précédente gardée'); ok('cartes au total plafonnées : refus (507) sans rien perdre');
}
// 12) un relevé par carte et par heure au plus (réglage par défaut) : les contrôles répétés remplacent le dernier, la médiane de référence ne raccourcit pas
{
  await start({ ...env, ALERT_FILE: join(dir, 'hour.json'), ALERT_HIST_GAP_MS: '3600000', ALERT_CHECK_GAP_MS: '90000' }, 18865); const BH = 'http://127.0.0.1:18865';
  set({ 'Sol Ring': '3.00' }); const H1 = browser('hour1'), H2 = browser('hour2'), its = [{ k: 'sol ring', n: 'Sol Ring' }];
  const idH1 = (await J(BH, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: H1.sub, items: its }) })).o.id, idH2 = (await J(BH, '/api/alerts', { method: 'PUT', body: JSON.stringify({ sub: H2.sub, items: its }) })).o.id;
  await sleep(500); r = await check(BH, idH1); assert.equal(r.o.ok, true); assert.equal(r.o.skipped, undefined);
  r = await check(BH, idH1); assert.equal(r.o.skipped, true, 'second contrôle du même appareil dans les 90 s : ignoré'); assert.ok(r.o.retry > 80);
  set({ 'Sol Ring': '1.00' }); const n0 = pushed.length;
  r = await check(BH, idH2); assert.equal(r.o.ok, true, 'un autre appareil a son propre délai');
  r = await J(BH, '/api/alerts?id=' + idH1); assert.deepEqual(r.o.prices['sol ring'], { c: 100, b: 0 }, 'un seul relevé dans l\'heure : remplacé par le prix du jour, pas de référence raccourcie');
  assert.equal(pushed.length, n0, 'pas d\'alerte sur des relevés de la même heure'); ok('un relevé par carte et par heure : les contrôles répétés le remplacent');
}

console.log('ALERTS OK'); process.exit(0);
