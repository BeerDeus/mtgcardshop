import './setup-env.mjs';
import http from 'node:http';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
import { generateKeyPairSync, sign as rsaSign, createSign } from 'node:crypto';

const seen = []; let active = 0, maxActive = 0, slowInfo = false;
const up = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    seen.push({ m: req.method, u: req.url, auth: req.headers.authorization, body: b });
    if (req.url.startsWith('/api/v2/info') && slowInfo) { active++; maxActive = Math.max(maxActive, active); return setTimeout(() => { active--; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":1}'); }, 120); }
    if (req.url.startsWith('/api/v2/marketplace/products')) { res.writeHead(429, { 'Retry-After': '3', 'Content-Type': 'application/json' }); return res.end('{"error":"slow"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: 1, path: req.url }));
  });
});
await new Promise(r => up.listen(0, '127.0.0.1', r));
const upPort = up.address().port;

const start = (env, port) => new Promise((resolve, reject) => {
  const p = spawn('node', ['proxy.mjs'], { env: { ...process.env, PORT: String(port), CT_UPSTREAM: `http://127.0.0.1:${upPort}/api/v2`, EDH_SOURCE_URL: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; if (/Mana Orbit →/.test(out)) resolve(p); });
  p.stderr.on('data', d => { out += d; });
  p.on('exit', code => { if (code) reject(new Error('exit ' + code + ': ' + out)); });
});

const j = async (url, init) => { const r = await fetch(url, init); const t = await r.text(); let o; try { o = JSON.parse(t); } catch { o = t; } return { s: r.status, o, h: r.headers }; };

// 1) sans clé
let p = await start({ CARDTRADER_TOKEN: 'tok123' }, 18787);
let B = 'http://127.0.0.1:18787';
let r = await j(B + '/__ping'); assert.deepEqual(r.o, { ok: true, app: 'deckdeal', userToken: true, prices: false, needsKey: false, needsLogin: false, hasToken: true, jobs: true, alerts: false, push: '' }); console.log('✓ ping');
r = await j(B + '/'); assert.equal(r.s, 200); assert.match(r.o, /<title>Mana Orbit<\/title>/); console.log('✓ page servie');
r = await j(B + '/api/cart/purchase', { method: 'POST', body: '{}' }); assert.equal(r.s, 403); console.log('✓ cart/purchase bloqué (POST)');
r = await j(B + '/api/cart/purchase'); assert.equal(r.s, 403); console.log('✓ cart/purchase bloqué (GET)');
r = await j(B + '/api/cart/purchase/', { method: 'POST' }); assert.equal(r.s, 403); console.log('✓ cart/purchase/ bloqué (slash final)');
r = await j(B + '/api/cart/../cart/purchase', { method: 'POST' }); assert.notEqual(r.s, 200); console.log('✓ traversal neutralisé:', r.s);
r = await j(B + '/api/products/12', { method: 'DELETE' }); assert.equal(r.s, 405); console.log('✓ DELETE refusé');
r = await j(B + '/api/orders'); assert.equal(r.s, 403); console.log('✓ route inconnue bloquée');
seen.length = 0;
r = await j(B + '/api/expansions'); assert.equal(r.s, 200); assert.equal(seen[0].auth, 'Bearer tok123'); console.log('✓ expansions relayé avec Bearer');
r = await j(B + '/api/expansions'); assert.equal(seen.filter(x => x.u.includes('expansions')).length, 1); assert.equal(r.h.get('x-cache'), 'HIT'); console.log('✓ expansions en cache');
r = await j(B + '/api/blueprints/export?expansion_id=7'); assert.equal(seen.at(-1).u, '/api/v2/blueprints/export?expansion_id=7'); console.log('✓ query string conservée');
r = await j(B + '/api/marketplace/products?blueprint_id=1&language=fr'); assert.equal(r.s, 429); assert.equal(r.h.get('retry-after'), '3'); console.log('✓ 429 + Retry-After relayés');
r = await j(B + '/api/cart/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"product_id":5,"quantity":1}' });
assert.equal(r.s, 200); assert.equal(seen.at(-1).body, '{"product_id":5,"quantity":1}'); assert.equal(seen.at(-1).m, 'POST'); console.log('✓ cart/add POST relayé');
r = await j(B + '/'); for (const h of ['x-content-type-options', 'x-frame-options', 'referrer-policy']) assert.ok(r.h.get(h), h + ' présent sur la page');
r = await j(B + '/__ping'); assert.equal(r.h.get('x-content-type-options'), 'nosniff');
r = await j(B + '/api/expansions'); assert.equal(r.h.get('x-frame-options'), 'DENY'); console.log('✓ en-têtes de sécurité (page, json, relais)');

// PWA : fichiers statiques servis en correspondance exacte (liste blanche), types corrects, jamais de traversée
const raw = (port, line) => new Promise(res => { const c = net.connect(port, '127.0.0.1', () => c.write(line + ' HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')); let d = ''; c.on('data', x => d += x); c.on('close', () => res(d)); });
r = await j(B + '/manifest.webmanifest'); assert.equal(r.s, 200); assert.match(r.h.get('content-type'), /^application\/manifest\+json/); assert.equal(r.o.name, 'Mana Orbit'); assert.equal(r.h.get('cache-control'), 'no-cache'); console.log('✓ manifest servi (application/manifest+json)');
{ const m = r.o; assert.equal(m.display, 'standalone'); assert.equal(m.start_url, './'); assert.equal(m.scope, './'); assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) { const x = await fetch(B + '/' + i.src); assert.equal(x.status, 200, i.src); assert.equal(x.headers.get('content-type').split(';')[0], i.type, i.src); if (i.type === 'image/png') { const b = Buffer.from(await x.arrayBuffer()); assert.equal(b.subarray(1, 4).toString(), 'PNG'); const [w, h] = i.sizes.split('x').map(Number); assert.equal(b.readUInt32BE(16), w, i.src + ' largeur'); assert.equal(b.readUInt32BE(20), h, i.src + ' hauteur'); } }
  console.log('✓ icônes du manifeste : présentes, bon type, bonnes dimensions'); }
