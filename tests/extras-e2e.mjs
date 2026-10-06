// E2E : « J'ai acheté » (panier → collection), decks montés (cartes réservées), synchro compte (engagés + historique, faux Firestore),
// scan « prix rapide ». Faux CardTrader / Scryfall (e2e-world), vrai proxy.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, done } from './e2e-world.mjs';

const world = await startWorld({ port: 18950 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const coll = p => p.evaluate(() => Object.fromEntries(Object.entries(COLL.map).map(([k, x]) => [k, x.q + (x.l ? '/' + x.l : '')])));
const seed = (collText, decks) => `try { ${collText ? `localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: ${JSON.stringify(collText)}, u: 1, s: '', b: null }));` : ''} ${decks ? `localStorage.setItem('deckdeal:decks:v1', JSON.stringify(${JSON.stringify(decks)}));` : ''} } catch (e) {}`;
const errsOf = [];

/* ── A) « J'ai acheté » ───────────────────────────────────────────────────────────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed('1 Sol Ring *EN*') }); errsOf.push(errs);
  assert.equal(await p.$eval('#buyBar', e => e.hidden), true, 'rien à valider au départ');
  await p.fill('#deckText', '1 Sol Ring\n1 Swords to Plowshares\n2 Arcane Signet'); await p.waitForTimeout(300);
  await p.click('#btnRun'); await done(p);
  await p.click('#btnCart'); await p.waitForSelector('#btnGo'); await p.click('#btnGo');
  await p.waitForFunction(() => /offres? ajoutée/.test(document.querySelector('.sheet-body').textContent), null, { timeout: 20000 });
  assert.equal(world.carted.length, 2, 'Sol Ring possédé : seulement Swords + Arcane Signet envoyés au panier : ' + JSON.stringify(world.carted));
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
  await p.click('#btnBack'); await p.waitForSelector('#viewInput:not([hidden])');
  assert.equal(await p.$eval('#buyBar', e => e.hidden), false, 'bannière « Panier rempli »');
  assert.match(await txt(p, '#buyBar'), /2 cartes/); assert.match(await txt(p, '#buyBar'), /3 exemplaires/);
  await p.reload(); await p.waitForTimeout(600);
  assert.equal(await p.$eval('#buyBar', e => e.hidden), false, 'le panier à valider survit au rechargement');
  await p.click('#buyBar [data-act="buy"]'); await p.waitForSelector('.buy-row');
  assert.deepEqual(await p.$$eval('.buy-row .b-n b', e => e.map(x => x.textContent)), ['Arcane Signet', 'Swords to Plowshares']);
  assert.match(await txt(p, '#buyGo'), /Ajouter 3 exemplaires/);
  await p.click('.buy-row[data-i="0"] [data-d="-1"]');            // une seule Arcane Signet prise
  assert.match(await txt(p, '#buyGo'), /Ajouter 2 exemplaires/);
  assert.equal(await p.$eval('.buy-row[data-i="0"] [data-d="1"]', b => b.disabled), false); await p.click('.buy-row[data-i="0"] [data-d="1"]');
  assert.equal(await p.$eval('.buy-row[data-i="0"] [data-d="1"]', b => b.disabled), true, 'jamais plus que ce qui était au panier');
  await p.click('.buy-row[data-i="0"] [data-d="-1"]'); await p.click('.buy-row[data-i="0"] [data-d="-1"]'); await p.click('.buy-row[data-i="1"] [data-d="-1"]'); assert.equal(await p.$eval('#buyGo', b => b.disabled), true, 'plus rien à ajouter'); await p.click('.buy-row[data-i="0"] [data-d="1"]'); await p.click('.buy-row[data-i="1"] [data-d="1"]');
  await p.click('#buyGo'); await p.waitForFunction(() => document.querySelector('#buyBar').hidden);
  assert.deepEqual(await coll(p), { 'sol ring': '1/en', 'arcane signet': '1/fr', 'swords to plowshares': '1/fr' }, 'ajoutées avec la langue de l\'offre achetée');
  assert.equal(await p.evaluate(() => localStorage.getItem('deckdeal:buy:v1')), null, 'panier à valider effacé');
  await p.click('#toast [data-fn], #toast button'); await p.waitForTimeout(300);
  assert.deepEqual(await coll(p), { 'sol ring': '1/en' }, 'Annuler : collection comme avant'); assert.equal(await p.$eval('#buyBar', e => e.hidden), false, 'Annuler : la bannière revient');
  await p.click('#buyBar [data-act="buyx"]'); assert.equal(await p.$eval('#buyBar', e => e.hidden), true, 'croix : panier ignoré');
  assert.deepEqual(await coll(p), { 'sol ring': '1/en' });
  ok('« J\'ai acheté » : bannière après remplissage, survit au rechargement, quantités ajustables, langue de l\'offre, Annuler, ignorer');
  await p.context().close();
}

/* ── B) Decks montés ──────────────────────────────────────────────────────────────────────── */
{
  const decks = [{ id: 'deckA', name: 'Deck A', text: '1 Sol Ring\n1 Llanowar Elves', updatedAt: Date.now() }];
  const { p, errs } = await newPage(browser, world, { init: seed('2 Sol Ring\n1 Llanowar Elves\n1 Command Tower', decks) }); errsOf.push(errs);
  const need = () => p.evaluate(() => S.deck.cards.map(c => [c.key, c.own, c.need]));
  await p.fill('#deckText', '2 Sol Ring\n1 Llanowar Elves'); await p.waitForTimeout(300);
  assert.deepEqual(await need(), [['sol ring', 2, 0], ['llanowar elves', 1, 0]], 'sans deck monté : tout est déduit');
  await p.click('#btnDecks'); await p.waitForSelector('.dks.on .deck'); await p.click('#deckList [data-act="more"]'); await p.waitForSelector('#dkMount');
  assert.equal(await p.$eval('#dkMount', c => c.checked), false); assert.match(await txt(p, '#dkMountHint'), /Réserve les cartes/);
  await p.evaluate(() => document.querySelector('#dkMount').click()); await p.waitForFunction(() => document.querySelector('#dkMount').checked);
  assert.match(await txt(p, '#dkMountHint'), /2 exemplaires de ta collection réservés pour ce deck/);
  assert.equal(await p.evaluate(() => JSON.stringify(XS.eng.deckA.q)), JSON.stringify({ 'sol ring': 1, 'llanowar elves': 1 }), 'une Sol Ring et une Llanowar réservées');
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
  assert.deepEqual(await need(), [['sol ring', 1, 1], ['llanowar elves', 0, 1]], 'liste non rattachée : les cartes du deck A ne sont plus déduites');
  assert.match(await txt(p, '#collHint'), /2 exemplaires réservés par Deck A ne sont pas comptés/);
  assert.match(await txt(p, '#deckList'), /complet/, 'étiquette « complet » dans la liste des decks');
  // le deck A lui-même : ses cartes lui restent
  await p.click('#deckList [data-act="more"]'); await p.waitForSelector('#dkOpen'); await p.click('#dkOpen'); await p.waitForTimeout(300);
  assert.deepEqual(await need(), [['sol ring', 1, 0], ['llanowar elves', 1, 0]], 'rattaché au deck A : il utilise ses propres cartes');
  assert.doesNotMatch(await txt(p, '#collHint'), /réservé/);
  // collection : pastille sur la carte réservée
  await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.waitForSelector('.crow[data-k="sol ring"]');
  assert.match(await txt(p, '.crow[data-k="sol ring"] .tag.mount'), /Deck A/); assert.equal(await p.$('.crow[data-k="command tower"] .tag.mount'), null);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // rechargement : toujours monté ; liste enregistrée modifiée : la réservation suit
  await p.reload(); await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => engIsOn('deckA')), true, 'réservation gardée après rechargement');
  await p.evaluate(() => { loadDeck('deckA'); $('#deckText').value = '1 Sol Ring\n1 Llanowar Elves\n1 Command Tower'; refreshDeck(); saveCurrent('Deck A'); });
  assert.equal(await p.evaluate(() => JSON.stringify(XS.eng.deckA.q)), JSON.stringify({ 'sol ring': 1, 'llanowar elves': 1, 'command tower': 1 }), 'enregistrer le deck met la réservation à jour');
  // démontage
  await p.click('#btnDecks'); await p.waitForSelector('.dks.on .deck'); await p.click('#deckList [data-act="more"]'); await p.waitForSelector('#dkMount'); await p.evaluate(() => document.querySelector('#dkMount').click());
  await p.waitForFunction(() => !document.querySelector('#dkMount').checked); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
  await p.click('.dks [data-act="close"]'); await p.waitForFunction(() => !document.querySelector('.dks'), null, { timeout: 3000 });
  assert.equal(await p.evaluate(() => engIsOn('deckA')), false); assert.equal(await p.evaluate(() => JSON.stringify(XS.eng.deckA.q)), '{}', 'trace vide gardée pour la synchro');
  await p.fill('#deckText', '2 Sol Ring'); await p.evaluate(() => { S.deckId = null; refreshDeck(); }); assert.deepEqual(await need(), [['sol ring', 2, 0]], 'démonté : tout est de nouveau déduit');
  // un deck sans carte possédée ne se monte pas
  await p.evaluate(() => putDeck('deckB', deckDoc({ name: 'Deck B', text: '1 Wrath of God' })));
  await p.waitForTimeout(200); await p.evaluate(() => openDeckSheet('deckB')); await p.waitForSelector('#dkMount'); await p.evaluate(() => document.querySelector('#dkMount').click());
  await p.waitForTimeout(150); assert.equal(await p.$eval('#dkMount', c => c.checked), false); assert.match(await txt(p, '#toast'), /Aucune carte de ce deck/);
  ok('decks montés : cartes réservées, déduction des autres decks, deck rattaché épargné, pastille collection, suivi de la liste, démontage');
  await p.context().close();
}

