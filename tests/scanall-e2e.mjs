// E2E scan « autres langues » SUR L'APPAREIL (appli en français) : le site sert names-all.tsv (gen-names-all.mjs), l'appli le télécharge une fois en Wi-Fi
// à l'ouverture du scan, et une carte italienne, allemande ou espagnole est reconnue sans le serveur : la route /api/names/find répond 404 (serveur pas
// encore redémarré) et n'est jamais demandée. Cartes françaises et anglaises : même score qu'avant, aucun index construit, aucune requête.
// Puis l'appli Android (ML Kit simulé) : mêmes cartes hors ligne, accents qui tranchent ; fichier absent du site → le serveur cherche (comme avant) ;
// réseau mobile → aucun téléchargement. Tesseract (fra + eng) servi depuis node_modules. Captures : SHOTS=dossier.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, startWorld, newPage, ok, toHome, slug } from './e2e-world.mjs';
import { namesAll } from '../gen-names-all.mjs';

const TESS_DIR = process.env.TESS_DIR || new URL('../tests/node_modules', import.meta.url).pathname;
if (!existsSync(TESS_DIR + '/tesseract.js')) { console.log('· tesseract.js absent (TESS_DIR) : test OCR ignoré'); process.exit(0); }
const SHOTS = process.env.SHOTS || ''; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (p, n) => { if (SHOTS) { await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const FX = new URL('./fixtures/', import.meta.url).pathname, fx = n => FX + n;
// names-all.tsv du site (dossier pwa/ temporaire des tests) : assemblé par le vrai générateur depuis les vraies lignes des cartes du test + 600 lignes de remplissage
// par langue ; AUCUN names-<langue>.tsv : le serveur ne saurait rien chercher lui-même.
const texts = Object.fromEntries(['de', 'es', 'it', 'pt'].map(l => [l, readFileSync(fx(`names-${l}.tsv`), 'utf8') + Array.from({ length: 600 }, (_, i) => `Vrombl ${l} ${i} Quarnax\tVrombl Card ${i}\t`).join('\n') + '\n']));
writeFileSync(join(process.env.PWA_DIR, 'names-all.tsv'), namesAll(texts).text);
const world = await startWorld({ port: 18938, bigCatalog: 35000 });
// noms anglais en plus : « Control Magic » est le piège de « Contromagia » (lu en anglais à 0,81 avant la recherche des autres langues)
const extra = (n, eur) => { world.prints[n] = [{ id: 's-' + slug(n), set: 'lea', set_name: 'Alpha', collector_number: '1', name: n, cmc: 1, type_line: 'Instant', mana_cost: '{R}', colors: ['R'], prices: { eur }, color_identity: ['R'], legalities: { commander: 'legal' }, image_uris: { small: `https://cards.scryfall.io/small/front/a/b/${slug(n)}.jpg` } }]; };
extra('Lightning Bolt', '0.80'); extra('Counterspell', '1.00'); extra('Control Magic', '3.00'); extra('Famine', '0.30'); extra('Archivist', '0.50');
const baseCat = world.catalog; world.catalog = () => [...baseCat(), 'Lightning Bolt', 'Counterspell', 'Control Magic', 'Famine', 'Mind Swords', 'Thunderbolt', 'Archivist'];
const CDN = [
  [/\/npm\/tesseract\.js@5\.1\.1\/dist\/(.+)$/, m => `${TESS_DIR}/tesseract.js/dist/${m[1]}`, 'text/javascript'],
  [/\/npm\/tesseract\.js-core@5\.1\.1\/(.+)$/, m => `${TESS_DIR}/tesseract.js-core/${m[1]}`, null],
  [/\/npm\/@tesseract\.js-data\/(eng|fra)\/4\.0\.0_best_int\/(.+)$/, m => `${TESS_DIR}/@tesseract.js-data/${m[1]}/4.0.0_best_int/${m[2]}`, 'application/gzip'],
];
async function routeCdn(ctx) {
  await ctx.route('https://cdn.jsdelivr.net/**', route => {
    const u = new URL(route.request().url());
    for (const [re, file, type] of CDN) {
      const m = re.exec(u.pathname); if (!m) continue;
      const f = file(m); if (!existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: type || (f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'), body: readFileSync(f) });
    }
    return route.fulfill({ status: 404, body: 'nf' });
  });
}
/** Images des cartes dans les autres langues (Scryfall « (!"Nom") lang:it ») : le catalogue de l'appareil n'a pas d'images, l'appli les demande ensuite. */
async function routeLangImg(p) {
  await p.route('https://api.scryfall.com/cards/search**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '', l = (/\blang:(it|de|es|pt)\b/.exec(q) || [])[1];
    if (!l || new URL(route.request().url()).searchParams.get('unique') === 'prints') return route.fallback();
    const data = [...q.matchAll(/!"(.+?)"/g)].map(m => m[1]).filter(n => world.prints[n] || n === 'Thunderbolt').map(n => ({ name: n, lang: l, image_uris: { small: `https://cards.scryfall.io/small/front/${l}/${slug(n)}.jpg` } }));
    return route.fulfill({ status: data.length ? 200 : 404, headers: { 'access-control-allow-origin': '*' }, json: data.length ? { object: 'list', has_more: false, data } : { object: 'error', code: 'not_found' } });
  });
}
const idle = (p, ms = 200000) => p.waitForFunction(() => !SC.working && !SC.queue.length && !SC.pend.length, null, { timeout: ms });
const rows = p => p.evaluate(() => [...SC.items.values()].map(e => ({ id: e.key + '|' + e.l, name: e.name, l: e.l, maybe: e.maybe, raw: e.raw, score: e.score, via: e.via || '', note: (document.querySelector(`.sc-item[data-id="${CSS.escape(e.id)}"] small`) || {}).textContent || '', thumb: (document.querySelector(`.sc-item[data-id="${CSS.escape(e.id)}"] .sc-th`) || {}).src || '' })));
const misses = p => p.$$eval('.sc-item.miss', r => r.map(x => x.querySelector('b').textContent));
const openScan = async p => { await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on'); };
/** Nouvelle page : requêtes names-all.tsv et /api/names/find comptées ; finds : réponse de la route (404 : serveur sans la recherche). opts.all : réponse forcée pour names-all.tsv (404…). */
async function page(opts = {}) {
  const b = await newPage(browser, world, { goto: false, ctx: { colorScheme: 'dark' } }), { ctx, p } = b; b.all = 0; b.finds = [];
  await routeCdn(ctx); await routeLangImg(p);
  if (opts.init) await ctx.addInitScript(opts.init.fn, opts.init.arg);
  if (opts.all) await ctx.route('**/names-all.tsv', r => r.fulfill(opts.all));
  await ctx.route('**/api/names/find**', r => { b.finds.push(decodeURIComponent(r.request().url().split('?')[1] || '')); return opts.find ? r.fulfill(opts.find) : r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }); });
  p.on('request', r => { if (/\/names-all\.tsv$/.test(new URL(r.url()).pathname)) b.all++; });
  await p.goto(world.url); await p.waitForTimeout(700); await p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
  return b;
}
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });

