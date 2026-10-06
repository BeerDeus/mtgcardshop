// E2E : écran « Mes decks » (bouton d'accueil, decks en cartes), carte de présentation au choix, filtres format / couleurs,
// réserve Standard et images des terrains de base dans le viewer.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok } from './e2e-world.mjs';

const world = await startWorld({ port: 18980 });
world.basics = true;
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const decks = [
  { id: 'd1', name: 'Rakdos', text: '// Deck Deal : standard\nDeck\n4 Sol Ring\n10 Swamp\n12 Mountain\n\nSB: 2 Swords to Plowshares\nSB: 1 Wrath of God', updatedAt: 40 },
  { id: 'd2', name: 'Edgar', text: '// Deck Deal : commander\nCommander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n1 Command Tower\n5 Plains\n5 Swamp\n5 Mountain', updatedAt: 30 },
  { id: 'd3', name: 'Forêt', text: '// Deck Deal : standard\nDeck\n4 Llanowar Elves\n20 Forest', updatedAt: 20 },
  { id: 'd4', name: 'Mystère', text: '1 Sol Ring\n1 Arcane Signet', updatedAt: 10 },
];
const seed = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '1 Sol Ring *EN*', u: 1, s: '', b: null })); localStorage.setItem('deckdeal:decks:v1', JSON.stringify(${JSON.stringify(decks.map(d => ({ ...d, opts: {}, cards: 1, history: [], createdAt: 1 })))})); } catch (e) {}`;
const { p, errs } = await newPage(browser, world, { init: seed });
await p.waitForTimeout(600);
const back = async () => { await p.evaluate(() => history.back()); await p.waitForTimeout(350); };
const names = () => p.$$eval('#deckList .deck .deck-name', n => n.map(x => x.textContent));
const imgOf = id => p.$eval(`.deck[data-id="${id}"] .deck-art img`, e => e.getAttribute('src')).catch(() => '');

/* ── 1) bouton d'accueil → écran, decks en cartes ─────────────────────────────────────────── */
assert.equal(await txt(p, '#decksSub'), '4 decks'); assert.equal(await p.$('.deck'), null, 'plus de liste sur l\'accueil');
await p.click('#btnDecks'); await p.waitForSelector('.dks.on .deck');
assert.deepEqual(await names(), ['Rakdos', 'Edgar', 'Forêt', 'Mystère'], 'les plus récents d\'abord'); assert.equal(await txt(p, '.dks .dv-title span'), '4 decks');
// carte de présentation par défaut : commandant (Edgar), sinon la carte la plus chère hors terrains
await p.waitForFunction(() => document.querySelectorAll('.deck-art img.ok').length === 4, null, { timeout: 8000 });
assert.match(await imgOf('d2'), /edgar-markov/, 'commandant'); assert.match(await imgOf('d1'), /sol-ring/); assert.match(await imgOf('d3'), /llanowar-elves/); assert.match(await imgOf('d4'), /sol-ring/, 'la plus chère : Sol Ring 1,50 € > Signet 0,40 €');
assert.equal(await p.$eval('.deck[data-id="d1"] .deck-art', e => Math.round(e.getBoundingClientRect().width / e.getBoundingClientRect().height * 1000)), 718, 'forme d\'une carte (672 × 936)');
assert.equal(await p.$$eval('#deckList .deck', d => new Set(d.map(x => Math.round(x.getBoundingClientRect().left))).size), 2, 'grille à 2 colonnes');
await p.waitForTimeout(600); await p.screenshot({ path: 'shots/dks-1-grille.png' });
ok('bouton « Mes decks » → écran ; decks en cartes avec leur image (commandant / carte la plus chère par défaut)');

/* ── 2) filtres : format, couleurs ───────────────────────────────────────────────────────── */
assert.equal(await p.$eval('#dksFilters', e => e.hidden), false);
await p.click('#dksSeg .seg-opt[data-v="commander"]'); assert.deepEqual(await names(), ['Edgar']); assert.equal(await txt(p, '.dks .dv-title span'), '1 sur 4 decks');
await p.click('#dksSeg .seg-opt[data-v="standard"]'); assert.deepEqual(await names(), ['Rakdos', 'Forêt'], 'Standard : décks marqués Standard seulement');
await p.click('#dksSeg .seg-opt[data-v=""]'); assert.equal((await names()).length, 4);
assert.equal(await p.$eval('.dks-c[data-c="U"]', e => e.disabled), true, 'aucun deck bleu : couleur grisée'); assert.equal(await p.$eval('.dks-c[data-c="R"]', e => e.disabled), false);
await p.click('.dks-c[data-c="R"]'); assert.deepEqual(await names(), ['Rakdos', 'Edgar'], 'rouge : Rakdos (B R) et Edgar (W B R)'); assert.equal(await p.$eval('.dks-c[data-c="R"]', e => e.getAttribute('aria-pressed')), 'true');
await p.click('.dks-c[data-c="W"]'); assert.deepEqual(await names(), ['Edgar'], 'toutes les couleurs cochées : rouge ET blanc');
await p.click('#dksSeg .seg-opt[data-v="standard"]'); assert.equal(await p.$$eval('#deckList .deck', n => n.length), 0); assert.match(await txt(p, '#deckList'), /Aucun deck ne correspond/); assert.equal(await p.$eval('.dks-reset', e => e.hidden), false);
await p.click('.dks-reset'); assert.equal((await names()).length, 4); assert.equal(await p.$eval('.dks-reset', e => e.hidden), true); assert.equal(await p.$eval('#dksSeg', e => e._v), '');
ok('filtres : Commander / Standard, couleurs (toutes celles cochées), vide + « Tout afficher »');

/* ── 3) carte de présentation : choisie dans la feuille du deck ─────────────────────────── */
await p.click('.deck[data-id="d1"] .deck-more'); await p.waitForSelector('#dkCover');
assert.match(await txt(p, '#dkCoverSub'), /^Sol Ring · automatique$/);
await p.click('#dkCover'); await p.waitForSelector('.cv-card'); await p.waitForFunction(() => document.querySelectorAll('.cv-card img.ok').length === 3, null, { timeout: 8000 });
assert.deepEqual(await p.$$eval('.cv-card', c => c.map(x => x.dataset.n)), ['Swords to Plowshares', 'Sol Ring', 'Wrath of God'], 'cartes du deck et de la réserve, les plus chères d\'abord (égalité : ordre alphabétique)');
await p.fill('#cvQ', 'wrath'); assert.deepEqual(await p.$$eval('.cv-card', c => c.map(x => x.dataset.n)), ['Wrath of God']);
await p.click('.cv-card'); await p.waitForFunction(() => !document.querySelector('#cvGrid'), null, { timeout: 3000 });
assert.match(await txt(p, '#dkCoverSub'), /^Wrath of God · choisie$/);
const d1 = await p.evaluate(() => findDeck('d1'));
assert.match(d1.text, /^\/\/ Deck Deal : standard\n\/\/ Deck Deal cover : Wrath of God\nDeck\n/); assert.equal(d1.updatedAt, 40, 'le deck garde sa place'); assert.equal(await p.evaluate(() => deckFmt(findDeck('d1'))), 'standard');
assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:decks:v1')).find(d => d.id === 'd1').text.includes('cover : Wrath of God')), true, 'gardé sur l\'appareil');
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
await p.waitForFunction(() => /wrath-of-god/.test((document.querySelector('.deck[data-id="d1"] .deck-art img') || {}).src || ''), null, { timeout: 8000 });
assert.deepEqual(await names(), ['Rakdos', 'Edgar', 'Forêt', 'Mystère']); assert.equal(await p.$eval('.deck[data-id="d1"] .deck-fmt', e => e.textContent), 'Standard');
// « Automatique » : retire le choix
await p.click('.deck[data-id="d1"] .deck-more'); await p.waitForSelector('#dkCover'); await p.click('#dkCover'); await p.waitForSelector('.cv-card[aria-pressed="true"]'); assert.equal(await p.$eval('.cv-card[aria-pressed="true"]', e => e.dataset.n), 'Wrath of God');
await p.click('#cvAuto'); await p.waitForFunction(() => !document.querySelector('#cvGrid'), null, { timeout: 3000 }); assert.match(await txt(p, '#dkCoverSub'), /^Sol Ring · automatique$/);
assert.equal(await p.evaluate(() => /cover/.test(findDeck('d1').text)), false);
await p.click('#dkCover'); await p.click('.cv-card[data-n="Wrath of God"]'); await p.waitForFunction(() => !document.querySelector('#cvGrid'), null, { timeout: 3000 });
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
ok('carte de présentation : choisie (ligne « // Deck Deal cover » dans le texte, sans changer l\'ordre), image mise à jour, « Automatique »');

/* ── 4) l'éditeur garde la carte choisie ────────────────────────────────────────────────── */
await p.click('.deck[data-id="d1"] .deck-more'); await p.waitForSelector('#dkEdit'); await p.click('#dkEdit'); await p.waitForSelector('.bd.on');
await p.waitForSelector('.bd-row[data-k="mountain"]'); await p.click('.bd-row[data-k="mountain"][data-t="main"] [data-d="1"]'); await p.waitForTimeout(150);
await p.click('#bdSave'); await p.waitForFunction(() => !document.querySelector('.bd'), null, { timeout: 4000 });
assert.match(await p.evaluate(() => findDeck('d1').text), /^\/\/ Deck Deal : standard\n\/\/ Deck Deal cover : Wrath of God\nDeck\n4 Sol Ring\n10 Swamp\n13 Mountain\n/, 'carte choisie gardée après modification dans l\'éditeur');
ok('éditeur de deck : la carte de présentation choisie est conservée');

/* ── 5) viewer : réserve et terrains de base ─────────────────────────────────────────────── */
await p.click('.deck[data-id="d1"] [data-act="open"]'); await p.waitForSelector('.dv.on[aria-label^="Deck viewer"] .dv-g');
await p.waitForFunction(() => document.querySelector('.dv-g[data-g="sb"]') && document.querySelectorAll('.dv-g[data-g="land"] .dvc-art img.ok').length === 2, null, { timeout: 8000 });
const lab = sel => p.$$eval(sel, t => t.map(x => x.getAttribute('aria-label').replace(/\s/g, ' ')));
assert.deepEqual(await lab('.dv-g[data-g="sb"] .dvc'), ['Swords to Plowshares, ×2, 3,80 €, réserve', 'Wrath of God, 1,50 €, réserve'], 'réserve : tuiles, prix tendance');
assert.match(await txt(p, '.dv-g[data-g="sb"] h3'), /^Réserve 3 cartes · ≈ 5,30 € · prix tendance$/);
assert.match(await txt(p, '.dv[aria-label^="Deck viewer"] .dv-title span'), /réserve 3$/); assert.equal((await p.waitForFunction(() => !document.querySelector('.dv-amt[data-tw]')), await txt(p, '.dv-eur')), '≈ 6,00 €', 'total du deck sans la réserve (4 Sol Ring × 1,50 €)');
assert.equal((await p.$$eval('.dv-g[data-g="land"] .dvc', t => t.length)), 2, 'terrains de base : 2 tuiles avec leur image');
assert.deepEqual(await p.$$eval('.dv-g .dvc', t => t.map(x => x.closest('.dv-g').dataset.g).filter((g, i, a) => a.indexOf(g) === i)), ['m1', 'land', 'sb'], 'réserve en dernier');
await p.click('.dv-g[data-g="sb"] .dvc >> nth=1'); await p.waitForSelector('.imgv'); assert.match(await txt(p, '.imgv-extra'), /Réserve · 1,50 € · prix tendance Cardmarket/); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 });
await p.click('.dv-g[data-g="land"] .dvc >> nth=0'); await p.waitForSelector('.imgv'); assert.match(await txt(p, '.imgv-extra'), /Terrain de base/); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 });
// tri par prix : la réserve reste à part
await p.click('#dvSeg .seg-opt[data-v="price"]'); assert.deepEqual(await p.$$eval('.dv-g', g => g.map(x => x.dataset.g)), ['p', 'b', 'sb']);
await p.waitForTimeout(600); await p.screenshot({ path: 'shots/dks-2-viewer-reserve.png' });
ok('viewer : réserve à part (prix tendance, hors total, avec le tri), images des terrains de base, carte en grand');
await back(); await p.waitForFunction(() => !document.querySelector('.dv:not(.dks)'), null, { timeout: 3000 }); assert.ok(await p.$('.dks.on'));
await back(); await p.waitForFunction(() => !document.querySelector('.dks'), null, { timeout: 3000 });

assert.deepEqual(errs, [], 'erreurs page : ' + errs.join(' | '));
await browser.close(); world.stop();
console.log('DKLIST E2E OK');
