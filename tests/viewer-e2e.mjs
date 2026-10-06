// E2E « deck viewer » : prix gardés par deck, viewer façon MTGA (mana / prix / type), navigation entre cartes, actualisation.
import './setup-env.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const user = { id: 1, username: 'seller_a', country_code: 'FR', can_sell_via_hub: true };
const prod = (id, bp, cents, qty = 2, lang = 'fr') => ({ id, blueprint_id: bp, quantity: qty, graded: false, on_vacation: false, bundle_size: 1, price: { cents, currency: 'EUR' },
  properties_hash: { condition: 'Near Mint', mtg_language: lang, mtg_foil: false }, expansion: { code: 'cmm', name_en: 'Commander Masters' }, user });
const CARDS = [ // nom, bp, coût converti, type, coût de mana, prix FR (cts) — null : aucune offre
  ['Sol Ring', 100, 1, 'Artifact', '{1}', 150], ['Swords to Plowshares', 101, 1, 'Instant', '{W}', 200], ['Arcane Signet', 102, 2, 'Artifact', '{2}', 50],
  ['Wrath of God', 103, 4, 'Sorcery', '{2}{W}{W}', 300], ['Craterhoof Behemoth', 104, 8, 'Creature — Beast', '{5}{G}{G}{G}', 900], ['Command Tower', 105, 0, 'Land', '', 30],
  ['Llanowar Elves', 106, 1, 'Creature — Elf Druid', '{G}', 20], ["Ranger's Hawk", 107, 1, 'Creature — Bird', '{W}', null],
];
const PRODUCTS = {}; CARDS.forEach(([, bp, , , , c], i) => { if (c != null) PRODUCTS[bp + '|fr'] = [prod(9000 + i, bp, c, 4)]; });
const slug = n => n.toLowerCase().replace(/[^a-z]+/g, '-');
const PRINTS = {}; CARDS.forEach(([n, bp, cmc, tl, mc], i) => { PRINTS[n] = [{ id: 's-' + slug(n), set: 'cmm', set_name: 'Commander Masters', collector_number: String(400 + i), name: n, cmc, type_line: tl, mana_cost: mc, colors: [],
  image_uris: { small: `https://cards.scryfall.io/small/front/a/b/${slug(n)}.jpg` } }]; });
const REF_EUR = { 'Sol Ring': '1.50', 'Swords to Plowshares': '1.90', 'Arcane Signet': '0.40', 'Wrath of God': '1.50', 'Craterhoof Behemoth': '9.00', 'Command Tower': '0.25', 'Llanowar Elves': '0.20', "Ranger's Hawk": '0.05' };
const BPS = [CARDS.map(([n, bp]) => ({ id: bp, name: n, scryfall_id: 's-' + slug(n) }))][0];
const namesIn = q => [...String(q).matchAll(/!"(.+?)"/g)].map(m => m[1]);

const log = []; let prodDelay = 0;
const up = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname.replace('/api/v2/', ''); log.push({ path, q: Object.fromEntries(u.searchParams) });
  const send = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (path === 'info') return send({ id: 1, name: 'test' });
  if (path === 'expansions') return send([{ id: 1, game_id: 1, code: 'cmm', name: 'Commander Masters' }]);
  if (path === 'blueprints/export') return send(BPS);
  if (path === 'marketplace/products') { const bp = u.searchParams.get('blueprint_id'); const go = () => send({ [bp]: PRODUCTS[bp + '|' + u.searchParams.get('language')] || [] }); return prodDelay ? setTimeout(go, prodDelay) : go(); }
  send({ error: 'nope' }, 404);
});
await new Promise(r => up.listen(0, '127.0.0.1', r));
const proxy = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: '18810', CARDTRADER_TOKEN: 'tok', CT_UPSTREAM: `http://127.0.0.1:${up.address().port}/api/v2` }, stdio: 'ignore' });
process.on('exit', () => { try { proxy.kill(); } catch {} });
await new Promise(r => setTimeout(r, 700));
const prodReqs = () => log.filter(l => l.path === 'marketplace/products').length;

