// E2E PWA : manifeste, icônes, service worker, installabilité (CDP), hors ligne, bannière et bouton « Installer ».
import './setup-env.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const up = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":1,"name":"t"}'); });
await new Promise(r => up.listen(0, '127.0.0.1', r));
const proxy = spawn('node', ['proxy.mjs'], { env: { ...process.env, EDH_SOURCE_URL: '', PORT: '18801', CARDTRADER_TOKEN: 'tok', CT_UPSTREAM: `http://127.0.0.1:${up.address().port}/api/v2` }, stdio: 'ignore' });
process.on('exit', () => { try { proxy.kill(); } catch {} });
await new Promise(r => setTimeout(r, 700));
const URL0 = 'http://127.0.0.1:18801/';
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const fonts = r => r.abort();
const mk = async (opts = {}, init, arg) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...opts });
  if (init) await c.addInitScript(init, arg);
  const pg = await c.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, fonts);
  return { c, pg, errs };
};
const fakePrompt = outcome => {
  window.__prompted = 0;
  const ev = new Event('beforeinstallprompt', { cancelable: true });
  ev.prompt = async () => { window.__prompted++; };
  ev.userChoice = Promise.resolve({ outcome: outcome, platform: 'web' });
  window.__fire = () => window.dispatchEvent(ev);
};

// 1) manifeste + service worker + installabilité + hors ligne (profil persistant : un contexte « privé » ajoute toujours l'erreur in-incognito)
{
  const dir = (await import('node:os')).tmpdir() + '/pwa-profile-' + Date.now();
  const c = await chromium.launchPersistentContext(dir, { executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = c.pages()[0] || await c.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, fonts);
  await pg.goto(URL0);
  const head = await pg.evaluate(() => ({ manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href'), apple: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href'), icon: [...document.querySelectorAll('link[rel=icon]')].map(l => l.getAttribute('href')), cap: document.querySelector('meta[name=mobile-web-app-capable]')?.content }));
  console.log('head :', JSON.stringify(head));
  assert.equal(head.manifest, 'manifest.webmanifest'); assert.equal(head.apple, 'icons/apple-touch-icon.png'); assert.equal(head.cap, 'yes'); assert.ok(head.icon.length >= 2);
  const m = await (await pg.request.get(URL0 + 'manifest.webmanifest')).json();
  console.log('manifeste :', m.name, '|', m.display, '|', m.start_url, '|', m.icons.map(i => i.sizes + ':' + i.purpose).join(' '));
  await pg.evaluate(() => navigator.serviceWorker.ready);
  await pg.waitForFunction(() => navigator.serviceWorker.controller || true);
  await pg.reload(); await pg.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 });
  console.log('✓ service worker actif et contrôle la page');
  // installabilité selon Chromium lui-même
  const cdp = await c.newCDPSession(pg); await cdp.send('Page.enable');
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  console.log('erreurs d\'installabilité (CDP) :', JSON.stringify(installabilityErrors));
  assert.deepEqual(installabilityErrors, [], 'Chromium juge l\'app installable');
  const mf = await cdp.send('Page.getAppManifest'); assert.equal(mf.errors.length, 0, 'manifeste sans erreur : ' + JSON.stringify(mf.errors)); console.log('✓ installable (aucune erreur CDP), manifeste sans erreur');
  // raccourcis de l'icône (appui long, menu de l'appli installée) : ?open=… lu par handleLaunch, dans la portée, icône servie
  assert.deepEqual(m.shortcuts.map(s => [s.name, s.url]), [['Scanner', './?open=scan'], ['Prix rapide', './?open=quick'], ['Échange', './?open=trade'], ['Nouveau panier', './?open=paste']]);
  for (const s of m.shortcuts) {
    assert.ok(s.short_name && s.short_name.length <= 12 && s.description, s.name + ' : libellé court et description');
    for (const ic of s.icons) { const r = await pg.request.get(URL0 + ic.src); assert.equal(r.status(), 200, ic.src); assert.equal(r.headers()['content-type'], ic.type); }
  }
  if (mf.manifest && mf.manifest.shortcuts) assert.deepEqual(mf.manifest.shortcuts.map(s => s.url), ['scan', 'quick', 'trade', 'paste'].map(v => URL0 + '?open=' + v), 'Chromium lit les 4 raccourcis, dans la portée');
  console.log('✓ raccourcis : Scanner, Prix rapide, Échange, Nouveau panier (?open=…, icônes servies)' + (mf.manifest && mf.manifest.shortcuts ? ', lus par Chromium' : ''));
  // contenu des caches : jamais d'API ni de ping
  const cached = await pg.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(k + ' ' + new URL(r.url).pathname); return out; });
  console.log('en cache :', cached.join(', '));
  assert.ok(cached.some(x => / \/$/.test(x)), 'la page est en cache'); assert.ok(cached.some(x => /icon-192/.test(x)));
  await pg.evaluate(() => fetch('api/info').then(r => r.text())); await pg.waitForTimeout(300);
  const cached2 = await pg.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
  assert.ok(!cached2.some(x => /\/api\/|__ping/.test(x)), 'aucune donnée d\'API ni ping en cache');
  // hors ligne : la page s'ouvre quand même, l'API échoue (pas servie depuis un cache)
  await c.setOffline(true);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await pg.title(), 'Mana Orbit'); assert.ok(await pg.$('#deckText'), 'interface complète hors ligne');
  const apiOff = await pg.evaluate(() => fetch('api/info').then(() => 'servi', () => 'échec'));
  assert.equal(apiOff, 'échec', 'l\'API n\'est jamais servie hors ligne depuis un cache');
  console.log('✓ hors ligne : l\'app s\'ouvre, l\'API échoue franchement');
  await pg.screenshot({ path: 'shots/pwa-1-hors-ligne.png' });
  await c.setOffline(false);
  assert.deepEqual(errs, [], 'aucune erreur page'); await c.close();
}

