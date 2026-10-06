// E2E mouvement (motion.js) : carte en grand partie de la vignette (FLIP), inclinaison foil qui suit le pointeur, cascades,
// sens des onglets, chiffre qui défile, en-tête au défilement, et tout coupé par « réduire les animations ».
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, ok } from './e2e-world.mjs';

const world = await startWorld({ port: 18980 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const DECK = 'Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n1 Swords to Plowshares\n1 Craterhoof Behemoth\n1 Command Tower\n1 Arcane Signet\n10 Plains';
const seed = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '4 Sol Ring\\n2 Swords to Plowshares\\n3 Llanowar Elves\\n1 Wrath of God', u: 1, s: '', b: null }));
  localStorage.setItem('deckdeal:decks:v1', JSON.stringify([{ id: 'd1', name: 'Edgar', text: ${JSON.stringify(DECK)}, opts: {}, cards: 16, history: [], createdAt: 1, updatedAt: 2 }])); } catch (e) {}`;
const errsOf = [];
const anims = (p, sel) => p.$eval(sel, e => e.getAnimations({ subtree: true }).map(a => a.animationName || (a.effect && a.effect.getKeyframes().length ? 'waapi' : '?')));

{
  const { p, errs } = await newPage(browser, world, { init: seed, ctx: { isMobile: false, hasTouch: false } }); errsOf.push(errs);
  await p.evaluate(() => { const o = stagger; window.__stg = []; stagger = (...a) => { window.__stg.push(a.flat().filter(Boolean).map(e => e.className).join(' ')); return o(...a); }; });      // les repeints (lecture des cartes) remplacent la liste : on suit les appels
  await p.click('#btnColl'); await p.waitForSelector('.coll.on .coll-list');
  assert.ok((await p.evaluate(() => window.__stg)).some(c => /coll-list/.test(c)), 'liste : arrivée en cascade');
  await p.click('#collSeg [data-v="trade"]'); assert.equal(await p.$eval('.coll-main', e => e.dataset.dir), 'l', 'onglet à droite : arrive de la droite');
  await p.click('#collSeg [data-v="stats"]'); assert.equal(await p.$eval('.coll-main', e => e.dataset.dir), 'r');
  await p.click('#collSeg [data-v="list"]'); await p.waitForSelector('.coll-list .crow .thumb img.ok', { timeout: 8000 });
  ok('collection : cascade à l\'ouverture, onglets qui arrivent du bon côté');

  await p.click('.coll-list .crow .thumb'); await p.waitForSelector('.imgv.on');
  assert.ok((await anims(p, '.imgv-card')).includes('waapi'), 'carte en grand : part de la vignette (FLIP)');
  await p.waitForTimeout(600);
  const c = await (await p.$('.imgv-card')).boundingBox();
  await p.mouse.move(c.x + c.width * 0.9, c.y + c.height * 0.1, { steps: 6 }); await p.waitForTimeout(150);
  const st = await p.$eval('.imgv-card', e => ({ rx: parseFloat(e.style.getPropertyValue('--rx')), ry: parseFloat(e.style.getPropertyValue('--ry')), on: e.classList.contains('tilting'), t: getComputedStyle(e).transform }));
  assert.ok(st.on && st.rx > 2 && st.ry > 2 && st.t !== 'none', 'inclinaison vers le pointeur (haut droite) : ' + JSON.stringify(st));
  assert.equal(await p.$eval('.imgv-card img.imgv-img', i => getComputedStyle(i).pointerEvents), 'none', 'image non attrapable (le doigt reste sur la carte)');
  await p.mouse.move(5, 5); await p.waitForTimeout(100);
  assert.equal(await p.$eval('.imgv-card', e => e.classList.contains('tilting')), false, 'pointeur sorti : la carte revient à plat');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  ok('carte en grand : agrandie depuis la vignette, inclinaison foil qui suit le pointeur, revient à plat');

  await p.click('.coll .dv-back'); await p.waitForTimeout(400);
  await p.click('#btnDecks'); await p.waitForSelector('.deck-main .tilt');
  await p.evaluate(() => { const o = tween; window.__tw = []; tween = (el, to) => { window.__tw.push([el.className, el._v == null ? 0 : el._v, to]); return o(el, to); }; });
  await p.click('.deck-main'); await p.waitForSelector('.dv.on .dv-amt');
  await p.waitForFunction(() => !document.querySelector('.dv-amt[data-tw]') && /[1-9]/.test(document.querySelector('.dv-amt').textContent), null, { timeout: 8000 });
  const tw = (await p.evaluate(() => window.__tw)).filter(x => x[0] === 'dv-amt');
  assert.ok(tw.length && tw[0][1] === 0 && tw.some(x => x[2] > 0), 'total : défile depuis 0 jusqu\'à la valeur du deck : ' + JSON.stringify(tw));
  assert.equal(await p.$eval('.dv.on .dv-amt', e => e.textContent), (await p.evaluate(() => fmt(DV.shownTotal))), 'valeur finale exacte');
  await p.waitForFunction(() => document.querySelector('.dv.on .dv-grid'), null, { timeout: 8000 });
  assert.ok((await p.evaluate(() => window.__stg)).some(c => /dv-grid/.test(c)), 'grille du deck : cascade');
  assert.equal(await p.$eval('.dv.on', e => e.classList.contains('scrolled')), false);
  await p.$eval('.dv.on .dv-scroll', e => { e.querySelector('.dv-body').style.paddingBottom = '2000px'; e.scrollTop = 200; e.dispatchEvent(new Event('scroll')); }); await p.waitForTimeout(100);
  assert.equal(await p.$eval('.dv.on', e => e.classList.contains('scrolled')), true, 'en-tête : filet quand le contenu passe dessous');
  await p.click('.dv.on [data-act="hand"]'); await p.waitForSelector('.hand-grid.stg');
  assert.ok((await anims(p, '.hand-grid')).includes('deal'), 'main de départ : cartes distribuées');
  ok('viewer : total qui défile, cascade, en-tête au défilement, cartes distribuées');
}
{
  const { p, errs } = await newPage(browser, world, { init: seed, ctx: { reducedMotion: 'reduce', isMobile: false, hasTouch: false } }); errsOf.push(errs);
  await p.evaluate(() => { const o = stagger; window.__stg = 0; stagger = (...a) => { o(...a); window.__stg += document.querySelectorAll('.stg').length; }; });
  await p.click('#btnColl'); await p.waitForSelector('.coll.on .coll-list'); await p.waitForSelector('.coll-list .crow .thumb img.ok', { timeout: 8000 });
  assert.equal(await p.evaluate(() => window.__stg), 0, 'réduire les animations : pas de cascade');
  await p.click('.coll-list .crow .thumb'); await p.waitForSelector('.imgv.on');
  assert.ok(!(await anims(p, '.imgv-card')).includes('waapi'), 'réduire les animations : pas de FLIP');
  const c = await (await p.$('.imgv-card')).boundingBox();
  await p.mouse.move(c.x + c.width * 0.9, c.y + c.height * 0.1, { steps: 4 }); await p.waitForTimeout(120);
  assert.equal(await p.$eval('.imgv-card', e => e.classList.contains('tilting')), false, 'réduire les animations : carte immobile');
  ok('« réduire les animations » : ni cascade, ni FLIP, ni inclinaison');
}
for (const e of errsOf) assert.deepEqual(e, [], 'erreurs page : ' + e.join(' | '));
await browser.close();
console.log('MOTION E2E OK');
process.exit(0);