const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });   // les routes de test n'interceptent pas le SW
  const p = await ctx.newPage(); const errs = [], scry = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.route('https://api.scryfall.com/**', route => {
    const u = new URL(route.request().url()); scry.push(u.pathname + u.search); const h = { 'access-control-allow-origin': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...h, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
    if (u.pathname === '/cards/collection') {      // fiches (type, coût, image, prix tendance) des cartes d'un deck jamais cherché : viewer de référence
      const names = (JSON.parse(route.request().postData() || '{}').identifiers || []).map(i => i.name);
      return route.fulfill({ status: 200, headers: h, json: { object: 'list', not_found: [], data: names.flatMap(n => (PRINTS[n] || []).map(c => ({ ...c, prices: { eur: REF_EUR[n] } }))) } });
    }
    if (u.pathname === '/cards/search') {
      const data = namesIn(u.searchParams.get('q')).flatMap(n => PRINTS[n] || []);
      return data.length ? route.fulfill({ status: 200, headers: h, json: { object: 'list', has_more: false, data } }) : route.fulfill({ status: 404, headers: h, json: { object: 'error', code: 'not_found' } });
    }
    const m = /^\/cards\/([^/]+)\/([^/]+)(?:\/([a-z]+))?$/.exec(u.pathname);
    if (m) { const lang = m[3] || 'en'; return route.fulfill({ status: 200, headers: h, json: { object: 'card', lang, image_uris: { large: `https://cards.scryfall.io/large/front/${m[1]}/${m[2]}-${lang}.jpg` } } }); }
    return route.fulfill({ status: 404, headers: h, json: { object: 'error' } });
  });
  await p.route('https://cards.scryfall.io/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="672" height="936"><rect width="672" height="936" fill="#456"/></svg>' }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto('http://127.0.0.1:18810/'); await p.waitForTimeout(700);
  await p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
  return { ctx, p, errs, scry };
};
const done = p => p.waitForFunction(() => /terminée/.test(document.querySelector('#progTitle').textContent), null, { timeout: 40000 });
const norm = t => String(t).replace(/\s+/g, ' ').trim();
const txt = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim());
const groups = p => p.$$eval('.dv-g', gs => gs.map(g => g.dataset.g));
const tileNames = (p, gid) => p.$$eval(`.dv-g[data-g="${gid}"] .dvc`, ts => ts.map(t => t.getAttribute('aria-label').replace(/\s/g, ' ')));
const ok = m => console.log('✓', m);

const DECK = "1 Sol Ring\n1 Swords to Plowshares\n1 Arcane Signet\n1 Wrath of God\n1 Craterhoof Behemoth\n1 Command Tower\n2 Llanowar Elves\n1 Ranger's Hawk\n1 Phantom Card\n5 Forest";
const { ctx, p, errs, scry } = await newPage();
// « Mes decks » : écran ouvert depuis l'accueil ; toucher un deck ouvre son viewer par-dessus
const openDeck = async () => { if (!(await p.$('.dks.on'))) { await p.click('#btnDecks'); await p.waitForSelector('.dks.on .deck-main'); } await p.click('#deckList .deck-main'); await p.waitForSelector('.dv.on .dv-g'); };

