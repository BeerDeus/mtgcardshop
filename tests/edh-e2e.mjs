// E2E commandants : filtre « Commander » de l'onglet Cartes (éligibles / joués EDHREC), onglet « Decks » (classement selon la collection,
// filtres, feuille d'un deck), chargement du deck dans la page de saisie, cache, fichier absent ; interrupteurs du serveur (/__ping off : Archidekt, EDHREC).
// Faux edh.tsv servi par une route Playwright.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toInput, toHome, signInFake } from './e2e-world.mjs';

const world = await startWorld({ port: 18930 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const { p, errs } = await newPage(browser, world);
await signInFake(p);      // onglet « Decks » : réservé aux comptes vérifiés (gate-e2e)

/* fichier : Edgar Markov (WBR, 12 345 decks) · paire Tymna + Thrasios (WUBG) · Craterhoof (G, 100 decks) — decks de ≥ 20 cartes */
const filler = (n, from = 0) => Array.from({ length: n }, (_, i) => `K\t1\tFiller ${from + i}`);
const FILE = ['#edh\t1\t2026-10-03T04:00:00Z',
  'C\tedgar-markov\t12345\tWBR\tEdgar Markov', 'C\ttymna-thrasios\t4000\tWUBG\tTymna the Weaver\tThrasios, Triton Hero', 'C\tcraterhoof-behemoth\t100\tG\tCraterhoof Behemoth',
  ...Array.from({ length: 30 }, (_, i) => `C\tfiller-cmd-${i}\t${3000 - i}\tG\tFiller Cmd ${i}`),      // 30 commandants sans deck, entre Tymna (rang 2) et Craterhoof : Craterhoof passe au rang 33 → tier A
  'D\tedgar-markov\tedhrec\tDeck moyen\thttps://edhrec.com/average-decks/edgar-markov', 'K\t1\tSol Ring', 'K\t1\tArcane Signet', 'K\t1\tCommand Tower', 'K\t1\tSwords to Plowshares', 'K\t1\tWrath of God', 'K\t8\tPlains', ...filler(20),
  'D\ttymna-thrasios\tedhrec\tDeck moyen\thttps://edhrec.com/average-decks/tymna-thrasios', 'K\t1\tSol Ring', 'K\t1\tLlanowar Elves', ...filler(25, 100),
  'D\tcraterhoof-behemoth\tedhrec\tDeck moyen\t', 'K\t1\tLlanowar Elves', 'K\t1\tSol Ring', ...filler(22, 200),
  'D\tedgar-markov\tarchidekt\tUpping the Average · 4 200 vues\thttps://archidekt.com/decks/42', 'K\t1\tSol Ring', 'K\t1\tArcane Signet', ...filler(24, 300),
  'G\tArcane Signet', 'G\tCommand Tower', 'G\tSwords to Plowshares', 'G\tWrath of God',      // Game Changers : Edgar (4) → bracket 4 ; Edgar Archidekt (1) → 3 ; Tymna et Craterhoof (0) → 2
  'P\t900\tTymna the Weaver', 'P\t150\tSol Ring', 'P\t40\tArcane Signet', 'P\t30\tCommand Tower', 'P\t190\tSwords to Plowshares', 'P\t150\tWrath of God', 'P\t20\tLlanowar Elves', ...Array.from({ length: 20 }, (_, i) => `P\t${50 + i}\tFiller ${i}`), ...Array.from({ length: 25 }, (_, i) => `P\t500\tFiller ${100 + i}`)].join('\n') + '\n';
let hits = 0, mode = 'ok';
await p.route('**/edh.tsv', r => { hits++; if (mode === 'ok') return r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: FILE }); return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"asset_missing"}' }); });
const rows = () => p.$$eval('.crow:not(.dk)', r => r.map(x => ({ name: x.querySelector('.row-name').textContent, tags: [...x.querySelectorAll('.tag')].map(t => t.textContent.replace(/\s+/g, ' ').trim()) })));
const dks = () => p.$$eval('.crow.dk', r => r.map(x => ({ name: x.querySelector('.row-name').firstChild.textContent.trim(), rank: (x.querySelector('.dk-rank') || { textContent: '' }).textContent, pips: x.querySelectorAll('.dk-pips .mc').length, have: x.querySelector('.dk-have').textContent.replace(/\s+/g, ' ').trim(), lab: (x.querySelector('.dk-lab') || { textContent: '' }).textContent, px: x.querySelector('.dk-px').innerText.replace(/\s+/g, ' ').trim(), tier: (x.querySelector('.dk-tier') || { textContent: '' }).textContent, tags: [...x.querySelectorAll('.tag')].map(t => t.textContent.replace(/\s+/g, ' ').trim()) })));

/* ── collection : Edgar Markov, Sol Ring ×2, Arcane Signet, Llanowar Elves, Craterhoof ──────── */
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
await p.click('.coll-tools [data-act="import"]'); await p.waitForSelector('#ciText');
await p.fill('#ciText', '1 Edgar Markov\n2 Sol Ring\n1 Arcane Signet\n1 Llanowar Elves\n1 Craterhoof Behemoth\n3 Plains'); await p.waitForTimeout(150); await p.click('#ciGo');
await p.waitForFunction(() => document.querySelectorAll('.crow:not(.dk)').length === 6); await p.waitForFunction(() => document.querySelectorAll('.crow .px.cm').length >= 5, null, { timeout: 8000 });

/* ── 1) filtre « Commander » : éligibles ─────────────────────────────────────────────────────── */
await p.click('.coll .fbtn'); await p.waitForSelector('.coll .fpanel:not([hidden])');
assert.equal(await p.$$eval('.coll .fpanel [data-x]', b => b.map(x => x.textContent).join('|')), 'Peuvent l\'être|Joués en commandant');
await p.click('.coll .fopt[data-x="can"]');
assert.deepEqual((await rows()).map(r => r.name), ['Edgar Markov'], 'seule la créature légendaire peut être commandant'); assert.equal(await txt(p, '.coll .fbtn b'), '1');
assert.ok((await rows())[0].tags.includes('Commander'), 'pastille « Commander » sur la ligne');
await p.screenshot({ path: 'shots/edh-1-eligibles.png' });
ok('filtre Commander › peuvent l\'être : Edgar Markov seul (ni Sol Ring, ni Craterhoof)');

/* ── 2) filtre « Joués en commandant » : fichier chargé une fois, tri par decks ──────────────── */
await p.click('.coll .fopt[data-x="played"]'); await p.waitForFunction(() => document.querySelector('.crow:not(.dk) .tag.accent') && /decks/.test(document.querySelector('.crow:not(.dk) .tag.accent').textContent), null, { timeout: 8000 });
let r = await rows(); assert.deepEqual(r.map(x => x.name), ['Edgar Markov', 'Craterhoof Behemoth'], 'les deux figurent dans le fichier ; tri par nombre de decks'); assert.ok(r[0].tags.some(t => /^Commander · 12 345 decks$/.test(t)), 'nombre de decks EDHREC : ' + r[0].tags); assert.ok(r[1].tags.includes('Commander · 100 decks'));
assert.equal(await p.$eval('#collSort', s => s.value), 'decks', 'tri par popularité activé'); assert.equal(hits, 1);
await p.click('.coll .fopt[data-x="played"]');
assert.equal((await rows()).length, 6); ok('joués en commandant : Edgar Markov · 12 345 decks puis Craterhoof · 100, tri par popularité, fichier téléchargé 1 fois');

/* ── 3) onglet Decks ─────────────────────────────────────────────────────────────────────────── */
await p.click('#collSeg [data-v="decks"]'); await p.waitForSelector('.crow.dk');
let d = await dks(); assert.equal(d.length, 4, 'craterhoof : 24 cartes ≥ 20 → gardé ; Edgar a deux decks (moyen EDHREC + Archidekt)');
// Edgar : Edgar + Sol Ring + Arcane Signet + Command Tower + Swords + Wrath + 20 fillers = 26 (Plains ignorés) ; possédées 3 (Edgar, Sol Ring, Arcane Signet) → 23 à acheter
// Tymna : 2 + Sol Ring + Llanowar + 25 = 29 ; possédées 2 → 27 · Craterhoof : Craterhoof + Llanowar + Sol Ring + 22 = 25 ; possédées 3 → 22
assert.deepEqual(d.map(x => x.name), ['Craterhoof Behemoth', 'Edgar Markov', 'Edgar Markov', 'Tymna the Weaver + Thrasios, Triton Hero'], 'moins de cartes manquantes d\'abord (22, 23, 24, 27)');
assert.match(d[0].have, /^3 \/ 25 possédées/); assert.match(d[0].px, /^22 à acheter/); assert.match(d[1].have, /^3 \/ 26 possédées/); assert.match(d[1].px, /^23 à acheter/); assert.match(d[2].have, /^3 \/ 27 possédées/); assert.equal(d[2].lab, '', 'nom du deck Archidekt : seulement dans la fiche'); assert.ok(d[2].tags.includes('Archidekt') && d[1].tags.includes('Moyen'), 'type de deck : ' + d[2].tags + ' / ' + d[1].tags); assert.match(d[3].have, /^2 \/ 29 possédées/);
assert.ok(!d[1].tags.some(t => /decks/.test(t)) && d[1].tags.includes('Commandant possédé'), 'plus de nombre de decks sur la ligne'); assert.ok(!d[3].tags.includes('Commandant possédé'));
assert.deepEqual(d.map(x => x.tier), ['A', 'S', 'S', 'S'], 'tier d\'après le rang de popularité : Craterhoof n° 33 → A ; Edgar n° 1 et Tymna n° 2 → S');
assert.deepEqual(d.map(x => x.rank), ['#33', '#1', '#1', '#2'], 'rang à côté du nom'); assert.deepEqual(d.map(x => x.pips), [1, 3, 3, 4], 'symboles de mana de l\'identité');
assert.equal(await p.$eval('.crow.dk .dk-pips .mc-g', e => getComputedStyle(e).backgroundImage.startsWith('url("data:image/svg+xml')), true, 'symbole dessiné (SVG), lettre gardée dans le texte'); assert.equal(await p.$eval('.crow.dk .dk-pips .mc-g', e => e.textContent), 'G');
assert.deepEqual(d.map(x => x.tags.find(t => /Game Changer/.test(t))), [undefined, '4 Game Changers', '1 Game Changer', undefined], 'Game Changers : affichés seulement s\'il y en a');
assert.deepEqual(await p.$$eval('.dk-ctl [data-act="dsort"]', b => b.map(x => x.textContent + ':' + x.getAttribute('aria-pressed'))), ['Plus possédées:true', 'Moins cher:false', 'Meilleur tier:false'], 'tri par défaut : le plus de cartes possédées');
assert.match(await txt(p, '.dk-sum'), /4 decks sur 4/); assert.match(await txt(p, '.coll-main > p.hint'), /deck moyen EDHREC.*Prix : tendance Cardmarket au 03\/10\/2026/);
await p.screenshot({ path: 'shots/edh-2-decks.png' });
// type de deck (filtre) et tri combiné « Meilleur tier, puis moins cher »
assert.deepEqual(await p.$$eval('.dk-ctl [data-act="dkind"]', b => b.map(x => x.textContent)), ['Moyen', 'Archidekt'], 'types présents seulement');
await p.click('.dk-ctl [data-act="dkind"][data-k="arch"]'); d = await dks(); assert.deepEqual(d.map(x => x.name), ['Edgar Markov'], 'filtre Archidekt'); assert.match(await txt(p, '.dk-sum'), /1 deck sur 4 · Archidekt/);
await p.click('.dk-ctl [data-act="dkind"][data-k="arch"]'); assert.equal((await dks()).length, 4);
await p.click('.dk-ctl [data-act="dsort"][data-v="pop"]'); assert.deepEqual(await p.$$eval('.dk-then [data-act="dthen"]', b => b.map(x => x.dataset.v)), ['have', 'cost'], '« Puis » : les deux autres tris');
await p.click('.dk-then [data-act="dthen"][data-v="cost"]'); d = await dks();
const eur = x => Number((/≈ ([\d\s ,]+) €/.exec(x.px) || [, '0'])[1].replace(/\s| /g, '').replace(',', '.'));
assert.deepEqual(d.map(x => x.tier), ['S', 'S', 'S', 'A'], 'tiers S d\'abord'); assert.ok(eur(d[0]) <= eur(d[1]) && eur(d[1]) <= eur(d[2]), 'dans le tier S : du moins cher au plus cher : ' + d.map(x => x.px).join(' | '));
await p.click('.dk-then [data-act="dthen"][data-v="cost"]'); assert.equal(await p.$$eval('.dk-then [aria-pressed="true"]', b => b.length), 0, '« Puis » se décoche');
await p.click('.dk-ctl [data-act="dsort"][data-v="have"]');
ok('filtre par type de deck (Moyen / Archidekt…) ; « Meilleur tier, puis moins cher » : paliers de tier, prix croissant dedans');
ok('onglet Decks : classement selon la collection (22 · 23 · 24 · 27 cartes à acheter), deck Archidekt libellé, commandant possédé signalé');

/* ── 3b) cartes possédées mais engagées dans un deck monté : « dont N engagées », barre bleue + orange ── */
assert.equal(await p.$$eval('.crow.dk .dk-bar i.eng, .crow.dk .dk-eng', n => n.length), 0, 'aucun deck monté : ni orange ni mention');
await p.evaluate(() => { XS.eng = { zz: { n: 'Mon deck', at: Date.now(), q: { 'sol ring': 2, 'arcane signet': 1 } } }; engApplied(); });      // Sol Ring ×2 et Arcane Signet réservés : tout ce qu'on en possède
await p.waitForFunction(() => document.querySelector('.crow.dk .dk-eng'), null, { timeout: 3000 });
d = await dks();
assert.deepEqual(d.map(x => x.name), ['Craterhoof Behemoth', 'Edgar Markov', 'Edgar Markov', 'Tymna the Weaver + Thrasios, Triton Hero'], 'l\'ordre ne change pas : « possédées » compte toujours les engagées');
assert.match(d[0].have, /^3 \/ 25 possédées · dont 1 engagée$/, 'Craterhoof : Sol Ring engagé'); assert.match(d[1].have, /^3 \/ 26 possédées · dont 2 engagées$/, 'Edgar : Sol Ring + Arcane Signet'); assert.match(d[2].have, /^3 \/ 27 possédées · dont 2 engagées$/); assert.match(d[3].have, /^2 \/ 29 possédées · dont 1 engagée$/, 'Tymna : Sol Ring');
const bar = await p.$$eval('.crow.dk:nth-child(2) .dk-bar i', n => n.map(x => [x.className, x.style.width]));
assert.deepEqual(bar, [['', '4%'], ['eng', '8%']], 'barre : 1 libre (Edgar) en bleu, 2 engagées en orange, sur 26');
const cols = await p.$$eval('.crow.dk:nth-child(2) .dk-bar i', n => n.map(x => getComputedStyle(x).backgroundColor)); assert.notEqual(cols[0], cols[1], 'deux couleurs distinctes');
assert.match(await p.$eval('.crow.dk:nth-child(2)', e => e.getAttribute('aria-label')), /3 cartes sur 26 \(dont 2 engagées dans un deck\)/);
await p.$eval('.crow.dk:nth-child(2)', e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(400); await p.screenshot({ path: 'shots/edh-2b-engagees.png' });
await p.click('.crow.dk:nth-child(2)'); await p.waitForSelector('.sheet .ci-sum');
assert.match(await txt(p, '.sheet-head p'), /^Tier S · n° 1 · 3 \/ 26 possédées \(dont 2 engagées\) · /);
assert.deepEqual(await p.$$eval('.sheet .crow[data-ik]:has(.tag.warn[title^="Déjà"]) .row-name', n => n.map(x => x.textContent).sort()), ['Arcane Signet', 'Sol Ring'], 'pastille « dont 1 engagée » sur les cartes concernées');
assert.match(await p.$eval('.sheet .crow[data-ik="sol ring"]', e => e.dataset.ex), /dont 1 engagée/);
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
await p.evaluate(() => { XS.eng = {}; engApplied(); });
await p.waitForFunction(() => !document.querySelector('.crow.dk .dk-eng'), null, { timeout: 3000 });
assert.equal(await p.$$eval('.crow.dk .dk-bar i.eng', n => n.length), 0, 'deck démonté : plus d\'orange');
ok('decks EDHREC : « dont N engagées » (cartes possédées réservées par un deck monté), barre bleue + orange, feuille annotée, disparaît au démontage');

await p.click('.dk-ctl [data-act="dsort"][data-v="pop"]'); assert.deepEqual((await dks()).map(x => x.name.split(' ')[0]), ['Edgar', 'Edgar', 'Tymna', 'Craterhoof'], 'populaires');
await p.click('.dk-ctl [data-act="dsort"][data-v="cost"]'); d = await dks(); assert.equal(d.length, 4);
await p.click('.dk-ctl [data-act="dcol"][data-c="G"]'); assert.deepEqual((await dks()).map(x => x.name), ['Craterhoof Behemoth'], 'couleurs permises : G → mono-vert seulement');
await p.click('.dk-ctl [data-act="dcol"][data-c="G"]'); await p.click('.dk-ctl [data-act="dmine"]');
assert.deepEqual((await dks()).map(x => x.name.split(' ')[0]), ['Craterhoof', 'Edgar', 'Edgar'], 'je possède le commandant : Tymna / Thrasios (non possédés) masqués');
await p.click('.dk-ctl [data-act="dmine"]');
await p.selectOption('.dk-ctl select[data-act="dbudget"]', '3000'); assert.deepEqual((await dks()).map(x => x.name.split(' ')[0]).sort(), ['Craterhoof', 'Edgar', 'Edgar'], 'budget ≤ 30 € : Tymna (≈ 125 €) écartée');
await p.selectOption('.dk-ctl select[data-act="dbudget"]', '0'); assert.equal((await dks()).length, 4);
ok('tris (moins cher, populaires), couleurs permises, « j\'ai le commandant », budget');
const tierBtn = t => p.click(`.dk-ctl [data-act="dtier"][data-t="${t}"]`);
await tierBtn('A'); assert.deepEqual((await dks()).map(x => x.name), ['Craterhoof Behemoth'], 'tier A : Craterhoof seul'); assert.equal(await p.$eval('[data-act="dtier"][data-t="A"]', b => b.getAttribute('aria-pressed')), 'true'); assert.match(await txt(p, '.dk-sum'), /^1 deck sur 4 · tier A/);
await tierBtn('A'); await tierBtn('S'); assert.deepEqual((await dks()).map(x => x.name.split(' ')[0]), ['Edgar', 'Edgar', 'Tymna'], 'tier S : Edgar (×2) et Tymna');
await tierBtn('A'); assert.equal((await dks()).length, 4, 'S + A : tous'); assert.match(await txt(p, '.dk-sum'), /tier S A/); await tierBtn('S'); await tierBtn('A');
assert.deepEqual(await p.$$eval('.dk-ctl [data-act="dtier"]', b => b.map(x => x.textContent)), ['S', 'A'], 'seuls les tiers qui ont des decks ont un bouton (ni B, C ni D ici)');
await tierBtn('A'); await tierBtn('A'); assert.equal((await dks()).length, 4, 'plus aucun tier choisi = tous');
ok('filtre par tier : A → Craterhoof ; S → Edgar ×2 + Tymna ; S+A → tous ; boutons limités aux tiers présents ; badge S/A sur chaque deck, rang n° 1 / 2 / 33, bracket 2 · 4 · 3 · 2');

/* ── 3b) recherche dans les decks : par commandant (mots, accents, paire), puis par carte ─────── */
const typeQ = async v => { await p.fill('#dkQ', v); await p.waitForTimeout(260); };
const focused = () => p.evaluate(() => document.activeElement && document.activeElement.id);
await p.click('#dkQ'); await typeQ('edgar');
assert.deepEqual((await dks()).map(x => x.name), ['Edgar Markov', 'Edgar Markov'], 'les deux decks d\'Edgar'); assert.match(await txt(p, '.dk-sum'), /2 decks sur 4 · commandant « edgar »/); assert.equal(await focused(), 'dkQ', 'le champ garde le focus pendant la frappe');
await typeQ('EDGÁR  markov'); assert.equal((await dks()).length, 2, 'accents, casse, espaces');
await typeQ('tymna'); assert.deepEqual((await dks()).map(x => x.name), ['Tymna the Weaver + Thrasios, Triton Hero']); await typeQ('thrasios triton'); assert.equal((await dks()).length, 1, 'l\'autre membre de la paire');
await typeQ('craterhoof'); assert.equal((await dks()).length, 1); await p.click('.dk-ctl [data-act="dsort"][data-v="cost"]'); assert.equal(await p.inputValue('#dkQ'), 'craterhoof', 'la recherche survit aux autres réglages'); assert.equal((await dks()).length, 1);
await p.click('.dk-ctl [data-act="dsort"][data-v="have"]');
await typeQ('filler cmd 7'); assert.equal((await dks()).length, 0); assert.match(await txt(p, '.dk-note'), /^Sans deck dans le fichier .* : Filler Cmd 7 \(n° 10\)\.$/, 'commandant connu mais sans deck : on le dit, avec son rang');
await typeQ('zzz'); assert.match(await txt(p, '.dk-res .listempty'), /^Aucun commandant ne correspond à « zzz »\.$/);
await p.click('[data-act="dqx"]'); assert.equal(await p.inputValue('#dkQ'), ''); assert.equal((await dks()).length, 4, 'croix : tous les decks'); assert.equal(await focused(), 'dkQ');
ok('recherche par commandant : « edgar » → 2 decks, accents/casse, paire Tymna + Thrasios par l\'un ou l\'autre, sans deck → message avec le rang, inconnu → message, croix, focus gardé, réglages conservés');
await p.click('[data-act="dqm"][data-v="card"]'); assert.equal(await p.getAttribute('#dkQ', 'placeholder'), 'Rechercher une carte dans les decks');
await typeQ('swords'); d = await dks(); assert.deepEqual(d.map(x => x.name), ['Edgar Markov'], 'seul le deck moyen d\'Edgar contient Swords'); assert.equal(await txt(p, '.crow.dk .dk-hitl'), 'Contient : Swords to Plowshares'); assert.match(await txt(p, '.dk-note'), /^Cartes trouvées : Swords to Plowshares \(1\)\.$/); assert.match(await txt(p, '.dk-sum'), /1 deck sur 4 · contenant « swords »/);
await typeQ('sol ring'); assert.equal((await dks()).length, 4, 'Sol Ring est dans les quatre decks'); assert.match(await txt(p, '.dk-note'), /Sol Ring \(4\)/);
await typeQ('s'); assert.equal((await dks()).length, 4, 'une lettre : pas de filtre'); assert.match(await txt(p, '.dk-note'), /au moins 2 lettres/);
await typeQ('plains'); assert.equal((await dks()).length, 0, 'terrains de base exclus'); assert.match(await txt(p, '.dk-res .listempty'), /^Aucun deck ne contient « plains » avec ces réglages\.$/);
await typeQ('edgar markov'); assert.equal((await dks()).length, 2, 'le commandant compte comme carte du deck');
await typeQ('arcane'); await tierBtn('A'); assert.equal((await dks()).length, 0, 'combiné au tier A : Craterhoof n\'a pas Arcane Signet'); assert.equal(await p.inputValue('#dkQ'), 'arcane'); await tierBtn('A'); assert.equal((await dks()).length, 2, 'les deux decks d\'Edgar contiennent Arcane Signet');
await typeQ('swords'); await p.click('.crow.dk >> nth=0'); await p.waitForSelector('.sheet .ci-sum');
assert.deepEqual(await p.$$eval('.sheet-body > h3.cs-h', h => h.map(x => x.textContent.replace(/\s+/g, ' ').trim())), ['Commandant', 'Carte cherchée', 'Autres cartes à acheter 22 cartes'], 'commandant, puis la carte cherchée, puis le reste');
assert.deepEqual(await p.$$eval('.dk-hit .crow', r => r.map(x => [x.querySelector('.row-name').textContent, x.querySelector('.row-price b').textContent.replace(/\s+/g, ' ').trim()])), [['Swords to Plowshares', '1,90 €']]); assert.ok(!(await p.$$eval('.dk-miss .row-name', n => n.map(x => x.textContent))).includes('Swords to Plowshares'), 'pas en double dans « À acheter »');
await p.click('.sheet [data-close].icon-btn'); await p.waitForFunction(() => !document.querySelector('.sheet .ci-sum'));
await p.click('[data-act="dqx"]'); await p.click('[data-act="dqm"][data-v="cmd"]'); assert.equal((await dks()).length, 4); assert.equal(await p.getAttribute('#dkQ', 'placeholder'), 'Rechercher un commandant');
await p.screenshot({ path: 'shots/edh-2b-recherche.png' });
ok('recherche par carte : « swords » → 1 deck (étiquette « Contient »), « sol ring » → 4, 1 lettre ignorée, terrains exclus, combinée au tier ; feuille : « Carte cherchée » sous le commandant, sans doublon');

/* ── 4) feuille d'un deck puis chargement dans la page de saisie ─────────────────────────────── */
await p.click('.dk-ctl [data-act="dsort"][data-v="have"]');
await p.click('.crow.dk >> nth=1'); await p.waitForSelector('.sheet .ci-sum');
assert.match(await txt(p, '.sheet-head'), /Edgar Markov/); assert.match(await txt(p, '.sheet .ci-sum'), /23 cartes à acheter · ≈ 15,60 €/);
assert.equal(await p.$eval('.sheet-body > *:nth-child(1)', e => e.className), 'ci-sum'); assert.equal(await p.$eval('.sheet-body > *:nth-child(2)', e => e.className), 'tr-acts dk-acts', 'Voir le deck · Partager sous le résumé'); assert.equal(await p.$eval('.sheet-body > *:nth-child(3)', e => e.className), 'dk-acts2', 'puis les actions (enregistrer, Je recherche…)'); assert.equal(await p.$eval('.sheet-body > *:nth-child(4)', e => e.tagName + ' ' + e.textContent.trim()), 'H3 Commandant', 'le commandant est la 1re section');
assert.deepEqual(await p.$$eval('.dk-cmd .row-name', n => n.map(x => x.textContent)), ['Edgar Markov']); assert.equal(await p.$eval('.dk-cmd .row-price b', e => e.textContent.trim()), '✓', 'commandant possédé : coche');
const miss = await p.$$eval('.dk-miss .row-name', n => n.map(x => x.textContent)); assert.equal(miss.length, 23); assert.equal(miss[0], 'Swords to Plowshares', 'la plus chère d\'abord'); assert.ok(!miss.includes('Sol Ring'));
assert.match(await txt(p, '.dk-own summary'), /Déjà dans ta collection \(2\)/);
assert.equal(await p.$eval('.sheet-foot a', a => a.href), 'https://edhrec.com/average-decks/edgar-markov'); assert.equal(await p.$eval('.sheet-foot a', a => a.rel), 'noopener noreferrer');
await p.screenshot({ path: 'shots/edh-3-feuille.png' });
/* ── 4a) actions de la feuille : « Je recherche » (sans doublon, annulable), enregistrer dans Mes decks ; pas d'alertes sans serveur de notifications ── */
const acts = () => p.$$eval('.dk-acts2 .dk-act', b => b.map(x => [x.dataset.act, x.querySelector('b').textContent, (x.querySelector('small') || { textContent: '' }).textContent, x.disabled]));
assert.deepEqual(await acts(), [['dksave', 'Enregistrer dans mes decks', '34/100 cartes', false], ['dkwish', 'Ajouter les manquantes à Je recherche', '23 cartes · liste d\'échange', false]], 'exemplaires (8 Plains compris), « /100 » ; pas de « Surveiller leurs prix » : alertes indisponibles ici');
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
await p.evaluate(() => { TR.wish = { 'swords to plowshares': { n: 'Swords to Plowshares', q: 1 }, 'mana crypt': { n: 'Mana Crypt', q: 2 } }; trChanged(); });      // Swords déjà recherchée
await p.click('.crow.dk >> nth=1'); await p.waitForSelector('.dk-acts2 .dk-act');
assert.deepEqual((await acts())[1], ['dkwish', 'Ajouter les manquantes à Je recherche', '22 cartes · liste d\'échange', false], 'Swords déjà dans « Je recherche » : pas comptée');
await p.click('.dk-act[data-act="dkwish"]'); assert.equal(await txt(p, '#toast'), '22 cartes ajoutées à Je recherche Annuler');
let wish = await p.evaluate(() => TR.wish);
assert.equal(Object.keys(wish).length, 24); assert.equal(wish['swords to plowshares'].q, 1, 'pas en double'); assert.equal(wish['mana crypt'].q, 2, 'souhait sans rapport : intact'); assert.deepEqual(wish['command tower'], { n: 'Command Tower', q: 1 }); assert.equal(wish['filler 19'].n, 'Filler 19');
assert.deepEqual((await acts())[1], ['dkwish', 'Manquantes dans Je recherche', 'Ta liste d\'échange les recherche déjà', true], 'fait : coché, inactif');
assert.equal(await p.evaluate(() => trState().want.filter(x => /^filler /.test(x.k)).length), 20, '« Je recherche » de l\'onglet Échange : les 20 fillers y sont');
await p.click('#toast .toast-act'); assert.deepEqual(Object.keys(await p.evaluate(() => TR.wish)).sort(), ['mana crypt', 'swords to plowshares'], 'Annuler : liste d\'avant'); assert.equal((await acts())[1][3], false);
// ajoutées puis deck enregistré : le deck recherche lui-même ses manquantes, les souhaits ajoutés par la feuille sont retirés (pas de doublon)
await p.click('.dk-act[data-act="dkwish"]'); await p.click('.dk-act[data-act="dksave"]'); assert.equal(await txt(p, '#toast'), '« Edgar Markov » ajouté à Mes decks Voir');
const saved = await p.evaluate(() => allDecks().map(d => ({ name: d.name, text: d.text, n: dkCountText(d.text), eng: engIsOn(d.id) })));
assert.equal(saved.length, 1); assert.equal(saved[0].name, 'Edgar Markov'); assert.match(saved[0].text, /^Commander\n1 Edgar Markov\n\n1 Sol Ring\n/); assert.equal(saved[0].n, '34/100 cartes'); assert.equal(saved[0].eng, false, 'pas monté : ses cartes ne sont pas réservées');
await p.waitForFunction(() => document.querySelector('.dk-act[data-act="dkwish"]').disabled, null, { timeout: 3000 });      // compte : le deck arrive dans « Mes decks » au retour de la synchro, la feuille se repeint alors
assert.deepEqual(await acts(), [['dksave', 'Dans mes decks', 'Enregistré sous « Edgar Markov »', true], ['dkwish', 'Manquantes dans Je recherche', 'Ta liste d\'échange les recherche déjà', true]]);
assert.deepEqual(Object.keys(await p.evaluate(() => TR.wish)).sort(), ['mana crypt', 'swords to plowshares'], 'souhaits ajoutés ici retirés');
assert.equal(await p.evaluate(() => trState().want.find(x => x.k === 'command tower').q), 1, 'Command Tower recherchée une fois, pas deux');
await p.screenshot({ path: 'shots/edh-3b-actions.png' });
await p.click('#toast .toast-act'); await p.waitForSelector('.dks.on .deck', { timeout: 4000 }); await p.waitForFunction(() => !document.querySelector('.sheet-wrap') && !document.querySelector('.coll'), null, { timeout: 3000 });
assert.equal(await txt(p, '.dks .deck-name'), 'Edgar Markov'); assert.match(await txt(p, '.dks .deck-line'), /^34\/100 cartes/, '« Voir » : Mes decks, le deck enregistré y est');
await p.evaluate(() => closeDecks()); await p.waitForFunction(() => !document.querySelector('.dks'), null, { timeout: 3000 });
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('#collSeg [data-v="decks"]'); await p.waitForSelector('.crow.dk');
await p.click('.crow.dk >> nth=1'); await p.waitForSelector('.dk-acts2 .dk-act'); assert.deepEqual((await acts())[0], ['dksave', 'Dans mes decks', 'Enregistré sous « Edgar Markov »', true], 'reconnu à la réouverture (même liste)');
await p.evaluate(() => { TR.wish = {}; trChanged(); });
ok('feuille d\'un deck : « Ajouter les manquantes à Je recherche » (22 + Swords déjà là, sans doublon, Annuler), « Enregistrer dans mes decks » (34/100, non monté, souhaits de la feuille repris par le deck), état gardé');
// « Voir le deck » : la fiche se ferme, le viewer s'ouvre (images, courbe, main de départ)
await p.click('.sheet [data-act="dkview"]'); await p.waitForSelector('.dv.on[aria-label="Deck viewer · Edgar Markov"]');
await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
await p.click('.dv.on[aria-label="Deck viewer · Edgar Markov"] [data-act="close"]'); await p.waitForTimeout(400);
await p.click('.crow.dk >> nth=1'); await p.waitForSelector('.sheet .ci-sum');
/* ── 4b) aperçu des cartes de la feuille, zoom, glissement ─────────────────────────────────── */
assert.match(await txt(p, '.sheet-head p'), /^Tier S · n° 1 · 3 \/ 26 possédées/); assert.match(await txt(p, '.sheet .ci-sum'), /Tier S · n° 1 sur EDHREC · 4 Game Changers.*Moyen/);
assert.deepEqual(await p.$$eval('.sheet .crow[data-ik]:has(.tag.warn) .row-name', n => n.map(x => x.textContent).sort()), ['Arcane Signet', 'Command Tower', 'Swords to Plowshares', 'Wrath of God'], 'pastille « Game Changer »');
assert.equal(await p.$$eval('.sheet .crow[data-ik]', n => n.length), 26, '23 à acheter + 3 possédées'); assert.equal(await p.$eval('.sheet .crow[data-ik="edgar markov"] .tag', e => e.textContent), 'Commandant');
await p.waitForSelector('.sheet .thumb[data-ik="swords to plowshares"] img.ok', { timeout: 8000 }); await p.waitForSelector('.sheet .thumb[data-ik="wrath of god"] img.ok');
assert.equal(await p.$eval('.sheet .thumb[data-ik="swords to plowshares"] img', i => i.src), 'https://cards.scryfall.io/small/front/a/b/swords-to-plowshares.jpg', 'image lue sur Scryfall pour une carte non possédée');
const posts = () => world.scry.filter(x => x.startsWith('POST /cards/collection')).length, p0 = posts();
await p.click('.sheet .crow[data-ik="swords to plowshares"]'); await p.waitForSelector('.imgv.on');
assert.equal(await txt(p, '.imgv-cap b'), 'Swords to Plowshares'); assert.equal(await txt(p, '.imgv-count'), '2 / 6', '6 cartes ont une image (commandant en tête) : les autres sont sautées'); assert.match(await txt(p, '.imgv-extra'), /^À acheter · ≈ 1,90 €$/);
await p.waitForFunction(() => /\/large\/front\/fr\/swords-to-plowshares\.jpg/.test(document.querySelector('.imgv-img').src), null, { timeout: 8000 });      // non possédée : l'aperçu passe en français quand Scryfall a la carte
await p.keyboard.press('ArrowRight'); assert.equal(await txt(p, '.imgv-cap b'), 'Wrath of God'); assert.equal(await txt(p, '.imgv-count'), '3 / 6'); await p.waitForTimeout(500);
await p.screenshot({ path: 'shots/edh-4-zoom.png' });
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 3000 }); assert.ok(await p.$('.sheet .ci-sum'), 'la feuille reste ouverte');
await p.click('.sheet .crow[data-ik="filler 5"]'); assert.match(await txt(p, '#toast'), /Pas d'aperçu pour cette carte/);
await p.click('.sheet [data-close].icon-btn'); await p.waitForFunction(() => !document.querySelector('.sheet .ci-sum')); await p.click('.crow.dk >> nth=1'); await p.waitForSelector('.sheet .thumb[data-ik="swords to plowshares"] img.ok', { timeout: 8000 });
assert.equal(posts(), p0, 'images gardées sur l\'appareil : pas de nouvelle lecture Scryfall à la réouverture');
ok('feuille : Tier S · n° 1, bracket ≈ 4 (4 Game Changers, pastilles), vignettes lues sur Scryfall puis gardées ; appui = visionneuse (2 / 6, grande image, extra « À acheter · ≈ 1,90 € »), flèche = carte suivante, Échap garde la feuille, carte sans image : message');
/* commandants partenaires : tous les deux en tête, avec prix (non possédé) ou « — » (prix inconnu) */
await p.click('.sheet [data-close].icon-btn'); await p.waitForFunction(() => !document.querySelector('.sheet .ci-sum')); await p.click('.crow.dk:has-text("Tymna")'); await p.waitForSelector('.sheet .ci-sum');
assert.equal(await p.$eval('.sheet-body > *:nth-child(4)', e => e.tagName + ' ' + e.textContent.trim()), 'H3 Commandants');
const tc = await p.$$eval('.dk-cmd .crow', r => r.map(x => [x.querySelector('.row-name').textContent, x.querySelector('.row-price b').textContent.replace(/\s+/g, ' ').trim(), x.querySelector('.tag').textContent])); assert.deepEqual(tc, [['Tymna the Weaver', '9,00 €', 'Commandant'], ['Thrasios, Triton Hero', '—', 'Commandant']]);
assert.ok(!(await p.$$eval('.dk-miss .row-name', n => n.map(x => x.textContent))).some(t => /Tymna|Thrasios/.test(t)), 'pas de doublon dans « À acheter »');
await p.click('.sheet [data-close].icon-btn'); await p.waitForFunction(() => !document.querySelector('.sheet .ci-sum')); await p.click('.crow.dk >> nth=1'); await p.waitForSelector('.sheet .ci-sum'); assert.match(await txt(p, '.sheet-head'), /Edgar Markov/);
ok('feuille : commandant(s) toujours en tête (Tymna + Thrasios), prix ou ✓ / « — », jamais en double dans « À acheter »');
await p.click('#dkGo'); await p.waitForSelector('#deckText', { state: 'visible' }); await p.waitForFunction(() => !document.querySelector('.coll'), null, { timeout: 4000 });
const text = await p.inputValue('#deckText'); assert.match(text, /^Commander\n1 Edgar Markov\n\n1 Sol Ring\n/); assert.match(text, /\n8 Plains\n/);
assert.equal(await p.$eval('#optColl', c => c.checked), true, 'collection déduite'); assert.match(await txt(p, '#collHint'), /3 cartes de cette liste sont dans ta collection/);
ok('feuille : 23 cartes à acheter (la plus chère d\'abord), lien EDHREC sûr ; « Chercher les manquantes » charge le deck, collection déduite');

/* ── 5) cache : une 2e ouverture ne retélécharge pas ; fichier absent → message + repli ─────── */
await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('#collSeg [data-v="decks"]'); await p.waitForSelector('.crow.dk'); assert.equal(hits, 1, 'copie locale (moins de 6 jours)');
await p.close();
mode = 'absent';
const b = await newPage(browser, world); await signInFake(b.p); await b.p.route('**/edh.tsv', r => { hits++; return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"asset_missing"}' }); });
await toHome(b.p); await b.p.click('#btnColl'); await b.p.waitForSelector('.coll.on'); await b.p.click('.coll-tools [data-act="import"]'); await b.p.waitForSelector('#ciText'); await b.p.fill('#ciText', '1 Edgar Markov\n1 Sol Ring'); await b.p.waitForTimeout(150); await b.p.click('#ciGo');
await b.p.waitForFunction(() => document.querySelectorAll('.crow').length === 2); await b.p.waitForFunction(() => document.querySelectorAll('.crow .px.cm').length >= 2, null, { timeout: 8000 });
await b.p.click('#collSeg [data-v="decks"]'); await b.p.waitForSelector('.coll-main .dv-empty'); assert.match(await txt(b.p, '.coll-main .dv-empty'), /Decks indisponibles.*edh\.bin\.gz/);
await b.p.click('#collSeg [data-v="list"]'); await b.p.click('.coll .fbtn'); await b.p.click('.coll .fopt[data-x="played"]'); await b.p.waitForSelector('.coll-main .dv-empty [data-act="dcan"]');
assert.match(await txt(b.p, '.coll-main .dv-empty'), /Commandants EDHREC indisponibles/); await b.p.click('[data-act="dcan"]');
await b.p.waitForFunction(() => document.querySelectorAll('.crow').length === 1); assert.equal(await b.p.$eval('.crow .row-name', e => e.textContent), 'Edgar Markov'); assert.equal(await b.p.$eval('.coll .fopt[data-x="can"]', x => x.getAttribute('aria-pressed')), 'true');
ok('fichier absent : message clair, « Réessayer », repli sur « peuvent l\'être »');
await b.ctx.close();


/* ── 6) fichier binaire edh.bin.gz : gzip transparent (Content-Encoding), gzip brut (DecompressionStream), copie gardée sur l'appareil ───────── */
import { createRequire } from 'node:module'; import { gzipSync } from 'node:zlib';
const req = createRequire(import.meta.url), CORE = req('../src/core.js'), BIN = gzipSync(Buffer.from(req('../src/edhbin.js').edhPack(CORE.edhModelFromTsv(FILE), CORE.ownKey)));
const openDecks = async pg => {
  await signInFake(pg); await toHome(pg); await pg.click('#btnColl'); await pg.waitForSelector('.coll.on'); await pg.click('.coll-tools [data-act="import"]'); await pg.waitForSelector('#ciText');
  await pg.fill('#ciText', '1 Edgar Markov\n2 Sol Ring\n1 Arcane Signet\n1 Llanowar Elves\n1 Craterhoof Behemoth\n3 Plains'); await pg.waitForTimeout(150); await pg.click('#ciGo');
  await pg.waitForFunction(() => document.querySelectorAll('.crow:not(.dk)').length === 6); await pg.waitForFunction(() => document.querySelectorAll('.crow .px.cm').length >= 5, null, { timeout: 8000 });
  await pg.click('#collSeg [data-v="decks"]'); await pg.waitForSelector('.crow.dk', { timeout: 8000 });
};
const names = async pg => (await pg.$$eval('.crow.dk', r => r.map(x => x.querySelector('.row-name').firstChild.textContent.trim() + ' ' + x.querySelector('.dk-have').textContent.replace(/\s+/g, ' ').trim())));
for (const [mode, headers] of [['gzip transparent', { 'content-encoding': 'gzip' }], ['gzip brut', {}]]) {
  const c = await newPage(browser, world); let binHits = 0, tsvHits = 0;
  await c.p.route('**/edh.bin.gz', r => { binHits++; return r.fulfill({ status: 200, contentType: 'application/octet-stream', headers, body: BIN }); });
  await c.p.route('**/edh.tsv', r => { tsvHits++; return r.fulfill({ status: 404, body: '{}' }); });
  await openDecks(c.p);
  assert.deepEqual(await names(c.p), ['Craterhoof Behemoth 3 / 25 possédées', 'Edgar Markov 3 / 26 possédées', 'Edgar Markov 3 / 27 possédées', 'Tymna the Weaver + Thrasios, Triton Hero 2 / 29 possédées'], mode + ' : mêmes decks qu\'avec le texte');
  assert.equal(binHits, 1, mode + ' : une seule requête'); assert.equal(tsvHits, 0, 'le texte n\'est pas demandé quand le binaire répond');
  await c.p.click('.crow.dk >> nth=1'); await c.p.waitForSelector('.sheet .ci-sum'); assert.match(await txt(c.p, '.sheet .ci-sum'), /23 cartes à acheter/); assert.equal(await c.p.$eval('.sheet-foot a', a => a.href), 'https://edhrec.com/average-decks/edgar-markov'); await c.p.click('.sheet [data-close].icon-btn');
  await c.p.fill('#dkQ', 'tymna'); await c.p.waitForTimeout(260); assert.equal((await names(c.p)).length, 1, 'recherche sur l\'index binaire');
  if (mode === 'gzip brut') {      // copie gardée : après rechargement, affichée tout de suite ; le texte n'est pas redemandé, le binaire n'est qu'une lecture de contrôle
    await c.p.unroute('**/edh.bin.gz'); await c.p.unroute('**/edh.tsv'); let again = 0; await c.p.route('**/edh.bin.gz', r => { again++; return r.fulfill({ status: 404, body: '{}' }); }); await c.p.route('**/edh.tsv', r => { again++; return r.fulfill({ status: 404, body: '{}' }); });
    await c.p.reload(); await c.p.waitForSelector('#btnColl'); await c.p.waitForTimeout(500); await signInFake(c.p); await toHome(c.p); await c.p.click('#btnColl'); await c.p.waitForSelector('.coll.on'); await c.p.click('#collSeg [data-v="decks"]'); await c.p.waitForSelector('.crow.dk', { timeout: 8000 });
    assert.equal((await names(c.p)).length, 4, 'decks lus depuis la copie binaire de l\'appareil'); await c.p.waitForTimeout(300); assert.equal(again, 1, 'une seule lecture de contrôle en arrière-plan (404 ici, ignorée) : la copie de l\'appareil reste');
  }
  ok('fichier binaire (' + mode + ') : 4 decks identiques, 1 requête, texte non demandé, feuille et recherche fonctionnent' + (mode === 'gzip brut' ? ', copie gardée hors ligne' : ''));
  await c.ctx.close();
}

/* ── 7) copie de l'appareil périmée : affichée tout de suite, puis remplacée en arrière-plan par la version plus récente du site ───────── */
{
  const M = CORE.edhModelFromTsv(FILE), pack = m => gzipSync(Buffer.from(req('../src/edhbin.js').edhPack(m, CORE.ownKey)));
  const OLD = pack({ ...M, at: '2026-09-01T00:00:00Z', decks: M.decks.slice(0, 1) }), NEW = pack({ ...M, at: '2026-10-05T00:00:00Z' }), SAME_AT = pack({ ...M, at: '2026-09-01T00:00:00Z' });
  const c = await newPage(browser, world); let cur = { body: OLD, etag: '"old"' }, binHits = 0;
  await c.p.route('**/edh.bin.gz', r => { binHits++; return r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'content-encoding': 'gzip', etag: cur.etag }, body: cur.body }); });
  await c.p.route('**/edh.tsv', r => r.fulfill({ status: 404, body: '{}' }));
  await openDecks(c.p); const n0 = (await names(c.p)).length; assert.ok(n0 < 4, 'ancienne version : ' + n0 + ' deck(s)');
  // le site publie une version plus récente (autre ETag) ; au rechargement la copie s'affiche, puis est remplacée sans rien toucher
  cur = { body: NEW, etag: '"new"' };
  const reopen = async () => { await c.p.reload(); await c.p.waitForSelector('#btnColl'); await c.p.waitForTimeout(400); await signInFake(c.p); await toHome(c.p); await c.p.click('#btnColl'); await c.p.waitForSelector('.coll.on'); await c.p.click('#collSeg [data-v="decks"]'); await c.p.waitForSelector('.crow.dk', { timeout: 8000 }); };
  await reopen(); await c.p.waitForFunction(() => document.querySelectorAll('.crow.dk').length === 4, null, { timeout: 8000 });
  assert.deepEqual((await names(c.p)).length, 4, 'version récente affichée en arrière-plan');
  // ETag inchangé : rien n'est relu, les données restent
  binHits = 0; await reopen(); await c.p.waitForTimeout(300); assert.equal((await names(c.p)).length, 4, 'copie à jour affichée tout de suite'); assert.ok(binHits >= 1, 'lecture de contrôle faite');
  // autre ETag mais version plus ancienne ou identique (`at`) : pas de remplacement
  cur = { body: SAME_AT, etag: '"other"' }; await reopen(); await c.p.waitForTimeout(500); assert.equal((await names(c.p)).length, 4, 'une version plus ancienne ne remplace pas la copie');
  ok('copie périmée : affichée tout de suite, remplacée en arrière-plan par la version plus récente du site ; ETag inchangé ou version plus ancienne : rien ne change');
  await c.ctx.close();
}

