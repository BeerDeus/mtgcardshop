// E2E widget Android (widget.js) : le site confie au plugin ManaOrbit (simulé) la valeur, la variation 7 j et le nombre de cartes de l'orbe de l'accueil,
// une fois les chiffres connus, en différé, seulement quand ils changent ; widget touché (« open ») et ?collection → la collection ; rien sur le web.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, ok, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18974 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const D = 86400000;
// collection : Sol Ring ×2, Craterhoof, Arcane Signet (prix Cardmarket du faux Scryfall : 1,50 · 9,00 · 0,40 → 12,40 €) ;
// relevés : 15,00 € il y a 8 jours, 11,00 € hier (dernier relevé de moins de 20 h : pas de relecture des prix au lancement)
const seed = (o = {}) => `try { const now = Date.now();
  ${o.coll === false ? '' : `localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '2 Sol Ring\\n1 Craterhoof Behemoth\\n1 Arcane Signet', u: 1, s: '', b: null }));
  localStorage.setItem('deckdeal:coll:hist', JSON.stringify([{ t: now - 8 * ${D}, v: 1500, n: 3, q: 4 }, { t: now - 3600e3, v: 1100, n: 3, q: 4 }]));
  localStorage.setItem('deckdeal:coll:pxat', String(now - 3600e3));`}
  ${o.lang ? `localStorage.setItem('deckdeal:lang', '${o.lang}');` : ''} } catch (e) {}`;
// coque Android simulée : setWidget et les écouteurs sont notés dans window.__mo ; native: false → navigateur (Capacitor présent mais pas natif)
const shell = (native = true) => `window.__mo = { calls: [], ls: {} };
  window.Capacitor = { isNativePlatform: () => ${native}, isPluginAvailable: n => n === 'ManaOrbit', Plugins: { ManaOrbit: {
    setWidget: async o => { window.__mo.calls.push(o); return {}; },
    info: async () => ({ firebase: true, version: '1.0', build: 1 }),
    addListener: (ev, cb) => { window.__mo.ls[ev] = cb; return { remove: async () => {} }; } } } };`;
const calls = p => p.evaluate(() => window.__mo.calls.map(c => JSON.parse(c.data)));
const errsAll = [];

