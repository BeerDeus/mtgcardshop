// E2E scan OCR : Tesseract.js servi depuis node_modules à la place du CDN, cartes synthétiques (fixtures/), photos puis caméra simulée.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, startWorld, newPage, txt, ok, CARDS, toInput, toHome } from './e2e-world.mjs';

const TESS_DIR = process.env.TESS_DIR || new URL('../tests/node_modules', import.meta.url).pathname;
if (!existsSync(TESS_DIR + '/tesseract.js')) { console.log('· tesseract.js absent (TESS_DIR) : test OCR ignoré'); process.exit(0); }
const FX = new URL('./fixtures/', import.meta.url).pathname, fx = n => FX + n;
const map = [
  [/\/npm\/tesseract\.js@5\.1\.1\/dist\/(.+)$/, m => `${TESS_DIR}/tesseract.js/dist/${m[1]}`, 'text/javascript'],
  [/\/npm\/tesseract\.js-core@5\.1\.1\/(.+)$/, m => `${TESS_DIR}/tesseract.js-core/${m[1]}`, null],
  [/\/npm\/@tesseract\.js-data\/(eng|fra)\/4\.0\.0_best_int\/(.+)$/, m => `${TESS_DIR}/@tesseract.js-data/${m[1]}/4.0.0_best_int/${m[2]}`, 'application/gzip'],
];
const cdnHits = [];
async function routeCdn(ctx) {
  await ctx.route('https://cdn.jsdelivr.net/**', route => {
    const u = new URL(route.request().url()); cdnHits.push(u.pathname);
    for (const [re, file, type] of map) {
      const m = re.exec(u.pathname); if (!m) continue;
      const f = file(m); if (!existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: type || (f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'), body: readFileSync(f) });
    }
    return route.fulfill({ status: 404, body: 'nf' });
  });
}
const world = await startWorld({ port: 18910, bigCatalog: 35000 });
const items = p => p.$$eval('.sc-item:not(.miss):not(.pend)', r => r.map(x => ({ name: (SC.items.get(x.dataset.id) || {}).name || x.querySelector('.sc-n b').textContent, shown: x.querySelector('.sc-n b').textContent, q: Number(x.querySelector('.qstep b') ? x.querySelector('.qstep b').textContent : 0), maybe: x.classList.contains('maybe'), note: (x.querySelector('small') || {}).textContent || '', thumb: (x.querySelector('.sc-th') || {}).src || '' })));
const misses = p => p.$$eval('.sc-item.miss', r => r.map(x => x.querySelector('b').textContent));
const idle = (p, ms = 150000) => p.waitForFunction(() => !SC.working && !SC.queue.length && !SC.pend.length, null, { timeout: ms });

/* ── A) photos ───────────────────────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const { ctx, p, errs } = await newPage(browser, world, { goto: false });
await routeCdn(ctx); await p.goto(world.url); await p.waitForTimeout(700);
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on');
await p.waitForFunction(() => document.querySelector('.sc-stage').dataset.cam === 'no', null, { timeout: 5000 });
assert.match(await txt(p, '.sc-hint'), /Aucun appareil photo/); assert.equal(await p.$eval('#scFile', i => i.multiple), true);
await p.screenshot({ path: 'shots/scan-0-ouverture.png' }); assert.equal(await p.getAttribute('#scCam', 'capture'), 'environment', '« Appareil » : ouvre l\'appareil photo du téléphone'); assert.match(await p.getAttribute('#scCam', 'accept'), /image/);
assert.equal(await p.$('#scLang'), null, 'plus de choix de langue'); assert.equal(await p.$('#scMode'), null, 'plus de mode « plusieurs cartes »'); assert.equal(await p.$('#scAuto'), null, 'plus de lecture automatique');
ok('écran de scan : sans appareil photo, message clair, « Photos » et « Appareil » disponibles, plus de langue ni de mode multiple');
// aide fermable : × la masque, le choix est retenu d'un scan à l'autre, « ? » la rouvre
assert.equal(await p.isVisible('.sc-note'), true, 'aide visible au départ');
await p.click('.sc-note [data-act="note"]'); assert.equal(await p.isVisible('.sc-note'), false); assert.equal(await p.evaluate(() => localStorage.getItem('deckdeal:scnote')), 'off');
await p.screenshot({ path: 'shots/scan-0b-aide-fermee.png' });
await p.click('.scan [data-act="close"]'); await p.waitForTimeout(400); await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on');
assert.equal(await p.isVisible('.sc-note'), false, 'aide restée fermée au scan suivant'); assert.equal(await p.getAttribute('.sc-help', 'aria-pressed'), 'false');
await p.click('.sc-help'); assert.equal(await p.isVisible('.sc-note'), true); assert.equal(await p.getAttribute('.sc-help', 'aria-pressed'), 'true'); assert.equal(await p.evaluate(() => localStorage.getItem('deckdeal:scnote')), null);
ok('aide fermable (×), retenue d\'un scan à l\'autre, rouverte par « ? »');

const t0 = Date.now();
await p.setInputFiles('#scFile', ['swords.jpg', 'crater.jpg', 'wrath.jpg', 'llanowar.jpg', 'edgar.jpg', 'blurry.jpg', 'nonsense.jpg'].map(fx));
await idle(p); const dt = Date.now() - t0;
let it = await items(p); console.log('  lu :', it.map(x => `${x.name}${x.maybe ? ' (?)' : ''} ×${x.q}`).join(' · '), `· ${Math.round(dt / 1000)} s pour 7 photos`);
const names = new Set(it.map(x => x.name));
for (const n of ['Swords to Plowshares', 'Craterhoof Behemoth', 'Wrath of God', 'Llanowar Elves', 'Edgar Markov']) assert.ok(names.has(n), n + ' reconnue');
assert.ok(it.every(x => ['Swords to Plowshares', 'Craterhoof Behemoth', 'Wrath of God', 'Llanowar Elves', 'Edgar Markov', 'Arcane Signet'].includes(x.name)), 'jamais une mauvaise carte');
assert.ok(!it.some(x => /qzx|plrt/i.test(x.name)), 'texte absurde : rien');
assert.equal(it.filter(x => !x.maybe && x.name !== 'Arcane Signet').every(x => x.q === 1), true);
assert.equal(it.find(x => x.name === 'Craterhoof Behemoth').maybe, false, 'coût de mana collé au nom : toujours une lecture sûre');
assert.ok(it.filter(x => x.name !== 'Edgar Markov').every(x => /^https:\/\/api\.scryfall\.com\/cards\/named\?exact=.+&format=image&version=small$/.test(x.thumb)), 'chaque carte anglaise porte sa miniature Scryfall');
assert.match(it.find(x => x.name === 'Edgar Markov').thumb, /\/small\/front\/fr\/edgar-markov\.jpg$/, 'nom identique en français et en anglais : français par défaut (90 % de ses cartes) — la puce de langue le corrige d\'un appui');
assert.equal(await p.evaluate(() => SC.items.get('edgar markov|fr').l), 'fr');
assert.deepEqual((await misses(p)).map(x => x.replace(/ ·.*$/, '')), ['Photo 7'], 'photo illisible : ligne « non reconnu »');
const missThumb = await p.$eval('.sc-item.miss .sc-th', i => i.src || ''); assert.match(missThumb, /^data:image\/jpeg/); assert.ok(missThumb.length < 14000, 'vignette minuscule (' + missThumb.length + ' car.), pas la photo');
assert.equal(await p.$$eval('.sc-item.pend', r => r.length), 0, 'plus rien en attente'); assert.equal(await p.evaluate(() => SC.queue.length + SC.pend.length), 0);
assert.match(await txt(p, '.sc-item.miss'), /Nom non reconnu/i);
await p.waitForTimeout(400); await p.screenshot({ path: 'shots/scan-1-photos.png' });
ok('photos « 1 carte / photo » : 5 cartes nettes lues (cadre clair, vert, noir à texte clair, légère rotation), absurde ignoré');

// ligne « non reconnu » : « Saisir » ouvre la saisie assistée, × l'ignore
await p.click('.sc-item.miss [data-a="type"]'); await p.waitForSelector('#caName', { timeout: 3000 }); await p.keyboard.press('Escape'); await p.waitForSelector('#caName', { state: 'detached', timeout: 3000 }).catch(() => {});
await p.click('.sc-item.miss [data-a="rm"]'); assert.equal((await misses(p)).length, 0);
// validation : quantité, retrait, puis ajout
await p.click('.sc-item[data-k="wrath of god"] [data-a="inc"]');
// « − » du scan : confirmation d'abord (Annuler ne change rien)
await p.click('.sc-item[data-k="wrath of god"] [data-a="dec"]'); await p.waitForSelector('.sheet [data-ok]'); assert.match(await txt(p, '.sheet .cf-msg'), /Wrath of God\s*Il en restera 1 sur 2/);
await p.click('.sheet .sheet-foot .btn.ghost'); await p.waitForFunction(() => !document.querySelector('.sheet')); assert.equal((await items(p)).find(x => x.name === 'Wrath of God').q, 2, 'Annuler : quantité inchangée');
await p.click('.sc-item[data-k="wrath of god"] [data-a="dec"]'); await p.click('.sheet [data-ok]'); await p.waitForFunction(() => !document.querySelector('.sheet')); assert.equal((await items(p)).find(x => x.name === 'Wrath of God').q, 1, 'Retirer : un exemplaire de moins');
await p.click('.sc-item[data-k="wrath of god"] [data-a="inc"]');
await p.click('.sc-item[data-k="llanowar elves"] [data-a="del"]');
assert.equal((await items(p)).find(x => x.name === 'Wrath of God').q, 2); assert.ok(!(await items(p)).some(x => x.name === 'Llanowar Elves'));
const want = (await items(p)).filter(x => !x.maybe), total = want.reduce((a, x) => a + x.q, 0);
assert.match(await txt(p, '.scan .dv-foot [data-act="done"]'), new RegExp(`Ajouter ${total} cartes`));
// fiche récap : le tap sur « Ajouter » ouvre d'abord les stats ; « Retour » garde le scan ouvert
await p.click('.scan .dv-foot [data-act="done"]'); await p.waitForSelector('.rc-sheet .rc-facts', { timeout: 3000 });
await p.waitForFunction(() => !/…/.test(document.querySelector('.rc-sheet .rc-val b').textContent), null, { timeout: 5000 });
const cents = want.reduce((a, x) => { const c = CARDS.find(r => r[0] === x.name); return a + (c && c[7] ? Math.round(parseFloat(c[7]) * 100) * x.q : 0); }, 0);
const eur = c => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(c / 100).replace(/\s/g, ' ');
const rc = await p.$$eval('.rc-sheet .cs-tiles > div', d => d.map(x => x.textContent.replace(/\s/g, ' ')));
assert.match(rc[0], new RegExp(`^${want.length}carte`)); assert.match(rc[1], new RegExp(`^${total}exemplaires`)); assert.equal(rc[2].replace(/valeur.*$/, ''), cents ? eur(cents) : '—', 'valeur estimée CM = somme prix × quantités');
assert.match(await txt(p, '.rc-sheet h2'), new RegExp(`Ajouter ${total} cartes`)); assert.match(await txt(p, '.rc-sheet .rc-facts'), new RegExp(`Nouvelles dans ta collection ${want.length} cartes`)); assert.match(await txt(p, '.rc-sheet .rc-facts'), /Langues .*(FR|EN) × \d/);
if (cents) assert.ok((await p.$$('.rc-sheet .cs-top .crow')).length >= 1, 'les plus chères listées');
if (cents) await p.waitForFunction(() => document.querySelectorAll('.rc-sheet .cs-top .thumb img.ok').length >= 1, null, { timeout: 5000 });      // miniatures visibles (classe ok posée au chargement)
await p.waitForTimeout(700); await p.screenshot({ path: 'shots/scan-recap.png' });
await p.click('.rc-sheet .sheet-foot .btn.ghost'); await p.waitForFunction(() => !document.querySelector('.rc-sheet'), null, { timeout: 3000 }); assert.ok(await p.$('.scan'), 'Retour : le scan reste ouvert'); assert.equal(await p.evaluate(() => collCount()), 0, 'rien ajouté');
await p.click('.scan .dv-foot [data-act="done"]'); await p.waitForSelector('.rc-sheet [data-rc="go"]');
await p.click('.rc-sheet [data-rc="go"]'); await p.waitForFunction(() => !document.querySelector('.scan') && !document.querySelector('.rc-sheet'), null, { timeout: 3000 });
await p.waitForFunction(n => document.querySelectorAll('.crow').length === n, want.length, { timeout: 5000 });
assert.equal(await p.evaluate(() => collQty('wrath of god')), 2); assert.equal(await p.evaluate(() => collQty('llanowar elves')), 0);
assert.match(await txt(p, '#toast'), new RegExp(`${total} cartes ajoutées à ta collection`));
ok('validation : quantité corrigée, carte retirée, ajout à la collection');

// français d'abord (la plupart des cartes), puis anglais ; noms imprimés lus dans le catalogue français Scryfall gardé sur l'appareil
await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on');
const exactSearches = () => world.scry.filter(s => /\/cards\/search/.test(s) && /lang%3Afr/.test(s) && /name%3A|(%21|!)%22/.test(s)).length, ex0 = exactSearches();
await p.evaluate(() => { window.__ol = []; const o = ocrLines; ocrLines = (c, l, psm) => { window.__ol.push(l); return o(c, l, psm); }; });      // ordre des langues lues
await p.setInputFiles('#scFile', [fx('anneau.jpg'), fx('epees.jpg')]); await idle(p, 200000);
it = await items(p); console.log('  français (langue auto) :', it.map(x => `${x.name}${x.maybe ? ' (?)' : ''}`).join(' · '));
assert.ok(it.some(x => x.name === 'Sol Ring'), 'Anneau solaire → Sol Ring'); assert.ok(it.every(x => ['Sol Ring', 'Swords to Plowshares'].includes(x.name)));
const ol = await p.evaluate(() => window.__ol); assert.equal(ol[0], 'fra', 'lecture française d\'abord'); assert.ok(ol.filter(l => l === 'fra').length >= ol.filter(l => l === 'eng').length, 'cartes françaises : plus rien à lire en anglais une fois le nom sûr (' + ol.join(',') + ')');
assert.equal(exactSearches(), ex0, 'catalogue français local : aucune recherche réseau de nom pendant le scan');
assert.ok(world.scry.some(s => /\/cards\/search/.test(s) && /lang%3Afr/.test(s) && !/name%3A|(%21|!)%22/.test(s)), 'catalogue des noms français lu chez Scryfall (lang:fr paginé)');
assert.deepEqual(await p.evaluate(() => [FRC.state, !!FRC.cat, FRC.cat && FRC.cat.n > 0]), ['ready', true, true]); assert.equal(await p.isVisible('.sc-cat'), false, 'bandeau du catalogue masqué une fois prêt');
assert.ok((await p.evaluate(async () => (await scryFrCached()).rows.length)) > 0, 'catalogue gardé sur l\'appareil (IndexedDB)');
ok('cartes françaises : lues en français d\'abord, catalogue local (« Anneau solaire » → Sol Ring)');
// langue enregistrée par carte : français lu → « fr », image Scryfall française, modifiable d'un appui, gardée dans la collection (texte *FR*)
assert.deepEqual(await p.evaluate(() => [...SC.items.values()].map(e => e.l)), it.map(() => 'fr'), 'cartes lues en français : langue fr');
assert.equal(await p.$$eval('.sc-item .lchip[data-l="fr"]', r => r.length), it.length, 'puce drapeau français sur chaque carte');
// affichage : carte FR sous son nom imprimé, le drapeau à droite du nom ; carte passée en anglais → nom anglais
assert.equal(await p.$eval('.sc-item[data-k="sol ring"] .sc-n b', e => e.textContent), 'Anneau solaire', 'carte FR : nom imprimé français');
assert.ok(await p.$eval('.sc-item[data-k="sol ring"] .sc-top', t => { const b = t.querySelector('b').getBoundingClientRect(), c = t.querySelector('.lchip').getBoundingClientRect(); return c.left >= b.right - 1 && Math.abs((c.top + c.height / 2) - (b.top + 10)) < 14; }), 'drapeau à droite du nom, sur sa ligne');
assert.ok(await p.$eval('.sc-item[data-k="sol ring"]', r => { const th = r.querySelector('.sc-th').getBoundingClientRect(), c = r.querySelector('.lchip').getBoundingClientRect(); return c.left - th.right > 20; }), 'drapeau loin de la vignette (pas de faux appui sur l\'image)');
assert.match(await p.$eval('.sc-item[data-k="sol ring"] .sc-th', i => i.src), /\/small\/front\/fr\/sol-ring\.jpg$/, 'miniature française');
await p.selectOption('.sc-item[data-k="sol ring"] .lchip select', 'en'); assert.equal(await p.$eval('.sc-item[data-k="sol ring"] .sc-n b', e => e.textContent), 'Sol Ring', 'carte passée en anglais : nom anglais'); assert.match(await p.$eval('.sc-item[data-k="sol ring"] .sc-th', i => i.src), /api\.scryfall\.com\/cards\/named/, 'langue anglaise : miniature anglaise');
await p.selectOption('.sc-item[data-k="sol ring"] .lchip select', 'fr'); assert.match(await p.$eval('.sc-item[data-k="sol ring"] .sc-th', i => i.src), /\/fr\/sol-ring\.jpg$/, 'retour au français : image gardée');
await p.screenshot({ path: 'shots/scan-1c-langue.png' });
await p.click('.scan .dv-foot [data-act="done"]'); await p.waitForSelector('.rc-sheet [data-rc="go"]'); await p.click('.rc-sheet [data-rc="go"]'); await p.waitForFunction(() => !document.querySelector('.scan'), null, { timeout: 3000 });
assert.equal(await p.evaluate(() => COLL.map['sol ring'].l), 'fr'); assert.match(await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:coll:v1')).t), /\d+ Sol Ring( \(D[0-9a-z]{6}\))? \*FR\*/, 'langue dans le texte enregistré (et envoyé au compte)');
await p.waitForSelector('.crow[data-k="sol ring"] .lchip[data-l="fr"]'); await p.waitForFunction(() => { const i = document.querySelector('.crow[data-k="sol ring"] .thumb img'); return i && /\/fr\/sol-ring\.jpg$/.test(i.src); }, null, { timeout: 5000 });
assert.equal(await p.$eval('.crow[data-k="craterhoof behemoth"] .lchip', e => e.dataset.l), 'en', 'carte lue en anglais : langue en');
// collection : changer la langue d'une carte charge son image française (lot Scryfall) ; une carte sans impression française garde l'anglaise
world.noFr.add('Arcane Signet'); const nSearch = () => world.scry.filter(s => /\/cards\/search/.test(s) && /lang%3Afr/.test(s) && /(%21|!)%22/.test(s)).length, n0 = nSearch();
await p.selectOption('.crow[data-k="craterhoof behemoth"] .lchip select', 'fr'); await p.selectOption('.crow[data-k="arcane signet"] .lchip select', 'fr');
await p.waitForFunction(() => { const i = document.querySelector('.crow[data-k="craterhoof behemoth"] .thumb img'); return i && /\/fr\/craterhoof-behemoth\.jpg$/.test(i.src); }, null, { timeout: 8000 });
await p.waitForFunction(() => 'fr|arcane signet' in COLL.li && !COLL.enrich, null, { timeout: 8000 });      // la 2e carte est lue à la suite de la 1re
assert.ok(nSearch() > n0 && nSearch() <= n0 + 2, 'recherche par lots de noms exacts : ' + (nSearch() - n0) + ' requête(s)');
assert.match(await p.$eval('.crow[data-k="arcane signet"] .thumb img', i => i.src), /\/a\/b\/arcane-signet\.jpg$/, 'pas d\'impression française : image anglaise'); assert.equal(await p.evaluate(() => COLL.li['fr|arcane signet']), '', 'absence retenue (pas de nouvelle requête)');
assert.equal(await p.evaluate(() => collLangMissingCount()), 0);
await p.click('.crow[data-k="craterhoof behemoth"] .thumb'); await p.waitForSelector('.imgv.on'); assert.match(await txt(p, '.imgv-sub'), /français/i); assert.doesNotMatch(await txt(p, '.imgv-sub'), /indisponible|anglais/i, 'visionneuse : pas de fausse alerte « image française indisponible »'); assert.match(await p.$eval('.imgv-ph', i => i.src), /\/fr\/craterhoof-behemoth\.jpg$/, 'visionneuse : image française'); await p.keyboard.press('Escape'); await p.waitForSelector('.imgv', { state: 'detached' });
await p.selectOption('.crow[data-k="craterhoof behemoth"] .lchip select', ''); assert.equal(await p.evaluate(() => COLL.map['craterhoof behemoth'].l), undefined, 'langue effaçable');
await p.evaluate(() => collSetLang('craterhoof behemoth', 'fr'));
await p.screenshot({ path: 'shots/coll-langue.png' });
ok('langue des cartes : détectée au scan, puce drapeau modifiable, image Scryfall dans la langue (lots de 12 noms), repli anglais retenu, enregistrée avec la collection (*FR*)');
// carte « à vérifier » : la photo prise s'affiche au-dessus ; l'aperçu s'ouvre en grand (avec la photo) ; barres : capture en bas, Annuler / Ajouter sous l'image
await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on');
const bars = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(), st = r('.sc-stage'), ft = r('.scan .dv-foot'), bar = r('.sc-bar'), ls = r('.sc-list'); return { ftBelowStage: ft.top >= st.bottom - 1, barBelowFoot: bar.top > ft.bottom - 1, barBelowList: bar.top >= ls.bottom - 1 }; });
assert.deepEqual(bars, { ftBelowStage: true, barBelowFoot: true, barBelowList: true }, 'Annuler / Ajouter juste sous la caméra, bouton de capture + Photos/Appareil tout en bas');
assert.match(await txt(p, '.scan .dv-foot'), /Annuler/); assert.match(await txt(p, '.sc-bar'), /Photos/); assert.match(await txt(p, '.sc-bar'), /Appareil/); assert.ok(await p.$('.sc-bar #scShot, .sc-bar .sc-shot, .sc-bar [data-act="shot"]'), 'bouton rond dans la barre du bas');
{ const bb = await p.$eval('.sc-shot', e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }); assert.ok(bb[0] >= 80 && bb[0] === bb[1], 'déclencheur agrandi (84 px), rond : ' + bb); }
const shot = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 56; const g = c.getContext('2d'); g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, 320, 56); g.fillStyle = '#111'; g.font = '30px serif'; g.fillText('So1 Rinq', 12, 38); return c.toDataURL('image/jpeg', .8); });
await p.evaluate(s => scanAdd({ key: 'sol ring', name: 'Sol Ring', score: 0.78, raw: 'So1 Rinq', card: 'en' }, 1, true, s), shot);
await p.waitForSelector('.sc-item.maybe .sc-pic img'); assert.match(await p.$eval('.sc-item.maybe .sc-pic img', i => i.src), /^data:image\/jpeg/, 'photo prise affichée sur la carte à vérifier'); assert.match(await txt(p, '.sc-item.maybe small'), /ta photo ci-dessus/i);
assert.equal(await p.$('.sc-item:not(.maybe) .sc-pic'), null, 'pas de photo sur les cartes sûres');
await p.click('.sc-item.maybe .sc-th'); await p.waitForSelector('.imgv.on'); assert.equal(await p.isVisible('.imgv-shot'), true, 'visionneuse : photo prise visible'); assert.match(await p.$eval('.imgv-shot', i => i.src), /^data:image\/jpeg/); assert.match(await txt(p, '.imgv-extra'), /à vérifier/i);
await p.waitForTimeout(700); await p.screenshot({ path: 'shots/scan-1d-verif.png' }); await p.keyboard.press('Escape'); await p.waitForSelector('.imgv', { state: 'detached' }); assert.equal(await p.isVisible('.scan.on'), true, 'Échap ferme la visionneuse seulement, pas l\'écran de scan');
await p.evaluate(() => scanAdd({ key: 'sol ring', name: 'Sol Ring', score: 0.97, raw: 'Sol Ring', card: 'en' }, 1, false)); assert.equal(await p.$('.sc-item.maybe'), null, 'relue sûrement : plus « à vérifier »'); assert.equal(await p.$('.sc-pic'), null);
await p.click('.scan .dv-foot [data-act="close"]'); await p.waitForFunction(() => !document.querySelector('.scan'), null, { timeout: 3000 });
ok('« à vérifier » : photo prise au-dessus, aperçu cliquable en grand avec la photo ; barres inversées (capture en bas)');
await p.waitForTimeout(300);
assert.ok(!(await p.evaluate(() => JSON.stringify(localStorage))).includes('data:image'), 'aucune photo enregistrée dans le navigateur');

