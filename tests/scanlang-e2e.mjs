// E2E scan « autres langues » (appli en français) : une carte italienne, allemande ou espagnole n'est ni dans le catalogue français ni anglaise ;
// le serveur cherche alors le nom lu dans les catalogues des autres langues (GET /api/names/find, fichiers names-*.tsv) : bonne carte ET bonne langue
// (drapeau, image de la langue, exemplaire de la collection). Les cartes françaises et anglaises ne demandent rien au serveur (requêtes comptées).
// Tesseract (fra + eng seulement) servi depuis node_modules ; puis l'appli Android (ML Kit simulé), puis un serveur sans cette recherche. Captures : SHOTS=dossier.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, startWorld, newPage, ok, toHome, slug } from './e2e-world.mjs';

const TESS_DIR = process.env.TESS_DIR || new URL('../tests/node_modules', import.meta.url).pathname;
if (!existsSync(TESS_DIR + '/tesseract.js')) { console.log('· tesseract.js absent (TESS_DIR) : test OCR ignoré'); process.exit(0); }
const SHOTS = process.env.SHOTS || ''; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (p, n) => { if (SHOTS) { await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const FX = new URL('./fixtures/', import.meta.url).pathname, fx = n => FX + n;
// catalogues des autres langues servis par le proxy des tests (dossier pwa/ temporaire) : vraies lignes des cartes du test + 600 lignes de remplissage (≥ 500 exigées)
for (const l of ['de', 'es', 'it', 'pt']) writeFileSync(join(process.env.PWA_DIR, `names-${l}.tsv`), readFileSync(fx(`names-${l}.tsv`), 'utf8') + Array.from({ length: 600 }, (_, i) => `Vrombl ${l} ${i} Quarnax\tVrombl Card ${i}\t`).join('\n') + '\n');
const world = await startWorld({ port: 18936, bigCatalog: 35000 });
// noms anglais en plus : « Control Magic » est le piège de « Contromagia » (lu en anglais à 0,81 avant la recherche des autres langues)
const extra = (n, eur) => { world.prints[n] = [{ id: 's-' + slug(n), set: 'lea', set_name: 'Alpha', collector_number: '1', name: n, cmc: 1, type_line: 'Instant', mana_cost: '{R}', colors: ['R'], prices: { eur }, color_identity: ['R'], legalities: { commander: 'legal' }, image_uris: { small: `https://cards.scryfall.io/small/front/a/b/${slug(n)}.jpg` } }]; };
extra('Lightning Bolt', '0.80'); extra('Counterspell', '1.00'); extra('Control Magic', '3.00'); extra('Famine', '0.30'); extra('Archivist', '0.50');
const baseCat = world.catalog; world.catalog = () => [...baseCat(), 'Lightning Bolt', 'Counterspell', 'Control Magic', 'Famine', 'Mind Swords', 'Thunderbolt', 'Archivist'];
const CDN = [
  [/\/npm\/tesseract\.js@5\.1\.1\/dist\/(.+)$/, m => `${TESS_DIR}/tesseract.js/dist/${m[1]}`, 'text/javascript'],
  [/\/npm\/tesseract\.js-core@5\.1\.1\/(.+)$/, m => `${TESS_DIR}/tesseract.js-core/${m[1]}`, null],
  [/\/npm\/@tesseract\.js-data\/(eng|fra)\/4\.0\.0_best_int\/(.+)$/, m => `${TESS_DIR}/@tesseract.js-data/${m[1]}/4.0.0_best_int/${m[2]}`, 'application/gzip'],
];
const tess = [];
async function routeCdn(ctx) {
  await ctx.route('https://cdn.jsdelivr.net/**', route => {
    const u = new URL(route.request().url()); tess.push(u.pathname);
    for (const [re, file, type] of CDN) {
      const m = re.exec(u.pathname); if (!m) continue;
      const f = file(m); if (!existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: type || (f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'), body: readFileSync(f) });
    }
    return route.fulfill({ status: 404, body: 'nf' });
  });
}
const idle = (p, ms = 200000) => p.waitForFunction(() => !SC.working && !SC.queue.length && !SC.pend.length, null, { timeout: ms });
const rows = p => p.evaluate(() => [...SC.items.values()].map(e => ({ id: e.key + '|' + e.l, name: e.name, l: e.l, maybe: e.maybe, raw: e.raw, score: e.score, via: e.via || '', note: (document.querySelector(`.sc-item[data-id="${CSS.escape(e.id)}"] small`) || {}).textContent || '', thumb: (document.querySelector(`.sc-item[data-id="${CSS.escape(e.id)}"] .sc-th`) || {}).src || '' })));
const misses = p => p.$$eval('.sc-item.miss', r => r.map(x => x.querySelector('b').textContent));
const finds = [];      // requêtes « autres langues » parties de la page
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });

/* ── 1) appli en français : cartes française et anglaise d'abord (rien à demander au serveur), puis italiennes, allemande, espagnole ── */
const { ctx, p, errs } = await newPage(browser, world, { goto: false, ctx: { colorScheme: 'dark' } });
await routeCdn(ctx); p.on('request', r => { if (/\/api\/names\/find/.test(r.url())) finds.push(decodeURIComponent(r.url().split('?')[1] || '')); });
await p.goto(world.url); await p.waitForTimeout(700); await p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
assert.deepEqual(await p.evaluate(() => [I18N.lang, namesLang()]), ['fr', 'fr'], 'appli en français, noms français');
// texte lu qui n'a pas l'air de la langue du nom reconnu : seul cas où une lecture « sûre » mais de justesse (< 0,92) demande les autres langues
assert.deepEqual(await p.evaluate(() => [['Foresta', 'Forest'], ['Archivista', 'Archiviste'], ['Ira di Dio', 'Wrath of God'], ["Sheoldred, l'Apocalisse", 'Sheoldred, the Apocalypse'], ['Relámpago', 'Lightning Bolt'], ['Elfi di Llanowar', 'Elfes de Llanowar'],
  ['Forest', 'Forest'], ['Wrath of Gad', 'Wrath of God'], ['Die Young', 'Die Young'], ['Colere de Dieu', 'Colère de Dieu'], ["Ajani's Pridemate", "Ajani's Pridemate"], ['Swords to Plowshores', 'Swords to Plowshares']].map(([r, f]) => looksForeign(r, f))),
  [true, true, true, true, true, true, false, false, false, false, false, false], 'cognats, mots de liaison, élisions, accents : autre langue ; lecture abîmée d\'allure anglaise ou française : non');
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on');
await p.evaluate(() => { window.__ol = []; const o = ocrLines; ocrLines = async (c, l, psm) => { const r = await o(c, l, psm); window.__ol.push([l, r.map(x => x.text).join(' / ')]); return r; }; });
await p.setInputFiles('#scFile', [fx('anneau.jpg'), fx('swords.jpg')]); await idle(p);
let it = await rows(p); console.log('  français et anglais :', it.map(x => `${x.id} ${x.score}`).join(' · '));
assert.deepEqual(it.map(x => x.id).sort(), ['sol ring|fr', 'swords to plowshares|en'], 'carte française lue en français, carte anglaise en anglais');
assert.deepEqual(finds, [], 'cartes sûres en français ou en anglais : aucune recherche dans les autres langues');
ok('appli en français : « Anneau solaire » → Sol Ring (fr), « Swords to Plowshares » (en), sans requête « autres langues »');

await p.setInputFiles('#scFile', [fx('fulmine.jpg'), fx('contromagia.jpg'), fx('blitz.jpg'), fx('espadas.jpg')]); await idle(p, 300000);
it = await rows(p); console.log('  autres langues :', it.map(x => `${x.id}${x.maybe ? ' (?)' : ''} ${x.score} « ${x.raw} »`).join(' · '), '· non lu :', (await misses(p)).join(', '));
console.log('  lu (OCR) :', JSON.stringify((await p.evaluate(() => window.__ol)).filter(x => x[1]).slice(-12)));
console.log('  requêtes :', finds.length, JSON.stringify(finds));
const by = Object.fromEntries(it.map(x => [x.id, x]));
assert.ok(by['lightning bolt|it'], '« Fulmine » (italien) → Lightning Bolt, exemplaire italien');
assert.ok(by['counterspell|it'], '« Contromagia » (italien) → Counterspell, pas « Control Magic » lu en anglais');
assert.ok(by['lightning bolt|de'], '« Blitzschlag » (allemand) → Lightning Bolt, exemplaire allemand');
assert.ok(by['swords to plowshares|es'], '« Espadas en guadañas » (espagnol) → Swords to Plowshares, exemplaire espagnol');
assert.ok(!it.some(x => x.name === 'Control Magic'), 'jamais la mauvaise carte anglaise');
assert.deepEqual((await misses(p)), [], 'aucune carte non reconnue');
for (const [id, l] of [['lightning bolt|it', 'it'], ['counterspell|it', 'it'], ['lightning bolt|de', 'de'], ['swords to plowshares|es', 'es']]) {
  assert.equal(by[id].maybe, false, id + ' : lecture sûre');
  assert.equal(by[id].via, l, id + ' : trouvée par la recherche des autres langues');
  assert.match(by[id].thumb, new RegExp(`/small/front/${l}/${slug(by[id].name)}\\.jpg$`), id + ' : miniature dans sa langue');
}
assert.match(by['lightning bolt|it'].note, /lu en italien/); assert.match(by['lightning bolt|de'].note, /lu en allemand/); assert.match(by['swords to plowshares|es'].note, /lu en espagnol/);
assert.equal(await p.$$eval('.sc-item .lchip[data-l="it"]', r => r.length), 2, 'drapeau italien sur les deux cartes italiennes');
assert.ok(finds.length >= 4 && finds.length <= 8, 'une ou deux requêtes par carte étrangère (' + finds.length + ')'); assert.ok(finds.every(f => /(^|&)skip=fr(&|$)/.test(f)), 'le français (catalogue de l\'appareil) n\'est pas recherché sur le serveur');
assert.ok(!tess.some(t => /tesseract\.js-data\/(ita|spa|por|deu)\//.test(t)), 'deux modèles OCR seulement (fra + eng) : le texte des autres langues reste lisible');
await shot(p, 'scanlang-1-liste');
ok('appli en français : « Fulmine » et « Contromagia » (it), « Blitzschlag » (de), « Espadas en guadañas » (es) → bonne carte, bonne langue, image de la langue, « lu en … »');

// visionneuse : image italienne, « lu en italien »
await p.click(`.sc-item[data-id="${'lightning bolt|it'}"] .sc-th`); await p.waitForSelector('.imgv');
assert.match(await p.$eval('.imgv', e => e.textContent), /lu en italien/);
await shot(p, 'scanlang-2-visionneuse');
await p.click('.imgv-x'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 });
// ajout : exemplaires italiens, allemand et espagnol dans la collection (texte *IT*, *DE*, *ES*)
await p.click('.scan .dv-foot [data-act="done"]'); await p.waitForSelector('.rc-sheet [data-rc="go"]'); await p.click('.rc-sheet [data-rc="go"]'); await p.waitForFunction(() => !document.querySelector('.scan'), null, { timeout: 3000 });
const coll = await p.evaluate(() => Object.fromEntries(['lightning bolt', 'counterspell', 'swords to plowshares'].map(k => [k, collLines(COLL.map[k])])));
assert.deepEqual(coll['lightning bolt'].map(x => x.join(':')).sort(), ['de:1', 'it:1']); assert.deepEqual(coll.counterspell, [['it', 1]]);
assert.ok(coll['swords to plowshares'].some(x => x[0] === 'es') && coll['swords to plowshares'].some(x => x[0] === 'en'));
assert.match(await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:coll:v1')).t), /Counterspell( \(D[0-9a-z]{6}\))? \*IT\*/, 'langue enregistrée (et envoyée au compte)');
await p.waitForSelector('.crow[data-k="counterspell"] .lchip[data-l="it"]'); await p.waitForFunction(() => { const i = document.querySelector('.crow[data-k="counterspell"] .thumb img'); return i && /\/it\/counterspell\.jpg$/.test(i.src); }, null, { timeout: 5000 });
await shot(p, 'scanlang-3-collection');
ok('collection : exemplaires italiens, allemand et espagnol, image de leur langue');
assert.deepEqual(errs.filter(e => !/WebAssembly|worker/i.test(e)), []);
await ctx.close();

/* ── 2) appli Android : ML Kit (toutes les langues latines) puis la même comparaison ; une seule requête pour la carte italienne, aucune pour Sol Ring ── */
{
  const nat = await newPage(browser, world, { goto: false, ctx: { colorScheme: 'dark' } }), np = nat.p, nf = [];
  const jpg = readFileSync(fx('fulmine.jpg')).toString('base64');
  await nat.ctx.addInitScript(b64 => {
    window.__nat = { ocr: 0, text: 'Fulmine' };
    window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, Plugins: {
      CameraPreview: { start: async () => ({}), stop: async () => ({}), captureSample: async () => ({ value: b64 }) },
      CapacitorPluginMlKitTextRecognition: { detectText: async () => { window.__nat.ocr++; const t = window.__nat.text; return { text: t, blocks: [{ text: t, lines: [{ text: t }, { text: '{R}' }] }] }; } } } };
  }, jpg);
  await routeCdn(nat.ctx); np.on('request', r => { if (/\/api\/names\/find/.test(r.url())) nf.push(r.url()); });
  await np.goto(world.url); await np.waitForTimeout(700);
  await toHome(np); await np.click('#btnColl'); await np.waitForSelector('.coll.on'); await np.click('.coll-tools [data-act="scan"]'); await np.waitForSelector('.scan.on');
  await np.waitForFunction(() => document.querySelector('.sc-stage').dataset.native === '1', null, { timeout: 5000 });
  const snap = async (text, n) => { await np.evaluate(t => { window.__nat.text = t; }, text); await np.click('.sc-shot'); await np.waitForFunction(k => SC.cap >= k && SC.items.size + SC.miss.length >= k, n, { timeout: 20000 }); await idle(np, 20000); };
  await snap('Sol Ring', 1); assert.equal(nf.length, 0, 'ML Kit : carte anglaise sûre, aucune requête');
  await snap('Wrath of Gad', 2); assert.equal(nf.length, 0, 'lecture anglaise moyenne (0,92) mais texte d\'allure anglaise : aucune requête');
  await snap('Fulmine', 3); assert.equal(nf.length, 1, 'une seule requête pour la carte italienne (les passes fra et eng relisent les mêmes lignes ML Kit)');
  await snap('Archivista', 4); assert.equal(nf.length, 2, 'cognat lu en anglais de justesse (Archivist 0,9) : les autres langues sont demandées');
  const got = await np.evaluate(() => [...SC.items.values()].map(e => [e.key + '|' + e.l, e.maybe]).sort());
  assert.deepEqual(got, [['archivist|it', false], ['lightning bolt|it', false], ['sol ring|en', false], ['wrath of god|en', false]], 'ML Kit : « Fulmine » et « Archivista » → cartes italiennes ; les anglaises restent anglaises');
  await shot(np, 'scanlang-4-android');
  assert.deepEqual(nat.errs, []); await nat.ctx.close();
  ok('appli Android : ML Kit lit « Fulmine » et « Archivista » (passé pour Archivist anglais à 0,9), la même recherche les retrouve en italien (1 requête chacune) ; cartes anglaises sans requête');
}

/* ── 3) serveur sans cette recherche (ancienne version, désactivée) : la carte reste « non reconnue », rien ne casse, plus de requête pendant la session ── */
{
  const o = await newPage(browser, world, { goto: false }), op = o.p; let hits = 0;
  await routeCdn(o.ctx); await o.ctx.route('**/api/names/find**', r => { hits++; r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }); });
  await op.goto(world.url); await op.waitForTimeout(700);
  await toHome(op); await op.click('#btnColl'); await op.waitForSelector('.coll.on'); await op.click('.coll-tools [data-act="scan"]'); await op.waitForSelector('.scan.on');
  await op.setInputFiles('#scFile', [fx('fulmine.jpg'), fx('fulmine.jpg')]); await idle(op);
  assert.deepEqual((await misses(op)).length, 2, 'sans le serveur : non reconnue, comme avant'); assert.equal(hits, 1, 'serveur sans la recherche : demandé une seule fois par session');
  assert.deepEqual(o.errs.filter(e => !/WebAssembly|worker|404/i.test(e)), []); await o.ctx.close();
  ok('serveur sans recherche des autres langues : carte non reconnue comme avant, une seule requête par session');
}

await browser.close(); world.stop();
console.log('\nSCANLANG E2E OK'); process.exit(0);