/* ── 0) référence : sans names-all.tsv sur le site (comme avant), carte française et carte anglaise ── */
let ref;
{
  const b = await page({ all: { status: 404, contentType: 'application/json', body: '{"error":"asset_missing"}' } }), { p } = b;
  await openScan(p); await p.waitForFunction(() => OTHX.at === 0 && !OTHX.dl, null, { timeout: 60000 });
  const t0 = Date.now(); await p.setInputFiles('#scFile', [fx('anneau.jpg'), fx('swords.jpg')]); await idle(p); ref = { ms: Date.now() - t0, it: await rows(p) };
  assert.deepEqual(ref.it.map(x => x.id).sort(), ['sol ring|fr', 'swords to plowshares|en']); assert.equal(b.all, 1, 'fichier demandé une fois (absent)'); assert.deepEqual(b.finds, []);
  await b.ctx.close();
  console.log('  référence :', ref.it.map(x => `${x.id} ${x.score}`).join(' · '), `· ${ref.ms} ms`);
}

/* ── 1) appli en français, names-all.tsv sur le site, serveur sans la recherche (404) : tout se passe sur l'appareil ── */
{
  const b = await page(), { p, errs } = b;
  assert.deepEqual(await p.evaluate(() => [I18N.lang, namesLang()]), ['fr', 'fr'], 'appli en français, noms français');
  await openScan(p); await p.waitForFunction(() => OTHX.at > 0 && !OTHX.dl, null, { timeout: 60000 });
  assert.equal(b.all, 1, 'téléchargé une fois, en arrière-plan, à l\'ouverture du scan');
  assert.deepEqual(await p.evaluate(async () => { const t = await namesAllText(); return [typeof t, t.split('\n')[0], Object.keys(OTHX.cats).length]; }), ['string', '# anglais\tfr\tde\tes\tit\tpt', 0], 'gardé sur l\'appareil ; aucun index tant qu\'aucune carte n\'en a besoin');
  // cartes française et anglaise : mêmes scores qu'avant, aucun index construit, aucune requête
  const t0 = Date.now(); await p.setInputFiles('#scFile', [fx('anneau.jpg'), fx('swords.jpg')]); await idle(p); const ms = Date.now() - t0;
  const it0 = await rows(p); console.log('  français et anglais :', it0.map(x => `${x.id} ${x.score}`).join(' · '), `· ${ms} ms (référence ${ref.ms} ms)`);
  assert.deepEqual(it0.map(x => [x.id, x.score, x.maybe]).sort(), ref.it.map(x => [x.id, x.score, x.maybe]).sort(), 'même carte, même langue, même score qu\'avant');
  assert.deepEqual([b.finds, await p.evaluate(() => Object.keys(OTHX.cats))], [[], []], 'cartes sûres : ni requête ni index des autres langues');
  ok('cartes française et anglaise : même lecture qu\'avant (scores identiques), aucune requête, aucun index des autres langues');

  await p.setInputFiles('#scFile', [fx('fulmine.jpg'), fx('contromagia.jpg'), fx('blitz.jpg'), fx('espadas.jpg')]); await idle(p, 300000);
  const it = await rows(p); console.log('  autres langues :', it.map(x => `${x.id}${x.maybe ? ' (?)' : ''} ${x.score} « ${x.raw} »`).join(' · '), '· non lu :', (await misses(p)).join(', '));
  const by = Object.fromEntries(it.map(x => [x.id, x]));
  assert.ok(by['lightning bolt|it'], '« Fulmine » (italien) → Lightning Bolt, exemplaire italien');
  assert.ok(by['counterspell|it'], '« Contromagia » (italien) → Counterspell, pas « Control Magic » lu en anglais');
  assert.ok(by['lightning bolt|de'], '« Blitzschlag » (allemand) → Lightning Bolt, exemplaire allemand');
  assert.ok(by['swords to plowshares|es'], '« Espadas en guadañas » (espagnol) → Swords to Plowshares, exemplaire espagnol');
  assert.ok(!it.some(x => x.name === 'Control Magic'), 'jamais la mauvaise carte anglaise'); assert.deepEqual(await misses(p), [], 'aucune carte non reconnue');
  assert.deepEqual(b.finds, [], 'aucune requête au serveur : tout est trouvé sur l\'appareil');
  assert.deepEqual(await p.evaluate(() => Object.keys(OTHX.cats).sort()), ['de', 'es', 'it', 'pt'], 'index des autres langues seulement (le français est déjà sur l\'appareil)');
  for (const [id, l] of [['lightning bolt|it', 'it'], ['counterspell|it', 'it'], ['lightning bolt|de', 'de'], ['swords to plowshares|es', 'es']]) { assert.equal(by[id].maybe, false, id + ' : lecture sûre'); assert.equal(by[id].via, l, id + ' : trouvée dans les autres langues'); }
  await p.waitForFunction(() => [['lightning bolt', 'it'], ['counterspell', 'it'], ['lightning bolt', 'de'], ['swords to plowshares', 'es']].every(([k, l]) => { const i = document.querySelector(`.sc-item[data-id="${k}|${l}"] .sc-th`); return i && i.src.endsWith(`/small/front/${l}/${k.replace(/ /g, '-')}.jpg`); }), null, { timeout: 10000 });
  assert.match(by['lightning bolt|it'].note, /lu en italien/); assert.match(by['lightning bolt|de'].note, /lu en allemand/); assert.match(by['swords to plowshares|es'].note, /lu en espagnol/);
  assert.equal(await p.$$eval('.sc-item .lchip[data-l="it"]', r => r.length), 2, 'drapeau italien sur les deux cartes italiennes');
  await shot(p, 'scanall-1-liste');
  ok('sans le serveur : « Fulmine » et « Contromagia » (it), « Blitzschlag » (de), « Espadas en guadañas » (es) → bonne carte, bonne langue, image de la langue, aucune requête');
  // ajout : exemplaires italiens, allemand et espagnol dans la collection, image de leur langue
  await p.click('.scan .dv-foot [data-act="done"]'); await p.waitForSelector('.rc-sheet [data-rc="go"]'); await p.click('.rc-sheet [data-rc="go"]'); await p.waitForFunction(() => !document.querySelector('.scan'), null, { timeout: 3000 });
  const coll = await p.evaluate(() => Object.fromEntries(['lightning bolt', 'counterspell'].map(k => [k, collLines(COLL.map[k])])));
  assert.deepEqual(coll['lightning bolt'].map(x => x.join(':')).sort(), ['de:1', 'it:1']); assert.deepEqual(coll.counterspell, [['it', 1]]);
  await p.waitForFunction(() => { const i = document.querySelector('.crow[data-k="counterspell"] .thumb img'); return i && /\/it\/counterspell\.jpg$/.test(i.src); }, null, { timeout: 8000 });
  assert.deepEqual(await p.evaluate(() => Object.keys(OTHX.cats)), [], 'scan fermé : index libérés');
  assert.deepEqual(errs.filter(e => !/WebAssembly|worker/i.test(e)), []);
  await b.ctx.close();
  ok('collection : exemplaires italiens et allemand, image de leur langue ; index libérés à la fermeture du scan');
}

