// E2E collection : import CSV, infos Scryfall, filtres, stats, saisie à la main, persistance ; déduction du panier ; réf. Cardmarket ;
// commandant ; évolution des prix ; filtres du viewer ; partage et reprise.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, done, txt, ok, CARDS } from './e2e-world.mjs';

const world = await startWorld({ port: 18900 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const { p, errs } = await newPage(browser, world);
const scryCalls = pat => world.scry.filter(s => pat.test(s)).length;
const rows = () => p.$$eval('.crow', r => r.map(x => ({ k: x.dataset.k, name: x.querySelector('.row-name').textContent, q: Number(x.querySelector('.qstep b').textContent), tags: [...x.querySelectorAll('.tag')].map(t => t.textContent.replace(/\s+/g, ' ').trim()), px: [...x.querySelectorAll('.px')].map(t => t.textContent.replace(/\s+/g, ' ').trim()) })));
const flush = ms => p.waitForTimeout(ms);

/* ── 1) collection vide → import CSV ManaBox ─────────────────────────────────────────────────── */
assert.match(await txt(p, '#collSub'), /Ajoute tes cartes/); assert.equal(await p.$eval('#btnColl', b => b.dataset.empty), '1'); ok('page de saisie : section collection vide');
await p.screenshot({ path: 'shots/coll-0-saisie.png' });
await p.click('#btnColl'); await p.waitForSelector('.coll.on');
assert.match(await txt(p, '.coll .dv-empty'), /Ta collection est vide/); assert.equal(await p.$eval('#app', a => a.inert), true);
await p.click('.coll-tools [data-act="import"]'); await p.waitForSelector('#ciText');
const CSV = `Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency
Sol Ring,CMM,Commander Masters,400,normal,uncommon,1,1,x,1.00,false,false,near_mint,en,EUR
"Sol Ring",C21,Commander 2021,263,normal,uncommon,2,2,y,1.00,false,false,near_mint,en,EUR
Swords to Plowshares,CMM,Commander Masters,401,foil,uncommon,1,3,z,2.00,false,false,near_mint,en,EUR
Llanowar Elves,DOM,Dominaria,168,normal,common,4,4,w,0.20,false,false,near_mint,en,EUR`;
await p.fill('#ciText', CSV); await p.waitForTimeout(150);
assert.match(await txt(p, '#ciSum'), /3 cartes différentes · 8 exemplaires Fichier CSV/); assert.equal(await p.$eval('#ciGo', b => b.disabled), false); assert.match(await txt(p, '#ciGo'), /Importer 3 cartes/);
await p.screenshot({ path: 'shots/coll-1-import.png' });
await p.click('#ciGo'); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 3);
assert.match(await txt(p, '.coll .dv-title span'), /^3 cartes · 8 exemplaires · sur cet appareil/); ok('import CSV : éditions additionnées (3 cartes, 8 exemplaires)');
// infos Scryfall lues par lot (une seule requête POST pour 3 cartes)
await p.waitForFunction(() => document.querySelectorAll('.crow .px.cm').length === 3, null, { timeout: 8000 });
assert.equal(scryCalls(/^POST \/cards\/collection/), 1);
let r = await rows(); const by = Object.fromEntries(r.map(x => [x.name, x]));
assert.deepEqual(r.map(x => x.name), ['Llanowar Elves', 'Sol Ring', 'Swords to Plowshares'], 'tri par nom'); assert.equal(by['Sol Ring'].q, 3);
assert.deepEqual(by['Sol Ring'].tags, ['Artefacts', 'Coût 1']); assert.deepEqual(by['Llanowar Elves'].tags, ['Créatures', 'Coût 1']); assert.deepEqual(by['Sol Ring'].px, ['CM 1,50 €'], 'prix Cardmarket (tendance) à gauche de la quantité'); assert.deepEqual(by['Llanowar Elves'].px, ['CM 0,20 €']);
await p.waitForFunction(() => document.querySelectorAll('.crow .thumb img.ok').length >= 3, null, { timeout: 8000 });
await p.screenshot({ path: 'shots/coll-2-liste.png' });
ok('infos Scryfall : type, coût, prix de référence, images');

/* ── 2) recherche + filtres ─────────────────────────────────────────────────────────────────── */
await p.fill('.coll .fsearch input', 'swo'); await p.waitForTimeout(300); assert.deepEqual((await rows()).map(x => x.name), ['Swords to Plowshares']); assert.match(await txt(p, '.coll-count'), /1 carte sur 3/);
await p.click('.coll .fclear'); await p.waitForTimeout(250); assert.equal((await rows()).length, 3);
await p.click('.coll .fbtn'); await p.waitForSelector('.coll .fpanel:not([hidden])');
await p.click('.coll .fcol[data-c="G"]'); assert.deepEqual((await rows()).map(x => x.name), ['Llanowar Elves']); assert.equal(await txt(p, '.coll .fbtn b'), '1');
await p.click('.coll .fcol[data-c="G"]'); await p.click('.coll .fopt[data-t="Artefacts"]'); assert.deepEqual((await rows()).map(x => x.name), ['Sol Ring']);
await p.click('.coll .fopt[data-t="Artefacts"]'); await p.click('.coll .fopt[data-m="2"]'); assert.equal((await rows()).length, 0); assert.match(await txt(p, '.coll .listempty'), /Aucune carte ne correspond/);
await p.click('.coll .fopt[data-m="2"]'); await p.click('.coll .fopt[data-m="1"]'); await p.click('.coll .fcol[data-c="W"]'); assert.deepEqual((await rows()).map(x => x.name), ['Swords to Plowshares'], 'coût 1 ET couleur blanche');
await p.click('.coll .fcol[data-c="C"]'); assert.deepEqual((await rows()).map(x => x.name), ['Sol Ring', 'Swords to Plowshares'], 'blanc OU incolore');
await p.screenshot({ path: 'shots/coll-3-filtres.png' });
await p.click('.coll .freset'); assert.equal((await rows()).length, 3); assert.equal(await p.$eval('.coll .fbtn b', b => b.hidden), true);
await p.selectOption('#collSort', 'qty'); assert.deepEqual((await rows()).map(x => x.name), ['Llanowar Elves', 'Sol Ring', 'Swords to Plowshares'], 'quantité décroissante');
await p.selectOption('#collSort', 'price'); assert.deepEqual((await rows()).map(x => x.name), ['Swords to Plowshares', 'Sol Ring', 'Llanowar Elves'], 'prix décroissant');
await p.selectOption('#collSort', 'name');
ok('recherche, filtres couleur / famille / coût combinés (ET entre critères, OU entre couleurs), tris');
// tri par date d'ajout : récentes en haut / anciennes en haut ; cartes sans date classées à part, par nom
await p.evaluate(() => { COLL.map['sol ring'].d = 1760000100; COLL.map['swords to plowshares'].d = 1760000900; delete COLL.map['llanowar elves'].d; collPaintBody(false); });
await p.selectOption('#collSort', 'new'); assert.deepEqual((await rows()).map(x => x.name), ['Swords to Plowshares', 'Sol Ring', 'Llanowar Elves'], 'récentes en haut, sans date en bas');
await p.screenshot({ path: 'shots/coll-date.png' }); assert.match(await txt(p, '.coll-count'), /1 carte sans date d'ajout .* en bas, par nom/); assert.ok((await rows())[0].tags.some(t => /\d.*:\d/.test(t)), 'date et heure d\'ajout sur la ligne');
await p.selectOption('#collSort', 'old'); assert.deepEqual((await rows()).map(x => x.name), ['Llanowar Elves', 'Sol Ring', 'Swords to Plowshares'], 'anciennes en haut, sans date en haut');
await p.evaluate(() => collBump('mox amber', 'Mox Amber', 1)); await p.waitForTimeout(100);
assert.equal(await p.evaluate(() => COLL.map['mox amber'].d > 1760000900), true, 'carte ajoutée : daté de maintenant'); await p.selectOption('#collSort', 'new'); assert.equal((await rows())[0].name, 'Mox Amber', 'la dernière ajoutée est en haut');
assert.match(await p.evaluate(() => localStorage.getItem('deckdeal:coll:v1')), /Mox Amber \(D[0-9a-z]{6}\)/, 'date enregistrée avec la collection');
await p.evaluate(() => collBump('mox amber', 'Mox Amber', -1)); await p.waitForTimeout(100); await p.selectOption('#collSort', 'name');
ok('tri par date d\'ajout (récentes / anciennes en haut), date posée à l\'ajout, enregistrée'); 

/* ── 3) stats ───────────────────────────────────────────────────────────────────────────────── */
await p.click('#collSeg [data-v="stats"]'); await p.waitForSelector('.cs-tiles');
assert.equal(await p.$$eval('.cs-tiles > div b', b => b.map(x => x.textContent.replace(/\s+/g, ' ')).join('|')), '3|8|7,20 €');
assert.deepEqual(await p.$$eval('.cs-bars .cs-b', b => b.map(x => x.querySelector('.cs-l').textContent + '=' + x.querySelector('.cs-n').textContent)), ['WBlanc=1', 'GVert=4', 'CIncolore=3', 'Créatures=4', 'Artefacts=3', 'Éphémères=1']);
assert.equal(await p.$$eval('.dv-bar .dv-n', b => b.map(x => x.textContent).join(',')), ',8,,,,,,', 'courbe : 8 sorts à 1');
assert.deepEqual(await p.$$eval('.cs-top .crow .row-name', n => n.map(x => x.textContent)), ['Sol Ring', 'Swords to Plowshares', 'Llanowar Elves'], 'les plus chères : par lot (prix × exemplaires)');
assert.deepEqual(await p.$$eval('.cs-top .crow .row-price', n => n.map(x => [...x.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()).join(' '))), ['4,50 € 1,50 € × 3', '1,90 €', '0,80 € 0,20 € × 4'], 'lot en gros, prix × quantité dessous ; une seule carte : rien de plus');
assert.deepEqual(await p.$$eval('.cs-top .crow .row-meta', n => n.map(x => x.textContent.trim())), ['× 3', '', '× 4'], 'quantité visible quand il y en a plusieurs');
await p.click('.cs-h [data-v="one"]'); assert.deepEqual(await p.$$eval('.cs-top .crow .row-name', n => n.map(x => x.textContent)), ['Swords to Plowshares', 'Sol Ring', 'Llanowar Elves'], 'par carte : prix d\'un exemplaire');
assert.deepEqual(await p.$$eval('.cs-top .crow .row-price', n => n.map(x => [...x.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()).join(' '))), ['1,90 €', '1,50 € × 3 = 4,50 €', '0,20 € × 4 = 0,80 €']); assert.equal(await p.getAttribute('.cs-h [data-v="one"]', 'aria-pressed'), 'true');
await p.click('.cs-h [data-v="lot"]');
// plus de 10 cartes : tranches de 10, « Afficher plus » jusqu'au bout
await p.evaluate(() => { for (let i = 0; i < 25; i++) { const k = 'zz test ' + i; COLL.map[k] = { n: 'ZZ Test ' + i, q: i % 3 + 1 }; COLL.meta[k] = { cm: 1, tl: 'Artifact', cl: '', eu: 100 + i * 10 }; } collPaintBody(false); });
assert.equal(await p.$$eval('.cs-top .crow', r => r.length), 10); assert.match(await txt(p, '[data-act="topmore"]'), /Afficher 10 de plus · 18 restantes/);
await p.click('[data-act="topmore"]'); assert.equal(await p.$$eval('.cs-top .crow', r => r.length), 20); assert.match(await txt(p, '[data-act="topmore"]'), /Afficher 8 de plus · 8 restantes/);
await p.click('[data-act="topmore"]'); assert.equal(await p.$$eval('.cs-top .crow', r => r.length), 28); assert.equal(await p.$('[data-act="topmore"]'), null, 'tout est affiché');
assert.equal(await p.$eval('.cs-top .crow:last-child .row-name', e => e.textContent), 'Llanowar Elves', 'la plus petite en dernier'); assert.ok(await p.$eval('.dv-scroll', e => e.scrollHeight > e.clientHeight + 200), 'la liste défile');
await p.click('.cs-h [data-v="one"]'); assert.equal(await p.$$eval('.cs-top .crow', r => r.length), 10, 'changer de classement repart à 10'); await p.click('.cs-h [data-v="lot"]');
await p.evaluate(() => { for (let i = 0; i < 25; i++) { delete COLL.map['zz test ' + i]; delete COLL.meta['zz test ' + i]; } COLL.topN = 10; collPaintBody(false); });
await p.screenshot({ path: 'shots/coll-4-stats.png' });
await p.click('#collSeg [data-v="list"]'); await p.waitForSelector('.crow');
ok('onglet Stats : cartes, exemplaires, valeur, courbe, couleurs, familles, plus chères');

/* ── 4) quantités + annulation, ajout à la main ─────────────────────────────────────────────── */
await p.click('.crow[data-k="llanowar elves"] [data-d="1"]'); assert.equal((await rows()).find(x => x.name === 'Llanowar Elves').q, 5);
// « − » : confirmation d'abord (Annuler ne retire rien ; au dernier exemplaire le message le dit)
await p.click('.crow[data-k="llanowar elves"] [data-d="-1"]'); await p.waitForSelector('.sheet [data-ok]'); assert.match(await txt(p, '.sheet h2'), /Retirer un exemplaire \?/); assert.match(await txt(p, '.sheet .cf-msg'), /Llanowar Elves\s*Il en restera 4 sur 5/);
await p.click('.sheet .sheet-foot .btn.ghost'); await p.waitForFunction(() => !document.querySelector('.sheet')); assert.equal((await rows()).find(x => x.name === 'Llanowar Elves').q, 5, 'Annuler : rien de retiré');
await p.click('.crow[data-k="llanowar elves"] [data-d="-1"]'); await p.waitForSelector('.sheet [data-ok]'); await p.click('.sheet [data-ok]'); await p.waitForFunction(() => !document.querySelector('.sheet')); assert.equal((await rows()).find(x => x.name === 'Llanowar Elves').q, 4, 'Retirer : un exemplaire de moins');
await p.click('.crow[data-k="llanowar elves"] [data-d="1"]'); assert.equal((await rows()).find(x => x.name === 'Llanowar Elves').q, 5);
await p.click('.crow[data-k="swords to plowshares"] [data-d="-1"]'); await p.waitForSelector('.sheet [data-ok]'); assert.match(await txt(p, '.sheet h2'), /Retirer de la collection \?/); assert.match(await txt(p, '.sheet .cf-msg'), /Dernier exemplaire/);
await p.click('.sheet [data-ok]'); await p.waitForSelector('#toast.on .toast-act');
assert.equal((await rows()).length, 2); assert.match(await txt(p, '#toast'), /Swords to Plowshares retirée/);
await p.click('#toast .toast-act'); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 3); ok('+ / −, retrait à zéro et Annuler');
await p.click('.coll-tools [data-act="add"]'); await p.waitForSelector('#caName'); await p.fill('#caName', 'arca');
await p.waitForSelector('.ca-opt'); assert.deepEqual(await p.$$eval('.ca-opt span', s => s.map(x => x.textContent)), ['Arcane Signet']);
await p.click('.ca-opt'); await p.waitForTimeout(250); assert.match(await txt(p, '#caStatus'), /Arcane Signet · 1 dans ta collection/);
await p.fill('#caName', 'ring'); assert.deepEqual(await p.$$eval('.ca-opt i', s => s.map(x => x.textContent)), ['× 3'], 'quantité déjà possédée affichée');
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('#caName'), null, { timeout: 3000 });
await p.waitForFunction(() => document.querySelectorAll('.crow').length === 4); assert.match(await txt(p, '.coll .dv-title span'), /^4 cartes · 10 exemplaires/);
await p.waitForFunction(() => document.querySelectorAll('.crow .px.cm').length === 4, null, { timeout: 8000 }); assert.equal(scryCalls(/^POST \/cards\/collection/), 2, 'seule la nouvelle carte est lue');
ok('ajout à la main : suggestions du catalogue, quantité déjà possédée, infos lues pour la seule nouvelle carte');

