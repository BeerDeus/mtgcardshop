// E2E "live" : proxy réel → faux CardTrader ; Scryfall intercepté par Playwright.
import './setup-env.mjs';
const toInput = p => p.evaluate(() => { if (S.view !== 'input') showView('input'); }), toHome = p => p.evaluate(() => { if (S.view !== 'home') showView('home'); });      // accueil ↔ « Nouveau panier »
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { routeFonts } from './fonts.mjs';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const prod = (id, bp, user, cents, cond, lang, extra = {}) => ({
  id, blueprint_id: bp, name_en: 'x', quantity: extra.qty || 2, graded: false, on_vacation: false, bundle_size: 1,
  price: { cents, currency: 'EUR' }, properties_hash: { condition: cond, mtg_language: lang, mtg_foil: false },
  expansion: { code: extra.set || 'cmm', name_en: 'x' }, user: { id: user.id, username: user.name, country_code: user.cc, can_sell_via_hub: user.hub },
});
const D = { id: 4, name: 'seller_d', cc: 'FR', hub: false };
const A = { id: 1, name: 'seller_a', cc: 'FR', hub: true }, B = { id: 2, name: 'seller_b', cc: 'DE', hub: true }, C = { id: 3, name: 'seller_c', cc: 'IT', hub: true };
const PRODUCTS = {
  '100|fr': [prod(9001, 100, A, 150, 'Near Mint', 'fr'), prod(9002, 100, B, 120, 'Slightly Played', 'fr', { qty: 1 })],
  '200|fr': [prod(9003, 200, C, 90, 'Played', 'fr', { set: 'c21' })],
  '101|fr': [prod(9004, 101, A, 200, 'Near Mint', 'fr')],
  '102|fr': [], '102|en': [prod(9005, 102, B, 30, 'Near Mint', 'en')],
  // cartes dont les offres FR existent mais aucune n'est compatible Zero (vendeur sans hub) ; EN compatible Zero
  '300|fr': [prod(9010, 300, D, 100, 'Near Mint', 'fr')], '300|en': [prod(9011, 300, B, 50, 'Near Mint', 'en')],
  '301|fr': [prod(9012, 301, D, 80, 'Near Mint', 'fr')], '301|en': [prod(9013, 301, B, 40, 'Near Mint', 'en')],
};
const EXPS = [{ id: 1, game_id: 1, code: 'cmm', name: 'Commander Masters' }, { id: 2, game_id: 1, code: 'c21', name: 'Commander 2021' }, { id: 3, game_id: 2, code: 'zzz', name: 'Pokemon' }];
const BPS = { 1: [{ id: 100, name: 'Sol Ring', scryfall_id: 's-sr-cmm' }, { id: 101, name: 'Swords to Plowshares', scryfall_id: 's-stp-cmm' }, { id: 102, name: "Ranger's Hawk", scryfall_id: 's-rh-cmm' }, { id: 300, name: 'Arcane Signet', scryfall_id: 's-as-cmm' }, { id: 301, name: 'Wrath of God', scryfall_id: 's-wog-cmm' }],
  2: [{ id: 200, name: 'Sol Ring', scryfall_id: 's-sr-c21' }] };
const PRINTS = {
  'Sol Ring': [{ id: 's-sr-cmm', set: 'cmm', set_name: 'Commander Masters', collector_number: '400', name: 'Sol Ring' }, { id: 's-sr-c21', set: 'c21', set_name: 'Commander 2021', collector_number: '263', name: 'Sol Ring' }],
  'Swords to Plowshares': [{ id: 's-stp-cmm', set: 'cmm', set_name: 'Commander Masters', collector_number: '85', name: 'Swords to Plowshares' }],
  "Ranger's Hawk": [{ id: 's-rh-cmm', set: 'cmm', set_name: 'Commander Masters', collector_number: '99', name: "Ranger's Hawk" }],
  'Arcane Signet': [{ id: 's-as-cmm', set: 'cmm', set_name: 'Commander Masters', collector_number: '300', name: 'Arcane Signet' }],
  'Wrath of God': [{ id: 's-wog-cmm', set: 'cmm', set_name: 'Commander Masters', collector_number: '301', name: 'Wrath of God' }],
};

const namesIn = q => [...String(q).matchAll(/!"(.+?)"/g)].map(m => m[1]);   // la recherche groupée envoie (!"A" or !"B" …)
const printsFor = q => namesIn(q).flatMap(n => PRINTS[n] || []);

let prodDelay = 0; const log = []; const cartState = []; let cartDelay = 0; const failAdd = new Map(), failRemove = new Set(); const later = fn => cartDelay ? setTimeout(fn, cartDelay) : fn();
const up = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const path = u.pathname.replace('/api/v2/', ''); log.push({ m: req.method, path, q: Object.fromEntries(u.searchParams), body, auth: req.headers.authorization });
    const send = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (path === 'info') return send({ id: 1, name: 'Deck Deal test' });
    if (path === 'expansions') return send(EXPS);
    if (path === 'blueprints/export') return send(BPS[u.searchParams.get('expansion_id')] || []);
    if (path === 'marketplace/products') { const bp = u.searchParams.get('blueprint_id'); const go = () => send({ [bp]: PRODUCTS[bp + '|' + u.searchParams.get('language')] || [] }); return prodDelay ? setTimeout(go, prodDelay) : go(); }
    if (path === 'cart/add') return later(() => { const bd = JSON.parse(body || '{}'); if (failAdd.has(bd.product_id)) return send({ error: 'Product not available' }, failAdd.get(bd.product_id)); send({ ok: true }); });
    if (path === 'cart/remove') return later(() => { const bd = JSON.parse(body || '{}'); if (failRemove.has(bd.product_id)) return send({ error: 'cannot remove' }, 422); const i = cartState.findIndex(x => String(x.pid) === String(bd.product_id)); if (i < 0 || bd.quantity !== cartState[i].q) return send({ error: 'bad remove' }, 422); cartState.splice(i, 1); send({ ok: true }); });
    if (path === 'cart') return send({ subtotal: { cents: 350, currency: 'EUR' }, ct_zero_fee_amount: { cents: 25, currency: 'EUR' }, shipping_cost: { cents: 0, currency: 'EUR' },
      subcarts: cartState.length ? [{ id: 1, seller: { username: 'seller_b' }, cart_items: cartState.map(x => ({ quantity: x.q, price_cents: 100, price_currency: 'EUR', product: { id: String(x.pid), name_en: x.name } })) }] : [] });
    send({ error: 'nope' }, 404);
  });
});
await new Promise(r => up.listen(0, '127.0.0.1', r));
const proxy = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: '18800', CARDTRADER_TOKEN: 'tok', CT_UPSTREAM: `http://127.0.0.1:${up.address().port}/api/v2` }, stdio: 'ignore' });
process.on('exit', () => { try { proxy.kill(); } catch {} });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
const scry = []; const flaky = new Set(['Swords to Plowshares']); let scryAborts = 0; const tooMany = new Set(["Ranger's Hawk"]); let scry429 = 0; const scryT = [];
await p.route('https://api.scryfall.com/**', route => {
  const u = new URL(route.request().url()); scry.push(u.pathname + u.search); scryT.push(Date.now());
  const h = { 'access-control-allow-origin': '*' };
  if (u.pathname === '/cards/search') {
    const names = namesIn(u.searchParams.get('q'));
    if (names.some(n => flaky.delete(n))) { scryAborts++; return route.abort('failed'); } // coupure réseau ponctuelle : doit être rattrapée
    if (names.some(n => tooMany.delete(n))) { scry429++; return route.fulfill({ status: 429, headers: { ...h, 'access-control-expose-headers': 'retry-after' }, json: { object: 'error', code: 'rate_limited' } }); } // 429 : attente puis reprise
    const data = printsFor(u.searchParams.get('q'));
    if (data.length) return route.fulfill({ status: 200, headers: h, json: { object: 'list', has_more: false, data } });
    return route.fulfill({ status: 404, headers: h, json: { object: 'error', code: 'not_found' } });
  }
  return route.fulfill({ status: 404, headers: h, json: { object: 'error' } });
});
await routeFonts(p);