// 1) deck enregistré avant toute recherche → « Voir » : état vide, puis « Chercher les prix » → relevé gardé
await p.fill('#deckText', DECK); await p.waitForTimeout(250);
await p.click('#btnSave'); await p.waitForSelector('#svName'); await p.fill('#svName', 'Mon deck'); await p.click('#svGo'); await p.waitForTimeout(500);
await p.click('#btnDecks'); await p.waitForSelector('#deckList .deck-main'); assert.equal(await p.$$eval('#deckList .deck-main', b => b.length), 1); ok('toucher le deck enregistré (ouvre le viewer)');
await p.screenshot({ path: 'shots/viewer-0-liste.png' });
await p.click('#deckList .deck-main'); await p.waitForSelector('.dv.on');
// aucun relevé gardé : le même viewer, en valeur estimée (prix tendance Cardmarket) au lieu d'une simple liste
await p.waitForFunction(() => /15,00/.test(document.querySelector('.dv-eur') ? document.querySelector('.dv-eur').textContent : ''), null, { timeout: 8000 });
assert.equal(await p.$('.dv-empty'), null, 'plus d\'état vide'); assert.equal(await p.$('.dv-plain'), null);
assert.equal((await p.waitForFunction(() => !document.querySelector('.dv-amt[data-tw]')), await txt(p, '.dv-eur')), '≈ 15,00 €+', 'valeur estimée, « + » : une carte sans prix'); assert.match(await txt(p, '.dv-crit'), /Valeur estimée · prix tendance Cardmarket/); assert.match(await txt(p, '.dv-age'), /Prix de référence, pas des offres/);
assert.equal(await p.$('.dv-age [data-act="refresh"]'), null, 'pas de « Actualiser » : ce ne sont pas des offres');
assert.equal(await txt(p, '.dv[aria-label^="Deck viewer"] .dv-title span'), '15 cartes · 10 à trouver · 1 sans prix');
assert.deepEqual(await groups(p), ['m0', 'm1', 'm2', 'm4', 'm7', 'land'], 'mana, terrains');
assert.deepEqual(await tileNames(p, 'm1'), ['Llanowar Elves, ×2, 0,40 €', "Ranger's Hawk, 0,05 €", 'Sol Ring, 1,50 €', 'Swords to Plowshares, 1,90 €']);
assert.deepEqual(await tileNames(p, 'm0'), ['Phantom Card, prix inconnu']); assert.equal(await p.$eval('.dv-g[data-g="m0"] .dvc-p', e => e.className), 'dvc-p warn');
assert.equal(await p.$$eval('.dv-bar', b => b.length), 8, 'courbe de mana'); assert.ok(await p.$('#dvF'), 'filtres');
await p.waitForFunction(() => document.querySelectorAll('.dvc-art img.ok').length >= 5, null, { timeout: 8000 });
assert.equal(await p.$eval('.dv-foot [data-act="refresh"]', e => e.hidden), false); assert.equal(await txt(p, '.dv-foot [data-act="refresh"]'), 'Chercher les offres');
await p.click('.dvc[aria-label^="Sol Ring"]'); await p.waitForSelector('.imgv'); assert.match(await txt(p, '.imgv-extra'), /1,50 € · prix tendance Cardmarket/); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 });
assert.equal(await p.$eval('#app', a => a.inert), true, 'fond inerte pendant le viewer'); ok('viewer sans prix gardé : valeur estimée, mana, tuiles, images, « Chercher les offres »');
await p.click('.dv-foot [data-act="refresh"]'); await p.waitForFunction(() => !document.querySelector('.dv'), null, { timeout: 3000 });
await done(p); await p.waitForSelector('#toast.on .toast-act', { timeout: 8000 });
assert.match(await txt(p, '#toast'), /Prix actualisés/); ok('recherche lancée depuis le viewer, toast « Prix actualisés »');
assert.ok(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('deckdeal:snaps:v1') || '{}')).length === 1), 'relevé gardé sur l\'appareil');
await p.click('#toast .toast-act'); await p.waitForSelector('.dv.on .dv-g');
await p.waitForFunction(() => document.querySelectorAll('.dvc-art img.ok').length >= 5, null, { timeout: 8000 });

// 2) contenu du viewer : mana
assert.equal(norm((await p.waitForFunction(() => !document.querySelector('.dv-amt[data-tw]')), await p.textContent('.dv-eur'))).replace(/\s/g, ' '), '16,70 €'); assert.match(await txt(p, '.dv-age'), /Prix du .+ · /); assert.equal(await p.$eval('.dv-age', e => e.dataset.age), 'fresh');
assert.equal(await txt(p, '.dv[aria-label^="Deck viewer"] .dv-title span'), '15 cartes · 1 introuvable · 1 sans offre', '10 cartes + 5 basiques');
ok('total 16,70 € · prix du jour · résumé');

