// E2E « carte en grand » : chaque vignette de carte s'ouvre en grand (toucher, Entrée, Espace), avec précédente / suivante dans la liste affichée,
// et le reste de la ligne garde son action. Résultats CardTrader et Cardmarket, deck viewer, collection, Stats (plus chères, variations),
// échange, page publique, scan (liste, fiche « Ajouter », prix rapide), éditeur de deck. Vignette sans image : la carte est chargée par son nom.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, startWorld, newPage, done, txt, ok, toInput, toHome } from './e2e-world.mjs';

const SHOTS = process.env.ZOOM_SHOTS || 'shots';      // captures 390 px, sombre (ZOOM_SHOTS : autre dossier)
mkdirSync(SHOTS, { recursive: true });
const world = await startWorld({ port: 18994 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const COLLTXT = '5 Sol Ring *FR*\n2 Swords to Plowshares\n1 Wrath of God *DE*\n3 Llanowar Elves *EN*\n1 Craterhoof Behemoth\n12 Plains';
const seed = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: ${JSON.stringify(COLLTXT)}, u: 1, s: '', b: null })); } catch (e) {}`;
const { p, errs } = await newPage(browser, world, { init: seed, ctx: { colorScheme: 'dark' } });
{ // images factices lisibles sur les captures : cadre de carte avec le nom (ou l'extension et le numéro) et la langue tirés de l'adresse
  const card = u => {
    const named = u.searchParams.get('exact'), seg = decodeURIComponent(u.pathname.split('/').pop().replace(/\.\w+$/, '')), lang = (/\/front\/([a-z]{2})\//.exec(u.pathname) || [])[1] || '';
    const label = (named || (/^\d+-[a-z]+$/.test(seg) ? u.pathname.split('/')[3].toUpperCase() + ' ' + seg.replace('-', ' · ').toUpperCase() : seg.replace(/-v\d+$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))) + (lang && lang !== 'a' ? ' · ' + lang.toUpperCase() : '');
    let h = 0; for (const c of label) h = (h * 31 + c.charCodeAt(0)) % 360;
    const t = label.replace(/[<&]/g, ''), fs = t.length > 22 ? 26 : 34;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="936" viewBox="0 0 672 936"><rect width="672" height="936" rx="34" fill="#17181d"/><rect x="26" y="26" width="620" height="884" rx="22" fill="hsl(${h} 28% 34%)"/><rect x="50" y="56" width="572" height="66" rx="10" fill="#ece5d2"/><text x="70" y="101" font-family="sans-serif" font-size="${fs}" font-weight="700" fill="#1d1d1f">${t}</text><rect x="50" y="138" width="572" height="430" rx="6" fill="hsl(${h} 50% 52%)"/><circle cx="336" cy="356" r="128" fill="hsl(${(h + 50) % 360} 70% 72%)" opacity=".85"/><rect x="50" y="586" width="572" height="296" rx="10" fill="#ece5d2"/><rect x="80" y="620" width="400" height="16" rx="8" fill="#b9b2a0"/><rect x="80" y="652" width="470" height="16" rx="8" fill="#b9b2a0"/><rect x="80" y="684" width="330" height="16" rx="8" fill="#b9b2a0"/></svg>`;
  };
  const svg = route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'image/svg+xml', body: card(new URL(route.request().url())) });
  await p.route('https://cards.scryfall.io/**', svg);
  await p.route(u => u.hostname === 'api.scryfall.com' && u.pathname === '/cards/named' && u.searchParams.get('format') === 'image', svg);
}
// catalogue des noms français (« Anneau solaire » → Sol Ring) ; il n'est accepté qu'à partir de 500 noms
const FRCAT = ['# fr-names', 'Anneau solaire\tSol Ring\tfront/fr/sol-ring.jpg', ...Array.from({ length: 600 }, (_, i) => `Vrombl ${i}\tVrombl Card ${i}\t`)].join('\n') + '\n';
await p.route(world.url + 'fr-names.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: FRCAT }));

const viewer = async () => ({ name: await txt(p, '.imgv.on .imgv-cap b'), count: (await p.$('.imgv.on .imgv-count')) ? await txt(p, '.imgv.on .imgv-count') : '1 / 1', lang: await txt(p, '.imgv.on .imgv-lang') });
const closeV = async () => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 }); };
/** Touche sel (au doigt) et attend la carte en grand. */
const into = async sel => { await p.$eval(sel, e => e.scrollIntoView({ block: 'center', behavior: 'instant' })); await p.waitForTimeout(60); return p.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); };      // défilement immédiat (la page défile en douceur)
const tap = async sel => { const r = await into(sel); await p.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2); await p.waitForSelector('.imgv.on', { timeout: 4000 }); await p.waitForTimeout(150); return viewer(); };
/** La vignette est un bouton au clavier : rôle, tabindex, nom lu ; Entrée l'ouvre et le focus y revient à la fermeture. */
async function keyboard(sel, name, key = 'Enter') {
  const a = await p.$eval(sel, e => [e.getAttribute('role'), e.tabIndex, e.getAttribute('aria-label')]);
  assert.deepEqual(a, ['button', 0, 'Agrandir ' + name], 'vignette accessible : ' + sel);
  await p.focus(sel); await p.keyboard.press(key); await p.waitForSelector('.imgv.on', { timeout: 4000 });
  assert.equal(await txt(p, '.imgv.on .imgv-cap b'), name, key + ' ouvre ' + name);
  await closeV(); await p.waitForTimeout(80);
  assert.equal(await p.evaluate(s => document.activeElement === document.querySelector(s), sel), true, 'le focus revient sur la vignette');
}

