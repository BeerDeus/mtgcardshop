// E2E contenus (sets.js, help.js) : « Prochaines extensions » de l'accueil (faux Scryfall /sets : tri, éditions numériques et hors sujet écartées,
// produits rattachés à leur parent, cache 24 h relu au 2e lancement, carte cachée en erreur ou hors ligne) ; Réglages › Aide et avis (feuille d'aide,
// lien d'avis mailto encodé) ; demande de note neutre (coupée sans PLAY_URL, appli Android seulement, bons moments, fréquence, session sans erreur).
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18990 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const DAY = 86400000, PLAY = 'https://play.google.com/store/apps/details?id=app.manaorbit';
const errsAll = [];
const iso = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const set = (code, name, days, type, o = {}) => ({ object: 'set', code, name, released_at: iso(days), set_type: type, digital: false, card_count: 100,
  icon_svg_uri: `https://svgs.scryfall.io/sets/${code}.svg?1700000000`, scryfall_uri: `https://scryfall.com/sets/${code}`, ...o });
// Scryfall /sets simulé (ordre de Scryfall : du plus récent au plus ancien, peu importe) : 4 lignes attendues
const SETS = [
  set('old', 'Old Expansion', -40, 'expansion'), set('rc2', 'Older Recent Core', -10, 'core'), set('rec', 'Recent Expansion', -5, 'expansion'),
  set('dig', 'Alchemy Digital', 3, 'alchemy', { digital: true }), set('dg2', 'Digital Only Expansion', 2, 'expansion', { digital: true }),
  set('tok', 'Alpha Tokens', 12, 'token', { parent_set_code: 'aaa' }), set('pro', 'Promo Pack', 2, 'promo'),
  set('aaa', 'Alpha Future', 12, 'expansion'), set('aac', 'Alpha Future Commander', 12, 'commander', { parent_set_code: 'aaa' }),
  set('bbb', 'Beta Masters', 1, 'masters'), set('xss', '<img src=x onerror="window.__xss=1">', 150, 'expansion', { icon_svg_uri: 'javascript:alert(1)', scryfall_uri: 'https://evil.example/sets/xss' }),
  set('ccc', 'Gamma Core', 200, 'core'), set('ddd', 'Delta Draft', 400, 'draft_innovation'),
];
/** Page branchée sur un /sets simulé : mode 'ok' (liste), 'err' (500), sinon le faux Scryfall commun (404). Compteur de requêtes /sets dans hits. */
async function page(o = {}) {
  const pg = await newPage(browser, world, { goto: false, ...(o.ctx ? { ctx: o.ctx } : {}), init: o.init });
  const hits = { n: 0 };
  await pg.p.route('https://api.scryfall.com/sets', route => { hits.n++; const h = { 'access-control-allow-origin': '*' };
    return o.sets === 'err' ? route.fulfill({ status: 500, headers: h, json: { object: 'error' } }) : o.sets === 'ok' ? route.fulfill({ status: 200, headers: h, json: { object: 'list', has_more: false, data: SETS } }) : route.fallback(); });
  await pg.p.route('https://svgs.scryfall.io/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' }));
  await pg.p.goto(world.url + (o.path || '')); await pg.p.waitForTimeout(700);
  await pg.p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
  errsAll.push(pg.errs);
  return { ...pg, hits };
}
const rows = p => p.$$eval('#hmSetsList .hm-set', as => as.map(a => ({ name: a.querySelector('b').textContent, sub: a.querySelector('.hm-set-t span').textContent, when: a.querySelector('em').textContent,
  href: a.getAttribute('href'), target: a.target, rel: a.rel, icon: (a.querySelector('img') || {}).src || '' })));

