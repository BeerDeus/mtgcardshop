// E2E valeur dans le temps : premier relevé, relevé quotidien (un seul par jour), courbe et variations 7 / 30 jours, variations de prix carte par carte
// (seuil 10 / 25 / 50 %), bannière d'alerte (ignorer, mémorisé), pastilles ▲▼ dans la liste, sous-titre de l'accueil, actualisation manuelle, hors ligne.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toInput, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18940 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const { ctx, p, errs } = await newPage(browser, world);
const D = 86400000;
const posts = () => world.scry.filter(x => x.startsWith('POST /cards/collection')).length;
const setEur = (n, v) => { world.prints[n][0].prices.eur = v; };
const tags = () => p.$$eval('.crow:not(.dk)', r => Object.fromEntries(r.map(x => [x.querySelector('.row-name').textContent, [...x.querySelectorAll('.tag.vm')].map(t => t.className.replace(/\s+/g, ' ') + '|' + t.textContent.trim())])));
const alertTxt = () => p.$eval('.coll-alert', e => e.hidden ? '' : e.innerText.replace(/\s+/g, ' ').trim());

/* ── collection : Sol Ring ×2, Swords, Wrath, Craterhoof, Arcane Signet (prix CM 1,50 · 1,90 · 1,50 · 9,00 · 0,40) ─────────────── */
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
await p.click('.coll-tools [data-act="import"]'); await p.waitForSelector('#ciText');
await p.fill('#ciText', '2 Sol Ring\n1 Swords to Plowshares\n1 Wrath of God\n1 Craterhoof Behemoth\n1 Arcane Signet'); await p.waitForTimeout(150); await p.click('#ciGo');
await p.waitForFunction(() => document.querySelectorAll('.crow .px.cm').length >= 5, null, { timeout: 8000 });

/* ── 1) premier relevé : pris sur la lecture complète, sans nouvelle requête ─────────────────── */
await p.waitForFunction(() => VAL.hist.length === 1, null, { timeout: 8000 });
let h = await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:coll:hist')));
assert.equal(h.length, 1); assert.equal(h[0].v, 2 * 150 + 190 + 150 + 900 + 40, 'valeur Cardmarket : Σ prix × exemplaires'); assert.equal(h[0].n, 5); assert.equal(h[0].q, 6);
assert.ok(Number(await p.evaluate(() => localStorage.getItem('deckdeal:coll:pxat'))) > Date.now() - 60000);
const postsAfterImport = posts();
await p.click('#collSeg [data-v="stats"]'); await p.waitForSelector('.vl-box');
assert.match(await txt(p, '.vl-first'), /Premier relevé : 15,80 €\. La courbe apparaît dès demain\./); assert.equal(await p.$$eval('.vl-svg', s => s.length), 0);
assert.match(await txt(p, '#valMv + p'), /Suivi commencé le .* : les variations s'affichent dès qu'un jour a passé\./);
await p.click('#collSeg [data-v="list"]'); assert.equal(await alertTxt(), '', 'pas d\'alerte le premier jour');
ok('premier relevé : 15,80 € (un seul, repris de la lecture des cartes), courbe en attente, aucune alerte');

/* ── 2) pas deux relevés dans les 20 h : aucune requête ───────────────────────────────────────── */
await p.evaluate(() => valRefresh()); await p.waitForTimeout(200); assert.equal(posts(), postsAfterImport, 'moins de 20 h : rien n\'est relu');
ok('moins de 20 h après le relevé : aucune nouvelle lecture');