r = await j(B + '/sw.js'); assert.equal(r.s, 200); assert.match(r.h.get('content-type'), /^text\/javascript/); assert.equal(r.h.get('cache-control'), 'no-cache'); assert.match(r.o, /addEventListener\('fetch'/); assert.equal(r.h.get('x-frame-options'), 'DENY'); console.log('✓ sw.js servi (text/javascript, no-cache, en-têtes de sécurité)');
r = await j(B + '/icons/apple-touch-icon.png'); assert.equal(r.s, 200); assert.match(r.h.get('cache-control'), /max-age/); console.log('✓ icônes mises en cache navigateur');
{ // catalogue des noms français : absent → 404 propre ; présent → texte, gzip si accepté, mis en cache navigateur
  const { writeFileSync, rmSync, existsSync } = await import('node:fs'), f = join(process.env.PWA_DIR, 'fr-names.tsv'); assert.ok(!existsSync(f), 'pwa/fr-names.tsv est généré par GitHub Actions, pas versionné ici');
  r = await j(B + '/fr-names.tsv'); assert.equal(r.s, 404); assert.equal(r.o.error, 'asset_missing');
  const body = Array.from({ length: 800 }, (_, i) => `Nom ${i}\tName ${i}\tfront/a/b/${i}.jpg`).join('\n') + '\n';
  writeFileSync(f, body);
  try {
    const g = await fetch(B + '/fr-names.tsv'); assert.equal(g.status, 200); assert.match(g.headers.get('content-type'), /^text\/tab-separated-values; charset=utf-8/); assert.equal(g.headers.get('content-encoding'), 'gzip'); assert.match(g.headers.get('cache-control'), /max-age=86400/); assert.match(g.headers.get('vary'), /Accept-Encoding/); assert.equal(await g.text(), body, 'gzip décompressé = fichier');
    const raw = await new Promise((res, rej) => http.get(B + '/fr-names.tsv', { headers: { 'Accept-Encoding': 'identity' } }, x => { const c = []; x.on('data', d => c.push(d)); x.on('end', () => res({ h: x.headers, b: Buffer.concat(c).toString() })); }).on('error', rej));
    assert.equal(raw.h['content-encoding'], undefined); assert.equal(raw.b, body); assert.equal(Number(raw.h['content-length']), Buffer.byteLength(body));
    const zh = await fetch(B + '/fr-names.tsv', { headers: { 'Accept-Encoding': 'gzip' } }); assert.ok(Number(zh.headers.get('content-length')) < body.length / 3, 'compressé : bien plus petit');
    const h = await fetch(B + '/fr-names.tsv', { method: 'HEAD' }); assert.equal(h.status, 200); assert.equal((await h.text()).length, 0);
  } finally { rmSync(f, { force: true }); }
  console.log('✓ /fr-names.tsv : 404 propre si absent, sinon texte compressé en gzip (ou brut), cache 24 h, HEAD sans corps');
}
{ // commandants EDHREC : même mécanique (404 propre, gzip, cache 24 h)
  const { writeFileSync, rmSync, existsSync } = await import('node:fs'), f = join(process.env.PWA_DIR, 'edh.tsv'); assert.ok(!existsSync(f), 'pwa/edh.tsv est généré par GitHub Actions, pas versionné ici');
  r = await j(B + '/edh.tsv'); assert.equal(r.s, 404); assert.equal(r.o.error, 'asset_missing');
  const body = '#edh\t1\t2026-10-05T00:00:00Z\n' + Array.from({ length: 400 }, (_, i) => `C\tslug-${i}\t${i}\tWU\tCommander ${i}`).join('\n') + '\n';
  writeFileSync(f, body);
  try {
    const g = await fetch(B + '/edh.tsv'); assert.equal(g.status, 200); assert.match(g.headers.get('content-type'), /^text\/tab-separated-values; charset=utf-8/); assert.equal(g.headers.get('content-encoding'), 'gzip'); assert.match(g.headers.get('cache-control'), /max-age=86400/); assert.equal(await g.text(), body);
  } finally { rmSync(f, { force: true }); }
  console.log('✓ /edh.tsv : 404 propre si absent, sinon texte compressé en gzip, cache 24 h');
}
{ // même données en binaire (EDH2), déjà compressé par le générateur : envoyé tel quel (Content-Encoding: gzip) ou décompressé pour un client sans gzip
  const { writeFileSync, rmSync, existsSync } = await import('node:fs'), { gzipSync } = await import('node:zlib'), http = await import('node:http'), f = join(process.env.PWA_DIR, 'edh.bin.gz'); assert.ok(!existsSync(f), 'pwa/edh.bin.gz est généré par GitHub Actions, pas versionné ici');
  r = await j(B + '/edh.bin.gz'); assert.equal(r.s, 404); assert.equal(r.o.error, 'asset_missing');
  const raw = Buffer.from('EDH2' + 'x'.repeat(5000)), gz = gzipSync(raw);
  writeFileSync(f, gz);
  try {
    const g = await fetch(B + '/edh.bin.gz'); assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'application/octet-stream'); assert.equal(g.headers.get('content-encoding'), 'gzip'); assert.match(g.headers.get('cache-control'), /max-age=86400/); assert.equal(Number(g.headers.get('content-length')), gz.length, 'envoyé tel quel, sans recompression'); assert.ok(Buffer.from(await g.arrayBuffer()).equals(raw), 'le navigateur obtient le binaire décompressé');
    const idn = await new Promise((res, rej) => http.get(B + '/edh.bin.gz', { headers: { 'Accept-Encoding': 'identity' } }, x => { const c = []; x.on('data', d => c.push(d)); x.on('end', () => res({ h: x.headers, b: Buffer.concat(c) })); }).on('error', rej));
    assert.equal(idn.h['content-encoding'], undefined); assert.ok(idn.b.equals(raw), 'client sans gzip : décompressé par le serveur');
    const h = await fetch(B + '/edh.bin.gz', { method: 'HEAD' }); assert.equal(h.status, 200); assert.equal((await h.text()).length, 0);
  } finally { rmSync(f, { force: true }); }
  console.log('✓ /edh.bin.gz : 404 propre si absent, sinon envoyé tel quel en gzip (ou décompressé pour un client sans gzip), cache 24 h, HEAD sans corps');
}
{ const h = await fetch(B + '/sw.js', { method: 'HEAD' }); assert.equal(h.status, 200); assert.equal((await h.text()).length, 0); console.log('✓ HEAD sans corps'); }
for (const path of ['/icons/../proxy.mjs', '/icons/..%2fproxy.mjs', '/icons/%2e%2e/proxy.mjs', '/public/sw.js', '/pwa/sw.js', '/pwa/manifest.webmanifest', '/pwa/icons/icon.svg', '/public/../proxy.mjs', '/icons/', '/icons', '/icons/unknown.png', '/../proxy.mjs', '/sw.js%00.png', '/manifest.webmanifest/x', '/start.cjs', '/package.json', '/proxy.mjs', '/test.mjs']) {
  const t = await raw(18787, 'GET ' + path); const st = Number((t.match(/^HTTP\/1\.1 (\d+)/) || [])[1]);
  assert.ok(st === 404 || st === 400, path + ' → ' + st); assert.ok(!/createServer|CARDTRADER_TOKEN|"scripts"/.test(t), path + ' ne doit rien divulguer');
}
console.log('✓ traversée / fichiers du dépôt : tous refusés');
for (const path of ['//', '///', '//evil.example/x', '//api/info/..%2f']) { const t = await raw(18787, 'GET ' + path); const st = Number((t.match(/^HTTP\/1\.1 (\d+)/) || [])[1]); assert.ok([200, 400, 403, 404].includes(st), path + ' → ' + st + ' (jamais 500)'); }
console.log('✓ chemins à double slash : jamais de 500');
r = await j(B + '/sw.js', { method: 'POST', body: '{}' }); assert.equal(r.s, 404); r = await j(B + '/manifest.webmanifest', { method: 'DELETE' }); assert.equal(r.s, 404); console.log('✓ statiques en GET/HEAD seulement');
p.kill();

