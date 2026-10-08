// E2E « Prix réels » de la collection : offre CardTrader la moins chère par carte, filtre de langue, lots, valeur, arrêt, persistance.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toInput, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18930 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const { p, errs } = await newPage(browser, world);
const tags = k => p.$$eval(`.crow[data-k="${k}"] .px`, t => t.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
const idle = () => p.waitForFunction(() => !COLL.pxRun, null, { timeout: 40000 });
const langsReq = bp => world.log.filter(l => l.path === 'marketplace/products' && Number(l.q.blueprint_id) === bp).map(l => l.q.language);
const openPx = async () => { await p.click('.coll-px'); await p.waitForSelector('.sheet-wrap.open #pxLang'); };
const sumTxt = () => txt(p, '#pxSum');

// collection : 2 Sol Ring (fr), Swords (sans langue → langue de la recherche), Craterhoof (en), Ranger's Hawk (fr, aucune offre), Edgar Markov (fr) + 10 Plains (ignorés)
await p.evaluate(() => { COLL.map = { 'sol ring': { n: 'Sol Ring', q: 2, l: 'fr' }, 'swords to plowshares': { n: 'Swords to Plowshares', q: 1 }, 'craterhoof behemoth': { n: 'Craterhoof Behemoth', q: 1, l: 'en' }, 'rangers hawk': { n: "Ranger's Hawk", q: 1, l: 'fr' }, 'edgar markov': { n: 'Edgar Markov', q: 1, l: 'fr' }, plains: { n: 'Plains', q: 10 } }; collChanged(); });
world.en[104] = 700;                                    // Craterhoof : 7,00 € en anglais (estimation Cardmarket 9,00 €)
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
await p.waitForFunction(() => document.querySelectorAll('.crow .px.cm').length >= 5, null, { timeout: 8000 }).catch(async e => { console.log('DEBUG', await p.evaluate(() => JSON.stringify({ map: COLL.map, meta: COLL.meta, rows: document.querySelectorAll('.crow').length, st: document.querySelector('.coll-status').textContent, enr: COLL.enrichErr }))); throw e; });
assert.equal(await p.$$eval('.coll-px', b => b.length), 1); assert.match(await p.getAttribute('.coll-px', 'aria-label'), /prix réels/i);
await p.screenshot({ path: 'shots/px-0-bouton.png' });

/* 1) feuille : filtre de langue avec les effectifs, portée, critères repris de la recherche */
await openPx();
assert.deepEqual(await p.$$eval('#pxLang option', o => o.map(x => x.textContent)), ['Toutes (5)', 'Français (3)', 'Anglais (1)', 'Sans langue (1) · cherchées en français'], 'Plains exclus des effectifs');
assert.match(await sumTxt(), /5 cartes à lire sur 5/); assert.match(await sumTxt(), /Aucun prix lu/); assert.match(await txt(p, '.sheet-body'), /état ≥ SP · non foil · CardTrader Zero/);
await p.selectOption('#pxLang', 'fr'); assert.match(await sumTxt(), /3 cartes à lire sur 3/); assert.match(await txt(p, '#pxGo'), /Lire 3 prix/);
await p.screenshot({ path: 'shots/px-1-feuille.png' });
ok('feuille « Prix réels » : langues présentes avec effectifs, terrains de base ignorés, critères de la recherche affichés');

/* 2) lecture des cartes françaises seulement */
await p.click('#pxGo'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 4000 });
await p.waitForFunction(() => !!COLL.pxRun || Object.keys(COLL.px).length, null, { timeout: 4000 });
await idle(); await p.waitForTimeout(200);
const t = async k => (await tags(k)).filter(x => /^C[TM] /.test(x) || /aucune/.test(x));
assert.deepEqual(await t('sol ring'), ['CM 1,50 €', 'CT 1,50 €']); assert.deepEqual(await t('edgar markov'), ['CM 5,00 €', 'CT 5,00 €']); assert.deepEqual(await t('rangers hawk'), ['CM 0,05 €', 'CT aucune offre']);
assert.deepEqual(await t('swords to plowshares'), ['CM 1,90 €'], 'sans langue : pas lue (filtre français)'); assert.deepEqual(await t('craterhoof behemoth'), ['CM 9,00 €'], 'anglais : pas lue');
assert.deepEqual(langsReq(104), [], 'aucune requête pour la carte anglaise'); assert.ok(world.reqs(100) >= 1 && world.reqs(108) >= 1);
assert.ok(!world.scry.some(s => /Plains/i.test(decodeURIComponent(s))), 'terrains de base : jamais cherchés');
assert.match(await txt(p, '.coll-status'), /Prix réels à jour : 2 cartes · 1 sans offre/); await p.click('.coll-status [data-act="pxok"]'); assert.equal(await p.$eval('.coll-status', e => e.hidden), true);
await p.screenshot({ path: 'shots/px-2-resultat.png' });
ok('lecture des cartes françaises : prix de l\'offre la plus basse (CT), « aucune offre » signalé, autres langues et terrains de base intacts');