/* ── 8) thèmes EDHREC : puces sur chaque deck, filtre multi-thèmes (ET), liste complète en feuille, noms français, fichier sans thèmes ───────── */
{
  const M = CORE.edhModelFromTsv(FILE), th = (slug, label, n) => [slug, label, n];
  M.cmds.find(c => c.slug === 'edgar-markov').themes = [th('aristocrats', 'Aristocrats', 500), th('lifegain', 'Lifegain', 300), th('control', 'Control', 100), th('tokens', 'Tokens', 90), th('sacrifice', 'Sacrifice', 80)];
  M.cmds.find(c => c.slug === 'tymna-thrasios').themes = [th('control', 'Control', 200), th('combo', 'Combo', 150), th('ramp', 'Ramp', 90), th('stax', 'Stax', 70), th('spellslinger', 'Spellslinger', 60)];
  const pack = m => gzipSync(Buffer.from(req('../src/edhbin.js').edhPack(m, CORE.ownKey))), TH = pack(M), PLAIN = pack(CORE.edhModelFromTsv(FILE));
  const c = await newPage(browser, world); let body = TH;
  await c.p.route('**/edh.bin.gz', r => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'content-encoding': 'gzip' }, body }));
  await c.p.route('**/edh.tsv', r => r.fulfill({ status: 404, body: '{}' }));
  await openDecks(c.p);
  const chips = () => c.p.$$eval('.dk-themes .fopt[data-act="dth"]', b => b.map(x => x.textContent.trim() + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')));
  const sum = () => txt(c.p, '.dk-sum');
  assert.deepEqual(await chips(), ['Contrôle', 'Aristocrats', 'Gain de vie', 'Sacrifice', 'Jetons'], '5 puces : les thèmes les plus présents (nombre de decks), noms français ; Archidekt compte avec son commandant');
  assert.equal(await txt(c.p, '.dk-themes [data-act="dthall"]'), 'Tous (9)');
  const rowsTh = await c.p.$$eval('.crow.dk', r => r.map(x => x.querySelector('.row-name').firstChild.textContent.trim() + ' | ' + (x.querySelector('.dk-th') ? x.querySelector('.dk-th').textContent : '-')));
  assert.deepEqual(rowsTh.sort(), ['Craterhoof Behemoth | -', 'Edgar Markov | Aristocrats · Gain de vie · Contrôle', 'Edgar Markov | Aristocrats · Gain de vie · Contrôle', 'Tymna the Weaver + Thrasios, Triton Hero | Contrôle · Combo · Ramp'], '3 thèmes au plus par deck ; commandant sans thème : rien ; les decks Archidekt portent ceux de leur commandant');
  // puce : un thème
  await c.p.click('.dk-themes [data-s="control"]'); await c.p.waitForFunction(() => document.querySelectorAll('.crow.dk').length === 3);
  assert.deepEqual((await chips()).filter(x => x.endsWith('*')), ['Contrôle*']); assert.match(await sum(), /3 decks sur 4.*thème : Contrôle/);
  assert.equal(await c.p.$$eval('.crow.dk .dk-th b', b => b.length), 3, 'le thème filtré est en évidence dans chaque ligne');
  // deux thèmes (le 2e choisi dans la liste complète, puis affiché en puce) : ET
  await c.p.click('.dk-themes [data-act="dthall"]'); await c.p.waitForSelector('.sheet .th-list');
  assert.equal(await c.p.$$eval('.sheet .th-main', b => b.length), 9); assert.equal(await c.p.$$eval('.sheet .th-main[aria-pressed="true"]', b => b.length), 1);
  assert.match(await txt(c.p, '.sheet .th-main'), /^Contrôle\s*3$/, 'nombre de decks restants avec ce thème');
  // « i » : description dépliable, sans toucher au filtre ; gardée ouverte quand la liste est repeinte
  assert.equal(await c.p.$$eval('.sheet .th-i', b => b.length), 9, 'un « i » par thème'); assert.equal(await c.p.$$eval('.sheet .th-desc:not([hidden])', b => b.length), 0, 'descriptions repliées au départ');
  await c.p.click('.sheet .th-i[data-i="control"]'); assert.equal(await c.p.$eval('.sheet .th-i[data-i="control"]', b => b.getAttribute('aria-expanded')), 'true');
  assert.match(await txt(c.p, '.sheet .th-desc:not([hidden])'), /Neutraliser les menaces de la table/); assert.equal((await txt(c.p, '.sheet-foot .btn:not(.ghost)')).trim(), '3 decks', 'le « i » ne change pas le filtre'); assert.equal(await c.p.$$eval('.crow.dk', r => r.length), 3);
  assert.equal((await txt(c.p, '.sheet-foot .btn:not(.ghost)')).trim(), '3 decks');
  await c.p.click('.sheet .th-main[data-s="combo"]'); assert.equal((await txt(c.p, '.sheet-foot .btn:not(.ghost)')).trim(), '1 deck');
  assert.equal(await c.p.$$eval('.sheet .th-desc:not([hidden])', b => b.length), 1, 'la description ouverte le reste après un choix'); await c.p.click('.sheet .th-i[data-i="control"]'); assert.equal(await c.p.$$eval('.sheet .th-desc:not([hidden])', b => b.length), 0, 'un 2e toucher la replie');
  await c.p.click('.sheet-foot .btn:not(.ghost)'); await c.p.waitForFunction(() => !document.querySelector('.sheet'));
  await c.p.waitForFunction(() => document.querySelectorAll('.crow.dk').length === 1);
  assert.match(await sum(), /1 deck sur 4.*thèmes : Contrôle \+ Combo/); assert.match((await names(c.p))[0], /^Tymna/); assert.deepEqual((await chips()).filter(x => x.endsWith('*')), ['Contrôle*', 'Combo*'], 'un thème choisi dans la liste est affiché en puce');
  // liste complète : compteur, effacer, la liste derrière suit
  await c.p.click('.dk-themes [data-act="dthall"]'); await c.p.waitForSelector('.sheet .th-list');
  assert.equal(await c.p.$$eval('.sheet .th-main[aria-pressed="true"]', b => b.length), 2);
  await c.p.click('.sheet .th-main[data-s="stax"]'); assert.equal((await txt(c.p, '.sheet-foot .btn:not(.ghost)')).trim(), '1 deck', 'Tymna a aussi Stax');
  assert.equal(await c.p.$eval('.sheet .th-main[data-s="sacrifice"]', x => x.disabled), true, 'Sacrifice : plus aucun deck avec ce thème parmi ceux qui restent → grisé, non cliquable'); assert.match(await txt(c.p, '.sheet .th-row.th-zero .th-main'), /0$/);
  assert.equal(await c.p.$$eval('.crow.dk', r => r.length), 1, 'la liste derrière la feuille suit les choix');
  await c.p.click('#thClr'); assert.equal((await txt(c.p, '.sheet-foot .btn:not(.ghost)')).trim(), '4 decks'); assert.equal(await c.p.$$eval('.sheet .th-main[aria-pressed="true"]', b => b.length), 0);
  // compteurs dynamiques : ceux des decks qui restent (couleurs, recherche, thèmes déjà choisis), liste reclassée, zéros grisés en dernier
  const rowsTxt = () => c.p.$$eval('.sheet .th-main', b => b.map(x => x.querySelector('span').textContent + ' ' + x.querySelector('small').textContent));
  assert.deepEqual(await rowsTxt(), ['Contrôle 3', 'Aristocrats 2', 'Gain de vie 2', 'Sacrifice 2', 'Jetons 2', 'Combo 1', 'Ramp 1', 'Spellslinger 1', 'Stax 1'], 'sans filtre : nombre de decks du fichier, du plus au moins présent');
  await c.p.click('.sheet-foot .btn:not(.ghost)'); await c.p.waitForFunction(() => !document.querySelector('.sheet'));
  for (const k of 'WUBG') await c.p.click(`.dk-ctl [data-act="dcol"][data-c="${k}"]`);
  await c.p.waitForFunction(() => document.querySelectorAll('.crow.dk').length === 2);      // Tymna + Craterhoof (Edgar a du rouge)
  assert.deepEqual(await chips(), ['Contrôle', 'Combo', 'Ramp', 'Spellslinger', 'Stax'], 'les puces suivent les couleurs : seuls les thèmes des decks restants');
  await c.p.click('.dk-themes [data-act="dthall"]'); await c.p.waitForSelector('.sheet .th-list');
  assert.deepEqual(await rowsTxt(), ['Contrôle 1', 'Combo 1', 'Ramp 1', 'Spellslinger 1', 'Stax 1', 'Aristocrats 0', 'Gain de vie 0', 'Sacrifice 0', 'Jetons 0'], 'mono-couleurs W U B G : comptés sur les decks restants, thèmes absents à 0 en bas');
  assert.equal(await c.p.$$eval('.sheet .th-row.th-zero .th-main:disabled', b => b.length), 4, 'les 4 thèmes à zéro sont grisés'); assert.equal(await c.p.$$eval('.sheet .th-zero .th-i', b => b.length), 4, 'leur « i » reste disponible');
  await c.p.click('.sheet .th-main[data-s="stax"]'); assert.equal((await txt(c.p, '.sheet-foot .btn:not(.ghost)')).trim(), '1 deck');
  assert.deepEqual((await rowsTxt()).slice(0, 5), ['Stax 1', 'Contrôle 1', 'Combo 1', 'Ramp 1', 'Spellslinger 1'], 'le thème choisi passe devant à égalité');
  await c.p.click('#thClr'); await c.p.click('.sheet-foot .btn:not(.ghost)'); await c.p.waitForFunction(() => !document.querySelector('.sheet'));
  for (const k of 'WUBG') await c.p.click(`.dk-ctl [data-act="dcol"][data-c="${k}"]`);
  await c.p.waitForFunction(() => document.querySelectorAll('.crow.dk').length === 4);
  await c.p.fill('#dkQ', 'tymna'); await c.p.waitForTimeout(260);      // pendant la frappe, la barre de thèmes est mise à jour sur place
  assert.deepEqual(await chips(), ['Contrôle', 'Combo', 'Ramp', 'Spellslinger', 'Stax'], 'les puces suivent la recherche'); assert.equal(await c.p.evaluate(() => document.activeElement && document.activeElement.id), 'dkQ', 'le champ garde le focus');
  await c.p.click('[data-act="dqx"]'); await c.p.waitForFunction(() => document.querySelectorAll('.crow.dk').length === 4); assert.deepEqual(await chips(), ['Contrôle', 'Aristocrats', 'Gain de vie', 'Sacrifice', 'Jetons']);
  await c.p.click('.dk-themes [data-act="dthall"]'); await c.p.waitForSelector('.sheet .th-list');
  await c.p.click('.sheet .th-main[data-s="tokens"]'); assert.equal((await txt(c.p, '.sheet-foot .btn:not(.ghost)')).trim(), '2 decks');
  assert.deepEqual(await rowsTxt(), ['Jetons 2', 'Contrôle 2', 'Aristocrats 2', 'Gain de vie 2', 'Sacrifice 2', 'Combo 0', 'Ramp 0', 'Spellslinger 0', 'Stax 0'], 'thème choisi : les autres comptés parmi ses decks ; la liste repart du haut');
  await c.p.click('.sheet-foot .btn:not(.ghost)'); await c.p.waitForFunction(() => !document.querySelector('.sheet'));
  assert.equal(await c.p.$$eval('.crow.dk', r => r.length), 2); assert.match(await sum(), /2 decks sur 4.*thème : Jetons/); assert.ok((await chips()).includes('Jetons*'));
  // feuille d'un deck : tous les thèmes du commandant, avec leur nombre de decks EDHREC
  await c.p.click('.crow.dk >> nth=0'); await c.p.waitForSelector('.sheet .ci-sum');
  assert.equal((await txt(c.p, '.sheet .ci-sum .ci-thd summary')).replace(/\s+/g, ' ').trim(), 'Thèmes EDHREC : Aristocrats (500) · Gain de vie (300) · Contrôle (100) · Jetons (90) · Sacrifice (80)');
  assert.equal(await c.p.$eval('.sheet .ci-thd', d => d.open), false, 'replié au départ'); await c.p.click('.sheet .ci-thd summary');
  assert.equal(await c.p.$$eval('.sheet .ci-thl dt', x => x.length), 5); assert.equal(await c.p.$$eval('.sheet .ci-thl dd', x => x.length), 5, 'une description par thème');
  assert.equal(await c.p.$$eval('.sheet .ci-thl dd .th-ex', x => x.length), 5, 'cartes exemples sur leur propre ligne'); assert.match(await txt(c.p, '.sheet .ci-thl dd'), /Variante du sacrifice/, 'Aristocrats en premier (le plus fréquent)');
  await c.p.click('.sheet .icon-btn[data-close]'); await c.p.waitForFunction(() => !document.querySelector('.sheet'));
  // un thème décoché : tout revient ; thème retiré de la sélection si le fichier chargé ne le connaît pas
  await c.p.click('.dk-themes [data-s="tokens"]'); await c.p.waitForFunction(() => document.querySelectorAll('.crow.dk').length === 4); assert.ok(!/thème/.test(await sum()));
  ok('thèmes EDHREC : puces (noms FR, 5 + « Tous (9) »), 3 thèmes par deck, filtre ET, feuille avec « i » (descriptions), compteur / effacer, thèmes décrits dans la feuille du deck, Archidekt hérite du commandant');
  await c.ctx.close();
  // fichier sans thèmes : aucune puce, aucune ligne de thèmes
  body = PLAIN; const d = await newPage(browser, world);
  await d.p.route('**/edh.bin.gz', r => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'content-encoding': 'gzip' }, body })); await d.p.route('**/edh.tsv', r => r.fulfill({ status: 404, body: '{}' }));
  await openDecks(d.p); assert.equal(await d.p.$$eval('.dk-themes', x => x.length), 0); assert.equal(await d.p.$$eval('.dk-th', x => x.length), 0); assert.equal((await names(d.p)).length, 4);
  await d.p.click('.crow.dk >> nth=0'); await d.p.waitForSelector('.sheet .ci-sum'); assert.equal(await d.p.$$eval('.sheet .ci-thd', x => x.length), 0);
  ok('fichier sans thèmes : ni puces ni lignes de thèmes, decks inchangés'); await d.ctx.close();
}