/* ── C) Synchro compte : engagés + historique (faux Firestore) ───────────────────────────── */
{
  const decks = [{ id: 'deckA', name: 'Deck A', text: '1 Sol Ring', updatedAt: Date.now() }];
  const { p, errs } = await newPage(browser, world, { init: seed('2 Sol Ring', decks) }); errsOf.push(errs);
  await p.evaluate(() => {
    window.__w = {}; window.__saved = [];
    D.cloud = { ...(D.cloud || {}), watchMeta: (uid, id, cb) => { window.__w[id] = cb; return () => {}; }, saveMeta: async (uid, id, doc) => { window.__saved.push([uid, id, JSON.parse(JSON.stringify(doc))]); } };
    D.user = { uid: 'u1', email: 'x@y.z' }; D.uid = 'u1';
    xsUser(D.user);
  });
  assert.deepEqual(await p.evaluate(() => Object.keys(window.__w).sort()), ['engaged', 'history'], 'écoute des deux documents annexes');
  // l'autre appareil a monté « Deck Z » ; ce n'est pas du cache : fusion
  const T = Date.now();
  await p.evaluate(t => window.__w.engaged({ decks: { deckZ: { n: 'Deck Z', at: t, q: { 'sol ring': 1 } } }, updatedAt: t }, false, false), T);
  assert.equal(await p.evaluate(() => engTotal(XS.eng, 'sol ring')), 1, 'réservation de l\'autre appareil appliquée');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:eng:v1')).d.deckZ.q['sol ring']), 1, 'et gardée localement');
  await p.evaluate(() => { window.__saved.length = 0; });
  await p.evaluate(t => window.__w.engaged({ decks: {}, updatedAt: t }, false, true), T);      // copie du cache du SDK : ignorée
  await p.evaluate(t => window.__w.engaged({ decks: { deckZ: { n: 'x', at: 1, q: {} } }, updatedAt: t }, true, false), T);      // écho d'écriture en cours : ignoré
  assert.equal(await p.evaluate(() => engTotal(XS.eng, 'sol ring')), 1, 'cache et échos ignorés');
  // ce deck-ci monte à son tour : le compte reçoit les deux decks
  await p.evaluate(() => engSet('deckA', 'Deck A', '1 Sol Ring')); await p.waitForTimeout(1300);
  const sent = await p.evaluate(() => window.__saved.filter(s => s[1] === 'engaged').pop());
  assert.equal(sent[0], 'u1'); assert.deepEqual(Object.keys(sent[2].decks).sort(), ['deckA', 'deckZ']); assert.ok(typeof sent[2].updatedAt === 'number');
  // historique : fusion par jour, renvoyé s'il manquait au compte
  const day = 86400000, t0 = Date.now() - 3 * day;
  await p.evaluate(([a, b, dd]) => { VAL.hist = [{ t: a, v: 1000, n: 2, q: 2 }]; window.__w.history({ pts: [[b, 1200, 2, 2], [b + dd, 1300, 2, 2]], updatedAt: 1 }, false, false); }, [t0, t0 + day, day]);
  assert.deepEqual(await p.evaluate(() => VAL.hist.map(h => h.v)), [1000, 1200, 1300], 'relevés des deux appareils réunis');
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:coll:hist')).map(h => h.v)), [1000, 1200, 1300], 'gardés localement');
  await p.waitForTimeout(1300);
  const hs = await p.evaluate(() => window.__saved.filter(s => s[1] === 'history').pop());
  assert.deepEqual(hs[2].pts.map(x => x[1]), [1000, 1200, 1300], 'l\'historique complet repart dans le compte (le compte n\'avait pas le plus ancien)');
  // règles refusées : message une seule fois, rien ne casse
  await p.evaluate(() => { D.cloud.saveMeta = async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); }; engSet('deckA', 'Deck A', '1 Sol Ring'); });
  await p.waitForTimeout(1300); assert.match(await txt(p, '#toast'), /Règles Firestore à publier/);
  assert.equal(await p.evaluate(() => engIsOn('deckA')), true, 'les cartes réservées restent sur l\'appareil');
  ok('synchro compte : engagés fusionnés deck par deck, cache et échos ignorés, historique fusionné et renvoyé, règles manquantes signalées sans casser');
  await p.context().close();
}