// ── Accès par compte Firebase (jetons RS256 signés par une clé de test, JWKS local) ──
{
  const kp = generateKeyPairSync('rsa', { modulusLength: 2048 }), kp2 = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwkOf = (k, kid) => ({ ...k.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
  let keys = [jwkOf(kp, 'k1')], jwksHits = 0, jwksDown = false;
  const jw = http.createServer((q, r) => { jwksHits++; if (jwksDown) { r.writeHead(500); return r.end(); } r.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }); r.end(JSON.stringify({ keys })); });
  await new Promise(r => jw.listen(0, '127.0.0.1', r));
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = () => Math.floor(Date.now() / 1000);
  const mkTok = (over = {}, { key = kp.privateKey, kid = 'k1', alg = 'RS256', tamper = false } = {}) => {
    const n = now(); const pl = { iss: 'https://securetoken.google.com/m2s-mtg', aud: 'm2s-mtg', auth_time: n, sub: 'uid-beer', user_id: 'uid-beer', iat: n, exp: n + 3600, email: 'beer@example.com', email_verified: true, ...over };
    const head = b64({ alg, typ: 'JWT', kid }); const body = b64(pl); const data = head + '.' + body;
    let sig = alg === 'RS256' ? rsaSign('RSA-SHA256', Buffer.from(data), key).toString('base64url') : 'x';
    if (alg === 'none') sig = '';
    return tamper ? head + '.' + b64({ ...pl, sub: 'uid-evil' }) + '.' + sig : data + '.' + sig;
  };
  const P = 18795, BA = 'http://127.0.0.1:' + P;
  const pa = await start({ CARDTRADER_TOKEN: 'tok123', ALLOWED_UIDS: 'uid-beer, uid-other', ALLOWED_EMAILS: 'mail@example.com', FIREBASE_JWKS_URL: `http://127.0.0.1:${jw.address().port}/jwks`, BAD_KEY_DELAY_MS: '5' }, P);
  const hdr = t => ({ headers: { 'x-firebase-token': t } });
  r = await j(BA + '/__ping'); assert.equal(r.o.needsLogin, true); assert.equal(r.o.needsKey, false); console.log('✓ ping annonce needsLogin');
  r = await j(BA + '/api/info'); assert.equal(r.s, 401); assert.equal(r.o.error, 'auth_required'); assert.equal(r.o.login, true); console.log('✓ sans identifiant → 401 auth_required');
  r = await j(BA + '/api/info', hdr(mkTok())); assert.equal(r.s, 200); console.log('✓ jeton valide + UID autorisé → 200');
  assert.ok(jwksHits >= 1); const hits0 = jwksHits;
  await j(BA + '/api/info', hdr(mkTok())); assert.equal(jwksHits, hits0, 'clés Google mises en cache'); console.log('✓ clés mises en cache (1 seule requête JWKS)');
  r = await j(BA + '/api/info', hdr(mkTok({ sub: 'uid-intrus', user_id: 'uid-intrus' }))); assert.equal(r.s, 403); assert.equal(r.o.error, 'forbidden'); console.log('✓ jeton valide mais UID non autorisé → 403 forbidden');
  r = await j(BA + '/api/info', hdr(mkTok({ sub: 'x1', email: 'mail@example.com', email_verified: true }))); assert.equal(r.s, 200); console.log('✓ email autorisé ET vérifié → 200');
  r = await j(BA + '/api/info', hdr(mkTok({ sub: 'x2', email: 'mail@example.com', email_verified: false }))); assert.equal(r.s, 403); console.log('✓ email autorisé mais NON vérifié → 403');
  r = await j(BA + '/api/info', hdr(mkTok({ sub: 'x3', email: 'MAIL@Example.com', email_verified: true }))); assert.equal(r.s, 200); console.log('✓ email insensible à la casse');
  r = await j(BA + '/api/info', hdr(mkTok({ exp: now() - 5, iat: now() - 3700 }))); assert.equal(r.s, 401); assert.equal(r.o.error, 'token_expired'); console.log('✓ jeton expiré → 401 token_expired');
  const bad = { 'mauvais projet (aud)': mkTok({ aud: 'autre-projet' }), 'mauvais émetteur': mkTok({ iss: 'https://securetoken.google.com/autre' }), 'alg none': mkTok({}, { alg: 'none' }), 'alg HS256': mkTok({}, { alg: 'HS256' }),
    'charge modifiée (signature invalide)': mkTok({}, { tamper: true }), 'signée par une autre clé': mkTok({}, { key: kp2.privateKey }), 'kid inconnu': mkTok({}, { kid: 'zzz' }), 'iat dans le futur': mkTok({ iat: now() + 3600, exp: now() + 7200 }),
    'sans sub': mkTok({ sub: '' }), 'n\'importe quoi': 'abc.def.ghi', 'vide de sens': 'x' };
  for (const [name, t] of Object.entries(bad)) { r = await j(BA + '/api/info', hdr(t)); assert.equal(r.s, 401, name + ' → ' + r.s); assert.equal(r.o.error, 'bad_token', name); }
  console.log('✓ ' + Object.keys(bad).length + ' jetons falsifiés ou invalides refusés (aud, iss, none, HS256, charge modifiée, autre clé, kid, iat, sub, junk)');
  r = await j(BA + '/api/info', { headers: { 'x-firebase-token': mkTok(), 'x-app-key': 'nimportequoi' } }); assert.equal(r.s, 200); console.log('✓ APP_KEY non configurée : ignorée, le jeton suffit');
  r = await j(BA + '/api/cart/purchase', { method: 'POST', ...hdr(mkTok()) }); assert.equal(r.s, 403); console.log('✓ achat toujours bloqué, même authentifié');
  // token CardTrader de l'utilisateur : pas besoin d'être autorisé, la requête part avec SON token (jamais celui du serveur)
  const UT = 'utilisateur-token-abcdef123456';
  seen.length = 0; r = await j(BA + '/api/info', { headers: { 'x-ct-token': UT } }); assert.equal(r.s, 200); assert.equal(seen.at(-1).auth, 'Bearer ' + UT);
  r = await j(BA + '/api/cart/add', { method: 'POST', headers: { 'x-ct-token': UT, 'content-type': 'application/json' }, body: '{"product_id":1,"quantity":1}' }); assert.equal(r.s, 200); assert.equal(seen.at(-1).auth, 'Bearer ' + UT);
  r = await j(BA + '/api/cart/purchase', { method: 'POST', headers: { 'x-ct-token': UT } }); assert.equal(r.s, 403);
  r = await j(BA + '/api/info', { headers: { 'x-ct-token': 'court' } }); assert.equal(r.s, 401, 'token mal formé : ignoré, accès refusé comme sans token');
  console.log('✓ X-CT-Token : sans compte autorisé, relayé avec le token de l\'utilisateur ; achat toujours bloqué ; token mal formé ignoré');
  // __me : droit au token du serveur, sans pénalité
  r = await j(BA + '/__me', hdr(mkTok())); assert.deepEqual(r.o, { server: true });
  r = await j(BA + '/__me', hdr(mkTok({ sub: 'uid-intrus', user_id: 'uid-intrus' }))); assert.deepEqual(r.o, { server: false });
  r = await j(BA + '/__me'); assert.deepEqual(r.o, { server: false });
  for (let i = 0; i < 20; i++) await j(BA + '/__me', { headers: { 'x-firebase-token': 'a.b.c', 'x-forwarded-for': '7.7.7.7' } });
  r = await j(BA + '/api/info', { headers: { ...hdr(mkTok())['headers'], 'x-forwarded-for': '7.7.7.7' } }); assert.equal(r.s, 200, '__me ne bloque jamais une IP');
  console.log('✓ __me : compte autorisé → server:true, sinon false, jamais de blocage');
  // import et alertes : ouverts à tous (pas de token CardTrader en jeu)
  r = await j(BA + '/api/import'); assert.notEqual(r.s, 401); r = await j(BA + '/api/alerts/x'); assert.notEqual(r.s, 401);
  console.log('✓ import et alertes ouverts sans compte');
  // rotation de clés : nouveau kid publié → une seule relecture, limitée à 1 / minute
  keys = [jwkOf(kp, 'k1'), jwkOf(kp2, 'k2')]; const h1 = jwksHits;
  r = await j(BA + '/api/info', hdr(mkTok({}, { key: kp2.privateKey, kid: 'k2' }))); assert.ok([200, 401].includes(r.s));
  const h2 = jwksHits; for (let i = 0; i < 5; i++) await j(BA + '/api/info', hdr(mkTok({}, { kid: 'inconnu' + i })));
  assert.ok(jwksHits - h2 <= 1, 'jetons à kid inconnu : pas d\'avalanche vers Google (' + (jwksHits - h2) + ')'); console.log('✓ kid inconnu : relecture des clés plafonnée');
  // blocage par IP sur jetons invalides (X-Forwarded-For)
  let last; for (let i = 0; i < 16; i++) last = await j(BA + '/api/info', { headers: { 'x-firebase-token': 'a.b.c', 'x-forwarded-for': '9.9.9.9' } });
  assert.equal(last.s, 429); r = await j(BA + '/api/info', { headers: { ...hdr(mkTok())['headers'], 'x-forwarded-for': '9.9.9.9' } }); assert.equal(r.s, 429, 'IP bloquée même avec un bon jeton');
  r = await j(BA + '/api/info', { headers: { ...hdr(mkTok())['headers'], 'x-forwarded-for': '8.8.8.8' } }); assert.equal(r.s, 200); console.log('✓ blocage par IP après 15 jetons invalides, autre IP servie');
  pa.kill();
  // clés Google injoignables au premier jeton → 503 (jamais « accepté par défaut »)
  jwksDown = true; const pb = await start({ CARDTRADER_TOKEN: 'tok123', ALLOWED_UIDS: 'uid-beer', FIREBASE_JWKS_URL: `http://127.0.0.1:${jw.address().port}/jwks` }, 18796);
  r = await j('http://127.0.0.1:18796/api/info', hdr(mkTok())); assert.equal(r.s, 503); assert.equal(r.o.error, 'auth_unavailable'); console.log('✓ JWKS injoignable → 503, jamais d\'accès par défaut');
  jwksDown = false; await new Promise(r => setTimeout(r, 100)); pb.kill();
  // APP_KEY + compte : l'un OU l'autre
  const pc = await start({ CARDTRADER_TOKEN: 'tok123', ALLOWED_UIDS: 'uid-beer', APP_KEY: 'une-cle-longue-1234', FIREBASE_JWKS_URL: `http://127.0.0.1:${jw.address().port}/jwks`, BAD_KEY_DELAY_MS: '5' }, 18797);
  const BC = 'http://127.0.0.1:18797';
  r = await j(BC + '/__ping'); assert.equal(r.o.needsKey, true); assert.equal(r.o.needsLogin, true);
  r = await j(BC + '/api/info', { headers: { 'x-app-key': 'une-cle-longue-1234' } }); assert.equal(r.s, 200);
  r = await j(BC + '/api/info', hdr(mkTok())); assert.equal(r.s, 200);
  r = await j(BC + '/api/info', { headers: { 'x-app-key': 'faux' } }); assert.equal(r.s, 401); assert.equal(r.o.error, 'bad_app_key');
  console.log('✓ APP_KEY et compte Firebase : l\'un ou l\'autre'); pc.kill();
  // HOST ouvert : accepté avec ALLOWED_UIDS seul, refusé sans rien
  const pd = await start({ CARDTRADER_TOKEN: 'x', HOST: '0.0.0.0', ALLOWED_UIDS: 'uid-beer', FIREBASE_JWKS_URL: `http://127.0.0.1:${jw.address().port}/jwks` }, 18798); pd.kill();
  console.log('✓ HOST=0.0.0.0 accepté avec ALLOWED_UIDS seul (sans APP_KEY)');
  jw.close();
}

