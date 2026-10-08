// E2E catalogue des noms français : fichier du site (fr-names.tsv) ou pages Scryfall, réseau mobile (on demande), reprise, mise à jour, échecs.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toInput, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18940 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const CELL = () => Object.defineProperty(navigator, 'connection', { value: { type: 'cellular', saveData: false }, configurable: true });
const settled = (p, ms = 20000) => p.waitForFunction(() => ['ready', 'ask', 'err'].includes(FRC.state) && !FRC.p, null, { timeout: ms });
async function fresh({ cell = false, staticRows = 0 } = {}) {
  const b = await newPage(browser, world, { goto: false }), { ctx, p } = b; b.sHits = 0;
  await ctx.route('https://cdn.jsdelivr.net/**', r => r.abort());               // pas de moteur OCR ici : seul le catalogue nous intéresse
  if (cell) await ctx.addInitScript(CELL);
  if (staticRows) await ctx.route(world.url + 'fr-names.tsv', r => { b.sHits++; r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: ['# fr-names', 'Anneau solaire\tSol Ring\tfront/fr/sol-ring.jpg', ...Array.from({ length: staticRows }, (_, i) => `Vrombl ${String(i).padStart(4, '0')} Quarnax\tVrombl Card ${i}\tfront/fr/v${i}.jpg`)].join('\n') + '\n' }); });
  await p.goto(world.url); await p.waitForTimeout(600);
  b.open = async () => { await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on'); };
  return b;
}
const hits = () => world.frHits.splice(0);
const catRows = p => p.evaluate(async () => { const c = await scryFrCached(); return c ? c.rows.length : 0; });
const banner = p => p.evaluate(() => { const e = document.querySelector('.sc-cat'); return e && !e.hidden ? { k: e.dataset.k, t: e.textContent.replace(/\s+/g, ' ').trim() } : null; });

/* A) fichier du site : 1 requête, aucune page Scryfall, aucune question même en réseau mobile */
{
  const b = await fresh({ cell: true, staticRows: 800 }), { p } = b; hits(); world.scry.length = 0;
  await b.open(); await settled(p);
  assert.equal(await p.evaluate(() => FRC.state), 'ready'); assert.equal(b.sHits, 1, 'une seule requête'); assert.deepEqual(hits(), [], 'aucune page Scryfall'); assert.equal(await banner(p), null, 'bandeau masqué');
  assert.equal(await catRows(p), 801, 'lignes gardées sur l\'appareil (ligne # ignorée)');
  assert.deepEqual(await p.evaluate(() => { const m = matchFr([{ text: 'Anneau solaire' }], FRC.cat); return [m.name, m.card, m.img]; }), ['Sol Ring', 'fr', 'https://cards.scryfall.io/small/front/fr/sol-ring.jpg']);
  await p.click('.scan [data-act="close"]'); await p.waitForTimeout(400); await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on'); await settled(p);
  assert.equal(b.sHits, 1, 'catalogue frais : pas retéléchargé à la réouverture'); assert.equal(await p.evaluate(() => FRC.state), 'ready');
  assert.deepEqual(b.errs.filter(e => !/WebAssembly|worker|ERR_|Tesseract/i.test(e)), []); await b.ctx.close();
  ok('catalogue : fichier du site = 1 requête (0 page Scryfall), pas de question en réseau mobile, gardé sur l\'appareil');
}

/* B) pas de fichier + réseau mobile : on demande, puis pages Scryfall */
let keep;
{
  world.frPage = 100; const b = await fresh({ cell: true }), { p } = b; hits(); world.scry.length = 0;
  await b.open(); await settled(p);
  assert.equal(await p.evaluate(() => FRC.state), 'ask'); const bn = await banner(p); assert.equal(bn.k, 'idle'); assert.match(bn.t, /15 à 20 Mo.*Télécharger/); assert.deepEqual(hits(), [], 'rien téléchargé sans accord');
  await p.waitForTimeout(700); await p.screenshot({ path: 'shots/scan-1e-catalogue-demande.png' });
  await p.click('.sc-cat [data-act="frc"]'); await settled(p);
  assert.equal(await p.evaluate(() => FRC.state), 'ready'); const h = hits(); assert.deepEqual(h, [1, 2, 3, 4, 5, 6, 7], 'pages Scryfall à la suite : ' + h.join(','));
  assert.equal(await catRows(p), 609, '600 de remplissage + 9 cartes du faux monde'); assert.equal(await banner(p), null);
  assert.equal(await p.evaluate(async () => await Cache.get(FR_PART, 1e12)), null, 'point de reprise effacé une fois terminé');
  ok('catalogue : sans fichier, réseau mobile → question (≈ 15 à 20 Mo), puis 7 pages Scryfall, enregistré');
  keep = b;
}