/* ── 5) persistance ──────────────────────────────────────────────────────────────────────── */
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.coll'), null, { timeout: 3000 });
assert.match(await txt(p, '#collSub'), /^4 cartes · 10 exemplaires$/);
const callsBefore = scryCalls(/^POST \/cards\/collection/);
await p.reload(); await p.waitForTimeout(900);
assert.match(await txt(p, '#collSub'), /^4 cartes · 10 exemplaires$/); await p.click('#btnColl'); await p.waitForSelector('.crow .px.cm', { timeout: 5000 });
assert.equal(scryCalls(/^POST \/cards\/collection/), callsBefore, 'infos Scryfall gardées (cache), rien à relire');
assert.equal((await rows()).length, 4); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok('rechargement : collection et infos gardées sur l\'appareil, aucune requête');

/* ── 5b) sauvegarde : l'état est dit en toutes lettres, export, compte plus récent = annulable ──────────────── */
await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.waitForFunction(() => !document.querySelector('.coll-sync').hidden, null, { timeout: 8000 });
assert.match(await txt(p, '.coll-sync'), /ne sont que sur cet appareil/); assert.ok(['warn', 'bad'].includes(await p.$eval('.coll-sync', e => e.dataset.k)), 'hors compte : bandeau d\'alerte');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.coll-sync [data-act="export"]')]);
assert.match(dl.suggestedFilename(), /^ma-collection-\d{4}-\d{2}-\d{2}\.txt$/); const exported = (await import('node:fs')).readFileSync(await dl.path(), 'utf8'); assert.match(exported, /\d+ Sol Ring/); assert.equal(exported.trim().split('\n').length, 4, 'une ligne par carte (réimportable)');
await p.screenshot({ path: 'shots/coll-sync-local.png' });
await p.evaluate(() => { D.user = { uid: 'u1' }; D.uid = 'u1'; COLL.cloud = 'ok'; COLL.s = 'u1'; collPaintHead(); });
assert.match(await txt(p, '.coll-sync'), /Sauvegardée dans ton compte/); assert.equal(await p.$eval('.coll-sync', e => e.dataset.k), 'ok');
await p.evaluate(() => { COLL.cloud = 'error'; COLL.err = 'Règles Firestore à publier pour la collection'; collPaintHead(); });
assert.match(await txt(p, '.coll-sync'), /Pas sauvegardée dans ton compte : Règles Firestore à publier/); assert.equal(await p.$eval('.coll-sync', e => e.dataset.k), 'bad'); assert.ok(await p.$('.coll-sync [data-act="resync"]'));
await p.screenshot({ path: 'shots/coll-sync-erreur.png' });
const before4 = await p.evaluate(() => JSON.stringify(COLL.map));
// un autre appareil a retiré 3 cartes et baissé Sol Ring : appliqué carte par carte (la base = ce qu'on avait vu du compte)
await p.evaluate(() => { COLL.base = collClone(COLL.map); COLL.cloud = 'ok'; collFromCloud('u1', { text: '2 Sol Ring', count: 1, updatedAt: Date.now() + 5000 }, false, false); });
await p.waitForFunction(() => document.querySelectorAll('.crow').length === 1); assert.match(await txt(p, '#toast'), /Autre appareil : −3 cartes/);
assert.equal((await rows())[0].q, 2, 'quantité du compte'); assert.equal(await p.evaluate(() => sameColl(COLL.base, collFromText('2 Sol Ring'))), true, 'base = dernier état du compte');
await p.evaluate(m => { COLL.map = JSON.parse(m); collChanged({ push: false }); }, before4); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 4);
ok('sauvegarde : bandeau clair (appareil / compte / erreur), export .txt réimportable, changements d\'un autre appareil appliqués carte par carte');
await p.evaluate(() => { D.user = null; D.uid = null; COLL.cloud = 'off'; COLL.s = ''; collPaintHead(); });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);