// 1b) réseau très lent : ouverture normale → copie locale tout de suite ; adresse avec paramètres → réseau d'abord, copie au bout de ~4 s
{
  let slow = 0;
  const fwd = http.createServer((q, r) => { const go = () => { const u = http.request({ host: '127.0.0.1', port: 18801, path: q.url, method: q.method, headers: q.headers }, x => { r.writeHead(x.statusCode, x.headers); x.pipe(r); }); u.on('error', () => r.destroy()); q.pipe(u); }; (q.url.split('?')[0] === '/' && slow) ? setTimeout(go, slow) : go(); });
  await new Promise(r => fwd.listen(18802, '127.0.0.1', r));
  const { c, pg, errs } = await mk();
  await pg.goto('http://127.0.0.1:18802/'); await pg.evaluate(() => navigator.serviceWorker.ready); await pg.waitForTimeout(600);
  await pg.reload(); await pg.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 });
  slow = 7000; let t0 = Date.now(); await pg.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }); let dt = Date.now() - t0;
  console.log('ouverture avec serveur très lent (7 s) :', dt, 'ms');
  assert.ok(dt < 2500, 'copie locale servie tout de suite, sans attendre le serveur'); assert.ok(await pg.$('#deckText'));
  t0 = Date.now(); await pg.goto('http://127.0.0.1:18802/?x=1', { waitUntil: 'domcontentloaded', timeout: 20000 }); dt = Date.now() - t0;
  console.log('adresse avec paramètre, serveur très lent (7 s) :', dt, 'ms');
  assert.ok(dt > 3000 && dt < 6500, 'adresse avec paramètre : réseau d\'abord, copie locale après ~4 s, pas 7 s'); assert.ok(await pg.$('#deckText'));
  slow = 0; await pg.waitForTimeout(3500); // la mise à jour se termine en arrière-plan sans erreur
  assert.deepEqual(errs, []); await c.close(); fwd.close();
  console.log('✓ serveur lent : copie locale d\'emblée (ouverture normale) ou après ~4 s (adresse avec paramètres)');
}