/* ── D) Scan « prix rapide » ──────────────────────────────────────────────────────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed('1 Sol Ring *FR*') }); errsOf.push(errs);
  await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on');
  assert.equal(await p.$eval('.sc-pmode', b => b.getAttribute('aria-pressed')), 'false'); assert.match(await txt(p, '.dv-foot'), /Annuler/);
  await p.click('.sc-pmode'); assert.equal(await p.$eval('.scan', e => e.classList.contains('pm')), true);
  assert.match(await txt(p, '.sc-sub'), /Prix rapide/); assert.equal(await p.$eval('.dv-foot [data-act="done"]', b => b.hidden), true, 'rien à ajouter en mode prix'); assert.match(await txt(p, '.dv-foot'), /Fermer/);
  await p.evaluate(() => { scanPriceAdd({ key: 'sol ring', name: 'Sol Ring', card: 'fr', score: 0.95, raw: 'Sol Ring' }); scanPriceAdd({ key: 'craterhoof behemoth', name: 'Craterhoof Behemoth', card: 'fr', score: 0.78, raw: 'Craterhoof Behemolh' }); });
  await p.waitForFunction(() => document.querySelectorAll('.sc-item.pr .px.ct:not(.wait)').length === 2, null, { timeout: 20000 });
  const rows = await p.$$eval('.sc-item.pr', r => r.map(x => ({ n: x.querySelector('.sc-n b').textContent, cm: (x.querySelector('.px.cm b') || {}).textContent, ct: (x.querySelector('.px.ct b') || {}).textContent, own: !!x.querySelector('.tag.good'), maybe: x.classList.contains('maybe') })));
  assert.deepEqual(rows.map(r => r.n), ['Craterhoof Behemoth', 'Sol Ring'], 'dernière lue en haut');
  const norm = s => String(s).replace(/\s/g, ' ');
  assert.match(norm(rows[1].cm), /1,50 €/, 'tendance Cardmarket de Sol Ring'); assert.match(norm(rows[1].ct), /1,50 €/, 'offre CardTrader FR la moins chère');
  assert.match(norm(rows[0].cm), /9,00 €/); assert.match(norm(rows[0].ct), /9,00 €/);
  assert.equal(rows[1].own, true, 'Sol Ring déjà possédée'); assert.equal(rows[0].own, false); assert.equal(rows[0].maybe, true, 'lecture douteuse signalée');
  assert.deepEqual(await coll(p), { 'sol ring': '1/fr' }, 'rien n\'a été ajouté à la collection');
  // total estimé du lot, à côté de « Fermer »
  assert.equal(await p.isVisible('.dv-foot .sc-total'), true); const lot = async () => norm(await txt(p, '.dv-foot .sc-total'));
  assert.match(await lot(), /Lot : 2 cartes/); assert.match(await lot(), /CM 10,50 €/, 'CM : 1,50 + 9,00'); assert.match(await lot(), /CT 10,50 €/, 'CT : 1,50 + 9,00');
  assert.equal(await p.evaluate(() => { const f = document.querySelector('.dv-foot'), c = f.querySelector('[data-act="close"]').getBoundingClientRect(), t = f.querySelector('.sc-total').getBoundingClientRect(); return t.left >= c.right - 1 && Math.abs((t.top + t.height / 2) - (c.top + c.height / 2)) < 20; }), true, 'à droite de « Fermer »');
  await p.screenshot({ path: 'shots/scan-prix-lot.png' });
  await p.evaluate(() => scanPriceAdd({ key: 'sol ring', name: 'Sol Ring', card: 'fr', score: 0.95, raw: 'Sol Ring' }));      // relue : 2 exemplaires dans le lot
  await p.waitForSelector('.sc-item.pr[data-k="sol ring"] .sc-cnt'); assert.match(norm(await txt(p, '.sc-cnt')), /× 2/);
  assert.match(await lot(), /Lot : 3 cartes/); assert.match(await lot(), /CM 12,00 €/); assert.match(await lot(), /CT 12,00 €/);
  await p.click('.sc-cnt'); assert.equal(await p.$('.sc-cnt'), null, 'un seul exemplaire : plus de pastille'); assert.match(await lot(), /Lot : 2 cartes/); assert.match(await lot(), /CM 10,50 €/);
  // « + » garde la carte ; la croix la retire de la liste
  await p.click('.sc-item.pr[data-k="craterhoof behemoth"] [data-a="padd"]'); await p.waitForTimeout(200);
  assert.deepEqual(await coll(p), { 'sol ring': '1/fr', 'craterhoof behemoth': '1/fr' }, 'ajoutée avec sa langue lue');
  await p.click('.sc-item.pr[data-k="sol ring"] [data-a="prm"]'); assert.equal(await p.$$eval('.sc-item.pr', e => e.length), 1);
  assert.match(await lot(), /Lot : 1 carte(?!s)/); assert.match(await lot(), /CM 9,00 €/, 'le total suit la liste');
  // retour au mode ajout : le bouton « Ajouter » revient
  await p.click('.sc-pmode'); assert.equal(await p.$eval('.scan', e => e.classList.contains('pm')), false); assert.equal(await p.$eval('.dv-foot [data-act="done"]', b => b.hidden), false); assert.match(await txt(p, '.dv-foot'), /Annuler/); assert.equal(await p.isVisible('.dv-foot .sc-total'), false, 'pas de total en mode ajout');
  ok('scan prix rapide : CM + CT lus, déjà possédée signalée, doute signalé, rien ajouté sans « + », retour au mode ajout');
  await p.context().close();
}
// accueil : « Prix rapide » ouvre le scan directement en mode prix, sans passer par la collection
{
  const { p, errs } = await newPage(browser, world, { init: seed('1 Sol Ring *FR*') }); errsOf.push(errs);
  assert.ok(await p.isVisible('#btnQuick'), 'bouton visible sur l\'accueil'); assert.match(await txt(p, '#btnQuick'), /Prix rapide/);
  await p.click('#btnQuick'); await p.waitForSelector('.scan.on');
  assert.equal(await p.$eval('.scan', e => e.classList.contains('pm')), true, 'scan ouvert en mode prix'); assert.equal(await p.$eval('.sc-pmode', b => b.getAttribute('aria-pressed')), 'true');
  assert.equal(await p.$eval('.dv-foot [data-act="done"]', b => b.hidden), true, 'rien à ajouter'); assert.equal(await p.$('.coll.on'), null, 'la collection n\'est pas ouverte');
  await p.click('.scan .dv-foot [data-act="close"]'); await p.waitForFunction(() => !document.querySelector('.scan'), null, { timeout: 3000 });
  await p.click('#btnQuick'); await p.waitForSelector('.scan.on'); assert.equal(await p.$eval('.scan', e => e.classList.contains('pm')), true, 'à chaque ouverture');
  ok('accueil : bouton « Prix rapide » → scan directement en mode prix (sans collection ouverte)');
  await p.context().close();
}

/* ── E) Collection : drapeau à droite du nom, nom imprimé français pour les cartes FR ───────── */
{
  const rows = ['Anneau solaire\tSol Ring\tfront/fr/sol-ring.jpg', 'Contresort\tCounterspell\t', 'Collision // Colosse\tCollision // Colossus\t', ...Array.from({ length: 600 }, (_, i) => `Vrombl ${i}\tVrombl Card ${i}\tfront/fr/v${i}.jpg`)];
  let hits = 0;
  const { p, errs } = await newPage(browser, world, { init: seed('1 Sol Ring *FR*\n1 Counterspell\n1 Arcane Signet *FR*\n2 Collision // Colossus *FR*') }); errsOf.push(errs);
  await p.route(world.url + 'fr-names.tsv', r => { hits++; r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: ['# fr-names', ...rows].join('\n') + '\n' }); });
  await p.click('#btnColl'); await p.waitForSelector('.coll.on');
  const nm = k => p.$eval(`.crow[data-k="${k}"] .row-name`, e => e.textContent);
  await p.waitForFunction(() => { const e = document.querySelector('.crow[data-k="sol ring"] .row-name'); return e && e.textContent === 'Anneau solaire'; }, null, { timeout: 8000 });
  assert.equal(hits, 1, 'catalogue du site lu une fois'); assert.equal(await nm('counterspell'), 'Counterspell', 'carte sans langue : anglais'); assert.equal(await nm('arcane signet'), 'Arcane Signet', 'FR mais inconnue du catalogue : anglais');
  assert.equal(await nm('collision'), 'Collision', 'carte double : face avant');
  // drapeau : à droite du nom, sur sa ligne, loin de la vignette
  const geo = await p.$eval('.crow[data-k="sol ring"]', r => { const th = r.querySelector('.thumb').getBoundingClientRect(), n = r.querySelector('.row-name').getBoundingClientRect(), c = r.querySelector('.row-top .lchip').getBoundingClientRect(); return { right: c.left >= n.right - 1, sameLine: Math.abs((c.top + c.height / 2) - (n.top + n.height / 2)) < 12, far: c.left - th.right > 30 }; });
  assert.deepEqual(geo, { right: true, sameLine: true, far: true }, 'drapeau collé au nom, pas à la vignette : ' + JSON.stringify(geo));
  assert.equal(await p.$eval('.crow[data-k="sol ring"] .row-meta', e => !!e.querySelector('.lchip')), false, 'plus de drapeau sous le nom');
  assert.equal(await p.$eval('.crow[data-k="counterspell"] .row-meta .lchip.none', e => !!e), true, '« Langue ? » en fin de rangée de tags'); assert.equal(await p.$('.crow[data-k="counterspell"] .row-top .lchip'), null);
  // tri et recherche sur le nom affiché
  assert.deepEqual(await p.$$eval('.crow .row-name', n => n.map(x => x.textContent)), ['Anneau solaire', 'Arcane Signet', 'Collision', 'Counterspell'], 'tri alphabétique sur le nom affiché');
  await p.fill('.coll .fsearch input', 'anneau'); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 1, null, { timeout: 3000 });
  assert.equal(await nm('sol ring'), 'Anneau solaire', 'recherche par le nom français');
  await p.fill('.coll .fsearch input', 'sol ring'); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 1, null, { timeout: 3000 });
  await p.fill('.coll .fsearch input', ''); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 4, null, { timeout: 3000 });
  await p.fill('.coll .fsearch input', 'contresort'); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 1, null, { timeout: 3000 });
  assert.equal(await nm('counterspell'), 'Counterspell', 'recherche en français : trouve aussi une carte sans langue (nom affiché inchangé)');
  await p.fill('.coll .fsearch input', ''); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 4, null, { timeout: 3000 });
  // changement de langue : le nom suit
  await p.selectOption('.crow[data-k="sol ring"] .lchip select', 'en'); assert.equal(await nm('sol ring'), 'Sol Ring', 'anglais : nom anglais'); assert.ok(await p.$('.crow[data-k="sol ring"] .row-top .lchip[data-l="en"]'));
  await p.fill('.coll .fsearch input', 'anneau'); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 1, null, { timeout: 3000 });
  assert.equal(await nm('sol ring'), 'Sol Ring', 'recherche « anneau » : trouve la Sol Ring anglaise, affichée en anglais'); await p.fill('.coll .fsearch input', ''); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 4, null, { timeout: 3000 });
  // chinois : sélectionnable (drapeau, texte « ZH »), image Scryfall zhs
  await p.selectOption('.crow[data-k="arcane signet"] .lchip select', 'zh-CN'); assert.ok(await p.$('.crow[data-k="arcane signet"] .row-top .lchip[data-l="zh-CN"] svg.flag'), 'drapeau chinois');
  assert.equal(await p.evaluate(() => COLL.map['arcane signet'].l), 'zh-CN'); assert.match(await p.evaluate(() => collToText(COLL.map)), /1 Arcane Signet \*ZH\*/, 'texte de la collection : *ZH*');
  assert.equal(await p.evaluate(() => [...document.querySelectorAll('.crow[data-k="arcane signet"] .lchip select option')].map(o => o.value).includes('zh-CN')), true);
  await p.selectOption('.crow[data-k="counterspell"] .lchip select', 'fr'); assert.equal(await nm('counterspell'), 'Contresort', 'passée en français : nom imprimé'); assert.ok(await p.$('.crow[data-k="counterspell"] .row-top .lchip[data-l="fr"]')); assert.equal(await p.$('.crow[data-k="counterspell"] .row-meta .lchip'), null, 'puce déplacée à droite du nom');
  await p.selectOption('.crow[data-k="sol ring"] .lchip select', ''); assert.equal(await nm('sol ring'), 'Sol Ring'); assert.ok(await p.$('.crow[data-k="sol ring"] .row-meta .lchip.none'), 'langue effacée : « Langue ? » revient en fin de tags');
  assert.equal(await p.evaluate(() => COLL.map['counterspell'].l), 'fr', 'langue enregistrée');
  await p.screenshot({ path: 'shots/coll-fr-names.png' });
  ok('collection : drapeau à droite du nom (loin de la vignette), nom français pour les cartes FR (catalogue du site lu 1 fois), anglais sinon, tri et recherche sur le nom affiché');
  await p.context().close();
}