/* 3) « à actualiser » : rien à relire ; « toutes » : relit avec le nouveau prix ; les autres langues ensuite */
await openPx(); await p.selectOption('#pxLang', 'fr'); assert.match(await sumTxt(), /0 carte à lire sur 3/); assert.match(await sumTxt(), /3 déjà lues · dernière lecture à l'instant/); assert.equal(await p.$eval('#pxGo', b => b.disabled), true);
await p.click('#pxScope [data-v="all"]'); assert.match(await sumTxt(), /3 cartes à lire sur 3/);
world.setPrice(100, 120); const r1 = world.reqs(100);
await p.click('#pxGo'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 4000 }); await idle(); await p.waitForTimeout(200);
assert.deepEqual(await t('sol ring'), ['CM 1,50 €', 'CT 1,20 €']); assert.ok(world.reqs(100) > r1, 'relue sur CardTrader');
await p.click('.coll-status [data-act="pxok"]');
await openPx(); await p.selectOption('#pxLang', 'none'); assert.match(await sumTxt(), /1 carte à lire sur 1/); await p.click('#pxGo'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 4000 }); await idle(); await p.waitForTimeout(200);
assert.deepEqual(await t('swords to plowshares'), ['CM 1,90 €', 'CT 2,00 €'], 'sans langue : cherchée dans la langue de la recherche (français)');
await p.click('.coll-status [data-act="pxok"]');
await openPx(); await p.selectOption('#pxLang', 'en'); await p.click('#pxGo'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 4000 }); await idle(); await p.waitForTimeout(200);
assert.deepEqual(await t('craterhoof behemoth'), ['CM 9,00 €', 'CT 7,00 €'], 'carte anglaise : offre anglaise (7,00 € au lieu des 9,00 € estimés)'); assert.deepEqual(langsReq(104), ['en'], 'requêtes en anglais seulement');
assert.deepEqual(await p.$eval('.crow[data-k="craterhoof behemoth"] .row-px', e => [...e.children].map(c => c.className)), ['px cm', 'px ct'], 'CM au-dessus, CT en dessous : les deux restent visibles (rien de barré)');
{ const st = await p.$eval('.crow[data-k="craterhoof behemoth"] .row-px', e => [...e.children].map(c => { const cs = getComputedStyle(c), b = getComputedStyle(c.querySelector('b')); return { color: cs.color, deco: b.textDecorationLine, size: parseFloat(b.fontSize), op: cs.opacity }; }));
  assert.notEqual(st[0].color, st[1].color, 'couleurs différentes'); assert.ok(st.every(x => x.deco === 'none' && x.size >= 14 && x.op === '1'), 'ni barré ni pâle, 14 px : ' + JSON.stringify(st)); }
await p.click('.coll-status [data-act="pxok"]');
await p.screenshot({ path: 'shots/px-3-langues.png' });
ok('« à actualiser » / « toutes », puis sans langue (langue de la recherche) et anglais : chaque carte lue dans sa langue');