// 2) avec clé
p = await start({ CARDTRADER_TOKEN: 'tok123', APP_KEY: 'sesame' }, 18788); B = 'http://127.0.0.1:18788';
r = await j(B + '/__ping'); assert.equal(r.o.needsKey, true); console.log('✓ ping needsKey');
r = await j(B + '/api/info'); assert.equal(r.s, 401); console.log('✓ sans clé → 401');
r = await j(B + '/api/info', { headers: { 'x-app-key': 'nope' } }); assert.equal(r.s, 401); console.log('✓ mauvaise clé → 401');
r = await j(B + '/api/info', { headers: { 'x-app-key': 'sesame' } }); assert.equal(r.s, 200); console.log('✓ bonne clé → 200');
p.kill();

// 2b) anti brute-force : blocage par IP (X-Forwarded-For présent), jamais sans X-Forwarded-For
p = await start({ CARDTRADER_TOKEN: 'tok123', APP_KEY: 'sesame', BAD_KEY_DELAY_MS: '0' }, 18792); B = 'http://127.0.0.1:18792';
const bad = (ip) => j(B + '/api/info', { headers: { 'x-app-key': 'nope', ...(ip ? { 'x-forwarded-for': ip } : {}) } });
for (let i = 0; i < 14; i++) assert.equal((await bad('1.1.1.1')).s, 401);
r = await bad('1.1.1.1'); assert.equal(r.s, 401, '15e essai encore compté 401');
r = await j(B + '/api/info', { headers: { 'x-app-key': 'sesame', 'x-forwarded-for': '1.1.1.1' } }); assert.equal(r.s, 429); assert.equal(r.h.get('retry-after'), '300'); console.log('✓ IP bloquée après 15 mauvaises clés (même avec la bonne)');
r = await j(B + '/api/info', { headers: { 'x-app-key': 'sesame', 'x-forwarded-for': '6.6.6.6, 2.2.2.2' } }); assert.equal(r.s, 200); console.log('✓ une autre IP reste servie');
r = await j(B + '/api/info', { headers: { 'x-app-key': 'sesame', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } }); assert.equal(r.s, 200); console.log('✓ IP retenue = dernière de X-Forwarded-For (non falsifiable)');
for (let i = 0; i < 30; i++) await bad(null);
r = await j(B + '/api/info', { headers: { 'x-app-key': 'sesame' } }); assert.equal(r.s, 200); console.log('✓ sans X-Forwarded-For : jamais de blocage (pas de déni de service)');
p.kill();
p = await start({ CARDTRADER_TOKEN: 'tok123', APP_KEY: 'sesame', BAD_KEY_DELAY_MS: '300' }, 18793); B = 'http://127.0.0.1:18793';
let t0 = Date.now(); await bad(null); assert.ok(Date.now() - t0 >= 280, 'délai sur mauvaise clé'); console.log('✓ délai sur mauvaise clé :', Date.now() - t0, 'ms');
p.kill();