assert.deepEqual(await groups(p), ['m1', 'm2', 'm4', 'm7', 'land', 'nf'], 'colonnes par coût, terrains puis introuvables');
assert.equal(await txt(p, '.dv-g[data-g="m1"] h3'), 'Coût 1 5 cartes · 3,90 €', 'Sol Ring + Swords + 2 Llanowar + Hawk sans offre');
assert.equal(await txt(p, '.dv-g[data-g="m7"] h3 span'), 'Coût 7 et plus');
assert.equal(await txt(p, '.dv-g[data-g="land"] h3'), 'Terrains 6 cartes · 0,30 €');
assert.deepEqual((await tileNames(p, 'm1')), ['Llanowar Elves, ×2, 0,40 €', 'Ranger\'s Hawk, aucune offre', 'Sol Ring, 1,50 €', 'Swords to Plowshares, 2,00 €'], 'ordre alphabétique, quantité, prix');
assert.deepEqual(await tileNames(p, 'land'), ['Command Tower, 0,30 €', 'Forest, ×5'], 'basiques en dernier, sans prix');
assert.deepEqual(await tileNames(p, 'nf'), ['Phantom Card, introuvable']);
assert.equal(await txt(p, '.dv-g[data-g="m1"] .dvc[data-s="none"] .dvc-p'), 'Aucune offre'); assert.equal(await txt(p, '.dv-g[data-g="m1"] .dvc-q'), '×2');
const curve = await p.$$eval('.dv-bar', b => b.map(x => x.querySelector('.dv-n').textContent)); assert.deepEqual(curve, ['', '5', '1', '', '1', '', '', '1'], 'courbe de mana');
assert.equal(await p.$eval('.dv-bar[data-m="0"]', b => b.disabled), true);
await p.waitForTimeout(500); await p.screenshot({ path: 'shots/viewer-1-mana.png' });
ok('colonnes par coût de mana, quantités, prix, « aucune offre », introuvables, courbe');

// 3) bascule prix / type, mémorisée
await p.click('#dvSeg [data-v="price"]'); await p.waitForTimeout(200);
assert.deepEqual(await groups(p), ['p', 'np', 'b', 'nf']);
const priced = await tileNames(p, 'p'); assert.equal(priced[0], 'Craterhoof Behemoth, 9,00 €'); assert.equal(priced.at(-1), 'Command Tower, 0,30 €'); assert.equal(priced.at(-2), 'Llanowar Elves, ×2, 0,40 €'); assert.equal(priced.length, 7);
assert.equal(await p.evaluate(() => localStorage.getItem('deckdeal:dv-sort')), 'price');
await p.screenshot({ path: 'shots/viewer-2-prix.png' });
await p.click('#dvSeg [data-v="type"]'); await p.waitForTimeout(200);
assert.deepEqual(await p.$$eval('.dv-g h3 span', s => s.map(x => x.textContent)), ['Créatures', 'Artefacts', 'Éphémères', 'Rituels', 'Terrains', 'Introuvables']);
assert.deepEqual(await tileNames(p, 't-Créatures'), ['Llanowar Elves, ×2, 0,40 €', 'Ranger\'s Hawk, aucune offre', 'Craterhoof Behemoth, 9,00 €'], 'créatures par coût puis nom');
await p.screenshot({ path: 'shots/viewer-3-type.png' });
ok('bascule Prix et Type, choix mémorisé');
await p.click('#dvSeg [data-v="mana"]'); await p.waitForTimeout(200);
await p.click('.dv-bar[data-m="4"]'); await p.waitForTimeout(700);
assert.ok(await p.$eval('.dv-scroll', s => s.scrollTop) > 100, 'toucher une barre de la courbe fait défiler jusqu\'au groupe'); ok('courbe cliquable');
await p.$eval('.dv-scroll', s => { s.scrollTop = 0; });