// 2) bannière + bouton Installer (événement beforeinstallprompt simulé)
{
  const { c, pg, errs } = await mk({}, fakePrompt, 'accepted');
  await pg.goto(URL0); await pg.waitForTimeout(500);
  assert.equal(await pg.$eval('#installWrap', e => e.classList.contains('closed')), true, 'pas de bannière tant que l\'installation n\'est pas possible');
  await pg.evaluate(() => window.__fire()); await pg.waitForTimeout(800);
  assert.equal(await pg.$eval('#installWrap', e => e.classList.contains('closed')), false, 'bannière visible dès que le navigateur propose l\'installation');
  console.log('bannière :', (await pg.textContent('#installBar')).replace(/\s+/g, ' ').trim());
  await pg.screenshot({ path: 'shots/pwa-2-banniere.png' });
  // réglages : le bouton y est aussi
  await pg.click('#btnSettings'); await pg.waitForSelector('#btnInstall'); await pg.waitForTimeout(500);
  await pg.screenshot({ path: 'shots/pwa-3-reglages.png' });
  await pg.click('#btnInstall'); await pg.waitForFunction(() => /installée\./.test(document.querySelector('#appBox').textContent) || window.__prompted === 1, null, { timeout: 3000 });
  assert.equal(await pg.evaluate(() => window.__prompted), 1, 'prompt() appelé une fois');
  await pg.evaluate(() => window.dispatchEvent(new Event('appinstalled'))); await pg.waitForFunction(() => /installée/.test(document.querySelector('#appBox').textContent));
  console.log('réglages après installation :', (await pg.textContent('#appBox')).replace(/\s+/g, ' ').trim());
  await pg.click('.sheet-wrap.open [data-close].icon-btn'); await pg.waitForTimeout(500);
  assert.equal(await pg.$eval('#installWrap', e => e.classList.contains('closed')), true, 'bannière retirée une fois installée');
  assert.deepEqual(errs, []); await c.close();
}
{ // refus dans la fenêtre du navigateur → la bannière se tait 30 jours ; croix = idem
  const { c, pg, errs } = await mk({}, fakePrompt, 'dismissed');
  await pg.goto(URL0); await pg.waitForTimeout(400); await pg.evaluate(() => window.__fire()); await pg.waitForTimeout(700);
  await pg.click('#btnInstallBar'); await pg.waitForTimeout(900);
  assert.equal(await pg.$eval('#installWrap', e => e.classList.contains('closed')), true, 'refus → bannière retirée');
  const ts = await pg.evaluate(() => Number(localStorage.getItem('deckdeal:install-x'))); assert.ok(Date.now() - ts < 5000);
  await pg.reload(); await pg.waitForTimeout(400); await pg.evaluate(() => window.__fire()); await pg.waitForTimeout(700);
  assert.equal(await pg.$eval('#installWrap', e => e.classList.contains('closed')), true, 'reste silencieuse après rechargement');
  await pg.click('#btnSettings'); await pg.waitForSelector('#btnInstall'); // mais le bouton des réglages reste disponible
  await c.close();
  const x = await mk({}, fakePrompt, 'accepted'); await x.pg.goto(URL0); await x.pg.waitForTimeout(400); await x.pg.evaluate(() => window.__fire()); await x.pg.waitForTimeout(700);
  await x.pg.click('#btnInstallX'); await x.pg.waitForTimeout(900);
  assert.equal(await x.pg.$eval('#installWrap', e => e.classList.contains('closed')), true, 'croix → bannière retirée');
  assert.equal(await x.pg.evaluate(() => window.__prompted), 0, 'la croix ne déclenche pas l\'installation');
  assert.deepEqual(errs.concat(x.errs), []); await x.c.close();
  console.log('✓ refus / croix : bannière silencieuse, bouton des réglages conservé');
}
{ // iPhone : pas d'événement d'installation → explication du geste Safari, jamais de faux bouton
  const { c, pg, errs } = await mk({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await pg.goto(URL0); await pg.waitForTimeout(900);
  assert.equal(await pg.$eval('#installWrap', e => e.classList.contains('closed')), false);
  assert.match(await pg.textContent('#installBar'), /Partager/); assert.equal(await pg.$eval('#btnInstallBar', b => b.hidden), true, 'pas de bouton Installer sur iOS');
  await pg.click('#btnSettings'); await pg.waitForSelector('#appBox'); assert.match(await pg.textContent('#appBox'), /Sur l.écran d.accueil/); assert.equal(await pg.$('#btnInstall'), null);
  await pg.screenshot({ path: 'shots/pwa-4-ios.png' });
  assert.deepEqual(errs, []); await c.close();
  console.log('✓ iOS : consigne Safari, pas de faux bouton');
}
{ // déjà ouverte comme une application installée → ni bannière ni bouton
  const { c, pg, errs } = await mk({}, () => { const o = window.matchMedia.bind(window); window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : o(q); });
  await pg.goto(URL0); await pg.waitForTimeout(500);
  assert.equal(await pg.$eval('#installWrap', e => e.classList.contains('closed')), true);
  await pg.click('#btnSettings'); await pg.waitForSelector('#appBox');
  assert.match(await pg.textContent('#appBox'), /application installée/); assert.equal(await pg.$('#btnInstall'), null);
  assert.deepEqual(errs, []); await c.close();
  console.log('✓ mode application : état « installée », rien à proposer');
}
{ // politique de confidentialité servie (lien de la fiche Google Play), mentions et sources, effacement des données de l'appareil
  const pol = await fetch(URL0 + 'privacy'); assert.equal(pol.status, 200); const html = await pol.text();
  assert.match(html, /Politique de confidentialité/); assert.match(html, /Privacy policy/); assert.match(html, /\?delete-account/); assert.match(html, /Fan Content Policy/);
  assert.equal((await fetch(URL0 + 'privacy.html')).status, 200);
  const { c, pg, errs } = await mk();
  await pg.goto(URL0); await pg.waitForTimeout(500);
  await pg.evaluate(() => { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '1 Sol Ring', u: 1, s: '', b: null })); localStorage.setItem('autre-site', '1'); });
  await pg.click('#btnSettings'); await pg.waitForSelector('#privBox');
  assert.equal(await pg.$('#adStreet'), null, 'plus de champ adresse');
  assert.match(await pg.textContent('.sheet-body .fan'), /Fan Content Policy/); assert.equal(await pg.$eval('#privBox a', a => a.getAttribute('href')), 'privacy');
  await pg.click('#btnAbout'); await pg.waitForFunction(() => document.querySelectorAll('.sheet-wrap.open').length === 2);
  const about = await pg.textContent('.kv.about'); for (const n of ['Scryfall', 'CardTrader', 'EDHREC', 'Archidekt', 'EDHTop16']) assert.match(about, new RegExp(n));
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
  await pg.click('#btnWipe'); await pg.waitForSelector('#btnWipeGo'); assert.match(await pg.textContent('#wipeBox'), /seront effacés/);
  await pg.click('#btnWipeNo'); await pg.waitForSelector('#btnWipe'); assert.ok(await pg.evaluate(() => localStorage.getItem('deckdeal:coll:v1')), 'annuler : rien n\'est effacé');
  await pg.click('#btnWipe'); await pg.click('#btnWipeGo'); await pg.waitForEvent('load', { timeout: 8000 }); await pg.waitForTimeout(400);
  assert.equal(await pg.evaluate(() => localStorage.getItem('deckdeal:coll:v1')), null); assert.equal(await pg.evaluate(() => localStorage.getItem('autre-site')), '1', 'seules les clés de l\'appli sont effacées');
  assert.deepEqual(errs, []); await c.close();
  console.log('✓ confidentialité : /privacy servie (FR + EN, lien de suppression, mention Fan Content), mentions et sources, plus d\'adresse, effacement de l\'appareil en deux temps');
}
console.log('\nPWA E2E OK');
await browser.close(); proxy.kill(); up.close(); process.exit(0);
