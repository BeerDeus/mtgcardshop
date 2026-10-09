// E2E « Enregistrer dans mes decks » depuis un deck venu d'ailleurs : lien partagé (?p=, visiteur sans compte puis connecté, faux cloud)
// et viewer d'un deck EDHREC (« Voir le deck » de sa feuille). Une seule copie : même liste reconnue à la réouverture, « ✓ Dans mes decks » + « Ouvrir ».
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, startWorld, newPage, ok, txt, signInFake } from './e2e-world.mjs';
const SHOTS = process.env.SHAREDECK_SHOTS || 'shots'; mkdirSync(SHOTS, { recursive: true });      // captures 390 px (SHAREDECK_SHOTS : autre dossier)

const world = await startWorld({ port: 18996 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const errsOf = [];

// deck partagé : commandant, cartes et réserve (« SB: ») ; enregistré tel quel, octet pour octet
const TEXT = 'Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n1 Swords to Plowshares\n1 Craterhoof Behemoth\n1 Command Tower\n1 Arcane Signet\n10 Plains\nSB: 1 Wrath of God';
const SID = 'ShareDeck0000001', shares = new Map([[SID, { o: 'x', kind: 'deck', updatedAt: 5, d: JSON.stringify({ name: 'Edgar partagé', text: TEXT, by: 'Martin', at: 5 }) }]]);
/** Faux Firestore REST : lecture publique du partage. */
async function routeRest(p) {
  await p.route('https://firestore.googleapis.com/**', route => {
    const u = new URL(route.request().url()), id = decodeURIComponent(u.pathname.split('/').pop()), h = { 'access-control-allow-origin': '*' }, s = shares.get(id);
    if (!s) return route.fulfill({ status: 404, headers: h, json: { error: { code: 404, status: 'NOT_FOUND' } } });
    route.fulfill({ status: 200, headers: h, json: { fields: { o: { stringValue: s.o }, kind: { stringValue: s.kind }, v: { integerValue: '1' }, updatedAt: { integerValue: String(s.updatedAt) }, d: { stringValue: s.d } } } });
  });
}
/** Boutons visibles du pied du viewer : [action, texte, inactif, discret]. */
const foot = pg => pg.$$eval('.dv.on .dv-foot .btn:not([hidden])', b => b.map(x => [x.dataset.act, x.textContent.trim(), x.disabled, x.classList.contains('ghost')]));
const UNSAVED = [['close', 'Fermer', false, true], ['save', 'Enregistrer dans mes decks', false, false]];
const SAVED = [['close', 'Fermer', false, true], ['save', '✓ Dans mes decks', true, true], ['open', 'Ouvrir', false, false]];
const decks = pg => pg.evaluate(() => allDecks().map(d => ({ id: d.id, name: d.name, text: d.text, opts: d.opts })));
const shot = async (pg, f) => { await pg.waitForTimeout(450); await pg.screenshot({ path: SHOTS + '/' + f }); };

/* ── 1) visiteur sans compte : enregistrer, « Voir », lien rouvert (pas de doublon), « Ouvrir », deck supprimé ─────────────── */
{
  const { p, errs } = await newPage(browser, world, { goto: false, ctx: { colorScheme: 'dark' } }); errsOf.push(errs);
  await p.route('https://www.gstatic.com/**', r => r.abort()); await routeRest(p);
  await p.goto(world.url + '?p=' + SID); await p.waitForSelector('.dv.on .dv-sum');
  await p.waitForFunction(() => D.authReady); await p.waitForFunction(() => document.querySelectorAll('.dv.on .dvc img.ok').length >= 5, null, { timeout: 8000 });
  assert.match(await txt(p, '.dv.on .dv-title'), /Edgar partagé.*réserve 1 · partagé par Martin/);
  assert.deepEqual(await foot(p), UNSAVED, 'deck partagé : « Enregistrer dans mes decks » en action principale, « Fermer » discret');
  await shot(p, 'sharedeck-1-lien.png');
  await p.evaluate(() => { S.opts.lang = 'en'; S.opts.cond = 'Near Mint'; });      // critères de ce visiteur (le partage n'en porte pas)
  await p.click('.dv.on [data-act="save"]');
  assert.equal(await txt(p, '#toast'), '« Edgar partagé » ajouté à Mes decks Voir');
  assert.deepEqual(await foot(p), SAVED, 'enregistré : « ✓ Dans mes decks » inactif, puis « Ouvrir »');
  assert.equal(await p.$eval('.dv.on [data-act="open"]', b => b.getAttribute('aria-label')), 'Ouvrir « Edgar partagé »');
  assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.dataset.act), 'open', 'le focus passe à « Ouvrir »');
  const d1 = await decks(p); assert.equal(d1.length, 1); assert.equal(d1[0].name, 'Edgar partagé', 'nom du partage');
  assert.equal(d1[0].text, TEXT, 'liste complète, réserve comprise, à l\'identique'); assert.equal(d1[0].opts.lang, 'en'); assert.equal(d1[0].opts.cond, 'Near Mint');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:decks:v1')).length), 1, 'gardé sur l\'appareil');
  await shot(p, 'sharedeck-2-enregistre.png');
  await p.click('.dv.on [data-act="save"]', { force: true }); assert.equal((await decks(p)).length, 1, 'second toucher : rien de plus');
  // « Voir » : le viewer se ferme, Mes decks s'ouvre avec le deck
  await p.click('#toast .toast-act'); await p.waitForSelector('.dks.on .deck', { timeout: 4000 });
  assert.equal(await txt(p, '.dks.on .deck-name'), 'Edgar partagé'); assert.ok(!(await p.$('.dv.on:not(.dks)')), 'viewer du lien fermé'); assert.equal(new URL(p.url()).search, '', '?p= retiré');
  ok('lien partagé : « Enregistrer dans mes decks » → nom et liste exacts (réserve comprise), critères du visiteur, toast « Voir » → Mes decks');

  // lien rouvert : copie reconnue d'emblée (même liste), « Ouvrir » → le viewer du deck enregistré
  await p.goto(world.url + '?p=' + SID); await p.waitForSelector('.dv.on .dv-sum'); await p.waitForFunction(() => D.authReady);
  assert.deepEqual(await foot(p), SAVED, 'rouvert : déjà dans Mes decks');
  await p.click('.dv.on [data-act="open"]'); await p.waitForSelector('.dv.on [data-act="share"]');
  assert.deepEqual(await p.evaluate(() => [DV.deckId, DV.pub, DV.adhoc, DV.name]), [d1[0].id, false, false, 'Edgar partagé'], 'viewer du deck enregistré');
  assert.ok(await p.$eval('.dv.on [data-act="save"]', b => b.hidden), 'deck à soi : pas d\'« Enregistrer »');
  assert.equal((await decks(p)).length, 1, 'aucun doublon');
  await p.evaluate(() => closeDeckViewer()); await p.waitForTimeout(300);
  // copie supprimée pendant que le lien est ouvert : le bouton revient (Mes decks → renderDecks → pied du viewer)
  await p.goto(world.url + '?p=' + SID); await p.waitForSelector('.dv.on .dv-sum'); await p.waitForFunction(() => D.authReady);
  await p.evaluate(id => removeDeck(id), d1[0].id); assert.deepEqual(await foot(p), UNSAVED, 'copie supprimée : on peut l\'enregistrer à nouveau');
  // alertes de prix possibles mais coupées : le toast les propose (alSaveOffer, comme la feuille EDHREC et « Enregistrer le deck »)
  await p.evaluate(() => { CTX.proxy = true; CTX.alerts = true; CTX.vapid = 'k'; AC.on = false; });
  await p.click('.dv.on [data-act="save"]'); assert.equal(await txt(p, '#toast'), '« Edgar partagé » ajouté à Mes decks · Me prévenir des baisses ? Activer');
  assert.deepEqual(await foot(p), SAVED); assert.equal((await decks(p)).length, 1);
  await p.close();
  ok('lien rouvert : « ✓ Dans mes decks » + « Ouvrir » (viewer du deck, sans doublon) ; copie supprimée : bouton revenu ; alertes coupées : « Me prévenir des baisses ? »');
}

