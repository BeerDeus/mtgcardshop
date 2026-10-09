// E2E noms français : decklist « 4 Foudre » au prix Cardmarket (vignettes sans requête de plus), import de collection en français (langue des cartes,
// noms inconnus signalés avant et après l'import, feuille « Noms inconnus » : Remplacer / Supprimer), coup d'œil après import, cartes sans langue en une fois,
// saisie « Anneau solaire », tuile de valeur sans CardTrader. Catalogue français : vraies lignes de pwa/fr-names.tsv servies par une route.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium, startWorld, newPage, txt, ok, toInput, toHome, slug } from './e2e-world.mjs';

const SHOTS = process.env.FR_SHOTS || 'shots';
mkdirSync(SHOTS, { recursive: true });
const world = await startWorld({ port: 18915, env: { CARDTRADER_TOKEN: '' } });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });

// catalogue français : les vraies lignes des cartes du test + 600 autres (le site en exige au moins 500)
const ALL = readFileSync('pwa/fr-names.tsv', 'utf8').split('\n').filter(l => l && l[0] !== '#');
const WANT = new Set(['Sol Ring', 'Swords to Plowshares', 'Arcane Signet', 'Wrath of God', 'Craterhoof Behemoth', 'Command Tower', 'Llanowar Elves', "Ranger's Hawk", 'Edgar Markov', 'Lightning Bolt', 'Counterspell', 'Rhystic Study', 'Forked Bolt', 'Forked Lightning', 'Mountain', 'Badlands', 'Desolation']);
const ROWS = [...ALL.filter(r => WANT.has(r.split('\t')[1])), ...ALL.slice(0, 600)];
const solImg = ALL.find(r => r.startsWith('Anneau solaire\tSol Ring\t')).split('\t')[2];
// faux Scryfall : cartes de plus (prix Cardmarket, image), catalogue anglais pour les suggestions
const extra = (n, eur) => { world.prints[n] = [{ id: 's-' + slug(n), set: 'lea', set_name: 'Alpha', collector_number: '1', name: n, cmc: 1, type_line: 'Instant', mana_cost: '{R}', colors: ['R'], prices: { eur }, color_identity: ['R'], legalities: { commander: 'legal' }, image_uris: { small: `https://cards.scryfall.io/small/front/a/b/${slug(n)}.jpg` } }]; };
extra('Lightning Bolt', '0.80'); extra('Rhystic Study', '20.00'); extra('Forked Lightning', '0.30'); extra('Forked Bolt', '0.25'); extra('Counterspell', '1.00');
const baseCat = world.catalog; world.catalog = () => [...baseCat(), 'Lightning Bolt', 'Rhystic Study', 'Mystic Study', 'Forked Bolt', 'Forked Lightning', 'Counterspell'];
// decks EDHREC : Edgar Markov, 21 cartes dont 12 à acheter (1 € chacune) → « à finir pour moins de 60 € »
const EDH = ['#edh\t1\t2026-10-03T04:00:00Z', 'C\tedgar-markov\t12345\tWBR\tEdgar Markov', 'D\tedgar-markov\tedhrec\tDeck moyen\thttps://edhrec.com/average-decks/edgar-markov',
  ...['Sol Ring', 'Arcane Signet', 'Command Tower', 'Swords to Plowshares', 'Wrath of God', 'Llanowar Elves', "Ranger's Hawk", 'Craterhoof Behemoth'].map(n => 'K\t1\t' + n), ...Array.from({ length: 12 }, (_, i) => `K\t1\tFiller ${i}`),
  ...Array.from({ length: 12 }, (_, i) => `P\t100\tFiller ${i}`)].join('\n') + '\n';

const { ctx, p, errs } = await newPage(browser, world, { goto: false, ctx: { colorScheme: 'dark' } });
let frHits = 0;
await ctx.route('**/fr-names.tsv', r => { frHits++; r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: '# fr-names\n' + ROWS.join('\n') + '\n' }); });
await ctx.route('**/edh.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: EDH }));
await p.goto(world.url); await p.waitForTimeout(700); await p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
const settle = () => p.waitForFunction(() => S.run && S.run.status !== 'running', null, { timeout: 30000 });
const sheetGone = () => p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 4000 });