/* ── 7) accueil, « Deck à monter » : part possédée et coût pour finir (règle de homePick), decks d'au moins 60 cartes ─────────────── */
{
  // de bout en bout : Edgar 40/60 (20 manquantes à 5 €) bat Craterhoof 54/60 (6 manquantes à 100 €) ; Tymna (3/60) écarté
  const fill = (a, b) => Array.from({ length: b - a }, (_, i) => `K\t1\tFiller ${a + i}`), px = (a, b, c) => Array.from({ length: b - a }, (_, i) => `P\t${c}\tFiller ${a + i}`);
  const FILE60 = ['#edh\t1\t2026-10-03T04:00:00Z', 'C\tedgar-markov\t12345\tWBR\tEdgar Markov', 'C\tcraterhoof-behemoth\t9000\tG\tCraterhoof Behemoth', 'C\ttymna-thrasios\t4000\tWUBG\tTymna the Weaver\tThrasios, Triton Hero',
    'D\tedgar-markov\tedhrec\tDeck moyen\t', ...fill(0, 59), 'D\tcraterhoof-behemoth\tedhrec\tDeck moyen\t', ...fill(100, 159), 'D\ttymna-thrasios\tedhrec\tDeck moyen\t', ...fill(200, 258),
    ...px(39, 59, 500), ...px(153, 159, 10000), ...px(203, 258, 10)].join('\n') + '\n';
  const own = ['1 Edgar Markov', '1 Craterhoof Behemoth', ...Array.from({ length: 39 }, (_, i) => `1 Filler ${i}`), ...Array.from({ length: 53 }, (_, i) => `1 Filler ${100 + i}`), '1 Filler 200', '1 Filler 201', '1 Filler 202'].join('\n');
  const h = await newPage(browser, world, { goto: false, init: `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: ${JSON.stringify(own)}, u: 1, s: '', b: null })); } catch (e) {}` });
  await h.p.route('**/edh.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: FILE60 }));
  await h.p.goto(world.url); await h.p.waitForTimeout(500); await signInFake(h.p); await toHome(h.p); await h.p.waitForFunction(() => document.querySelector('#btnBuild').dataset.lock === '0');      // accueil repeint après la connexion
  assert.equal(await txt(h.p, '#hmBuildSub'), 'Decks EDHREC comparés à ta collection', 'avant le fichier (lu 2,5 s après l\'accueil) : la phrase d\'attente');
  await h.p.waitForFunction(() => HM.best, null, { timeout: 12000 }); await h.p.waitForTimeout(200);
  assert.equal(await txt(h.p, '#hmBuildPct'), '66 %'); assert.equal(await h.p.$eval('#hmBuildSub .hm-bn', e => e.textContent), 'Edgar Markov'); assert.equal((await h.p.$eval('#hmBuildSub .hm-bc', e => e.textContent)).replace(/\s/g, ' '), '≈ 100 € pour finir');
  assert.equal((await h.p.$eval('#btnBuild', e => e.getAttribute('aria-label'))).replace(/\s/g, ' '), 'Deck à monter : Edgar Markov, 66 % des cartes déjà possédées, ≈ 100 € pour finir');
  await h.p.$eval('#btnBuild', e => e.scrollIntoView({ block: 'center' })); await h.p.waitForTimeout(300); await h.p.screenshot({ path: 'shots/edh-7-accueil.png' });
  await h.p.click('#btnBuild'); await h.p.waitForSelector('.sheet .ci-sum', { timeout: 6000 });
  assert.match(await txt(h.p, '.sheet-head h2'), /^Edgar Markov$/); assert.match(await txt(h.p, '.sheet .ci-sum'), /^20 cartes à acheter · ≈ 100,00 €/, 'la feuille donne le même coût');
  ok('accueil : « 66 % · Edgar Markov · ≈ 100 € pour finir » (Craterhoof à 90 % mais 600 € à payer : derrière), feuille du deck au toucher');
  // règle seule : 62 % à 84 € (score 31) devant 40 % à 20 € (30) et 90 % à 900 € (25) ; moins de 10 % ou moins de 60 cartes : écartés ; un deck complet l'emporte
  const R = (name, total, have, cost, rank, unpriced = 0) => ({ total, have, cost, unpriced, miss: total - have, cmd: { names: [name], rank } });
  const pick = rows => h.p.evaluate(rs => { const b = homePick(rs); return b && b.r.cmd.names[0]; }, rows);
  assert.equal(await pick([R('A90', 100, 90, 90000, 1), R('B62', 100, 62, 8400, 2), R('C40', 100, 40, 2000, 3), R('D9', 100, 9, 0, 4), R('E50', 50, 50, 0, 5)]), 'B62');
  assert.equal(await pick([R('B62', 100, 62, 8400, 2), R('F100', 100, 100, 0, 9)]), 'F100', 'deck déjà complet');
  assert.equal(await pick([R('D9', 100, 9, 0, 4), R('E50', 50, 50, 0, 5)]), null, 'rien d\'assez avancé');
  assert.equal(await pick([R('G1', 100, 50, 4000, 7), R('G2', 100, 50, 4000, 3)]), 'G2', 'à égalité : le commandant le plus joué');
  assert.equal(await pick([R('H1', 100, 50, 900, 7, 30)]), 'H1', 'cartes sans prix comptées 1 € pièce, sans écarter le deck');
  const cost = (miss, c) => h.p.evaluate(([m, c]) => homeCostText({ miss: m, cost: c }).replace(/\s/g, ' '), [miss, c]);
  assert.equal(await cost(0, 0), 'Rien à acheter'); assert.equal(await cost(3, 0), '3 cartes à trouver'); assert.equal(await cost(2, 450), '≈ 4,50 € pour finir', 'moins de 10 € : au centime'); assert.equal(await cost(9, 123456), '≈ 1 235 € pour finir');
  ok('Deck à monter : règle part possédée − 10 points par doublement du coût au-delà de 10 € (62 % à 84 € > 40 % à 20 € > 90 % à 900 €), seuil 10 %, ≥ 60 cartes, complet d\'abord, coût en mots');
  assert.deepEqual(h.errs, []); await h.ctx.close();
}

/* ── 9) interrupteurs du serveur (/__ping off) : Archidekt coupé → ses decks retirés, copie de l'appareil comprise ; EDHREC coupé → decks cachés,
   tuile et filtre « Joués en commandant » retirés, copie effacée, fichier plus demandé ───────────────────────────────────────────────────── */
{
  let off = [], bins = 0;
  const w = await newPage(browser, world, { goto: false });
  await w.p.route('**/__ping', async r => { const res = await r.fetch(); r.fulfill({ response: res, json: { ...(await res.json()), off } }); });
  await w.p.route('**/edh.bin.gz', r => { bins++; return r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'content-encoding': 'gzip' }, body: BIN }); });
  await w.p.route('**/edh.tsv', r => r.fulfill({ status: 404, body: '{}' }));
  await w.p.goto(world.url); await w.p.waitForTimeout(700);
  await openDecks(w.p);
  await w.p.waitForFunction(() => document.querySelectorAll('.crow.dk').length === 4);
  await w.p.evaluate(() => { CTX.off = ['archidekt']; edhOffApply(); });
  await w.p.waitForFunction(() => EDH.data && document.querySelectorAll('.crow.dk').length === 3, null, { timeout: 5000 });
  assert.equal(await w.p.evaluate(() => EDH.data.decks.filter(d => d.src === 'archidekt').length), 0, 'copie de l\'appareil relue sans les decks Archidekt');
  ok('Archidekt coupé par le serveur : ses decks retirés de la copie déjà chargée (3 decks EDHREC restent)');
  await w.p.evaluate(() => { CTX.off = ['edhrec']; edhOffApply(); });
  await w.p.waitForSelector('.coll .gate[data-gate="off"]');
  assert.equal(await txt(w.p, '.coll .gate[data-gate="off"] b'), 'Decks EDHREC indisponibles pour le moment');
  await w.p.waitForFunction(() => $('#btnBuild').hidden, null, { timeout: 3000 });      // accueil repeint en différé (homeSoon)
  assert.deepEqual(await w.p.evaluate(async () => [EDH.data, await Cache.get('edh:v2', 1e12), $('#btnBuild').hidden, $('#btnBuild').parentElement.classList.contains('two')]), [null, null, true, true], 'données et copie effacées, tuile « Deck à monter » retirée');
  await w.p.evaluate(() => closeCollection()); await w.p.waitForTimeout(400); await w.p.click('#btnColl'); await w.p.waitForSelector('.coll.on'); await w.p.click('#collSeg [data-v="list"]'); await w.p.click('.coll .fbtn');
  assert.deepEqual(await w.p.$$eval('.coll .fopt[data-x]', b => b.map(x => x.dataset.x).filter(x => x === 'can' || x === 'played')), ['can'], 'filtre « Joués en commandant » retiré');
  await w.p.click('#collSeg [data-v="decks"]'); await w.p.waitForSelector('.coll .gate[data-gate="off"]');
  // relancée avec EDHREC coupé : rien de téléchargé
  off = ['edhrec']; bins = 0; await w.p.reload(); await w.p.waitForTimeout(700); await signInFake(w.p);
  await w.p.waitForFunction(() => CTX.off.includes('edhrec')); await w.p.click('#btnBuild').catch(() => {});
  assert.equal(await w.p.evaluate(() => $('#btnBuild').hidden), true);
  await w.p.click('#btnColl'); await w.p.waitForSelector('.coll.on'); await w.p.click('#collSeg [data-v="decks"]'); await w.p.waitForSelector('.coll .gate[data-gate="off"]'); await w.p.waitForTimeout(3000);
  assert.equal(bins, 0, 'fichier EDH jamais demandé');
  ok('EDHREC coupé : écran « Decks EDHREC indisponibles », copie effacée, tuile et filtre « Joués » retirés ; au lancement suivant, rien de téléchargé');
  assert.deepEqual(w.errs, []); await w.ctx.close();
}

console.log('erreurs page :', [...errs, ...b.errs].length ? [...errs, ...b.errs] : 'aucune'); assert.deepEqual([...errs, ...b.errs], []);
await browser.close(); world.stop(); console.log('\nEDH E2E OK'); process.exit(0);