/* ── 1) Résultats CardTrader : vignette → carte en grand (offre française), reste de la ligne → fiche des offres ─────────────── */
await toInput(p); await p.evaluate(() => { const o = $('#optColl'); if (o.checked) o.click(); });
await p.fill('#deckText', '1 Sol Ring\n1 Craterhoof Behemoth\n1 Arcane Signet\n1 Carte Qui N Existe Pas'); await p.waitForTimeout(250);
await p.click('#btnRun'); await done(p);
await p.waitForSelector('.row[data-key="craterhoof behemoth"] .thumb img.ok', { timeout: 8000 });
let v = await tap('.row[data-key="craterhoof behemoth"] .thumb');
assert.equal(v.name, 'Craterhoof Behemoth'); assert.match(v.lang, /français/); assert.match(v.count, /^\d \/ 3$/, 'précédente / suivante parmi les 3 cartes trouvées (nom introuvable exclu)');
await p.click('.imgv-nav.next:not([disabled]), .imgv-nav.prev:not([disabled])'); await p.waitForTimeout(150); assert.notEqual(await txt(p, '.imgv-cap b'), 'Craterhoof Behemoth', 'on passe à la carte voisine');
await closeV();
await p.click('.row[data-key="craterhoof behemoth"] .row-name'); await p.waitForSelector('.sheet-wrap.open .offer'); assert.equal(!!(await p.$('.imgv')), false, 'le reste de la ligne ouvre la fiche des offres, pas la carte en grand');
await p.keyboard.press('Escape'); await p.waitForTimeout(350);
await keyboard('.row[data-key="sol ring"] .thumb', 'Sol Ring'); await keyboard('.row[data-key="sol ring"] .thumb', 'Sol Ring', ' ');
assert.equal(!!(await p.$('.sheet-wrap.open')), false, 'Entrée / Espace sur la vignette n\'ouvrent pas la fiche de la ligne');
assert.equal(await p.$eval('.row[data-key="carte qui n existe pas"] .thumb', e => e.hasAttribute('data-zoom')), false, 'nom introuvable : rien à agrandir');
{ // zone de toucher ≥ 44 px : un appui juste à côté de l'image compte
  const r = await into('.row[data-key="arcane signet"] .thumb');
  await p.touchscreen.tap(r.x - 3, r.y + r.h / 2); await p.waitForSelector('.imgv.on', { timeout: 3000 }); assert.equal(await txt(p, '.imgv-cap b'), 'Arcane Signet'); await closeV();
  const hit = await p.$eval('.row[data-key="arcane signet"] .thumb', e => { const s = getComputedStyle(e, '::before'), b = e.getBoundingClientRect(); return [b.width - 2 * parseFloat(s.left), b.height - 2 * parseFloat(s.top)]; });
  assert.ok(hit[0] >= 44 && hit[1] >= 44, 'zone de toucher ' + hit.join(' × '));
}
await p.waitForTimeout(400); await p.screenshot({ path: SHOTS + '/zoom-1-resultats.png' });
ok('résultats CardTrader : vignette → carte en grand (français, voisines), ligne → fiche des offres, Entrée / Espace, zone de 48 × 64 px');