/* F) mise à jour : catalogue de plus de 14 jours → nouveautés seulement (date>=), un échec garde l'ancien */
{
  const { p } = keep; world.frPage = 0; world.frNew = new Set(['Wrath of God']);
  const stale = old => p.evaluate(async ({ old }) => { const c = await scryFrCached(); const rows = c.rows.filter(r => !/^Colère de Dieu\t/.test(r)); await Cache.set(FR_KEY, { rows, at: Date.now() - old * 86400000 }); return rows.length; }, { old });
  assert.equal(await stale(20), 608, 'Colère de Dieu retirée du catalogue gardé'); world.frFail = true; hits(); world.scry.length = 0;
  await p.reload(); await p.waitForTimeout(500); await keep.open(); await settled(p);
  assert.deepEqual(await p.evaluate(() => [FRC.state, !!FRC.cat, FRC.cat.n]), ['ready', true, 608], 'échec de la mise à jour : ancien catalogue gardé et utilisé');
  assert.equal(await banner(p), null, 'pas de bandeau d\'erreur : le catalogue marche déjà');
  world.frFail = false; hits(); world.scry.length = 0; await p.click('.scan [data-act="close"]'); await p.waitForTimeout(400); await p.reload(); await p.waitForTimeout(500); await keep.open(); await settled(p);
  assert.equal(await p.evaluate(() => [FRC.state, FRC.cat.n]).then(x => x.join()), 'ready,609', 'nouveauté ajoutée');
  assert.ok(world.scry.some(s => /\/cards\/search/.test(s) && /date%3E%3D\d{4}-\d\d-\d\d/.test(s)), 'recherche des nouveautés depuis la dernière mise à jour'); assert.deepEqual(hits(), [1], 'une seule page, pas tout le catalogue');
  assert.equal(await catRows(p), 609); assert.ok(await p.evaluate(async () => Date.now() - (await scryFrCached()).at < 60000), 'date de mise à jour rafraîchie');
  world.frNew = new Set(); await keep.ctx.close();
  ok('catalogue : > 14 jours → nouveautés seulement (date>=), échec de mise à jour = ancien catalogue conservé, sans alerte');
}

/* C) interruption puis reprise au point de sauvegarde (toutes les 8 pages) */
{
  world.frPage = 50; world.frFail = 9; const b = await fresh(), { p } = b; hits(); world.scry.length = 0;
  await b.open(); await settled(p);
  assert.equal(await p.evaluate(() => FRC.state), 'err'); const bn = await banner(p); assert.equal(bn.k, 'err'); assert.match(bn.t, /interrompu.*restent lues.*Réessayer/);
  const h1 = hits(); assert.deepEqual(h1.slice(0, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]); assert.ok(h1.length > 9 && h1.slice(9).every(x => x === 10), 'échec à la page 10 (réessayée puis abandonnée) : ' + h1.join(','));
  const part = await p.evaluate(async () => { const x = await Cache.get(FR_PART, 1e12); return x && { n: x.rows.length, next: /page=(\d+)/.exec(x.next)[1] }; }); assert.deepEqual(part, { n: 400, next: '9' }, 'point de reprise après la page 8');
  await p.waitForTimeout(700); await p.screenshot({ path: 'shots/scan-1f-catalogue-erreur.png' });
  world.frFail = false; await p.click('.sc-cat [data-act="frc"]'); await settled(p);
  assert.equal(await p.evaluate(() => FRC.state), 'ready'); assert.deepEqual(hits(), [9, 10, 11, 12, 13], 'reprise à la page 9, pas depuis le début'); assert.equal(await catRows(p), 609, 'catalogue complet, sans doublon');
  assert.equal(await p.evaluate(async () => await Cache.get(FR_PART, 1e12)), null); assert.equal(await banner(p), null);
  await b.ctx.close(); ok('catalogue : interruption à la page 10 → reprise à la page 9 (point de sauvegarde), catalogue complet sans doublon');
}

/* D) échec total puis catalogue trop court */
{
  world.frPage = 0; world.frFail = true; const b = await fresh(), { p } = b; hits();
  await b.open(); await settled(p); assert.equal(await p.evaluate(() => [FRC.state, !!FRC.cat].join()), 'err,false'); assert.equal((await banner(p)).k, 'err');
  world.frFail = false; world.frFill = 0; await p.click('.sc-cat [data-act="frc"]'); await settled(p);
  assert.equal(await p.evaluate(() => FRC.state), 'err', 'catalogue de 9 noms : refusé (trop court)'); assert.equal(await catRows(p), 0, 'rien d\'enregistré');
  world.frFill = 600; await p.click('.sc-cat [data-act="frc"]'); await settled(p); assert.equal(await p.evaluate(() => FRC.state), 'ready'); assert.equal(await banner(p), null);
  await b.ctx.close(); ok('catalogue : échec total et catalogue trop court signalés (« Réessayer »), rien d\'incomplet n\'est gardé');
}

await browser.close(); world.stop(); console.log('\nFRCAT E2E OK'); process.exit(0);
