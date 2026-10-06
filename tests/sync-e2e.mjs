// E2E synchro multi-appareils : deux (puis trois) téléphones sur le même compte, face à un faux Firestore transactionnel partagé
// (lecture + écriture conditionnelle à la version, comme runTransaction ; écoute temps réel ; latence ; hors ligne).
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, ok, txt } from './e2e-world.mjs';

const world = await startWorld({ port: 18940 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── faux serveur Firestore (un document users/u1/meta/collection) ───────────────────────────────── */
const server = { doc: null, ver: 0, writes: 0, conflicts: 0, lat: 40, txDelay: 0, off: new Set(), subs: new Map() };
const broadcast = () => { for (const [n, pg] of server.subs) if (!server.off.has(n)) setTimeout(() => pg.evaluate(d => window.__snap && window.__snap(d), server.doc).catch(() => {}), server.lat); };
const serverText = () => (server.doc ? server.doc.text : null);
const serverSet = text => { server.doc = { text, count: text ? text.split('\n').length : 0, updatedAt: (server.doc ? server.doc.updatedAt : 0) + 1 }; server.ver++; broadcast(); };

async function phone(name, opts = {}) {
  const { p, ctx, errs } = await newPage(browser, world, { goto: false });
  await p.route('https://www.gstatic.com/**', r => r.abort());                 // pas de vrai SDK : on injecte le faux cloud
  await p.exposeFunction('__fsRead', async () => { await sleep(server.lat); if (server.off.has(name)) return { err: 1 }; await sleep(server.txDelay); return { data: server.doc, ver: server.ver }; });
  await p.exposeFunction('__fsCommit', async (ver, doc) => {
    await sleep(server.lat); if (server.off.has(name)) return { err: 1 };
    if (ver !== server.ver) { server.conflicts++; return { conflict: 1 }; }
    server.doc = doc; server.ver++; server.writes++; broadcast(); return { ok: 1 };
  });
  await p.exposeFunction('__fsSub', () => { server.subs.set(name, p); });
  await p.goto(world.url); await p.waitForFunction(() => D.authReady, null, { timeout: 15000 });
  const page = { name, p, ctx, errs, signed: false };
  if (opts.signIn !== false) await signIn(page);
  return page;
}
async function signIn(P) {
  await P.p.evaluate(() => {
    const unav = () => Object.assign(new Error('unavailable'), { code: 'unavailable' });
    window.__snap = d => window.__cb && window.__cb(d, false, false);
    D.cloud = {
      onUser() {}, watch: (uid, cb) => { cb([], false); return () => {}; }, newId: () => 'x', save: async () => {}, remove: async () => {}, saveColl: async () => {},
      watchColl(uid, cb) { window.__cb = cb; window.__fsSub(); cb(null, false, true); window.__fsRead().then(r => { if (!r.err) cb(r.data, false, false); }); return () => { window.__cb = null; }; },
      async txColl(uid, fn) {
        for (let i = 0; i < 5; i++) {
          const r = await window.__fsRead(); if (r.err) throw unav();
          const out = fn(r.data); if (!out) return out;
          const c = await window.__fsCommit(r.ver, out); if (c.err) throw unav(); if (c.ok) return out;
        }
        throw Object.assign(new Error('aborted'), { code: 'aborted' });
      },
      pullColl: async () => { const r = await window.__fsRead(); if (r.err) throw unav(); return { data: r.data }; },
    };
    D.state = 'ready'; D.err = ''; COLL_RETRY.off = 600; COLL_RETRY.err = 600;
    onUser({ uid: 'u1', email: 'beer@example.com', displayName: 'Beer' });
  });
  P.signed = true;
}

/* ── aides ───────────────────────────────────────────────────────────────────────────────────────── */
const mapOf = P => P.p.evaluate(() => Object.fromEntries(Object.entries(COLL.map).map(([k, v]) => [k, v.q + (v.l ? '/' + v.l : '')])));
async function expectMap(P, exp, label, timeout = 9000) {
  const t0 = Date.now(); let got;
  while (Date.now() - t0 < timeout) { got = await mapOf(P); if (JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(exp).sort())) return; await sleep(120); }
  assert.deepEqual(got, exp, `${P.name} : ${label}`);
}
const both = async (A, B, exp, label) => { await Promise.all([expectMap(A, exp, label), expectMap(B, exp, label)]); };
/** Plus aucune écriture ni changement : la synchro s'est arrêtée (pas de ping-pong entre appareils). */
async function quiet(label, ms = 2200) { let w; do { w = server.writes; await sleep(ms); } while (w !== server.writes); return w; }
const add = (P, name, q = 1, l = '') => P.p.evaluate(([n, q, l]) => collAdd([{ k: ownKey(n), n, q, ...(l ? { l } : {}) }], 'add'), [name, q, l]);
const bump = (P, name, d) => P.p.evaluate(([n, d]) => collBump(ownKey(n), n, d), [name, d]);
const cloudState = P => P.p.evaluate(() => COLL.cloud);
const textOf = () => (serverText() || '').split('\n').filter(Boolean).sort();
const noErrs = P => assert.deepEqual(P.errs, [], P.name + ' : erreurs JS');

/* ═════════════════════════════════════════════════════════════════════════════════════════════════ */
const A = await phone('A'), B = await phone('B');
await sleep(500);
assert.equal(await cloudState(A), 'ok'); assert.equal(await cloudState(B), 'ok'); assert.equal(server.writes, 0, 'comptes vides : rien n\'est écrit');
ok('2 téléphones connectés au même compte vide : état « ok », aucune écriture');

/* 1) ajout sur A → apparaît sur B, avec le texte attendu dans le compte */
await add(A, 'Sol Ring', 2); await add(A, 'Counterspell', 1);
await both(A, B, { 'sol ring': '2', counterspell: '1' }, 'ajout');
assert.deepEqual(textOf().map(l => l.replace(/ \(D[0-9a-z]{6}\)/, '')), ['1 Counterspell', '2 Sol Ring']); assert.ok(textOf().every(l => / \(D[0-9a-z]{6}\)$/.test(l)), 'date d\'ajout envoyée au compte avec chaque carte');
assert.match(await txt(B.p, '#toast'), /Autre appareil : \+2 cartes|Autre appareil : \+1 carte/);
ok('A ajoute 2 cartes → B les reçoit tout seul (toast « Autre appareil »)');

/* 2) quantité, retrait, langue : dans les deux sens */
await bump(B, 'Sol Ring', 1); await expectMap(A, { 'sol ring': '3', counterspell: '1' }, 'B +1');
await bump(B, 'Counterspell', -1); await both(A, B, { 'sol ring': '3' }, 'B retire une carte');
await A.p.evaluate(() => collSetLang('sol ring', 'fr')); await both(A, B, { 'sol ring': '3/fr' }, 'langue posée sur A');
await B.p.evaluate(() => collSetLang('sol ring', 'de')); await both(A, B, { 'sol ring': '3/de' }, 'langue changée sur B');
assert.deepEqual(textOf().map(l => l.replace(/ \(D[0-9a-z]{6}\)/, '')), ['3 Sol Ring *DE*']);
ok('quantité, retrait (jusqu\'à 0) et langue se propagent dans les deux sens');

/* 3) écran « Ma collection » ouvert sur B : la liste se met à jour sans rien toucher ; les boutons ± de B arrivent sur A */
await B.p.click('#btnColl'); await B.p.waitForSelector('.coll.on'); await B.p.waitForFunction(() => document.querySelectorAll('.crow').length === 1);
await add(A, 'Lightning Bolt', 1);
await B.p.waitForFunction(() => document.querySelectorAll('.crow').length === 2, null, { timeout: 8000 });
assert.match(await txt(B.p, '.coll-sync'), /Sauvegardée dans ton compte/);
await B.p.screenshot({ path: 'shots/sync-b-live.png' });
await B.p.click('.crow[data-k="sol ring"] .qstep [data-d="1"]'); await expectMap(A, { 'sol ring': '4/de', 'lightning bolt': '1' }, 'bouton + sur B');
await B.p.click('.crow[data-k="lightning bolt"] .qstep [data-d="-1"]'); await B.p.click('.sheet [data-ok]'); await both(A, B, { 'sol ring': '4/de' }, 'bouton − sur B (retrait)');
await B.p.waitForFunction(() => document.querySelectorAll('.crow').length === 1);
await B.p.keyboard.press('Escape'); await sleep(300);
ok('liste ouverte sur B : suit A en direct ; les boutons +/− de B arrivent sur A');
await quiet(); noErrs(A); noErrs(B);

/* 4) changements simultanés sur les deux téléphones (le serveur met 300 ms entre lecture et écriture : un des deux envois est rejoué) */
server.txDelay = 300; const c0 = server.conflicts;
await Promise.all([add(A, 'Brainstorm', 1), add(B, 'Ponder', 2)]);
await both(A, B, { 'sol ring': '4/de', brainstorm: '1', ponder: '2' }, 'ajouts simultanés de cartes différentes');
assert.ok(server.conflicts > c0, 'un envoi a bien été en concurrence (transaction rejouée)');
await Promise.all([bump(A, 'Brainstorm', 1), bump(B, 'Brainstorm', 2)]);
await both(A, B, { 'sol ring': '4/de', brainstorm: '4', ponder: '2' }, '+1 sur A et +2 sur B sur la même carte = +3');
await Promise.all([bump(A, 'Ponder', -2), bump(B, 'Ponder', 1)]);
await both(A, B, { 'sol ring': '4/de', brainstorm: '4', ponder: '3' }, 'retrait sur A contre +1 sur B : la modification l\'emporte');
await Promise.all([add(A, 'Opt', 1), bump(B, 'Brainstorm', -1)]); await both(A, B, { 'sol ring': '4/de', brainstorm: '3', ponder: '3', opt: '1' }, 'ajout + retrait en même temps');
ok('changements simultanés : rien de perdu, cartes différentes ajoutées, quantités additionnées');
await quiet(); server.txDelay = 0;

/* 5) taper plusieurs fois pendant qu'un envoi est en cours : rien d'oublié */
server.txDelay = 500;
await bump(A, 'Sol Ring', 1); await sleep(900); await bump(A, 'Sol Ring', 1); await sleep(300); await bump(A, 'Sol Ring', 1); await add(A, 'Mana Crypt', 1);
await both(A, B, { 'sol ring': '7/de', brainstorm: '3', ponder: '3', opt: '1', 'mana crypt': '1' }, 'taps pendant un envoi');
ok('plusieurs changements pendant un envoi en cours : tous arrivent');
await quiet(); server.txDelay = 0;

/* 6) horloges des téléphones décalées (±1 h) : sans effet */
await A.p.evaluate(() => { const r = Date.now.bind(Date); Date.now = () => r() + 3600e3; });
await B.p.evaluate(() => { const r = Date.now.bind(Date); Date.now = () => r() - 3600e3; });
await add(B, 'Swords to Plowshares', 1); await both(A, B, { 'sol ring': '7/de', brainstorm: '3', ponder: '3', opt: '1', 'mana crypt': '1', 'swords to plowshares': '1' }, 'B (horloge en retard) → A');
await add(A, 'Path to Exile', 1); await both(A, B, { 'sol ring': '7/de', brainstorm: '3', ponder: '3', opt: '1', 'mana crypt': '1', 'swords to plowshares': '1', 'path to exile': '1' }, 'A (horloge en avance) → B');
await bump(B, 'Opt', -1); await bump(A, 'Brainstorm', -3); await both(A, B, { 'sol ring': '7/de', ponder: '3', 'mana crypt': '1', 'swords to plowshares': '1', 'path to exile': '1' }, 'retraits malgré l\'horloge');
ok('horloges décalées de ±1 h : les changements passent quand même dans les deux sens');
await quiet();

/* 7) réponses douteuses du SDK : cache vide, version périmée */
const w7 = server.writes, base7 = await mapOf(A);
await A.p.evaluate(() => collFromCloud('u1', null, false, true));                                           // « pas de document » venant du cache : on attend le serveur
await A.p.evaluate(() => collFromCloud('u1', { text: '', count: 0, updatedAt: 1 }, false, true));            // copie de cache vide : ignorée
await sleep(1500); assert.deepEqual(await mapOf(A), base7, 'cache vide : rien d\'effacé'); assert.equal(server.writes, w7, 'cache vide : rien d\'écrit');
const stale = server.doc; await bump(B, 'Mana Crypt', 2); await both(A, B, { 'sol ring': '7/de', ponder: '3', 'mana crypt': '3', 'swords to plowshares': '1', 'path to exile': '1' }, 'B +2');
await A.p.evaluate(d => window.__snap(d), stale); await sleep(800);                                          // un vieux snapshot arrive en retard
assert.equal((await mapOf(A))['mana crypt'], '3', 'vieux snapshot ignoré'); await quiet();
ok('snapshot de cache vide ou arrivé en retard : ignoré (rien d\'effacé, rien de renvoyé)');

/* 8) le document du compte disparaît (supprimé à la main dans la console) : les cartes ne sont pas perdues */
const full = await mapOf(A); server.doc = null; server.ver++; broadcast();
await sleep(2500); await quiet(); assert.deepEqual(await mapOf(A), full); assert.deepEqual(await mapOf(B), full); assert.deepEqual(textOf().length, Object.keys(full).length, 'compte reconstitué');
ok('document du compte supprimé : reconstitué depuis les téléphones, rien d\'effacé');

/* 9) compte vidé d'un coup (autre appareil / erreur) : annulable */
const bulk = []; for (let i = 1; i <= 12; i++) bulk.push({ k: 'carte ' + i, n: 'Carte ' + i, q: 1 });
await A.p.evaluate(b => collAdd(b, 'add'), bulk); await expectMap(B, { ...full, ...Object.fromEntries(bulk.map(b => [b.k, '1'])) }, '12 cartes en plus'); await quiet();
serverSet('');                                                                                              // le compte est vidé
await Promise.all([expectMap(A, {}, 'vidé'), expectMap(B, {}, 'vidé')]);
assert.match(await txt(A.p, '#toast'), /17 cartes retirées depuis un autre appareil/); assert.ok(await A.p.$('#toast .toast-act'));
await A.p.click('#toast .toast-act');
await both(A, B, { ...full, ...Object.fromEntries(bulk.map(b => [b.k, '1'])) }, 'annulation');
assert.equal(textOf().length, Object.keys(full).length + 12, 'compte rétabli par l\'annulation');
ok('compte vidé d\'un coup : cartes retirées sur les 2 téléphones, mais « Annuler » les rétablit partout');
await quiet();
const all17 = await mapOf(A);

/* 10) hors ligne : B garde ses changements, A continue ; au retour tout est fusionné */
await B.p.click('#btnColl'); await B.p.waitForSelector('.coll.on');
await B.ctx.setOffline(true); server.off.add('B'); await B.p.waitForTimeout(200);
await add(B, 'Wrath of God', 1); await bump(B, 'Sol Ring', 2); await bump(B, 'Carte 1', -1);
await add(A, 'Command Tower', 1); await bump(A, 'Sol Ring', 1); await bump(A, 'Carte 2', -1);
const onlyA = { ...all17, 'command tower': '1', 'sol ring': '8/de' }; delete onlyA['carte 2'];
await expectMap(A, onlyA, 'A seul'); await sleep(800);
assert.equal(await cloudState(B), 'offline'); assert.match(await txt(B.p, '.coll-sync'), /Hors ligne : tes changements restent sur cet appareil/); assert.equal(await B.p.$eval('.coll-sync', e => e.dataset.k), 'warn');
assert.match(await txt(B.p, '.coll .dv-title span'), /hors ligne/);
await B.p.screenshot({ path: 'shots/sync-offline.png' });
assert.equal((await mapOf(B))['wrath of god'], '1', 'B garde ses cartes en local');
assert.equal((await mapOf(A))['wrath of god'], undefined, 'A ne voit pas encore les cartes de B');
server.off.delete('B'); await B.ctx.setOffline(false); setTimeout(() => B.p.evaluate(d => window.__snap(d), server.doc).catch(() => {}), 100);   // réseau revenu (le SDK renvoie un snapshot)
const merged10 = { ...all17, 'wrath of god': '1', 'command tower': '1', 'sol ring': '10/de' }; delete merged10['carte 1']; delete merged10['carte 2'];
await both(A, B, merged10, 'retour du réseau : fusion');
await B.p.waitForFunction(() => /Sauvegardée dans ton compte/.test(document.querySelector('.coll-sync').innerText));
await B.p.screenshot({ path: 'shots/sync-retour.png' });
ok('hors ligne : B garde ses changements, A continue ; au retour du réseau tout est fusionné (Sol Ring +2 et +1 additionnés)');
await B.p.keyboard.press('Escape'); await quiet();

/* 11) SDK hors ligne, réseau « up » + rechargement de la page : les changements d'avant le rechargement ne se perdent pas */
server.off.add('B'); await add(B, 'Brainstorm', 1); await B.p.waitForFunction(() => COLL.cloud === 'offline', null, { timeout: 8000 });
await add(A, 'Dark Ritual', 1);
await B.p.reload(); await B.p.waitForFunction(() => D.authReady, null, { timeout: 15000 });
assert.equal((await mapOf(B))['brainstorm'], '1', 'collection locale rechargée');
assert.equal(await B.p.evaluate(() => COLL.base && Object.keys(COLL.base).length > 0), true, 'dernier état du compte rechargé avec la collection');
server.off.delete('B'); await signIn(B);
const merged11 = { ...merged10, brainstorm: '1', 'dark ritual': '1' };
await both(A, B, merged11, 'après rechargement'); await quiet();
ok('rechargement pendant une coupure : changements locaux + base gardés, fusion correcte à la reconnexion');

/* 12) déconnexion : la collection reste, rien n'est envoyé ; reconnexion = fusion */
await B.p.evaluate(() => onUser(null)); await sleep(200);
const w12 = server.writes; await add(B, 'Sol Ring', 1); await sleep(1800); assert.equal(server.writes, w12, 'déconnecté : rien envoyé');
await add(A, 'Vampiric Tutor', 1); await sleep(1000); assert.equal((await mapOf(B))['vampiric tutor'], undefined, 'déconnecté : rien reçu');
await signIn(B); await both(A, B, { ...merged11, 'sol ring': '11/de', 'vampiric tutor': '1' }, 'reconnexion'); await quiet();
ok('déconnecté : la collection reste sur le téléphone, rien ne part ; reconnecté : fusionné');

/* 13) troisième téléphone, déjà des cartes en local avant de se connecter : union avec le compte, rien d'écrasé */
const C = await phone('C', { signIn: false });
await add(C, 'Mox Pearl', 1); await add(C, 'Sol Ring', 20);
await signIn(C);
const final = { ...merged11, 'sol ring': '20/de', 'vampiric tutor': '1', 'mox pearl': '1' }; final['sol ring'] = '20/de';
await expectMap(C, final, 'C après union'); assert.match(await txt(C.p, '#toast'), /fusionnées/);
await Promise.all([expectMap(A, final, 'A après union C'), expectMap(B, final, 'B après union C')]);
ok('3e téléphone avec cartes locales : union (plus grande quantité) avec le compte, propagée aux 2 autres');
await quiet(); for (const P of [A, B, C]) noErrs(P);
ok('aucune erreur JS, synchro stable (plus aucune écriture une fois les téléphones d\'accord)');

await browser.close(); world.stop(); console.log("\nSYNC E2E OK"); process.exit(0);