// vitesse de la reconnaissance sur un catalogue de la taille de Scryfall (35 000 noms)
const perf = await p.evaluate(async () => { const cat = await collCatalog(); const lines = [{ text: 'Craterhoof Behemotl' }, { text: 'Whenever you cast a spell, draw a card.' }, { text: 'Legendary Artifact — Equipment' }]; const t = performance.now(); for (let i = 0; i < 20; i++) bestMatch(lines, cat.idx); return { n: cat.list.length, ms: (performance.now() - t) / 20, m: bestMatch(lines, cat.idx) }; });
console.log(`  catalogue ${perf.n} noms : ${perf.ms.toFixed(1)} ms par lecture`); assert.ok(perf.n > 35000 && perf.ms < 120 && perf.m.name === 'Craterhoof Behemoth'); ok('reconnaissance rapide sur 35 000 noms (< 120 ms)');
assert.ok(cdnHits.some(h => /tesseract\.min\.js/.test(h)) && cdnHits.some(h => /eng\.traineddata\.gz/.test(h)) && cdnHits.some(h => /fra\.traineddata\.gz/.test(h)), 'moteur et modèles chargés à la demande');
const before = cdnHits.length; await p.reload(); await p.waitForTimeout(600);
assert.equal(await p.evaluate(() => typeof Tesseract), 'undefined', 'rien n\'est chargé tant qu\'on ne scanne pas'); assert.equal(cdnHits.length, before);
ok('Tesseract chargé seulement au premier scan');
assert.deepEqual(errs.filter(e => !/WebAssembly|worker/i.test(e)), []);
await ctx.close(); await browser.close();

