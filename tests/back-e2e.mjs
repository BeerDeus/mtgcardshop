// E2E : bouton Retour du téléphone : ferme l'écran ouvert ; sur l'accueil, double Retour pour quitter ; couleurs d'un deck.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok } from './e2e-world.mjs';

const world = await startWorld({ port: 18970 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const seed = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '1 Sol Ring *EN*', u: 1, s: '', b: null })); localStorage.setItem('deckdeal:decks:v1', JSON.stringify([{ id: 'd1', name: 'Rakdos', text: '// Deck Deal : standard\\nDeck\\n4 Sol Ring\\n10 Swamp\\n12 Mountain\\n2 Snow-Covered Swamp', opts: {}, cards: 1, history: [], createdAt: 1, updatedAt: 2 }])); } catch (e) {}`;
const { p, errs } = await newPage(browser, world, { init: seed });
await p.waitForTimeout(600);
const url = p.url(), back = async () => { await p.evaluate(() => history.back()); await p.waitForTimeout(350); };
const open = sel => p.$eval(sel, e => !!e);

world.basics = true;      // les terrains de base ont une image sur le faux Scryfall
// bouton « Mes decks » de l'accueil → écran des decks (comme « Ma collection »)
assert.match(await txt(p, '#decksSub'), /^1 deck$/); assert.equal(await p.$('#decksSec'), null, 'plus de liste de decks sur l\'accueil'); assert.equal(await p.$('.deck'), null);
await p.click('#btnDecks'); await p.waitForSelector('.dks.on .deck'); assert.equal(await txt(p, '.dks .dv-title span'), '1 deck');
// couleurs du deck : Marais (B) + Montagne (R) → pastilles dans l'ordre WUBRG
assert.deepEqual(await p.$$eval('.deck .deck-pips .pip', n => n.map(x => x.className.replace('pip ', ''))), ['B', 'R'], 'couleurs d\'après les terrains de base');
assert.match(await p.$eval('.deck-pips', e => e.getAttribute('aria-label')), /noir, rouge/); assert.match(await txt(p, '.deck-fmt'), /Standard/);
ok('couleurs du deck (terrains de base, dont enneigés)');

// toucher le deck : ouvre le viewer (pas la liste dans la saisie)
await p.click('.deck [data-act="open"]'); await p.waitForSelector('.dv.on[aria-label^="Deck viewer"]');
await p.waitForFunction(() => /6,00/.test((document.querySelector('.dv-eur') || {}).textContent || ''), null, { timeout: 8000 });
assert.equal((await p.waitForFunction(() => !document.querySelector('.dv-amt[data-tw]')), await txt(p, '.dv-eur')), '≈ 6,00 €'); assert.equal(await txt(p, '.dv[aria-label^="Deck viewer"] .dv-title span'), '28 cartes · 3 à trouver'); assert.deepEqual(await p.$$eval('.dv-g[data-g="m1"] .dvc', ts => ts.map(t => t.getAttribute('aria-label').replace(/\s/g, ' '))), ['Sol Ring, ×4, 6,00 €, 1 possédée']); assert.equal(await txt(p, '.dvc-l'), '1/4', 'possédées sur voulues');
assert.equal(await p.$eval('#deckText', e => /Rakdos|Sol Ring/.test(e.value) && /Deck Deal/.test(e.value)), false, 'la liste n\'est pas chargée dans la saisie');
await p.waitForFunction(() => document.querySelectorAll('.dv-g[data-g="land"] .dvc-art img.ok').length === 3, null, { timeout: 8000 }); ok('terrains de base : images (Swamp, Mountain, Snow-Covered Swamp)');
await back(); await p.waitForFunction(() => !document.querySelector('.dv:not(.dks)'), null, { timeout: 3000 }); assert.ok(await p.$('.dks.on'), 'l\'écran des decks reste dessous'); ok('toucher un deck ouvre le viewer (valeur estimée, cartes en tuiles) ; Retour le ferme');
// création d'un deck depuis l'écran : Retour ferme la feuille, puis l'écran
await p.click('#btnNewDeck'); await p.waitForSelector('#ndName'); await back(); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 }); assert.ok(await p.$('.dks.on'));
await back(); await p.waitForFunction(() => !document.querySelector('.dks'), null, { timeout: 3000 }); assert.equal(p.url(), url, 'même page'); ok('écran « Mes decks » : Retour ferme la feuille puis l\'écran, l\'app reste');
// 1) collection → Retour la ferme, l'app reste
await p.click('#btnColl'); await p.waitForSelector('.coll.on');
await back(); await p.waitForFunction(() => !document.querySelector('.coll'), null, { timeout: 3000 }); assert.equal(p.url(), url, 'même page');
// 2) feuille au-dessus de la collection : Retour ferme la feuille d'abord, puis la collection
await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('.coll [data-act="add"]'); await p.waitForSelector('.sheet-wrap.open');
await back(); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 }); assert.ok(await p.$('.coll.on'), 'la collection reste ouverte');
await back(); await p.waitForFunction(() => !document.querySelector('.coll'), null, { timeout: 3000 });
ok('Retour : ferme la feuille / l\'écran ouvert, sans quitter l\'app');

// 4) accueil : 1er Retour → message, 2e → on quitte
await back(); assert.match(await txt(p, '#toast'), /Appuie encore sur Retour pour quitter/); assert.equal(p.url(), url, 'toujours dans l\'app');
await p.evaluate(() => history.back()); await p.waitForTimeout(800); assert.notEqual(p.url(), url, 'second Retour : on quitte (page précédente)');
ok('accueil : double Retour pour quitter');

await p.context().close();
// rechargement : pas d'entrées d'historique en plus
{ const { p: q } = await newPage(browser, world, { init: seed }); await q.waitForTimeout(500); const n0 = await q.evaluate(() => history.length); await q.reload(); await q.waitForTimeout(500); assert.equal(await q.evaluate(() => history.length), n0, 'rechargement : pas d\'entrée en plus'); ok('rechargement sans entrées d\'historique en trop'); }
// deck 100 % possédé (monté ou non) : le viewer sert la valeur estimée, rien à chercher
{
  const own = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '1 Sol Ring *EN*\\n1 Edgar Markov *EN*', u: 1, s: '', b: null })); localStorage.setItem('deckdeal:decks:v1', JSON.stringify([{ id: 'd2', name: 'Tout possédé', text: '// Deck Deal : commander\\nCommander\\n1 Edgar Markov\\n\\nDeck\\n1 Sol Ring\\n2 Plains', opts: {}, cards: 2, history: [], createdAt: 1, updatedAt: 2 }])); } catch (e) {}`;
  const { p: q, errs: e2 } = await newPage(browser, world, { init: own }); await q.waitForTimeout(600);
  await q.click('#btnDecks'); await q.waitForSelector('.dks.on .deck'); await q.click('.deck [data-act="open"]'); await q.waitForSelector('.dv.on[aria-label^="Deck viewer"]');
  await q.waitForFunction(() => /6,50/.test((document.querySelector('.dv-eur') || {}).textContent || ''), null, { timeout: 8000 });
  assert.equal((await q.waitForFunction(() => !document.querySelector('.dv-amt[data-tw]')), await txt(q, '.dv-eur')), '≈ 6,50 €'); assert.equal(await txt(q, '.dv[aria-label^="Deck viewer"] .dv-title span'), '4 cartes · toutes possédées');
  assert.match(await txt(q, '.dv-cmd'), /Commandant Edgar Markov.*Dans ta collection/i); assert.equal(await q.$eval('.dv-foot [data-act="refresh"]', e => e.hidden), true, 'tout est possédé : pas de recherche d\'offres');
  assert.equal(await txt(q, '.dvc-l.own'), '✓'); assert.equal(await q.$eval('.dv-g[data-g="land"] .dvc', e => e.dataset.s), 'basic', 'terrains de base à part, sans prix');
  assert.equal(await q.$eval('.dv-foot [data-act="edit"]', e => e.hidden), false); ok('deck 100 % possédé : viewer en valeur estimée, commandant, ✓, pas de « Chercher les offres »');
  // « Modifier la liste » charge le deck ; tout étant possédé, la recherche d'offres reste désactivée
  await q.click('.dv-foot [data-act="edit"]'); await q.waitForFunction(() => !document.querySelector('.dv'), null, { timeout: 3000 });
  assert.equal(await q.$eval('#btnRun', b => b.disabled), true); assert.match(await txt(q, '#btnRunLabel'), /Tout est dans ta collection/); ok('modifier la liste : charge le deck, rien à chercher');
  assert.deepEqual(e2, [], 'aucune erreur console'); await q.context().close();
}
await browser.close(); world.stop();
console.log('BACK E2E OK');