/* ── 3) 8 jours plus tard : historique et prix de référence anciens, prix du marché qui ont bougé ─────── */
await p.evaluate(({ D }) => {
  const now = Date.now(), p0 = { 'sol ring': 150, 'swords to plowshares': 190, 'wrath of god': 150, 'craterhoof behemoth': 900, 'arcane signet': 40 };
  VAL.hist = [{ t: now - 31 * D, v: 1400, n: 5, q: 6 }, { t: now - 8 * D, v: 1580, n: 5, q: 6 }];
  VAL.base = { cur: { t: now - 8 * D, p: p0 }, prev: null }; VAL.at = now - 21 * 3600e3; VAL.memo = null; COLL.freshAt = 0;
}, { D });
setEur('Sol Ring', '2.25'); setEur('Swords to Plowshares', '1.00'); setEur('Wrath of God', '1.75'); setEur('Craterhoof Behemoth', '9.50');
const before = posts();
await p.evaluate(() => valMaybe()); await p.waitForFunction(() => VAL.hist.length === 3 && !VAL.run, null, { timeout: 8000 });
assert.equal(posts() - before, 1, 'une lecture de toute la collection (5 cartes = 1 requête)');
h = await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:coll:hist'))); assert.equal(h[2].v, 2 * 225 + 100 + 175 + 950 + 40, 'relevé du jour : 1 715');
const bs = await p.evaluate(() => ({ cur: VAL.base.cur.p['sol ring'], prev: VAL.base.prev && VAL.base.prev.p['sol ring'] })); assert.deepEqual(bs, { cur: 225, prev: 150 }, 'la référence a plus de 7 jours : elle devient « précédente »');
ok('relevé quotidien : 1 requête, 3 relevés, prix de référence renouvelés (prev = il y a 8 jours)');

/* ── 4) bannière d'alerte, pastilles, accueil ─────────────────────────────────────────────────── */
await p.waitForFunction(() => /bougé/.test(document.querySelector('.coll-alert').innerText));
assert.match(await alertTxt(), /^2 prix ont bougé de plus de 25 % depuis le .* · ▲ Sol Ring \+50 % · ▼ Swords to Plowshares −47 % Voir Ignorer$/, 'seuil 25 % : Sol Ring +50 %, Swords −47 % ; Wrath +17 % et Craterhoof +6 % sous le seuil');
let t = await tags(); assert.deepEqual(t['Sol Ring'], ['tag vm vu|▲ +50 %']); assert.deepEqual(t['Swords to Plowshares'], ['tag vm vd|▼ −47 %']); assert.deepEqual(t['Wrath of God'], []); assert.deepEqual(t['Craterhoof Behemoth'], []);
assert.match(await p.$eval('.crow[data-k="sol ring"] .tag.vm', e => e.title.replace(/\s/g, ' ')), /Cardmarket : 1,50 € → 2,25 €/);
await p.screenshot({ path: 'shots/val-1-alerte.png' });
ok('alerte : 2 prix ont bougé de plus de 25 % (▲ Sol Ring +50 % · ▼ Swords −47 %), pastilles ▲▼ sur ces cartes seulement');

