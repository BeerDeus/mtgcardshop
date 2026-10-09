// E2E langues de l'interface au-delà du français et de l'anglais : téléphone allemand → interface allemande (langue du téléphone, sans choix ;
// navigator.webdriver masqué, sinon les tests restent en français), nombres « 1.234,56 € », pluriel par TN, cartes allemandes, Réglages › Langue
// (chaque langue dans sa langue, aller-retour par le français) ; téléphone espagnol → espagnol (« 1234,56 € ») ; téléphone italien (pas encore livré) → anglais.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18946, env: { CARDTRADER_TOKEN: '' } });      // sans token : prix Cardmarket
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
// vrai téléphone : pas de navigator.webdriver (la langue du téléphone décide) ; accueil du premier lancement déjà vu
const phone = `Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); try { localStorage.setItem('deckdeal:onboard', '1'); } catch (e) {}`;
const errsAll = [];
const open = async locale => { const pg = await newPage(browser, world, { goto: false, ctx: { locale }, init: phone }); errsAll.push(pg.errs); await pg.p.goto(world.url); await pg.p.waitForTimeout(800); return pg; };

/* ── 1) téléphone allemand ─────────────────────────────────────────────────────────────────────── */
const { p } = await open('de-DE');
assert.deepEqual(await p.evaluate(() => [I18N.lang, LOC(), document.documentElement.lang, localStorage.getItem('deckdeal:lang'), navigator.webdriver]), ['de', 'de-DE', 'de', null, false], 'langue du téléphone, rien d\'enregistré');
assert.equal(await p.evaluate(() => typeof I18N_ALL), 'undefined', 'dictionnaire lu depuis son bloc JSON');
await toHome(p);
assert.match(await txt(p, '#btnDecks'), /Meine Decks/); assert.match(await txt(p, '#hmNew'), /Neuer Warenkorb/);
assert.equal(await p.evaluate(() => T('Réglages')), 'Einstellungen');
ok('téléphone de-DE : interface allemande d\'emblée (accueil, textes du code et de la page)');

assert.deepEqual(await p.evaluate(() => [fmt(123456, 'EUR'), hmEur(123456), Number(1234567).toLocaleString(LOC())]), ['1.234,56 €', '1.235 €', '1.234.567'], 'euros et nombres à l\'allemande');
assert.deepEqual(await p.evaluate(() => [0, 1, 2, 1500].map(n => TN(n, '{n} carte', '{n} cartes'))), ['0 Karten', '1 Karte', '2 Karten', '1.500 Karten'], 'pluriel : 1 seul au singulier');
assert.match(await p.evaluate(() => relTime(Date.now() - 3 * 3600e3)), /vor 3 Stunden/);
ok('nombres « 1.234,56 € », pluriel de TN (0 Karten, 1 Karte), dates relatives en allemand');

assert.deepEqual(await p.evaluate(() => [S.opts.lang, userLang(), cmSite(userLang())]), ['de', 'de', 'de'], 'cartes allemandes, Cardmarket allemand');
ok('cartes allemandes par défaut (comme le français aujourd\'hui)');

// recherche au prix Cardmarket : libellés et montant en allemand
await p.evaluate(() => showView('input')); await p.fill('#deckText', '1 Sol Ring\n2 Craterhoof Behemoth'); await p.waitForTimeout(250);
assert.match(await txt(p, '#btnRun'), /Preise ansehen · 2 Karten/);
await p.click('#btnRun'); await p.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 20000 }); await p.waitForTimeout(700);
assert.match(await txt(p, '#heroAmt'), /^19,50\s€$/); assert.match(await txt(p, '#heroLabel'), /Cardmarket-Preis, ab/);
ok('recherche Cardmarket : « 19,50 € », libellés allemands');

// Réglages › Langue : les langues livrées, chacune dans sa langue ; aller-retour par le français
await p.click('#btnSettings'); await p.waitForSelector('#setLang'); await p.waitForSelector('.sheet-wrap.open .sheet-head');
assert.match(await txt(p, '.sheet-wrap.open .sheet-head'), /Einstellungen/);
const langs = await p.$$eval('#setLang option', o => o.map(x => [x.value, x.textContent]));
assert.deepEqual(langs, await p.evaluate(() => i18nLangs()), 'la liste des langues livrées');
assert.deepEqual(langs.slice(0, 3), [['fr', 'Français'], ['en', 'English'], ['de', 'Deutsch']]);
assert.ok(!langs.some(([c]) => c === 'it' || c === 'pt') || await p.evaluate(() => !!document.getElementById('i18n-it')), 'italien, portugais : seulement avec leur dictionnaire');
assert.equal(await p.$eval('#setLang', s => s.value), 'de');
await Promise.all([p.waitForEvent('load'), p.selectOption('#setLang', 'fr')]); await p.waitForTimeout(700);
assert.deepEqual(await p.evaluate(() => [I18N.lang, localStorage.getItem('deckdeal:lang'), I18N.dict]), ['fr', 'fr', null]); await toHome(p); assert.match(await txt(p, '#btnDecks'), /Mes decks/);
assert.equal(await p.evaluate(() => fmt(123456, 'EUR')), '1 234,56 €', 'français : inchangé');
await p.click('#btnSettings'); await p.waitForSelector('#setLang'); await p.waitForSelector('.sheet-wrap.open .sheet-head');
await Promise.all([p.waitForEvent('load'), p.selectOption('#setLang', 'de')]); await p.waitForTimeout(700);
assert.equal(await p.evaluate(() => I18N.lang), 'de'); await toHome(p); assert.match(await txt(p, '#btnDecks'), /Meine Decks/);
ok('Réglages › Langue : « Deutsch » (chaque langue dans sa langue), passage au français puis retour à l\'allemand');

/* ── 2) téléphone espagnol, téléphone italien ──────────────────────────────────────────────────── */
const es = (await open('es-ES')).p;
if (await es.evaluate(() => !!document.getElementById('i18n-es'))) {
  assert.deepEqual(await es.evaluate(() => [I18N.lang, LOC(), S.opts.lang, fmt(123456, 'EUR'), TN(1, '{n} carte', '{n} cartes'), TN(3, '{n} carte', '{n} cartes')]), ['es', 'es-ES', 'es', '1234,56 €', '1 carta', '3 cartas']);
  await toHome(es); assert.match(await txt(es, '#btnDecks'), /Mis mazos/);
  ok('téléphone es-ES : interface espagnole, « 1234,56 € », cartes espagnoles');
} else console.log('  (espagnol pas encore livré : vérification sautée)');
const it = (await open('it-IT')).p;
assert.deepEqual(await it.evaluate(() => [I18N.lang, S.opts.lang, i18nHas('it')]), [await it.evaluate(() => i18nHas('it') ? 'it' : 'en'), 'it', await it.evaluate(() => !!document.getElementById('i18n-it'))]);
ok('téléphone it-IT : italien seulement s\'il est livré (sinon anglais), cartes italiennes dans les deux cas');

assert.deepEqual(errsAll.flat(), []);
await browser.close(); world.stop();
console.log('\nDE E2E OK'); process.exit(0);