/* ── 6) deck : la collection est déduite ─────────────────────────────────────────────────────── */
// collection de départ propre : 1 Sol Ring, 1 Llanowar Elves (le deck en veut 2)
await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('.coll-tools [data-act="import"]'); await p.waitForSelector('#ciText');
await p.fill('#ciText', '1 Sol Ring\n1 Llanowar Elves'); await p.click('#ciMode [data-v="replace"]'); await p.waitForTimeout(150);
assert.match(await txt(p, '#ciSum'), /remplace les 4 cartes actuelles/); await p.click('#ciGo'); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 2);
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const DECK = "Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n1 Swords to Plowshares\n1 Arcane Signet\n1 Wrath of God\n1 Craterhoof Behemoth\n1 Command Tower\n2 Llanowar Elves\n1 Ranger's Hawk\n5 Forest";
await p.fill('#deckText', DECK); await p.waitForTimeout(300);
assert.equal(await p.$eval('#collRow', e => e.hidden), false); assert.match(await txt(p, '#collHint'), /2 cartes de cette liste sont dans ta collection/);
assert.match(await txt(p, '#deckStats'), /8 cartes à chercher 1 déjà possédée 5 terrains de base à part$/, 'en-têtes Commander / Deck : pas de ligne ignorée');
await p.screenshot({ path: 'shots/coll-5-saisie-deck.png' });
await p.click('#btnRun'); await done(p);
assert.equal(world.reqs(100), 0, 'Sol Ring possédé : aucune offre lue'); assert.ok(world.reqs(106) >= 1);
assert.match(await txt(p, '.row[data-key="sol ring"]'), /dans ta collection.*possédée/i);
const llan = await txt(p, '.row[data-key="llanowar elves"]'); assert.match(llan, /1 possédée/i); assert.match(llan, /0,20 €/, 'un seul exemplaire à acheter : 0,20 €'); assert.doesNotMatch(llan, /× 2/);
// total : 0,50 + 2,00 + 3,00 + 9,00 + 0,30 + 0,20 + 5,00 (Edgar) = 20,00 € ; Sol Ring non compté ; basiques à part
await p.waitForTimeout(900); assert.match(await txt(p, '#heroAmt'), /20,00 €/);
ok('collection déduite : Sol Ring non cherché, Llanowar Elves × 2 → 1 à acheter, total sans les cartes possédées');
// réf. Cardmarket par carte
const tagOf = async key => (await p.$$eval(`.row[data-key="${key}"] .tag.ref`, t => t.map(x => x.className + '|' + x.textContent.replace(/\s+/g, ' ').trim())))[0];
assert.equal(await tagOf('swords to plowshares'), 'tag ref ok|CM 1,90 €', '2,00 € pour 1,90 € : +5 % → ok'); assert.equal(await tagOf('wrath of god'), 'tag ref warn|CM 1,50 € · +100 %', '3,00 € pour 1,50 € : très cher');
assert.equal(await tagOf('command tower'), 'tag ref ok|CM 0,25 €'); assert.equal(await tagOf('craterhoof behemoth'), 'tag ref good|CM 9,00 €', 'prix = référence : bon prix');
assert.equal(await tagOf('sol ring'), undefined, 'possédée : pas de référence');
await p.screenshot({ path: 'shots/coll-6-resultats.png' });
ok('réf. Cardmarket par carte : bon prix / correct / cher (+ %), absente sur une carte possédée');

