// E2E « Partager » (shareOut, share.js) : dans l'APK (coque simulée), le lien de la liste d'échange et celui d'un deck passent par ManaOrbit.share
// (menu « Partager » d'Android : la WebView n'a pas navigator.share) avec titre, message et lien, sans rien copier ; APK plus ancienne (méthode absente
// ou refusée) → copie ; navigateur / PWA : navigator.share, abandon (AbortError) → rien ; sans aucun menu de partage → copie.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, startWorld, newPage, ok, txt, toHome, signInFake } from './e2e-world.mjs';
const SHOTS = process.env.NATSHARE_SHOTS || 'shots'; mkdirSync(SHOTS, { recursive: true });      // captures 390 px (NATSHARE_SHOTS : autre dossier)

const world = await startWorld({ port: 18948 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const errsAll = [];
const DECK = 'Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n8 Plains';
const TRADE = 'Ma liste d\'échange Magic';
// collection : de quoi remplir l'onglet Échange ; presse-papiers noté (rien ne doit y aller quand un menu de partage s'ouvre)
const seed = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '3 Sol Ring\\n2 Llanowar Elves', u: 1, s: '', b: null })); } catch (e) {}
  window.__clip = []; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__clip.push(t); }, readText: async () => '' } }); } catch (e) {}`;
// coque Android simulée : la WebView n'a pas navigator.share ; ManaOrbit.share note ses arguments (window.__mo.share), refuse si window.__mo.fail
const shell = `window.__mo = { share: [], fail: '' };
  try { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); } catch (e) {}
  window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: n => n === 'ManaOrbit', Plugins: { ManaOrbit: {
    share: async o => { if (window.__mo.fail) throw new Error(window.__mo.fail); window.__mo.share.push(JSON.parse(JSON.stringify(o))); return { ok: true }; },
    info: async () => ({ firebase: true, version: '1.0', build: 1 }), setWidget: async () => ({}),
    addListener: () => ({ remove: async () => {} }) } } };`;
// navigateur avec navigator.share : arguments notés (window.__ws), réponse choisie par window.__wsErr (nom d'erreur DOM)
const web = `window.__ws = []; window.__wsErr = '';
  Object.defineProperty(navigator, 'share', { configurable: true, value: async o => { window.__ws.push(JSON.parse(JSON.stringify(o))); if (window.__wsErr) throw new DOMException('x', window.__wsErr); } });`;
const clip = p => p.evaluate(() => window.__clip);
const toastOff = p => p.evaluate(() => { clearTimeout(toastT); $('#toast').classList.remove('on'); $('#toast').textContent = ''; });
/** Onglet Échange, lien créé : identifiant du partage. */
async function tradeLink(p) {
  await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
  await p.click('#collSeg [data-v="trade"]'); await p.waitForSelector('.tr-box [data-act="tron"]');
  await p.click('[data-act="tron"]'); await p.waitForSelector('.tr-box.on', { timeout: 15000 });
  return p.evaluate(() => TR.share);
}
/** Feuille « Partager le deck » d'un deck pas enregistré (figé), ouverte depuis le viewer. */
async function deckSheet(p) {
  await p.evaluate(t => openDeckViewer({ text: t, name: 'Edgar' }), DECK); await p.waitForSelector('.dv.on [data-act="share"]');
  await p.click('.dv.on [data-act="share"]'); await p.waitForSelector('.sheet-wrap.open [data-act="dsend"]');
  return p.evaluate(() => /\?p=([A-Za-z0-9]+)$/.exec(document.querySelector('.sheet .tr-link input').value)[1]);
}

/* ── 1) APK récente : menu « Partager » d'Android pour la liste d'échange (toast et bouton) et pour un deck ─────────────────── */
{
  const { p, errs } = await newPage(browser, world, { goto: false, init: seed + shell, ctx: { colorScheme: 'dark' } }); errsAll.push(errs);
  await p.route('https://www.gstatic.com/**', r => r.abort());
  await p.goto(world.url); await signInFake(p);
  const id = await tradeLink(p), url = world.url + '?p=' + id;
  await p.waitForSelector('#toast.on .toast-act');
  assert.equal(await txt(p, '#toast'), 'Lien créé Partager', 'menu de partage disponible : le toast propose « Partager »');
  await p.waitForTimeout(500); await p.screenshot({ path: SHOTS + '/natshare-1-lien-cree.png' });
  await p.click('#toast .toast-act'); await p.waitForFunction(() => window.__mo.share.length === 1);
  const want = { title: TRADE, text: TRADE, url, chooser: 'Partager' };
  assert.deepEqual(await p.evaluate(() => window.__mo.share[0]), want, 'toast « Partager » → ManaOrbit.share (titre, message, lien, titre du menu)');
  await p.click('.tr-box.on [data-act="trsend"]'); await p.waitForFunction(() => window.__mo.share.length === 2);
  assert.deepEqual(await p.evaluate(() => window.__mo.share[1]), want, 'bouton « Partager » du lien');
  await p.click('.tr-box.on [data-act="trcopy"]'); await p.waitForFunction(() => window.__clip.length === 1);
  assert.deepEqual(await clip(p), [url], '« Copier » copie toujours (le lien seul)'); assert.equal(await p.evaluate(() => window.__mo.share.length), 2);
  ok('APK : « Lien créé · Partager » et « Partager » → ManaOrbit.share({ title, text, url, chooser }), rien de copié ; « Copier » copie');

  const sid = await deckSheet(p);
  await p.waitForTimeout(450); await p.screenshot({ path: SHOTS + '/natshare-2-deck.png' });
  await p.click('.sheet-wrap.open [data-act="dsend"]'); await p.waitForFunction(() => window.__mo.share.length === 3);
  assert.deepEqual(await p.evaluate(() => window.__mo.share[2]), { title: 'Edgar', text: 'Edgar · deck Magic', url: world.url + '?p=' + sid, chooser: 'Partager' }, 'deck : « {nom} · deck Magic » + lien');
  assert.deepEqual(await clip(p), [url], 'rien de plus dans le presse-papiers');
  await p.click('.sheet-wrap.open [data-act="dcopy"]'); await p.waitForFunction(() => window.__clip.length === 2);
  assert.equal((await clip(p))[1], world.url + '?p=' + sid, '« Copier » du deck : le lien'); assert.equal(await p.evaluate(() => window.__mo.share.length), 3);
  ok('APK : feuille du deck, « Partager » → ManaOrbit.share (« Edgar · deck Magic »), « Copier » copie');

  // coque qui refuse (appli de partage introuvable, méthode « not implemented ») : le lien est copié
  await p.click('.sheet [data-close].icon-btn'); await p.waitForTimeout(450); await p.evaluate(() => closeDeckViewer()); await p.waitForTimeout(300);
  await p.evaluate(() => { window.__mo.fail = '"ManaOrbit.share()" is not implemented on android'; window.__clip = []; }); await toastOff(p);
  await p.click('.tr-box.on [data-act="trsend"]'); await p.waitForFunction(() => window.__clip.length === 1);
  assert.deepEqual(await clip(p), [url]); assert.equal(await txt(p, '#toast'), 'Copié', 'repli : copie, avec son toast');
  // APK plus ancienne : pas de share sur le plugin (pont Capacitor : seulement les méthodes de la coque) → copie, et le toast de création propose « Copier »
  await p.evaluate(() => { delete window.Capacitor.Plugins.ManaOrbit.share; window.__clip = []; }); await toastOff(p);
  await p.click('.tr-box.on [data-act="trsend"]'); await p.waitForFunction(() => window.__clip.length === 1);
  assert.deepEqual(await clip(p), [url]); assert.equal(await txt(p, '#toast'), 'Copié');
  await toastOff(p); await p.click('.tr-box.on [data-act="trnew"]'); await p.waitForFunction(() => /Lien créé/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 });
  assert.equal(await txt(p, '#toast'), 'Lien créé Copier', 'sans menu de partage : le toast garde « Copier »');
  await p.click('#toast .toast-act'); await p.waitForFunction(() => window.__clip.length === 2);
  assert.equal((await clip(p))[1], world.url + '?p=' + (await p.evaluate(() => TR.share)), 'nouveau lien copié');
  await p.context().close();
  ok('APK qui refuse ou plus ancienne (sans share) : le lien est copié (« Copié »), toast de création « Copier »');
}

/* ── 2) navigateur / PWA : navigator.share (titre, message, lien) ; abandon → rien ; autre refus → copie ─────────────────── */
{
  const { p, errs } = await newPage(browser, world, { goto: false, init: seed + web }); errsAll.push(errs);
  await p.route('https://www.gstatic.com/**', r => r.abort());
  await p.goto(world.url); await signInFake(p);
  const id = await tradeLink(p), url = world.url + '?p=' + id;
  assert.equal(await p.evaluate(() => typeof window.Capacitor), 'undefined', 'pas de coque');
  await p.waitForSelector('#toast.on .toast-act'); assert.equal(await txt(p, '#toast'), 'Lien créé Partager');
  await p.click('.tr-box.on [data-act="trsend"]'); await p.waitForFunction(() => window.__ws.length === 1);
  assert.deepEqual(await p.evaluate(() => window.__ws[0]), { title: TRADE, text: TRADE, url }, 'navigator.share : titre, message, lien');
  assert.deepEqual(await clip(p), [], 'rien de copié');
  // partage abandonné (menu fermé) : ni copie ni toast
  await p.evaluate(() => { window.__wsErr = 'AbortError'; }); await toastOff(p);
  await p.click('.tr-box.on [data-act="trsend"]'); await p.waitForFunction(() => window.__ws.length === 2); await p.waitForTimeout(400);
  assert.deepEqual(await clip(p), [], 'abandon : rien de copié'); assert.equal(await p.evaluate(() => document.querySelector('#toast').classList.contains('on')), false, 'abandon : aucun toast');
  // autre refus (geste expiré, données refusées) : copie
  await p.evaluate(() => { window.__wsErr = 'NotAllowedError'; });
  await p.click('.tr-box.on [data-act="trsend"]'); await p.waitForFunction(() => window.__clip.length === 1);
  assert.deepEqual(await clip(p), [url]); assert.equal(await txt(p, '#toast'), 'Copié');
  await p.evaluate(() => { window.__wsErr = ''; });
  const sid = await deckSheet(p);
  await p.click('.sheet-wrap.open [data-act="dsend"]'); await p.waitForFunction(() => window.__ws.length === 4);
  assert.deepEqual(await p.evaluate(() => window.__ws[3]), { title: 'Edgar', text: 'Edgar · deck Magic', url: world.url + '?p=' + sid }, 'deck : navigator.share');
  assert.equal((await clip(p)).length, 1, 'rien de plus copié');
  await p.context().close();
  ok('navigateur : navigator.share({ title, text, url }) pour la liste et le deck ; AbortError → rien ; autre refus → copie');
}

/* ── 3) navigateur sans navigator.share (Firefox, Chrome Linux) : « Partager » copie ; textes anglais ─────────────────── */
{
  const { p, errs } = await newPage(browser, world, { goto: false, init: seed + 'try { Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); } catch (e) {}' }); errsAll.push(errs);
  await p.route('https://www.gstatic.com/**', r => r.abort());
  await p.goto(world.url); await signInFake(p);
  const id = await tradeLink(p);
  await p.waitForSelector('#toast.on .toast-act'); assert.equal(await txt(p, '#toast'), 'Lien créé Copier', 'aucun menu de partage : « Copier »');
  await toastOff(p); await p.click('.tr-box.on [data-act="trsend"]'); await p.waitForFunction(() => window.__clip.length === 1);
  assert.deepEqual(await clip(p), [world.url + '?p=' + id]); assert.equal(await txt(p, '#toast'), 'Copié');
  await p.context().close();
  const en = await newPage(browser, world, { goto: false }); errsAll.push(en.errs);
  await en.p.goto(world.url + '?lang=en'); await en.p.waitForTimeout(600);
  assert.deepEqual(await en.p.evaluate(() => [T('Ma liste d\'échange Magic'), T('{name} · deck Magic', { name: 'Edgar' }), T('Partager'), T('Lien créé')]), ['My Magic trade list', 'Edgar · Magic deck', 'Share', 'Link created']);
  await en.p.context().close();
  ok('sans navigator.share : « Partager » copie (comme avant) ; message et titre du menu traduits en anglais');
}

errsAll.forEach((e, i) => assert.deepEqual(e, [], 'erreurs page ' + i + ' : ' + e.join(' | ')));
await browser.close(); world.stop();
console.log('NATSHARE E2E OK');
process.exit(0);