/* ── B) caméra simulée : aperçu simple, le cercle prend la photo, lecture en arrière-plan ───────────────────── */
// 1. on mesure où tombe le guide dans l'image de la caméra, 2. on fabrique la vidéo (cartes qui passent), 3. on relance avec cette caméra.
const probe = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const pp = await newPage(probe, world, { goto: false, perms: ['camera'] }); await routeCdn(pp.ctx); await pp.p.goto(world.url); await pp.p.waitForTimeout(600);
await toHome(pp.p); await pp.p.click('#btnColl'); await pp.p.waitForSelector('.coll.on'); await pp.p.click('.coll-tools [data-act="scan"]'); await pp.p.waitForSelector('.scan.on'); await pp.p.waitForFunction(() => document.querySelector('.sc-stage').dataset.cam === 'on', null, { timeout: 8000 }); await pp.p.waitForTimeout(500);
const geo = await pp.p.evaluate(() => { const s = document.querySelector('.sc-stage').getBoundingClientRect(), g = document.querySelector('.sc-guide').getBoundingClientRect(); return { cw: s.width, ch: s.height, g: { x: g.left - s.left, y: g.top - s.top, w: g.width, h: g.height } }; });
await pp.p.waitForFunction(() => !SC.warm && !!OCR.workers.fra, null, { timeout: 15000 });
assert.equal(await pp.p.evaluate(() => performance.getEntriesByType('resource').some(r => /tesseract/.test(r.name))), true, 'moteur OCR préparé pendant que tu cadres : le premier appui n\'attend pas son démarrage');
assert.equal(await pp.p.evaluate(() => !!COLL.names), true, 'catalogue des noms chargé d\'avance');
await probe.close();
const VW = 1280, VH = 720, sc = Math.max(geo.cw / VW, geo.ch / VH), ox = (geo.cw - VW * sc) / 2, oy = (geo.ch - VH * sc) / 2;
const box = { x: Math.round((geo.g.x - ox) / sc), y: Math.round((geo.g.y - oy) / sc), w: Math.round(geo.g.w / sc), h: Math.round(geo.g.h / sc) };
console.log('  guide dans l\'image caméra :', JSON.stringify(box));
const TMP = (await import('node:os')).tmpdir() + '/deckdeal-cam'; execFileSync('mkdir', ['-p', TMP]);
const py = `
from PIL import Image
import sys
fx, tmp, bx, by, bw, bh = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
def frame(card):
    im = Image.new('RGB', (1280, 720), (70, 62, 54))
    if card:
        c = Image.open(f'{fx}/{card}'); h = round(bw * c.size[1] / c.size[0]); c = c.resize((bw, h)); im.paste(c, (bx, round(by + bh / 2 - 0.075 * h)))      # la carte déborde du cadre : sa barre de titre tombe au milieu de la bande
    return im
seq = [(None, 6), ('swords.jpg', 14), (None, 5), ('crater.jpg', 12), (None, 5), ('sceau.jpg', 12), (None, 5)]          # cartes qui passent, une image par 0,2 s
n = 0
for card, secs in seq:
    f = frame(card)
    for _ in range(secs * 5):
        f.save(f'{tmp}/f{n:04d}.jpg', quality=90); n += 1
print(n)`;
execFileSync('python3', ['-c', py, FX, TMP, ...Object.values(box).map(String)]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '5', '-i', `${TMP}/f%04d.jpg`, '-vf', 'fps=24', '-c:v', 'mjpeg', '-q:v', '3', `${TMP}/cam.mjpeg`]);      // la caméra simulée lit une image par tick à 24 i/s : on duplique pour que les durées soient réelles
const cam = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${TMP}/cam.mjpeg`] });
const c2 = await newPage(cam, world, { goto: false, perms: ['camera'] }); await routeCdn(c2.ctx); await c2.ctx.addInitScript(() => { window.__noFpsWatch = true; }); await c2.p.goto(world.url); await c2.p.waitForTimeout(600);
await toHome(c2.p); await c2.p.click('#btnColl'); await c2.p.waitForSelector('.coll.on'); await c2.p.click('.coll-tools [data-act="scan"]'); await c2.p.waitForSelector('.scan.on');
await c2.p.waitForFunction(() => document.querySelector('.sc-stage').dataset.cam === 'on', null, { timeout: 8000 });
await c2.p.waitForFunction(() => document.querySelector('.sc-video').videoWidth > 0, null, { timeout: 8000 });
assert.match(await txt(c2.p, '.sc-hint'), /appuie sur le cercle/);
// détecte une carte dans la bande (carte claire sur la table sombre) ; garde les canvas de capture pour vérifier qu'ils sont vidés
await c2.p.evaluate(() => {
  window.__present = () => { const b = scanGuideBox(), c = document.createElement('canvas'); c.width = 32; c.height = 8; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(document.querySelector('.sc-video'), b.x, b.y, b.w, b.h, 0, 0, 32, 8); const d = x.getImageData(0, 0, 32, 8).data; let t = 0; for (let i = 1; i < d.length; i += 4) t += d[i]; return t / 256; };
  window.__caps = []; const o = scanEnqueue; scanEnqueue = j => { window.__caps.push(j.src); return o(j); };
});
const visible = () => c2.p.waitForFunction(() => window.__present() > 90, null, { timeout: 90000 }), gone = () => c2.p.waitForFunction(() => window.__present() < 75, null, { timeout: 90000 });
// 1re carte : deux appuis rapprochés (deux exemplaires), la lecture se fait en arrière-plan et l'aperçu continue
await visible(); await c2.p.click('.sc-shot'); await c2.p.waitForTimeout(500); await c2.p.click('.sc-shot');
const t1 = await c2.p.evaluate(() => ({ pend: document.querySelectorAll('.sc-item.pend').length, cap: SC.cap, time: document.querySelector('.sc-video').currentTime, thumbs: [...document.querySelectorAll('.sc-item.pend .sc-th')].map(i => i.src.length) }));
assert.equal(t1.cap, 2); assert.ok(t1.pend >= 1, 'cartes en attente de lecture dans la liste'); assert.ok(t1.thumbs.every(n => n > 200 && n < 14000), 'vignette minuscule de chaque capture');
await c2.p.waitForTimeout(1500);
const t2 = await c2.p.evaluate(() => ({ time: document.querySelector('.sc-video').currentTime, working: SC.working, paused: document.querySelector('.sc-video').paused }));
assert.ok(t2.time > t1.time + 0.5 && !t2.paused, 'l\'aperçu continue pendant la lecture en arrière-plan (' + t1.time.toFixed(1) + ' → ' + t2.time.toFixed(1) + ')');
// 2e carte puis 3e (en français) : on enchaîne sans attendre la fin des lectures
await gone(); await visible(); await c2.p.click('.sc-shot');
await gone(); await visible(); await c2.p.click('.sc-shot');
await idle(c2.p, 200000);
const fin = await c2.p.evaluate(() => [...SC.items.values()].map(x => [x.name, x.q, x.maybe]));
console.log('  caméra :', fin.map(x => `${x[0]} ×${x[1]}${x[2] ? '?' : ''}`).join(' · '));
assert.deepEqual(fin.map(x => x[0]).sort(), ['Arcane Signet', 'Craterhoof Behemoth', 'Swords to Plowshares'], 'les trois cartes lues, langue devinée (la 3e est en français)');
assert.equal(fin.find(x => x[0] === 'Swords to Plowshares')[1], 2, 'deux appuis = deux exemplaires'); assert.ok(fin.every(x => !x[2]));
const gc = await c2.p.evaluate(() => ({ canvases: window.__caps.filter(Boolean).map(c => c.width + 'x' + c.height), q: SC.queue.length, pend: SC.pend.length, miss: SC.miss.length }));
assert.ok(gc.canvases.length === 4 && gc.canvases.every(d => d === '0x0'), 'photos vidées de la mémoire après la lecture : ' + gc.canvases.join(','));
assert.deepEqual([gc.q, gc.pend, gc.miss], [0, 0, 0]);
assert.ok(!(await c2.p.evaluate(() => JSON.stringify(localStorage))).includes('data:image'), 'aucune photo enregistrée');
assert.equal(await c2.p.evaluate(() => document.querySelector('.sc-video').paused), false);
await c2.p.screenshot({ path: 'shots/scan-3-camera.png' });
await c2.p.click('.scan [data-act="close"]'); await c2.p.waitForTimeout(400);
assert.equal(await c2.p.evaluate(() => SC.stream), null, 'caméra coupée à la fermeture');
ok('caméra : le cercle prend la photo, lecture en arrière-plan sans figer l\'aperçu, 3 cartes enchaînées (la 3e en français), photos vidées');
assert.deepEqual(c2.errs.filter(e => !/WebAssembly|worker/i.test(e)), []);
await cam.close();
// aperçu lent (la caméra simulée tourne à 24 images/s : on relève le seuil à 40 pour déclencher l'alerte) : 1re alerte → qualité réduite ; 2e → bouton « Appareil » mis en avant ; écran de diagnostic
{
  const camS = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${TMP}/cam.mjpeg`] });
  const cs = await newPage(camS, world, { goto: false, perms: ['camera'] }); await routeCdn(cs.ctx); await cs.p.goto(world.url); await cs.p.waitForTimeout(600);
  await cs.p.evaluate(() => { SC.fpsMin = 40; });
  await toHome(cs.p); await cs.p.click('#btnColl'); await cs.p.waitForSelector('.coll.on'); await cs.p.click('.coll-tools [data-act="scan"]'); await cs.p.waitForSelector('.scan.on');
  await cs.p.waitForFunction(() => document.querySelector('.sc-stage').dataset.cam === 'on', null, { timeout: 8000 });
  assert.equal(await cs.p.evaluate(() => document.querySelector('.sc-native').classList.contains('hot')), false, 'au départ : bouton Photo discret');
  // pendant une lecture (OCR) le téléphone est occupé : une image lente ne compte pas
  await cs.p.evaluate(() => { SC.working = true; }); await cs.p.waitForTimeout(8000);
  assert.equal(await cs.p.evaluate(() => SC.slowN), 0, 'aperçu lent pendant une lecture : ignoré'); await cs.p.evaluate(() => { SC.working = false; SC.workEnd = 0; });
  // 1re alerte : la caméra redémarre (nouveau flux, l'aperçu repart), qualité inchangée
  const s0 = await cs.p.evaluate(() => SC.stream.id);
  await cs.p.waitForFunction(() => SC.restarts >= 1, null, { timeout: 30000 });
  const r1 = await cs.p.evaluate(() => ({ same: SC.stream.id, slow: camSlow(), n: SC.slowN }));
  assert.notEqual(r1.same, s0, 'nouveau flux après redémarrage'); assert.equal(r1.slow, false, 'au 1er redémarrage la qualité reste la même');
  await cs.p.waitForTimeout(1200); const tA = await cs.p.evaluate(() => document.querySelector('.sc-video').currentTime); await cs.p.waitForTimeout(800);
  assert.ok(await cs.p.evaluate(t => document.querySelector('.sc-video').currentTime > t, tA), 'l\'aperçu repart après le redémarrage');
  // 2e : redémarrage ; 3e et 4e : redémarrage en qualité réduite (retenue) ; 5e : bouton « Appareil » mis en avant
  await cs.p.waitForFunction(() => SC.slowN >= 3, null, { timeout: 60000 });
  assert.equal(await cs.p.evaluate(() => localStorage.getItem('deckdeal:cam2')), 'slow', 'appareil lent mémorisé');
  await cs.p.waitForFunction(() => SC.slowN >= 5, null, { timeout: 60000 });
  const st = await cs.p.evaluate(() => ({ hot: document.querySelector('.sc-native').classList.contains('hot'), hint: document.querySelector('.sc-hint').textContent, rs: SC.restarts }));
  assert.equal(st.hot, true, 'bouton « Appareil » mis en avant'); assert.match(st.hint, /« Appareil »/); assert.equal(st.rs, 4, 'quatre redémarrages puis on arrête');
  for (let i = 0; i < 5; i++) await cs.p.click('.scan .dv-title b');
  const dg = await cs.p.evaluate(() => { const d = document.querySelector('.sc-diag'); return { hidden: d.hidden, t: d.textContent }; });
  console.log('  diagnostic :', dg.t); assert.equal(dg.hidden, false); assert.match(dg.t, /aperçu .* i\/s/); assert.match(dg.t, /mode lent/); assert.match(dg.t, /redémarrages 4/);
  await cs.p.click('.sc-diag'); assert.equal(await cs.p.evaluate(() => localStorage.getItem('deckdeal:cam2')), null, 'toucher le diagnostic : retour au mode normal');
  await cs.p.click('.scan [data-act="close"]'); await camS.close();
}
ok('caméra lente : 4 redémarrages dont 2 en qualité réduite, bouton « Appareil » ; rien pendant une lecture ; diagnostic (5 appuis sur le titre)');