/* ── 7) enregistrer, viewer : commandant, possédées, filtres, réf. totale ────────────────────── */
await p.click('#btnSave2'); await p.waitForSelector('#svName'); await p.fill('#svName', 'Edgar'); await p.click('#svGo'); await p.waitForTimeout(500);
await p.click('#btnViewer'); await p.waitForSelector('.dv.on .dv-g');
assert.equal(await p.$$eval('.dv-cmd', c => c.length), 1); assert.match(await txt(p, '.dv-cmd'), /commandant edgar markov legendary creature — vampire knight .*5,00 €.*réf\. cardmarket 5,00 €/i);
assert.equal(await p.$eval('.dv-body', b => b.firstElementChild.nextElementSibling.id), 'dvCmd', 'le commandant vient juste après le résumé');
assert.deepEqual(await p.$$eval('.dv-g .dvc', t => t.map(x => x.getAttribute('aria-label')).filter(l => /Edgar/.test(l))), [], 'le commandant n\'est pas répété dans les colonnes');
assert.match(await txt(p, '.dv-g[data-g="m1"] .dvc[data-s="own"]'), /possédée/i); assert.match(await txt(p, '.dv-title span'), /· 1 possédée/);
assert.match(await txt(p, '.dv-ref'), /Réf\. Cardmarket pour les mêmes cartes/);
await p.screenshot({ path: 'shots/coll-7-viewer-cmd.png' });
// recherche + filtres dans le viewer
await p.fill('.dv .fsearch input', 'sol'); await p.waitForTimeout(300);
assert.deepEqual(await p.$$eval('.dv-g .dvc', t => t.map(x => x.getAttribute('aria-label'))), ['Sol Ring, dans ta collection']); assert.match(await txt(p, '.dv-fcount'), /1 carte sur 10/); assert.equal(await p.$$eval('.dv-cmd', c => c.length), 0, 'filtre : le commandant suit le filtre');
await p.click('.dv .fclear'); await p.click('.dv .fbtn'); await p.click('.dv .fcol[data-c="W"]'); await p.waitForTimeout(200);
const whites = await p.$$eval('.dv-g .dvc', t => t.map(x => x.getAttribute('aria-label').split(',')[0]).sort()); assert.deepEqual(whites, ["Ranger's Hawk", 'Swords to Plowshares', 'Wrath of God']);
assert.equal(await p.$$eval('.dv-cmd', c => c.length), 1, 'Edgar Markov est aussi blanc');
await p.click('.dv .fcol[data-c="W"]'); await p.click('.dv .fopt[data-t="Créatures"]'); await p.waitForTimeout(200);
assert.deepEqual(await p.$$eval('.dv-g .dvc', t => t.map(x => x.getAttribute('aria-label').split(',')[0]).sort()), ['Craterhoof Behemoth', 'Llanowar Elves', "Ranger's Hawk"]);
await p.screenshot({ path: 'shots/coll-8-viewer-filtres.png' });
await p.click('.dv .freset'); assert.equal(await p.$$eval('.dv-g .dvc', t => t.length), 9, '9 vignettes hors commandant (8 cartes + Forest)');
ok('viewer : commandant en tête (hors colonnes), possédées, réf. totale, recherche et filtres');
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.dv'), null, { timeout: 3000 });