/* ── 2) visiteur connecté (faux cloud) : attente du compte, envoi dans le compte, champs permis par les règles ─────────────── */
{
  const { p, errs } = await newPage(browser, world, { goto: false, init: 'try { localStorage.setItem("deckdeal:acct", JSON.stringify({ l: "B" })); } catch (e) {}' }); errsOf.push(errs);
  await p.route('https://www.gstatic.com/**', () => {});      // SDK qui ne répond pas : la session enregistrée n'est pas encore restaurée
  await routeRest(p);
  const saved = [];
  await p.exposeFunction('__save', (id, data) => { saved.push({ id, data }); });
  await p.goto(world.url + '?p=' + SID); await p.waitForSelector('.dv.on .dv-sum');
  assert.deepEqual(await foot(p), [['close', 'Fermer', false, true], ['save', 'Enregistrer dans mes decks', true, false]], 'compte en cours de restauration : enregistrement en attente (pas de doublon)');
  await p.evaluate(() => {
    let n = 0; window.__docs = [];
    const emit = () => setTimeout(() => window.__deckCb && window.__deckCb(window.__docs.map(x => ({ id: x.id, data: x.data })), false), 30);      // Firestore : l'écriture locale revient par l'écoute
    D.cloud = {
      onUser() {}, watch: (uid, cb) => { window.__deckCb = cb; emit(); return () => {}; }, newId: () => 'cloud' + (++n), remove: async () => {},
      save: async (uid, id, data) => { await window.__save(id, data); window.__docs = window.__docs.filter(x => x.id !== id).concat({ id, data }); emit(); },
      watchColl(uid, cb) { cb(null, false, false); return () => {}; }, txColl: async (uid, fn) => fn(null), pullColl: async () => ({ data: null }), saveColl: async () => {},
      watchMeta(uid, id, cb) { cb(null, false, false); return () => {}; }, saveMeta: async () => {}, pullMeta: async () => ({ data: null }),
      shareId: () => 'x', saveShare: async () => {}, dropShare: async () => {},
    };
    D.state = 'ready'; D.err = '';
    onUser({ uid: 'u2', email: 'bea@example.com', displayName: 'Bea', reload: async () => {} });
  });
  await p.waitForFunction(() => !document.querySelector('.dv.on [data-act="save"]').disabled, null, { timeout: 4000 });
  assert.deepEqual(await foot(p), UNSAVED, 'compte prêt, deck absent du compte : bouton actif');
  await p.click('.dv.on [data-act="save"]');
  assert.equal(await txt(p, '#toast'), '« Edgar partagé » ajouté à Mes decks Voir'); assert.deepEqual(await foot(p), SAVED);
  assert.equal(saved.length, 1, 'une écriture dans le compte'); assert.equal(saved[0].id, 'cloud1');
  const doc = saved[0].data, RULES = ['name', 'text', 'opts', 'cards', 'history', 'snap', 'createdAt', 'updatedAt'];      // firestore.rules, users/{uid}/decks : keys().hasOnly(…)
  assert.deepEqual(Object.keys(doc).filter(k => !RULES.includes(k)), [], 'seulement des champs permis par les règles'); assert.equal(doc.text, TEXT); assert.equal(doc.name, 'Edgar partagé');
  assert.ok(doc.text.length <= 60000 && doc.name.length <= 120 && typeof doc.updatedAt === 'number');
  await p.waitForFunction(() => allDecks().length === 1); assert.deepEqual(await foot(p), SAVED, 'revenu de la synchro : toujours une seule copie');
  await p.click('.dv.on [data-act="open"]'); await p.waitForSelector('.dv.on [data-act="share"]'); assert.equal(await p.evaluate(() => DV.deckId), 'cloud1');
  await p.evaluate(() => closeDeckViewer()); await p.waitForTimeout(300);
  // même compte, lien rouvert : la copie du compte est reconnue dès que la liste arrive
  await p.evaluate(() => openPublicLink('ShareDeck0000001')); await p.waitForSelector('.dv.on .dv-sum');
  assert.deepEqual(await foot(p), SAVED, 'copie du compte reconnue'); assert.equal(saved.length, 1, 'pas de second envoi');
  await p.close();
  ok('connecté : bouton en attente pendant la restauration du compte, deck envoyé au compte (champs des règles, texte exact), reconnu au retour de la synchro et à la réouverture');
}

