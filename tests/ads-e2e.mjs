// E2E pub (appli Android simulée : faux window.Capacitor + faux plugin AdMob) : bandeau en haut après le démarrage, page décalée de sa hauteur
// (événement bannerAdSizeChanged), masqué pendant le scan natif, l'accueil et la carte en grand puis rétabli, seulement sur les écrans de consultation
// (accueil, collection, decks ; ni saisie, ni résultats, ni éditeur de deck), jamais pour un compte autorisé
// (détruit quand checkServer le confirme), attente de la vérification du compte, consentement refusé, et rien du tout sur le web.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, ok } from './e2e-world.mjs';

const world = await startWorld({ port: 18950 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const TEST_ID = 'ca-app-pub-3940256099942544/6300978111', H = 61;

/** Faux pont natif : AdMob journalise ses appels et émet ses événements comme le plugin Android (chargé → hauteur, masqué/détruit → 0). */
function fakeNative(o) {
  const L = {}, emit = (ev, d) => (L[ev] || []).forEach(f => f(d)), sv = () => (typeof CTX !== 'undefined' ? CTX.serverOk : 'absent');
  let banner = false, visible = false;
  const log = window.__ad = { calls: [], seen: {} }, rec = (m, a) => { log.calls.push(m); log.seen[m] = log.seen[m] || { serverOk: sv(), args: a }; };
  const consent = o.consent || { status: 'NOT_REQUIRED', isConsentFormAvailable: false, canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED' };
  const AdMob = {
    addListener: (ev, f) => { (L[ev] = L[ev] || []).push(f); return { remove: async () => {} }; },      // pont natif brut : un objet, pas une promesse
    requestConsentInfo: async a => { rec('requestConsentInfo', a); return consent; },
    showConsentForm: async () => { rec('showConsentForm'); return consent; },
    initialize: async a => { rec('initialize', a); },
    showBanner: async a => { rec('showBanner', a); log.last = a; banner = visible = true; setTimeout(() => { if (banner && visible) { emit('bannerAdSizeChanged', { width: 390, height: 61 }); emit('bannerAdLoaded', {}); } }, 80); },
    hideBanner: async () => { rec('hideBanner'); if (!banner) throw new Error('You tried to hide a banner that was never shown'); visible = false; emit('bannerAdSizeChanged', { width: 0, height: 0 }); },
    resumeBanner: async () => { rec('resumeBanner'); if (banner) { visible = true; emit('bannerAdSizeChanged', { width: 390, height: 61 }); } },
    removeBanner: async () => { rec('removeBanner'); if (banner) { banner = visible = false; setTimeout(() => emit('bannerAdSizeChanged', { width: 0, height: 0 }), 0); } },
    showPrivacyOptionsForm: async () => { rec('showPrivacyOptionsForm'); },
  };
  const Plugins = { AdMob,
    CameraPreview: { start: async () => ({}), stop: async () => ({}), captureSample: async () => ({ value: '' }) },
    CapacitorPluginMlKitTextRecognition: { detectText: async () => ({ text: '', blocks: [] }) } };
  window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: n => n in Plugins, Plugins };
}
const n = (p, m) => p.evaluate(m => window.__ad.calls.filter(c => c === m).length, m);
const pad = p => p.evaluate(() => ({ on: document.documentElement.classList.contains('ad-on'), top: getComputedStyle(document.documentElement).paddingTop, bar: getComputedStyle(document.querySelector('.bar')).top }));
const shown = p => p.waitForFunction(h => document.documentElement.classList.contains('ad-on') && getComputedStyle(document.documentElement).paddingTop === (h + 16) + 'px', H, { timeout: 8000 });      // hauteur du bandeau + 16 px d'écart
const gone = p => p.waitForFunction(() => !document.documentElement.classList.contains('ad-on') && getComputedStyle(document.documentElement).paddingTop === '0px', null, { timeout: 8000 });
/** Page de l'appli « Android ». firebase : 'abort' (SDK injoignable, compte connu tout de suite) ou 'hang' (session qui tarde : pg.held, à relâcher). */
async function natPage(o = {}) {
  const pg = await newPage(browser, world, { goto: false });
  pg.held = []; await pg.p.route('https://www.gstatic.com/**', r => (o.firebase === 'hang' ? pg.held.push(r) : r.abort()));
  if (o.ping) await pg.p.route('**/__ping', async r => { const res = await r.fetch(); r.fulfill({ response: res, json: { ...(await res.json()), ...o.ping } }); });
  if (o.native !== false) await pg.p.addInitScript(fakeNative, o);
  await pg.p.goto(world.url); await pg.p.waitForTimeout(400);
  return pg;
}

{ // 1) appli Android : bandeau après le démarrage, marge, écrans pleins, réglages, compte autorisé
  const { p, errs } = await natPage();
  assert.equal(await n(p, 'showBanner'), 0, 'rien au lancement');
  assert.equal(await n(p, 'requestConsentInfo'), 0, 'pas de consentement demandé au lancement');
  await p.evaluate(() => { AD.delay = 700; AD.back = 200; AD.idle = 0; adsRefresh(); });      // délais de test
  await p.waitForFunction(() => window.__ad.calls.includes('showBanner'), null, { timeout: 8000 });
  assert.deepEqual(await p.evaluate(() => window.__ad.calls.filter(c => c !== 'removeBanner')), ['requestConsentInfo', 'initialize', 'showBanner'], 'consentement, SDK initialisé, puis bandeau');
  assert.deepEqual(await p.evaluate(() => window.__ad.seen.initialize.args), { maxAdContentRating: 'ParentalGuidance' }, 'annonces « accord parental » au plus (PEGI 3-7 / E10+)');
  assert.deepEqual(await p.evaluate(() => window.__ad.last), { adId: TEST_ID, isTesting: true, adSize: 'ADAPTIVE_BANNER', position: 'TOP_CENTER', margin: 0 }, 'bandeau de test en haut (pas d\'ADMOB_BANNER_ID)');
  assert.equal(await p.evaluate(() => window.__ad.calls[0]), 'removeBanner', 'bandeau d\'une page précédente retiré au démarrage');
  await shown(p);
  assert.deepEqual(await pad(p), { on: true, top: (H + 16) + 'px', bar: (H + 16) + 'px' }, 'page et barre du haut décalées de la hauteur reçue + 16 px d\'écart (règle AdMob)');
  assert.ok(await p.evaluate(h => document.querySelector('.bar').getBoundingClientRect().top >= h, H), 'barre du haut sous le bandeau');
  ok('bandeau après le démarrage (consentement → initialisation → bandeau de test en haut), page décalée de sa hauteur');

  await p.evaluate(() => openCollection()); await p.waitForSelector('.coll.on');
  assert.equal(await p.$eval('.coll .dv-head', e => getComputedStyle(e).paddingTop), (H + 16 + 10) + 'px', 'écran plein (collection) : en-tête sous le bandeau (+ écart)');
  assert.equal(await n(p, 'hideBanner'), 0, 'collection : le bandeau reste');
  await p.evaluate(() => openScan()); await p.waitForSelector('.scan.on');
  await p.waitForFunction(() => document.documentElement.classList.contains('nat-cam'), null, { timeout: 5000 });
  await gone(p); assert.equal(await n(p, 'removeBanner'), 2, 'scan natif : bandeau détruit (la caméra native laisse la page au-dessus : un bandeau masqué reviendrait dessous)'); assert.equal(await n(p, 'hideBanner'), 0);
  assert.equal(await p.$eval('.scan .dv-head', e => getComputedStyle(e).paddingTop), '10px', 'scan : plus de marge');
  await p.waitForTimeout(500); assert.equal(await n(p, 'showBanner'), 1, 'pas de retour tant que le scan est ouvert');
  await p.evaluate(() => closeScan()); await shown(p);
  assert.equal(await n(p, 'showBanner'), 2, 'scan fermé : nouveau bandeau, au-dessus de la page'); assert.equal(await n(p, 'resumeBanner'), 0);
  await p.evaluate(() => closeCollection()); await p.waitForTimeout(300);
  ok('collection : en-tête sous le bandeau ; scan natif (html.nat-cam) : bandeau détruit et marge retirée, recréé à la fermeture');

  await p.evaluate(() => openCardViewer([{ key: 'sol ring', name: 'Sol Ring', small: 'https://cards.scryfall.io/small/front/a/b/sol-ring.jpg' }], 0)); await p.waitForSelector('.imgv');
  await gone(p); assert.equal(await n(p, 'hideBanner'), 1);
  await p.evaluate(() => closeCardImage()); await shown(p); assert.equal(await n(p, 'resumeBanner'), 1);
  await p.evaluate(() => obOpen()); await p.waitForSelector('.ob');
  await gone(p); assert.equal(await n(p, 'hideBanner'), 2);
  await p.evaluate(() => obClose()); await shown(p); assert.equal(await n(p, 'resumeBanner'), 2);
  ok('carte en grand et accueil du premier lancement : bandeau masqué puis rétabli');

  // emplacement « par moments » (9 octobre) : saisie, résultats, éditeur de deck → masqué ; accueil, collection, decks → rétabli
  await p.evaluate(() => showView('input')); await gone(p); assert.equal(await n(p, 'hideBanner'), 3, 'saisie : masqué');
  await p.evaluate(() => openCollection()); await p.waitForSelector('.coll.on'); await shown(p); assert.equal(await n(p, 'resumeBanner'), 3, 'collection ouverte par-dessus la saisie : rétabli');
  await p.evaluate(() => closeCollection()); await gone(p); assert.equal(await n(p, 'hideBanner'), 4, 'collection refermée sur la saisie : masqué');
  await p.evaluate(() => showView('results')); await p.waitForTimeout(500); assert.equal(await n(p, 'resumeBanner'), 3, 'résultats : toujours masqué');
  await p.evaluate(() => showView('home')); await shown(p); assert.equal(await n(p, 'resumeBanner'), 4, 'accueil : rétabli');
  await p.evaluate(() => openDecks()); await p.waitForSelector('.dks.on'); await p.waitForTimeout(500); assert.equal(await n(p, 'hideBanner'), 4, 'Mes decks : le bandeau reste');
  await p.evaluate(() => openBuilder({})); await p.waitForSelector('.bd.on'); await gone(p); assert.equal(await n(p, 'hideBanner'), 5, 'éditeur de deck : masqué');
  await p.evaluate(() => bdClose(true)); await shown(p); assert.equal(await n(p, 'resumeBanner'), 5, 'retour sur Mes decks : rétabli');
  await p.evaluate(() => closeDecks()); await p.waitForTimeout(400); assert.equal(await n(p, 'showBanner'), 2, 'jamais recréé : masqué puis rétabli');
  ok('écrans de consultation seulement : masqué en saisie, résultats, éditeur de deck ; rétabli sur l\'accueil, la collection, Mes decks');

  await p.setViewportSize({ width: 390, height: 520 });
  await p.click('#btnSettings'); await p.waitForSelector('#privBox[data-ads]');
  assert.match(await p.textContent('#privBox .hint'), /bandeau publicitaire Google AdMob/); assert.doesNotMatch(await p.textContent('#privBox .hint'), /Aucune publicité/);
  await p.waitForTimeout(500);
  assert.ok(await p.$eval('.sheet', (e, h) => e.getBoundingClientRect().top >= h, H), 'feuille haute : elle s\'arrête sous le bandeau');
  await p.click('#btnAdChoices'); await p.waitForFunction(() => window.__ad.calls.includes('showPrivacyOptionsForm'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(450); await p.setViewportSize({ width: 390, height: 844 });
  assert.equal(await n(p, 'hideBanner'), 5, 'feuille : le bandeau reste');
  ok('réglages : mention de la pub, « Choix publicitaires » (formulaire Google), feuille sous le bandeau');

  await p.evaluate(() => { CTX.serverOk = true; adsRefresh(); }); await gone(p);
  assert.equal(await n(p, 'removeBanner'), 3, 'compte autorisé : bandeau détruit');
  await p.waitForTimeout(1200); assert.equal(await n(p, 'showBanner'), 2, 'et jamais remontré');
  await p.evaluate(() => { CTX.serverOk = false; adsRefresh(); }); await shown(p); assert.equal(await n(p, 'showBanner'), 3, 'autre compte : bandeau recréé');
  await p.route('**/__me', r => r.fulfill({ json: { server: true } }));
  await p.evaluate(async () => { CTX.proxy = CTX.hasToken = CTX.needsLogin = true; CTX.idToken = async () => 'jeton'; await checkServer(); });
  await gone(p); assert.equal(await n(p, 'removeBanner'), 4, 'checkServer() confirme un compte autorisé : bandeau retiré');
  assert.equal(await p.evaluate(() => CTX.serverOk), true);
  assert.equal(await n(p, 'initialize'), 1, 'SDK initialisé une seule fois'); assert.equal(await n(p, 'requestConsentInfo'), 2, 'consentement : au lancement, puis après « Choix publicitaires »');
  assert.deepEqual(errs, []); await p.context().close();
  ok('compte autorisé : bandeau détruit (et via checkServer), jamais remontré ; SDK initialisé une fois');
}

{ // 2) connexion exigée par le serveur : rien tant que le compte n'est pas vérifié ; bloc d'annonces réel donné par /__ping
  const pg = await natPage({ firebase: 'hang', ping: { needsLogin: true, adUnit: 'ca-app-pub-1234567890123456/9876543210' } }), { p, errs } = pg;
  await p.evaluate(() => { AD.delay = 200; AD.idle = 0; adsRefresh(); });
  await p.waitForTimeout(2500);
  assert.deepEqual(await p.evaluate(() => [CTX.serverOk == null, D.authReady]), [true, false], 'session pas encore revenue : compte inconnu');
  assert.deepEqual(await p.evaluate(() => window.__ad.calls.filter(c => c !== 'removeBanner')), [], 'ni consentement ni bandeau avant la vérification du compte');
  for (const r of pg.held.splice(0)) r.abort().catch(() => {});      // la session revient (sans compte) : checkServer() conclut « non autorisé »
  await p.waitForFunction(() => window.__ad.calls.includes('showBanner'), null, { timeout: 12000 });
  assert.deepEqual(await p.evaluate(() => [window.__ad.seen.requestConsentInfo.serverOk, window.__ad.seen.showBanner.serverOk]), [false, false], 'consentement et bandeau seulement une fois le compte vérifié (non autorisé)');
  assert.deepEqual(await p.evaluate(() => window.__ad.last), { adId: 'ca-app-pub-1234567890123456/9876543210', isTesting: false, adSize: 'ADAPTIVE_BANNER', position: 'TOP_CENTER', margin: 0 }, 'bloc réel du serveur, sans mode test');
  await shown(p);
  assert.deepEqual(errs, []); await p.context().close();
  ok('compte en cours de vérification : rien ; ensuite bandeau avec le bloc d\'annonces du serveur (ADMOB_BANNER_ID)');
}

{ // 3) compte autorisé dès le départ : aucun appel au SDK, réglages inchangés
  const { p, errs } = await natPage();
  await p.evaluate(() => { CTX.serverOk = true; AD.delay = 200; AD.idle = 0; adsRefresh(); });
  await p.waitForTimeout(1500);
  assert.deepEqual(await p.evaluate(() => window.__ad.calls), ['removeBanner'], 'ni consentement, ni initialisation, ni bandeau');
  assert.deepEqual(await pad(p), { on: false, top: '0px', bar: '0px' });
  await p.click('#btnSettings'); await p.waitForSelector('#privBox'); await p.waitForTimeout(200);
  assert.match(await p.textContent('#privBox .hint'), /Aucune publicité/); assert.equal(await p.$('#btnAdChoices'), null);
  assert.deepEqual(errs, []); await p.context().close();
  ok('compte autorisé dès le lancement : jamais de pub, aucun appel au SDK');
}

{ // 4) consentement refusé (UE) : formulaire montré, puis aucune pub
  const no = { status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' };
  const { p, errs } = await natPage({ consent: no });
  await p.evaluate(() => { AD.delay = 200; AD.idle = 0; adsRefresh(); });
  await p.waitForFunction(() => window.__ad.calls.includes('showConsentForm'), null, { timeout: 5000 }); await p.waitForTimeout(800);
  assert.deepEqual(await p.evaluate(() => window.__ad.calls.filter(c => c !== 'removeBanner')), ['requestConsentInfo', 'showConsentForm'], 'pas d\'initialisation ni de bandeau sans consentement');
  assert.equal((await pad(p)).on, false);
  assert.deepEqual(errs, []); await p.context().close();
  ok('consentement impossible : formulaire Google, puis aucune pub');
}

{ // 5) navigateur / PWA : aucune pub, aucune marge
  const { p, errs } = await natPage({ native: false });
  await p.evaluate(() => { AD.delay = 100; adsRefresh(); }); await p.waitForTimeout(800);
  assert.deepEqual(await p.evaluate(() => [typeof adsRefresh, AD.on, AD.st, typeof window.Capacitor]), ['function', false, 'off', 'undefined']);
  assert.deepEqual(await pad(p), { on: false, top: '0px', bar: '0px' });
  await p.click('#btnSettings'); await p.waitForSelector('#privBox'); await p.waitForTimeout(200);
  assert.match(await p.textContent('#privBox .hint'), /Aucune publicité/);
  assert.deepEqual(errs, []); await p.context().close();
  ok('web : aucune pub, page intacte');
}

await browser.close(); world.stop(); console.log('\nADS E2E OK'); process.exit(0);