// 2c) cache plafonné
p = await start({ CARDTRADER_TOKEN: 'tok123', CACHE_MAX_MB: '0.0002' }, 18794); B = 'http://127.0.0.1:18794';
seen.length = 0;
for (let i = 1; i <= 8; i++) await j(B + '/api/blueprints/export?expansion_id=' + i);
const before = seen.length;
r = await j(B + '/api/blueprints/export?expansion_id=8'); assert.equal(r.h.get('x-cache'), 'HIT', 'dernier entré encore en cache');
r = await j(B + '/api/blueprints/export?expansion_id=1'); assert.equal(r.h.get('x-cache'), null, 'plus ancien évincé'); assert.equal(seen.length, before + 1);
console.log('✓ cache plafonné : les plus anciens sont évincés');
p.kill();

// 2d) concurrence amont plafonnée
slowInfo = true; active = 0; maxActive = 0;
p = await start({ CARDTRADER_TOKEN: 'tok123', UP_CONC: '3' }, 18795); B = 'http://127.0.0.1:18795';
const rs = await Promise.all(Array.from({ length: 14 }, () => j(B + '/api/info')));
assert.ok(rs.every(x => x.s === 200), 'toutes servies'); assert.ok(maxActive <= 3, 'concurrence amont ≤ 3, vu ' + maxActive); assert.ok(maxActive >= 2, 'mais parallèle');
console.log('✓ concurrence vers CardTrader plafonnée à', maxActive, '/ 3 pour 14 requêtes');
slowInfo = false; p.kill();

