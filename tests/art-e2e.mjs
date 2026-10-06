// E2E : bouton « Illustrations » de l'aperçu en grand : impressions de la carte dans la langue affichée, choix gardé (aperçus d'une carte seule), « Par défaut ».
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, done } from './e2e-world.mjs';

const world = await startWorld({ port: 18991 });
world.basics = true; world.variants['Llanowar Elves'] = { fr: 0, en: 1 };
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const decks = [
  { id: 'd1', name: 'Rakdos', text: '// Deck Deal : standard\nDeck\n4 Sol Ring\n2 Wrath of God\n2 Llanowar Elves', updatedAt: 40 },
  { id: 'd2', name: 'Edgar', text: '// Deck Deal : commander\nCommander\n1 Edgar Markov\n\nDeck\n1 Wrath of God', updatedAt: 30 },
];
const seed = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '2 Sol Ring *FR*\\n1 Edgar Markov *EN*', u: 1, s: '', b: null })); localStorage.setItem('deckdeal:decks:v1', JSON.stringify(${JSON.stringify(decks.map(d => ({ ...d, opts: {}, cards: 1, history: [], createdAt: 1 })))})); } catch (e) {}`;
const { p, errs } = await newPage(browser, world, { init: seed });
await p.waitForTimeout(600);
const big = () => p.$eval('.imgv-img', i => i.getAttribute('src')).catch(() => '');
const store = () => p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:art:v1') || '{}'));
const openCard = async n => { await p.click(`.dv-g .dvc[aria-label^="${n}"], .dv-cmd[aria-label^="${n}"]`); await p.waitForSelector('.imgv-img.ok', { timeout: 8000 }); };
const closeImg = async () => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 }); };

await p.click('#btnDecks'); await p.waitForSelector('.dks.on .deck');
await p.click('.deck[data-id="d1"] [data-act="open"]'); await p.waitForSelector('.dv.on[aria-label^="Deck viewer"] .dvc');

/* ── 1) le bouton apparaît quand la carte a au moins 2 impressions dans la langue affichée ──────────────── */
await openCard('Wrath of God');
await p.waitForFunction(() => /\/large\/front\/fr\/wrath-of-god\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 8000 });
await p.waitForSelector('.imgv-art:not([hidden])', { timeout: 6000 });
assert.equal(await txt(p, '.imgv-art'), 'Illustrations · 4', 'impressions françaises, puis celles qui n\'existent qu\'en anglais (promos…)');
assert.equal(await p.$('.imgv-vars:not([hidden])'), null, 'liste fermée tant qu\'on ne la demande pas');
await p.click('.imgv-art'); await p.waitForSelector('.imgv-vars:not([hidden]) .imgv-v');
assert.deepEqual(await p.$$eval('.imgv-v', b => b.map(x => x.querySelector('span').textContent)), ['CMM 100', '2X2 101', 'LEA 102', 'M21 103'], 'françaises (plus récentes d\'abord), puis anglaises seules');
assert.deepEqual(await p.$$eval('.imgv-v img', i => i.map(x => x.getAttribute('src').replace(/^.*\/front\//, ''))), ['fr/wrath-of-god-v0.jpg', 'fr/wrath-of-god-v1.jpg', 'fr/wrath-of-god-v2.jpg', 'en/wrath-of-god-v3.jpg']);
assert.match(await txt(p, '.imgv-v >> nth=3'), /anglais/, 'impression anglaise seulement : marquée'); assert.doesNotMatch(await txt(p, '.imgv-v >> nth=0'), /anglais/);
assert.match(await txt(p, '.imgv-v >> nth=0'), /étendue/); assert.match(await txt(p, '.imgv-v >> nth=1'), /plein art/); assert.match(await txt(p, '.imgv-v >> nth=2'), /sans bordure/);
assert.equal(await p.$eval('.imgv-art', e => e.getAttribute('aria-expanded')), 'true');
ok('bouton « Illustrations · 4 » : impressions françaises, plus récentes d\'abord, puis celles qui n\'existent qu\'en anglais (marquées), particularités (étendue, plein art, sans bordure)');

/* ── 2) choisir une illustration : l'image change, le choix est gardé ──────────────────────────────── */
await p.click('.imgv-v >> nth=1'); await p.waitForFunction(() => /wrath-of-god-v1\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 6000 });
assert.match(await big(), /\/large\/front\/fr\/wrath-of-god-v1\.jpg/); assert.match(await txt(p, '.imgv-sub'), /Double Masters 2022 · 2X2 101/); assert.match(await txt(p, '.imgv-sub'), /français/i, 'même langue');
assert.equal(await p.$eval('.imgv-v:not(.def) >> nth=1', e => e.getAttribute('aria-pressed')), 'true'); assert.match(await txt(p, '.imgv-vh'), /Double Masters 2022 · retenue pour cette carte/);
const st = await store(); assert.deepEqual(Object.keys(st), ['fr|wrath of god']); assert.match(st['fr|wrath of god'].u[0], /wrath-of-god-v1/);
await closeImg();
await openCard('Wrath of God'); await p.waitForFunction(() => /wrath-of-god-v1\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 6000 });
assert.match(await txt(p, '.imgv-sub'), /2X2 101/, 'illustration retenue à la réouverture');
await closeImg();
// un autre aperçu de la même carte (autre deck) : la même illustration
await p.evaluate(() => history.back()); await p.waitForFunction(() => !document.querySelector('.dv:not(.dks)'), null, { timeout: 3000 });
await p.click('.deck[data-id="d2"] [data-act="open"]'); await p.waitForSelector('.dv.on[aria-label^="Deck viewer"] .dvc');
await openCard('Wrath of God'); await p.waitForFunction(() => /wrath-of-god-v1\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 6000 });
ok('illustration choisie : image et extension changent, gardée pour cette carte (réouverture, autre deck)');

/* ── 2b) impression qui n'existe qu'en anglais (promo…) : choisie depuis la vue française, légende anglaise, gardée pour la vue française ── */
await p.waitForSelector('.imgv-art:not([hidden])'); await p.click('.imgv-art'); await p.waitForSelector('.imgv-v >> nth=4');
await p.click('.imgv-v:not(.def) >> nth=3'); await p.waitForFunction(() => /\/en\/wrath-of-god-v3\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 6000 });
assert.match(await txt(p, '.imgv-sub'), /anglais/i, 'légende : langue de l\'image'); assert.match(await txt(p, '.imgv-sub'), /M21 103/);
{ const st2 = await store(); assert.deepEqual(Object.keys(st2), ['fr|wrath of god'], 'rattachée à la vue française'); assert.equal(st2['fr|wrath of god'].il, 'en'); }
await closeImg(); await openCard('Wrath of God'); await p.waitForFunction(() => /\/en\/wrath-of-god-v3\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 6000 });
assert.match(await txt(p, '.imgv-sub'), /anglais/i, 'réouverture : toujours légendée en anglais');
ok('impression anglaise seulement (promo…) : choisie depuis la vue française, légende juste, retenue pour cette carte');

/* ── 3) « Par défaut » ───────────────────────────────────────────────────────────────────────────────── */
await p.waitForSelector('.imgv-art:not([hidden])'); await p.click('.imgv-art'); await p.waitForSelector('.imgv-v.def');
assert.equal(await txt(p, '.imgv-v.def'), 'Par défaut'); await p.click('.imgv-v.def');
await p.waitForFunction(() => /\/large\/front\/fr\/wrath-of-god\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 6000 });
assert.deepEqual(await store(), {}, 'choix effacé'); await p.waitForSelector('.imgv-vars:not([hidden]) .imgv-v:not(.def)'); assert.equal(await p.$('.imgv-v.def'), null);
await closeImg();
ok('« Par défaut » : retour à l\'image d\'origine, choix effacé');

/* ── 4) langue affichée : exemplaire anglais → impressions anglaises ; une seule impression → pas de bouton ──────────────── */
await p.click('.dv-cmd, .dv-g .dvc[aria-label^="Edgar Markov"]'); await p.waitForSelector('.imgv-img.ok', { timeout: 8000 });
await p.waitForSelector('.imgv-art:not([hidden])', { timeout: 6000 }); assert.equal(await txt(p, '.imgv-art'), 'Illustrations · 4', 'Edgar possédé en anglais : impressions anglaises');
await p.click('.imgv-art'); await p.waitForSelector('.imgv-v'); assert.ok((await p.$$eval('.imgv-v img', i => i.every(x => /\/en\//.test(x.getAttribute('src'))))), 'toutes en anglais');
await closeImg(); await p.evaluate(() => history.back()); await p.waitForFunction(() => !document.querySelector('.dv:not(.dks)'), null, { timeout: 3000 });
await p.click('.deck[data-id="d1"] [data-act="open"]'); await p.waitForSelector('.dv.on[aria-label^="Deck viewer"] .dvc');
await openCard('Llanowar Elves'); await p.waitForTimeout(1200); assert.equal(await p.$('.imgv-art:not([hidden])'), null, 'pas de version française : image anglaise, une seule impression → pas de bouton');
await closeImg();
// carte possédée en français (Sol Ring) : impressions françaises ; glissement vers la carte suivante : la liste ouverte suit
await openCard('Sol Ring'); await p.waitForSelector('.imgv-art:not([hidden])', { timeout: 6000 }); assert.equal(await txt(p, '.imgv-art'), 'Illustrations · 4', '3 françaises + 1 anglaise seulement');
await p.click('.imgv-art'); await p.waitForSelector('.imgv-v'); const first = await txt(p, '.imgv-cap b');
let cur = first, kept = false;
for (let i = 0; i < 4 && !kept; i++) {      // carte suivante : si elle a plusieurs illustrations, la liste reste ouverte
  await p.click('.imgv-nav.next:not([disabled])'); await p.waitForFunction(n => document.querySelector('.imgv-cap b').textContent !== n, cur, { timeout: 4000 }); cur = await txt(p, '.imgv-cap b');
  await p.waitForTimeout(1000); kept = !!(await p.$('.imgv-art:not([hidden])'));
}
assert.ok(kept, 'une carte voisine a plusieurs illustrations'); assert.ok(await p.$('.imgv-vars:not([hidden]) .imgv-v'), 'liste ouverte conservée d\'une carte à l\'autre');
await p.waitForTimeout(300); await p.screenshot({ path: 'shots/art-1-illustrations.png' });
await closeImg();
ok('langue affichée respectée (anglais / français), une seule impression : pas de bouton, liste conservée en naviguant');
/* ── 5) aperçu d'une offre : on feuillette les illustrations, mais l'impression de l'offre n'est pas remplacée durablement ───────────── */
await p.evaluate(() => { localStorage.removeItem('deckdeal:art:v1'); }); await p.reload(); await p.waitForTimeout(800);
await p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
await p.fill('#deckText', '1 Sol Ring\n1 Swords to Plowshares'); await p.waitForTimeout(300); await p.click('#btnRun'); await done(p);
await p.click('#list .rw .thumb, #list .rw img >> nth=0').catch(() => {});
if (!(await p.$('.imgv'))) { await p.click('#btnViewer'); await p.waitForSelector('.dv.on .dvc'); await p.click('.dv-g .dvc >> nth=0'); }
await p.waitForSelector('.imgv-img.ok', { timeout: 8000 }); await p.waitForSelector('.imgv-art:not([hidden])', { timeout: 8000 });
await p.click('.imgv-art'); await p.waitForSelector('.imgv-v'); assert.match(await txt(p, '.imgv-vh'), /aperçu seulement/, 'offre : on ne retient pas');
await p.click('.imgv-v >> nth=0'); await p.waitForFunction(() => /-v0\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 6000 });
assert.deepEqual(await store(), {}, 'rien de gardé pour l\'aperçu d\'une offre');
ok('aperçu d\'une offre : illustrations consultables, rien de retenu');
/* ── 6) collection : même bouton, même langue ; une collection qui se charge en fond (file Scryfall encombrée) ne le retarde pas ───────── */
await p.reload(); await p.waitForTimeout(800); await p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
await p.click('#btnColl'); await p.waitForSelector('.coll.on .crow'); await p.waitForFunction(() => document.querySelectorAll('.crow .thumb img.ok').length >= 2, null, { timeout: 12000 });
await p.evaluate(() => { for (let i = 0; i < 30; i++) limScry.schedule(() => new Promise(r => setTimeout(r, 200))); });      // ~16 s de lectures de fond en attente
const t0 = Date.now();
await p.locator('.crow', { hasText: 'Sol Ring' }).first().locator('.thumb').click(); await p.waitForSelector('.imgv-img.ok', { timeout: 8000 });
await p.waitForFunction(() => /\/fr\/sol-ring/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 8000 });
assert.match(await txt(p, '.imgv-sub'), /français/i, 'exemplaire français : aperçu français');
await p.waitForSelector('.imgv-art:not([hidden])', { timeout: 5000 }); assert.ok(Date.now() - t0 < 6000, 'le bouton n\'attend pas la file de fond');
assert.equal(await txt(p, '.imgv-art'), 'Illustrations · 4', '3 françaises + 1 anglaise seulement');
await p.click('.imgv-art'); await p.waitForSelector('.imgv-v'); await p.click('.imgv-v >> nth=2');
await p.waitForFunction(() => /sol-ring-v2\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 6000 });
assert.deepEqual(Object.keys(await store()), ['fr|sol ring'], 'retenue pour la carte');
await closeImg(); await p.locator('.crow', { hasText: 'Sol Ring' }).first().locator('.thumb').click(); await p.waitForFunction(() => /sol-ring-v2\.jpg/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 6000 });
await closeImg();
ok('collection : « Illustrations » comme dans les decks (langue de l\'exemplaire, choix retenu), non retardé par les lectures de fond');
assert.deepEqual(errs, [], 'erreurs page : ' + errs.join(' | '));
await browser.close(); world.stop();
console.log('ART E2E OK'); process.exit(0);