/* ── 8) évolution : nouveaux prix → écarts par carte et par deck ───────────────────────────────── */
world.setPrice(101, 250); world.setPrice(103, 250); world.setPrice(104, 800); // Swords +0,50 · Wrath −0,50 · Craterhoof −1,00
await p.click('#btnBack'); await p.click('#btnDecks'); await p.waitForSelector('#deckList .deck-main');
assert.match(await txt(p, '#deckList .deck-price'), /^20,00 €$/, 'prix du dernier relevé sur la carte du deck, pas encore d\'écart');
await p.click('#deckList .deck-main'); await p.waitForSelector('.dv.on .dv-g');
assert.equal(await p.$$eval('.dv-evo', e => e.length), 0, 'un seul relevé : pas d\'évolution');
await p.click('.dv-age [data-act="refresh"]'); await p.waitForFunction(() => !document.querySelector('.dv'), null, { timeout: 3000 });
await done(p); await p.waitForSelector('#toast.on .toast-act', { timeout: 8000 });
await p.click('#toast .toast-act'); await p.waitForSelector('.dv.on .dv-evo');
assert.match(await txt(p, '.dv-evo-h'), /^Depuis la recherche de \d\d:\d\d ▼ −1,00 €$/);
assert.deepEqual(await p.$$eval('.dv-mv .mv', m => m.map(x => x.className.replace('mv ', '') + ' ' + x.innerText.replace(/\s+/g, ' ').trim())),
  ['down Craterhoof Behemoth 9,00 € → 8,00 € −1,00 €', 'down Wrath of God 3,00 € → 2,50 € −0,50 €', 'up Swords to Plowshares 2,00 € → 2,50 € +0,50 €']);