// plancher de 24 i/s demandé d'abord ; si l'appareil le refuse (OverconstrainedError), repli sur une simple préférence ; l'ancien indicateur « lent » est ignoré
{
  const camF = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${TMP}/cam.mjpeg`] });
  const cf = await newPage(camF, world, { goto: false, perms: ['camera'] }); await routeCdn(cf.ctx);
  await cf.ctx.addInitScript(() => { window.__noFpsWatch = true; window.__req = []; const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = c => { window.__req.push(JSON.stringify(c.video.frameRate)); if (window.__refuseMin && c.video.frameRate.min) { const e = new Error('refusé'); e.name = 'OverconstrainedError'; return Promise.reject(e); } return g(c); }; localStorage.setItem('deckdeal:cam', 'slow'); });
  await cf.p.goto(world.url); await cf.p.waitForTimeout(600);
  const open = async () => { await toHome(cf.p); await cf.p.click('#btnColl'); await cf.p.waitForSelector('.coll.on'); await cf.p.click('.coll-tools [data-act="scan"]'); await cf.p.waitForSelector('.scan.on'); await cf.p.waitForFunction(() => document.querySelector('.sc-stage').dataset.cam === 'on', null, { timeout: 8000 }); };
  await open();
  let r = await cf.p.evaluate(() => ({ req: window.__req, fixed: SC.fixed, old: localStorage.getItem('deckdeal:cam'), slow: camSlow() }));
  assert.deepEqual(r.req, ['{"min":24,"ideal":30}']); assert.equal(r.fixed, true); assert.equal(r.slow, false, 'ancien indicateur « lent » ignoré'); 
  await cf.p.click('.scan [data-act="close"]'); await cf.p.waitForTimeout(400);
  await cf.p.evaluate(() => { window.__refuseMin = true; window.__req = []; });
  await cf.p.click('.coll-tools [data-act="scan"]'); await cf.p.waitForSelector('.scan.on'); await cf.p.waitForFunction(() => document.querySelector('.sc-stage').dataset.cam === 'on', null, { timeout: 8000 });
  r = await cf.p.evaluate(() => ({ req: window.__req, fixed: SC.fixed }));
  assert.deepEqual(r.req, ['{"min":24,"ideal":30}', '{"ideal":30}']); assert.equal(r.fixed, false, 'repli : caméra ouverte sans plancher');
  await cf.p.click('.scan [data-act="close"]'); await camF.close();
}
ok('caméra : plancher 24 i/s demandé d\'abord, repli si refusé');

/* ── C) « Appareil » : photos portrait du téléphone, nom et mana dans le tiers haut ─────────────────────────────── */
{
const py = `
from PIL import Image
import sys
fx, tmp = sys.argv[1], sys.argv[2]
def photo(card, cw, x, y, exif=False, name='p'):
    im = Image.new('RGB', (3024, 4032), (70, 62, 54))                  # photo portrait 12 Mpx, table sombre
    c = Image.open(f'{fx}/{card}'); h = round(cw * c.size[1] / c.size[0]); im.paste(c.resize((cw, h)), (x, y))
    if exif:                                                            # capteur paysage + étiquette EXIF « tourner de 90° » : comme un vrai téléphone
        e = Image.Exif(); e[0x0112] = 6; im = im.rotate(90, expand=True); im.save(f'{tmp}/{name}.jpg', quality=88, exif=e)
    else: im.save(f'{tmp}/{name}.jpg', quality=88)
photo('swords.jpg', 2300, 360, 700, name='p1')                          # carte plus petite que le cadre : titre à 23 % de la hauteur (hors de la bande du haut, dans le tiers haut)
photo('crater.jpg', 2800, 112, 60, name='p2')                           # carte bien cadrée
photo('sceau.jpg', 2700, 160, 120, exif=True, name='p3')                # carte française, photo tournée par EXIF
photo('swords.jpg', 2700, 160, 150, name='p4')                          # un 2e exemplaire
photo('crater.jpg', 2300, 360, 1800, name='p5')                         # titre à 46 % : hors du tiers haut → jamais lu
`;
execFileSync('python3', ['-c', py, FX, TMP]);
const camN = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const cn = await newPage(camN, world, { goto: false }); await routeCdn(cn.ctx);
await cn.p.goto(world.url); await cn.p.waitForTimeout(600);
await toHome(cn.p); await cn.p.click('#btnColl'); await cn.p.waitForSelector('.coll.on'); await cn.p.click('.coll-tools [data-act="scan"]'); await cn.p.waitForSelector('.scan.on');
await cn.p.evaluate(() => { window.__imgs = []; const o = loadImage; loadImage = async f => { const i = await o(f); window.__imgs.push(i); return i; }; });
// on enchaîne : chaque photo arrive pendant que la précédente est encore en lecture
const files = ['p1', 'p2', 'p3', 'p4', 'p5'].map(n => `${TMP}/${n}.jpg`);
await cn.p.setInputFiles('#scCam', files[0]);
const t1 = await cn.p.evaluate(() => ({ pend: SC.pend.map(x => x.label), cap: SC.cap })); assert.deepEqual(t1.pend, ['Carte 1'], 'la photo prise apparaît tout de suite dans la liste, en attente de lecture');
for (const f of files.slice(1)) { await cn.p.setInputFiles('#scCam', f); await cn.p.waitForTimeout(150); }
assert.ok(await cn.p.evaluate(() => SC.pend.length >= 2), 'on enchaîne sans attendre la fin de la lecture');
await idle(cn.p, 280000);
const fin = await cn.p.evaluate(() => [...SC.items.values()].map(x => [x.name, x.q, x.maybe]));
console.log('  Appareil :', fin.map(x => `${x[0]} ×${x[1]}${x[2] ? '?' : ''}`).join(' · '), '· non lu :', (await misses(cn.p)).join(', '));
assert.deepEqual(fin.map(x => x[0]).sort(), ['Arcane Signet', 'Craterhoof Behemoth', 'Swords to Plowshares'], 'les cartes lues (titre dans le tiers haut, photo tournée par EXIF, carte française)');
assert.equal(fin.find(x => x[0] === 'Swords to Plowshares')[1], 2, 'deux photos = deux exemplaires'); assert.ok(fin.every(x => !x[2]));
assert.deepEqual((await misses(cn.p)).map(x => x.replace(/ ·.*$/, '')), ['Carte 5'], 'titre hors du tiers haut : jamais lu (le reste de l\'image ne sert à rien)');
const fr = await cn.p.evaluate(() => ({ imgs: window.__imgs.map(i => [i.naturalWidth, i.naturalHeight, i.getAttribute('src')]), q: SC.queue.length, pend: SC.pend.length, th: [...document.querySelectorAll('.sc-item.miss .sc-th')].map(i => i.src.length) }));
assert.equal(fr.imgs.length, 5); assert.ok(fr.imgs.every(i => i[2] === null), 'photos détachées de la mémoire après la lecture'); assert.ok(fr.imgs.every(i => i[1] === 4032 || i[0] === 0), 'photo tournée par EXIF : redressée en portrait pour la lecture');
assert.deepEqual([fr.q, fr.pend], [0, 0]);
assert.ok(fr.th.every(n => n > 200 && n < 9000), 'vignette minuscule du tiers haut pour la carte non lue (' + fr.th.join(',') + ' car.)');
assert.ok(!(await cn.p.evaluate(() => JSON.stringify(localStorage))).includes('data:image'), 'aucune photo enregistrée');
await cn.p.screenshot({ path: 'shots/scan-3-appareil.png' });
await cn.p.click('.scan [data-act="close"]'); await cn.p.waitForTimeout(400);
ok('« Appareil » : 5 photos portrait enchaînées (titre bas dans le tiers haut, EXIF, français), lecture en arrière-plan, tiers haut seulement, photos vidées');
assert.deepEqual(cn.errs.filter(e => !/WebAssembly|worker/i.test(e)), []);
await camN.close();
}

{ // Appli Android (Capacitor simulé) : aperçu natif derrière la page, image de l'aperçu recadrée sur la bande, lecture ML Kit — aucun moteur Tesseract chargé
  const nat = await newPage(browser, world, { goto: false }); const np = nat.p;
  const jpg = readFileSync(fx('sceau.jpg')).toString('base64');
  await nat.ctx.addInitScript(b64 => {
    window.__nat = { starts: [], stops: 0, ocr: [] };
    window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, Plugins: {
      CameraPreview: { start: async o => { window.__nat.starts.push(o); return {}; }, stop: async () => { window.__nat.stops++; return {}; }, captureSample: async () => ({ value: b64 }) },
      CapacitorPluginMlKitTextRecognition: { detectText: async o => { window.__nat.ocr.push(o.base64Image.length); return { text: 'Sol Ring', blocks: [{ text: 'Sol Ring {1}', lines: [{ text: 'Sol Ring' }, { text: '{1}' }] }] }; } } } };
  }, jpg);
  const hits0 = cdnHits.length;
  await routeCdn(nat.ctx); await np.goto(world.url); await np.waitForTimeout(700);
  await toHome(np); await np.click('#btnColl'); await np.waitForSelector('.coll.on'); await np.click('.coll-tools [data-act="scan"]'); await np.waitForSelector('.scan.on');
  await np.waitForFunction(() => document.querySelector('.sc-stage').dataset.native === '1', null, { timeout: 5000 });
  const st = await np.evaluate(() => window.__nat.starts[0]); assert.equal(st.toBack, true); assert.equal(st.position, 'rear'); assert.ok(st.width > 100 && st.height > 50, 'aperçu placé sur la zone de la page');
  assert.equal(await np.evaluate(() => document.documentElement.classList.contains('nat-cam')), true);
  await np.click('.sc-shot'); await idle(np, 20000);
  assert.deepEqual((await items(np)).map(x => x.name), ['Sol Ring']); assert.ok((await np.evaluate(() => window.__nat.ocr.length)) >= 1, 'texte lu par ML Kit');
  assert.equal(cdnHits.slice(hits0).filter(h => /tesseract/.test(h)).length, 0, 'aucun téléchargement de Tesseract dans l\'appli');
  await np.click('.scan [data-act="close"]'); await np.waitForTimeout(400);
  assert.equal(await np.evaluate(() => [window.__nat.stops, document.documentElement.classList.contains('nat-cam')].join()), '1,false');
  assert.deepEqual(nat.errs, []); await nat.ctx.close();
  ok('appli Android : caméra native derrière la page, bande recadrée, ML Kit (sans Tesseract), caméra rendue à la fermeture');
}

world.stop(); console.log('\nSCAN E2E OK'); process.exit(0);