/* ── 2) appli Android (ML Kit simulé) : d'autres noms, puis HORS LIGNE ; accents lus qui tranchent entre l'espagnol et le portugais ── */
const NAT = { fn: b64 => {
  window.__nat = { ocr: 0, text: 'Fulmine' };
  window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, Plugins: {
    CameraPreview: { start: async () => ({}), stop: async () => ({}), captureSample: async () => ({ value: b64 }) },
    CapacitorPluginMlKitTextRecognition: { detectText: async () => { window.__nat.ocr++; const t = window.__nat.text; return { text: t, blocks: [{ text: t, lines: [{ text: t }, { text: '{R}' }] }] }; } } } };
}, arg: readFileSync(fx('fulmine.jpg')).toString('base64') };
const natSnap = async (p, text, n) => { await p.evaluate(t => { window.__nat.text = t; }, text); await p.click('.sc-shot'); await p.waitForFunction(k => SC.cap >= k && SC.items.size + SC.miss.length >= k, n, { timeout: 30000 }); await idle(p, 30000); };
const natOpen = async p => { await openScan(p); await p.waitForFunction(() => document.querySelector('.sc-stage').dataset.native === '1', null, { timeout: 5000 }); };
{
  const b = await page({ init: NAT }), { p } = b;
  await natOpen(p); await p.waitForFunction(() => OTHX.at > 0 && !OTHX.dl, null, { timeout: 30000 }); assert.equal(b.all, 1);
  await natSnap(p, 'Sol Ring', 1); assert.deepEqual(await p.evaluate(() => Object.keys(OTHX.cats)), [], 'carte anglaise sûre : aucun index construit');
  await b.ctx.setOffline(true);
  const t0 = Date.now(); await natSnap(p, 'Fulmine', 2); const first = Date.now() - t0;
  const t1 = Date.now(); await natSnap(p, 'Blitzschlag', 3); const next = Date.now() - t1;
  await natSnap(p, 'Relâmpago', 4); await natSnap(p, 'Archivista', 5); await natSnap(p, 'Contrahechizo', 6);
  const got = await p.evaluate(() => [...SC.items.values()].map(e => [e.key + '|' + e.l, e.maybe, e.via || '']).sort());
  console.log('  hors ligne :', JSON.stringify(got), `· 1re carte ${first} ms (index construit), suivante ${next} ms`);
  assert.deepEqual(got, [['archivist|it', false, 'it'], ['counterspell|es', false, 'es'], ['lightning bolt|de', false, 'de'], ['lightning bolt|it', false, 'it'], ['sol ring|en', false, ''], ['thunderbolt|pt', false, 'pt']],
    'hors ligne : cartes italiennes, allemande, espagnole ; « Relâmpago » (accent portugais lu tel quel) → Thunderbolt (pt), pas Lightning Bolt (es) ; « Archivista » (cognat lu Archivist à 0,9) → italien');
  assert.deepEqual(b.finds, [], 'hors ligne et serveur sans la recherche : jamais demandé');
  await natSnap(p, 'Relampago', 7);
  assert.deepEqual(await p.evaluate(() => { const e = SC.items.get('lightning bolt|es'); return e && [e.maybe, e.via]; }), [true, 'es'], '« Relampago » sans accent : espagnol ou portugais ? à vérifier');
  await shot(p, 'scanall-2-android-hors-ligne');
  await b.ctx.setOffline(false); assert.deepEqual(b.errs, []); await b.ctx.close();
  ok('appli Android hors ligne : noms des autres langues lus sur l\'appareil, accents qui tranchent, nom ambigu à vérifier, aucune requête');
}

