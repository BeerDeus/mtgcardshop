// E2E compte + decks : vrai SDK Firebase (bundle servi à la place du CDN), auth simulée par routes, Firestore hors ligne
// (cache persistant IndexedDB), CardTrader/Scryfall simulés. Captures dans shots/acc-*.png
import './setup-env.mjs';
const toInput = p => p.evaluate(() => { if (S.view !== 'input') showView('input'); }), toHome = p => p.evaluate(() => { if (S.view !== 'home') showView('home'); });      // accueil ↔ « Nouveau panier »
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';
const KP = generateKeyPairSync('rsa', { modulusLength: 2048 });
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (uid, email) => { const n = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' }), c = b64({ iss: 'https://securetoken.google.com/m2s-mtg', aud: 'm2s-mtg', auth_time: n, user_id: uid, sub: uid, iat: n, exp: n + 3600, email, email_verified: false, firebase: { identities: { email: [email] }, sign_in_provider: 'password' } }); return [h, c, rsaSign('RSA-SHA256', Buffer.from(h + '.' + c), KP.privateKey).toString('base64url')].join('.'); };
const SHARED = readFileSync('tests/.tmp/fb-shared.js', 'utf8');

/* ── Faux CardTrader (comme live-e2e) ─────────────────────────────────────────────────────── */
const prod = (id, bp, user, cents, cond, lang, extra = {}) => ({ id, blueprint_id: bp, name_en: 'x', quantity: extra.qty || 2, graded: false, on_vacation: false, bundle_size: 1,
  price: { cents, currency: 'EUR' }, properties_hash: { condition: cond, mtg_language: lang, mtg_foil: false }, expansion: { code: extra.set || 'cmm', name_en: 'x' },
  user: { id: user.id, username: user.name, country_code: user.cc, can_sell_via_hub: user.hub } });
const A = { id: 1, name: 'seller_a', cc: 'FR', hub: true }, B = { id: 2, name: 'seller_b', cc: 'DE', hub: true };
const price = { sol: 120 };
const PRODUCTS = () => ({ '100|fr': [prod(9001, 100, A, 150, 'Near Mint', 'fr'), prod(9002, 100, B, price.sol, 'Slightly Played', 'fr', { qty: 1 })], '101|fr': [prod(9004, 101, A, 200, 'Near Mint', 'fr')], '102|fr': [], '102|en': [prod(9005, 102, B, 30, 'Near Mint', 'en')] });
const EXPS = [{ id: 1, game_id: 1, code: 'cmm', name: 'Commander Masters' }];
const BPS = { 1: [{ id: 100, name: 'Sol Ring', scryfall_id: 's-sr' }, { id: 101, name: 'Swords to Plowshares', scryfall_id: 's-stp' }, { id: 102, name: "Ranger's Hawk", scryfall_id: 's-rh' }] };
const PRINTS = { 'Sol Ring': [{ id: 's-sr', set: 'cmm', set_name: 'Commander Masters', collector_number: '400', name: 'Sol Ring' }], 'Swords to Plowshares': [{ id: 's-stp', set: 'cmm', set_name: 'Commander Masters', collector_number: '85', name: 'Swords to Plowshares' }], "Ranger's Hawk": [{ id: 's-rh', set: 'cmm', set_name: 'Commander Masters', collector_number: '99', name: "Ranger's Hawk" }] };
const up = http.createServer((req, res) => { req.resume(); req.on('end', () => {
  const u = new URL(req.url, 'http://x'), path = u.pathname.replace('/api/v2/', ''); const send = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (path === 'expansions') return send(EXPS); if (path === 'blueprints/export') return send(BPS[u.searchParams.get('expansion_id')] || []);
  if (path === 'marketplace/products') { const bp = u.searchParams.get('blueprint_id'); return send({ [bp]: PRODUCTS()[bp + '|' + u.searchParams.get('language')] || [] }); }
  send({}); }); });
await new Promise(r => up.listen(0, '127.0.0.1', r));
const proxy = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: '18800', CARDTRADER_TOKEN: 'tok', CT_UPSTREAM: `http://127.0.0.1:${up.address().port}/api/v2` }, stdio: 'ignore' });
const jwks = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ keys: [{ ...KP.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] })); });
await new Promise(r => jwks.listen(0, '127.0.0.1', r));
const proxyG = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: '18820', CARDTRADER_TOKEN: 'tok', ALLOWED_UIDS: 'uid-allowed', FIREBASE_JWKS_URL: `http://127.0.0.1:${jwks.address().port}/jwks`, CT_UPSTREAM: `http://127.0.0.1:${up.address().port}/api/v2` }, stdio: 'ignore' });
process.on('exit', () => { try { proxyG.kill(); } catch {} });
const html = readFileSync('deck-deal.html');
const stat = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); }).listen(18810, '127.0.0.1');
process.on('exit', () => { try { proxy.kill(); } catch {} });
await sleep(700);