assert.deepEqual(await p.$$eval('.dvc em', e => e.map(x => x.closest('.dvc').getAttribute('aria-label').split(',')[0] + (x.classList.contains('dn') ? ' ▼' : ' ▲')).sort()), ['Craterhoof Behemoth ▼', 'Swords to Plowshares ▲', 'Wrath of God ▼'], 'flèches sur les cartes qui ont bougé');
assert.match(await txt(p, '.dv-eur'), /19,00 €/); assert.match(await txt(p, '.dv-ref'), /Réf\. Cardmarket pour les mêmes cartes/);
await p.waitForTimeout(900); await p.screenshot({ path: 'shots/coll-9-evolution.png' });
await p.click('.dv-mv .mv >> nth=0'); await p.waitForSelector('.imgv-img'); assert.equal(await p.$eval('.imgv-cap b', e => e.textContent), 'Craterhoof Behemoth'); assert.match(await txt(p, '.imgv-extra'), /▼ −1,00 € par exemplaire/);
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.imgv'), null, { timeout: 2000 }); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.dv'), null, { timeout: 2000 });
ok('évolution : écart total, plus fortes variations, flèches, carte en grand avec l\'écart');
await p.click('#btnBack'); await p.click('#btnDecks'); await p.waitForSelector('#deckList .deck-price .delta');
assert.match(await txt(p, '#deckList .deck-price'), /^19,00 € −1,00 €$/); assert.equal(await p.$eval('#deckList .deck-price .delta', e => e.classList.contains('down')), true);
await p.click('#deckList .deck-more'); await p.waitForSelector('.chart'); assert.match(await txt(p, '.chart-cap'), /2 relevés · de 19,00 € à 20,00 €/);
assert.equal(await p.$$eval('.hist .t', t => t.map(x => x.textContent.replace(/\s+/g, ' ').trim()).join('|')), '19,00 €|20,00 €');
await p.screenshot({ path: 'shots/coll-10-historique.png' });
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-root .sheet, .sheet.on'), null, { timeout: 2000 }).catch(() => {});
ok('historique du deck : courbe, relevés, écart sur la carte du deck');

