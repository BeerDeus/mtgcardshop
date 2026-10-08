// E2E liste d'échange et partages publics : onglet « Échange » (doublons, réserve, Garder, souhaits), lien public tenu à jour,
// visiteur en lecture seule (recherche FR/EN, filtres), deck partagé (viewer public, main de départ), lien arrêté. Faux Firestore (partages) côté test.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, ok, txt, toInput, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18960 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errsOf = [];

const shares = new Map(), meta = {}; let shareWrites = 0, ids = 0;
const DECK = 'Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n1 Swords to Plowshares\n1 Craterhoof Behemoth\n1 Command Tower\n1 Arcane Signet\n10 Plains';
const COLL = '5 Sol Ring *FR*\n2 Swords to Plowshares\n1 Wrath of God\n3 Llanowar Elves *EN*\n12 Plains';
const FR = ['# fr-names', 'Anneau solaire\tSol Ring\tfront/fr/sol-ring.jpg', 'Elfes de Llanowar\tLlanowar Elves\t', 'Béhémoth Cratérosabot\tCraterhoof Behemoth\t', ...Array.from({ length: 600 }, (_, i) => `Vrombl ${i}\tVrombl Card ${i}\t`)].join('\n') + '\n';      // le catalogue n'est accepté qu'à partir de 500 noms