/* ── 0) « Coller une liste » (accueil, home.js) : jamais l'exemple de 100 cartes quand le presse-papiers est refusé ─────────── */
{
  const { p, ctx } = await page({});
  assert.equal(await p.evaluate(() => S.isSample), true, 'appareil neuf : l\'exemple est dans le champ');
  await p.click('#btnNew'); await p.waitForTimeout(400);
  assert.deepEqual(await p.evaluate(() => [$('#deckText').value, S.deck.cards.length, document.activeElement === $('#deckText'), $('#btnRun').disabled]), ['', 0, true, true], 'presse-papiers refusé : champ vide, curseur dedans, rien à chercher');
  assert.doesNotMatch(await txt(p, '#btnRunLabel'), /72|cartes/, 'plus « Voir les prix · 72 cartes »');
  await toHome(p); await p.click('#btnNew2'); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => S.isSample && S.deck.cards.length > 50), true, '« Exemple » : inchangé');
  await ctx.close();
}
{
  const { p, ctx } = await page({ ctx: { permissions: ['clipboard-read', 'clipboard-write'] } });
  await p.evaluate(() => navigator.clipboard.writeText('1 Sol Ring\n1 Arcane Signet'));
  await p.click('#btnNew'); await p.waitForFunction(() => $('#deckText').value === '1 Sol Ring\n1 Arcane Signet');
  assert.equal(await p.evaluate(() => [S.isSample, S.deck.cards.length].join()), 'false,2'); await ctx.close();
}
ok('« Coller une liste » : champ vidé avant le presse-papiers (refusé : vide, curseur dedans ; autorisé : la liste collée), « Exemple » inchangé');

