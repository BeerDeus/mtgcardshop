// E2E écran de lancement (splash.js, css/splash.css) : choix du mode (full / short / none), premier rendu avant le gros script (page servie lentement),
// fin au temps minimal une fois prête, boucle d'attente au plafond, plafond absolu, toucher pour passer, lien profond court, réduire les animations,
// rien d'atteignable dessous et focus ensuite, rien sous un navigateur piloté sans ?splash=1, pas de défilement horizontal, thèmes clair et sombre dès la première image.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { routeFonts } from './fonts.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { splashMode, SPLASH_T } = require('../src/splash.js');
const ok = m => console.log('✓', m);

// ── Mode (sans navigateur) ──
{
  const M = (search, o = {}) => splashMode({ search, webdriver: false, hidden: false, nav: 'navigate', ...o });
  assert.equal(M(''), 'full'); assert.equal(M('?lang=en'), 'full'); assert.equal(M('?utm_source=x'), 'full');
  for (const q of ['?p=abc', '?open=scan', '?text=1%20Sol%20Ring', '?url=https%3A%2F%2Fedhrec.com', '?title=x', '?delete-account', '?resume', '?alerts', '?collection']) assert.equal(M(q), 'short', q);
  assert.equal(M('', { nav: 'reload' }), 'short', 'rechargement (« Recharger », langue)'); assert.equal(M('', { nav: 'back_forward' }), 'short');
  assert.equal(M('', { webdriver: true }), 'none', 'tests pilotés'); assert.equal(M('?p=x', { webdriver: true }), 'none');
  assert.equal(M('?splash=1', { webdriver: true }), 'full'); assert.equal(M('?splash=1&open=scan', { webdriver: true }), 'short'); assert.equal(M('?splash=short', { webdriver: true }), 'short');
  assert.equal(M('', { hidden: true }), 'none', 'page ouverte en arrière-plan'); assert.equal(M('?splash=0'), 'none');
  ok('splashMode : complet à froid, court pour les liens profonds et les rechargements, rien sous les tests pilotés ou caché');
}

// Page servie par morceaux : tout jusqu'au script du splash, puis le reste après `slow` ms (réseau lent : le gros script arrive tard).
const HTML = readFileSync('deck-deal.html', 'utf8'), CUT = HTML.indexOf('</script>', HTML.indexOf('id="splash"')) + 9;
assert.ok(CUT > 9 && CUT < 40000 + HTML.indexOf('<body>'), 'script du splash en haut du <body>');
const srv = http.createServer((req, res) => {
  const m = /^\/(?:slow(\d+)\/)?$/.exec(new URL(req.url, 'http://x').pathname); if (!m) { res.writeHead(404); return res.end(); }
  const slow = Number(m[1]) || 0;      // /slow900/?splash=1 : le reste de la page 900 ms plus tard (dans le chemin : un paramètre serait un lien profond)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!slow) return res.end(HTML);
  res.write(HTML.slice(0, CUT)); setTimeout(() => res.end(HTML.slice(CUT)), slow);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const SEED = (theme = 'auto', fresh = false) => `try { ${fresh ? '' : `localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '4 Sol Ring\\n2 Arcane Signet', u: 1, s: '', b: null })); localStorage.setItem('deckdeal:onboard', '1');`}
  localStorage.setItem('deckdeal:v1', JSON.stringify({ theme: '${theme}' })); } catch (e) {}`;
const errs = [];
async function open(q, { theme = 'auto', scheme = 'dark', rm = false, fresh = false, wait = 'commit' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: rm ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage(); await routeFonts(p); await p.addInitScript(SEED(theme, fresh));
  p.on('pageerror', e => errs.push(q + ' pageerror: ' + e.message));
  await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const $ = id => document.getElementById(id), h = document.elementFromPoint(195, 560);      // état sous le splash, une fois la page lue
    window.__dcl = { splash: !!$('splash'), app: $('app').inert, root: $('sheetRoot').inert, hit: !!(h && h.closest('#splash')), sw: document.documentElement.scrollWidth <= innerWidth }; }));
  await p.addInitScript(() => { window.__sp = []; new MutationObserver(() => { const s = document.getElementById('splash'); if (s) window.__sp.push(s.className); }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] }); });
  await p.goto(BASE + q, { waitUntil: wait });
  return { ctx, p };
}
const marks = p => p.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').filter(m => m.name.startsWith('splash:')).map(m => [m.name.slice(7), Math.round(m.startTime)])));
const gone = p => p.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 12000 });
const bg = (p, sel) => p.$eval(sel, e => getComputedStyle(e).backgroundColor);