/* ── 1) decklist en français, prix Cardmarket ───────────────────────────────────────────────── */
assert.equal(await p.evaluate(() => FRX.ix), null, 'rien de chargé au démarrage (aucun catalogue sur l\'appareil)'); assert.equal(frHits, 0);
await toInput(p); await p.fill('#deckText', '4 Foudre\n1 Anneau solaire\n1 Retour au pays\n1 Épées en socs de charrue\n1 Éclair fourchu\n2 Montagne\n1 Edgar Markov');
await p.waitForFunction(() => !!FRX.ix, null, { timeout: 8000 }); assert.equal(frHits, 1, 'catalogue français lu une fois, dès la liste collée');
await p.waitForTimeout(200);
assert.match(await txt(p, '#deckStats'), /6 cartes à chercher.*2 terrains de base à part/, 'Montagne = terrain de base');
assert.deepEqual(await p.evaluate(() => S.deck.cards.map(c => [c.key, c.name, c.dn || ''])), [['lightning bolt', 'Lightning Bolt', 'Foudre'], ['sol ring', 'Sol Ring', 'Anneau solaire'], ['swords to plowshares', 'Swords to Plowshares', 'Retour au pays'], ['epees en socs de charrue', 'Épées en socs de charrue', ''], ['eclair fourchu', 'Éclair fourchu', ''], ['edgar markov', 'Edgar Markov', '']]);
ok('decklist : noms français lus (clé et nom anglais pour les prix, nom imprimé pour l\'affichage), « Montagne » = terrain de base');
await p.click('#btnRun'); await settle(); await p.waitForTimeout(900);
assert.match(await txt(p, '#heroAmt'), /11,60/, '4 × 0,80 + 1,50 + 1,90 + 5,00');
const nameOf = k => p.$eval(`.row[data-key="${k}"] .row-name`, e => e.textContent);
assert.equal(await nameOf('lightning bolt'), 'Foudre'); assert.equal(await nameOf('sol ring'), 'Anneau solaire'); assert.equal(await nameOf('swords to plowshares'), 'Retour au pays');
assert.match(await txt(p, '.row[data-key="eclair fourchu"]'), /Nom français de plusieurs cartes : Forked Bolt · Forked Lightning/);
assert.match(await txt(p, '.row[data-key="epees en socs de charrue"]'), /Nom introuvable/);
assert.match(await txt(p, '#alerts'), /Nom introuvable : Épées en socs de charrue, Éclair fourchu/);
await p.waitForFunction(() => document.querySelectorAll('#list .row .thumb img.ok').length >= 4, null, { timeout: 8000 });
assert.equal(await p.$eval('.row[data-key="sol ring"] .thumb img', i => i.getAttribute('src')), 'https://cards.scryfall.io/small/' + solImg, 'recherche en français : vignette de l\'impression française (catalogue)');
await p.evaluate(() => document.querySelector('#recap').scrollIntoView({ block: 'start' })); await p.waitForTimeout(400); await p.screenshot({ path: SHOTS + '/fr-1-decklist.png' });
await p.evaluate(() => { window.__clip = ''; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
await p.click('#btnCart'); await p.waitForTimeout(300);
assert.match(await p.evaluate(() => window.__clip), /^4 Lightning Bolt\n1 Sol Ring\n1 Swords to Plowshares\n/, 'Wants list Cardmarket : noms anglais');
ok('prix Cardmarket : 11,60 €, lignes en français, noms ambigus et inconnus signalés, vignettes, copie Cardmarket en anglais');

// relevé du serveur : plus de lecture Scryfall pour ces cartes → vignettes depuis le catalogue français, aucune requête de plus
await p.route('**/prices.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values', body: '#MOPX1 2026-10-08T09:00:00Z 2\nSol Ring\t120\t100\nLightning Bolt\t70\t60\nSwords to Plowshares\t180\t150\nEdgar Markov\t450\t400\n' }));
world.scry.length = 0; await p.click('#btnBack'); await p.click('#btnRun'); await settle(); await p.waitForTimeout(500);
assert.equal(world.scry.filter(s => /^POST \/cards\/collection/.test(s)).length, 1, 'Scryfall seulement pour les noms absents du relevé');
assert.equal(await p.$eval('.row[data-key="sol ring"] .thumb img', i => i.getAttribute('src')), 'https://cards.scryfall.io/small/' + solImg, 'vignette du catalogue français');
assert.ok(await p.$('.row[data-key="lightning bolt"] .thumb img'), 'Foudre : vignette aussi');
ok('relevé du serveur : vignettes sans requête (catalogue français), au lieu d\'une lettre');