/* ── 1) Prochaines extensions : tri, filtres, parent, cache, erreurs ───────────────────────────────────────────── */
{
  const { p, ctx, hits } = await page({ sets: 'ok', ctx: { colorScheme: 'dark' } });
  assert.equal(await p.$eval('#hmSets', e => e.hidden), true, 'cachée tant que rien n\'est lu');
  await p.waitForSelector('#hmSets:not([hidden]) .hm-set', { timeout: 9000 });
  const r = await rows(p);
  assert.deepEqual(r.map(x => x.name), ['Recent Expansion', 'Beta Masters', 'Alpha Future', '<img src=x onerror="window.__xss=1">'], 'dernière sortie récente puis prochaines, par date ; 4 au plus');
  assert.deepEqual(r.map(x => x.when), ['Sortie récente', 'Demain', 'dans 12 jours', 'dans 5 mois']);
  assert.match(r[3].sub, /^\d{1,2} [a-zéû]+( \d{4})?$/, 'date seule (année si ce n\'est pas l\'année en cours) : ' + r[3].sub);
  assert.match(r[2].sub, /^\d{1,2} [a-zéû]+( \d{4})? · decks Commander$/, 'decks Commander rattachés à leur extension : ' + r[2].sub);
  assert.equal(r.filter(x => /Commander|Tokens|Digital|Promo|Older|Old /.test(x.name)).length, 0, 'enfants, numériques, jetons, promos, anciennes : écartés');
  assert.equal(r[2].href, 'https://scryfall.com/sets/aaa'); assert.equal(r[2].target, '_blank'); assert.match(r[2].rel, /noopener/);
  assert.match(r[2].icon, /^https:\/\/svgs\.scryfall\.io\/sets\/aaa\.svg/);
  assert.equal(r[3].href, 'https://scryfall.com/sets/xss', 'adresse inattendue : remplacée par la page Scryfall de l\'édition'); assert.equal(r[3].icon, '', 'icône d\'une autre origine : écartée');
  assert.equal(await p.evaluate(() => window.__xss), undefined, 'nom échappé');
  assert.deepEqual(await p.$eval('#hmSetsSl', a => [a.href, a.target, a.rel, a.textContent.trim(), a.getBoundingClientRect().height >= 40]), ['https://secretlair.wizards.com/', '_blank', 'noopener', 'Secret Lair : drops en cours et à venir↗', true], 'lien Secret Lair sous la liste (les drops ne sont pas des éditions sur Scryfall)');
  assert.equal(hits.n, 1);
  assert.equal(await p.$eval('#hmSets', e => getComputedStyle(e.querySelector('.hm-set-ic img')).filter), 'invert(1) brightness(0.92)', 'icônes noires éclaircies en thème sombre');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'pas de défilement horizontal à 390 px');
  ok('accueil : extensions à venir triées, numériques / jetons / promos écartés, Commander rattaché, liens Scryfall, noms échappés');
  // capture : accueil sombre, carte visible
  await p.$eval('#hmSets', e => e.scrollIntoView({ block: 'center', behavior: 'instant' })); await p.waitForTimeout(900);
  await p.screenshot({ path: 'shots/content-1-extensions.png' });
  await p.reload(); await p.waitForTimeout(400);
  await p.waitForSelector('#hmSets:not([hidden]) .hm-set', { timeout: 2000 });
  await p.waitForTimeout(3200);
  assert.equal(hits.n, 1, '2e lancement : liste gardée 24 h, aucune nouvelle requête');
  assert.equal((await rows(p)).length, 4);
  ok('2e lancement : liste relue dans le cache (aucune requête Scryfall)');
  // cache de plus de 24 h : relu chez Scryfall
  await p.evaluate(() => new Promise(res => { const r = indexedDB.open('deckdeal', 1); r.onsuccess = () => { const s = r.result.transaction('kv', 'readwrite').objectStore('kv'), g = s.get('sets:v1'); g.onsuccess = () => { const v = g.result; v.t -= 25 * 3600e3; s.put(v, 'sets:v1').onsuccess = res; }; }; }));
  await p.reload(); await p.waitForFunction(() => SETS.st === 'done', null, { timeout: 9000 });
  assert.equal(hits.n, 2, 'cache périmé : nouvelle lecture'); ok('cache de plus de 24 h : relu chez Scryfall');
  await ctx.close();
}
{ // Scryfall en erreur (500, puis un nouvel essai) : carte cachée, sans message
  const { p, ctx, hits, errs } = await page({ sets: 'err' });
  await p.waitForFunction(() => SETS.st === 'fail', null, { timeout: 9000 });
  assert.ok(hits.n >= 1); assert.equal(await p.$eval('#hmSets', e => e.hidden), true); assert.equal(await p.$('.toast.on'), null, 'aucun message');
  assert.deepEqual(errs, []); await ctx.close();
}
{ // faux Scryfall commun (404 sur /sets) : cachée aussi
  const { p, ctx } = await page({});
  await p.waitForFunction(() => SETS.st === 'fail', null, { timeout: 9000 }); assert.equal(await p.$eval('#hmSets', e => e.hidden), true); await ctx.close();
}
{ // hors ligne : aucune requête, cachée
  const { p, ctx, hits } = await page({ sets: 'ok', init: 'Object.defineProperty(navigator, "onLine", { get: () => false });' });
  await p.waitForFunction(() => SETS.st === 'fail', null, { timeout: 9000 }); assert.equal(hits.n, 0); assert.equal(await p.$eval('#hmSets', e => e.hidden), true); await ctx.close();
}
{ // accueil pas à l'écran au moment prévu (collection ouverte) : rien ; lu au retour sur l'accueil
  const { p, ctx, hits } = await page({ sets: 'ok' });
  await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.waitForTimeout(3200);
  assert.equal(hits.n, 0, 'collection ouverte : pas de lecture');
  await p.click('.coll .dv-back'); await p.waitForFunction(() => !COLL.el); await p.evaluate(() => homeSoon(0));
  await p.waitForSelector('#hmSets:not([hidden]) .hm-set', { timeout: 9000 }); assert.equal(hits.n, 1); await ctx.close();
}
ok('extensions : cachées en erreur (500, 404) et hors ligne, lues seulement quand l\'accueil est à l\'écran');