/* ── F) Une carte en plusieurs langues : une ligne par langue (collection, scan) ───────────────── */
{
  const { p, errs } = await newPage(browser, world, { init: seed('2 Sol Ring *FR*\n1 Sol Ring *EN*\n1 Counterspell') }); errsOf.push(errs);
  await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.waitForFunction(() => document.querySelectorAll('.crow').length === 3);
  const lines = () => p.$$eval('.crow', r => r.map(x => [x.dataset.k, x.dataset.ln, Number(x.querySelector('.qstep b').textContent), x.classList.contains('sub')]));
  assert.deepEqual(await lines(), [['counterspell', '', 1, false], ['sol ring', 'fr', 2, false], ['sol ring', 'en', 1, true]], 'une ligne par langue : fr puis en, la 2e allégée');
  assert.match(await txt(p, '.dv-title span'), /^2 cartes · 4 exemplaires/, '2 cartes différentes, 4 exemplaires');
  assert.deepEqual(await p.$$eval('.crow[data-k="sol ring"] .row-top .lchip', c => c.map(x => x.dataset.l)), ['fr', 'en'], 'un drapeau par ligne');
  assert.equal(await p.$eval('.crow[data-k="sol ring"][data-ln="en"] .row-meta', e => !!e && e.textContent.trim() === '') .catch(() => true), true, 'la 2e ligne ne répète pas les tags de la carte');
  await p.screenshot({ path: 'shots/coll-langues.png' });
  // + / − agissent sur la ligne touchée
  await p.click('.crow[data-k="sol ring"][data-ln="en"] .qstep [data-d="1"]');
  assert.deepEqual(await p.evaluate(() => COLL.map['sol ring'].x), { fr: 2, en: 2 }); assert.equal(await p.$eval('.crow[data-k="sol ring"][data-ln="fr"] .qstep b', e => e.textContent), '2', 'l\'autre ligne ne bouge pas');
  await p.click('.crow[data-k="sol ring"][data-ln="en"] .qstep [data-d="-1"]'); await p.waitForSelector('.sheet [data-ok]'); await p.click('.sheet [data-ok]'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  await p.click('.crow[data-k="sol ring"][data-ln="en"] .qstep [data-d="-1"]'); await p.waitForSelector('.sheet [data-ok]');
  assert.match(await txt(p, '.sheet .cf-msg'), /Dernier exemplaire EN : cette ligne sort de ta collection/, 'dernière EN : seule la ligne EN sort'); await p.click('.sheet [data-ok]'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  await p.waitForFunction(() => document.querySelectorAll('.crow[data-k="sol ring"]').length === 1);
  assert.deepEqual(await p.evaluate(() => COLL.map['sol ring']), await p.evaluate(() => ({ n: 'Sol Ring', q: 2, l: 'fr', ...(COLL.map['sol ring'].d ? { d: COLL.map['sol ring'].d } : {}) })), 'une seule langue restante : plus de répartition');
  assert.match(await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:coll:v1')).t), /2 Sol Ring( \(D[0-9a-z]+\))? \*FR\*/);
  // ajout dans une autre langue (saisie) : nouvelle ligne ; texte enregistré = une ligne par langue
  await p.evaluate(() => collBump('sol ring', 'Sol Ring', 1, { lang: 'de' })); await p.waitForFunction(() => document.querySelectorAll('.crow[data-k="sol ring"]').length === 2);
  assert.deepEqual(await p.evaluate(() => COLL.map['sol ring'].x), { fr: 2, de: 1 }); const txtSaved = await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:coll:v1')).t);
  assert.match(txtSaved, /2 Sol Ring( \(D[0-9a-z]+\))? \*FR\*\n1 Sol Ring( \(D[0-9a-z]+\))? \*DE\*/, 'une ligne par langue dans le texte (compte, export)');
  // changer la langue d'une ligne vers une langue déjà présente : les lignes fusionnent
  await p.selectOption('.crow[data-k="sol ring"][data-ln="de"] .lchip select', 'fr'); await p.waitForFunction(() => document.querySelectorAll('.crow[data-k="sol ring"]').length === 1);
  assert.deepEqual(await p.evaluate(() => [COLL.map['sol ring'].q, COLL.map['sol ring'].l, COLL.map['sol ring'].x]), [3, 'fr', undefined], 'fusion en une ligne FR de 3 exemplaires'); assert.equal(await p.$eval('.crow[data-k="sol ring"] .qstep b', e => e.textContent), '3');
  // totaux : decks, paniers… voient 3 exemplaires, quelle que soit la langue
  assert.equal(await p.evaluate(() => collQty('sol ring')), 3);
  ok('collection : une ligne par langue (fr, en…), + / − par ligne, dernière EN = seule la ligne sort, fusion si la langue existe déjà, texte enregistré une ligne par langue');
  await p.context().close();
}
{
  // scan : la même carte lue en français puis en anglais = deux lignes ; ajout dans la collection : une ligne par langue
  const { p, errs } = await newPage(browser, world, { init: seed('1 Sol Ring *FR*') }); errsOf.push(errs);
  await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('.coll-tools [data-act="scan"]'); await p.waitForSelector('.scan.on');
  await p.evaluate(() => { const m = (card, raw) => ({ key: 'sol ring', name: 'Sol Ring', card, score: 0.98, raw }); scanAdd(m('fr', 'Anneau solaire'), 1, false); scanAdd(m('en', 'Sol Ring'), 1, false); scanAdd(m('en', 'Sol Ring'), 1, false); });
  await p.waitForFunction(() => document.querySelectorAll('.sc-item[data-k="sol ring"]').length === 2);
  assert.deepEqual(await p.$$eval('.sc-item[data-k="sol ring"]', r => r.map(x => [x.querySelector('.lchip').dataset.l, Number(x.querySelector('.qstep b').textContent)])), [['en', 2], ['fr', 1]], 'FR et EN : deux lignes, chacune sa quantité (dernière lue en haut)');
  assert.equal(await p.evaluate(() => scanTotals().n), 3);
  // une ligne passe dans la langue de l'autre : elles fusionnent
  await p.selectOption('.sc-item[data-k="sol ring"][data-id="sol ring|fr"] .lchip select', 'en'); await p.waitForFunction(() => document.querySelectorAll('.sc-item[data-k="sol ring"]').length === 1);
  assert.equal(await p.$eval('.sc-item[data-k="sol ring"] .qstep b', e => e.textContent), '3', 'fusionnées : 3 exemplaires EN');
  await p.selectOption('.sc-item[data-k="sol ring"] .lchip select', 'fr'); await p.waitForFunction(() => document.querySelector('.sc-item[data-k="sol ring"] .lchip').dataset.l === 'fr');
  await p.evaluate(() => scanAdd({ key: 'sol ring', name: 'Sol Ring', card: 'en', score: 0.98, raw: 'Sol Ring' }, 1, false)); await p.waitForFunction(() => document.querySelectorAll('.sc-item[data-k="sol ring"]').length === 2);
  await p.click('.scan .dv-foot [data-act="done"]'); await p.waitForSelector('.rc-sheet [data-rc="go"]');
  assert.match(await txt(p, '.rc-sheet .rc-facts'), /Déjà possédées\s*1 carte · \+4 ex\./, 'une carte (pas deux lignes) déjà possédée'); assert.match(await txt(p, '.rc-sheet .cs-tiles'), /1\s*carte différente/);
  await p.click('.rc-sheet [data-rc="go"]'); await p.waitForFunction(() => !document.querySelector('.scan'), null, { timeout: 3000 });
  assert.deepEqual(await p.evaluate(() => COLL.map['sol ring'].x), { fr: 4, en: 1 }, '1 FR déjà là + 3 FR scannés, 1 EN scannée : une ligne par langue');
  ok('scan : même carte en FR et en EN = deux lignes (quantités séparées), langue changée → fusion, ajout à la collection par ligne, fiche récap sans doublon de carte');
  await p.context().close();
}

for (const e of errsOf) assert.deepEqual(e, [], 'erreurs page : ' + e.join(' | '));
await browser.close(); world.stop();
console.log('EXTRAS E2E OK');