await p.goto('http://127.0.0.1:18800/'); await p.waitForTimeout(800);
await p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
const chip = await p.textContent('#modeLabel'); console.log('mode :', chip.trim()); assert.notEqual(chip.trim(), 'Démo', 'proxy détecté → mode live');
await toInput(p); await p.fill('#deckText', '1 Sol Ring\n1 Swords to Plowshares\n1 Ranger\'s Hawk\n1 Phantom Card\n5 Plains');
await p.waitForTimeout(300);
console.log('stats :', (await p.textContent('#deckStats')).replace(/\s+/g, ' ').trim());
await p.screenshot({ path: 'shots/live-1-saisie.png' });
await toInput(p); await p.click('#btnRun');
await p.waitForFunction(() => /terminée/.test(document.querySelector('#progTitle').textContent), null, { timeout: 30000 }).catch(async e => { console.log('DIAG', await p.evaluate(() => document.querySelector('#progTitle').textContent + ' | ' + [...document.querySelectorAll('.step')].map(x => x.innerText.replace(/\s+/g, ' ')).join(' / ') + ' | ' + document.querySelector('#alerts').innerText + ' | ' + document.querySelector('#progRate').innerText), errs, log.slice(-6).map(l => l.m + ' ' + l.path)); throw e; });
await p.waitForTimeout(1200);
const hero = (await p.textContent('#heroAmt')).replace(/\s+/g, ' ').trim();
console.log('hero :', hero, '|', (await p.textContent('#heroCount')).trim(), '|', (await p.textContent('#alerts')).replace(/\s+/g, ' ').trim());
await p.screenshot({ path: 'shots/live-2-resultats.png' });
assert.match(hero, /^3,50/, 'total attendu 1,20 + 2,00 + 0,30 = 3,50');
const recapTxt = (await p.textContent('#recap')).replace(/\s+/g, ' ').trim(); console.log('récap :', recapTxt);
assert.match(recapTxt, /3 \/ 4 cartes trouvées/); assert.match(recapTxt, /2 français/); assert.match(recapTxt, /1 anglais/); assert.match(recapTxt, /Français · état ≥ SP/);
const flags = await p.$$eval('#list .row svg.flag', f => f.map(x => x.getAttribute('aria-label')));
assert.deepEqual(flags, ['français', 'français', 'anglais'], 'drapeau de la langue de chaque carte trouvée');
const rows = await p.$$eval('#list .row', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
console.log(rows.join('\n'));
assert.equal(rows.length, 4);
assert.ok(await p.$('#list .row.is-missing'), 'Phantom Card signalée');
assert.ok(/seller_b/.test(rows[0]) && /120|1,20/.test(rows[0]), 'Sol Ring → seller_b 1,20 € (la Played de seller_c est exclue)');
assert.ok(/EN/.test(rows[2]) && /seller_b/.test(rows[2]), 'Ranger\'s Hawk : repli EN');

// requêtes
const prodReq = log.filter(l => l.path === 'marketplace/products');
assert.ok(prodReq.every(l => l.auth === 'Bearer tok'), 'Bearer ajouté par le proxy');
assert.ok(prodReq.filter(l => l.q.language === 'fr').length >= 4, 'requêtes FR');
assert.ok(prodReq.some(l => l.q.language === 'en' && l.q.blueprint_id === '102'), 'requête EN de repli');
assert.equal(log.filter(l => l.path === 'blueprints/export').length, 2, '1 export par extension utile (cmm, c21)');
assert.ok(!scry.some(s => /Plains/.test(decodeURIComponent(s))), 'basics non cherchés');
console.log('requêtes CT :', log.length, '| Scryfall :', scry.length);
{ const gaps = scryT.slice(1).map((t, i) => t - scryT[i]); console.log('écarts Scryfall (ms) :', gaps.join(' ')); assert.ok(Math.min(...gaps) >= 450, 'Scryfall : jamais plus de ~2 req/s'); }
assert.equal(scryAborts, 1, 'une coupure Scryfall simulée'); assert.equal(scry429, 1, 'un 429 Scryfall simulé'); // le total 3,50 déjà vérifié plus haut prouve que la recherche a été retentée

// panier
await p.click('#btnCart'); await p.waitForTimeout(700);
await p.screenshot({ path: 'shots/live-3-panier-confirm.png' });
const go = p.locator('#sheetRoot button', { hasText: 'Remplir le panier' });
await go.click();
await p.waitForFunction(() => /ajoutée/.test(document.querySelector('#sheetRoot').textContent), null, { timeout: 15000 });
await p.waitForTimeout(500);
await p.screenshot({ path: 'shots/live-4-panier-fini.png' });
const sheet = (await p.textContent('#sheetRoot')).replace(/\s+/g, ' ');
console.log('panier :', sheet.slice(0, 300));
const adds = log.filter(l => l.path === 'cart/add').map(l => JSON.parse(l.body));
console.log('cart/add :', JSON.stringify(adds));
assert.deepEqual(adds.map(a => a.product_id).sort(), [9002, 9004, 9005]);
assert.ok(adds.every(a => a.via_cardtrader_zero === true && a.quantity === 1));
assert.ok(/Frais CardTrader Zero/.test(sheet) && /0,25/.test(sheet), 'totaux réels lus via GET /cart');
assert.ok(await p.$('#sheetRoot a[href="https://www.cardtrader.com/fr-FR/cart/edit"]'), 'lien vers le panier CardTrader fr-FR/cart/edit');
assert.ok(!log.some(l => /purchase/.test(l.path)), 'jamais d\'achat');
assert.deepEqual(errs, [], 'aucune erreur page');
// coupure persistante : message qui nomme Scryfall (nouveau contexte = cache vide)
{
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p2 = await ctx2.newPage();
  await p2.route('https://api.scryfall.com/**', r => r.abort('failed'));
  await routeFonts(p2);
  await p2.goto('http://127.0.0.1:18800/'); await p2.waitForTimeout(800);
  await p2.evaluate(() => { BACKOFF.scry = [60, 60, 60]; });
  await toInput(p2); await p2.fill('#deckText', '1 Sol Ring\n1 Swords to Plowshares');
  await p2.waitForTimeout(300); await toInput(p2); await p2.click('#btnRun');
  await p2.waitForFunction(() => /Scryfall ne répond plus/.test(document.querySelector('#alerts').textContent), null, { timeout: 30000 });
  const msg = (await p2.textContent('#alerts')).replace(/\s+/g, ' ').trim();
  console.log('erreur persistante :', msg);
  assert.match(msg, /Scryfall ne répond plus/, 'le service en cause est nommé');
  const until = await p2.evaluate(() => Number(localStorage.getItem('deckdeal:scry-until')));
  assert.ok(until > Date.now() + 60000, 'cooldown mémorisé après échec persistant');
  assert.match(msg, /en cache/, 'indique que la reprise est possible');
  await ctx2.close();
}
// cooldown mémorisé : un lancement pendant le blocage attend au lieu de marteler Scryfall
{
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx3.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('deckdeal:scry-until', String(Date.now() + 4500)); } });
  const p3 = await ctx3.newPage(); const t3 = [];
  await p3.route('https://api.scryfall.com/**', route => { t3.push(Date.now()); const u = new URL(route.request().url()); return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, json: { object: 'list', has_more: false, data: printsFor(u.searchParams.get('q')) } }); });
  await routeFonts(p3);
  await p3.goto('http://127.0.0.1:18800/'); await p3.waitForTimeout(800);
  await toInput(p3); await p3.fill('#deckText', '1 Sol Ring'); await p3.waitForTimeout(300);
  const tRun = Date.now(); await toInput(p3); await p3.click('#btnRun');
  await p3.waitForFunction(() => /Scryfall en pause/.test(document.body.innerText), null, { timeout: 5000 });
  console.log('pause visible ✓');
  await p3.waitForFunction(() => /terminée/.test(document.querySelector('#progTitle').textContent), null, { timeout: 30000 });
  assert.ok(t3[0] - tRun >= 2500, 'aucune requête Scryfall pendant le cooldown (' + (t3[0] - tRun) + ' ms après le clic)');
  console.log('cooldown respecté : 1re requête Scryfall', t3[0] - tRun, 'ms après le clic');
  await ctx3.close();
}
// repli anglais selon le mode (cas « Aucune offre compatible Zero ») + bouton « Trouver en anglais »
const mkPage = async (port = 18800) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const pg = await c.newPage(); const errs2 = [];
  pg.on('pageerror', e => errs2.push(e.message));
  await pg.route('https://api.scryfall.com/**', route => { const u = new URL(route.request().url()); return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, json: { object: 'list', has_more: false, data: printsFor(u.searchParams.get('q')) } }); });
  await routeFonts(pg);
  await pg.goto('http://127.0.0.1:' + port + '/'); await pg.waitForTimeout(800);
  return { c, pg, errs2 };
};
const runDeck = async (pg, text) => {
  await toInput(pg); await pg.fill('#deckText', text); await pg.waitForTimeout(300); await toInput(pg); await pg.click('#btnRun');
  await pg.waitForFunction(() => /terminée/.test(document.querySelector('#progTitle').textContent), null, { timeout: 30000 });
  await pg.waitForTimeout(600);
};
const rowsOf = pg => pg.$$eval('#list .row', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
{
  // A) repli automatique : FR non-hub seulement → l'anglais compatible Zero est ajouté, sans écraser les offres FR
  const { c, pg, errs2 } = await mkPage();
  await runDeck(pg, '1 Arcane Signet\n1 Wrath of God');
  let rows = await rowsOf(pg); console.log('Zero + repli auto :', rows.join(' | '));
  assert.ok(rows.every(r => /seller_b/.test(r) && /EN/.test(r)), 'Zero : offres EN (hub) retenues automatiquement');
  assert.equal(await pg.$$eval('#list .row svg.flag[aria-label="anglais"]', x => x.length), 2);
  assert.equal(((await pg.textContent('#alerts')) || '').includes('sans offre'), false, 'plus d\'alerte « sans offre »');
  await pg.evaluate(() => { S.opts.mode = 'direct'; $('#segMode').setValue('direct'); syncSegDeliv(); recompute(); });
  await pg.waitForTimeout(500);
  rows = await rowsOf(pg); console.log('Direct (mêmes offres) :', rows.join(' | '));
  assert.ok(rows.every(r => /seller_d/.test(r)), 'Direct : l\'offre FR de seller_d reste prioritaire malgré l\'EN moins chère');
  assert.equal(await pg.$$eval('#list .row svg.flag[aria-label="français"]', x => x.length), 2);
  assert.deepEqual(errs2, []); await c.close();
}
{
  // B) repli désactivé → alerte + bouton « Trouver en anglais » pour toutes les cartes concernées
  const { c, pg, errs2 } = await mkPage();
  await pg.evaluate(() => { document.querySelector('#optFallback').checked = false; });
  await runDeck(pg, '1 Arcane Signet\n1 Wrath of God');
  const al = (await pg.textContent('#alerts')).replace(/\s+/g, ' ');
  console.log('alertes :', al.trim());
  assert.match(al, /2 cartes sans offre compatible Zero/); assert.match(al, /Passer en Direct/); assert.match(al, /Trouver en anglais/);
  assert.equal((await rowsOf(pg)).filter(r => /Aucune offre compatible Zero/.test(r)).length, 2);
  await pg.click('#alerts button[data-act="en-all"]');
  await pg.waitForFunction(() => !/Trouver en anglais|Recherche en anglais/.test(document.querySelector('#alerts').textContent), null, { timeout: 15000 });
  await pg.waitForTimeout(400);
  const rows2 = await rowsOf(pg); console.log('après « Trouver en anglais » :', rows2.join(' | '));
  assert.ok(rows2.every(r => /seller_b/.test(r) && /EN/.test(r)), 'les 2 cartes trouvées en anglais');
  assert.match((await pg.textContent('#recap')).replace(/\s+/g, ' '), /2 \/ 2 cartes trouvées/);
  assert.deepEqual(errs2, []); await c.close();
}
// vider le panier CardTrader depuis les réglages
{
  const { c, pg, errs2 } = await mkPage();
  cartState.push({ pid: 9002, q: 1, name: 'Sol Ring' }, { pid: 9004, q: 2, name: 'Swords to Plowshares' }, { pid: 9005, q: 1, name: "Ranger's Hawk" });
  await pg.click('#btnSettings'); await pg.waitForSelector('#btnCartClear');
  assert.equal(await pg.$eval('#btnCartClear', b => b.disabled), false, 'actif hors démo');
  await pg.click('#btnCartClear');
  await pg.waitForSelector('#btnCartConfirm');
  const conf = (await pg.textContent('#cartBox')).replace(/\s+/g, ' ').trim(); console.log('confirmation :', conf);
  assert.match(conf, /4 exemplaires \(3 lignes/); assert.equal(cartState.length, 3, 'rien supprimé avant confirmation');
  await pg.click('#btnCartCancel'); await pg.waitForSelector('#btnCartClear'); assert.equal(cartState.length, 3, 'annuler ne supprime rien');
  await pg.click('#btnCartClear'); await pg.waitForSelector('#btnCartConfirm'); await pg.click('#btnCartConfirm');
  await pg.waitForFunction(() => /Panier vidé/.test(document.querySelector('#cartBox').textContent), null, { timeout: 15000 });
  console.log('résultat :', (await pg.textContent('#cartBox')).replace(/\s+/g, ' ').trim());
  assert.equal(cartState.length, 0, 'panier vidé côté CardTrader');
  const removes = log.filter(l => l.path === 'cart/remove').map(l => JSON.parse(l.body));
  assert.deepEqual(removes.map(r => [r.product_id, r.quantity]), [[9002, 1], [9004, 2], [9005, 1]], 'quantité exacte de chaque ligne');
  assert.ok(!log.some(l => /purchase/.test(l.path)));
  await pg.click('#btnCartAgain'); await pg.waitForFunction(() => /déjà vide/.test(document.querySelector('#cartBox').textContent));
  assert.deepEqual(errs2, []); await c.close();
}

// pastilles flottantes : le panier se vide en arrière-plan quand on ferme les réglages
{
  const { c, pg, errs2 } = await mkPage();
  cartDelay = 450;
  cartState.push({ pid: 9002, q: 1, name: 'Sol Ring' }, { pid: 9004, q: 2, name: 'Swords to Plowshares' }, { pid: 9005, q: 1, name: "Ranger's Hawk" }, { pid: 9010, q: 1, name: 'Arcane Signet' }, { pid: 9011, q: 3, name: 'Wrath of God' });
  await pg.click('#btnSettings'); await pg.waitForSelector('#btnCartClear');
  await pg.click('#btnCartClear'); await pg.waitForSelector('#btnCartConfirm'); await pg.click('#btnCartConfirm');
  await pg.waitForFunction(() => /Suppression… [1-9]/.test(document.querySelector('#cartBox').textContent), null, { timeout: 5000 });
  assert.equal(await pg.$eval('#tasks .task', el => el.classList.contains('hide')), true, 'pastille cachée tant que les réglages (qui montrent déjà la progression) sont ouverts');
  await pg.click('.sheet-wrap.open [data-close].icon-btn'); // on baisse le menu
  await pg.waitForSelector('#tasks .task.in', { timeout: 3000 });
  const inCount = cartState.length; assert.ok(inCount > 0 && inCount <= 5, 'la suppression est en cours quand la pastille apparaît (' + inCount + ' lignes restantes)');
  await pg.waitForTimeout(650); // fin des transitions (glissement + descente de la pile)
  const bb = await pg.$eval('#tasks .task', el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth }; });
  console.log('pastille :', JSON.stringify(bb), '|', (await pg.textContent('#tasks .task')).replace(/\s+/g, ' ').trim());
  assert.ok(bb.r <= bb.w - 8 && bb.r >= bb.w - 20, 'collée à droite'); assert.ok(bb.t >= 40 && bb.b < 160, 'en haut'); assert.ok(bb.l >= 0, 'dans l\'écran');
  assert.match(await pg.textContent('#tasks .task'), /Vidage du panier/);
  await pg.screenshot({ path: 'shots/live-5-pastille-encours.png' });
  await pg.waitForSelector('#tasks .task.ok', { timeout: 10000 });
  assert.equal(cartState.length, 0, 'panier vidé malgré la fenêtre fermée');
  const fin = (await pg.textContent('#tasks .task')).replace(/\s+/g, ' ').trim(); console.log('pastille finale :', fin);
  assert.match(fin, /Panier CardTrader vidé/); assert.match(fin, /5 lignes retirées/);
  await pg.screenshot({ path: 'shots/live-6-pastille-ok.png' });
  await pg.waitForFunction(() => !document.querySelector('#tasks .task'), null, { timeout: 9000 }); // disparaît seule
  await pg.click('#btnSettings'); await pg.waitForSelector('#cartBox');
  assert.equal(await pg.$$eval('#tasks .task', x => x.length), 0);
  cartDelay = 0; assert.deepEqual(errs2, []); await c.close();
}
// pastille de recherche : visible dès qu'une fenêtre est ouverte ou que la barre de progression sort de l'écran
{
  prodDelay = 1200;      // la recherche doit rester en cours pendant les défilements et l'ouverture des réglages (sinon, machine chargée, elle finit avant)
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const pg = await c.newPage(); const errs2 = []; pg.on('pageerror', e => errs2.push(e.message));
  await pg.route('https://api.scryfall.com/**', async route => { await new Promise(r => setTimeout(r, 1600));      /* lent : la recherche dure pendant toute la séquence (les offres CardTrader, déjà en cache côté proxy, reviennent vite) */ const u = new URL(route.request().url()); return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, json: { object: 'list', has_more: false, data: printsFor(u.searchParams.get('q')) } }); });
  await routeFonts(pg);
  await pg.goto('http://127.0.0.1:18800/'); await pg.waitForTimeout(800);
  await toInput(pg); await pg.fill('#deckText', '1 Sol Ring\n1 Swords to Plowshares\n1 Arcane Signet\n1 Wrath of God'); await pg.waitForTimeout(300);
  await toInput(pg); await pg.click('#btnRun'); await pg.waitForSelector('#tasks .task', { state: 'attached' });
  const hidden = () => pg.$eval('#tasks .task', el => el.classList.contains('hide'));
  await pg.waitForTimeout(500);
  assert.equal(await hidden(), true, 'barre de progression visible → pas de pastille');
  await pg.evaluate(() => { document.body.style.paddingBottom = '3000px'; window.scrollTo(0, 1400); });
  await pg.waitForSelector('#tasks .task.in', { timeout: 3000 });
  const txt = (await pg.textContent('#tasks .task')).replace(/\s+/g, ' ').trim(); console.log('pastille (scroll) :', txt);
  assert.match(txt, /Recherche des offres/); assert.match(txt, /\d+ %/);
  await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForFunction(() => document.querySelector('#tasks .task') && document.querySelector('#tasks .task').classList.contains('hide'), null, { timeout: 3000 });
  await pg.click('#btnSettings'); await pg.waitForSelector('#tasks .task.in', { timeout: 3000 });
  assert.equal(await pg.$eval('#tasks', el => el.classList.contains('over')), true, 'pile remontée sous une fenêtre ouverte');
  await pg.waitForSelector('#tasks .task.ok, #tasks .task.warn', { timeout: 30000 });
  prodDelay = 0;
  const end = (await pg.textContent('#tasks .task')).replace(/\s+/g, ' ').trim(); console.log('pastille (fin) :', end);
  assert.match(end, /Recherche terminée/); assert.match(end, /4 \/ 4 cartes avec offre/);
  await pg.click('.sheet-wrap.open [data-close].icon-btn'); await pg.waitForTimeout(500);
  assert.equal(await pg.$eval('#tasks', el => el.classList.contains('over')), false);
  await pg.click('#tasks .task'); await pg.waitForFunction(() => !document.querySelector('#tasks .task'), null, { timeout: 3000 }); // un tap la ferme
  assert.deepEqual(errs2, []); await c.close();
}