/* ── 3) fichier absent du site : le serveur cherche, comme avant ── */
{
  const hit = { name: 'Lightning Bolt', printed: 'Fulmine', lang: 'it', score: 1, raw: 'Fulmine', img: 'https://cards.scryfall.io/small/front/it/lightning-bolt.jpg' };
  const b = await page({ init: NAT, all: { status: 404, contentType: 'application/json', body: '{"error":"asset_missing"}' }, find: { status: 200, contentType: 'application/json', body: JSON.stringify({ hit, tried: ['de', 'es', 'it', 'pt'] }) } }), { p } = b;
  await natOpen(p); await p.waitForFunction(() => OTHX.at === 0 && !OTHX.dl && FRC.state === 'ready', null, { timeout: 30000 });
  await natSnap(p, 'Fulmine', 1);
  assert.equal(b.finds.length, 1, 'une requête au serveur'); assert.match(b.finds[0], /(^|&)skip=fr(&|$)/);
  assert.deepEqual(await p.evaluate(() => [...SC.items.values()].map(e => [e.key + '|' + e.l, e.via])), [['lightning bolt|it', 'it']]);
  assert.deepEqual(b.errs.filter(e => !/404/.test(e)), []); await b.ctx.close();
  ok('names-all.tsv absent du site : la recherche du serveur prend le relais (une requête), comme avant');
}

/* ── 4) réseau mobile : pas de téléchargement (aucune question nouvelle), le serveur reste le repli ── */
{
  const CELL = { fn: () => Object.defineProperty(navigator, 'connection', { value: { type: 'cellular', saveData: false }, configurable: true }) };
  const b = await page({ init: CELL }), { p } = b;
  await openScan(p); await p.waitForFunction(() => OTHX.at === 0 && !OTHX.dl && !SC.warm, null, { timeout: 60000 }); await p.waitForTimeout(500);
  assert.equal(b.all, 0, 'réseau mobile : names-all.tsv jamais demandé'); assert.equal(await p.evaluate(() => /autres langues/i.test(document.querySelector('.scan').textContent)), false, 'aucune question nouvelle');
  await b.ctx.close();
  ok('réseau mobile : aucun téléchargement du catalogue des autres langues, aucune question');
}

await browser.close(); world.stop();
console.log('\nSCANALL E2E OK'); process.exit(0);