/* ── 5) Stats : courbe, variations à 7 et 30 jours, variations de prix ───────────────────────── */
await p.click('.coll-alert [data-act="valsee"]'); await p.waitForSelector('.vl-svg');
assert.equal(await alertTxt(), '', 'sur Stats la bannière disparaît'); assert.equal(await p.$eval('#collSeg', s => s._v), 'stats', '« Voir » ouvre l\'onglet Stats');
assert.equal(await p.$$eval('.vl-svg .vl-line', s => s.length), 1);
assert.match(await p.$eval('.vl-svg', s => s.getAttribute('aria-label').replace(/\s/g, ' ')), /de 14,00 € à 17,15 €/);
const labels = await p.$$eval('.vl-svg text', n => n.map(x => x.textContent.replace(/\s/g, ' '))); assert.ok(labels.includes('17,15 €') && labels.includes('14,00 €'), 'axes : maximum et minimum réels de la courbe');
const ds = await p.$$eval('.vl-d', r => r.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
assert.match(ds[0], /^7 JOURS \+1,35 € \+9 % · depuis le /i); assert.match(ds[1], /^30 JOURS \+3,15 € \+23 % · depuis le /i);
assert.match(await txt(p, '.vl-foot span'), /^Dernier relevé : à l'instant$/);
let rows = await p.$$eval('#valMv ~ .vl-top .crow', r => r.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
assert.equal(rows.length, 2); assert.match(rows[0], /^S Sol Ring × 2 ▲ \+50 % \+1,50 € 1,50 € → 2,25 € × 2$/); assert.match(rows[1], /^S Swords to Plowshares ▼ −47 % −0,90 € 1,90 € → 1,00 €$/);
assert.match(await txt(p, '.vl-sum'), /Marché sur ta collection depuis le .* \+1,35 €$/);
await p.screenshot({ path: 'shots/val-2-stats.png', fullPage: false });
ok('Stats : courbe 14,00 → 17,15 €, +1,35 € sur 7 j / +3,15 € sur 30 j, 2 cartes en mouvement classées par lot, total marché +1,35 €');

/* ── 6) seuil : 10 % → Wrath ; 50 % → Sol Ring seul ───────────────────────────────────────────── */
await p.click('[data-act="valthr"][data-v="10"]'); rows = await p.$$eval('#valMv ~ .vl-top .crow .row-name', r => r.map(x => x.textContent)); assert.deepEqual(rows, ['Sol Ring', 'Swords to Plowshares', 'Wrath of God'], '10 % : Wrath +17 % compte ; Craterhoof +6 % non');
await p.click('[data-act="valthr"][data-v="50"]'); rows = await p.$$eval('#valMv ~ .vl-top .crow .row-name', r => r.map(x => x.textContent)); assert.deepEqual(rows, ['Sol Ring'], '50 % : +50 % pile compte, −47 % non');
assert.equal(await p.evaluate(() => localStorage.getItem('deckdeal:coll:alert')), '50');
await p.click('[data-act="valthr"][data-v="25"]'); assert.equal((await p.$$('#valMv ~ .vl-top .crow')).length, 2);
ok('seuil 10 / 25 / 50 % : 3 · 2 · 1 carte(s), choix mémorisé');

/* ── 7) ignorer : mémorisé (même après rechargement), accueil ─────────────────────────────────── */
await p.click('#collSeg [data-v="list"]'); assert.equal(await alertTxt(), '', '« Voir » vaut lecture : la bannière ne revient pas'); await p.evaluate(() => { valSetSeen(-1); collPaintBody(true); });
await p.waitForFunction(() => /bougé/.test(document.querySelector('.coll-alert').innerText));
await p.click('.coll-alert [data-act="valhide"]'); assert.equal(await alertTxt(), '');
await p.waitForTimeout(1200); await p.reload(); await p.waitForTimeout(900);
assert.equal(await p.evaluate(() => VAL.hist.length), 3, 'historique relu après rechargement');
await p.waitForFunction(() => VAL.base && VAL.base.prev, null, { timeout: 5000 });
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on .crow'); await p.waitForTimeout(300);
assert.equal(await alertTxt(), '', 'écartée pour aujourd\'hui, même après rechargement'); assert.doesNotMatch(await txt(p, '#collSub'), /bougé/);
t = await tags(); assert.deepEqual(t['Sol Ring'], ['tag vm vu|▲ +50 %'], 'les pastilles restent');
ok('« Ignorer » : bannière écartée pour la journée, mémorisé après rechargement ; historique et références relus');

/* ── 8) accueil : sous-titre tant que l'alerte n'est pas écartée ──────────────────────────────── */
await p.evaluate(() => { valSetSeen(-1); paintCollSection(); }); assert.match(await txt(p, '#collSub'), /6 exemplaires · 2 prix ont bougé$/); await p.evaluate(() => { valSetSeen(dayOf(VAL.at)); paintCollSection(); });
ok('accueil : « 2 prix ont bougé » tant que l\'alerte est active');

/* ── 9) actualiser à la main ; hors ligne ─────────────────────────────────────────────────────── */
await p.click('#collSeg [data-v="stats"]'); await p.waitForSelector('.vl-box');
const b4 = posts(); await p.click('[data-act="valnow"]'); await p.waitForFunction(() => !VAL.run && document.querySelector('.vl-foot span').textContent.startsWith('Dernier relevé'), null, { timeout: 8000 }); await p.waitForTimeout(150);
assert.equal(posts() - b4, 1, '« Actualiser » relit même si le relevé date de moins de 20 h'); assert.equal(await p.evaluate(() => VAL.hist.length), 3, 'même jour : le relevé est remplacé, pas ajouté');
await ctx.setOffline(true); await p.click('[data-act="valnow"]'); await p.waitForFunction(() => /Hors ligne/.test(document.querySelector('.vl-foot span').textContent)); await ctx.setOffline(false);
ok('« Actualiser » : une lecture, relevé du jour remplacé (3 relevés) ; hors ligne : message clair');

assert.deepEqual(errs, [], 'aucune erreur JS : ' + errs.join(' | '));
await browser.close(); world.stop(); console.log('\nVALUE E2E OK'); process.exit(0);
