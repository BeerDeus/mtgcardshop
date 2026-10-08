// E2E interactions de la passe UI/UX : feuille glissable (swipe pour fermer), sens des transitions de vue, filet de la barre au scroll,
// reflet du total, fondu des onglets de la collection, illustration de collection vide.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, done, toInput, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18940 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const { p, errs } = await newPage(browser, world);

/* feuille : un petit glissé revient, un grand glissé (> 28 % de la hauteur) ferme ; les boutons de l'en-tête ne lancent pas de glissé */
const drag = (sel, dy, dt = 400) => p.evaluate(([sel, dy, dt]) => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect(), x = r.left + 40, y = r.top + 8;
  const ev = (t, yy) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: yy, isPrimary: true }));
  return new Promise(res => { ev('pointerdown', y); const sh = document.querySelector('.sheet'); setTimeout(() => { ev('pointermove', y + dy); const mid = { tr: sh.style.transform, cls: sh.classList.contains('drag'), bd: document.querySelector('.sheet-backdrop').style.opacity }; ev('pointerup', y + dy); res(mid); }, dt); });
}, [sel, dy, dt]);
await p.evaluate(() => openSheet('Essai', 'sous-titre', api => { api.body.innerHTML = '<p style="height:900px">corps</p>'; }));
await p.waitForSelector('.sheet-wrap.open');
const small = await drag('.sheet .grab', 30);
assert.match(small.tr, /translate\(-50%,\s*30px\)/, 'la feuille suit le doigt : ' + small.tr); assert.equal(small.cls, true, 'classe .drag pendant le glissé (pas de transition)');
await p.waitForTimeout(500);
assert.equal(await p.$$eval('.sheet-wrap.open', e => e.length), 1, 'petit glissé : la feuille reste ouverte');
assert.equal(await p.$eval('.sheet', e => e.style.transform), '', 'transform en ligne retiré (retour animé par la CSS)');
assert.equal(await p.$eval('.sheet', e => e.classList.contains('drag')), false);
ok('feuille : suit le doigt, revient après un petit glissé');
const big = await drag('.sheet .sheet-head', 400, 120);
assert.ok(parseFloat(big.bd) < 0.8, 'fond qui s’éclaircit pendant le glissé : ' + big.bd);
await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
assert.equal(await p.$eval('#app', a => a.inert), false, 'page rendue à nouveau active après la fermeture');
ok('feuille : grand glissé (poignée ou en-tête) ferme, fond et inert restaurés');
await p.evaluate(() => openSheet('Essai', '', api => { api.body.innerHTML = 'x'; }));
await p.waitForSelector('.sheet-wrap.open');
await p.evaluate(() => { const b = document.querySelector('.sheet-head .icon-btn'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, pointerType: 'touch', clientY: 10 })); });
assert.equal(await p.$eval('.sheet', e => e.classList.contains('drag')), false, 'pointerdown sur le bouton fermer : pas de glissé');
await p.click('.sheet-head .icon-btn'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
ok('feuille : le bouton fermer reste un bouton');

/* barre : filet seulement quand le contenu passe dessous */
assert.equal(await p.$eval('.bar', b => b.classList.contains('scrolled')), false);
await toInput(p); await p.click('#btnSample'); await p.waitForTimeout(200);
await p.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' })); await p.waitForTimeout(500);
assert.equal(await p.$eval('.bar', b => b.classList.contains('scrolled')), true, 'filet sous la barre après scroll');
await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await p.waitForFunction(() => !document.querySelector('.bar').classList.contains('scrolled'), null, { timeout: 3000 }).catch(() => {});
assert.equal(await p.$eval('.bar', b => b.classList.contains('scrolled')), false, 'filet retiré en haut de page (scrollY ' + await p.evaluate(() => scrollY) + ')');
ok('barre : filet au scroll seulement');

/* transitions de vue : de la droite en avançant, de la gauche en revenant ; reflet sur le total à l'arrivée */
await toInput(p); await p.fill('#deckText', '1 Sol Ring\n1 Swords to Plowshares\n1 Arcane Signet'); await p.waitForTimeout(300);
await toInput(p); await p.click('#btnRun'); await done(p);
assert.equal(await p.$eval('#viewResults', e => e.classList.contains('fwd') && !e.classList.contains('back')), true, 'résultats : classe fwd');
assert.equal(await p.$eval('#hero', e => e.classList.contains('shine')), true, 'reflet sur le total');
await p.click('#btnBack'); await p.waitForTimeout(100);
assert.equal(await p.$eval('#viewInput', e => e.classList.contains('back') && !e.classList.contains('fwd')), true, 'saisie : classe back');
assert.equal(await p.$eval('#viewResults', e => e.hidden), true);
ok('vues : sens des transitions (fwd / back) et reflet du total');

/* collection vide : illustration + fondu des onglets */
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
assert.equal(await p.$$eval('.empty-art i', e => e.length), 3, 'collection vide : trois cartes en éventail'); assert.match(await txt(p, '.dv-empty'), /Ta collection est vide/);
ok('collection vide : illustration');
await p.click('.coll-tools [data-act="import"]'); await p.waitForSelector('#ciText');
await p.fill('#ciText', '1 Sol Ring\n1 Llanowar Elves'); await p.waitForTimeout(150); await p.click('#ciGo');
await p.waitForFunction(() => document.querySelectorAll('.crow').length === 2);
await p.waitForTimeout(500); if (await p.$('.sheet-wrap.open')) { await p.keyboard.press('Escape'); await p.waitForTimeout(500); }
if (!(await p.$('#collSeg'))) { await toHome(p); await p.click('#btnColl'); await p.waitForSelector('#collSeg'); }
await p.click('#collSeg [data-v="stats"]'); await p.waitForSelector('.cs-tiles');
assert.equal(await p.$eval('.coll-main', e => e.classList.contains('tabin')), true, 'onglet : fondu à l’arrivée');
await p.click('#collSeg [data-v="list"]'); await p.waitForSelector('.crow');
assert.equal(await p.$eval('.coll-main', e => e.classList.contains('tabin')), true);
ok('collection : fondu des onglets');

// premier lancement sur un petit écran (ou police système agrandie) : l'écran défile, « Commencer » reste atteignable
{ const S2 = await newPage(browser, world, { ctx: { viewport: { width: 360, height: 520 } } });
  await S2.p.evaluate(() => obOpen()); await S2.p.waitForSelector('.ob.on'); await S2.p.waitForTimeout(400);
  const g = await S2.p.$eval('.ob-s', s => ({ sh: s.scrollHeight, ch: s.clientHeight }));
  assert.ok(g.sh > g.ch, 'contenu plus haut que l\'écran : la première page défile (' + JSON.stringify(g) + ')');
  await S2.p.$eval('.ob-s', s => { s.scrollTop = s.scrollHeight; }); await S2.p.waitForTimeout(200);
  const r = await S2.p.$eval('.ob-s [data-ob="next"]', b => { const x = b.getBoundingClientRect(); return { top: x.top, bottom: x.bottom, vh: innerHeight }; });
  assert.ok(r.top >= 0 && r.bottom <= r.vh, '« Commencer » visible en bas après défilement : ' + JSON.stringify(r));
  await S2.p.click('.ob-s [data-ob="next"]'); await S2.p.waitForTimeout(500);
  assert.deepEqual(S2.errs, []); await S2.ctx.close(); }
ok('premier lancement : défile sur un petit écran, « Commencer » atteignable');

assert.deepEqual(errs, [], 'aucune erreur page : ' + errs.join(' | '));
await browser.close(); world.stop();
console.log('OK');