// 3) sans token
p = await start({ CARDTRADER_TOKEN: '' }, 18789); B = 'http://127.0.0.1:18789';
r = await j(B + '/__ping'); assert.equal(r.o.hasToken, false);
r = await j(B + '/api/info'); assert.equal(r.s, 401); assert.equal(r.o.error, 'no_token'); console.log('✓ sans token → 401 no_token');
seen.length = 0; r = await j(B + '/api/info', { headers: { 'x-ct-token': 'utilisateur-token-abcdef123456' } }); assert.equal(r.s, 200); assert.equal(seen.at(-1).auth, 'Bearer utilisateur-token-abcdef123456'); console.log('✓ serveur sans token : le token de l\'utilisateur suffit');
r = await j(B + '/prices.tsv'); assert.equal(r.s, 404); console.log('✓ prix pas encore récupérés : /prices.tsv → 404 (l\'appli interroge Scryfall)');
p.kill();

// 4) HOST ouvert sans clé → refus
await assert.rejects(start({ CARDTRADER_TOKEN: 'x', HOST: '0.0.0.0' }, 18790), /exit 1/); console.log('✓ HOST=0.0.0.0 sans APP_KEY refusé');
{ const po = await start({ CARDTRADER_TOKEN: '', HOST: '127.0.0.1' }, 18790); po.kill(); }
{ const po = await start({ CARDTRADER_TOKEN: '', HOST: '0.0.0.0' }, 18790); po.kill(); console.log('✓ HOST=0.0.0.0 sans token serveur : démarre (chacun cherche avec son propre token)'); }