// 4) carte en grand depuis le viewer : navigation, prix, langue
const scryBefore = scry.length;
await p.click('.dv-g[data-g="m1"] .dvc >> nth=0'); await p.waitForSelector('.imgv-img.ok', { timeout: 6000 });
assert.equal(await p.$eval('.imgv-cap b', e => e.textContent), 'Llanowar Elves'); assert.equal(await txt(p, '.imgv-count'), '1 / 8', '8 cartes avec image (hors basiques et introuvable)');
assert.match(await txt(p, '.imgv-extra'), /^0,40 € pour 2 · NM · seller_a · FR$/); assert.match(await txt(p, '.imgv-sub'), /français/i);
assert.match(await p.$eval('.imgv-img', i => i.src), /cmm\/\d+-fr\.jpg/, 'image française (offre FR)');
assert.equal(await p.$eval('.imgv-nav.prev', b => b.disabled), true);
await p.keyboard.press('ArrowRight'); await p.waitForFunction(() => document.querySelector('.imgv-cap b').textContent === 'Ranger\'s Hawk');
assert.equal(await txt(p, '.imgv-count'), '2 / 8'); assert.match(await txt(p, '.imgv-extra'), /Aucune offre avec tes critères/);
await p.click('.imgv-nav.next'); await p.waitForFunction(() => document.querySelector('.imgv-cap b').textContent === 'Sol Ring'); await p.waitForSelector('.imgv-img.ok');
assert.match(await txt(p, '.imgv-extra'), /^1,50 €/); await p.screenshot({ path: 'shots/viewer-4-carte.png' });
// glissement vers la gauche = carte suivante
await p.evaluate(() => { const w = document.querySelector('.imgv'); const t = (x, type) => w.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: w, clientX: x, clientY: 400 })], changedTouches: [new Touch({ identifier: 1, target: w, clientX: x, clientY: 400 })] })); t(300, 'touchstart'); t(120, 'touchend'); });
await p.waitForFunction(() => document.querySelector('.imgv-cap b').textContent === 'Swords to Plowshares'); assert.equal(await txt(p, '.imgv-count'), '4 / 8');
await p.keyboard.press('ArrowLeft'); await p.waitForFunction(() => document.querySelector('.imgv-cap b').textContent === 'Sol Ring');
assert.ok(scry.length > scryBefore, 'images lues par Scryfall, une carte à la fois');
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 2000 });
assert.ok(await p.$('.dv.on'), 'Échap ferme la carte, pas le viewer'); assert.equal(await p.$eval('#app', a => a.inert), true, 'fond toujours inerte sous le viewer');
ok('carte en grand : précédent / suivant (boutons, clavier, glissement), prix + vendeur, Échap');

// 5) fermer, rouvrir après rechargement : prix gardés, aucune requête
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.dv'), null, { timeout: 2000 }); assert.equal(await p.$eval('#app', a => a.inert), false);
await p.reload(); await p.waitForTimeout(900); const n0 = prodReqs(); await p.click('#btnDecks'); await p.waitForSelector('#deckList .deck-main'); await p.waitForTimeout(1500); const s0 = scry.filter(u => !/^\/cards\/collection/.test(u)).length;      // l'écran des decks et le viewer peuvent lire des fiches (POST /cards/collection) : jamais autre chose
await p.click('#deckList .deck-main'); await p.waitForSelector('.dv.on .dv-g');
assert.equal(norm((await p.waitForFunction(() => !document.querySelector('.dv-amt[data-tw]')), await p.textContent('.dv-eur'))).replace(/\s/g, ' '), '16,70 €'); assert.equal(await p.evaluate(() => DV.sort), 'mana', 'tri mémorisé relu après rechargement');
assert.equal(prodReqs(), n0, 'aucune requête CardTrader pour ouvrir le viewer'); assert.equal(scry.filter(u => !/^\/cards\/collection/.test(u)).length, s0, 'aucune requête Scryfall de recherche non plus (images : cache navigateur)');
ok('après rechargement : prix gardés, viewer immédiat sans réseau CardTrader');
await p.click('.dv-foot [data-act="close"]').catch(() => {}); await p.keyboard.press('Escape');

