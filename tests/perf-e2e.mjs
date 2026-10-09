// Budget de performance, CPU ×4 (≈ téléphone Android moyen) : collection de 5 000 cartes. Aucun port : page en file://, faux Scryfall par routes Playwright.
// Mesures du 9 oct. 2026 (avant → après) : ouverture 1 530 → 375 ms ; « Afficher plus » 1 070 → 85 ms, 1 830 → 130 ms à 1 200 lignes ;
// lecture des infos Scryfall, liste ouverte, 15 premières s : ~790 → ~2 000 cartes lues, tâches longues ~65 % → ~8 % du temps.
// Budgets avec ~3× de marge (CI plus lente) : ils attrapent un retour en arrière grossier (tri sans collator, liste repeinte à chaque lot), pas une variation.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium } from './e2e-world.mjs';

const N = 5000, CPU = 4, URL0 = 'file://' + process.cwd() + '/deck-deal.html';
const A = ['Æther', 'Élan', 'elan', 'Bol', 'Cra', 'Dre', 'Écume', 'Fyr', 'Gor', 'Hal', 'Ith', 'Jun', 'Kor', 'Lum', 'Mor', 'Nex', 'Œil', 'Pyr', 'Qua', 'Rav', 'Sol', 'Tir', 'Umb', 'Vex', 'Wyr', 'Zéphyr'];
const names = Array.from({ length: N }, (_, i) => `${A[i % 26]}${A[(i * 7 + 3) % 26].toLowerCase()} ${i % 97} of ${A[(i * 11) % 26]}${A[(i * 5 + 1) % 26].toLowerCase()} ${i}`);
const LANGS = ['FR', 'EN', 'DE', '', 'FR', 'IT'];
const text = names.map((n, i) => `${1 + (i % 3)} ${n}${LANGS[i % 6] ? ' *' + LANGS[i % 6] + '*' : ''}`).join('\n');
const seed = `try { localStorage.setItem('deckdeal:lang', 'fr'); localStorage.setItem('deckdeal:onboard', '1');
  if (!localStorage.getItem('__perf')) { localStorage.setItem('__perf', '1'); localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: ${JSON.stringify(text)}, u: 1, s: '', b: null })); } } catch (e) {}
  window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}`;
const ok = m => console.log('✓', m);

const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
async function page() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'fr-FR' });
  const errs = [];
  await ctx.route(/^https?:\/\//, route => {      // faux Scryfall : infos de chaque carte demandée ; images factices ; tout le reste coupé
    const r = route.request(), u = new URL(r.url()), h = { 'access-control-allow-origin': '*' };
    if (u.hostname === 'cards.scryfall.io') return route.fulfill({ status: 200, headers: h, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="146" height="204"/>' });
    if (u.hostname !== 'api.scryfall.com') return route.abort();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...h, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
    if (u.pathname === '/cards/collection') {
      const ids = JSON.parse(r.postData() || '{}').identifiers || [];
      return route.fulfill({ status: 200, headers: h, json: { object: 'list', not_found: [], data: ids.map((x, i) => ({ object: 'card', name: x.name, lang: 'en', cmc: i % 7, type_line: i % 4 ? 'Creature — Elf' : 'Instant', mana_cost: '{1}{U}', colors: ['U'], color_identity: ['U'], legalities: { commander: 'legal' }, prices: { eur: (1 + i % 40).toFixed(2) }, image_uris: { small: `https://cards.scryfall.io/small/front/x/${i}.jpg` } })) } });
    }
    return route.fulfill({ status: 404, headers: h, json: { object: 'error', code: 'not_found' } });
  });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(seed); await p.goto(URL0); await p.waitForTimeout(800);
  return { ctx, p, errs, cpu: async () => { const c = await ctx.newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate', { rate: CPU }); } };
}
const timed = (p, src) => p.evaluate(async s => { const t = performance.now(); await (0, eval)(s)(); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); return Math.round(performance.now() - t); }, src);

/* ── 1) ouverture et « Afficher plus », infos des cartes déjà sur l'appareil ───────────────────── */
{
  const { ctx, p, errs, cpu } = await page();
  await p.evaluate(async () => { const meta = {}; let i = 0; for (const k of Object.keys(COLL.map)) { i++; meta[k] = { cm: i % 7, mc: '{1}{U}', tl: i % 4 ? 'Creature — Elf' : 'Instant', cl: 'U', ci: 'U', cd: 0, im: '', eu: 10 + (i * 37) % 4000, ar: 'X' }; } await Cache.set('coll:meta', meta); await new Promise(r => setTimeout(r, 1200)); });
  await p.goto(URL0); await p.waitForTimeout(2500); await cpu();
  const open = await timed(p, '() => openCollection("list")'); await p.waitForTimeout(800);
  const more = []; for (let i = 0; i < 3; i++) { more.push(await timed(p, '() => document.querySelector(".coll-more").click()')); await p.waitForTimeout(100); }
  await p.evaluate(() => { COLL.shown = 1200; collPaintBody(true); }); await p.waitForTimeout(800);
  const more1200 = await timed(p, '() => document.querySelector(".coll-more").click()');
  console.log(JSON.stringify({ open, more, more1200, rows: await p.$$eval('.coll-list .crow', r => r.length) }));
  assert.ok(open < 1200, `ouverture de la collection : ${open} ms (budget 1 200)`);
  assert.ok(Math.max(...more) < 400, `« Afficher plus » : ${more.join(', ')} ms (budget 400)`);
  assert.ok(more1200 < 500, `« Afficher plus » à 1 200 lignes : ${more1200} ms (budget 500)`);
  assert.deepEqual(errs, []); await ctx.close();
  ok('5 000 cartes : ouverture et « Afficher plus » dans le budget');
}

/* ── 2) première lecture des infos Scryfall, liste ouverte ─────────────────────────────────────── */
{
  const { ctx, p, errs, cpu } = await page();
  await cpu();
  await p.evaluate(() => { window.__lt.length = 0; openCollection('list'); });
  await p.waitForTimeout(15000);
  const r = await p.evaluate(() => ({ read: Object.keys(COLL.meta).length, lt: Math.round(window.__lt.reduce((a, b) => a + b, 0)), ltMax: Math.round(Math.max(0, ...window.__lt)) }));
  console.log(JSON.stringify(r));
  assert.ok(r.read >= 1200, `cartes lues en 15 s : ${r.read} (budget ≥ 1 200 ; le rendu ne doit pas freiner la lecture)`);
  assert.ok(r.lt < 4500, `tâches longues pendant la lecture : ${r.lt} ms sur 15 s (budget 4 500)`);
  assert.deepEqual(errs, []); await ctx.close();
  ok('lecture des infos : l\'écran reste fluide et la lecture avance au rythme de Scryfall');
}
await browser.close();
console.log('\nPERF E2E OK'); process.exit(0);