/* ── 2) Deck viewer : tuile sans image (terrain de base) → la carte par son nom ─────────────────────── */
await p.evaluate(() => openDeckViewer({ text: '1 Sol Ring\n1 Arcane Signet\n10 Plains', name: 'Test' })); await p.waitForSelector('.dv.on .dvc');
v = await tap('.dv.on .dvc[aria-label^="Sol Ring"]'); assert.equal(v.name, 'Sol Ring');
await closeV();
assert.equal(await p.$eval('.dv.on .dvc[data-s="basic"] img', () => 1).catch(() => 0), 0, 'Plains sans image dans ce monde de test');
v = await tap('.dv.on .dvc[data-s="basic"]'); assert.equal(v.name, 'Plains'); assert.match(await p.$eval('.imgv-ph', i => i.src), /api\.scryfall\.com\/cards\/named\?exact=Plains&format=image&version=small/, 'image par le nom');
await closeV(); await p.evaluate(() => closeDeckViewer()); await p.waitForTimeout(300);
ok('deck viewer : tuile → carte en grand ; terrain sans image → la carte par son nom (rien ne se passait)');

/* ── 3) Résultats Cardmarket (ni extension ni numéro) : la carte en grand dans la langue de la recherche, cherchée par le nom ─────────────── */
await p.click('#btnBack'); await p.waitForSelector('#segSrcRun'); await p.click('#segSrcRun [data-v="cm"]'); await p.waitForTimeout(150);
await p.click('#btnRun'); await p.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 30000 }); await p.waitForTimeout(500);
v = await tap('.row[data-key="craterhoof behemoth"] .thumb'); assert.equal(v.name, 'Craterhoof Behemoth'); assert.match(v.count, /^\d \/ 3$/);
await p.waitForFunction(() => /\/fr\/craterhoof-behemoth/.test((document.querySelector('.imgv-img.ok') || {}).src || ''), null, { timeout: 8000 }); assert.match(await txt(p, '.imgv-lang'), /français/, 'version française cherchée par le nom');
await p.waitForTimeout(500); await p.screenshot({ path: SHOTS + '/zoom-2-cardmarket.png' });
await closeV();
await p.click('.row[data-key="craterhoof behemoth"] .row-name'); await p.waitForSelector('.sheet-wrap.open .cm-price'); assert.equal(!!(await p.$('.imgv')), false, 'le reste de la ligne : fiche Cardmarket');
await p.keyboard.press('Escape'); await p.waitForTimeout(350);
ok('résultats Cardmarket : vignette → carte en grand en français (cherchée par le nom) ; ligne → fiche du prix (avant : la fiche, jamais la carte)');