/* ── 3) deck EDHREC : « Voir le deck » de la feuille → viewer avec le même « Enregistrer dans mes decks » (nom de la feuille) ─── */
{
  const filler = (n, from = 0) => Array.from({ length: n }, (_, i) => `K\t1\tFiller ${from + i}`);
  const FILE = ['#edh\t1\t2026-10-03T04:00:00Z', 'C\tedgar-markov\t12345\tWBR\tEdgar Markov',
    'D\tedgar-markov\tedhrec\tDeck moyen\thttps://edhrec.com/average-decks/edgar-markov', 'K\t1\tSol Ring', 'K\t1\tArcane Signet', 'K\t1\tCommand Tower', 'K\t8\tPlains', ...filler(20),
    'D\tedgar-markov\tarchidekt\tUpping the Average · 4 200 vues\thttps://archidekt.com/decks/42', 'K\t1\tSol Ring', 'K\t1\tArcane Signet', ...filler(24, 300),
    'P\t150\tSol Ring', 'P\t40\tArcane Signet'].join('\n') + '\n';
  const { p, errs } = await newPage(browser, world, { ctx: { colorScheme: 'dark' } }); errsOf.push(errs);
  await signInFake(p);      // decks EDHREC : réservés aux comptes vérifiés (gate-e2e)
  await p.route('**/edh.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: FILE }));
  await p.evaluate(() => edhLoad());
  const rows = await p.evaluate(() => edhRows().map((r, i) => ({ i, k: r.deck.k, src: r.deck.src, save: edhSaveName(r), text: edhDeckText(r.deck), shown: r.cmd.names.join(' + ') })));
  const arch = rows.find(r => r.src === 'archidekt'); assert.ok(arch, 'deck Archidekt dans le fichier');
  assert.notEqual(arch.save, arch.shown, 'nom enregistré ≠ nom affiché : ' + arch.save);
  const openSheet = async i => { await p.evaluate(i => openEdhDeck(edhRows()[i]), i); await p.waitForSelector('.dk-acts2 .dk-act'); };
  await openSheet(arch.i); await p.click('.sheet [data-act="dkview"]'); await p.waitForSelector(`.dv.on[aria-label="Deck viewer · ${arch.shown}"]`);
  await p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 3000 });
  assert.equal(await p.evaluate(() => DV.text), arch.text, 'viewer : la liste complète du deck'); assert.deepEqual(await foot(p), UNSAVED, 'même bouton que pour un lien partagé');
  await p.click('.dv.on [data-act="save"]');
  assert.equal(await txt(p, '#toast'), `« ${arch.save} » ajouté à Mes decks Voir`); assert.deepEqual(await foot(p), SAVED);
  const d = await decks(p); assert.equal(d.length, 1); assert.equal(d[0].name, arch.save, 'nom de la feuille (edhSaveName), passé par l\'ouvreur'); assert.equal(d[0].text, arch.text, 'texte identique au viewer');
  await shot(p, 'sharedeck-3-edhrec.png');
  // la feuille reconnaît la copie enregistrée depuis le viewer, et inversement
  await p.evaluate(() => closeDeckViewer()); await p.waitForTimeout(300); await openSheet(arch.i);
  assert.deepEqual(await p.$eval('.dk-act[data-act="dksave"]', b => [b.querySelector('b').textContent, b.disabled]), ['Dans mes decks', true], 'feuille : déjà dans Mes decks');
  await p.click('.sheet [data-act="dkview"]'); await p.waitForSelector('.dv.on .dv-sum'); assert.deepEqual(await foot(p), SAVED, 'viewer rouvert depuis la feuille : copie reconnue');
  await p.evaluate(() => closeDeckViewer()); await p.waitForTimeout(300);
  const avg = rows.find(r => r.k === 'avg'); await openSheet(avg.i); await p.click('.dk-act[data-act="dksave"]'); await p.click('.sheet [data-act="dkview"]'); await p.waitForSelector('.dv.on .dv-sum');
  assert.deepEqual(await foot(p), SAVED, 'enregistré par la feuille : le viewer le sait');
  await p.click('.dv.on [data-act="open"]'); await p.waitForSelector('.dv.on [data-act="share"]'); assert.equal(await p.evaluate(() => DV.name), avg.save);
  assert.equal((await decks(p)).length, 2, 'deux decks, pas de doublon');
  await p.close();
  ok('deck EDHREC : viewer de la feuille → « Enregistrer dans mes decks » (nom de la feuille, texte identique), copie reconnue par la feuille et par le viewer, « Ouvrir »');
}

for (const e of errsOf) assert.deepEqual(e, [], 'erreurs page : ' + e.join(' | '));
await browser.close(); world.stop();
console.log('SHAREDECK E2E OK');
process.exit(0);
