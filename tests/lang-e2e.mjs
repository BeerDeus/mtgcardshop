// E2E : cartes possédées → images dans la langue de l'exemplaire (viewer, réserve, image du deck), cartes non possédées inchangées ;
// étiquette « complet » + date sur sa propre ligne dans la liste des decks.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toInput, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18990 });
world.basics = true; world.noFr.add('Llanowar Elves');
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const decks = [
  { id: 'd1', name: 'Rakdos', text: '// Deck Deal : standard\nDeck\n4 Sol Ring\n2 Wrath of God\n10 Swamp\n\nSB: 2 Swords to Plowshares', updatedAt: Date.now() - 3 * 3600e3 },
  { id: 'd2', name: 'Edgar', text: '// Deck Deal : commander\nCommander\n1 Edgar Markov\n\nDeck\n1 Llanowar Elves', updatedAt: Date.now() - 2 * 86400e3 },
];
const seed = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '2 Sol Ring *FR*\\n1 Swords to Plowshares *FR*\\n1 Edgar Markov *EN*', u: 1, s: '', b: null })); localStorage.setItem('deckdeal:decks:v1', JSON.stringify(${JSON.stringify(decks.map(d => ({ ...d, opts: {}, cards: 1, history: [], createdAt: 1 })))})); localStorage.setItem('deckdeal:eng:v1', JSON.stringify({ d: { d1: { n: 'Rakdos', at: 1, q: { 'sol ring': 2 } } } })); } catch (e) {}`;
const { p, errs } = await newPage(browser, world, { init: seed });
await p.waitForTimeout(600);
const src = sel => p.$eval(sel, e => e.getAttribute('src')).catch(() => '');

/* ── 1) liste : « complet » + date sur sa propre ligne ───────────────────────────────────── */
await toHome(p); await p.click('#btnDecks'); await p.waitForSelector('.dks.on .deck');
const lines = await p.$$eval('.deck[data-id="d1"] .deck-meta > span', s => s.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
assert.equal(lines.length, 2, 'prix / complet, puis la date');
assert.match(lines[0], /^\d+ cartes?( · .*)? · complet$|^\d+ cartes? · complet$/); assert.match(lines[1], /^il y a 3 heures$/);
assert.equal(await p.$('.deck[data-id="d2"] .mounted'), null, 'pas d\'étiquette sur un deck non complet');
assert.match(await txt(p, '.deck[data-id="d2"] .deck-ago'), /^avant-hier$|^il y a 2 jours$/);
assert.equal(await p.$eval('.deck-meta', e => getComputedStyle(e).flexDirection), 'column', 'la date est sous la ligne');
assert.match(await txt(p, '#decksSub').catch(() => ''), /./);
ok('liste : « complet » à la place de « monté », date sous la ligne prix + complet');

/* ── 2) images dans la langue des cartes possédées ──────────────────────────────────────── */
await p.click('.deck[data-id="d1"] [data-act="open"]'); await p.waitForSelector('.dv.on[aria-label^="Deck viewer"] .dvc');
await p.waitForFunction(() => COLL.li['fr|sol ring'] && COLL.li['fr|swords to plowshares'], null, { timeout: 15000 });
await p.waitForFunction(() => /\/fr\/sol-ring/.test((document.querySelector('.dv[aria-label^="Deck viewer"] .dvc[aria-label^="Sol Ring"] img') || {}).src || ''), null, { timeout: 8000 });
const art = n => p.waitForFunction(n => [...document.querySelectorAll('.dv[aria-label^="Deck viewer"] .dvc')].some(t => t.getAttribute('aria-label').startsWith(n) && t.querySelector('img')), n, { timeout: 8000 }).then(() => p.$$eval('.dv[aria-label^="Deck viewer"] .dvc', (ts, n) => ts.filter(t => t.getAttribute('aria-label').startsWith(n)).map(t => t.querySelector('img').getAttribute('src')), n));
const sol = await art('Sol Ring'), wr = await art('Wrath of God'), sw = await art('Swords to Plowshares');
assert.match(sol[0], /\/fr\/sol-ring/, 'possédée en français : image française'); assert.match(wr[0], /wrath-of-god/); assert.doesNotMatch(wr[0], /\/fr\//, 'non possédée : image de la fiche (anglaise)');
assert.match(sw[0], /\/fr\/swords-to-plowshares/, 'réserve possédée en français : image française');
await p.click('.dv-g .dvc[aria-label^="Sol Ring"]'); await p.waitForSelector('.imgv'); await p.waitForFunction(() => /\/fr\/sol-ring/.test((document.querySelector('.imgv-img') || {}).src || (document.querySelector('.imgv img') || {}).src || ''), null, { timeout: 6000 });
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 });
ok('viewer : cartes possédées dans leur langue (deck et réserve), non possédées inchangées, carte en grand dans la même langue');

/* ── 3) image du deck : carte possédée dans sa langue ───────────────────────────────────── */
await p.evaluate(() => history.back()); await p.waitForFunction(() => !document.querySelector('.dv:not(.dks)'), null, { timeout: 3000 });
await p.waitForFunction(() => /\/fr\/sol-ring/.test((document.querySelector('.deck[data-id="d1"] .deck-art img') || {}).src || ''), null, { timeout: 8000 });
await p.waitForFunction(() => /edgar-markov/.test((document.querySelector('.deck[data-id="d2"] .deck-art img') || {}).src || ''), null, { timeout: 8000 });
assert.doesNotMatch(await src('.deck[data-id="d2"] .deck-art img'), /\/fr\//, 'Edgar possédé en anglais : image anglaise');
await p.click('.deck[data-id="d1"] .deck-more'); await p.waitForSelector('#dkCover'); await p.click('#dkCover'); await p.waitForSelector('.cv-card img');
await p.waitForFunction(() => /\/fr\//.test((document.querySelector('.cv-card[data-n="Sol Ring"] img') || {}).src || ''), null, { timeout: 6000 });
await p.keyboard.press('Escape');
ok('image du deck : la carte possédée est montrée dans sa langue (liste et choix)');
/* ── 4) aperçu en grand : en français quand Scryfall a la carte, sinon anglais avec une note ──────────────── */
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 }).catch(() => {});
const big = () => p.$eval('.imgv-img', i => i.getAttribute('src')).catch(() => '');
await p.click('.deck[data-id="d1"] [data-act="open"]'); await p.waitForSelector('.dv.on[aria-label^="Deck viewer"] .dvc');
await p.click('.dv-g .dvc[aria-label^="Wrath of God"]'); await p.waitForFunction(() => /\/large\/front\/fr\/wrath-of-god/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 8000 });
assert.match(await txt(p, '.imgv-sub'), /français/i); assert.doesNotMatch(await txt(p, '.imgv-sub'), /Pas d'image/, 'la version française existe : pas de note');
// les voisines (même lot) : Sol Ring possédée en français reste française, un terrain de base sans version française reste anglais avec la note
const seen = {};
for (let i = 0; i < 5; i++) {
  await p.waitForSelector('.imgv-img.ok', { timeout: 8000 });
  const nm = await txt(p, '.imgv-cap b'); await p.waitForFunction(() => document.querySelector('.imgv-card').dataset.busy === '0', null, { timeout: 8000 });
  seen[nm] = { src: await big(), sub: await txt(p, '.imgv-sub') };
  if (!(await p.$('.imgv-nav.next:not([disabled])'))) break;
  await p.click('.imgv-nav.next'); await p.waitForFunction(n => document.querySelector('.imgv-cap b').textContent !== n, nm, { timeout: 4000 });
}
assert.match(seen['Wrath of God'].src, /\/fr\/wrath-of-god/); if (seen['Sol Ring']) assert.match(seen['Sol Ring'].src, /\/fr\/sol-ring/, 'possédée en français');
const lands = Object.entries(seen).filter(([n]) => /Swamp/.test(n)); if (lands.length) { assert.doesNotMatch(lands[0][1].src, /\/fr\//); assert.match(lands[0][1].sub, /Pas d'image française/); }
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 });
await p.evaluate(() => history.back()); await p.waitForFunction(() => !document.querySelector('.dv:not(.dks)'), null, { timeout: 3000 });
// carte sans version française chez Scryfall (Llanowar Elves) : image anglaise + note ; Edgar possédé en anglais : anglais, sans note
await p.click('.deck[data-id="d2"] [data-act="open"]'); await p.waitForSelector('.dv.on[aria-label^="Deck viewer"] .dvc');
await p.click('.dv-g .dvc[aria-label^="Llanowar Elves"]'); await p.waitForSelector('.imgv-img.ok', { timeout: 8000 });
assert.doesNotMatch(await big(), /\/fr\//); assert.match(await txt(p, '.imgv-sub'), /Pas d'image française sur Scryfall/);
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 });
await p.click('.dv-cmd, .dv-g .dvc[aria-label^="Edgar Markov"]').catch(() => {}); 
if (await p.$('.imgv')) { await p.waitForSelector('.imgv-img.ok', { timeout: 8000 }); assert.doesNotMatch(await big(), /\/fr\//, 'possédé en anglais : version anglaise'); assert.doesNotMatch(await txt(p, '.imgv-sub'), /Pas d'image/); await p.keyboard.press('Escape'); }
ok('aperçu en grand : français quand Scryfall l\'a (deck, réserve), anglais avec note sinon, exemplaire anglais respecté');
assert.deepEqual(errs, [], 'erreurs page : ' + errs.join(' | '));
await browser.close(); world.stop();
console.log('LANG E2E OK'); process.exit(0);
