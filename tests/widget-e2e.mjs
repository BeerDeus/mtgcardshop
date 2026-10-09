// E2E widget Android (widget.js) : le site confie au plugin ManaOrbit (simulé) la valeur, la variation (et sa durée), le nombre de cartes, les relevés
// des 30 derniers jours et le bouton choisi, une fois les chiffres connus, en différé, seulement quand ils changent ; avec une coque récente et un widget
// posé, la liste compacte des cartes et leurs prix du fichier de prix (estimation appli fermée) ; Réglages › Widget change le bouton ;
// widget touché (« open ») → collection, scan ou prix rapide ; ?collection → la collection ; rien sur le web ; raccourcis de l'icône (« open » trade, paste ;
// PWA : ?open=) et texte partagé vers l'appli (« open » share : decklist, lien lu par le serveur, à froid après le premier contact avec lui) ;
// widget « QR code d'échange » (setTradeWidget : QR du lien d'échange, pseudo, langue ; lien arrêté, renouvelé, déconnexion ; jamais avant que le compte soit connu).
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium, startWorld, newPage, ok, toHome, txt } from './e2e-world.mjs';
const Q = createRequire(import.meta.url)('../src/qr.js');

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

/* ── 7) raccourcis de l'icône (« open » trade / paste) et texte partagé vers l'appli (« open » share) ─────────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed() + shell() }); errsAll.push(errs);
  await p.waitForFunction(() => typeof window.__mo.ls.open === 'function', null, { timeout: 6000 });
  const open = ev => p.evaluate(e => window.__mo.ls.open(e), ev);
  const toastIs = re => p.waitForFunction(r => new RegExp(r).test(document.querySelector('#toast').textContent), re.source, { timeout: 5000 });
  // Échange : réglages ouverts par-dessus → fermés, la collection s'ouvre sur l'onglet Échange
  await p.click('#btnSettings'); await p.waitForFunction(() => sheets.length === 1);
  await open({ view: 'trade' }); await p.waitForSelector('.coll.on', { timeout: 3000 });
  assert.deepEqual(await p.evaluate(() => [sheets.length, COLL.tab, document.querySelector('#collSeg [aria-checked="true"]').dataset.v]), [0, 'trade', 'trade'], 'feuille fermée, onglet Échange');
  ok('raccourci « Échange » : réglages fermés, collection ouverte sur l\'onglet Échange');
  // Nouveau panier sans liste en cours (exemple affiché) : collection fermée, saisie vide, curseur dans le champ, conseil pour coller
  assert.equal(await p.evaluate(() => S.isSample), true);
  await open({ view: 'paste' }); await p.waitForFunction(() => S.view === 'input' && !COLL.el, null, { timeout: 3000 });
  assert.deepEqual(await p.evaluate(() => [$('#deckText').value, document.activeElement && document.activeElement.id, $$('body > .dv.on').length]), ['', 'deckText', 0]);
  await toastIs(/appui long/);
  // avec une liste en cours : gardée (comme « Reprendre ma liste »)
  await p.evaluate(() => { $('#deckText').value = '1 Sol Ring\n1 Arcane Signet\n1 Command Tower'; S.isSample = false; refreshDeck(); showView('home'); document.activeElement.blur(); });
  await open({ view: 'paste' }); await p.waitForFunction(() => S.view === 'input', null, { timeout: 3000 });
  assert.deepEqual(await p.evaluate(() => [$('#deckText').value.split('\n').length, document.activeElement && document.activeElement.id]), [3, 'deckText'], 'liste en cours gardée, curseur dans le champ');
  ok('raccourci « Nouveau panier » : saisie au premier plan, champ vidé (exemple) ou liste en cours gardée, curseur dans le champ');
  // partage d'une decklist (collection ouverte par-dessus : fermée)
  await p.evaluate(() => { showView('home'); openCollection(); }); await p.waitForSelector('.coll.on');
  await open({ view: 'share', text: '1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n1 Wrath of God', title: '' });
  await toastIs(/4 cartes reçues/);
  assert.deepEqual(await p.evaluate(() => [S.view, !!COLL.el, $('#deckText').value.split('\n').length]), ['input', false, 4]);
  // partage d'un lien (EDHREC, Archidekt, Moxfield) : lu par le serveur, comme le share_target de la PWA
  await open({ view: 'share', text: 'https://archidekt.com/decks/123/edgar', title: 'Edgar' });
  await toastIs(/Edgar partagé · 4 cartes reçues/);
  assert.match(await p.$eval('#deckText', t => t.value), /^Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring/);
  // partage vide (fichier sans texte) : message clair
  await open({ view: 'share', text: '', title: '' }); await toastIs(/Rien à importer dans ce partage/);
  ok('partage vers l\'appli : decklist collée (collection fermée), lien Archidekt lu par le serveur, partage vide signalé');
  // scan avec des cartes lues : jamais fermé par un partage (les cartes seraient perdues) ; la liste attend dessous
  await open({ view: 'scan' }); await p.waitForSelector('.scan.on', { timeout: 3000 });
  await p.evaluate(() => { window.__scEl = SC.el; SC.items.set('sol ring|en', { id: 'sol ring|en', key: 'sol ring', name: 'Sol Ring', q: 1, l: 'en' }); });
  await open({ view: 'share', text: '1 Llanowar Elves\n1 Sol Ring\n1 Arcane Signet', title: '' }); await toastIs(/3 cartes reçues/);
  assert.deepEqual(await p.evaluate(() => [SC.el === window.__scEl, SC.items.size, S.view, $('#deckText').value.split('\n')[0]]), [true, 1, 'input', '1 Llanowar Elves']);
  // scan vide : fermé
  await p.evaluate(() => SC.items.clear()); await open({ view: 'paste' }); await p.waitForFunction(() => !SC.el, null, { timeout: 3000 });
  // deck modifié dans l'éditeur : gardé ouvert
  await p.evaluate(() => { openBuilder({}); BD.dirty = true; }); await p.waitForSelector('.bd.on');
  await open({ view: 'trade' }); await p.waitForSelector('.coll.on', { timeout: 3000 });
  assert.deepEqual(await p.evaluate(() => [!!BD.el, sheets.length]), [true, 0], 'éditeur modifié : ni fermé ni « Quitter sans enregistrer ? »');
  ok('scan avec des cartes lues et deck modifié : jamais fermés par un raccourci ou un partage ; scan vide : fermé');
  await p.context().close();
}

/* ── 8) lancement à froid par un partage de lien : attend le premier contact avec le serveur ; ?open= (raccourcis de la PWA) ─ */
{
  // la coque rend l'événement gardé dès que la page écoute (comme Capacitor) ; le serveur répond 1,5 s plus tard
  const cold = ev => shell().replace("addListener: (ev, cb) => { window.__mo.ls[ev] = cb;", `addListener: (ev, cb) => { window.__mo.ls[ev] = cb; if (ev === 'open') setTimeout(() => cb(${JSON.stringify(ev)}), 0);`);
  const { p, errs } = await newPage(browser, world, { goto: false }); errsAll.push(errs);
  let pinged = 0; await p.route('**/__ping', async r => { await new Promise(res => setTimeout(res, 1500)); pinged = Date.now(); await r.continue(); });
  await p.addInitScript(seed() + cold({ view: 'share', text: 'https://archidekt.com/decks/123/edgar', title: 'Edgar' })); await p.goto(world.url);
  await p.waitForFunction(() => /Edgar partagé · 4 cartes reçues/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 });
  assert.ok(pinged > 0, 'serveur joint avant la lecture du lien');
  assert.equal(await p.evaluate(() => S.view), 'input');
  await p.context().close();
  ok('lancement à froid par un lien partagé : lu une fois le serveur joint (pas de « Le lien ne peut être lu… »)');
  // PWA : ?open=trade | paste | quick ; cible inconnue : rien ; adresse nettoyée
  for (const [v, sel, check] of [['trade', '.coll.on', () => COLL.tab === 'trade'], ['paste', '#viewInput:not([hidden])', () => S.view === 'input' && document.activeElement.id === 'deckText'], ['quick', '.scan.on', () => SC.pm === true]]) {
    const w = await newPage(browser, world, { init: seed(), path: '?open=' + v }); errsAll.push(w.errs);
    await w.p.waitForSelector(sel, { timeout: 4000 }); assert.equal(await w.p.evaluate(check), true, v);
    assert.equal(await w.p.evaluate(() => location.search), '', 'paramètre retiré de l\'adresse');
    await w.p.context().close();
  }
  const x = await newPage(browser, world, { init: seed(), path: '?open=toString' }); errsAll.push(x.errs);
  await x.p.waitForTimeout(1200); assert.deepEqual(await x.p.evaluate(() => [!!COLL.el, !!SC.el, S.view]), [false, false, 'home']);
  await x.p.context().close();
  ok('PWA : ?open=trade → Échange, ?open=paste → Nouveau panier, ?open=quick → prix rapide ; cible inconnue : rien');
}

