// E2E liste en mode démo (75 cartes) : tri, filtres, retrait, animations, mouvement réduit.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const URL = 'file://' + new globalThis.URL('../deck-deal.html', import.meta.url).pathname;
const open = async (opts = {}) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...opts });
  const pg = await c.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(500);
  await pg.click('#btnRun');
  await pg.waitForFunction(() => /terminée/.test(document.querySelector('#progTitle').textContent), null, { timeout: 60000 });
  await pg.waitForTimeout(900);
  return { c, pg, errs };
};
const vis = pg => pg.$$eval('#list .rw:not([hidden])', rs => rs.map(r => ({ name: r.querySelector('.row-name').textContent.trim(), price: (() => { const b = r.querySelector('.row-price b'); return b ? parseFloat(b.textContent.replace(/[^\d,]/g, '').replace(',', '.')) : null; })() })));

{
  const { c, pg, errs } = await open();
  const base = await vis(pg); console.log('cartes :', base.length);
  assert.ok(base.length >= 70);
  // tri par prix décroissant : prix non croissants, lignes sans prix à la fin
  await pg.selectOption('#optSort', 'price-desc');
  assert.ok((await pg.evaluate(() => document.getAnimations().length)) > 0, 'le réordonnancement est animé (FLIP)');
  await pg.waitForTimeout(500);
  let rows = await vis(pg), priced = rows.filter(r => r.price != null);
  assert.ok(priced.length > 50); assert.deepEqual(priced.map(r => r.price), priced.map(r => r.price).sort((a, b) => b - a), 'prix décroissants');
  const firstNull = rows.findIndex(r => r.price == null); assert.ok(firstNull === -1 || rows.slice(firstNull).every(r => r.price == null), 'sans prix à la fin');
  await pg.selectOption('#optSort', 'price-asc'); await pg.waitForTimeout(500);
  rows = await vis(pg); priced = rows.filter(r => r.price != null);
  assert.deepEqual(priced.map(r => r.price), priced.map(r => r.price).sort((a, b) => a - b), 'prix croissants');
  await pg.selectOption('#optSort', 'name'); await pg.waitForTimeout(500);
  rows = await vis(pg); assert.deepEqual(rows.map(r => r.name), rows.map(r => r.name).slice().sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })), 'A → Z');
  assert.equal(rows.length, base.length, 'le tri ne perd aucune carte');
  await pg.screenshot({ path: 'shots/list-1-tri.png' });
  await pg.selectOption('#optSort', 'deck'); await pg.waitForTimeout(500);
  assert.deepEqual((await vis(pg)).map(r => r.name), base.map(r => r.name), 'retour à l\'ordre de la liste');

  // perf : réordonner 75 lignes reste fluide
  const ms = await pg.evaluate(() => { S.sort = 'price-desc'; const t = performance.now(); applyView(true); return performance.now() - t; });
  console.log('applyView (75 lignes) :', ms.toFixed(1), 'ms'); assert.ok(ms < 120, 'applyView lent : ' + ms);
  await pg.selectOption('#optSort', 'deck'); await pg.waitForTimeout(500);

  // filtres : chaque puce affiche exactement son nombre de cartes
  const chips = await pg.$$eval('#fchips .fchip', x => x.map(e => [e.dataset.f, Number(e.querySelector('b').textContent)]));
  console.log('puces :', JSON.stringify(chips));
  for (const [f, n] of chips) { await pg.click(`#fchips [data-f="${f}"]`); await pg.waitForTimeout(450); assert.equal((await vis(pg)).length, n, 'filtre ' + f); }
  await pg.click('#fchips [data-f="all"]'); await pg.waitForTimeout(450);

  // retrait de plusieurs cartes puis « Tout remettre »
  const text0 = await pg.inputValue('#deckText');
  const keys = await pg.$$eval('#list .rw', r => r.slice(0, 6).map(x => x.dataset.key));
  for (const k of keys.slice(0, 3)) { await pg.click(`#list .rw[data-key="${k}"] .rx`); await pg.waitForTimeout(300); }
  assert.equal((await vis(pg)).length, base.length - 3);
  assert.match(await pg.textContent('#undoBar'), /3 cartes retirées/);
  assert.match((await pg.textContent('#heroCount')).trim(), new RegExp('/ ' + (base.length - 3) + ' cartes'));
  await pg.screenshot({ path: 'shots/list-2-retraits.png' });
  await pg.click('#undoAll'); await pg.waitForTimeout(600);
  assert.equal(await pg.inputValue('#deckText'), text0, 'liste identique après « Tout remettre »');
  assert.equal((await vis(pg)).length, base.length);

  // modifier le texte à la main efface l'historique d'annulation (indices périmés)
  await pg.click(`#list .rw[data-key="${keys[0]}"] .rx`); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const t = document.querySelector('#deckText'); t.value += '\n1 Sol Ring'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await pg.$eval('#undoBar', e => e.hidden), true);
  assert.deepEqual(errs, []); await c.close();
}
{ // mouvement réduit : aucune animation de réordonnancement
  const { c, pg, errs } = await open({ reducedMotion: 'reduce' });
  await pg.selectOption('#optSort', 'price-desc');
  assert.equal(await pg.evaluate(() => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#list')).length), 0, 'pas de FLIP en mouvement réduit');
  const rows = await vis(pg); const p = rows.filter(r => r.price != null).map(r => r.price); assert.deepEqual(p, p.slice().sort((a, b) => b - a));
  const k = await pg.$eval('#list .rw', r => r.dataset.key); await pg.click(`#list .rw[data-key="${k}"] .rx`); await pg.waitForTimeout(150);
  assert.equal(await pg.$(`#list .rw[data-key="${k}"]`), null, 'retrait immédiat sans animation');
  assert.deepEqual(errs, []); await c.close();
}
console.log('\nLIST E2E OK');
await browser.close(); process.exit(0);