/** Faux Firestore REST (lecture publique d'un partage) : ce que le visiteur voit. */
async function routeRest(p) {
  await p.route('https://firestore.googleapis.com/**', route => {
    const u = new URL(route.request().url()), id = decodeURIComponent(u.pathname.split('/').pop()), h = { 'access-control-allow-origin': '*' };
    assert.equal(route.request().method(), 'GET', 'le visiteur ne fait que lire'); assert.equal(u.searchParams.get('key'), 'AIzaSyCznNtazqWMhiYlPxce3O0Ss06mycgp6TY');
    const s = shares.get(id);
    if (!s) return route.fulfill({ status: 404, headers: h, json: { error: { code: 404, status: 'NOT_FOUND' } } });
    route.fulfill({ status: 200, headers: h, json: { name: 'projects/m2s-mtg/databases/(default)/documents/shares/' + id, fields: { o: { stringValue: s.o }, kind: { stringValue: s.kind }, v: { integerValue: '1' }, updatedAt: { integerValue: String(s.updatedAt) }, d: { stringValue: s.d } } } });
  });
  await p.route(world.url + 'fr-names.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: FR }));
}

/* ── Propriétaire : compte (faux cloud), collection, un deck Commander ─────────────────────────── */
const seed = `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: ${JSON.stringify(COLL)}, u: 1, s: '', b: null })); } catch (e) {}`;
const { p, errs } = await newPage(browser, world, { goto: false, init: seed }); errsOf.push(errs);
await p.route('https://www.gstatic.com/**', r => r.abort());
await routeRest(p);
await p.exposeFunction('__share', (op, id, data) => { if (op === 'set') { shares.set(id, data); shareWrites++; } else shares.delete(id); });
await p.exposeFunction('__meta', (id, data) => { meta[id] = data; });
await p.goto(world.url); await p.waitForFunction(() => D.authReady, null, { timeout: 15000 });
await p.evaluate(deck => {
  D.cloud = {
    onUser() {}, watch: (uid, cb) => { cb([{ id: 'deck1', data: { name: 'Edgar', text: deck, createdAt: 1, updatedAt: 2 } }], false); return () => {}; }, newId: () => 'x', save: async () => {}, remove: async () => {},
    watchColl(uid, cb) { cb(null, false, false); return () => {}; }, txColl: async (uid, fn) => { const out = fn(window.__collDoc || null); if (out) window.__collDoc = out; return out; }, pullColl: async () => ({ data: window.__collDoc || null }), saveColl: async () => {},      // le document écrit reste dans le compte
    watchMeta(uid, id, cb) { cb(null, false, false); return () => {}; }, saveMeta: async (uid, id, data) => { await window.__meta(id, data); }, pullMeta: async () => ({ data: null }),
    shareId: () => window.__shareIdNext, saveShare: async (id, data) => { await window.__share('set', id, data); }, dropShare: async id => { await window.__share('drop', id); },
  };
  D.state = 'ready'; D.err = '';
  onUser({ uid: 'u1', email: 'beer@example.com', displayName: 'Beer', reload: async () => {} });
}, DECK);
const nextId = async () => { const id = 'Share' + String(++ids).padStart(12, '0'); await p.evaluate(i => { window.__shareIdNext = i; }, id); return id; };

await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on');
await p.click('#collSeg [data-v="trade"]'); await p.waitForSelector('.tr-box');
{
  const have = await p.$$eval('.tr-list .tr-row', r => r.map(x => [x.dataset.k, x.querySelector('.tr-q b').textContent.trim()]));
  assert.deepEqual(have, [['llanowar elves', '× 2'], ['sol ring', '× 3']], 'réserve 1 : Sol Ring 5 − 1 (deck) − 1 ; Swords 2 − 1 − 1 = 0 ; Wrath 1 − 1 = 0 ; terrains de base exclus');
  assert.match(await txt(p, '.tr-list .tr-row[data-k="sol ring"] .row-name'), /Anneau solaire|Sol Ring/);
  assert.match(await txt(p, '.tr-keep .hint'), /utilisées par ton deck − réserve/); await p.waitForTimeout(600); await p.screenshot({ path: 'shots/trade-1-echange.png' });
  await p.click('#trKeep [data-v="0"]'); await p.waitForFunction(() => document.querySelectorAll('.tr-list .tr-row').length === 4);
  assert.deepEqual(await p.$$eval('.tr-list .tr-row', r => r.map(x => x.dataset.k + ' ' + x.querySelector('.tr-q b').textContent.trim())), ['llanowar elves × 3', 'sol ring × 4', 'swords to plowshares × 1', 'wrath of god × 1'], 'réserve 0 : tout ce que les decks n\'utilisent pas');
  await p.click('.tr-row[data-k="wrath of god"] [data-act="tkeep"]'); await p.waitForFunction(() => !document.querySelector('.tr-list .tr-row[data-k="wrath of god"]'));
  assert.match(await txt(p, '.tr-held summary'), /Gardées à la main \(1\)/);
  await p.click('#trKeep [data-v="1"]'); await p.waitForFunction(() => document.querySelectorAll('.tr-list .tr-row').length === 2);
  assert.ok(!(await p.$('.tr-held')), 'réserve 1 : Wrath n\'aurait pas été proposée, rien à montrer dans « Gardées »');
  ok('À échanger : possédé − deck − réserve (0 ou 1), Garder, terrains de base exclus');
}
{
  await p.click('#trSub [data-v="want"]'); await p.waitForSelector('.tr-addw');
  assert.deepEqual(await p.$$eval('.tr-list .tr-row', r => r.map(x => x.dataset.k)), ['arcane signet', 'command tower', 'craterhoof behemoth', 'edgar markov'], 'manquantes du deck, commandant compris');
  await p.click('[data-act="wadd"]'); await p.waitForSelector('#waName');
  await p.waitForFunction(() => !document.querySelector('#waStatus') || document.querySelector('#waStatus').hidden, null, { timeout: 8000 });
  await p.fill('#waName', 'Wrath'); await p.waitForSelector('.ca-opt'); await p.click('.ca-opt'); await p.click('.ca-opt');
  assert.equal(await txt(p, '.ca-opt i'), '× 2');
  await p.click('.sheet [data-close].icon-btn'); await p.waitForTimeout(500);
  assert.match(await txt(p, '.tr-row[data-k="wrath of god"] .row-meta'), /souhait × 2/); assert.equal(await txt(p, '.tr-row[data-k="wrath of god"] .qstep b'), '2');
  await p.click('.tr-row[data-k="wrath of god"] [data-act="wminus"]'); await p.waitForTimeout(150);
  assert.equal(await txt(p, '.tr-row[data-k="wrath of god"] .qstep b'), '1'); await p.waitForTimeout(500); await p.screenshot({ path: 'shots/trade-2-recherche.png' });
  await p.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = t => { window.__clip.push(t); return Promise.resolve(); }; });
  await p.click('[data-act="wcm"]'); await p.waitForTimeout(200);
  assert.equal((await p.evaluate(() => window.__clip))[0], '1 Arcane Signet\n1 Command Tower\n1 Craterhoof Behemoth\n1 Edgar Markov\n1 Wrath of God', 'Cardmarket : une ligne par carte recherchée');
  assert.match(await txt(p, '#toast'), /5 cartes copiées/);
  ok('Je recherche : manquantes du deck + souhaits (ajout par le catalogue, quantité ajustable), copie pour Cardmarket');
}
{
  assert.equal(shareWrites, 0, 'rien n\'est partagé avant « Créer le lien »');
  await p.click('#trSub [data-v="have"]'); const id = await nextId();
  await p.click('[data-act="tron"]'); await p.waitForSelector('.tr-box.on');
  assert.equal(await p.$eval('.tr-link input', i => i.value), world.url + '?p=' + id); await p.screenshot({ path: 'shots/trade-3-lien.png' });
  const s = shares.get(id); assert.equal(s.kind, 'trade'); assert.equal(s.v, 1); assert.deepEqual(Object.keys(s).sort(), ['d', 'kind', 'o', 'updatedAt', 'v'], 'jamais l\'UID dans le document public');
  assert.equal(s.o, (await import('node:crypto')).createHash('sha256').update('u1').digest('hex'), 'propriétaire : empreinte SHA-256 de l\'UID');
  const d = JSON.parse(s.d);
  assert.deepEqual(d.have.map(x => [x.n, x.q, x.l || '']), [['Llanowar Elves', 2, 'en'], ['Sol Ring', 3, 'fr']]);
  const sol = d.have.find(x => x.n === 'Sol Ring'); assert.equal(sol.f, 'Anneau solaire', 'nom français'); assert.match(sol.i, /^small\/front\//, "image en adresse raccourcie"); assert.equal(sol.t, 'Artifact'); assert.equal(sol.c, 1);
  assert.deepEqual(d.want.map(x => [x.n, x.q]), [['Arcane Signet', 1], ['Command Tower', 1], ['Craterhoof Behemoth', 1], ['Edgar Markov', 1], ['Wrath of God', 1]]);
  await p.waitForFunction(() => true); await sleep(1200);
  assert.equal(meta.trade.share, id, 'le lien est gardé dans le compte'); assert.equal(meta.trade.keep, 1); assert.deepEqual(meta.trade.kept, ['wrath of god']); assert.deepEqual(meta.trade.wish, { 'wrath of god': { n: 'Wrath of God', q: 1 } });
  // la collection change : le partage suit tout seul
  const w0 = shareWrites;
  await p.evaluate(() => collBump(ownKey('Sol Ring'), 'Sol Ring', 1, { lang: 'fr' }));
  await p.waitForFunction(() => true); for (let i = 0; i < 40 && shareWrites === w0; i++) await sleep(250);
  assert.equal(shareWrites, w0 + 1, 'partage réécrit après le changement');
  assert.equal(JSON.parse(shares.get(id).d).have.find(x => x.n === 'Sol Ring').q, 4);
  await sleep(4500); assert.equal(shareWrites, w0 + 1, 'pas de réécriture sans changement');
  ok('lien créé (identifiant aléatoire), contenu complet (FR, image, type), réglages dans le compte, mise à jour automatique sans réécriture inutile');
}
const tradeId = [...shares.keys()][0];

/* ── Visiteur : lien public de la liste d'échange ─────────────────────────────────────────────── */
{
  const V = await newPage(browser, world, { goto: false }); errsOf.push(V.errs);
  await routeRest(V.p);
  await V.p.goto(world.url + '?p=' + tradeId); await V.p.waitForSelector('.pubv.on');
  assert.match(await txt(V.p, '.pubv .dv-title'), /Liste d'échange/);
  assert.equal(await txt(V.p, '#pubSub [data-v="have"] small'), '2'); assert.equal(await txt(V.p, '#pubSub [data-v="want"] small'), '5');
  const names = await V.p.$$eval('.pub-row', r => r.map(x => x.querySelector('.row-name').textContent + ' ' + x.querySelector('.tr-q b').textContent.trim()));
  assert.deepEqual(names, ['Llanowar Elves × 2', 'Anneau solaire × 4'], 'exemplaire FR sous son nom français'); await V.p.waitForTimeout(600); await V.p.screenshot({ path: 'shots/trade-4-visiteur.png' });
  await V.p.fill('#pubF input', 'anneau'); await V.p.waitForFunction(() => document.querySelectorAll('.pub-row').length === 1);
  await V.p.fill('#pubF input', 'llanowar'); await V.p.waitForFunction(() => document.querySelectorAll('.pub-row').length === 1 && /Llanowar/.test(document.querySelector('.pub-row').textContent));
  await V.p.fill('#pubF input', ''); await V.p.click('#pubSub [data-v="want"]'); await V.p.waitForFunction(() => document.querySelectorAll('.pub-row').length === 5);
  await V.p.fill('#pubF input', 'béhémoth'); await V.p.waitForFunction(() => document.querySelectorAll('.pub-row').length === 1);
  assert.match(await txt(V.p, '.pub-row'), /Craterhoof Behemoth/, 'recherche par nom français même pour une carte recherchée');
  await V.p.fill('#pubF input', '');
  await V.p.waitForFunction(() => document.querySelector('.pub-row[data-k="edgar markov"] img.ok'), null, { timeout: 8000 });
  await V.p.click('.pub-row[data-k="edgar markov"]'); await V.p.waitForSelector('.imgv'); await V.p.keyboard.press('Escape'); await V.p.waitForTimeout(400);
  assert.ok(!(await V.p.$('.coll-tools')) && !(await V.p.$('.pubv .qstep')) && !(await V.p.$('.pubv [data-act="tkeep"]')), 'aucun bouton de modification');
  assert.equal(await V.p.evaluate(() => Object.keys(COLL.map).length), 0, 'rien n\'est ajouté chez le visiteur');
  await V.ctx.close();
  ok('visiteur : liste en lecture seule, onglets, recherche FR/EN, rien d\'écrit');
}

/* ── Deck partagé : viewer public + main de départ ────────────────────────────────────────────── */
{
  await p.click('.coll .dv-back'); await p.waitForTimeout(400);
  await p.evaluate(() => openDeckViewer({ id: 'deck1' })); await p.waitForSelector('.dv.on [data-act="share"]');
  const id = await nextId(); await p.click('.dv.on [data-act="share"]'); await p.waitForSelector('.sheet .tr-link input');
  assert.equal(await p.$eval('.sheet .tr-link input', i => i.value), world.url + '?p=' + id);
  assert.deepEqual(JSON.parse(shares.get(id).d).name, 'Edgar'); assert.equal(shares.get(id).kind, 'deck');
  await p.click('.sheet [data-close].icon-btn'); await p.waitForTimeout(450);
  // manquantes du deck pour Cardmarket : deck − collection, sans terrains de base
  await p.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = t => { window.__clip.push(t); return Promise.resolve(); }; });
  await p.click('.dv.on [data-act="cm"]'); await p.waitForTimeout(200);
  assert.equal((await p.evaluate(() => window.__clip))[0], '1 Edgar Markov\n1 Craterhoof Behemoth\n1 Command Tower\n1 Arcane Signet', 'Cardmarket : les manquantes du deck (Sol Ring et Swords possédées, Plaines exclues)');
  // main de départ côté propriétaire
  await p.click('.dv.on [data-act="hand"]'); await p.waitForSelector('.hand-grid');
  assert.equal(await p.$$eval('.hand-c', n => n.length), 7); await p.waitForTimeout(700); await p.screenshot({ path: 'shots/trade-5-main.png' });
  assert.match(await txt(p, '.sheet-head'), /15 cartes dans la bibliothèque · 11 terrains/, 'commandant hors bibliothèque ; Command Tower + 10 Plaines');
  assert.equal(await p.$$eval('.odd', n => n.length), 8); assert.equal(await p.$$eval('.odd.on', n => n.length), 1);
  const lands = Number((await txt(p, '.hand-sum b')).match(/\d+/)[0]); assert.equal(await p.$eval('.odd.on span', e => Number(e.textContent)), lands, 'nombre de terrains de la main surligné');
  const h1 = await p.$$eval('.hand-c', n => n.map(x => x.getAttribute('aria-label')).join('|')); let changed = false;
  for (let i = 0; i < 6 && !changed; i++) { await p.click('[data-act="redeal"]'); changed = (await p.$$eval('.hand-c', n => n.map(x => x.getAttribute('aria-label')).join('|'))) !== h1; }
  assert.ok(changed, 'Nouvelle main : un autre tirage'); assert.ok(!(await p.$$eval('.hand-c', n => n.map(x => x.getAttribute('aria-label')))).includes('Edgar Markov'), 'jamais le commandant');
  await p.click('.sheet [data-close].icon-btn'); await p.waitForTimeout(450);
  // le deck change : le lien suit
  const w0 = shareWrites;
  await p.evaluate(deck => { D.list = [readDeck('deck1', { name: 'Edgar v2', text: deck + '\n1 Wrath of God', createdAt: 1, updatedAt: 3 })]; renderDecks(); }, DECK);
  for (let i = 0; i < 40 && shareWrites === w0; i++) await sleep(250);
  assert.equal(JSON.parse(shares.get(id).d).name, 'Edgar v2', 'deck enregistré partagé : suit les modifications');

  const V = await newPage(browser, world, { goto: false }); errsOf.push(V.errs);
  await routeRest(V.p);
  await V.p.goto(world.url + '?p=' + id); await V.p.waitForSelector('.dv.on .dv-sum');
  assert.match(await txt(V.p, '.dv.on .dv-title'), /Edgar v2/); assert.match(await txt(V.p, '.dv.on .dv-title'), /partagé, lecture seule/);
  assert.ok(!(await V.p.$('.dv.on [data-act="share"]')) && await V.p.$eval('.dv.on [data-act="edit"]', b => b.hidden), 'ni partage ni modification pour le visiteur');
  await V.p.waitForFunction(() => document.querySelectorAll('.dv.on .dvc').length >= 6, null, { timeout: 8000 }); await V.p.waitForTimeout(500); await V.p.screenshot({ path: 'shots/trade-6-deck-public.png' });
  await V.p.click('.dv.on [data-act="hand"]'); await V.p.waitForSelector('.hand-grid'); assert.equal(await V.p.$$eval('.hand-c', n => n.length), 7);
  await V.p.click('.sheet [data-close].icon-btn'); await V.p.waitForTimeout(450);
  await V.p.click('.dv.on [data-act="close"]'); await V.p.waitForTimeout(400);
  assert.equal(new URL(V.p.url()).search, '', 'fermer retire ?p= de l\'adresse');
  await V.ctx.close();
  ok('deck partagé : lien, suivi des modifications, viewer public en lecture seule, main de départ (7 cartes, sans commandant, terrains surlignés)');
}