/* 4) valeur, tri et « les plus chères » sur le prix réel */
await p.selectOption('#collSort', 'price');
assert.deepEqual(await p.$$eval('.crow .row-name', n => n.map(x => x.textContent)), ['Craterhoof Behemoth', 'Edgar Markov', 'Swords to Plowshares', 'Sol Ring', "Ranger's Hawk", 'Plains'], 'tri par prix (source CM par défaut : 9,00 · 5,00 · 1,90 · 1,50 · 0,05 · sans prix)');
// onglet Cartes : CM au-dessus, CT en dessous, juste au-dessus de la quantité (même colonne : le nom garde la largeur), lisibles
{ const g = await p.$eval('.crow[data-k="sol ring"]', r => { const q = r.querySelector('.qstep').getBoundingClientRect(), px = r.querySelector('.row-px').getBoundingClientRect(), [a, b] = [...r.querySelectorAll('.px')].map(e => e.getBoundingClientRect()); return { adjacent: q.top >= px.bottom - 1 && q.top - px.bottom < 14 && px.left < q.right && px.right > q.left, stacked: b.top >= a.bottom - 1, qw: Math.round(q.width), fs: parseFloat(getComputedStyle(r.querySelector('.px b')).fontSize) }; });
  assert.deepEqual([g.adjacent, g.stacked], [true, true], 'prix juste au-dessus de la quantité, CM puis CT en dessous'); assert.ok(g.fs >= 14, 'prix lisible'); assert.ok(g.qw <= 90, 'quantité compacte (' + g.qw + ' px)'); }
await p.click('#collSeg [data-v="stats"]'); await p.waitForSelector('.cs-tiles');
const val = async () => (await p.$eval('.cs-val b', b => b.textContent)).replace(/\s+/g, ' ');
assert.equal(await p.$$eval('.cs-tiles > div b', b => b.map(x => x.textContent.replace(/\s+/g, ' ')).join('|')), '6|16|18,95 €', 'défaut : tendance Cardmarket');   // 2 × 1,50 + 1,90 + 9,00 + 0,05 + 5,00
assert.equal(await txt(p, '.cs-sw i.on'), 'CM'); assert.match(await txt(p, '.cs-val span'), /tendance Cardmarket/); assert.match(await p.getAttribute('.cs-val', 'aria-label'), /source Cardmarket/); assert.match((await txt(p, '.cs-val .cs-src')).replace(/\s+/g, ' '), /CT : 16,45 €/, 'valeur CT en regard');
assert.deepEqual(await p.$$eval('.cs-top .crow .row-name', n => n.map(x => x.textContent)), ['Craterhoof Behemoth', 'Edgar Markov', 'Sol Ring', 'Swords to Plowshares', "Ranger's Hawk"], 'CM, par lot : Sol Ring 2 × 1,50 € = 3,00 € passe devant Swords 1,90 €');
assert.equal(await p.$('.cs-top .tag.real'), null, 'CM : pas de « prix réel »'); assert.match(await txt(p, '.cs-top .crow:nth-child(3)'), /× 2.*3,00 €.*1,50 € × 2/);
await p.screenshot({ path: 'shots/px-4-stats.png' });
// tuile de valeur : un appui bascule CM (tendance Cardmarket) ↔ CT (prix réels CardTrader), choix retenu
await p.click('.cs-val'); assert.equal(await val(), '16,45 €', 'CT : prix réels'); assert.equal(await txt(p, '.cs-sw i.on'), 'CT');
assert.match(await txt(p, '.cs-tiles > div:nth-child(3) span'), /4 au prix réel CardTrader, 1 estimées Cardmarket/); assert.match(await p.getAttribute('.cs-val', 'aria-label'), /source CardTrader/); assert.match((await txt(p, '.cs-val .cs-src')).replace(/\s+/g, ' '), /CM : 18,95 €/, 'CM en regard');
assert.deepEqual(await p.$$eval('.cs-top .crow .row-name', n => n.map(x => x.textContent)), ['Craterhoof Behemoth', 'Edgar Markov', 'Sol Ring', 'Swords to Plowshares', "Ranger's Hawk"], 'CT, par lot (2 × 1,20 € = 2,40 € devant 2,00 €)');
assert.match(await txt(p, '.cs-top .crow:first-child'), /prix réel.*7,00 €/i); assert.equal(await p.evaluate(() => localStorage.getItem('deckdeal:coll:src')), 'ct');
await p.screenshot({ path: 'shots/px-4b-stats-ct.png' });
await p.reload(); await p.waitForTimeout(500); await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('#collSeg [data-v="stats"]'); await p.waitForSelector('.cs-val');
assert.equal(await val(), '16,45 €', 'choix CT retenu après rechargement');
await p.focus('.cs-val'); await p.keyboard.press('Enter'); assert.equal(await val(), '18,95 €', 'Entrée : retour à CM'); assert.equal(await p.evaluate(() => document.activeElement.className), 'cs-val', 'focus gardé sur la tuile');
await p.keyboard.press(' '); assert.equal(await val(), '16,45 €', 'Espace : CT'); await p.click('.cs-val .cs-src'); assert.equal(await val(), '18,95 €', 'appui n\'importe où dans la tuile : CM');
assert.equal(await p.evaluate(() => localStorage.getItem('deckdeal:coll:src')), 'cm');
await p.click('#collSeg [data-v="list"]');
ok('valeur de la collection (CM par défaut, bascule CT : clic, clavier, retenue), prix CM / CT empilés à gauche de la quantité, plus chères par lot');