/* ── 1) appli Android : premier envoi une fois les chiffres connus, puis seulement s'ils changent ───────────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed() + shell() }); errsAll.push(errs);
  assert.equal((await calls(p)).length, 0, 'envoi différé : rien dans la première seconde');
  await p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 });
  let c = await calls(p);
  assert.equal(c.length, 1);
  const { at, ...rest } = c[0];
  assert.deepEqual(rest, { v: 1100, d: -400, n: 3, lang: 'fr', cur: 'EUR' }, 'valeur = dernier relevé (prix pas encore lus), variation 7 j = 11,00 − 15,00 €, 3 cartes');
  assert.ok(Math.abs(at - Date.now()) < 60000, 'date de l\'envoi');
  assert.deepEqual(Object.keys(c[0]), ['v', 'd', 'n', 'at', 'lang', 'cur']);
  assert.equal(await p.$eval('#hmValue', e => e.textContent.replace(/\s/g, ' ')), '11 €', 'mêmes chiffres que l\'orbe');
  ok('appli Android : setWidget({ v: 1100, d: −400, n: 3, lang: fr, cur: EUR }) une fois la valeur connue (différé)');

  await p.evaluate(() => { homeSoon(0); showView('input'); showView('home'); paintCollSection(); }); await p.waitForTimeout(2200);
  await p.evaluate(() => homeSoon(0)); await p.waitForTimeout(2000);
  assert.equal((await calls(p)).length, 1, 'repeints sans changement : aucun nouvel envoi');
  ok('accueil repeint plusieurs fois sans changement : aucun nouvel envoi');

  // la collection s'ouvre → lecture des cartes (faux Scryfall) → valeur réelle 12,40 € : nouvel envoi, la variation reste celle des relevés
  await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
  await p.waitForFunction(() => window.__mo.calls.length >= 2, null, { timeout: 10000 }); await p.waitForTimeout(2000);
  c = await calls(p);
  assert.equal(c.length, 2, 'un seul envoi pour toute la lecture : ' + JSON.stringify(c));
  assert.deepEqual({ ...c[1], at: 0 }, { v: 2 * 150 + 900 + 40, d: -400, n: 3, at: 0, lang: 'fr', cur: 'EUR' });
  ok('valeur qui change (prix lus : 12,40 €) : un nouvel envoi, un seul');

  // une carte de plus : n change
  await p.evaluate(() => { COLL.meta['wrath of god'] = { ...COLL.meta['sol ring'], eu: 150 }; collBump('wrath of god', 'Wrath of God', 1); });
  await p.waitForFunction(() => window.__mo.calls.length >= 3, null, { timeout: 6000 });
  c = await calls(p); assert.equal(c[2].n, 4); assert.equal(c[2].v, 1240 + 150);
  ok('carte ajoutée : nouvel envoi (4 cartes, 13,90 €)');

  // widget touché : la coque envoie « open » → la collection s'ouvre
  await p.click('.coll .dv-back'); await p.waitForFunction(() => !COLL.el);
  assert.equal(await p.evaluate(() => typeof window.__mo.ls.open), 'function', 'écouteur « open » posé');
  await p.evaluate(() => window.__mo.ls.open({ view: 'other' })); await p.waitForTimeout(800); assert.equal(await p.evaluate(() => !!COLL.el), false, 'autre cible : rien');
  await p.evaluate(() => window.__mo.ls.open({ view: 'collection' })); await p.waitForSelector('.coll.on', { timeout: 3000 });
  ok('widget touché (événement « open ») : la collection s\'ouvre');
  await p.click('.coll .dv-back'); await p.waitForTimeout(300);

  // appli mise en arrière-plan pendant le délai : l'envoi part tout de suite
  await p.evaluate(() => { VAL.hist.push({ t: Date.now(), v: 1390, n: 4, q: 5 }); VAL.hist.splice(1, 1); homeSoon(0); });
  await p.waitForTimeout(400); assert.equal((await calls(p)).length, 3, 'encore dans le délai');
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForFunction(() => window.__mo.calls.length >= 4, null, { timeout: 1000 });
  c = await calls(p); assert.equal(c[3].d, 1390 - 1500, 'nouveau relevé : variation recalculée');
  await p.evaluate(() => { delete document.hidden; });
  ok('appli mise en arrière-plan : envoi immédiat de la nouvelle variation');

  // orbes de l'accueil : crédit de l'artiste (lu avec la fiche Scryfall) au survol de l'illustration
  await p.evaluate(() => { COLL.meta.plains = { im: 'https://cards.scryfall.io/small/front/a/b/plains.jpg', ar: 'John Avon' }; COLL.meta.island = { im: 'https://cards.scryfall.io/small/front/a/b/island.jpg' }; homeLands(); });
  assert.deepEqual(await p.$$eval('.hm-land img', l => l.slice(0, 2).map(i => i.title)), ['Illustration : John Avon', ''], 'artiste inconnu (fiche lue avant) : pas de crédit vide');
  // réglages : ligne de diagnostic de l'APK complétée par ManaOrbit.info() (version, Firebase)
  await p.click('#btnSettings'); await p.waitForFunction(() => /Firebase/.test((document.querySelector('.set-ver') || {}).textContent), null, { timeout: 3000 });
  assert.match(await p.$eval('.set-ver', e => e.textContent), / · APK 1\.0 \(1\) : ✗caméra ✗ML Kit ✗Google ✗pub ✗notif ✓widget ✗retour ✓Firebase$/);
  ok('accueil : « Illustration : John Avon » sur l\'orbe ; réglages : version de l\'APK et ✓Firebase');
  await p.context().close();
}

/* ── 2) anglais ; collection vide ─────────────────────────────────────────────────────────────────────────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed({ lang: 'en' }) + shell() }); errsAll.push(errs);
  await p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 });
  const c = await calls(p); assert.equal(c[0].lang, 'en'); assert.equal(c[0].v, 1100);
  await p.evaluate(() => { COLL.meta.plains = { im: 'https://cards.scryfall.io/small/front/a/b/plains.jpg', ar: 'John Avon' }; homeLands(); });
  assert.equal(await p.$eval('.hm-land[data-c="W"] img', i => i.title), 'Illustration: John Avon');
  await p.context().close();
  // APK dont info() échoue : la ligne de diagnostic reste celle des plugins, sans erreur
  const r = await newPage(browser, world, { init: seed() + shell().replace("info: async () => ({ firebase: true, version: '1.0', build: 1 })", "info: async () => { throw new Error('refusé'); }") }); errsAll.push(r.errs);
  await r.p.click('#btnSettings'); await r.p.waitForSelector('.set-ver'); await r.p.waitForTimeout(400);
  assert.match(await r.p.$eval('.set-ver', e => e.textContent), / · APK : ✗caméra ✗ML Kit ✗Google ✗pub ✗notif ✓widget ✗retour$/);
  await r.p.context().close();
  const e = await newPage(browser, world, { init: seed({ coll: false }) + shell() }); errsAll.push(e.errs);
  await e.p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 });
  const { at, ...rest } = (await calls(e.p))[0]; assert.deepEqual(rest, { v: 0, d: null, n: 0, lang: 'fr', cur: 'EUR' }, 'collection vide : le widget invite à ouvrir l\'appli');
  await e.p.context().close();
  ok('anglais : lang « en », crédit « Illustration: » ; info() refusé : diagnostic inchangé ; collection vide : { v: 0, d: null, n: 0 }');
}

/* ── 3) navigateur : jamais d'envoi ; ?collection ouvre la collection ──────────────────────────────────────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed() + shell(false), path: '?collection' }); errsAll.push(errs);
  await p.waitForSelector('.coll.on', { timeout: 4000 });
  assert.equal(await p.evaluate(() => location.search), '', 'paramètre retiré de l\'adresse');
  await p.waitForTimeout(2500); await p.evaluate(() => homeSoon(0)); await p.waitForTimeout(2000);
  assert.equal((await calls(p)).length, 0, 'web : setWidget jamais appelé'); assert.deepEqual(await p.evaluate(() => Object.keys(window.__mo.ls)), [], 'ni écouteur');
  await p.context().close();
  const w = await newPage(browser, world, { init: seed() }); errsAll.push(w.errs);
  await w.p.waitForTimeout(2500); assert.equal(await w.p.evaluate(() => WGT.sig), '', 'sans Capacitor : rien');
  await w.p.context().close();
  ok('navigateur : jamais d\'envoi ni d\'écouteur ; ?collection ouvre la collection');
}

// ouverture sans geste de l'utilisateur (?collection) : Chrome refuse la vibration de openCollection, sans conséquence
errsAll.forEach((e, i) => assert.deepEqual(e.filter(x => !/navigator\.vibrate/.test(x)), [], 'page ' + i));
await browser.close(); world.stop(); console.log('\nWIDGET E2E OK'); process.exit(0);