/* ── Faux Firebase réseau ─────────────────────────────────────────────────────────────────── */
const users = new Map();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const idLog = []; let idDelay = 0;
async function wireFirebase(ctx, { sdk = true } = {}) {
  if (sdk) {
    for (const n of ['app', 'auth', 'firestore']) await ctx.route(`https://www.gstatic.com/firebasejs/12.19.0/firebase-${n}.js`, r => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/javascript' }, body: "export * from 'https://fb.test/shared.js';" }));
    await ctx.route('https://fb.test/shared.js', r => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/javascript' }, body: SHARED }));
  } else await ctx.route(/gstatic\.com\/firebasejs/, r => r.abort());
  await ctx.route(/firestore\.googleapis\.com|apis\.google\.com|firebaseapp\.com/, r => r.abort());
  await ctx.route(/identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/, async route => {
    const req = route.request(); if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const u = req.url(), op = u.split('?')[0].split('/').pop(); idLog.push(op);
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { body = Object.fromEntries(new URLSearchParams(req.postData() || '')); }
    const j = o => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(o) });
    const err = m => route.fulfill({ status: 400, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: 400, message: m } }) });
    const tok = (email) => ({ kind: 'x', idToken: jwt(users.get(email).uid, email), email, refreshToken: 'r:' + email, expiresIn: '3600', localId: users.get(email).uid, registered: true });
    if (op === 'accounts:signUp') { if (users.has(body.email)) return err('EMAIL_EXISTS'); users.set(body.email, { uid: 'uid-' + (users.size + 1), pw: body.password }); return j(tok(body.email)); }
    if (op === 'accounts:signInWithPassword') { const x = users.get(body.email); if (!x || x.pw !== body.password) return err('INVALID_LOGIN_CREDENTIALS'); return j(tok(body.email)); }
    if (op === 'accounts:lookup') { if (idDelay) await sleep(idDelay); const p = JSON.parse(Buffer.from((body.idToken || '').split('.')[1] || 'e30', 'base64url').toString()); return j({ users: [{ localId: p.sub, email: p.email, emailVerified: false, providerUserInfo: [{ providerId: 'password', email: p.email, federatedId: p.email, rawId: p.email }], lastLoginAt: String(Date.now()), createdAt: String(Date.now()) }] }); }
    if (op === 'accounts:sendOobCode') return j({ email: body.email });
    if (op === 'token') { const email = String(body.refresh_token || '').replace(/^r:/, ''); return j({ access_token: jwt(users.get(email)?.uid || 'x', email), id_token: jwt(users.get(email)?.uid || 'x', email), refresh_token: body.refresh_token, expires_in: '3600', token_type: 'Bearer', user_id: users.get(email)?.uid }); }
    return j({ projectId: 'm2s-mtg', authorizedDomains: ['localhost', '127.0.0.1'] });
  });
  await ctx.route('https://api.scryfall.com/**', route => {
    const u = new URL(route.request().url()), h = { 'access-control-allow-origin': '*' };
    const data = [...(u.searchParams.get('q') || '').matchAll(/!"(.+?)"/g)].flatMap(m => PRINTS[m[1]] || []);   // recherche groupée : (!"A" or !"B" …)
    return data.length ? route.fulfill({ status: 200, headers: h, json: { object: 'list', has_more: false, data } }) : route.fulfill({ status: 404, headers: h, json: { object: 'error' } });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
}

const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const errs = [];
const newCtx = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', ...opts });      // le service worker irait chercher lui-même le SDK Firebase (cache des bibliothèques), hors des routes du test
  return ctx;
};
const watch = (p, tag) => {
  p.on('pageerror', e => errs.push(`${tag} pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource|firestore|Firestore|WebChannel/i.test(m.text())) errs.push(`${tag} console: ${m.text()}`); });
};
const T = async (p, s) => (await p.textContent(s) || '').replace(/\s+/g, ' ').trim();
const runDone = async (p, ms = 30000) => { try { await p.waitForFunction(() => /terminée/.test(document.querySelector('#progTitle').textContent), null, { timeout: ms }); } catch (e) { console.log('RUN STUCK:', await T(p, '#progTitle'), '|', await T(p, '#progRate'), '|', await T(p, '#alerts'), '|', await T(p, '#steps')); await shot(p, 'debug-stuck'); throw e; } };
const sheetOpen = p => p.waitForSelector('.sheet-wrap.open .sheet', { timeout: 5000 });
const sheetGone = p => p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 5000 });
const ok = m => console.log('✓', m);
// « Mes decks » est un écran ouvert depuis l'accueil (comme « Ma collection ») : D = l'ouvrir, H = revenir à l'accueil
const D = async p => { if (!(await p.$('.dks.on'))) { await toHome(p); await p.click('#btnDecks'); await p.waitForSelector('.dks.on'); await p.waitForTimeout(150); } };
const H = async p => { if (await p.$('.dks.on')) { await p.click('.dks [data-act="close"]'); await p.waitForFunction(() => !document.querySelector('.dks'), null, { timeout: 3000 }); } };
const shot = (p, n) => p.screenshot({ path: `shots/acc-${n}.png` });
const PX_BODY = '#MOPX1 2026-10-08T09:00:00Z 4\nSol Ring\t120\t100\nSwords to Plowshares\t150\t100\nRanger\'s Hawk\t10\t10\nPhantom Card\t50\t50\n';
const pxRoute = pg => pg.route('**/prices.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values', body: PX_BODY }));
const DECK4 = '1 Sol Ring\n1 Swords to Plowshares\n1 Ranger\'s Hawk\n1 Phantom Card\n5 Plains';

/* ═══ A. Invité : decks locaux (démo, sans proxy) ═════════════════════════════════════════════ */
{
  const ctx = await newCtx(); await wireFirebase(ctx); const p = await ctx.newPage(); watch(p, 'A');
  await p.goto('http://127.0.0.1:18810/'); await p.waitForTimeout(900);
  assert.match(await T(p, '#decksSub'), /Crée un deck/); await D(p); assert.equal(await p.$$eval('.deck', n => n.length), 0); assert.ok(await p.$('#btnNewDeck')); await H(p); ok('invité sans deck : bouton « Mes decks », écran avec le + et aucune carte de deck');
  assert.equal(await p.$eval('#btnAccount', e => e.dataset.in), '0'); ok('avatar : icône invité');
  await toInput(p); await p.fill('#deckText', '1 Sol Ring\n1 Swords to Plowshares\n25 Plains');
  await toInput(p); await p.selectOption('#optLang', 'en'); await p.click('#segMode .seg-opt[data-v="direct"]'); await p.waitForTimeout(200);
  await toInput(p); await p.click('#btnSave'); await sheetOpen(p);
  assert.equal(await p.inputValue('#svName'), 'Sol Ring'); ok('nom proposé = première carte');
  assert.match(await T(p, '#svWhere'), /cet appareil/); assert.ok(await p.$('#svLogin')); ok('invité : indication + lien « Connecte-toi »');
  await shot(p, 'A1-save-sheet');
  await p.fill('#svName', ''); assert.equal(await p.$eval('#svGo', e => e.disabled), true); ok('nom vide : bouton désactivé');
  await p.fill('#svName', 'Mon Deck Test'); await p.click('#svGo'); await sheetGone(p);
  assert.match(await T(p, '#decksSub'), /^1 deck$/); await D(p);
  assert.equal(await T(p, '.deck-name'), 'Mon Deck Test'); assert.match(await T(p, '.deck-meta'), /2 cartes\s*à l'instant/); ok('deck créé et listé'); await H(p);
  assert.match(await T(p, '#deckStats'), /Mon Deck Test/); ok('deck rattaché : puce dans les statistiques');
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:decks:v1')));
  assert.equal(stored.length, 1); assert.equal(stored[0].opts.lang, 'en'); assert.equal(stored[0].opts.mode, 'direct'); ok('stocké en local avec ses critères');
  await shot(p, 'A2-liste-invite');

  await p.reload(); await p.waitForTimeout(800); await D(p);
  assert.equal(await T(p, '.deck-name'), 'Mon Deck Test'); ok('persistance après rechargement'); await H(p);
  await toInput(p); await p.fill('#deckText', ''); await toInput(p); await p.selectOption('#optLang', 'fr');
  await D(p); await p.click('[data-act="more"]'); await p.waitForSelector('#dkOpen'); await p.click('#dkOpen'); await p.waitForFunction(() => !document.querySelector('.dks'), null, { timeout: 3000 });
  assert.equal((await p.inputValue('#deckText')).split('\n').length, 3); assert.equal(await p.inputValue('#optLang'), 'en');
  assert.equal(await p.$eval('#segMode', e => e._v), 'direct'); await D(p); assert.equal(await p.$eval('.deck', e => e.dataset.active), '1'); await H(p); ok('ouvrir un deck : liste + critères restaurés (l\'écran des decks se referme)');

  // détacher
  await toInput(p); await p.click('#deckStats .stat-x'); await p.waitForTimeout(150);
  assert.equal(await T(p, '#btnSave'), 'Enregistrer'); await D(p); assert.equal(await p.$eval('.deck', e => e.dataset.active), '0'); ok('détacher le deck');
  // renommer / dupliquer / supprimer
  await p.click('.deck-more'); await sheetOpen(p); await p.waitForTimeout(500);
  await shot(p, 'A3-deck-sheet-vide');
  await p.fill('#dkName', 'Renommé'); await p.press('#dkName', 'Enter'); await p.waitForTimeout(250);
  assert.equal(await T(p, '.deck-name'), 'Renommé'); assert.equal(await T(p, '.sheet-head h2'), 'Renommé'); ok('renommer');
  assert.match(await T(p, '.sheet-body .hint:not(#dkMountHint)'), /Aucun relevé/); ok('sans relevé : message explicatif');
  await p.click('#dkDup'); await sheetGone(p); await p.waitForTimeout(200);
  assert.equal(await p.$$eval('.deck-name', n => n.map(x => x.textContent).sort().join('|')), 'Renommé|Renommé (copie)'); ok('dupliquer');
  await p.click('.deck:first-child .deck-more'); await sheetOpen(p);
  await p.click('#dkDel'); assert.equal(await T(p, '#dkDel'), 'Confirmer'); await p.click('#dkDel'); await sheetGone(p); await p.waitForTimeout(200);
  assert.equal(await p.$$eval('.deck', n => n.length), 1); ok('supprimer en deux temps');
  // plus de 4 decks
  await H(p);
  for (let i = 0; i < 5; i++) { await toInput(p); await p.fill('#deckText', `1 Sol Ring\n1 Card ${i}`); await toInput(p); await p.click('#deckStats .stat-x').catch(() => {}); await toInput(p); await p.click('#btnSave'); await sheetOpen(p); await p.fill('#svName', 'Deck ' + i); await p.click('#svGo'); await sheetGone(p); }
  await D(p); assert.equal(await p.$$eval('.deck', n => n.length), 6); assert.equal(await p.$('#btnMoreDecks'), null); assert.equal(await T(p, '.dks .dv-title span'), '6 decks'); ok('tous les decks sont listés dans l\'écran (plus de « Afficher les N autres »)');
  await H(p);
  // compte indisponible (SDK bloqué dans ce contexte ? non : ici SDK dispo) → ouvre la feuille compte
  await p.click('#btnAccount'); await sheetOpen(p); await p.waitForSelector('#acForm'); await p.waitForTimeout(650);
  await shot(p, 'A4-compte-connexion');
  await p.click('#acSeg .seg-opt[data-v="up"]'); await p.waitForTimeout(450);
  await shot(p, 'A5-compte-creation');
  await ctx.close();
}

/* ═══ B. Compte : inscription, import, persistance, historique de prix (proxy + live) ═════════ */
{
  const ctx = await newCtx(); await wireFirebase(ctx); const p = await ctx.newPage(); watch(p, 'B');
  await p.goto('http://127.0.0.1:18800/'); await p.waitForTimeout(900);
  assert.notEqual((await T(p, '#modeLabel')), 'Démo'); ok('B : mode live via proxy');
  await toInput(p); await p.fill('#deckText', DECK4);
  await toInput(p); await p.click('#btnSave'); await sheetOpen(p); await p.fill('#svName', 'Deck local'); await p.click('#svGo'); await sheetGone(p);
  await D(p); assert.equal(await p.$$eval('.deck', n => n.length), 1); await H(p); ok('B : deck local créé avant connexion');

  await p.click('#btnAccount'); await sheetOpen(p); await p.waitForSelector('#acForm'); await p.waitForTimeout(600); await shot(p, 'B0-connexion-vide');
  await p.click('#acGo'); assert.match(await T(p, '#acMsg'), /email/i); ok('formulaire vide : message');
  await p.fill('#acEmail', 'beer@example.com'); await p.click('#acGo'); assert.match(await T(p, '#acMsg'), /mot de passe/i); ok('mot de passe manquant : message');
  await p.click('#acSeg .seg-opt[data-v="up"]'); await p.waitForSelector('#acPw'); await p.fill('#acEmail', 'beer@example.com'); await p.fill('#acPw', '123'); await p.click('#acGo');
  assert.match(await T(p, '#acMsg'), /6 caractères/); ok('mot de passe court : message');
  await p.fill('#acPw', 'secret123'); await p.click('#acGo'); await sheetGone(p); await p.waitForTimeout(700);
  assert.equal(await p.$eval('#btnAccount', e => e.dataset.in), '1'); assert.equal(await T(p, '#avatarLetter'), 'B'); ok('inscription → connecté, avatar « B »');
  assert.ok(idLog.includes('accounts:signUp')); 
  await D(p); assert.equal(await p.$eval('#decksSync', e => e.dataset.s), 'synced'); ok('état : synchronisé');
  assert.match(await T(p, '.import-row'), /1 deck sur cet appareil/); assert.match(await T(p, '#deckList'), /Aucun deck pour le moment/); ok('connecté : import proposé + état vide');
  await p.waitForTimeout(100); await shot(p, 'B1-import');
  // simulation de l'ack serveur pour l'import (le backend Firestore est volontairement injoignable)
  await p.evaluate(() => { const o = D.cloud.saveMany; D.cloud.saveMany = (uid, items) => { o(uid, items).catch(() => {}); return Promise.resolve(); }; });
  await p.click('.import-row .btn'); await p.waitForTimeout(700);
  assert.equal(await p.$('.import-row'), null); assert.equal(await T(p, '.deck-name'), 'Deck local'); ok('import : deck dans le compte, ligne d\'import retirée');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:decks:v1')).length), 0); ok('import : copie locale supprimée après accord du serveur');
  assert.equal(await p.$eval('#decksSync', e => e.dataset.s), 'pending'); ok('écriture en attente (serveur injoignable) : « Synchronisation… »');
  await shot(p, 'B2-liste-compte');

  // persistance : rechargement → session + decks depuis le cache IndexedDB
  idDelay = 1500; await p.reload(); await p.waitForTimeout(500);
  assert.equal(await p.$eval('#btnAccount', e => e.dataset.in), '1'); assert.equal(await T(p, '#avatarLetter'), 'B'); ok('rechargement : avatar immédiat (indice local)');
  await D(p); assert.ok(await p.$('.deck.skel')); await shot(p, 'B3-squelette'); ok('rechargement : squelettes pendant la restauration');
  await p.waitForSelector('.deck:not(.skel)', { timeout: 10000 }); idDelay = 0; await p.waitForTimeout(300);
  assert.equal(await T(p, '.deck-name'), 'Deck local'); ok('rechargement : session et deck restaurés (cache persistant)');

  // historique de prix : charger → lancer → enregistrer le relevé
  await p.click('[data-act="more"]'); await p.waitForSelector('#dkOpen'); await p.click('#dkOpen'); await p.waitForTimeout(300);
  // règles Firestore pas encore republiées : elles refusent le champ « snap » → le deck est renvoyé sans relevé, sans erreur visible
  await p.evaluate(() => { window.__saves = []; const real = D.cloud.save; D.cloud.save = (uid, id, data) => { window.__saves.push(!!data.snap); if (data.snap) return Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' })); return real(uid, id, data); }; });
  await toInput(p); await p.click('#btnRun'); await runDone(p); await p.waitForTimeout(900);
  assert.deepEqual(await p.evaluate(() => window.__saves), [true, false], 'écriture avec le relevé refusée, renvoyée aussitôt sans lui'); assert.equal(await p.evaluate(() => D.noSnap), true);
  assert.doesNotMatch(await T(p, '#toast'), /Accès refusé|règles/); ok('règles Firestore anciennes : repli sans relevé, aucune erreur affichée');
  assert.ok(await p.evaluate(() => { const d = findDeck(S.deckId); const sn = snapOf(d); return !!sn && sn.items.length > 0 && !d.snap; }), 'les prix restent disponibles sur l\'appareil'); ok('les prix restent gardés sur l\'appareil');
  assert.equal(await p.$eval('#heroDelta', e => e.hidden), true); assert.equal(await T(p, '#btnSave2Txt'), 'Enregistré'); ok('1re recherche : relevé enregistré, pas de variation');
  const h1 = await p.evaluate(() => findDeck(S.deckId).history); assert.equal(h1.length, 1); assert.equal(h1[0].total, 350); assert.equal(h1[0].found, 3); ok('historique : 3,50 € · 3 cartes · ' + h1[0].sig);
  // le prix baisse puis une 2e recherche
  price.sol = 80;
  await p.click('#btnBack'); await p.waitForTimeout(200); await p.evaluate(() => startRun(true));   // « Actualiser » : le cache serveur (10 min) ne doit pas masquer la baisse
  await runDone(p); await p.waitForTimeout(1200);
  assert.equal(await p.$eval('#heroDelta', e => e.hidden), false); assert.match(await T(p, '#heroDelta'), /▼ 0,40 € depuis la dernière recherche/); ok('2e recherche : « ▼ 0,40 € depuis la dernière recherche »');
  assert.equal(await p.$eval('#heroDelta', e => e.className), 'delta-line down');
  assert.ok((await p.evaluate(() => window.__saves)).slice(2).every(x => x === false), 'après le 1er refus : plus de relevé envoyé pendant la session'); ok('plus d\'insistance après le refus');
  await shot(p, 'B4-resultats-delta');
  // le mode Direct n'est pas comparable → pas de ligne de variation
  await p.click('#segDeliv .seg-opt[data-v="direct"]'); await p.waitForTimeout(300);
  assert.equal(await p.$eval('#heroDelta', e => e.hidden), true); ok('mode différent : variation masquée');
  await p.click('#segDeliv .seg-opt[data-v="zero"]'); await p.waitForTimeout(200);
  await p.click('#btnBack'); await p.waitForTimeout(400); await D(p);
  assert.match(await T(p, '.deck-price b'), /3,10/); assert.equal(await T(p, '.deck-price .delta'), '−0,40 €'); ok('carte du deck : prix 3,10 € et −0,40 €');
  await shot(p, 'B5-liste-prix');
  await p.click('.deck-more'); await sheetOpen(p); await p.waitForTimeout(600);
  assert.ok(await p.$('.chart')); assert.equal(await p.$$eval('.hist .t', n => n.length), 2); ok('feuille deck : graphique + 2 relevés');
  await shot(p, 'B6-deck-historique'); await p.keyboard.press('Escape'); await sheetGone(p); await H(p);

  // modifier la liste puis chercher : le relevé n'est pas rattaché au deck (texte différent)
  await toInput(p); await p.fill('#deckText', DECK4 + '\n1 Sol Ring'); await toInput(p); await p.click('#btnRun');
  await runDone(p); await p.waitForTimeout(600);
  assert.equal((await p.evaluate(() => findDeck(S.deckId).history)).length, 2); ok('liste modifiée non enregistrée : historique du deck intact');
  await p.click('#btnBack');

  // déconnexion
  await p.click('#btnAccount'); await sheetOpen(p); await p.waitForTimeout(400);
  assert.match(await T(p, '.who-t b'), /beer@example.com/); await shot(p, 'B7-compte-connecte');
  await p.click('#acOut'); await sheetGone(p); await p.waitForTimeout(500);
  assert.equal(await p.$eval('#btnAccount', e => e.dataset.in), '0'); await D(p); assert.equal(await p.$$eval('.deck', n => n.length), 0); await H(p); ok('déconnexion : retour au mode invité');
  // reconnexion : mauvais mot de passe puis bon
  await p.click('#btnAccount'); await sheetOpen(p); await p.waitForSelector('#acForm');
  await p.fill('#acEmail', 'beer@example.com'); await p.fill('#acPw', 'faux'); await p.click('#acGo'); await p.waitForFunction(() => !document.querySelector('#acMsg').hidden); await p.waitForTimeout(500);
  assert.match(await T(p, '#acMsg'), /incorrect/); assert.equal(await p.$eval('#acGo', e => e.disabled), false); ok('mauvais mot de passe : message, bouton réactivé');
  await shot(p, 'B8-erreur-connexion');
  await p.fill('#acPw', 'secret123'); await p.click('#acGo'); await sheetGone(p); await p.waitForTimeout(800);
  await D(p); assert.equal(await T(p, '.deck-name'), 'Deck local'); await H(p); ok('reconnexion : decks retrouvés');
  // mot de passe oublié
  await p.click('#btnAccount').catch(() => {});
  await ctx.close();
}

/* ═══ C. SDK injoignable (artifact, hors ligne) : dégradation propre ═════════════════════════ */
{
  const ctx = await newCtx(); await wireFirebase(ctx, { sdk: false }); const p = await ctx.newPage(); watch(p, 'C');
  await p.goto('http://127.0.0.1:18810/'); await p.waitForTimeout(900);
  await toInput(p); await p.fill('#deckText', '1 Sol Ring'); await toInput(p); await p.click('#btnSave'); await sheetOpen(p);
  assert.equal(await p.$('#svLogin'), null); ok('C : pas de lien de connexion si indisponible');
  await p.fill('#svName', 'Local seulement'); await p.click('#svGo'); await sheetGone(p);
  await D(p); assert.equal(await T(p, '.deck-name'), 'Local seulement'); assert.equal(await T(p, '#decksSyncTxt'), 'Sur cet appareil'); assert.equal(await p.$eval('#decksSync', e => e.disabled), true); await H(p); ok('C : enregistrement local OK, libellé « Sur cet appareil »');
  await p.click('#btnAccount'); await sheetOpen(p); await p.waitForSelector('#acRetry');
  assert.match(await T(p, '.sheet-body'), /indisponible/i); await p.waitForTimeout(500); await shot(p, 'C1-compte-indisponible'); ok('C : feuille compte → message + « Réessayer »');
  await ctx.close();
}

/* ═══ D. Sombre + petit écran (360 px) ═══════════════════════════════════════════════════════ */
{
  const ctx = await newCtx({ colorScheme: 'dark', viewport: { width: 360, height: 740 } }); await wireFirebase(ctx); const p = await ctx.newPage(); watch(p, 'D');
  await p.goto('http://127.0.0.1:18800/'); await p.waitForTimeout(900);
  const ovf = async n => { const o = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(o[0] <= o[1], `débordement horizontal @${n}: ${o}`); };
  await p.evaluate(() => { for (const [i, n] of ['Cloud, Midgar Mercenary', 'Un nom de deck vraiment très très long qui doit être tronqué proprement'].entries()) { const doc = deckDoc({ name: n, text: '1 Sol Ring\n1 Swords to Plowshares', history: [{ at: Date.now() - 86400000 * 3, total: 31672, mode: 'zero', found: 2, count: 2, sig: 'fr|Slightly Played|no' }, { at: Date.now() - 3600000, total: 28450 + i * 100, mode: 'zero', found: 2, count: 2, sig: 'fr|Slightly Played|no' }] }); D.localList.unshift({ id: 'seed' + i, ...doc }); } localWrite(D.localList); renderDecks(); });
  await D(p); await p.waitForTimeout(700); await ovf('liste'); await shot(p, 'D1-sombre-360-liste');
  await p.click('.deck:first-child .deck-more'); await sheetOpen(p); await p.waitForTimeout(700); await ovf('feuille deck'); await shot(p, 'D2-sombre-360-deck'); await p.keyboard.press('Escape'); await sheetGone(p); await H(p);
  await p.click('#btnAccount'); await sheetOpen(p); await p.waitForSelector('#acForm'); await p.waitForTimeout(700); await ovf('compte'); await shot(p, 'D3-sombre-360-compte'); await p.keyboard.press('Escape'); await sheetGone(p);
  await ctx.close();
}


/* ═══ E. Serveur réservé à un compte Firebase (ALLOWED_UIDS) : plus de clé à saisir ═══════════ */
{
  users.set('beer@test.dev', { uid: 'uid-allowed', pw: 'secret12' }); users.set('intrus@test.dev', { uid: 'uid-intrus', pw: 'secret12' });
  const login = async (p, email) => { await p.click('#btnAccount'); await sheetOpen(p); await p.waitForSelector('#acForm'); await p.waitForTimeout(500); await p.fill('#acEmail', email); await p.fill('#acPw', 'secret12'); await p.click('#acGo'); await sheetGone(p); await p.waitForTimeout(600); };
  const ctx = await newCtx(); await wireFirebase(ctx); const p = await ctx.newPage(); watch(p, 'E'); const apiReq = [];
  p.on('request', r => { if (/\/api\//.test(r.url())) apiReq.push({ url: r.url(), h: r.headers() }); }); await pxRoute(p);
  await p.goto('http://127.0.0.1:18820/'); await p.waitForTimeout(1000);
  assert.equal(await p.evaluate(() => CTX.needsLogin), true); assert.equal(await p.evaluate(() => CTX.needsKey), false); ok('E : le serveur annonce « réservé aux comptes », pas de clé');
  await toInput(p); await p.fill('#deckText', DECK4); await p.waitForTimeout(250);
  await toInput(p); await p.click('#btnRun'); await p.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => S.run.src), 'cm'); assert.equal(apiReq.length, 0, 'aucune requête /api/ sans compte'); ok('E : sans compte → prix Cardmarket, aucune requête CardTrader partie');
  await login(p, 'beer@test.dev'); assert.equal(await p.$eval('#btnAccount', e => e.dataset.in), '1'); ok('E : connexion avec le compte autorisé');
  await toInput(p); await p.click('#btnRun'); await runDone(p);
  assert.ok(apiReq.length > 0 && apiReq.every(r => r.h['x-firebase-token'] && r.h['x-firebase-token'].split('.').length === 3), 'chaque requête /api/ porte le jeton Firebase');
  assert.ok(apiReq.every(r => !r.h['x-app-key']), 'aucune clé partagée envoyée');
  assert.match(await T(p, '#heroCount'), /3 \/ 4 cartes/); ok('E : recherche complète avec le compte autorisé (' + apiReq.length + ' requêtes, toutes avec jeton)');
  await p.click('#btnSettings'); await sheetOpen(p); await p.waitForTimeout(600);
  assert.match(await T(p, '#connStatus'), /CardTrader via le serveur \(compte autorisé\)/); assert.equal(await p.$eval('#boxKey', e => e.hidden), true); ok('E : réglages — statut « connecté », pas de champ de clé');
  await p.keyboard.press('Escape'); await sheetGone(p);
  await p.click('#btnAccount'); await sheetOpen(p); await p.waitForSelector('#acUid');
  assert.equal(await T(p, '#acUid'), 'uid-allowed'); assert.match(await T(p, '.sheet-body'), /réservé aux comptes autorisés/); await p.waitForTimeout(500); await shot(p, 'E1-compte-uid'); ok('E : Compte affiche l\'identifiant (UID) et l\'état du serveur');
  await p.keyboard.press('Escape'); await sheetGone(p);
  await ctx.close();

  // suppression du compte : lien de la politique de confidentialité, reconnexion exigée, échec réseau sans rien casser
  { const cx = await newCtx(); await wireFirebase(cx); const r = await cx.newPage(); watch(r, 'DEL');
    await r.goto('http://127.0.0.1:18820/?delete-account'); await sheetOpen(r); await r.waitForSelector('#acForm');
    assert.match(await T(r, '.sheet-body'), /Connecte-toi au compte à supprimer/); assert.equal(await r.evaluate(() => location.search), ''); ok('?delete-account : Compte s\'ouvre en mode suppression (connexion demandée), adresse nettoyée');
    await r.fill('#acEmail', 'beer@test.dev'); await r.fill('#acPw', 'secret12'); await r.click('#acGo'); await sheetGone(r); await r.waitForTimeout(600);
    await r.click('#btnAccount'); await sheetOpen(r); await r.waitForSelector('#acDel'); await r.click('#acDel');
    await r.waitForSelector('#acDelGo'); assert.match(await T(r, '.sheet-body'), /Suppression définitive de beer@test\.dev/); assert.equal(await r.$eval('#acWipeLocal', e => e.checked), true); ok('Compte › Supprimer mon compte : avertissement, case « effacer aussi cet appareil » cochée');
    await r.click('#acDelGo'); assert.match(await T(r, '#acMsg'), /mot de passe/i);
    await r.fill('#acDelPw', 'faux'); await r.click('#acDelGo'); await r.waitForFunction(() => /incorrect/.test(document.querySelector('#acMsg').textContent), null, { timeout: 5000 }); ok('mauvais mot de passe : refusé, rien n\'est effacé');
    await r.fill('#acDelPw', 'secret12'); await r.click('#acDelGo');
    await r.waitForFunction(() => /Suppression impossible/.test(document.querySelector('#acMsg').textContent), null, { timeout: 20000 });
    assert.equal(await r.evaluate(() => D.uid), 'uid-allowed'); assert.equal(await r.$eval('#acDelGo', e => e.disabled), false); assert.ok(!idLog.includes('accounts:delete'), 'le compte n\'est pas supprimé tant que ses données ne le sont pas'); ok('serveur injoignable : message, compte et synchronisation intacts, le compte n\'est pas supprimé avant ses données');
    await r.click('#acDelNo'); await r.waitForSelector('#acDel'); ok('Annuler : retour à la fiche du compte');
    await cx.close(); }

  // compte connecté mais non autorisé
  const ctx2 = await newCtx(); await wireFirebase(ctx2); const q = await ctx2.newPage(); watch(q, 'E2');
  const qReq = []; q.on('request', r => { if (/\/api\//.test(r.url())) qReq.push(r.url()); }); await pxRoute(q);
  await q.goto('http://127.0.0.1:18820/'); await q.waitForTimeout(1000); await login(q, 'intrus@test.dev');
  await toInput(q); await q.fill('#deckText', DECK4); await q.waitForTimeout(250); await toInput(q); await q.click('#btnRun');
  await q.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 15000 });
  assert.equal(await q.evaluate(() => [S.run.src, CTX.serverOk].join()), 'cm,false'); assert.equal(await T(q, '#modeLabel'), 'Cardmarket'); assert.equal(qReq.length, 0);
  ok('E : compte non autorisé → prix Cardmarket (jamais le token du serveur), aucune requête CardTrader');
  await q.click('#btnAccount'); await sheetOpen(q); await q.waitForSelector('#acUid'); assert.equal(await T(q, '#acUid'), 'uid-intrus'); ok('E : Compte affiche l\'UID à copier');
  await ctx2.close();

  // jeton falsifié envoyé à la main : refusé par le proxy
  const forged = await (await fetch('http://127.0.0.1:18820/api/info', { headers: { 'x-firebase-token': jwt('uid-allowed', 'beer@test.dev').split('.').slice(0, 2).join('.') + '.AAAA' } })).status;
  assert.equal(forged, 401); const none = await fetch('http://127.0.0.1:18820/api/info'); assert.equal(none.status, 401); ok('E : jeton falsifié ou absent → 401');
}

console.log('\nERREURS PAGE :', errs.length ? '\n' + errs.join('\n') : 'aucune');
await browser.close(); proxy.kill(); proxyG.kill(); jwks.close(); up.close(); stat.close();
process.exit(errs.length ? 1 : 0);