// panier : remplacement automatique des offres indisponibles
const DECK3 = "1 Sol Ring\n1 Swords to Plowshares\n1 Ranger's Hawk";
const sheetText = pg => pg.evaluate(() => document.querySelector('#sheetRoot').textContent.replace(/\s+/g, ' ').trim());
{
  const { c, pg, errs2 } = await mkPage(); await runDeck(pg, DECK3);
  assert.match((await pg.textContent('#heroAmt')).replace(/\s+/g, ' '), /3,50/);
  const i0 = log.length; failAdd.set(9002, 422);
  await pg.click('#btnCart'); await pg.waitForSelector('#btnGo'); await pg.click('#btnGo');
  await pg.waitForFunction(() => /remplacée/.test(document.querySelector('#sheetRoot').textContent), null, { timeout: 15000 });
  const t = await sheetText(pg); console.log('remplacement :', t.slice(0, 330));
  const adds = log.slice(i0).filter(l => l.path === 'cart/add').map(l => JSON.parse(l.body).product_id);
  assert.deepEqual(adds, [9002, 9001, 9004, 9005], 'tente 9002 (échec) puis la suivante moins chère 9001, puis le reste');
  assert.match(t, /3 offres ajoutées dont 1 remplacée/); assert.match(t, /Sol Ring : seller_b · 1,20 € → seller_a · 1,50 €/); assert.ok(!/non ajoutée/.test(t));
  assert.equal(await pg.evaluate(() => S.gone.has(9002)), true, 'offre indisponible mémorisée');
  await pg.waitForTimeout(500);
  assert.match((await pg.textContent('#heroAmt')).replace(/\s+/g, ' '), /3,80/, 'le total de la recherche tient compte de l\'offre disparue (1,50 + 2,00 + 0,30)');
  await pg.screenshot({ path: 'shots/live-7-remplacement.png' });
  failAdd.clear(); assert.deepEqual(errs2, []); await c.close();
}
{ // toutes les offres d'une carte indisponibles : échec signalé, le reste est ajouté
  const { c, pg, errs2 } = await mkPage(); await runDeck(pg, DECK3);
  const i0 = log.length; failAdd.set(9004, 404);
  await pg.click('#btnCart'); await pg.waitForSelector('#btnGo'); await pg.click('#btnGo');
  await pg.waitForFunction(() => /non ajoutée/.test(document.querySelector('#sheetRoot').textContent), null, { timeout: 15000 });
  const t = await sheetText(pg); console.log('sans remplaçante :', t.slice(0, 260));
  assert.match(t, /2 offres ajoutées/); assert.match(t, /1 non ajoutée/); assert.match(t, /Swords to Plowshares/);
  assert.deepEqual(log.slice(i0).filter(l => l.path === 'cart/add').map(l => JSON.parse(l.body).product_id), [9002, 9004, 9005]);
  failAdd.clear(); assert.deepEqual(errs2, []); await c.close();
}
{ // garde-fou : même erreur partout (ex. adresse refusée) → on n'enchaîne pas les remplacements
  const { c, pg, errs2 } = await mkPage();
  const r = await pg.evaluate(async () => {
    let calls = 0; const real = window.ct; window.ct = async () => { calls++; throw netErr('http', 'Erreur 422 : adresse invalide', { status: 422 }); };
    const mk = k => { const o = i => ({ id: k * 10 + i, productId: k * 10 + i, sellerId: k, seller: 's' + k, price: 100 + i, cur: 'EUR', qty: 4, hub: true }); return { offer: o(0), n: 1, name: 'C' + k, key: 'k' + k, alt: tried => [1, 2, 3].map(i => o(i)).filter(x => !tried.has(x.productId)).slice(0, 1).map(x => ({ offer: x, n: 1 })) }; };
    const res = await cartFill([1, 2, 3, 4, 5].map(mk), 'zero', null, undefined, () => {}, false);
    window.ct = real; return { calls, failed: res.failed.length, replaced: res.replaced.length, ok: res.ok };
  });
  console.log('garde-fou :', JSON.stringify(r));
  assert.equal(r.failed, 5); assert.equal(r.replaced, 0); assert.equal(r.ok, 0); assert.ok(r.calls <= 13, 'pas plus de 13 requêtes pour 5 lignes (sans garde-fou : 25) : ' + r.calls);
  assert.deepEqual(errs2, []); await c.close();
}
// panier : « vider d'abord » avec confirmation
{
  const { c, pg, errs2 } = await mkPage(); await runDeck(pg, DECK3);
  cartState.length = 0; cartState.push({ pid: 7001, q: 1, name: 'Vieille carte' }, { pid: 7002, q: 3, name: 'Autre carte' });
  const i0 = log.length;
  await pg.click('#btnCart'); await pg.waitForSelector('#cfClear'); await pg.click('.sheet-body .switch'); assert.equal(await pg.isChecked('#cfClear'), true); await pg.click('#btnGo');
  await pg.waitForSelector('#cfSure'); const conf = await sheetText(pg); console.log('confirmation :', conf.slice(0, 200));
  assert.match(conf, /4 exemplaires \(2 lignes/); assert.equal(cartState.length, 2, 'rien supprimé avant confirmation');
  await pg.click('#cfBack'); await pg.waitForSelector('#btnGo'); assert.equal(cartState.length, 2, 'annuler ne supprime rien'); assert.equal(log.slice(i0).filter(l => /cart\/(remove|add)/.test(l.path)).length, 0);
  await pg.click('.sheet-body .switch'); assert.equal(await pg.isChecked('#cfClear'), true); await pg.click('#btnGo'); await pg.waitForSelector('#cfSure'); await pg.click('#cfSure');
  await pg.waitForFunction(() => /ajoutées/.test(document.querySelector('#sheetRoot').textContent), null, { timeout: 15000 });
  const seq = log.slice(i0).filter(l => /cart\/(remove|add)/.test(l.path)).map(l => l.path + ':' + JSON.parse(l.body).product_id);
  console.log('séquence :', seq.join(' '));
  assert.deepEqual(seq, ['cart/remove:7001', 'cart/remove:7002', 'cart/add:9002', 'cart/add:9004', 'cart/add:9005'], 'on vide d\'abord (quantités exactes), puis on ajoute');
  assert.equal(cartState.length, 0); assert.ok(!log.some(l => /purchase/.test(l.path)));
  assert.deepEqual(errs2, []); await c.close();
}
{ // panier déjà vide : pas de confirmation, ajout direct
  const { c, pg, errs2 } = await mkPage(); await runDeck(pg, DECK3); cartState.length = 0;
  await pg.click('#btnCart'); await pg.waitForSelector('#cfClear'); await pg.click('.sheet-body .switch'); assert.equal(await pg.isChecked('#cfClear'), true); await pg.click('#btnGo');
  await pg.waitForFunction(() => /ajoutées/.test(document.querySelector('#sheetRoot').textContent), null, { timeout: 15000 });
  assert.equal(await pg.$('#cfSure'), null); assert.deepEqual(errs2, []); await c.close();
}
{ // vidage incomplet : on s'arrête, rien n'est ajouté, « Remplir quand même » possible
  const { c, pg, errs2 } = await mkPage(); await runDeck(pg, DECK3);
  cartState.length = 0; cartState.push({ pid: 7001, q: 1, name: 'Bloquée' }, { pid: 7002, q: 1, name: 'Libre' }); failRemove.add(7001);
  const i0 = log.length;
  await pg.click('#btnCart'); await pg.waitForSelector('#cfClear'); await pg.click('.sheet-body .switch'); assert.equal(await pg.isChecked('#cfClear'), true); await pg.click('#btnGo'); await pg.waitForSelector('#cfSure'); await pg.click('#cfSure');
  await pg.waitForSelector('#cfForce', { timeout: 15000 });
  const t = await sheetText(pg); console.log('vidage incomplet :', t.slice(0, 200)); assert.match(t, /pas pu être entièrement vidé/); assert.match(t, /Rien n'a été ajouté/);
  assert.equal(log.slice(i0).filter(l => l.path === 'cart/add').length, 0);
  failRemove.clear(); await pg.click('#cfForce');
  await pg.waitForFunction(() => /ajoutées/.test(document.querySelector('#sheetRoot').textContent), null, { timeout: 15000 });
  assert.equal(log.slice(i0).filter(l => l.path === 'cart/add').length, 3); assert.deepEqual(errs2, []); await c.close();
}
// Scryfall groupé : 34 cartes → quelques requêtes seulement (lots + pagination), faces doubles / « Æ » reconnues, inconnue → repli, 2e passage → cache
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const pg = await c.newPage(); const errs2 = []; pg.on('pageerror', e => errs2.push(e.message));
  const mk = (name, n, as = name) => Array.from({ length: n }, (_, i) => ({ id: `${name}-${i}`.replace(/\W/g, ''), set: 'zzz', set_name: 'Zzz', collector_number: String(i + 1), name: as }));
  const SYN = { 'Delver of Secrets': mk('Delver', 3, 'Delver of Secrets // Insectile Aberration'), 'Fire // Ice': mk('Fire', 3, 'Fire // Ice'), 'Aether Vial': mk('Vial', 3, 'Æther Vial') };
  const names = Array.from({ length: 30 }, (_, i) => 'Carte ' + String(i + 1).padStart(2, '0'));
  for (const n of names) SYN[n] = mk(n, 3);
  const PAGE = 20, urls = [];
  await pg.route('https://api.scryfall.com/**', route => {
    const u = new URL(route.request().url()), h = { 'access-control-allow-origin': '*' }; urls.push(u.pathname + '?' + decodeURIComponent(u.search.slice(1).replace(/\+/g, ' ')));
    if (u.pathname !== '/cards/search') return route.fulfill({ status: 404, headers: h, json: { object: 'error' } });
    const all = [...u.searchParams.get('q').matchAll(/!"(.+?)"/g)].flatMap(m => SYN[m[1]] || []);
    if (!all.length) return route.fulfill({ status: 404, headers: h, json: { object: 'error', code: 'not_found' } });
    const page = Number(u.searchParams.get('page') || 1), more = all.length > page * PAGE; const next = new URL(u); next.searchParams.set('page', String(page + 1));
    return route.fulfill({ status: 200, headers: h, json: { object: 'list', has_more: more, next_page: more ? next.toString() : undefined, data: all.slice((page - 1) * PAGE, page * PAGE) } });
  });
  await routeFonts(pg);
  await pg.goto('http://127.0.0.1:18800/'); await pg.waitForTimeout(800);
  const deck = [...names.map(n => '1 ' + n), '1 Delver of Secrets', '1 Fire // Ice', '1 Aether Vial', '1 Phantom Card'].join('\n');
  await runDeck(pg, deck);
  const batches = urls.filter(x => /\) game:paper/.test(x) && / or /.test(x)), pagesOf = urls.filter(x => /&page=\d/.test(x));
  console.log('Scryfall groupé :', urls.length, 'requêtes dont', batches.length, 'de lot,', pagesOf.length, 'pages suivantes');
  assert.ok(urls.length <= 8, 'moins de 9 requêtes pour 34 cartes (avant : 34+) : ' + urls.length);
  assert.ok(batches.length >= 3 && batches[0].split(' or ').length === 12, 'lots de 12 noms');
  assert.ok(pagesOf.length >= 3, 'pagination suivie (next_page)');
  const singles = urls.filter(x => !/ or /.test(x) && x.startsWith('/cards/search'));
  assert.equal(singles.length, 0, 'aucune recherche carte par carte : le lot a déjà fait la recherche exacte : ' + singles.join(' ; '));
  assert.equal(urls.filter(x => x.startsWith('/cards/named') && /Phantom/.test(x)).length, 1, 'inconnue : nom approchant demandé directement (1 requête)');
  const found = await pg.evaluate(() => S.deck.cards.map(c => [c.name, !!(S.run.cards[c.key] && S.run.cards[c.key].notFound), (S.run.cards[c.key] && S.run.cards[c.key].img) !== undefined]));
  const nf = found.filter(f => f[1]).map(f => f[0]); assert.deepEqual(nf, ['Phantom Card'], 'seule Phantom Card est introuvable (faces doubles et Æ reconnues) : ' + nf.join(','));
  // 2e passage : tout vient du cache (7 jours), seule l'inconnue (jamais mise en cache) est redemandée
  const n1 = urls.length; await pg.reload(); await pg.waitForTimeout(900); await runDeck(pg, deck); // rechargement : le cache vient d'IndexedDB
  console.log('2e passage :', urls.length - n1, 'requêtes');
  assert.equal(urls.length - n1, 2, 'cache : seule l\'inconnue est redemandée (exacte + approchante) : ' + (urls.length - n1)); assert.ok(!urls.slice(n1).some(x => / or /.test(x)), 'plus aucun lot');
  assert.deepEqual(errs2, []); await c.close();
}