/* ── 9) « Je possède déjà cette carte » et état « collection modifiée » ───────────────────────── */
await p.click('#deckList [data-act="more"]'); await p.waitForSelector('#dkOpen'); await p.click('#dkOpen'); await p.waitForFunction(() => /Edgar/.test(document.querySelector('.deckchip') ? document.querySelector('.deckchip').textContent : ''));
await p.click('#btnRun'); await done(p); await p.waitForTimeout(500);
const total = async () => { await p.waitForTimeout(900); return txt(p, '#heroAmt'); };
assert.match(await total(), /19,00 €/, 'mêmes prix servis par le serveur');
await p.click('.row[data-key="swords to plowshares"]'); await p.waitForSelector('.ownbtn'); assert.match(await txt(p, '.refline'), /Réf\. Cardmarket 1,90 € par exemplaire.*ton prix 2,50 € \(\+32 %\)/);
await p.click('.ownbtn'); await p.waitForTimeout(500); assert.match(await txt(p, '.row[data-key="swords to plowshares"]'), /possédée/i); assert.match(await total(), /16,50 €/);
await p.click('#toast .toast-act'); await p.waitForTimeout(400); assert.match(await total(), /19,00 €/, 'Annuler : la carte redevient à acheter');
// la collection change pendant que les résultats sont là : Sol Ring (non cherché car possédé) est retiré
await p.evaluate(() => { collBump('sol ring', 'Sol Ring', -1); }); await p.waitForTimeout(500);
assert.match(await txt(p, '.row[data-key="sol ring"]'), /Collection modifiée : relance la recherche/); assert.match(await txt(p, '#alerts'), /1 carte n'est plus dans ta collection/);
await p.screenshot({ path: 'shots/coll-11-modifiee.png' });
assert.equal(await p.evaluate(() => buildSnap()), null, 'prix incomplets : aucun relevé gardé');
await p.click('#alerts [data-act="rerun"]'); await done(p); assert.ok(world.reqs(100) >= 1, 'Sol Ring est maintenant cherché'); assert.match(await total(), /20,50 €/);
assert.match(await txt(p, '.row[data-key="sol ring"]'), /1,50 €/);
ok('« Je possède déjà » (+ Annuler), carte retirée de la collection pendant les résultats → alerte et relance');

/* ── 10) partage vers l'app et reprise depuis une notification ───────────────────────────────── */
const sh = await newPage(browser, world, { path: '?text=' + encodeURIComponent('1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n1 Wrath of God') });
await sh.p.waitForTimeout(500);
assert.equal(await sh.p.$eval('#deckText', t => t.value.split('\n').length), 4); assert.match(await txt(sh.p, '#toast'), /4 cartes reçues/); assert.equal(await sh.p.evaluate(() => location.search), '', 'adresse nettoyée');
ok('partage : liste reçue du menu « Partager »');
await sh.p.goto(world.url + '?title=Edgar&url=' + encodeURIComponent('https://archidekt.com/decks/123/edgar')); await sh.p.waitForFunction(() => /cartes reçues/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 });
assert.match(await txt(sh.p, '#toast'), /Edgar partagé · 4 cartes reçues/); assert.match(await sh.p.$eval('#deckText', t => t.value), /^Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring/);
ok('partage d\'un lien Archidekt : liste lue par le serveur, commandant en tête');
await sh.p.goto(world.url + '?url=' + encodeURIComponent('https://evil.example.com/x')); await sh.p.waitForFunction(() => /Lien non lu/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 });
await sh.p.goto(world.url + '?resume=1'); await sh.p.waitForFunction(() => /relance-la/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 });
ok('lien non pris en charge et reprise sans recherche en attente : messages clairs');
await sh.p.evaluate(() => localStorage.setItem('deckdeal:pending', JSON.stringify({ text: '1 Sol Ring\n1 Arcane Signet', opts: {}, deckId: null, at: Date.now() })));
const before = world.reqs();
await sh.p.goto(world.url + '?resume=1'); await done(sh.p); assert.equal(await sh.p.$$eval('.row', r => r.length), 2); assert.equal(await sh.p.evaluate(() => localStorage.getItem('deckdeal:pending')), null, 'reprise terminée : plus rien en attente');
ok('reprise depuis la notification : la recherche est relancée (2 cartes), prix servis');
await sh.ctx.close();

console.log('erreurs page :', errs.length ? errs : 'aucune'); assert.deepEqual(errs, []);
await browser.close(); world.stop(); console.log('\nCOLL E2E OK'); process.exit(0);