// ── Ouverture complète, sombre : premier rendu avant le gros script, fin au temps minimal, vol vers l'accueil, horloges reprises ──
{
  const { ctx, p } = await open('slow900/?splash=1');
  await p.waitForSelector('#splash.sp-in', { timeout: 3000 });
  assert.equal(await p.evaluate(() => !!document.getElementById('app')), false, 'splash peint et animé avant que le reste de la page (le gros script) soit arrivé');
  assert.equal(await bg(p, '.sp-bg'), 'rgb(11, 15, 28)', 'fond sombre du thème');
  assert.ok(await p.evaluate(() => document.documentElement.classList.contains('sp-on')));
  await gone(p);
  assert.deepEqual(await p.evaluate(() => window.__dcl), { splash: true, app: true, root: true, hit: true, sw: true }, 'page lue (DOMContentLoaded), splash encore là : appli et feuilles inertes, touchers pris par le splash, aucun défilement horizontal');
  const m = await marks(p), cls = (await p.evaluate(() => window.__sp)).join(' ');
  assert.ok(m.out - m.in >= SPLASH_T.min - 30 && m.out - m.in <= SPLASH_T.cap, 'fin entre le minimum et le plafond : ' + JSON.stringify(m));
  assert.ok(m.end - m.out >= SPLASH_T.out - 30 && m.end - m.out < SPLASH_T.out + 400, 'vol vers l\'accueil : ' + JSON.stringify(m));
  assert.ok(/sp-morph/.test(cls) && !/sp-idle/.test(cls), 'passage à l\'accueil par le vol (pas de boucle d\'attente) : ' + cls);
  const after = await p.evaluate(() => ({ on: document.documentElement.classList.contains('sp-on'), inert: document.getElementById('app').inert, op: Number(getComputedStyle(document.querySelector('.hm-stage')).opacity) > 0.98, focus: document.activeElement === document.body,
    anim: document.getAnimations().filter(a => a.animationName === 'hmSpin' && a.effect.target.classList.contains('hm-orbit'))[0].playState }));
  assert.deepEqual(after, { on: false, inert: false, op: true, focus: true, anim: 'running' }, 'accueil rendu : animations reprises, rien d\'inerte, focus sur la page');
  await p.keyboard.press('Tab'); assert.ok(await p.evaluate(() => document.activeElement.closest('#app')), 'Tab : premier bouton de l\'appli');
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok('ouverture complète : peinte avant le gros script, fin au minimum une fois prête, vol vers l\'accueil, appli inerte dessous puis rendue');
  await ctx.close();
}
// ── Plafond : appli pas prête à 2,5 s → boucle d'attente, fin dès qu'elle l'est ; plafond absolu à 8 s ──
{
  const { ctx, p } = await open('slow3800/?splash=1');
  await p.waitForSelector('#splash.sp-idle', { timeout: 4000 });
  assert.equal(await p.evaluate(() => !!document.getElementById('app')), false, 'boucle d\'attente pendant que la page arrive');
  await gone(p);
  const m = await marks(p); assert.ok(m.out - m.in >= 3000 && m.out - m.in < 5500, 'fin une fois l\'appli prête : ' + JSON.stringify(m));
  ok('plafond : boucle d\'attente calme, fin dès que l\'appli est prête');
  await ctx.close();
}
{
  const { ctx, p } = await open('slow11000/?splash=1');
  await gone(p);
  const m = await marks(p); assert.ok(m.out - m.in >= SPLASH_T.max - 50 && m.out - m.in < SPLASH_T.max + 600, 'plafond absolu : ' + JSON.stringify(m));
  ok('plafond absolu : le splash part à 8 s quoi qu\'il arrive');
  await ctx.close();
}
// ── Toucher pour passer : fondu rapide, le toucher n'atteint pas l'appli ──
{
  const { ctx, p } = await open('?splash=1', { wait: 'domcontentloaded' });
  await p.waitForTimeout(700); assert.ok(await p.$('#splash'));
  await p.mouse.click(195, 560);      // sous le splash : la tuile « Deck à monter »
  await gone(p);
  const m = await marks(p); assert.ok(m.end - m.in < 1400 && m.end - m.out < SPLASH_T.fast + 300, 'toucher : sortie rapide : ' + JSON.stringify(m));
  assert.ok(!(await p.evaluate(() => window.__sp)).join(' ').includes('sp-morph'), 'toucher : simple fondu');
  await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => S.view + (document.querySelector('.dv.on, .sheet-wrap.open') ? ' +écran' : '')), 'home', 'le toucher n\'a rien ouvert dessous');
  ok('toucher : fondu rapide, rien d\'ouvert dessous');
  await ctx.close();
}
// ── Clavier : une touche passe, le focus ne va jamais sous le splash ──
{
  const { ctx, p } = await open('?splash=1', { wait: 'domcontentloaded' });
  await p.waitForTimeout(500); await p.keyboard.press('Tab');
  assert.ok(await p.evaluate(() => !document.activeElement.closest('#app')), 'Tab sous le splash : rien de l\'appli n\'a le focus');
  await gone(p); await p.keyboard.press('Tab');
  assert.ok(await p.evaluate(() => document.activeElement.closest('#app')), 'après : le focus entre dans l\'appli');
  ok('clavier : une touche passe le splash, aucun focus dessous, focus normal après');
  await ctx.close();
}
// ── Lien profond : version courte (~0,6 s), sans vol ; ?p= aussi ──
for (const q of ['?splash=1&open=trade', '?splash=1&p=abc123']) {
  const { ctx, p } = await open(q, { wait: 'domcontentloaded' });
  await gone(p);
  const m = await marks(p), cls = (await p.evaluate(() => window.__sp)).join(' ');
  assert.ok(/sp-short/.test(cls) && !/sp-morph/.test(cls), q + ' : version courte, en fondu (l\'écran demandé, pas l\'accueil)');
  assert.ok(m.out - m.in >= SPLASH_T.short - 30 && m.out - m.in < 1300 && m.end - m.in < 1800, q + ' : ' + JSON.stringify(m));
  await ctx.close();
}
ok('lien profond (?open=, ?p=) : version courte de 0,6 s, puis l\'écran demandé');
// ── Réduire les animations : logo fixe puis fondu de 300 ms ──
{
  const { ctx, p } = await open('?splash=1', { rm: true, wait: 'domcontentloaded' });
  assert.ok(await p.$('#splash.sp-rm'));
  assert.equal(await p.evaluate(() => document.getElementById('splash').getAnimations({ subtree: true }).filter(a => a.playState === 'running' && a.animationName !== 'spSafe').length), 0, 'aucune animation (hors filet de 9 s)');
  assert.equal(await p.$eval('.sp-scene', e => getComputedStyle(e).opacity), '1', 'logo affiché tout de suite');
  await gone(p);
  const m = await marks(p); assert.ok(m.out - m.in >= SPLASH_T.rm - 30 && m.end - m.out >= SPLASH_T.fade - 30 && m.end - m.out < SPLASH_T.fade + 300, JSON.stringify(m));
  assert.ok(!(await p.evaluate(() => window.__sp)).join(' ').includes('sp-morph'), 'pas de vol');
  ok('réduire les animations : logo fixe, fondu de 300 ms');
  await ctx.close();
}
// ── Thème clair (système) et thème forcé dans l'appli, appliqué dès la première image (avant app.js) ──
{
  const { ctx, p } = await open('slow900/?splash=1', { scheme: 'light' });
  await p.waitForSelector('#splash.sp-in'); assert.equal(await bg(p, '.sp-bg'), 'rgb(241, 243, 248)', 'fond clair');
  await ctx.close();
  const o = await open('slow900/?splash=1', { scheme: 'dark', theme: 'light' });
  await o.p.waitForSelector('#splash.sp-in');
  assert.deepEqual(await o.p.evaluate(() => [document.documentElement.dataset.theme, !!document.getElementById('app')]), ['light', false], 'thème choisi appliqué avant le gros script');
  assert.equal(await bg(o.p, '.sp-bg'), 'rgb(241, 243, 248)', 'thème clair forcé sur un système sombre : aucun flash sombre');
  await o.ctx.close();
  ok('thèmes : clair et sombre selon le système, thème choisi dans l\'appli dès la première image');
}
// ── Premier lancement : le splash puis l'accueil (onboarding) ; arrière-plan : retiré tout de suite ──
{
  const { ctx, p } = await open('?splash=1&onboarding', { fresh: true, wait: 'domcontentloaded' });
  await gone(p);
  assert.ok(await p.$('.ob.on'), 'onboarding affiché après le splash');
  assert.ok(!(await p.evaluate(() => window.__sp)).join(' ').includes('sp-morph'), 'accueil couvert par l\'onboarding : fondu, pas de vol');
  assert.ok(await p.evaluate(() => !document.querySelector('.ob').inert), 'onboarding utilisable');
  ok('premier lancement : splash puis onboarding (fondu)');
  await ctx.close();
}
{
  const { ctx, p } = await open('?splash=1', { wait: 'domcontentloaded' });
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.deepEqual(await p.evaluate(() => [!!document.getElementById('splash'), document.getElementById('app').inert, document.documentElement.classList.contains('sp-on')]), [false, false, false], 'arrière-plan : retiré sans animation');
  ok('arrière-plan pendant le splash : retiré, jamais rejoué au retour');
  await ctx.close();
}
// ── Navigateur piloté sans ?splash=1 : aucun splash (les autres e2e restent inchangés) ──
{
  const { ctx, p } = await open('', { wait: 'domcontentloaded' });
  assert.deepEqual(await p.evaluate(() => [!!document.getElementById('splash'), document.documentElement.classList.contains('sp-on'), document.getElementById('app').inert]), [false, false, false]);
  ok('navigateur piloté sans ?splash=1 : aucun splash');
  await ctx.close();
}
assert.deepEqual(errs, [], 'aucune erreur de page');
await browser.close(); srv.close();
console.log('splash-e2e : OK');