// liste : tri, filtres, croix de retrait + annulation, lien CardTrader, vibrations
{
  const { c, pg, errs2 } = await mkPage();
  await pg.evaluate(() => { window.__vib = []; navigator.vibrate = p => { window.__vib.push(p); return true; }; });
  const DECK = "1 Sol Ring\n1 Swords to Plowshares\n1 Ranger's Hawk\n1 Phantom Card\n1 Arcane Signet";
  await runDeck(pg, DECK); await pg.waitForTimeout(500);
  const names = () => pg.$$eval('#list .rw:not([hidden]) .row-name', x => x.map(e => e.textContent.trim()));
  const settle = () => pg.waitForTimeout(450);
  const waitTotal = re => pg.waitForFunction(r => new RegExp(r).test(document.querySelector('#heroAmt').textContent.replace(/\s+/g, ' ').trim()), re, { timeout: 4000 }); // le montant s'anime sur ~0,6 s
  console.log('ordre du deck :', (await names()).join(' | '));
  assert.deepEqual(await names(), ['Sol Ring', 'Swords to Plowshares', "Ranger's Hawk", 'Phantom Card', 'Arcane Signet']);
  assert.equal(await pg.$$eval('#list .rw.scanned', x => x.length), 5, 'carte scannée → croix disponible sur toutes les lignes');
  await waitTotal('^4,00');

  // tri
  await pg.selectOption('#optSort', 'price-desc'); await settle();
  assert.deepEqual(await names(), ['Swords to Plowshares', 'Sol Ring', 'Arcane Signet', "Ranger's Hawk", 'Phantom Card'], 'plus chères d\'abord, sans prix à la fin');
  await pg.selectOption('#optSort', 'price-asc'); await settle();
  assert.deepEqual(await names(), ["Ranger's Hawk", 'Arcane Signet', 'Sol Ring', 'Swords to Plowshares', 'Phantom Card'], 'moins chères d\'abord, sans prix à la fin');
  await pg.selectOption('#optSort', 'name'); await settle();
  assert.deepEqual(await names(), ['Arcane Signet', 'Phantom Card', "Ranger's Hawk", 'Sol Ring', 'Swords to Plowshares'], 'A → Z');
  assert.equal(await pg.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:v1')).sort), 'name', 'tri mémorisé');
  await pg.selectOption('#optSort', 'deck'); await settle();
  assert.deepEqual(await names(), ['Sol Ring', 'Swords to Plowshares', "Ranger's Hawk", 'Phantom Card', 'Arcane Signet']);

  // filtres (puces avec compteurs ; « Choix manuel » absent tant que rien n'est choisi)
  const chips = () => pg.$$eval('#fchips .fchip', x => x.map(e => e.textContent.replace(/\s+/g, ' ').trim() + (e.getAttribute('aria-checked') === 'true' ? '*' : '')));
  console.log('puces :', (await chips()).join(' | '));
  assert.deepEqual(await chips(), ['Toutes5*', 'Sans offre1', 'Autre langue2']);
  await pg.click('#fchips [data-f="none"]'); await settle();
  assert.deepEqual(await names(), ['Phantom Card']);
  await pg.click('#fchips [data-f="lang"]'); await settle();
  assert.deepEqual(await names(), ["Ranger's Hawk", 'Arcane Signet'], 'cartes dans une autre langue que celle demandée');
  await pg.click('#fchips [data-f="all"]'); await settle();
  assert.equal((await names()).length, 5);

  // lien CardTrader + choix d'une offre (le lien n'est pas un choix)
  await pg.click('#list .row >> nth=0'); await pg.waitForSelector('.offer-row');
  const ext = await pg.$$eval('.offer-row .o-ext', a => a.map(x => [x.getAttribute('href'), x.getAttribute('target'), x.getAttribute('rel')]));
  console.log('liens CardTrader :', JSON.stringify(ext));
  assert.ok(ext.length >= 1 && ext.every(e => /^https:\/\/www\.cardtrader\.com\/cards\/\d+$/.test(e[0]) && e[1] === '_blank' && /noopener/.test(e[2])));
  assert.equal(await pg.$$eval('.offer-row .offer', x => x.length), ext.length);
  await pg.waitForTimeout(700); await pg.screenshot({ path: 'shots/live-8-fiche-lien.png' });
  await pg.click('.sheet-wrap.open [data-close].icon-btn'); await pg.waitForTimeout(500);

  // retrait d'une carte + annulation
  const textBefore = await pg.inputValue('#deckText'), vib0 = await pg.evaluate(() => window.__vib.length);
  await pg.click('#list .rw[data-key="sol ring"] .rx');
  await pg.waitForFunction(() => !document.querySelector('#list .rw[data-key="sol ring"]'), null, { timeout: 3000 });
  assert.equal((await pg.inputValue('#deckText')).includes('Sol Ring'), false, 'ligne retirée de la liste');
  await pg.waitForTimeout(350);
  await waitTotal('^2,80');
  assert.match((await pg.textContent('#heroCount')).trim(), /^3 \/ 4 cartes/);
  assert.equal(await pg.evaluate(() => cartParts().some(p => p.name === 'Sol Ring')), false, 'la carte retirée n\'est plus dans le panier');
  const toastTxt = (await pg.textContent('#toast')).replace(/\s+/g, ' ').trim(); console.log('toast :', toastTxt);
  assert.match(toastTxt, /Sol Ring retirée.*Annuler/);
  assert.match((await pg.textContent('#undoBar')).replace(/\s+/g, ' '), /Sol Ring retirée de la liste/);
  assert.ok((await pg.evaluate(() => window.__vib.length)) > vib0, 'vibration au retrait');
  await pg.screenshot({ path: 'shots/live-9-retrait.png' });
  await pg.click('#toast .toast-act');
  await pg.waitForSelector('#list .rw[data-key="sol ring"]'); await pg.waitForTimeout(400);
  assert.equal(await pg.inputValue('#deckText'), textBefore, 'annuler redonne exactement la liste d\'origine');
  await waitTotal('^4,00'); assert.equal(await pg.$eval('#undoBar', e => e.hidden), true);
  assert.deepEqual(await names(), ['Sol Ring', 'Swords to Plowshares', "Ranger's Hawk", 'Phantom Card', 'Arcane Signet'], 'la carte revient à sa place');
  assert.equal(await pg.evaluate(() => !!document.querySelector('#list .rw[data-key="sol ring"].scanned')), true, 'et reste scannée (pas de nouvelle recherche)');

  // plusieurs retraits, « Tout remettre », et une carte introuvable peut aussi être retirée
  await pg.click('#list .rw[data-key="swords to plowshares"] .rx'); await pg.waitForTimeout(350);
  await pg.click('#list .rw[data-key="phantom card"] .rx'); await pg.waitForTimeout(350);
  await pg.click('#list .rw[data-key="arcane signet"] .rx'); await pg.waitForTimeout(350);
  assert.match((await pg.textContent('#undoBar')).replace(/\s+/g, ' '), /3 cartes retirées de la liste/);
  assert.deepEqual(await names(), ['Sol Ring', "Ranger's Hawk"]);
  await waitTotal('^1,50');
  assert.equal(await pg.$eval('#heroDelta', e => e.hidden), true);
  await pg.click('#undoAll'); await pg.waitForTimeout(500);
  assert.equal(await pg.inputValue('#deckText'), textBefore, 'tout remettre : liste identique à l\'origine');
  assert.deepEqual(await names(), ['Sol Ring', 'Swords to Plowshares', "Ranger's Hawk", 'Phantom Card', 'Arcane Signet']);
  await waitTotal('^4,00');

  // un filtre qui se vide revient à « Toutes » ; tri + retrait ensemble
  await pg.click('#fchips [data-f="none"]'); await settle(); assert.deepEqual(await names(), ['Phantom Card']);
  await pg.click('#list .rw[data-key="phantom card"] .rx'); await pg.waitForTimeout(500);
  assert.equal((await names()).length, 4, 'plus aucune carte sans offre : le filtre se désactive seul'); assert.deepEqual(await chips(), ['Toutes4*', 'Autre langue2']);
  await pg.selectOption('#optSort', 'price-desc'); await settle();
  await pg.click('#list .rw[data-key="swords to plowshares"] .rx'); await pg.waitForTimeout(500);
  assert.deepEqual(await names(), ['Sol Ring', 'Arcane Signet', "Ranger's Hawk"]);
  await pg.click('#undoAll'); await pg.waitForTimeout(500);
  assert.deepEqual(await names(), ['Swords to Plowshares', 'Sol Ring', 'Arcane Signet', "Ranger's Hawk", 'Phantom Card'], 'cartes remises à leur place triée');

  // vibrations : désactivables dans les réglages
  await pg.click('#btnSettings'); await pg.waitForSelector('#setHaptic');
  assert.equal(await pg.isChecked('#setHaptic'), true);
  await pg.click('#setHaptic ~ i, .switch:has(#setHaptic)'); assert.equal(await pg.isChecked('#setHaptic'), false);
  await pg.click('.sheet-wrap.open [data-close].icon-btn'); await pg.waitForTimeout(500);
  const v1 = await pg.evaluate(() => window.__vib.length);
  await pg.selectOption('#optSort', 'name'); await pg.click('#list .rw[data-key="sol ring"] .rx'); await pg.waitForTimeout(400);
  assert.equal(await pg.evaluate(() => window.__vib.length), v1, 'vibrations coupées');
  assert.equal(await pg.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:v1')).haptic), false);
  assert.deepEqual(errs2, []); await c.close();
}

// carte en grand : langue de l'offre (FR → version française si Scryfall l'a, sinon anglaise signalée ; repli EN → anglais)
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const pg = await c.newPage(); const errs2 = []; pg.on('pageerror', e => errs2.push(e.message)); const scryUrls = [];
  const IMG = u => `https://cards.scryfall.io/${u}.jpg`;
  const CARDS = { 'cmm/400/fr': { lang: 'fr', image_uris: { large: IMG('large/front/a/b/sr-FR') } }, 'cmm/400': { lang: 'en', image_uris: { large: IMG('large/front/a/b/sr-EN') } },
    'cmm/85': { lang: 'en', image_uris: { large: IMG('large/front/a/b/stp-EN') } }, 'cmm/99': { lang: 'en', image_uris: { large: IMG('large/front/a/b/hawk-EN') } },
    'cmm/300': { lang: 'en', card_faces: [{ image_uris: { large: IMG('large/front/a/b/signet-FRONT') } }, { image_uris: { large: IMG('large/back/a/b/signet-BACK') } }] } };
  await pg.route('https://api.scryfall.com/**', route => {
    const u = new URL(route.request().url()), h = { 'access-control-allow-origin': '*' }; scryUrls.push(u.pathname);
    const m = u.pathname.match(/^\/cards\/([a-z0-9]+)\/([^/]+)(?:\/([a-z]+))?$/);
    if (m) { const k = m[1] + '/' + m[2] + (m[3] ? '/' + m[3] : ''); return CARDS[k] ? route.fulfill({ status: 200, headers: h, json: CARDS[k] }) : route.fulfill({ status: 404, headers: h, json: { object: 'error', code: 'not_found' } }); }
    const data = printsFor(u.searchParams.get('q')).map(p => ({ ...p, image_uris: { small: IMG('small/front/a/b/' + p.id) } }));
    return data.length ? route.fulfill({ status: 200, headers: h, json: { object: 'list', has_more: false, data } }) : route.fulfill({ status: 404, headers: h, json: { object: 'error' } });
  });
  await pg.route('https://cards.scryfall.io/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="936"><rect width="672" height="936" fill="#456"/><text x="30" y="480" fill="#fff" font-size="40">${route.request().url().split('/').pop()}</text></svg>` }));
  await routeFonts(pg);
  await pg.goto('http://127.0.0.1:18800/'); await pg.waitForTimeout(800);
  await runDeck(pg, "1 Sol Ring\n1 Swords to Plowshares\n1 Ranger's Hawk\n1 Arcane Signet"); await pg.waitForTimeout(500);
  await pg.waitForFunction(() => document.querySelectorAll('#list .thumb img.ok').length >= 4, null, { timeout: 5000 });
  const open = async key => { await pg.click(`#list .rw[data-key="${key}"] .thumb`); await pg.waitForSelector('.imgv-img.ok', { timeout: 5000 }); };
  const src = () => pg.$eval('.imgv-img', e => e.src.split('/').pop());
  const cap = () => pg.$eval('.imgv-cap', e => e.innerText.replace(/\s+/g, ' ').trim());
  const close = async () => { await pg.keyboard.press('Escape'); await pg.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 2000 }); };

  await open('sol ring'); console.log('Sol Ring :', await src(), '|', await cap());
  assert.equal(await src(), 'sr-FR.jpg', 'offre française → image française');
  assert.match(await cap(), /français/i); assert.equal(await pg.$('.imgv-cap em'), null, 'pas d\'avertissement');
  assert.equal(await pg.$('#sheetRoot .sheet'), null, 'le clic sur l\'image n\'ouvre pas la fiche');
  assert.equal(await pg.$eval('#app', a => a.inert), true, 'fond inerte pendant l\'affichage');
  await pg.waitForTimeout(450); await pg.screenshot({ path: 'shots/live-10-carte-fr.png' });
  await close(); assert.equal(await pg.$eval('#app', a => a.inert), false);

  await open('swords to plowshares'); console.log('Swords :', await src(), '|', await cap());
  assert.equal(await src(), 'stp-EN.jpg', 'pas de version française sur Scryfall → anglaise'); assert.match(await cap(), /Pas d'image française sur Scryfall/);
  await pg.waitForTimeout(450); await pg.screenshot({ path: 'shots/live-11-carte-repli.png' });
  await pg.mouse.click(195, 790); await pg.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 2000 }); // clic hors de la carte : ferme

  await open('rangers hawk'); console.log('Hawk (repli EN) :', await src(), '|', await cap());
  assert.equal(await src(), 'hawk-EN.jpg'); assert.match(await cap(), /anglais/i); assert.equal(await pg.$('.imgv-cap em'), null);
  assert.ok(!scryUrls.includes('/cards/cmm/99/fr'), 'offre anglaise : jamais de requête /fr'); await close();

  await open('arcane signet'); assert.equal(await src(), 'signet-FRONT.jpg');
  await pg.click('.imgv-flip'); await pg.waitForFunction(() => /signet-BACK/.test(document.querySelector('.imgv-img').src), null, { timeout: 3000 });
  await pg.click('.imgv-flip'); await pg.waitForFunction(() => /signet-FRONT/.test(document.querySelector('.imgv-img').src), null, { timeout: 3000 }); await close();

  const n = scryUrls.length; await open('sol ring'); assert.equal(scryUrls.length, n, 'deuxième ouverture : image en cache, aucune requête Scryfall'); await close();
  await pg.click('#list .rw[data-key="sol ring"] .row-name'); await pg.waitForSelector('#sheetRoot .sheet'); // le reste de la ligne ouvre toujours la fiche
  assert.deepEqual(errs2, []); await c.close();
}

