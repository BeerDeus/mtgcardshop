// E2E noms imprimés allemands (téléphone allemand, interface anglaise, cartes allemandes) : le catalogue names-de.tsv est chargé, jamais fr-names.tsv ;
// decklist « 4 Blitzschlag » au prix Cardmarket (noms allemands affichés, vignettes allemandes du catalogue), import, « Ajouter une carte », liste de souhaits,
// scan des cartes allemandes (Tesseract « deu », si son modèle est installé : @tesseract.js-data/deu ou TESS_DEU_DIR). Captures 390 px sombre : SHOTS=dossier.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium, startWorld, newPage, txt, ok, toInput, toHome, slug } from './e2e-world.mjs';

const SHOTS = process.env.SHOTS || ''; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (p, n) => { if (SHOTS) { await p.waitForTimeout(350); await p.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const world = await startWorld({ port: 18926, env: { CARDTRADER_TOKEN: '' } });      // sans token : prix Cardmarket
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
// catalogue allemand : vraies lignes des cartes du test (fixtures/names-de.tsv) + 600 autres (le site en exige au moins 500)
const BODY = readFileSync(new URL('./fixtures/names-de.tsv', import.meta.url), 'utf8') + Array.from({ length: 600 }, (_, i) => `Vrombl ${i} Quarnax\tVrombl Card ${i}\t`).join('\n') + '\n';
const extra = (n, eur) => { world.prints[n] = [{ id: 's-' + slug(n), set: 'lea', set_name: 'Alpha', collector_number: '1', name: n, cmc: 1, type_line: 'Instant', mana_cost: '{R}', colors: ['R'], prices: { eur }, color_identity: ['R'], legalities: { commander: 'legal' }, image_uris: { small: `https://cards.scryfall.io/small/front/a/b/${slug(n)}.jpg` } }]; };
extra('Lightning Bolt', '0.80'); extra('Counterspell', '1.00'); extra('Rhystic Study', '20.00');
const baseCat = world.catalog; world.catalog = () => [...baseCat(), 'Lightning Bolt', 'Counterspell', 'Rhystic Study'];
// Tesseract servi depuis node_modules (comme scan-e2e), modèle allemand compris
const TESS_DIR = process.env.TESS_DIR || new URL('../tests/node_modules', import.meta.url).pathname, DEU = process.env.TESS_DEU_DIR || `${TESS_DIR}/@tesseract.js-data/deu`;
const canScan = existsSync(TESS_DIR + '/tesseract.js') && existsSync(DEU + '/4.0.0_best_int/deu.traineddata.gz');
const CDN = [
  [/\/npm\/tesseract\.js@5\.1\.1\/dist\/(.+)$/, m => `${TESS_DIR}/tesseract.js/dist/${m[1]}`, 'text/javascript'],
  [/\/npm\/tesseract\.js-core@5\.1\.1\/(.+)$/, m => `${TESS_DIR}/tesseract.js-core/${m[1]}`, null],
  [/\/npm\/@tesseract\.js-data\/deu\/4\.0\.0_best_int\/(.+)$/, m => `${DEU}/4.0.0_best_int/${m[1]}`, 'application/gzip'],
  [/\/npm\/@tesseract\.js-data\/(eng)\/4\.0\.0_best_int\/(.+)$/, m => `${TESS_DIR}/@tesseract.js-data/${m[1]}/4.0.0_best_int/${m[2]}`, 'application/gzip'],
];

const { ctx, p, errs } = await newPage(browser, world, { goto: false, ctx: { locale: 'de-DE', colorScheme: 'dark' },
  init: `try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('deckdeal:lang', 'en'); localStorage.setItem('deckdeal:onboard', '1'); } } catch (e) {}` });
let deHits = 0, frHits = 0; const tess = [];
await ctx.route('**/names-de.tsv', r => { deHits++; r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: BODY }); });
await ctx.route('**/fr-names.tsv', r => { frHits++; r.fulfill({ status: 404, body: 'nf' }); });
await ctx.route('https://cdn.jsdelivr.net/**', route => {
  const u = new URL(route.request().url()); tess.push(u.pathname);
  for (const [re, file, type] of CDN) {
    const m = re.exec(u.pathname); if (!m) continue;
    const f = file(m); if (!existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: type || (f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'), body: readFileSync(f) });
  }
  return route.fulfill({ status: 404, body: 'nf' });
});
await p.goto(world.url); await p.waitForTimeout(700); await p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
const sheetGone = () => p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 4000 });
assert.deepEqual(await p.evaluate(() => [I18N.lang, S.opts.lang, namesLang(), !!FRX.ix]), ['en', 'de', 'de', false], 'téléphone allemand : cartes et noms allemands, rien de chargé au démarrage');