/* ── 4) Collection : liste, Stats (plus chères, variations des prix) ─────────────────────────── */
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
await p.waitForFunction(() => document.querySelectorAll('.coll .crow .thumb img.ok').length >= 4, null, { timeout: 10000 });
const solFr = await p.evaluate(() => frName('sol ring', 'fr') || 'Sol Ring');      // nom imprimé de l'exemplaire français, comme la ligne
v = await tap('.coll .crow[data-k="sol ring"] .thumb'); assert.equal(v.name, solFr); assert.equal(v.name, await txt(p, '.coll .crow[data-k="sol ring"] .row-name')); assert.match(v.lang, /français/, 'exemplaire français : carte en français'); assert.match(v.count, /\/ 6$/, 'toutes les lignes affichées');
await closeV();
await keyboard('.coll .crow[data-k="wrath of god"] .thumb', 'Wrath of God');
v = await tap('.coll .crow[data-k="wrath of god"] .thumb');      // exemplaire allemand, sans image allemande chez ce faux Scryfall : la note nomme l'allemand (plus « française »)
await p.waitForFunction(() => /Pas d'image en allemand sur Scryfall : version anglaise/.test(document.querySelector('.imgv-sub').textContent), null, { timeout: 6000 });
assert.doesNotMatch(await txt(p, '.imgv-sub'), /française/); await closeV();
await p.click('.coll .crow[data-k="wrath of god"] .qstep [data-d="1"]'); await p.waitForTimeout(200);
assert.equal(await txt(p, '.coll .crow[data-k="wrath of god"] .qstep b'), '2', 'le « + » de la ligne marche toujours'); assert.equal(!!(await p.$('.imgv')), false);
await p.click('#collSeg [data-v="stats"]'); await p.waitForSelector('.cs-top .crow .thumb[data-zoom]'); await p.waitForTimeout(400);
v = await tap('.cs-top .crow .thumb'); assert.equal(v.name, 'Craterhoof Behemoth', 'Les plus chères : la première'); assert.match(v.count, /^1 \/ \d$/);
await closeV();
await p.evaluate(() => { const now = Date.now(); VAL.base = { cur: { t: now - 8 * 864e5, p: { 'sol ring': 100, 'craterhoof behemoth': 600 } }, prev: null }; VAL.at = now; VAL.memo = null; collPaintBody(true); });
await p.waitForSelector('.vl-top .crow .thumb[data-zoom]');
v = await tap('.vl-top .crow[data-k="sol ring"] .thumb'); assert.equal(v.name, solFr); assert.match(v.lang, /français/); assert.match(v.count, /\/ 2$/, 'variations : les deux cartes qui ont bougé');
await closeV();
ok('collection : liste (exemplaire français montré en français, 6 lignes), exemplaire allemand : « Pas d\'image en allemand », « + » intact, Stats « Les plus chères » et « Variations des prix »');

/* ── 5) Échange : doublons ─────────────────────────────────────────────────────────────────── */
await p.click('#collSeg [data-v="trade"]'); await p.waitForSelector('.tr-list .tr-row .thumb[data-zoom]'); await p.waitForTimeout(400);
const trName = await txt(p, '.tr-list .tr-row:first-child .row-name');
v = await tap('.tr-list .tr-row:first-child .thumb'); assert.equal(v.name, trName);
await closeV(); await keyboard('.tr-list .tr-row:first-child .thumb', trName);
ok('liste d\'échange : vignette → carte en grand, au clavier aussi');
await p.click('#collSeg [data-v="list"]'); await p.waitForTimeout(200); await p.evaluate(() => closeCollection()); await p.waitForTimeout(300);

/* ── 6) Page publique d'une liste d'échange (aperçu) : la ligne entière, au doigt et au clavier ─────────── */
await p.evaluate(() => { const pl = trPayload(); openPublicTrade(readShare('trade', { ...pl, ...profShare(), at: Date.now() }), true); });
await p.waitForSelector('.pubv.on .pub-row[data-zoom]'); await p.waitForTimeout(500);
const pubName = await txt(p, '.pubv.on .pub-row:first-child .row-name');
v = await tap('.pubv.on .pub-row:first-child .thumb'); assert.equal(v.name, pubName); await closeV();
await p.focus('.pubv.on .pub-row:first-child'); await p.keyboard.press('Enter'); await p.waitForSelector('.imgv.on', { timeout: 3000 });
assert.equal(await txt(p, '.imgv-cap b'), pubName, 'Entrée sur une ligne de la page publique (rien ne se passait)'); await closeV();
await p.evaluate(() => TR.pub.el.__close()); await p.waitForTimeout(300);
ok('page publique : la ligne ouvre la carte en grand, Entrée aussi');

/* ── 7) Scan : liste, fiche « Ajouter » (les plus chères), prix rapide ─────────────────────────── */
await p.evaluate(() => openScan()); await p.waitForSelector('.sc-list'); await p.waitForTimeout(300);
await p.evaluate(() => { scanAdd({ key: 'sol ring', name: 'Sol Ring', score: 0.99, raw: 'Sol Ring', card: 'en' }, 1, false); scanAdd({ key: 'craterhoof behemoth', name: 'Craterhoof Behemoth', score: 0.99, raw: 'Craterhoof', card: 'en' }, 2, false); });
await p.waitForSelector('.sc-item[data-k="sol ring"] .sc-th[data-zoom]');
v = await tap('.sc-item[data-k="sol ring"] .sc-th'); assert.equal(v.name, 'Sol Ring'); assert.equal(v.count, '2 / 2'); await closeV();
await keyboard('.sc-item[data-k="craterhoof behemoth"] .sc-th', 'Craterhoof Behemoth');
assert.ok(await p.$eval('.sc-item[data-k="sol ring"] .sc-th', e => { const b = e.getBoundingClientRect(); return b.width >= 44 && b.height >= 44; }), 'zone de toucher de la miniature ≥ 44 px');
await p.click('.dv-foot [data-act="done"]'); await p.waitForSelector('.rc-sheet .cs-top .thumb[data-zoom]', { timeout: 8000 }); await p.waitForTimeout(300);
v = await tap('.rc-sheet .cs-top .crow:first-child .thumb'); assert.equal(v.name, 'Craterhoof Behemoth'); assert.equal(v.count, '1 / 2');
assert.match(await txt(p, '.imgv-extra'), /2 exemplaires/);
await p.waitForTimeout(500); await p.screenshot({ path: SHOTS + '/zoom-3-scan.png' });
await closeV(); assert.ok(await p.$('.rc-sheet'), 'Échap ferme la carte, pas la fiche'); await p.keyboard.press('Escape'); await p.waitForTimeout(350);
await p.evaluate(() => { scanPriceMode(true); SC.pq = [{ key: 'sol ring', name: 'Sol Ring', l: '', n: 1, cm: 1.5, ct: 'off' }, { key: 'arcane signet', name: 'Arcane Signet', l: '', n: 1, cm: 0.4, ct: 'off' }]; scanPaintList(); });
v = await tap('.sc-item.pr[data-k="arcane signet"] .sc-th'); assert.equal(v.name, 'Arcane Signet'); assert.equal(v.count, '2 / 2'); await closeV();
await p.evaluate(() => SC.el.__close()); await p.waitForTimeout(300);
ok('scan : miniatures (liste, prix rapide) au doigt et au clavier, zone ≥ 44 px ; fiche « Ajouter » : les plus chères s\'ouvrent en grand (rien avant)');

/* ── 8) Nom tapé en français (« Anneau solaire ») : la carte en grand le garde en titre ; image et Scryfall sur le nom anglais ─────── */
await toInput(p); await p.fill('#deckText', '1 Anneau solaire\n1 Arcane Signet');
await p.waitForFunction(() => S.deck.cards.some(c => c.dn === 'Anneau solaire'), null, { timeout: 10000 });
await p.click('#btnRun'); await p.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 30000 }); await p.waitForTimeout(400);
v = await tap('.row[data-key="sol ring"] .thumb'); assert.equal(v.name, 'Anneau solaire', 'résultats : titre = nom tapé');
assert.match(await p.$eval('.imgv-ph', i => i.src), /sol-ring|Sol%20Ring/, 'image lue sur le nom anglais'); await closeV();
await p.evaluate(() => openDeckViewer({ text: '1 Anneau solaire\n1 Arcane Signet', name: 'FR' })); await p.waitForSelector('.dv.on .dvc');
v = await tap('.dv.on .dvc[aria-label^="Sol Ring"]'); assert.equal(v.name, 'Anneau solaire', 'deck viewer : titre = nom tapé'); await closeV();
await p.evaluate(() => closeDeckViewer()); await p.waitForTimeout(300);
ok('nom tapé en français : « Anneau solaire » en titre de la carte en grand (résultats, deck viewer), image sur le nom anglais');