/* ── 1b) appareil neuf, sans catalogue français ni collection : vignettes lues en arrière-plan après les prix, gardées ensuite ─── */
{
  const b = await newPage(browser, world, { goto: false }), q = b.p;
  await q.route('**/prices.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values', body: '#MOPX1 2026-10-08T09:00:00Z 4\nSol Ring\t120\t100\nCraterhoof Behemoth\t800\t950\nArcane Signet\t30\t20\nWrath of God\t140\t120\n' }));
  await q.goto(world.url); await q.waitForTimeout(700);
  world.scry.length = 0;
  await toInput(q); await q.fill('#deckText', '1 Sol Ring\n2 Craterhoof Behemoth\n1 Arcane Signet\n1 Wrath of God'); await q.waitForTimeout(250); await q.click('#btnRun');
  await q.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 20000 });
  await q.waitForFunction(() => document.querySelectorAll('#list .row').length === 4 && document.querySelectorAll('#list .row .thumb img.ok').length === 4, null, { timeout: 8000 });
  assert.equal(world.scry.filter(s => /^POST \/cards\/collection/.test(s)).length, 1, 'une requête Scryfall en arrière-plan pour les 4 vignettes (prix déjà là)');
  assert.equal(await q.$eval('.row[data-key="craterhoof behemoth"] .thumb img', i => i.getAttribute('src')), 'https://cards.scryfall.io/small/front/a/b/craterhoof-behemoth.jpg');
  await q.click('.row[data-key="wrath of god"] .thumb'); await q.waitForSelector('.imgv', { timeout: 4000 }); assert.equal(await q.$eval('.imgv-cap b', e => e.textContent), 'Wrath of God');
  await q.keyboard.press('Escape'); await q.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 });
  world.scry.length = 0; await q.click('#btnBack'); await q.click('#btnRun'); await q.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 20000 }); await q.waitForTimeout(600);
  assert.equal(await q.$$eval('#list .row .thumb img', i => i.length), 4); assert.equal(world.scry.filter(s => /^POST \/cards\/collection/.test(s)).length, 0, 'images gardées : la vérification suivante ne coûte rien');
  assert.deepEqual(b.errs, []); await b.ctx.close();
  ok('appareil neuf : prix d\'abord, puis 4 vignettes en 1 requête Scryfall, carte en grand au toucher, images gardées (0 requête ensuite)');
}