/* ── 1) decklist en allemand, prix Cardmarket, vignettes allemandes ──────────────────────────── */
await toInput(p); await p.fill('#deckText', '4 Blitzschlag\n1 Sol Ring\n1 Schwerter zu Pflugscharen\n2 Gebirge\n1 Edgar Markov');
await p.waitForFunction(() => !!FRX.ix, null, { timeout: 8000 }); await p.waitForTimeout(200);
assert.deepEqual([await p.evaluate(() => FRX.l), deHits, frHits], ['de', 1, 0], 'names-de.tsv lu une fois, jamais le catalogue français');
assert.deepEqual(await p.evaluate(() => S.deck.cards.map(c => [c.key, c.name, c.dn || ''])), [['lightning bolt', 'Lightning Bolt', 'Blitzschlag'], ['sol ring', 'Sol Ring', ''], ['swords to plowshares', 'Swords to Plowshares', 'Schwerter zu Pflugscharen'], ['edgar markov', 'Edgar Markov', '']]);
assert.deepEqual(await p.evaluate(() => S.deck.basics.map(c => c.key)), ['mountain'], '« Gebirge » : terrain de base');
ok('decklist : noms allemands lus (clé anglaise pour les prix, nom imprimé pour l\'affichage), « Gebirge » = terrain de base');
await p.click('#btnRun'); await p.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 20000 }); await p.waitForTimeout(800);
assert.match(await txt(p, '#heroAmt'), /€11\.60/, '4 × 0,80 + 1,50 + 1,90 + 5,00');
const nameOf = k => p.$eval(`.row[data-key="${k}"] .row-name`, e => e.textContent);
assert.equal(await nameOf('lightning bolt'), 'Blitzschlag'); assert.equal(await nameOf('swords to plowshares'), 'Schwerter zu Pflugscharen'); assert.equal(await nameOf('sol ring'), 'Sol Ring');
await p.waitForFunction(() => document.querySelectorAll('#list .row .thumb img.ok').length >= 3, null, { timeout: 8000 });
assert.equal(await p.$eval('.row[data-key="lightning bolt"] .thumb img', i => i.getAttribute('src')), 'https://cards.scryfall.io/small/front/de/lightning-bolt.jpg', 'recherche en allemand : vignette de l\'impression allemande (catalogue)');
assert.equal(await p.$eval('.row[data-key="swords to plowshares"] .thumb img', i => i.getAttribute('src')), 'https://cards.scryfall.io/small/front/de/swords-to-plowshares.jpg');
await p.evaluate(() => { window.__clip = ''; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
await p.click('#btnCart'); await p.waitForTimeout(300); assert.match(await p.evaluate(() => window.__clip), /^4 Lightning Bolt\n1 Sol Ring\n1 Swords to Plowshares\n/, 'Wants list Cardmarket : noms anglais');
await p.evaluate(() => window.scrollTo(0, 0)); await shot(p, 'intl-de-decklist');
ok('prix Cardmarket : €11.60, lignes sous leur nom allemand, vignettes allemandes du catalogue, copie Cardmarket en anglais');

/* ── 1b) langue des cartes changée : le catalogue suit (anglais : aucun ; retour à l'allemand : relu sur l'appareil, sans requête) ─── */
await p.click('#btnBack'); await p.selectOption('#optLang', 'en'); await p.waitForTimeout(300);
assert.deepEqual(await p.evaluate(() => [namesLang(), !!FRX.ix, S.deck.cards[0].key]), ['', false, 'blitzschlag'], 'cartes anglaises : plus de catalogue, « Blitzschlag » n\'est plus reconnu');
await p.selectOption('#optLang', 'de'); await p.waitForFunction(() => !!FRX.ix && FRX.l === 'de', null, { timeout: 8000 }); await p.waitForTimeout(200);
assert.equal(await p.evaluate(() => S.deck.cards[0].key), 'lightning bolt'); assert.equal(deHits, 1, 'catalogue allemand relu sur l\'appareil (IndexedDB), pas retéléchargé');
ok('langue des cartes changée : anglais → aucun catalogue ; retour à l\'allemand → catalogue relu sur l\'appareil, liste relue');

/* ── 2) import d'une liste allemande ───────────────────────────────────────────────────────── */
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
await p.click('.coll-tools [data-act="import"]'); await p.waitForSelector('#ciText');
assert.equal(await p.$eval('#ciLang', s => s.value), 'de', 'langue de ces cartes : allemand'); assert.equal(await p.$eval('#ciText', t => t.placeholder), '3 Sol Ring\n1 Blitzschlag');
assert.match(await txt(p, '.ci-lhint'), /a German name counts as a German card/);
await p.fill('#ciText', '2 Blitzschlag\n1 Zorn Gottes\n1 Rhystische Studien\n3 Sol Ring');
await p.waitForFunction(() => /German names recognised/.test(document.querySelector('#ciSum').textContent), null, { timeout: 8000 });
assert.match(await txt(p, '#ciSum'), /4 unique cards · 7 copies.*3 German names recognised/);
await shot(p, 'intl-de-import');
await p.click('#ciGo'); await sheetGone();
assert.deepEqual(await p.evaluate(() => ['lightning bolt', 'wrath of god', 'rhystic study', 'sol ring'].map(k => COLL.map[k] && COLL.map[k].l)), ['de', 'de', 'de', 'de']);
await p.waitForSelector('.crow[data-k="lightning bolt"]');
assert.equal(await p.$eval('.crow[data-k="lightning bolt"] .row-name', e => e.textContent), 'Blitzschlag', 'exemplaire allemand : nom imprimé allemand');
assert.equal(await p.$eval('.crow[data-k="wrath of god"] .row-name', e => e.textContent), 'Zorn Gottes');
await shot(p, 'intl-de-collection');
ok('import : allemand par défaut, 3 noms allemands reconnus, exemplaires allemands affichés sous leur nom allemand');

/* ── 3) « Ajouter une carte » et liste de souhaits : noms allemands ─────────────────────────── */
await p.click('.coll-tools [data-act="add"]'); await p.waitForSelector('#caName'); await p.waitForSelector('.sheet-wrap.open .sheet-head');
assert.match(await txt(p, '.sheet-wrap.open .sheet-head'), /Type its name in English or German/); assert.equal(await p.$eval('#caName', i => i.placeholder), 'Lightning Bolt or Blitzschlag');
await p.fill('#caName', 'gegenz'); await p.waitForSelector('.ca-opt'); assert.equal(await p.$eval('.ca-opt span', s => s.innerText.replace(/\s+/g, ' ').trim()), 'Gegenzauber Counterspell');
await p.click('.ca-opt'); await p.waitForTimeout(250); assert.match(await txt(p, '#caStatus'), /Gegenzauber · 1/);
assert.equal(await p.evaluate(() => COLL.map.counterspell.l), 'de', 'nom allemand choisi : exemplaire allemand');
await p.keyboard.press('Escape'); await sheetGone();
await p.evaluate(() => openWishAdd()); await p.waitForSelector('#waName'); await p.waitForSelector('.sheet-wrap.open .sheet-head');
assert.match(await txt(p, '.sheet-wrap.open .sheet-head'), /English or German name already known to Scryfall/);
await p.fill('#waName', 'Riesenw'); await p.waitForSelector('.ca-opt'); assert.equal(await p.$eval('.ca-opt span', s => s.innerText.replace(/\s+/g, ' ').trim()), 'Riesenwuchs Giant Growth');
await p.click('.ca-opt'); await p.waitForTimeout(200); assert.equal(await p.evaluate(() => TR.wish['giant growth'] && TR.wish['giant growth'].n), 'Giant Growth');
await p.keyboard.press('Escape'); await sheetGone();
ok('« Ajouter une carte » (« gegenz » → Gegenzauber, exemplaire allemand) et liste de souhaits (« Riesenw » → Giant Growth)');

/* ── 4) scan : moteur allemand d'abord, catalogue allemand ──────────────────────────────────── */
if (!canScan) console.log('· modèle Tesseract allemand absent (npm i dans tests/, ou TESS_DEU_DIR) : scan ignoré');
else {
  await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on');
  await p.evaluate(() => { window.__ol = []; const o = ocrLines; ocrLines = (c, l, psm) => { window.__ol.push(l); return o(c, l, psm); }; });
  const fx = n => new URL('./fixtures/' + n, import.meta.url).pathname;
  await p.setInputFiles('#scFile', [fx('blitz.jpg'), fx('zorn.jpg')]);
  await p.waitForFunction(() => !SC.working && !SC.queue.length && !SC.pend.length, null, { timeout: 200000 });
  const it = await p.evaluate(() => [...SC.items.values()].map(e => [e.name, e.l, scanShown(e)]));
  console.log('  scan allemand :', JSON.stringify(it), '· moteurs :', [...new Set(await p.evaluate(() => window.__ol))].join(','));
  assert.deepEqual(it.map(x => x[0]).sort(), ['Lightning Bolt', 'Wrath of God']); assert.ok(it.every(x => x[1] === 'de'), 'cartes lues en allemand : langue de');
  assert.deepEqual(it.map(x => x[2]).sort(), ['Blitzschlag', 'Zorn Gottes'], 'nom imprimé allemand dans la liste du scan');
  assert.equal((await p.evaluate(() => window.__ol))[0], 'deu', 'moteur allemand d\'abord'); assert.ok(tess.some(t => /tesseract\.js-data\/deu\//.test(t)), 'modèle allemand téléchargé');
  assert.ok(!tess.some(t => /tesseract\.js-data\/fra\//.test(t)), 'jamais le modèle français');
  await shot(p, 'intl-de-scan');
  ok('scan : cartes allemandes lues par le moteur « deu », retrouvées dans le catalogue allemand (Blitzschlag → Lightning Bolt)');
}
assert.equal(frHits, 0, 'jamais le catalogue français'); assert.deepEqual(errs, []);
await browser.close(); world.stop();
console.log('\nNAMES-DE E2E OK'); process.exit(0);