/* ── 9) Éditeur de deck ────────────────────────────────────────────────────────────────────── */
await toHome(p); await p.click('#btnDecks'); await p.waitForSelector('.dks.on'); await p.click('#btnNewDeck'); await p.waitForSelector('#ndName');
await p.fill('#ndName', 'Zoom'); await p.click('#ndFmt .seg-opt[data-v="standard"]'); await p.click('#ndGo'); await p.waitForSelector('.bd.on');
await p.click('#bdSeg .seg-opt[data-v="coll"]');
await p.waitForSelector('.bd-row[data-k="wrath of god"] .thumb[data-zoom]', { timeout: 8000 });
v = await tap('.bd-row[data-k="wrath of god"] .thumb'); assert.equal(v.name, 'Wrath of God'); await closeV();
await keyboard('.bd-row[data-k="wrath of god"] .thumb', 'Wrath of God');
await p.click('.bd-row[data-k="wrath of god"] [data-d="1"]'); await p.waitForTimeout(150); assert.equal(await txt(p, '.bd-row[data-k="wrath of god"] .qstep b'), '1', 'le « + » de la ligne marche toujours');
ok('éditeur de deck : vignette au doigt et au clavier, « + » intact');

assert.deepEqual(errs, [], 'erreurs page : ' + errs.join(' | '));
await browser.close(); world.stop();
console.log('ZOOM E2E OK'); process.exit(0);