/* ── 2) Réglages › Aide et avis ; feuille d'aide ; avis par e-mail ──────────────────────────────────────────────── */
{
  const seed = `localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '2 Sol Ring\\n1 Craterhoof Behemoth', u: 1, s: '', b: null }));`;
  const { p, ctx } = await page({ init: seed, ctx: { colorScheme: 'dark' } });
  await p.click('#btnSettings'); await p.waitForSelector('#helpBox .sec-title');
  assert.equal(await txt(p, '#helpBox .sec-title'), 'Aide et avis');
  assert.deepEqual(await p.$$eval('#helpBox .btn', b => b.map(x => x.textContent)), ['Comment ça marche', 'Envoyer un avis'], 'navigateur : pas de « Noter »');
  const href = await p.$eval('#helpBox a[data-help="mail"]', a => a.getAttribute('href'));
  const m = /^mailto:martin\.stuis11@gmail\.com\?subject=([^&]*)&body=([^&]*)$/.exec(href);
  assert.ok(m, 'mailto : adresse, objet, corps : ' + href.slice(0, 120));
  assert.equal(m[1], 'Mana%20Orbit%20%C2%B7%20avis', 'objet encodé (espaces en %20, point médian en UTF-8)');
  assert.doesNotMatch(href, /[ +\n]/, 'aucun espace, « + » ni retour à la ligne bruts');
  const body = decodeURIComponent(m[2]), lines = body.split('\r\n'), info = await p.evaluate(() => [DD_BUILD, navigator.userAgent]);
  assert.deepEqual(lines.slice(0, 3), ['', '', ''], 'place pour le message en tête');
  assert.ok(lines.includes('Ces informations aident à reproduire un bug. Ta collection n\'est pas envoyée.'));
  assert.ok(lines.includes('Version : ' + info[0])); assert.ok(lines.includes('Plateforme : web')); assert.ok(lines.some(l => /^Langue : fr \(/.test(l)));
  assert.ok(lines.includes('Navigateur : ' + info[1]), 'navigateur (user agent)');
  assert.doesNotMatch(body, /Sol Ring|Craterhoof/, 'jamais la collection');
  assert.ok(!/\r\n/.test(body.replace(/\r\n/g, '')) && !/[^\r]\n/.test(body), 'fins de ligne CRLF');
  ok('Réglages : « Aide et avis », mailto encodé (objet, version, plateforme, langue, navigateur, phrase de confidentialité), sans la collection');
  await p.$eval('#helpBox', e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await p.click('#helpBox [data-help="open"]'); await p.waitForFunction(() => document.querySelectorAll('.sheet-wrap.open').length === 2);
  assert.equal(await txt(p, '.hp-sheet .sheet-head h2'), 'Comment ça marche');
  assert.equal(await p.$$eval('.hp-sheet .hp-q', q => q.length), 8, '8 questions');
  assert.equal(await p.$$eval('.hp-sheet .hp-q[open]', q => q.length), 0, 'toutes repliées');
  await p.click('.hp-sheet .hp-q[data-i="0"] summary'); await p.waitForTimeout(150);
  assert.match(await txt(p, '.hp-sheet .hp-q[data-i="0"] p'), /Nouveau panier » › Critères › Prix/);
  await p.click('.hp-sheet .hp-q[data-i="2"] summary'); await p.waitForTimeout(150);
  assert.deepEqual(await p.$$eval('.hp-sheet .hp-q[open]', q => q.map(x => x.dataset.i)), ['2'], 'une seule question ouverte à la fois');
  assert.match(await p.$eval('.hp-sheet .sheet-foot a[data-help="mail"]', a => a.getAttribute('href')), /^mailto:martin\.stuis11@gmail\.com\?subject=Mana%20Orbit%20%C2%B7%20avis&body=/);
  await p.waitForTimeout(500); await p.screenshot({ path: 'shots/content-2-aide.png' });
  await p.keyboard.press('Escape'); await p.waitForFunction(() => document.querySelectorAll('.sheet-wrap.open').length === 1);
  ok('feuille « Comment ça marche » depuis les Réglages : 8 questions repliables, une ouverte à la fois, avis en pied');
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  await toHome(p); await p.click('#btnHelp'); await p.waitForSelector('.hp-sheet.open');
  ok('accueil : « Comment ça marche ? » ouvre la même aide');
  await ctx.close();
}
{ // anglais : rubrique, aide et lien de l'accueil traduits
  const { p, ctx } = await page({ path: '?lang=en' });
  assert.equal(await txt(p, '#btnHelp'), '? How does it work?');
  await p.click('#btnSettings'); await p.waitForSelector('#helpBox .sec-title');
  assert.equal(await txt(p, '#helpBox .sec-title'), 'Help and feedback'); assert.match(await txt(p, '#helpBox'), /Send feedback/);
  const body = decodeURIComponent(/body=(.*)$/.exec(await p.$eval('#helpBox a[data-help="mail"]', a => a.getAttribute('href')))[1]);
  assert.match(body, /This information helps us reproduce a bug\. Your collection is not sent\.\r\nVersion: \w+\r\nPlatform: web\r\nLanguage: en/);
  await p.click('#helpBox [data-help="open"]'); await p.waitForSelector('.hp-sheet.open');
  assert.deepEqual((await p.$$eval('.hp-sheet summary', s => s.map(x => x.textContent))).slice(0, 2), ['Cardmarket or CardTrader: which prices?', 'How do I add my cards?']);
  await ctx.close();
}
ok('anglais : « Help and feedback », aide et corps du mail traduits');

/* ── 3) Demande de note ───────────────────────────────────────────────────────────────────────────────────────── */
// appli Android simulée (coque avec le plugin ManaOrbit : version de l'APK), collection et deck enregistré prêts à être « complets »
const shell = `window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: n => n === 'ManaOrbit', Plugins: { ManaOrbit: {
  setWidget: async () => ({}), info: async () => ({ firebase: true, version: '1.0', build: 1 }), addListener: () => ({ remove: async () => {} }) } } };`;
const seedRate = (o = {}) => `try { const now = Date.now();
  localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '2 Sol Ring\\n1 Arcane Signet\\n1 Command Tower\\n1 Wrath of God', u: 1, s: '', b: null }));
  localStorage.setItem('deckdeal:decks:v1', JSON.stringify(['d1', 'd2', 'd3', 'd4', 'd5'].map((id, i) => ({ id, name: 'Deck ' + (i + 1), text: '1 Sol Ring\\n1 Arcane Signet', opts: {}, cards: 2, updatedAt: now - 3600e3 }))));
  ${o.onboard === false ? '' : `localStorage.setItem('deckdeal:onboard', String(now - ${o.days ?? 5} * ${DAY}));`}
  ${o.state ? `localStorage.setItem('deckdeal:rate', ${JSON.stringify(JSON.stringify(o.state))}.replace('"AT"', String(now - ${o.ago || 0})));` : ''}
  } catch (e) {}`;
const mount = (p, id) => p.evaluate(id => { const d = findDeck(id); engSet(id, d.name, d.text); }, id);
const sheetUp = p => p.$('.rate-sheet');
const rateSt = p => p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:rate') || 'null'));
async function ratePage(o = {}) {
  const pg = await page({ init: seedRate(o) + (o.web ? '' : shell), ctx: o.ctx });
  await pg.p.evaluate(url => { RATE.wait = 300; if (url) RATE.url = url; }, o.url === undefined ? PLAY : o.url);
  await pg.p.evaluate(() => { document.addEventListener('click', e => { if (e.target.closest('[data-rate="go"]')) e.preventDefault(); }, true); });      // « Noter » : on garde la page (le lien est vérifié à part)
  await pg.p.evaluate(() => homeSoon(0)); await pg.p.waitForTimeout(300);                                                                               // premier relevé des decks complets (aucun)
  return pg;
}
{ // PLAY_URL vide (valeur livrée) : rien, même dans l'appli et après un bon moment
  const { p, ctx } = await ratePage({ url: '' });
  assert.equal(await p.evaluate(() => [PLAY_URL, RATE.url, isNativeApp()].join('|')), '||true');
  await mount(p, 'd1'); await p.waitForTimeout(1500);
  assert.equal(await sheetUp(p), null, 'aucune demande'); assert.equal(await rateSt(p), null, 'rien d\'enregistré');
  await p.click('#btnSettings'); await p.waitForSelector('#helpBox .btn');
  assert.equal(await p.$('#helpBox [data-help="rate"]'), null, 'pas de bouton « Noter »');
  await ctx.close();
}
ok('note : coupée tant que PLAY_URL est vide (ni demande, ni bouton, ni compteur)');
{ // appli Android, adresse de test : deck devenu complet → demande neutre, après la fermeture de la feuille ouverte
  const { p, ctx } = await ratePage({ ctx: { colorScheme: 'dark' } });
  assert.deepEqual((await rateSt(p)).dk, [], 'premier relevé des decks complets');
  await p.click('#btnSettings'); await p.waitForSelector('#helpBox [data-help="rate"]');
  assert.equal(await p.$eval('#helpBox [data-help="rate"]', a => [a.getAttribute('href'), a.target].join()), PLAY + ',_blank', 'Réglages : « Noter sur le Play Store »');
  assert.match(await p.$eval('#helpBox a[data-help="mail"]', a => decodeURIComponent(a.getAttribute('href'))), /Plateforme : appli Android 1\.0 \(1\)/, 'avis : version de l\'APK');
  await mount(p, 'd1'); await p.waitForTimeout(1200);
  assert.equal(await sheetUp(p), null, 'feuille ouverte (Réglages) : la demande attend');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.rate-sheet.open', { timeout: 4000 });
  assert.equal(await txt(p, '.rate-sheet .sheet-head h2'), 'Noter Mana Orbit');
  assert.equal(await txt(p, '.rate-sheet .rate-hero p'), 'Si Mana Orbit t\'est utile, une note sur le Play Store aide beaucoup.');
  assert.deepEqual(await p.$$eval('.rate-sheet .sheet-foot .btn', b => b.map(x => x.textContent)), ['Plus tard', 'Noter'], 'deux choix, aucune question sur l\'avis');
  assert.equal(await p.$eval('.rate-sheet [data-rate="go"]', a => [a.getAttribute('href'), a.target, a.rel].join()), PLAY + ',_blank,noopener');
  assert.equal(await p.$$eval('.rate-sheet input, .rate-sheet [role="radio"], .rate-sheet .star', e => e.length), 0, 'aucune note à choisir dans l\'appli');
  await p.waitForTimeout(500); await p.screenshot({ path: 'shots/content-3-note.png' });
  let st = await rateSt(p); assert.equal(st.n, 1); assert.ok(Date.now() - st.at < 60000);
  await p.click('.rate-sheet [data-close].btn'); await p.waitForFunction(() => !document.querySelector('.rate-sheet'));
  ok('note : demande neutre « Noter » / « Plus tard » après un deck devenu complet, une fois la feuille ouverte fermée');
  // « Plus tard » : plus rien pendant 120 jours, même après un nouveau bon moment
  await mount(p, 'd2'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, '« Plus tard » : rien avant 120 jours');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('deckdeal:rate')); s.at -= 119 * 864e5; localStorage.setItem('deckdeal:rate', JSON.stringify(s)); });
  await mount(p, 'd3'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, '119 jours : toujours rien');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('deckdeal:rate')); s.at -= 2 * 864e5; localStorage.setItem('deckdeal:rate', JSON.stringify(s)); });
  await mount(p, 'd4'); await p.waitForSelector('.rate-sheet.open', { timeout: 4000 });
  st = await rateSt(p); assert.equal(st.n, 2, '121 jours plus tard : de nouveau');
  await p.click('.rate-sheet [data-rate="go"]'); await p.waitForFunction(() => !document.querySelector('.rate-sheet'));
  assert.equal((await rateSt(p)).done, 1, '« Noter » : plus jamais');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('deckdeal:rate')); s.at -= 400 * 864e5; localStorage.setItem('deckdeal:rate', JSON.stringify(s)); });
  await mount(p, 'd5'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, 'après « Noter » : jamais plus');
  ok('note : « Plus tard » = 120 jours ; « Noter » = plus jamais');
  await ctx.close();
}
{ // un deck démonté puis remonté, ou déjà complet au premier relevé : pas un nouveau moment ; 3 demandes au plus
  const { p, ctx } = await ratePage({ state: { n: 3, at: 'AT', dk: [] }, ago: 200 * DAY });
  await mount(p, 'd1'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, '3 demandes déjà faites : plus jamais'); await ctx.close();
}
for (const [o, why] of [[{ web: true }, 'navigateur (pas l\'appli Android)'], [{ days: 3 }, 'première utilisation il y a 3 jours'], [{ onboard: false }, 'première utilisation inconnue']]) {
  const { p, ctx } = await ratePage(o);
  await mount(p, 'd1'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, why + ' : aucune demande'); await ctx.close();
}
{ // session avec une erreur : aucune demande
  const { p, ctx } = await ratePage();
  await p.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'test' })));
  await mount(p, 'd1'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, 'erreur dans la session : aucune demande'); await ctx.close();
}
ok('note : seulement dans l\'appli Android, après 4 jours d\'utilisation, 3 fois au plus, jamais dans une session avec une erreur');
{ // fin d'un scan : 5 exemplaires ajoutés ou plus = bon moment (la demande attend la fin du toast « Annuler ») ; moins de 5 : rien
  const { p, ctx } = await ratePage();
  const scanAdd = items => p.evaluate(items => { SC.items = new Map(items.map(([name, q], i) => ['s' + i, { id: 's' + i, key: ownKey(name), name, q, l: 'fr', maybe: false }])); scanRecap(); }, items);
  await scanAdd([['Llanowar Elves', 2], ['Edgar Markov', 2]]); await p.waitForSelector('.rc-sheet.open [data-rc="go"]'); await p.click('.rc-sheet [data-rc="go"]');
  await p.waitForSelector('#toast.on'); await p.evaluate(() => document.querySelector('#toast').classList.remove('on')); await p.waitForTimeout(1500);
  assert.equal(await sheetUp(p), null, '4 exemplaires : pas assez');
  await scanAdd([['Swords to Plowshares', 3], ['Llanowar Elves', 2]]); await p.waitForSelector('.rc-sheet.open [data-rc="go"]'); await p.click('.rc-sheet [data-rc="go"]');
  await p.waitForSelector('#toast.on'); await p.waitForTimeout(1200);
  assert.equal(await sheetUp(p), null, 'toast « Annuler » à l\'écran : la demande attend');
  await p.evaluate(() => document.querySelector('#toast').classList.remove('on'));
  await p.waitForSelector('.rate-sheet.open', { timeout: 4000 });
  assert.equal(await p.evaluate(() => COLL.map[ownKey('Swords to Plowshares')].q), 3, 'cartes bien ajoutées');
  await ctx.close();
}
ok('note : après 5 exemplaires ou plus ajoutés d\'un scan, une fois le toast parti');

assert.deepEqual(errsAll.flat(), [], 'aucune erreur page : ' + errsAll.flat().join(' | '));
await browser.close(); world.stop();
console.log('\nCONTENT E2E OK'); process.exit(0);