// 4b) récupération automatique d'edh.bin.gz depuis le dépôt (faux GitHub : ETag / 304, fichier invalide, maigre, plus ancien, panne)
{
  const { createRequire } = await import('node:module'), { gzipSync, gunzipSync } = await import('node:zlib'), { mkdtempSync, existsSync, readFileSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const { edhPack } = createRequire(import.meta.url)('../edhbin.cjs');
  const mk = (at, nd, nc = 120) => {
    const cmds = Array.from({ length: nc }, (_, i) => ({ slug: 'c' + i, decks: 100 - (i % 50), ci: 'WU', names: ['Commander ' + i], img: '' }));
    const decks = Array.from({ length: nd }, (_, i) => ({ slug: 'c' + (i % nc), src: 'edhrec', label: 'Deck moyen', url: '', cards: [['Sol Ring', 1], ['Card ' + (i % 30), 1]] }));
    return Buffer.from(gzipSync(Buffer.from(edhPack({ v: 1, at, cmds, decks, price: [['Sol Ring', 150]], gc: [] }, n => n.toLowerCase()))));
  };
  const A = mk('2026-10-05T04:00:00Z', 60), Bf = mk('2026-10-12T04:00:00Z', 80), THIN = mk('2026-10-19T04:00:00Z', 10), OLD = mk('2026-09-01T04:00:00Z', 100);
  const src = { buf: A, etag: '"a"', status: 200, hits: 0, notMod: 0 };
  const gh = http.createServer((q, w) => {
    src.hits++;
    if (src.status !== 200) { w.writeHead(src.status); return w.end('x'); }
    if (q.headers['if-none-match'] === src.etag) { src.notMod++; w.writeHead(304, { ETag: src.etag }); return w.end(); }
    w.writeHead(200, { 'Content-Type': 'application/octet-stream', ETag: src.etag }); w.end(src.buf);
  });
  await new Promise(r => gh.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'edh-')), env = { CARDTRADER_TOKEN: 'x', EDH_SOURCE_URL: `http://127.0.0.1:${gh.address().port}/edh.bin.gz`, EDH_SYNC_MS: '300', EDH_SYNC_FIRST_MS: '30', EDH_DATA_DIR: dir };
  const waitFor = async (fn, what) => { for (let i = 0; i < 80; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 50)); } assert.fail('délai : ' + what); };
  const st = async () => (await j(B + '/__edh')).o, raw = h => new Promise((res, rej) => http.get(B + '/edh.bin.gz', { headers: h }, q => { const c = []; q.on('data', d => c.push(d)); q.on('end', () => res({ g: { status: q.statusCode, headers: { get: k => q.headers[k.toLowerCase()] } }, b: Buffer.concat(c) })); }).on('error', rej));      // octets tels quels (fetch décompresserait)
  assert.ok(!existsSync(join(process.env.PWA_DIR, 'edh.bin.gz')), 'pwa/edh.bin.gz n\'est pas versionné ici');
  let px = await start(env, 18795); B = 'http://127.0.0.1:18795';
  await waitFor(async () => (await st()).from === 'GitHub', 'première récupération');
  let o = await st(); assert.equal(o.at, '2026-10-05T04:00:00Z'); assert.equal(o.decks, 60); assert.equal(o.cmds, 120); assert.equal(o.err, ''); assert.equal(o.source, 'GitHub');
  let x = await raw({ 'Accept-Encoding': 'gzip' }); assert.equal(x.g.status, 200); assert.equal(x.g.headers.get('content-encoding'), 'gzip'); assert.ok(x.b.length > 0);
  const tag = x.g.headers.get('etag'); assert.match(tag, /^"[0-9a-f]{20}"$/);
  const gzRes = await new Promise((res, rej) => http.get(B + '/edh.bin.gz', { headers: { 'Accept-Encoding': 'gzip' } }, q => { const c = []; q.on('data', d => c.push(d)); q.on('end', () => res({ h: q.headers, b: Buffer.concat(c) })); }).on('error', rej));
  assert.ok(gzRes.b.equals(A), 'fichier du faux GitHub servi tel quel');
  const nm = await new Promise((res, rej) => http.get(B + '/edh.bin.gz', { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': tag } }, q => { const c = []; q.on('data', d => c.push(d)); q.on('end', () => res({ s: q.statusCode, h: q.headers, n: Buffer.concat(c).length })); }).on('error', rej));
  assert.equal(nm.s, 304); assert.equal(nm.n, 0); assert.equal(nm.h.etag, tag); assert.match(nm.h['cache-control'], /max-age=86400/);
  const id1 = await new Promise((res, rej) => http.get(B + '/edh.bin.gz', { headers: { 'Accept-Encoding': 'identity' } }, q => { const c = []; q.on('data', d => c.push(d)); q.on('end', () => res({ h: q.headers, b: Buffer.concat(c) })); }).on('error', rej));
  assert.notEqual(id1.h.etag, tag, 'ETag distinct pour la variante non compressée'); assert.equal(id1.h['content-encoding'], undefined); assert.equal(id1.b.toString('latin1', 0, 4), 'EDH2');
  await waitFor(() => existsSync(join(dir, 'edh.bin.gz')), 'copie dans .data'); assert.ok(readFileSync(join(dir, 'edh.bin.gz')).equals(A), 'copie persistée');
  await waitFor(() => src.notMod >= 2, 'lectures conditionnelles'); assert.equal((await st()).from, 'GitHub'); console.log('✓ edh.bin.gz récupéré depuis le dépôt : validé, servi tel quel, ETag/304, copie dans .data, relectures conditionnelles');
  // nouvelle version → remplacée
  src.buf = Bf; src.etag = '"b"'; await waitFor(async () => (await st()).at === '2026-10-12T04:00:00Z', 'nouvelle version'); assert.equal((await st()).decks, 80);
  x = await raw({ 'Accept-Encoding': 'gzip', 'If-None-Match': tag }); assert.equal(x.g.status, 200, 'ancien ETag : le nouveau fichier est renvoyé'); assert.ok(x.b.equals(Bf)); assert.notEqual(x.g.headers.get('etag'), tag);
  console.log('✓ nouvelle version du dépôt : remplacée, l\'ancien ETag reçoit le nouveau fichier');
  // fichiers refusés : on garde Bf
  const keep = async (what, re) => { await waitFor(async () => re.test((await st()).err), what); o = await st(); assert.equal(o.at, '2026-10-12T04:00:00Z', 'ancien fichier gardé : ' + what); x = await raw({ 'Accept-Encoding': 'gzip' }); assert.ok(x.b.equals(Bf)); };
  src.buf = Buffer.from('pas du gzip'); src.etag = '"g1"'; await keep('texte quelconque', /./);
  src.buf = gzipSync(Buffer.from('EDH2 mais tronqué')); src.etag = '"g2"'; await keep('EDH2 tronqué', /./);
  src.buf = THIN; src.etag = '"t"'; await keep('fichier maigre', /maigre/);
  src.buf = OLD; src.etag = '"o"'; await waitFor(async () => src.hits > 0 && (await st()).err === '', 'plus ancien ignoré sans erreur'); o = await st(); assert.equal(o.at, '2026-10-12T04:00:00Z'); assert.equal(o.decks, 80);
  src.status = 500; await keep('panne 500', /HTTP 500/);
  console.log('✓ fichier illisible, tronqué, trop maigre, plus ancien ou panne du dépôt : l\'ancien reste servi, l\'erreur est visible sur /__edh');
  // redémarrage pendant une panne du dépôt : la copie de .data est reprise
  px.kill(); await new Promise(r => setTimeout(r, 200));
  px = await start(env, 18796); B = 'http://127.0.0.1:18796';
  await waitFor(async () => (await st()).from === 'copie', 'copie reprise'); o = await st(); assert.equal(o.at, '2026-10-12T04:00:00Z'); x = await raw({ 'Accept-Encoding': 'gzip' }); assert.ok(x.b.equals(Bf), 'copie de .data servie après redémarrage');
  console.log('✓ redémarrage pendant une panne : la copie gardée dans .data est servie');
  px.kill(); gh.close(); rmSync(dir, { recursive: true, force: true });
  // désactivé : aucun appel, 404 propre
  const pd = await start({ CARDTRADER_TOKEN: 'x' }, 18797); B = 'http://127.0.0.1:18797'; await new Promise(r => setTimeout(r, 300)); o = await st(); assert.equal(o.source, ''); assert.equal(o.from, 'none'); assert.equal((await j(B + '/edh.bin.gz')).s, 404); pd.kill();
  console.log('✓ EDH_SOURCE_URL vide : récupération désactivée');
}

// 4c) prix « à partir de » (prices.tsv.gz de la branche data) : relus, validés, servis compressés
{
  const { gzipSync, gunzipSync } = await import('node:zlib'), { mkdtempSync, rmSync, existsSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const mk = (at, n) => gzipSync(Buffer.from(`#MOPX1 ${at} ${n}\n` + Array.from({ length: n }, (_, i) => `Carte ${i}\t${100 + i}\t${120 + i}`).join('\n') + '\n'));
  let file = mk('2026-10-08T09:00:00Z', 16000), hits = 0;
  const gh = http.createServer((q, r) => { hits++; r.writeHead(200, { 'Content-Type': 'application/octet-stream' }); r.end(file); }); await new Promise(r => gh.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'px-'));
  const px = await start({ CARDTRADER_TOKEN: '', PRICES_SOURCE_URL: `http://127.0.0.1:${gh.address().port}/prices.tsv.gz`, EDH_SYNC_MS: '400', EDH_SYNC_FIRST_MS: '10', EDH_DATA_DIR: dir }, 18799); B = 'http://127.0.0.1:18799';
  await new Promise(r => setTimeout(r, 2600));
  r = await j(B + '/__prices'); assert.equal(r.o.cards, 16000); assert.equal(r.o.at, '2026-10-08T09:00:00Z');
  r = await j(B + '/__ping'); assert.equal(r.o.prices, true);
  const g = await fetch(B + '/prices.tsv', { headers: { 'accept-encoding': 'identity' } }); const txt = await g.text(); assert.equal(g.status, 200); assert.match(txt, /^#MOPX1 /); assert.match(txt, /Carte 5\t105\t125/);
  assert.ok(existsSync(join(dir, 'prices.tsv.gz')), 'copie gardée dans .data');
  file = Buffer.from('pas du gzip'); await new Promise(r => setTimeout(r, 900)); r = await j(B + '/__prices'); assert.equal(r.o.cards, 16000); assert.match(r.o.err, /.+/);
  file = mk('2026-10-09T09:00:00Z', 120); await new Promise(r => setTimeout(r, 900)); r = await j(B + '/__prices'); assert.equal(r.o.cards, 16000, 'fichier trop maigre ignoré');
  px.kill(); gh.close(); rmSync(dir, { recursive: true, force: true });
  console.log('✓ prix des cartes : relus depuis la branche data, servis sur /prices.tsv, copie gardée ; fichier illisible ou maigre ignoré');
}

// 5) amont HS → 502
up.close(); 
p = await start({ CARDTRADER_TOKEN: 'tok123' }, 18791); B = 'http://127.0.0.1:18791';
r = await j(B + '/api/info'); assert.equal(r.s, 502); console.log('✓ amont injoignable → 502');
p.kill(); process.exit(0);