/* 5) persistance : rien à relire après rechargement */
const before = world.reqs();
await p.reload(); await p.waitForTimeout(900); await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.crow .px.ct', { timeout: 5000 });
assert.deepEqual(await t('craterhoof behemoth'), ['CM 9,00 €', 'CT 7,00 €']); assert.equal(world.reqs(), before, 'aucune requête CardTrader au rechargement');
assert.equal(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('deckdeal:px:v1'))).length), 5);
ok('prix réels gardés sur l\'appareil (localStorage), aucune requête au rechargement');

/* 6) langue changée = critères changés : la carte redevient « à actualiser » ; arrêt en cours de lecture */
await p.evaluate(() => collSetLang('edgar markov', 'en'));
await openPx(); assert.match(await sumTxt(), /1 carte à lire sur 5/, 'Edgar passé en anglais : prix français périmé'); await p.keyboard.press('Escape'); await p.waitForTimeout(500);
world.delay = 600;
await openPx(); await p.click('#pxScope [data-v="all"]'); await p.click('#pxGo'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 4000 });
await p.waitForSelector('.coll-status [data-act="pxstop"]', { timeout: 5000 }); assert.match(await txt(p, '.coll-status'), /Prix réels · \d+ \/ 5/);
await p.screenshot({ path: 'shots/px-5-en-cours.png' });
await p.click('.coll-status [data-act="pxstop"]'); await idle(); world.delay = 0;
assert.match(await txt(p, '.coll-status'), /Lecture interrompue/); await p.click('.coll-status [data-act="pxok"]');
ok('changer la langue périme le prix ; lecture arrêtable (« Arrêter »), prix déjà lus gardés');

/* 7) garde-fous : recherche en cours, démo, pas de token */
await p.evaluate(() => { S.demo = true; }); await p.evaluate(() => pxRun([{ key: 'sol ring', name: 'Sol Ring', lang: 'fr' }])); assert.match(await txt(p, '#toast'), /Mode démo/); await p.evaluate(() => { S.demo = false; });
ok('démo : pas de faux prix réels');

console.log('erreurs page :', errs.length ? errs : 'aucune'); assert.deepEqual(errs, []);
await browser.close(); world.stop(); console.log('\nPRIX E2E OK'); process.exit(0);