// ── Tâches de fond du serveur : chemin serveur, rattachement, cache, « Actualiser », arrêt, retour dans l'app, replis ──
{
  const DECK = '1 Sol Ring\n1 Swords to Plowshares';
  const upProducts = () => log.filter(l => l.path === 'marketplace/products').length;
  const watch = pg => { const w = { posts: [], dels: 0, direct: 0 }; pg.on('request', r => { const u = r.url(); if (/\/api\/jobs$/.test(u) && r.method() === 'POST') w.posts.push(JSON.parse(r.postData())); else if (/\/api\/jobs\//.test(u) && r.method() === 'DELETE') w.dels++; else if (/\/api\/marketplace\/products/.test(u)) w.direct++; }); return w; };
  const hintSpy = pg => pg.evaluate(() => { window.__hint = false; const h = document.getElementById('progHint'); new MutationObserver(() => { if (!h.hidden) window.__hint = true; }).observe(h, { attributes: true, attributeFilter: ['hidden'] }); });
  const done = pg => pg.waitForFunction(() => /terminée/.test(document.querySelector('#progTitle').textContent), null, { timeout: 30000 });
  const rerun = async pg => { await pg.click('#btnBack'); await toInput(pg); await pg.click('#btnRun'); };
  const total = async pg => { let a = '', b; for (let i = 0; i < 20; i++) { b = (await pg.textContent('#heroAmt')).replace(/\s+/g, ' ').trim(); if (b === a) return b; a = b; await pg.waitForTimeout(350); } return b; };   // le total s'anime : on attend qu'il se stabilise

  // J1) le client passe par la tâche serveur ; la relance se rattache (0 requête) ; vieux cache → alerte + « Actualiser les prix » (fresh)
  {
    const { c, pg, errs2 } = await mkPage(); const w = watch(pg); let age = 0;
    assert.equal(await pg.evaluate(() => CTX.jobs), true, 'le ping annonce les tâches de fond');
    await pg.route(/\/api\/jobs\/[a-f0-9]{24}/, async route => { if (route.request().method() !== 'GET') return route.continue(); const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, cacheAge: age || j.cacheAge, dataAge: age || j.dataAge } }); });
    await hintSpy(pg); await runDeck(pg, DECK);
    const t1 = await total(pg); console.log('serveur : total', t1, '| POST jobs', w.posts.length, '| relais direct', w.direct, '| bandeau vu', await pg.evaluate(() => window.__hint));
    assert.ok(w.posts.length >= 1 && w.direct === 0, 'aucune requête marketplace/products depuis le navigateur'); assert.ok(w.posts[0].bps.length >= 3 && w.posts[0].lang === 'fr' && w.posts[0].fresh === false);
    assert.equal(await pg.evaluate(() => window.__hint), true, 'bandeau « tu peux quitter l\'app » affiché pendant la lecture');
    assert.equal(await pg.$eval('#progHint', h => h.hidden), true, 'bandeau masqué à la fin');
    assert.match(await pg.textContent('#progRate'), /\d+ requêtes · [\d,]+ \/ s/);
    // les scénarios précédents ont rempli le cache serveur il y a plusieurs dizaines de secondes : on le renouvelle pour partir d'un état connu
    await pg.evaluate(() => startRun(true)); await pg.waitForTimeout(100); await done(pg); await pg.waitForTimeout(400); assert.equal(w.posts.at(-1).fresh, true);
    const n0 = upProducts(); const posts0 = w.posts.length;
    await rerun(pg); await pg.waitForTimeout(100); await done(pg); await pg.waitForTimeout(400);
    assert.equal(w.posts.length, posts0 + 1); assert.equal(upProducts(), n0, 'relance identique : rattachée à la tâche existante, 0 requête CardTrader');
    assert.equal(await total(pg), t1);
    assert.ok(!(await pg.$('#alerts button[data-act="refresh"]')), 'cache récent : pas d\'alerte');
    age = 600; await rerun(pg); await pg.waitForTimeout(100); await done(pg); await pg.waitForTimeout(500);
    const al = (await pg.textContent('#alerts')).replace(/\s+/g, ' '); console.log('alerte cache :', al.trim());
    assert.match(al, /Prix lus il y a 10 min/); const btn = await pg.$('#alerts button[data-act="refresh"]'); assert.ok(btn); assert.equal(upProducts(), n0);
    await pg.screenshot({ path: 'shots/live-12-cache.png' });
    age = 0; await btn.click(); await pg.waitForTimeout(100); await done(pg); await pg.waitForTimeout(500);
    assert.equal(w.posts.at(-1).fresh, true, '« Actualiser les prix » demande une lecture fraîche'); assert.equal(upProducts() - n0, w.posts.at(-1).bps.length, 'tout est relu chez CardTrader');
    assert.equal(await total(pg), t1); assert.ok(!(await pg.$('#alerts button[data-act="refresh"]')));
    console.log('✓ chemin serveur, rattachement, alerte cache, Actualiser (', upProducts() - n0, 'requêtes relues )');
    assert.deepEqual(errs2, []); await c.close();
  }

  // J2) serveur sans tâches (JOBS=0) : repli complet depuis l'appareil, même résultat
  {
    const p2 = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: '18801', JOBS: '0', CARDTRADER_TOKEN: 'tok', CT_UPSTREAM: `http://127.0.0.1:${up.address().port}/api/v2` }, stdio: 'ignore' });
    process.on('exit', () => { try { p2.kill(); } catch {} }); await new Promise(r => setTimeout(r, 700));
    const { c, pg, errs2 } = await mkPage(18801); const w = watch(pg); await hintSpy(pg);
    assert.equal(await pg.evaluate(() => CTX.jobs), false); await runDeck(pg, DECK);
    const t = await total(pg); console.log('JOBS=0 : total', t, '| relais direct', w.direct, '| tâches', w.posts.length);
    assert.ok(w.direct >= 3 && w.posts.length === 0); assert.equal(await pg.evaluate(() => window.__hint), false, 'pas de bandeau serveur'); assert.match(t, /^[\d,]+ €$/); assert.ok(!/^0,00/.test(t));
    assert.equal(await pg.$$eval('#list .row.is-missing', r => r.length), 0);
    assert.deepEqual(errs2, []); await c.close(); p2.kill();
    console.log('✓ repli appareil quand le serveur n\'a pas les tâches');
  }

  // J3) tâches refusées en cours de route (404) : repli appareil, résultat complet ; perte de la tâche (404 au suivi) : relance transparente
  {
    const { c, pg, errs2 } = await mkPage(); const w = watch(pg); const ref = await (async () => { await runDeck(pg, DECK); return total(pg); })();
    await pg.route(/\/api\/jobs$/, r => r.request().method() === 'POST' ? r.fulfill({ status: 404, json: { error: 'jobs_disabled' } }) : r.continue());
    const d0 = w.direct; await rerun(pg); await pg.waitForTimeout(100); await done(pg); await pg.waitForTimeout(400);
    assert.ok(w.direct - d0 >= 3, 'repli : lecture depuis l\'appareil'); assert.equal(await total(pg), ref); assert.equal(await pg.evaluate(() => CTX.jobs), false, 'tâches désactivées pour la session');
    assert.deepEqual(errs2, []); await c.close(); console.log('✓ POST refusé : repli appareil, même total');
  }
  {
    const { c, pg, errs2 } = await mkPage(); const w = watch(pg); let lost = 0;
    await pg.route(/\/api\/jobs\/[a-f0-9]{24}/, r => { if (r.request().method() === 'GET' && lost++ === 0) return r.fulfill({ status: 404, json: { error: 'job_not_found' } }); return r.continue(); });
    await runDeck(pg, DECK); const t = await total(pg);
    assert.ok(w.posts.length >= 2, 'tâche perdue : nouvelle demande pour ce qui manque (' + w.posts.length + ')'); assert.equal(w.direct, 0); assert.ok(!/^0,00/.test(t) && await pg.$$eval('#list .row.is-missing', r => r.length) === 0);
    assert.deepEqual(errs2, []); await c.close(); console.log('✓ tâche perdue : relancée sans perte (', w.posts.length, 'demandes )');
  }

  // J4) « Arrêter » annule la tâche côté serveur ; quitter l'app (fermer la page) NE l'annule PAS : la relance se rattache et ne relit rien de plus
  {
    prodDelay = 2500; const { c, pg, errs2 } = await mkPage(); const w = watch(pg); const n0 = upProducts();
    await pg.evaluate(() => { document.querySelector('#deckText').value = ''; });
    await toInput(pg); await pg.fill('#deckText', DECK); await pg.waitForTimeout(300); await pg.evaluate(() => { startRun(true); });
    await pg.waitForFunction(() => !document.getElementById('progHint').hidden, null, { timeout: 8000 }).catch(async e => { console.log('DIAG4', await pg.evaluate(() => document.querySelector('#progTitle').textContent + ' | ' + [...document.querySelectorAll('.step')].map(x => x.innerText.replace(/\s+/g, ' ')).join(' / ') + ' | ' + document.querySelector('#alerts').innerText + ' | ' + document.querySelector('#progRate').innerText + ' | jobs=' + CTX.jobs), log.slice(-5).map(l => l.m + ' ' + l.path)); throw e; }); await pg.waitForTimeout(400); await pg.screenshot({ path: 'shots/live-13-serveur.png' }); await pg.click('#btnCancel'); await pg.waitForTimeout(700);   // bandeau visible pendant la lecture, puis « Arrêter »
    assert.equal(w.dels, 1, 'DELETE envoyé au serveur'); assert.match(await pg.textContent('#progTitle'), /arrêtée/); await c.close();
    console.log('✓ Arrêter : tâche annulée côté serveur');
    await new Promise(r => setTimeout(r, 2800));
    const n1 = upProducts();
    const A = await mkPage(); const wa = watch(A.pg); await toInput(A.pg); await A.pg.fill('#deckText', DECK); await A.pg.waitForTimeout(300); await A.pg.evaluate(() => { startRun(true); });
    await A.pg.waitForFunction(() => !document.getElementById('progHint').hidden, null, { timeout: 8000 }); await A.pg.waitForTimeout(400);
    const started = upProducts() - n1; assert.ok(started >= 3, 'lecture amorcée : ' + started);
    await A.c.close();                                                   // l'utilisateur quitte l'app en pleine lecture
    const B = await mkPage(); const wb = watch(B.pg); await runDeck(B.pg, DECK);
    assert.equal(upProducts() - n1, started, 'la relance se rattache à la tâche qui tournait : aucune requête CardTrader en plus (' + (upProducts() - n1) + ' pour ' + started + ')');
    assert.equal(wb.posts.at(-1).fresh, false); assert.ok(!/^0,00/.test(await total(B.pg))); assert.deepEqual(B.errs2, []); await B.c.close();
    console.log('✓ quitter l\'app : la tâche continue, la relance reprend les résultats (', started, 'requêtes, 0 doublon )'); prodDelay = 0;
  }
}

console.log('\nLIVE E2E OK');
await browser.close(); proxy.kill(); up.close(); process.exit(0);