/* ── 2) import de collection en français : langue des cartes, noms à vérifier avant l'import ─────── */
await p.click('#btnBack'); await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
await p.click('.coll-tools [data-act="import"]'); await p.waitForSelector('#ciText');
assert.equal(await p.$eval('#ciLang', s => s.value), 'fr', 'langue de ces cartes : celle de l\'interface');
const LIST = ['2 Anneau solaire', '1 Retour au pays', '1 Cachet d\'ésotérisme', '1 Colère de Dieu', '1 Béhémoth caveur de cratères', '1 Tour de commandement', '1 Elfes de Llanowar', '1 Faucon du rôdeur', '1 Edgar Markov', '1 Foudre', '1 Rhystik Study', '1 Éclair fourchu'];
await p.fill('#ciText', LIST.join('\n'));
await p.waitForFunction(() => !document.querySelector('#ciFlag').hidden, null, { timeout: 8000 });
assert.match(await txt(p, '#ciSum'), /^12 cartes différentes · 13 exemplaires Liste texte · 9 noms français reconnus$/);
assert.equal(await p.$eval('#ciSum', e => e.children[0].tagName + ' ' + e.children.length), 'DIV 2', 'résumé : une ligne pour les nombres, une pour le détail');
assert.match(await txt(p, '#ciFlag'), /2 noms inconnus de Scryfall : Rhystik Study, Éclair fourchu \(nom français de plusieurs cartes\)\. Tu pourras les corriger après l'import\./);
await p.evaluate(() => document.querySelector('#ciLang').scrollIntoView({ block: 'center' })); await p.waitForTimeout(250);
await p.screenshot({ path: SHOTS + '/fr-3-import-langue.png' });
ok('import : langue des cartes (français par défaut), 9 noms français reconnus, 2 noms inconnus signalés avant l\'import');

/* ── 3) coup d'œil après l'import ──────────────────────────────────────────────────────────── */
await p.click('#ciGo'); await p.waitForSelector('.sheet-wrap.open .gl-tiles', { timeout: 5000 });
assert.match(await txt(p, '.sheet-wrap.open .sheet-head'), /Ta collection en un coup d'œil.*12 cartes importées/);
await p.waitForFunction(() => /Béhémoth/.test((document.querySelector('.gl-top') || {}).textContent || '') && document.querySelector('.gl-edh'), null, { timeout: 10000 });
assert.equal(await p.$$eval('.gl-tiles > div b', b => b.map(x => x.textContent.replace(/\s+/g, ' ')).join('|')), '12|13|22,10 €', '2 × 1,50 + 1,90 + 0,40 + 1,50 + 9,00 + 0,25 + 0,20 + 0,05 + 5,00 + 0,80 (10 cartes chiffrées)');
assert.match(await txt(p, '.gl-top'), /Béhémoth caveur de cratères 9,00 €/, 'la plus chère, sous son nom français');
assert.match(await txt(p, '.gl-edh'), /1 deck EDHREC à moins de 60 € de finir Voir ces decks/);
await p.waitForTimeout(400); await p.screenshot({ path: SHOTS + '/fr-4-coup-d-oeil.png' });
await p.click('.gl-edh [data-g="decks"]'); await sheetGone();
assert.equal(await p.evaluate(() => [COLL.tab, EDH.budget, EDH.sort].join()), 'decks,6000,have'); await p.waitForSelector('.crow.dk');
assert.match(await txt(p, '.crow.dk'), /Edgar Markov/);
await p.click('#collSeg [data-v="list"]'); await p.waitForSelector('.crow');
ok('coup d\'œil : cartes, exemplaires, valeur, la plus chère, 1 deck EDHREC à finir pour moins de 60 € → onglet Decks filtré');

/* ── 4) collection : noms français, noms inconnus signalés et corrigés ───────────────────────── */
assert.equal(await p.$eval('.crow[data-k="sol ring"] .row-name', e => e.textContent), 'Anneau solaire', 'exemplaire français : nom imprimé');
assert.equal(await p.evaluate(() => [COLL.map['sol ring'].l, COLL.map['lightning bolt'].l, COLL.map['edgar markov'].l].join()), 'fr,fr,fr');
await p.waitForFunction(() => /2 noms inconnus/.test(document.querySelector('.coll-status').textContent), null, { timeout: 8000 });
assert.equal(await p.$eval('.coll-status', e => e.dataset.k), 'warn');
await p.click('.coll-status [data-act="unknown"]'); await p.waitForSelector('.uk-row .uk-opt', { timeout: 8000 });
await p.waitForFunction(() => document.querySelectorAll('.uk-row').length === 2 && [...document.querySelectorAll('.uk-sug')].every(s => !s.querySelector('.hint')), null, { timeout: 8000 });
const sugs = Object.fromEntries(await p.$$eval('.uk-row', r => r.map(x => [x.querySelector('.uk-top b').textContent, [...x.querySelectorAll('.uk-opt')].map(o => o.innerText.replace(/\s+/g, ' ').trim())])));
assert.equal(sugs['Rhystik Study'][0], 'Rhystic Study', 'faute de frappe : Rhystic Study d\'abord');
assert.deepEqual(sugs['Éclair fourchu'].slice(0, 2), ['Éclair fourchu Forked Bolt', 'Éclair fourchu Forked Lightning'], 'nom français de deux cartes : les deux proposées');
await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/fr-2-noms-inconnus.png' });
await p.click('.uk-row[data-k="rhystik study"] [data-uk="rep"]'); await p.waitForSelector('#toast.on .toast-act'); assert.match(await txt(p, '#toast'), /Rhystik Study → Rhystic Study/);
await p.click('.uk-row[data-k="eclair fourchu"] .uk-opt:nth-child(2)'); assert.equal(await p.$eval('.uk-row[data-k="eclair fourchu"] .uk-opt:nth-child(2)', b => b.getAttribute('aria-checked')), 'true');
await p.click('.uk-row[data-k="eclair fourchu"] [data-uk="rep"]'); await sheetGone(); assert.match(await txt(p, '#toast'), /Éclair fourchu → Forked Lightning/);
assert.equal(await p.evaluate(() => [!!COLL.map['rhystik study'], !!COLL.map['eclair fourchu'], COLL.map['rhystic study'].l, COLL.map['forked lightning'].l, COLL.map['forked lightning'].q].join()), 'false,false,fr,fr,1');
await p.waitForFunction(() => document.querySelector('.coll-status').hidden || !/inconnu/.test(document.querySelector('.coll-status').textContent), null, { timeout: 8000 });
await p.click('#toast .toast-act'); await p.waitForFunction(() => !!COLL.map['eclair fourchu'] && !COLL.map['forked lightning']);
ok('noms inconnus : « 2 noms inconnus · Corriger », noms proches (faute de frappe, nom français ambigu), Remplacer, Annuler');
await p.waitForFunction(() => /1 nom inconnu/.test(document.querySelector('.coll-status').textContent), null, { timeout: 8000 });
await p.click('.coll-status [data-act="unknown"]'); await p.waitForSelector('.uk-row [data-uk="del"]'); await p.click('.uk-row [data-uk="del"]'); await sheetGone();
assert.equal(await p.evaluate(() => !!COLL.map['eclair fourchu']), false); assert.match(await txt(p, '#toast'), /Éclair fourchu retirée de la collection/);
ok('Supprimer : la ligne inconnue sort de la collection (annulable)');

/* ── 5) cartes sans langue → en une fois ; saisie « Anneau solaire » ──────────────────────────── */
await p.click('.coll-tools [data-act="import"]'); await p.waitForSelector('#ciText'); await p.selectOption('#ciLang', ''); await p.fill('#ciText', '2 Counterspell'); await p.waitForTimeout(200); await p.click('#ciGo'); await sheetGone();
await p.waitForSelector('.coll-nolang'); assert.match(await txt(p, '.coll-nolang'), /^1 carte sans langue → Français Anglais/);
await p.click('.coll-nolang [data-l="en"]'); await p.waitForFunction(() => !document.querySelector('.coll-nolang'));
assert.equal(await p.evaluate(() => COLL.map.counterspell.l), 'en'); assert.match(await txt(p, '#toast'), /1 carte passée en anglais/);
ok('« 1 carte sans langue → Anglais » : en une fois, annulable');
await p.click('.coll-tools [data-act="add"]'); await p.waitForSelector('#caName'); await p.fill('#caName', 'anneau sol');
await p.waitForSelector('.ca-opt'); assert.equal(await p.$eval('.ca-opt span', s => s.innerText.replace(/\s+/g, ' ').trim()), 'Anneau solaire Sol Ring');
await p.click('.ca-opt'); await p.waitForTimeout(250); assert.match(await txt(p, '#caStatus'), /Anneau solaire · 3 dans ta collection/);
assert.deepEqual(await p.evaluate(() => COLL.map['sol ring'].l), 'fr', 'nom français choisi : exemplaire français');
await p.fill('#caName', 'Retour au'); await p.waitForSelector('.ca-opt'); assert.match(await txt(p, '.ca-opt'), /Retour au pays Swords to Plowshares/);
await p.keyboard.press('Escape'); await sheetGone();
ok('« Ajouter une carte » : « anneau sol » propose Anneau solaire (Sol Ring), ajoutée en français');

/* ── 6) Stats : CardTrader indisponible et aucun prix lu → pas de bascule CT / CM ──────────────── */
await p.click('#collSeg [data-v="stats"]'); await p.waitForSelector('.cs-tiles');
assert.equal(await p.$eval('.cs-val', e => [e.classList.contains('ro'), e.hasAttribute('data-act'), !!e.querySelector('.cs-src')].join()), 'true,false,false');
assert.doesNotMatch(await txt(p, '.cs-tiles'), /CT|touche pour changer/); assert.match(await txt(p, '.cs-val'), /valeur · tendance Cardmarket/);
ok('Stats : sans CardTrader ni prix lu, la tuile ne montre que la valeur Cardmarket');

assert.deepEqual(errs, []); await browser.close(); world.stop();
console.log('\nFRNAMES E2E OK'); process.exit(0);
