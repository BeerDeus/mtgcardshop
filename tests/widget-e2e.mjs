// E2E widget Android (widget.js) : le site confie au plugin ManaOrbit (simulé) la valeur, la variation (et sa durée), le nombre de cartes, les relevés
// des 30 derniers jours et le bouton choisi, une fois les chiffres connus, en différé, seulement quand ils changent ; avec une coque récente et un widget
// posé, la liste compacte des cartes et leurs prix du fichier de prix (estimation appli fermée) ; Réglages › Widget change le bouton ;
// widget touché (« open ») → collection, scan ou prix rapide ; ?collection → la collection ; rien sur le web.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, ok, toHome, txt } from './e2e-world.mjs';

const world = await startWorld({ port: 18974 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const D = 86400000;
// collection : Sol Ring ×2, Craterhoof, Arcane Signet (prix Cardmarket du faux Scryfall : 1,50 · 9,00 · 0,40 → 12,40 €) ;
// relevés : 15,00 € il y a 8 jours, 11,00 € hier (dernier relevé de moins de 20 h : pas de relecture des prix au lancement), même collection (3 cartes, 4 exemplaires)
const seed = (o = {}) => `try { const now = Date.now();
  ${o.coll === false ? '' : `localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '2 Sol Ring\\n1 Craterhoof Behemoth\\n1 Arcane Signet', u: 1, s: '', b: null }));
  localStorage.setItem('deckdeal:coll:hist', JSON.stringify(${o.hist || `[{ t: now - 8 * ${D}, v: 1500, n: 3, q: 4 }, { t: now - 3600e3, v: 1100, n: 3, q: 4 }]`}));
  localStorage.setItem('deckdeal:coll:pxat', String(now - 3600e3));`}
  ${o.lang ? `localStorage.setItem('deckdeal:lang', '${o.lang}');` : ''}
  ${o.btn ? `localStorage.setItem('deckdeal:widget:btn', '${o.btn}');` : ''} } catch (e) {}`;
// coque Android simulée : setWidget et les écouteurs sont notés dans window.__mo ; native: false → navigateur (Capacitor présent mais pas natif) ;
// info : réponse de ManaOrbit.info() (une coque récente ajoute widgets et widgetRefresh)
const shell = (native = true, info = '{ firebase: true, version: \'1.0\', build: 1 }') => `window.__mo = { calls: [], ls: {} };
  window.Capacitor = { isNativePlatform: () => ${native}, isPluginAvailable: n => n === 'ManaOrbit', Plugins: { ManaOrbit: {
    setWidget: async o => { window.__mo.calls.push(o); return {}; },
    info: async () => (${info}),
    addListener: (ev, cb) => { window.__mo.ls[ev] = cb; return { remove: async () => {} }; } } } };`;
const calls = p => p.evaluate(() => window.__mo.calls.map(c => JSON.parse(c.data)));
const raw = p => p.evaluate(() => window.__mo.calls);
const KEYS = ['v', 'd', 'dd', 'n', 'at', 'h', 'b', 'lang', 'cur'];
const errsAll = [];