/* ── 9) widget « QR code d'échange » : QR du lien d'échange confié à la coque (setTradeWidget), mis à jour quand le lien ou le pseudo change ─────── */
{
  const SID = 'Share000000000001', SID2 = 'Share000000000002';
  // coque récente : setTradeWidget noté dans window.__mo.q ; tradeWidgets = nombre de widgets « QR code d'échange » posés (absent : APK sans ce widget)
  const qshell = (n = 0) => shell(true, `{ firebase: true, version: '1.1', build: 2, widgets: 0, widgetRefresh: true${n == null ? '' : ', tradeWidgets: ' + n} }`)
    .replace('window.__mo = { calls: [], ls: {} };', 'window.__mo = { calls: [], ls: {}, q: [] };').replace('info: async', 'setTradeWidget: async o => { window.__mo.q.push(o); return {}; },\n    info: async');
  const qseed = `try { localStorage.setItem('deckdeal:trade:v1', JSON.stringify({ keep: 1, kept: [], wish: {}, share: '${SID}', dsh: {}, u: 1, sig: {}, who: 'u1' }));
    localStorage.setItem('deckdeal:profile:v1', JSON.stringify({ uid: 'u1', name: 'Beer', photo: '' })); } catch (e) {}`;
  // faux cloud (comme trade-e2e) puis connexion de u1
  const login = pg => pg.evaluate(() => {
    D.cloud = {
      onUser() {}, watch: (uid, cb) => { cb([], false); return () => {}; }, newId: () => 'x', save: async () => {}, remove: async () => {},
      watchColl(uid, cb) { cb(null, false, false); return () => {}; }, txColl: async (uid, fn) => { const out = fn(window.__collDoc || null); if (out) window.__collDoc = out; return out; }, pullColl: async () => ({ data: window.__collDoc || null }), saveColl: async () => {},
      watchMeta(uid, id, cb) { cb(id === 'profile' ? { name: 'Beer', updatedAt: 1 } : null, false, false); return () => {}; }, saveMeta: async () => {}, pullMeta: async () => ({ data: null }),
      shareId: () => 'Share000000000002', saveShare: async () => {}, dropShare: async () => {},
    };
    D.state = 'ready'; D.err = '';
    onUser({ uid: 'u1', email: 'beer@example.com', displayName: 'Beer', reload: async () => {} });
  });
  const { p, errs } = await newPage(browser, world, { init: seed() + qseed + qshell() }); errsAll.push(errs);
  const qs = () => p.evaluate(() => window.__mo.q.map(c => JSON.parse(c.data)));
  const qn = n => p.waitForFunction(k => window.__mo.q.length >= k, n, { timeout: 6000 });
  await p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 }); await p.waitForTimeout(800);
  assert.deepEqual(await qs(), [], 'compte pas encore connu (Firebase injoignable ici) : rien, la coque garde le code précédent');
  await login(p); await qn(1);
  const url = await p.evaluate(id => shareUrl(id), SID), mx = Q.qrMatrix(url);
  assert.match(url, /\/\?p=Share000000000001$/);
  assert.deepEqual((await qs())[0], { u: url, n: mx.n, m: mx.m.map(r => r.join('')).join(''), by: 'Beer', lang: 'fr' }, 'QR du lien public (matrice de qrMatrix), pseudo, langue');
  await p.evaluate(() => { homeSoon(0); trSoon(); }); await p.waitForTimeout(2200);
  assert.equal((await qs()).length, 1, 'repeints sans changement : aucun nouvel envoi');
  ok('widget « QR code d\'échange » : setTradeWidget({ u, n, m, by, lang }) une fois le compte connu, puis seulement si ça change');

  await p.evaluate(() => trShareOff(false)); await qn(2);
  assert.deepEqual((await qs())[1], { u: '', lang: 'fr' }, 'lien arrêté : plus de code');
  await p.evaluate(() => trShareOn()); await qn(3);
  const url2 = await p.evaluate(id => shareUrl(id), SID2), mx2 = Q.qrMatrix(url2);
  assert.deepEqual((await qs())[2], { u: url2, n: mx2.n, m: mx2.m.map(r => r.join('')).join(''), by: 'Beer', lang: 'fr' }, 'nouveau lien : nouveau code');
  await p.evaluate(() => profSave({ name: 'Mox' })); await qn(4);
  assert.deepEqual([(await qs())[3].u, (await qs())[3].by], [url2, 'Mox'], 'pseudo changé');
  ok('lien arrêté → { u: \'\' } ; nouveau lien → son QR ; pseudo changé → renvoyé');

  // astuces : Réglages › Widget (coque avec ce widget) ; feuille du QR code tant qu'aucun n'est posé
  await p.click('#btnSettings'); await p.waitForSelector('#widgetQrHint');
  assert.match(await txt(p, '#widgetQrHint'), /^Autre widget, « QR code d'échange » :/);
  const closeAll = () => p.evaluate(() => { while (sheets.length) sheets[sheets.length - 1].close(); }).then(() => p.waitForFunction(() => !document.querySelector('#sheetRoot').children.length));      // feuilles retirées après leur animation
  await closeAll(); await p.evaluate(() => trQrOpen()); await p.waitForSelector('.qr-card');
  assert.equal(await txt(p, '.qr-tip'), 'Astuce : le widget « QR code d\'échange » le garde sur ton écran d\'accueil.');
  await closeAll(); await p.evaluate(() => { WGT.qn = 1; trQrOpen(); }); await p.waitForSelector('.qr-card');
  assert.equal(await p.evaluate(() => !!document.querySelector('.qr-tip')), false, 'widget déjà posé : pas d\'astuce');
  await closeAll();
  ok('astuces : Réglages › Widget et feuille du QR code (aucun widget posé)');

  await p.evaluate(() => onUser(null)); await qn(5);
  assert.deepEqual((await qs())[4], { u: '', lang: 'fr' }, 'déconnecté : plus de code');
  await p.context().close();
  // APK sans ce widget (info() sans tradeWidgets) : rien, même avec un lien
  const old = await newPage(browser, world, { init: seed() + qseed + qshell(null) }); errsAll.push(old.errs);
  await old.p.waitForFunction(() => window.__mo.calls.length >= 1, null, { timeout: 6000 }); await login(old.p); await old.p.waitForTimeout(2500);
  assert.deepEqual(await old.p.evaluate(() => window.__mo.q.length), 0);
  assert.equal(await old.p.evaluate(() => { trQrOpen(); return !!document.querySelector('.qr-tip'); }), false, 'pas d\'astuce sans le widget');
  await old.p.context().close();
  ok('déconnexion → { u: \'\' } ; APK sans ce widget : jamais d\'envoi ni d\'astuce');
}

// ouverture sans geste de l'utilisateur (?collection) : Chrome refuse la vibration de openCollection, sans conséquence
errsAll.forEach((e, i) => assert.deepEqual(e.filter(x => !/navigator\.vibrate/.test(x)), [], 'page ' + i));
await browser.close(); world.stop(); console.log('\nWIDGET E2E OK'); process.exit(0);