/* ── Liste de souhaits depuis la carte en grand : l'illustration affichée est retenue ───────────── */
{
  await p.evaluate(() => openDeckViewer({ id: 'deck1' })); await p.waitForSelector('.dv.on .dvc[aria-label^="Craterhoof"]');
  await p.click('.dv.on .dvc[aria-label^="Craterhoof"]'); await p.waitForSelector('.imgv.on .imgv-wish:not([hidden])');
  assert.equal(await txt(p, '.imgv-wish'), '☆ Liste de souhaits');
  await p.click('.imgv-wish');
  const w1 = await p.evaluate(() => TR.wish['craterhoof behemoth']);
  assert.equal(w1.n, 'Craterhoof Behemoth'); assert.equal(w1.q, 1); assert.match(w1.i, /^https:\/\/cards\.scryfall\.io\/normal\//, 'image retenue (format moyen)');
  assert.equal(await txt(p, '.imgv-wish'), '★ Dans ta liste de souhaits');
  await p.waitForSelector('.imgv-art:not([hidden])', { timeout: 8000 }); await p.click('.imgv-art'); await p.waitForSelector('.imgv-v[data-i="1"]');
  await p.click('.imgv-v[data-i="1"]'); await p.waitForTimeout(200);
  assert.equal(await txt(p, '.imgv-wish'), '☆ Souhaiter cette illustration', 'autre illustration affichée');
  const label = await p.evaluate(() => document.querySelector('.imgv-sub').textContent);
  await p.click('.imgv-wish');
  const w2 = await p.evaluate(() => TR.wish['craterhoof behemoth']);
  assert.notEqual(w2.i, w1.i, 'illustration remplacée'); assert.ok(w2.w && label.includes(w2.w.split(' · ').pop()), 'extension et numéro retenus : ' + w2.w);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.evaluate(() => closeDeckViewer()); await p.waitForTimeout(300);
  for (let i = 0; i < 40 && !JSON.parse(shares.get(tradeId).d).want.some(x => x.w === w2.w); i++) await sleep(250);
  const sw = JSON.parse(shares.get(tradeId).d).want.find(x => x.n === 'Craterhoof Behemoth');
  assert.equal(sw.w, w2.w, 'partage : illustration recherchée'); assert.equal('https://cards.scryfall.io/' + sw.i, w2.i.replace('/normal/', '/small/'), 'partage : vignette de cette illustration (adresse raccourcie)');
  // très grosse liste (doublons) : le partage s'allège, mais l'illustration souhaitée reste
  const big = await p.evaluate(() => {
    const keep = COLL.map, m = { ...keep };
    for (let i = 0; i < 5000; i++) m['dup card ' + i] = { n: 'Dup Card ' + i + ' With A Rather Long Name For Size', q: 3 };
    COLL.map = m; for (let i = 0; i < 5000; i++) DM['dup card ' + i] = { im: 'https://cards.scryfall.io/small/front/a/b/' + 'x'.repeat(36) + i + '.jpg?1562404626', cm: 3, tl: 'Creature — Long Type Line Here', cl: 'WUBRG', mc: '{2}{W}{U}{B}{R}{G}' };
    const b = trPayload(); COLL.map = keep; for (let i = 0; i < 5000; i++) delete DM['dup card ' + i];
    return { size: JSON.stringify(b).length, haveImgs: b.have.filter(x => x.i).length, have: b.have.length, crater: b.want.find(x => x.n === 'Craterhoof Behemoth') };
  });
  assert.ok(big.size <= 880000, 'sous la limite : ' + big.size); assert.ok(big.have >= 5000, 'toutes les cartes gardées');
  assert.equal(big.crater.w, w2.w); assert.equal('https://cards.scryfall.io/' + big.crater.i, w2.i.replace('/normal/', '/small/'), 'illustration souhaitée conservée même allégé');
  { const V = await newPage(browser, world, { goto: false }); errsOf.push(V.errs); await routeRest(V.p);
    await V.p.goto(world.url + '?p=' + tradeId); await V.p.waitForSelector('.pubv.on'); await V.p.click('#pubSub [data-v="want"]');
    await V.p.waitForSelector('.pub-row[data-k="craterhoof behemoth"] img');
    assert.equal(await V.p.$eval('.pub-row[data-k="craterhoof behemoth"] img', i => i.getAttribute('src')), w2.i.replace('/normal/', '/small/'), 'visiteur : vignette de l\'illustration choisie');
    await V.p.waitForFunction(() => { const m = document.querySelector('.pub-row[data-k="craterhoof behemoth"] .row-meta'); return m && m.innerText.trim(); }, null, { timeout: 5000 });      // la ligne se repeint une fois les infos lues
    assert.match(await txt(V.p, '.pub-row[data-k="craterhoof behemoth"] .row-meta'), new RegExp(w2.w.split(' · ').pop()));
    await V.ctx.close(); }
  await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('#collSeg [data-v="trade"]'); await p.click('#trSub [data-v="want"]');
  await p.waitForSelector('.tr-row[data-k="craterhoof behemoth"]');
  await p.waitForFunction(() => { const m = document.querySelector('.tr-row[data-k="craterhoof behemoth"] .row-meta'); return m && m.innerText.trim(); }, null, { timeout: 5000 });      // la ligne se repeint une fois les infos lues (machine lente : CI)
  assert.match(await txt(p, '.tr-row[data-k="craterhoof behemoth"] .row-meta'), new RegExp(w2.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(await p.$eval('.tr-row[data-k="craterhoof behemoth"] .thumb img', i => i.getAttribute('src')), w2.i.replace('/normal/', '/small/'));
  await p.click('.coll .dv-back'); await p.waitForTimeout(400);
  ok('carte en grand : « Liste de souhaits » retient l\'illustration affichée (changeable), visible dans « Je recherche » et sur le lien');
}

/* ── Lien arrêté, lien invalide ───────────────────────────────────────────────────────────────── */
{
  await p.evaluate(() => closeDeckViewer()); await p.waitForTimeout(300);
  await toHome(p); await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.click('#collSeg [data-v="trade"]'); await p.waitForSelector('.tr-box.on');
  await p.click('[data-act="troff"]'); await p.waitForSelector('[data-act="tron"]');
  assert.ok(!shares.has(tradeId), 'document supprimé');
  const V = await newPage(browser, world, { goto: false }); errsOf.push(V.errs);
  await routeRest(V.p);
  await V.p.goto(world.url + '?p=' + tradeId); await V.p.waitForSelector('.sheet-body');
  assert.match(await txt(V.p, '.sheet-body'), /Ce lien ne marche plus/);
  await V.p.goto(world.url + '?p=../../etc'); await V.p.waitForTimeout(1200);
  assert.match(await txt(V.p, '.sheet-body'), /Lien de partage invalide/);
  await V.ctx.close();
  ok('partage arrêté : lien mort, message clair ; identifiant invalide refusé sans requête');
}

for (const e of errsOf) assert.deepEqual(e, [], 'erreurs page : ' + e.join(' | '));
await browser.close(); world.close && world.close();
console.log('TRADE E2E OK');
process.exit(0);