/* ── 1) appli Android : premier envoi une fois les chiffres connus, puis seulement s'ils changent ───────────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed() + shell() }); errsAll.push(errs);
  assert.equal((await calls(p)).length, 0, 'envoi différé : rien dans la première seconde');
  await p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 });
  let c = await calls(p);
  assert.equal(c.length, 1);
  const { at, h, ...rest } = c[0];
  assert.deepEqual(rest, { v: 1100, d: -400, dd: 7, n: 3, b: 'scan', lang: 'fr', cur: 'EUR' }, 'valeur = dernier relevé (prix pas encore lus), variation 7 j = 11,00 − 15,00 € (collection inchangée : prix seuls), 3 cartes, bouton Scanner');
  assert.deepEqual(h.map(x => x[1]), [1500, 1100], 'relevés de la courbe : [date, centimes]');
  assert.ok(h[1][0] - h[0][0] > 7 * D && h.every(x => Number.isInteger(x[0])), 'dates des relevés');
  assert.ok(Math.abs(at - Date.now()) < 60000, 'date de l\'envoi');
  assert.deepEqual(Object.keys(c[0]), KEYS);
  assert.equal((await raw(p))[0].coll, undefined, 'coque sans widgetRefresh : pas de liste de cartes');
  assert.equal(await p.$eval('#hmValue', e => e.textContent.replace(/\s/g, ' ')), '11 €', 'mêmes chiffres que l\'orbe');
  ok('appli Android : setWidget({ v: 1100, d: −400, dd: 7, n: 3, h: 2 relevés, b: scan }) une fois la valeur connue (différé)');

  await p.evaluate(() => { homeSoon(0); showView('input'); showView('home'); paintCollSection(); }); await p.waitForTimeout(2200);
  await p.evaluate(() => homeSoon(0)); await p.waitForTimeout(2000);
  assert.equal((await calls(p)).length, 1, 'repeints sans changement : aucun nouvel envoi');
  ok('accueil repeint plusieurs fois sans changement : aucun nouvel envoi');

  // la collection s'ouvre → lecture des cartes (faux Scryfall) → valeur réelle 12,40 € : nouvel envoi, la variation reste celle des relevés
  await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
  await p.waitForFunction(() => window.__mo.calls.length >= 2, null, { timeout: 10000 }); await p.waitForTimeout(2000);
  c = await calls(p);
  assert.equal(c.length, 2, 'un seul envoi pour toute la lecture : ' + JSON.stringify(c));
  assert.deepEqual({ ...c[1], at: 0, h: 0 }, { v: 2 * 150 + 900 + 40, d: -400, dd: 7, n: 3, at: 0, h: 0, b: 'scan', lang: 'fr', cur: 'EUR' });
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
  await p.evaluate(() => window.__mo.ls.open({ view: 'toString' })); await p.waitForTimeout(800); assert.equal(await p.evaluate(() => !!COLL.el || !!SC.el), false, 'nom hérité d\'Object : rien');
  await p.evaluate(() => window.__mo.ls.open({ view: 'collection' })); await p.waitForSelector('.coll.on', { timeout: 3000 });
  ok('widget touché (événement « open ») : la collection s\'ouvre');
  await p.click('.coll .dv-back'); await p.waitForTimeout(300);

  // appli mise en arrière-plan pendant le délai : l'envoi part tout de suite ; relevé d'une collection qui a changé (4 cartes) sans référence de prix : variation des relevés
  await p.evaluate(() => { VAL.hist.push({ t: Date.now(), v: 1390, n: 4, q: 5 }); VAL.hist.splice(1, 1); homeSoon(0); });
  await p.waitForTimeout(400); assert.equal((await calls(p)).length, 3, 'encore dans le délai');
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForFunction(() => window.__mo.calls.length >= 4, null, { timeout: 1000 });
  c = await calls(p); assert.equal(c[3].d, 1390 - 1500, 'nouveau relevé : variation recalculée'); assert.equal(c[3].dd, 7);
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
  // Réglages › Widget en anglais
  await p.click('#btnSettings'); await p.waitForSelector('#segWidgetBtn .seg-opt');
  assert.equal(await txt(p, '#widgetBox .sec-title'), 'Widget');
  assert.deepEqual(await p.$$eval('#segWidgetBtn .seg-opt', l => l.map(b => b.innerText.replace(/\s+/g, ' ').trim())), ['Scan add cards', 'Quick price without adding them']);
  await p.context().close();
  // APK dont info() échoue : la ligne de diagnostic reste celle des plugins, sans erreur
  const r = await newPage(browser, world, { init: seed() + shell().replace("info: async () => ({ firebase: true, version: '1.0', build: 1 })", "info: async () => { throw new Error('refusé'); }") }); errsAll.push(r.errs);
  await r.p.click('#btnSettings'); await r.p.waitForSelector('.set-ver'); await r.p.waitForTimeout(400);
  assert.match(await r.p.$eval('.set-ver', e => e.textContent), / · APK : ✗caméra ✗ML Kit ✗Google ✗pub ✗notif ✓widget ✗retour$/);
  await r.p.context().close();
  const e = await newPage(browser, world, { init: seed({ coll: false }) + shell() }); errsAll.push(e.errs);
  await e.p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 });
  const { at, ...rest } = (await calls(e.p))[0]; assert.deepEqual(rest, { v: 0, d: null, dd: 7, n: 0, h: [], b: 'scan', lang: 'fr', cur: 'EUR' }, 'collection vide : le widget invite à ouvrir l\'appli');
  await e.p.context().close();
  ok('anglais : lang « en », crédit « Illustration: », Réglages › Widget « Scan / Quick price » ; info() refusé : diagnostic inchangé ; collection vide : { v: 0, d: null, n: 0, h: [] }');
}

/* ── 3) navigateur : jamais d'envoi ; ?collection ouvre la collection ──────────────────────────────────────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed() + shell(false), path: '?collection' }); errsAll.push(errs);
  await p.waitForSelector('.coll.on', { timeout: 4000 });
  assert.equal(await p.evaluate(() => location.search), '', 'paramètre retiré de l\'adresse');
  await p.waitForTimeout(2500); await p.evaluate(() => homeSoon(0)); await p.waitForTimeout(2000);
  assert.equal((await calls(p)).length, 0, 'web : setWidget jamais appelé'); assert.deepEqual(await p.evaluate(() => Object.keys(window.__mo.ls)), [], 'ni écouteur');
  await p.evaluate(() => openSettings()); await p.waitForSelector('.set-ver');
  assert.equal(await p.$('#widgetBox'), null, 'web : pas de rubrique Widget dans les réglages');
  await p.context().close();
  const w = await newPage(browser, world, { init: seed() }); errsAll.push(w.errs);
  await w.p.waitForTimeout(2500); assert.equal(await w.p.evaluate(() => WGT.sig), '', 'sans Capacitor : rien');
  await w.p.context().close();
  ok('navigateur : jamais d\'envoi, d\'écouteur ni de rubrique Widget ; ?collection ouvre la collection');
}

/* ── 4) Réglages › Widget : bouton Scanner / Prix rapide ; boutons du widget → scan et prix rapide ───────────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed() + shell() }); errsAll.push(errs);
  await p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 });
  await p.click('#btnSettings'); await p.waitForSelector('#segWidgetBtn .seg-opt');
  assert.equal(await txt(p, '#widgetBox .sec-title'), 'Widget');
  assert.deepEqual(await p.$$eval('#segWidgetBtn .seg-opt', l => l.map(b => [b.dataset.v, b.getAttribute('aria-checked'), b.innerText.replace(/\s+/g, ' ').trim()])),
    [['scan', 'true', 'Scanner ajouter des cartes'], ['quick', 'false', 'Prix rapide sans les ajouter']]);
  assert.equal(await p.$eval('#widgetBgHint', e => e.hidden), true, 'coque sans estimation appli fermée : pas de mention');
  await p.click('#segWidgetBtn [data-v="quick"]');
  await p.waitForFunction(() => window.__mo.calls.length >= 2, null, { timeout: 3000 });
  let c = await calls(p); assert.equal(c[1].b, 'quick', 'choix envoyé aussitôt à la coque'); assert.equal(c[1].v, c[0].v);
  assert.equal(await p.evaluate(() => localStorage.getItem('deckdeal:widget:btn')), 'quick', 'gardé sur l\'appareil');
  await p.click('#segWidgetBtn [data-v="quick"]'); await p.waitForTimeout(600); assert.equal((await calls(p)).length, 2, 'même choix : rien de plus');
  await p.click('#segWidgetBtn [data-v="scan"]'); await p.waitForFunction(() => window.__mo.calls.length >= 3, null, { timeout: 3000 });
  c = await calls(p); assert.equal(c[2].b, 'scan');
  await p.click('#segWidgetBtn [data-v="quick"]'); await p.waitForFunction(() => window.__mo.calls.length >= 4, null, { timeout: 3000 });
  await p.evaluate(() => { while (sheets.length) sheets[sheets.length - 1].close(); }); await p.waitForTimeout(400);
  ok('Réglages › Widget : Scanner / Prix rapide, envoyé aussitôt (b: quick ↔ scan), gardé sur l\'appareil');

  // bouton du widget : « scan » → écran de scan (ajout) ; « quick » → scan en prix rapide ; scan déjà ouvert : seulement le mode change
  await p.evaluate(() => window.__mo.ls.open({ view: 'scan' })); await p.waitForSelector('.scan.on', { timeout: 3000 });
  assert.deepEqual(await p.evaluate(() => [SC.pm, document.querySelector('.scan').classList.contains('pm')]), [false, false], 'scan : mode ajout');
  await p.evaluate(() => { window.__scEl = SC.el; window.__mo.ls.open({ view: 'quick' }); }); await p.waitForFunction(() => SC.pm === true, null, { timeout: 3000 });
  assert.equal(await p.evaluate(() => SC.el === window.__scEl), true, 'scan déjà ouvert : passe en prix rapide sans rouvrir (cartes lues gardées)');
  await p.evaluate(() => window.__mo.ls.open({ view: 'scan' })); await p.waitForFunction(() => SC.pm === false, null, { timeout: 3000 });
  assert.equal(await p.evaluate(() => SC.el === window.__scEl), true, 'puis retour au mode ajout, même écran');
  await p.click('.scan [data-act="close"]'); await p.waitForFunction(() => !SC.el);
  await p.evaluate(() => window.__mo.ls.open({ view: 'quick' })); await p.waitForSelector('.scan.on', { timeout: 3000 });
  assert.deepEqual(await p.evaluate(() => [SC.pm, document.querySelector('.scan').classList.contains('pm'), document.querySelector('.sc-pmode').getAttribute('aria-pressed')]), [true, true, 'true'], 'prix rapide : scan ouvert en mode prix');
  await p.click('.scan [data-act="close"]'); await p.waitForFunction(() => !SC.el);
  await p.context().close();
  // choix gardé : relu au lancement suivant (premier envoi déjà en « quick »), réglage coché
  const q = await newPage(browser, world, { init: seed({ btn: 'quick' }) + shell() }); errsAll.push(q.errs);
  await q.p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 });
  assert.equal((await calls(q.p))[0].b, 'quick');
  await q.p.click('#btnSettings'); await q.p.waitForSelector('#segWidgetBtn .seg-opt');
  assert.equal(await q.p.$eval('#segWidgetBtn [data-v="quick"]', b => b.getAttribute('aria-checked')), 'true');
  await q.p.context().close();
  ok('bouton du widget : « scan » → scan, « quick » → prix rapide (mode changé sans rouvrir si déjà ouvert) ; choix relu au lancement suivant');
}

/* ── 5) coque récente avec un widget posé : liste compacte des cartes et prix du fichier de prix (estimation appli fermée) ─ */
{
  const PX = '#MOPX1 2026-10-08T09:05:44Z 5\nArcane Signet\t30\t40\nCraterhoof Behemoth\t800\t950\nFire // Ice\t25\t30\nSol Ring\t130\t100\nSol Ring\t120\t\n';
  const recent = '{ firebase: true, version: \'1.1\', build: 2, widgets: 1, widgetRefresh: true }';
  const { p, errs } = await newPage(browser, world, { goto: false }); errsAll.push(errs);
  let pxHits = 0; await p.route('**/prices.tsv', r => { pxHits++; return r.fulfill({ status: 200, contentType: 'text/tab-separated-values', body: PX }); });
  await p.addInitScript(seed() + shell(true, recent)); await p.goto(world.url);
  await p.waitForFunction(() => window.__mo.calls.some(c => c.coll), null, { timeout: 8000 });
  const all = await raw(p), w = all.find(c => c.coll), coll = JSON.parse(w.coll);
  assert.deepEqual(coll, { pa: '2026-10-08T09:05:44Z', c: [['craterhoof behemoth', 1, 800], ['sol ring', 2, 120], ['arcane signet', 1, 30]] },
    'coll : [clé, exemplaires, prix du fichier (le plus bas des impressions)], plus grosses valeurs d\'abord, date du fichier');
  const d = JSON.parse(w.data); assert.deepEqual([d.v, d.d, d.dd, d.n, d.b], [1100, -400, 7, 3, 'scan'], 'mêmes chiffres que sans estimation');
  assert.equal(pxHits, 1, 'fichier de prix lu une fois');
  assert.ok(w.coll.length < 200, 'compact : ' + w.coll.length + ' caractères pour 3 cartes');
  const n = all.length; await p.evaluate(() => homeSoon(0)); await p.waitForTimeout(2200);
  assert.equal((await raw(p)).length, n, 'rien de changé : aucun nouvel envoi');
  ok('coque récente + widget posé : coll { pa, c: [[clé, q, prix du fichier]] } triée par valeur, envoyée avec les chiffres');
  // Réglages : mention de l'estimation appli fermée
  await p.click('#btnSettings'); await p.waitForSelector('#segWidgetBtn .seg-opt');
  assert.match(await txt(p, '#widgetBgHint'), /Appli fermée, le widget estime la valeur/);
  await p.context().close();

  // coque récente sans widget posé : ni fichier de prix téléchargé, ni liste
  const z = await newPage(browser, world, { goto: false }); errsAll.push(z.errs);
  let zHits = 0; await z.p.route('**/prices.tsv', r => { zHits++; return r.fulfill({ status: 200, contentType: 'text/tab-separated-values', body: PX }); });
  await z.p.addInitScript(seed() + shell(true, recent.replace('widgets: 1', 'widgets: 0'))); await z.p.goto(world.url);
  await z.p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 }); await z.p.waitForTimeout(1500);
  assert.equal(zHits, 0, 'aucun widget posé : fichier de prix pas demandé'); assert.ok((await raw(z.p)).every(c => !c.coll));
  // widget posé pendant que l'appli est en arrière-plan : au retour, la coque le signale et la liste part
  await z.p.evaluate(() => { window.Capacitor.Plugins.ManaOrbit.info = async () => ({ firebase: true, widgets: 1, widgetRefresh: true }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await z.p.waitForFunction(() => window.__mo.calls.some(c => c.coll), null, { timeout: 8000 });
  assert.equal(zHits, 1);
  await z.p.context().close();
  ok('coque récente sans widget : pas de téléchargement ; widget posé puis retour sur l\'appli : la liste part');
}

/* ── 6) variation du marché seul quand la collection a changé ; relevés limités aux 30 derniers jours ─────────────────── */
{
  // relevés : il y a 40 j (hors fenêtre), il y a 8 j avec 2 cartes, hier avec 3 : la variation des relevés (−4 €) compterait l'ajout d'une carte
  const hist = `[{ t: now - 40 * ${D}, v: 900, n: 2, q: 3 }, { t: now - 8 * ${D}, v: 1500, n: 2, q: 3 }, { t: now - 3600e3, v: 1100, n: 3, q: 4 }]`;
  const { p, errs } = await newPage(browser, world, { init: seed({ hist }) + shell() }); errsAll.push(errs);
  await p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 });
  let c = await calls(p);
  assert.deepEqual(c[0].h.map(x => x[1]), [1500, 1100], 'courbe : relevés des 30 derniers jours seulement');
  assert.deepEqual([c[0].d, c[0].dd], [-400, 7], 'sans prix de référence : variation des relevés, faute de mieux');
  // prix de référence d'il y a 9 jours (VAL.base, comme après un relevé) : 1,00 · 7,00 · 0,40 € ; prix du jour 1,50 · 9,00 · 0,40 € → marché +1,00 × 2 + 2,00 = +3,00 €
  await p.evaluate(() => {
    COLL.meta['sol ring'] = { ...(COLL.meta['sol ring'] || {}), eu: 150 }; COLL.meta['craterhoof behemoth'] = { ...(COLL.meta['craterhoof behemoth'] || {}), eu: 900 }; COLL.meta['arcane signet'] = { ...(COLL.meta['arcane signet'] || {}), eu: 40 };
    VAL.base = { cur: { t: Date.now() - 9 * 86400000, p: { 'sol ring': 100, 'craterhoof behemoth': 700, 'arcane signet': 40 } }, prev: null }; VAL.memo = null; homeSoon(0);
  });
  await p.waitForFunction(() => window.__mo.calls.length >= 2, null, { timeout: 6000 });
  c = await calls(p);
  assert.deepEqual([c[1].v, c[1].d, c[1].dd], [1240, 300, 9], 'variation du marché seul (+3 €) sur sa vraie durée (9 j), pas −4 € dus à la carte ajoutée');
  await p.context().close();
  ok('collection modifiée : variation du marché seul (valMovers : +3 € · 9 j) au lieu des relevés (−4 €) ; courbe limitée à 30 jours');
}

// ouverture sans geste de l'utilisateur (?collection) : Chrome refuse la vibration de openCollection, sans conséquence
errsAll.forEach((e, i) => assert.deepEqual(e.filter(x => !/navigator\.vibrate/.test(x)), [], 'page ' + i));
await browser.close(); world.stop(); console.log('\nWIDGET E2E OK'); process.exit(0);