// 6) prix vieux de 3 jours : signalé, « Actualiser » relit tout chez CardTrader (cache serveur ignoré)
await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('deckdeal:snaps:v1')); for (const k in o) o[k].at -= 3 * 86400e3; localStorage.setItem('deckdeal:snaps:v1', JSON.stringify(o)); });
await openDeck();
assert.equal(await p.$eval('.dv-age', e => e.dataset.age), 'old'); assert.match(await txt(p, '.dv-age'), /il y a 3 jours/);
const oldColor = await p.$eval('.dv-age', e => getComputedStyle(e).color), okColor = await p.evaluate(() => getComputedStyle(document.querySelector('.dv-crit')).color); assert.notEqual(oldColor, okColor, 'signalé en couleur');
await p.waitForTimeout(500); await p.screenshot({ path: 'shots/viewer-5-vieux.png' });
const n1 = prodReqs(); await p.click('.dv-age [data-act="refresh"]'); await p.waitForFunction(() => !document.querySelector('.dv'), null, { timeout: 3000 });
await done(p); await p.waitForSelector('#toast.on .toast-act', { timeout: 8000 });
assert.equal(prodReqs() - n1, 9, 'lecture fraîche : 8 blueprints en français + 1 repli anglais (Ranger\'s Hawk), tout relu chez CardTrader malgré le cache serveur de 10 min');
await p.click('#toast .toast-act'); await p.waitForSelector('.dv.on .dv-g'); assert.equal(await p.$eval('.dv-age', e => e.dataset.age), 'fresh'); assert.match(await txt(p, '.dv-age'), /Prix du .+ · (à l'instant|il y a \d+ min)/);
ok('prix de 3 jours signalés, Actualiser relit tout, retour au viewer à jour');

// 7) « Modifier la liste » : retour à la saisie avec le texte du deck
await p.click('.dv-foot [data-act="edit"]'); await p.waitForFunction(() => !document.querySelector('.dv'), null, { timeout: 3000 }); await p.waitForTimeout(300);
assert.equal(await p.$eval('#viewInput', v => v.hidden), false); assert.match(await p.inputValue('#deckText'), /Craterhoof Behemoth/); ok('Modifier la liste : saisie rechargée');

// 8) viewer de la recherche en cours (depuis les résultats) : pas d'« Actualiser », pas de « Modifier »
await p.click('#btnRun'); await done(p); await p.waitForTimeout(500);
assert.equal(await p.$eval('#btnViewer', b => b.disabled), false); await p.click('#btnViewer'); await p.waitForSelector('.dv.on .dv-g');
assert.equal(await txt(p, '.dv-age'), 'Prix de la recherche en cours'); assert.equal(await p.$('.dv-age [data-act="refresh"]'), null);
assert.equal(await p.$eval('.dv-foot [data-act="edit"]', b => b.hidden), true); assert.equal(await p.$eval('.dv-foot [data-act="close"]', b => b.hidden), false);
assert.equal(norm((await p.waitForFunction(() => !document.querySelector('.dv-amt[data-tw]')), await p.textContent('.dv-eur'))).replace(/\s/g, ' '), '16,70 €');
await p.click('.dv-foot [data-act="close"]'); await p.waitForFunction(() => !document.querySelector('.dv'), null, { timeout: 2000 }); ok('viewer de la recherche en cours depuis les résultats');

// 9) la liste de résultats navigue aussi entre les cartes (nouvelle visionneuse)
await p.click('#list .rw >> nth=0 >> .thumb'); await p.waitForSelector('.imgv-img.ok', { timeout: 6000 });
assert.match(await txt(p, '.imgv-count'), /^1 \/ \d+$/); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300); assert.match(await txt(p, '.imgv-count'), /^2 \/ \d+$/); await p.keyboard.press('Escape');
ok('visionneuse depuis la liste : navigation entre cartes');

assert.deepEqual(errs, [], 'aucune erreur page');
console.log('\nVIEWER E2E OK');
await browser.close(); proxy.kill(); up.close(); process.exit(0);
