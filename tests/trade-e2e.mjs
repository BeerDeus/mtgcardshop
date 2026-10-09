// E2E liste d'échange et partages publics : onglet « Échange » (doublons, réserve, Garder, souhaits), lien public tenu à jour,
// visiteur en lecture seule (recherche FR/EN, filtres), deck partagé (viewer public, main de départ), lien arrêté. Faux Firestore (partages) côté test.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium, startWorld, newPage, ok, txt, toInput, toHome } from './e2e-world.mjs';
const Q = createRequire(import.meta.url)('../src/qr.js');
const SHOTS = process.env.TRADE_SHOTS || 'shots';      // captures 390 px (TRADE_SHOTS : autre dossier)

const world = await startWorld({ port: 18960 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tc = (pg, sel) => pg.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim());      // texte même hors écran (lignes en content-visibility : innerText vide tant qu'elles ne sont pas peintes)
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
await p.route('**/prices.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values', body: '#MOPX1 2026-10-08T09:00:00Z 3\nSol Ring\t120\t100\nLlanowar Elves\t25\t25\nWrath of God\t300\t280\n' }));      // fichier de prix : Sol Ring à 1,20 € (Scryfall en donne 1,50)
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
  assert.equal(await txt(p, '.tr-keep .label'), 'Garder en plus de mes decks : 0–4 exemplaires'); assert.equal(await txt(p, '.tr-keep .hint'), 'Tu proposes seulement ce que tu as en trop.');
  // valeurs : même base que « Pour toi » (fichier de prix : tendance Cardmarket de l'impression la moins chère, sinon Scryfall), total des doublons, tri, « ≥ X € »
  await p.waitForFunction(() => /1,20/.test((document.querySelector('.tr-row[data-k="sol ring"] .tr-px') || {}).textContent || ''), null, { timeout: 8000 });
  assert.match(await tc(p, '.tr-row[data-k="sol ring"] .tr-q'), /^≈ 1,20\s€\s*× 3/, 'prix unitaire du fichier de prix (Scryfall : 1,50 €)'); assert.match(await tc(p, '.tr-row[data-k="llanowar elves"] .tr-q'), /^≈ 0,25\s€\s*× 2/);
  assert.match(await txt(p, '.tr-sum'), /^2 cartes · 5 exemplaires ≈ 4,10\s€ Prix à l'unité : tendance Cardmarket \(.+\)$/, '3 × 1,20 + 2 × 0,25, et sa base');
  await p.selectOption('#trSort', 'price'); await p.waitForFunction(() => document.querySelector('.tr-list .tr-row').dataset.k === 'sol ring');
  assert.deepEqual(await p.$$eval('.tr-list .tr-row', r => r.map(x => x.dataset.k)), ['sol ring', 'llanowar elves'], 'tri par prix');
  await p.selectOption('#trMin', '100'); await p.waitForFunction(() => document.querySelectorAll('.tr-list .tr-row').length === 1);
  assert.match(await txt(p, '.tr-sum'), /^1 carte sur 2 · 3 exemplaires ≈ 3,60\s€/, '≥ 1 € : Sol Ring seule'); assert.ok(await p.$('.tr-min.on'), 'filtre actif bien visible');
  assert.deepEqual(await p.$$eval('#trMin option', o => o.map(x => x.textContent.replace(/\s/g, ' '))), ['Tous les prix', '≥ 1 €', '≥ 2 €', '≥ 5 €', '≥ 10 €', '≥ 20 €', '≥ 50 €']);
  await p.selectOption('#trMin', '0'); await p.selectOption('#trSort', 'name');
  await p.waitForFunction(() => document.querySelectorAll('.tr-list .tr-row').length === 2 && document.querySelector('.tr-list .tr-row').dataset.k === 'llanowar elves');
  await p.waitForTimeout(600); await p.screenshot({ path: 'shots/trade-1-echange.png' });
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
  await p.waitForFunction(() => /17,65/.test(document.querySelector('.tr-sum').textContent), null, { timeout: 8000 });
  assert.match(await txt(p, '.tr-sum'), /^5 cartes · 5 exemplaires ≈ 17,65\s€ Prix à l'unité : tendance Cardmarket \(.+\)$/, 'Je recherche : ce que coûtent les cartes cherchées (Wrath of God au fichier de prix, les autres à Scryfall)');
  assert.ok(!(await p.$('#trMin')), '« ≥ X € » : doublons seulement');
  // plus de 150 lignes : Cardmarket refuse la liste → une Wants list par partie (« Partie 1/2 · Copier », puis « Copier la suite »)
  const wish0 = await p.evaluate(() => { const w = JSON.stringify(TR.wish); for (let i = 0; i < 150; i++) TR.wish['vrombl card ' + i] = { n: 'Vrombl Card ' + i, q: 1 }; trChanged(); window.__clip = []; return w; });
  assert.match(await txt(p, '.tr-sum'), /^155 cartes · 155 exemplaires ≈ 17,65\s€ .+ · 150 cartes sans prix$/, 'cartes sans prix comptées à part, jamais à 0 €');
  await p.click('[data-act="wcm"]'); await p.waitForSelector('.sheet-wrap.open .cm-part');
  assert.match(await txt(p, '.sheet-wrap.open .sheet-head'), /Copier pour Cardmarket 155 cartes · 2 parties/); assert.equal((await p.evaluate(() => window.__clip)).length, 0, 'rien de copié avant le geste');
  assert.deepEqual(await p.$$eval('.cm-part .cm-main', r => r.map(x => x.innerText.replace(/\s+/g, ' ').trim())), ['Partie 1/2 150 cartes · Arcane Signet → Vrombl Card 95', 'Partie 2/2 5 cartes · Vrombl Card 96 → Wrath of God']);
  assert.equal(await txt(p, '[data-act="cmnext"]'), 'Partie 1/2 · Copier');
  await p.click('[data-act="cmnext"]'); await p.waitForFunction(() => window.__clip.length === 1);
  assert.equal(await txt(p, '[data-act="cmnext"]'), 'Copier la suite · 2/2'); assert.match(await txt(p, '.cm-said'), /^Partie 1\/2 copiée : colle-la dans une nouvelle Wants list Cardmarket\.$/);
  assert.equal(await p.$$eval('.cm-part.done', r => r.map(x => x.dataset.i).join()), '0');
  await p.click('[data-act="cmnext"]'); await p.waitForFunction(() => window.__clip.length === 2);
  const parts = await p.evaluate(() => window.__clip), all = await p.evaluate(() => cmText(trState().want));
  assert.deepEqual(parts.map(t => t.split('\n').length), [150, 5], '150 lignes au plus par partie'); assert.equal(parts.join('\n'), all, 'toutes les lignes, une seule fois, dans l\'ordre');
  assert.deepEqual(await p.$eval('[data-act="cmnext"]', b => [b.disabled, b.textContent]), [true, 'Toutes les parties sont copiées']);
  await p.click('.cm-part[data-i="0"] [data-act="cmpart"]'); await p.waitForFunction(() => window.__clip.length === 3); assert.equal((await p.evaluate(() => window.__clip))[2], parts[0], 'une partie se recopie');
  await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/trade-cm-parts.png' });
  await p.click('.sheet [data-close].icon-btn'); await p.waitForTimeout(450);
  await p.evaluate(w => { TR.wish = JSON.parse(w); trChanged(); }, wish0); await p.waitForFunction(() => document.querySelectorAll('.tr-list .tr-row').length === 5);
  ok('Je recherche : manquantes du deck + souhaits (ajout par le catalogue, quantité ajustable), valeur, copie pour Cardmarket (en parties de 150 lignes au-delà)');
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
// profil : pseudo (nettoyé) et photo ajoutés au lien, qui est réécrit ; ni e-mail ni photo Google
{ const w0 = shareWrites, PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await p.evaluate(png => profSave({ name: '  Martin <b>  ', photo: png }), PNG);
  for (let i = 0; i < 40 && shareWrites === w0; i++) await sleep(250);
  const d = JSON.parse(shares.get(tradeId).d); assert.equal(d.by, 'Martin b'); assert.equal(d.bp, PNG); assert.ok(!/@/.test(shares.get(tradeId).d), 'aucun e-mail dans le lien');
  assert.equal(await p.evaluate(() => [PROF.name, $('#btnAccount').dataset.img].join()), 'Martin b,1', 'avatar : la photo choisie remplace l\'initiale');
  ok('profil : pseudo nettoyé et photo dans le lien partagé, avatar du compte'); }

/* ── QR code du lien (échange en vrai) : grand, net, pseudo et photo, adresse, écran gardé allumé ── */
{
  await p.evaluate(() => { window.__wl = 0; window.__wlr = 0; Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async t => { window.__wl++; window.__wlt = t; return { release: async () => { window.__wlr++; }, addEventListener() {} }; } } }); });
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.click('.tr-box.on [data-act="trqr"]'); await p.waitForSelector('.sheet-wrap.open .qr-img svg');
  const url = world.url + '?p=' + tradeId;
  assert.equal(await txt(p, '.qr-url'), url, 'adresse en clair sous le QR code'); assert.equal(await txt(p, '.qr-who b'), 'Liste d\'échange de Martin b'); assert.ok(await p.$('.qr-who img.pub-av'), 'photo du profil');
  assert.equal(await txt(p, '.qr-hint'), 'Fais-le scanner par l\'autre joueur');
  const ref = Q.qrSvg(url), shown = await p.$eval('.qr-img svg', s => [s.getAttribute('viewBox'), s.querySelector('path').getAttribute('d'), s.querySelector('rect').getAttribute('fill'), s.querySelector('path').getAttribute('fill')]);
  assert.deepEqual(shown, [`0 0 ${ref.n} ${ref.n}`, /d="([^"]+)"/.exec(ref.svg)[1], '#fff', '#000'], 'le QR code affiché est celui de l\'encodeur vérifié (tests/test-trade.mjs), noir sur blanc');
  const px = await p.$eval('.qr-img svg', s => [s.getBoundingClientRect().width, devicePixelRatio]), mod = px[0] * px[1] / Q.qrSvg(url).n;
  assert.ok(px[0] >= 240 && Math.abs(mod - Math.round(mod)) < 0.01, 'grand, et un nombre entier de pixels par module : ' + px.join(' × '));
  await p.waitForFunction(() => window.__wl === 1 && !document.querySelector('.qr-lock').hidden); assert.equal(await p.evaluate(() => window.__wlt), 'screen', 'écran gardé allumé');
  await p.waitForTimeout(600); await p.screenshot({ path: SHOTS + '/trade-qr.png' });
  await p.click('.sheet [data-close].icon-btn'); await p.waitForFunction(() => window.__wlr === 1); await p.waitForTimeout(450);
  await p.emulateMedia({ colorScheme: 'light' });
  ok('QR code du lien : SVG de l\'encodeur vérifié, net (modules entiers), pseudo et photo, adresse, Wake Lock pris puis rendu');
  // aperçu du propriétaire : ce que voient les visiteurs, sans « Pour toi », sans connexion ni signalement
  await p.click('.tr-box.on [data-act="trview"]'); await p.waitForSelector('.pubv.on');
  assert.match(await txt(p, '.pubv .dv-title'), /Aperçu de ta liste/); assert.equal(await p.$$eval('#pubSub .seg-opt', b => b.map(x => x.dataset.v).join()), 'have,want', 'pas d\'onglet « Pour toi »');
  assert.ok(!(await p.$('.pubv [data-act="login"]')) && !(await p.$('.pubv .pub-report')), 'ni connexion ni signalement dans l\'aperçu');
  assert.equal(await p.$$eval('.pubv .pub-row .tag.good, .pubv .pub-row .tag.accent', t => t.length), 0, 'aucune étiquette du visiteur (déjà à toi…) sur sa propre liste');
  await p.click('.pubv .dv-back'); await p.waitForTimeout(400);
  ok('aperçu du propriétaire : sans « Pour toi », sans étiquettes ni signalement');
}

/* ── Visiteur : lien public de la liste d'échange ─────────────────────────────────────────────── */
{
  const V = await newPage(browser, world, { goto: false }); errsOf.push(V.errs);
  await routeRest(V.p);
  await V.p.goto(world.url + '?p=' + tradeId); await V.p.waitForSelector('.pubv.on');
  assert.match(await txt(V.p, '.pubv .dv-title'), /Liste d'échange de Martin b/); assert.ok(await V.p.$('.pubv .pub-av'), 'photo du propriétaire');
  assert.equal(await txt(V.p, '#pubSub [data-v="have"] small'), '2'); assert.equal(await txt(V.p, '#pubSub [data-v="want"] small'), '5');
  assert.equal(await V.p.$eval('#pubSub [data-v="match"]', b => b.getAttribute('aria-checked')), 'true', '« Pour toi » : premier onglet, ouvert');
  assert.match(await txt(V.p, '.pub-cta'), /Ajoute ta collection pour voir ce que vous pouvez échanger/, 'visiteur sans collection : invitation');
  assert.equal(await txt(V.p, '.pub-cta [data-act="login"]'), 'Se connecter pour voir vos correspondances');
  const rep = await V.p.$eval('.pub-report a', a => [a.textContent, a.getAttribute('href')]);
  assert.equal(rep[0], 'Signaler ce partage'); assert.ok(rep[1].startsWith('mailto:martin.stuis11@gmail.com?subject=' + encodeURIComponent('Mana Orbit · signalement') + '&body='), rep[1]);
  assert.ok(decodeURIComponent(rep[1].split('&body=')[1]).includes(world.url + '?p=' + tradeId), 'le courriel contient le lien signalé');
  await V.p.click('#pubSub [data-v="have"]'); await V.p.waitForSelector('.pub-row');
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
  ok('visiteur : liste en lecture seule, onglets, recherche FR/EN, rien d\'écrit, « Signaler ce partage »');
}

/* ── Visiteur non connecté : « Se connecter pour voir vos correspondances » → compte (faux cloud) → « Pour toi » sans rouvrir le lien ── */
{
  const VDECK = '1 Command Tower\n1 Sol Ring\n1 Llanowar Elves\n1 Edgar Markov', VCOLL = '3 Arcane Signet *FR*\n1 Command Tower\n2 Edgar Markov';
  const V = await newPage(browser, world, { goto: false, ctx: { colorScheme: 'dark' } }); errsOf.push(V.errs);
  await V.p.route('https://www.gstatic.com/**', r => r.abort()); await routeRest(V.p);
  await V.p.route('**/prices.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values', body: '#MOPX1 2026-10-08T09:00:00Z 4\nSol Ring\t150\t100\nLlanowar Elves\t20\t25\nArcane Signet\t40\t50\nCommand Tower\t30\t20\n' }));
  await V.p.goto(world.url + '?p=' + tradeId); await V.p.waitForSelector('.pubv.on'); await V.p.waitForFunction(() => D.authReady, null, { timeout: 15000 });
  await V.p.evaluate(([deck, coll]) => {
    window.__signin = 0;
    D.cloud = {
      onUser() {}, signIn: async email => { window.__signin++; setTimeout(() => onUser({ uid: 'v1', email, displayName: 'Léa', reload: async () => {} }), 30); return {}; }, signUp: async () => {}, google: async () => {},
      watch: (uid, cb) => { cb([{ id: 'vd', data: { name: 'Mon deck', text: deck, createdAt: 1, updatedAt: 2 } }], false); return () => {}; }, newId: () => 'x', save: async () => {}, remove: async () => {},
      watchColl(uid, cb) { setTimeout(() => cb({ text: coll, count: 3, updatedAt: 5 }, false, false), 900); return () => {}; }, txColl: async () => null, pullColl: async () => ({ data: { text: coll, updatedAt: 5 } }), saveColl: async () => {},      // la collection du compte arrive après un délai (réseau)
      watchMeta(uid, id, cb) { cb(null, false, false); return () => {}; }, saveMeta: async () => {}, pullMeta: async () => ({ data: null }), shareId: () => 'x', saveShare: async () => {}, dropShare: async () => {},
    };
    D.state = 'ready'; D.err = ''; document.querySelector('.pubv').__same = 1;
  }, [VDECK, VCOLL]);
  assert.equal(await txt(V.p, '#pubSub [data-v="match"] small'), '–', 'rien à comparer : pas de chiffre');
  await V.p.waitForTimeout(500); await V.p.screenshot({ path: SHOTS + '/trade-pourtoi-connexion.png' });
  await V.p.click('.pub-cta [data-act="login"]'); await V.p.waitForSelector('.sheet-wrap.open #acEmail'); await V.p.waitForTimeout(650);      // feuille arrivée en place
  assert.ok(await V.p.$eval('.sheet-wrap.open .sheet', s => { const r = s.getBoundingClientRect(), el = document.elementFromPoint(r.left + r.width / 2, r.top + 40); return s.contains(el); }), 'la feuille du compte passe par-dessus la liste');
  await V.p.fill('#acEmail', 'lea@example.com'); await V.p.fill('#acPw', 'secret1'); await V.p.click('#acGo');
  await V.p.waitForFunction(() => !document.querySelector('.sheet-wrap.open'), null, { timeout: 5000 });
  await V.p.waitForSelector('.pubv .status'); assert.match(await txt(V.p, '.pubv .status'), /Lecture de ta collection/, 'compte connecté, collection pas encore arrivée');
  await V.p.waitForFunction(() => document.querySelectorAll('.pm-block[data-side="get"] .pm-row').length === 2 && document.querySelectorAll('.pm-block[data-side="give"] .pm-row').length === 1, null, { timeout: 8000 });
  assert.equal(await V.p.evaluate(() => [window.__signin, document.querySelectorAll('.pubv').length, document.querySelector('.pubv.on').__same, TR.pub.el === document.querySelector('.pubv')].join()), '1,1,1,true', 'même écran, toujours ouvert : rien à rouvrir');
  assert.ok(!(await V.p.$('.pubv [data-act="login"]')), 'connecté : plus de bouton');
  assert.deepEqual(await V.p.$$eval('.pm-block[data-side="get"] .pm-row', r => r.map(x => x.dataset.k)), ['sol ring', 'llanowar elves'], 'il a ce que je cherche (manque à mon deck), la plus chère d\'abord');
  assert.deepEqual(await V.p.$$eval('.pm-block[data-side="give"] .pm-row', r => r.map(x => x.dataset.k)), ['arcane signet'], 'je peux lui donner : seulement mes doublons (Edgar et Command Tower servent à mon deck)');
  await V.p.waitForFunction(() => /≈/.test(document.querySelector('.pm-block[data-side="get"] .pm-head').textContent), null, { timeout: 5000 });
  assert.match(await txt(V.p, '.pm-block[data-side="get"] .pm-head'), /^Martin b a ce que tu cherches 2 cartes · ≈ 1,70\s€$/);
  assert.match(await txt(V.p, '.pm-block[data-side="give"] .pm-head'), /^Tu as ce que Martin b cherche 1 carte · ≈ 0,40\s€$/);
  assert.match(await tc(V.p, '.pm-row[data-k="sol ring"] .row-meta'), /tu la cherches × 1/); assert.match(await tc(V.p, '.pm-row[data-k="arcane signet"] .row-meta'), /tu peux l'échanger × 2/);
  assert.match(await tc(V.p, '.pm-row[data-k="sol ring"] .tr-q'), /× 1\s*≈ 1,50\s€/); assert.match(await txt(V.p, '.pm-note'), /tendance Cardmarket/);
  assert.equal(await txt(V.p, '#pubSub [data-v="match"] small'), '3');
  await V.p.waitForTimeout(700); await V.p.screenshot({ path: SHOTS + '/trade-pourtoi.png' });
  // F5 : dans ce qu'il cherche, « échangeable » = mes doublons ; une carte de mes decks est seulement « tu l'as »
  await V.p.click('#pubSub [data-v="want"]'); await V.p.waitForSelector('.pub-row[data-k="edgar markov"]');
  assert.match(await tc(V.p, '.pub-row[data-k="arcane signet"] .row-meta'), /tu peux l'échanger × 2/);
  assert.match(await tc(V.p, '.pub-row[data-k="edgar markov"] .row-meta'), /tu l'as · dans tes decks/); assert.doesNotMatch(await tc(V.p, '.pub-row[data-k="edgar markov"] .row-meta'), /× 2/, 'plus le brut possédé');
  assert.match(await tc(V.p, '.pub-row[data-k="command tower"] .row-meta'), /tu l'as · dans tes decks/);
  await V.p.click('#pubSub [data-v="have"]'); await V.p.waitForSelector('.pub-row[data-k="sol ring"]');
  assert.match(await tc(V.p, '.pub-row[data-k="sol ring"] .row-meta'), /tu la cherches × 1/);
  assert.match(await tc(V.p, '.pub-row[data-k="sol ring"] .tr-q'), /^≈ 1,50\s€\s*× 4$/, 'liste complète : prix à l\'unité du visiteur (son fichier de prix), jamais écrit dans le partage'); assert.match(await txt(V.p, '.pubv .pm-note'), /tendance Cardmarket/);
  // un souhait ajouté ailleurs dans l'appli : « Pour toi » suit, sans rouvrir le lien
  await V.p.click('#pubSub [data-v="match"]'); await V.p.evaluate(() => { TR.wish['llanowar elves'] = { n: 'Llanowar Elves', q: 2 }; trChanged(); });
  await V.p.waitForFunction(() => /× 2/.test(document.querySelector('.pm-row[data-k="llanowar elves"] .tr-q').textContent), null, { timeout: 4000 });
  assert.match(await tc(V.p, '.pm-row[data-k="llanowar elves"] .row-meta'), /tu la cherches × 3/, '1 pour le deck + 2 souhaitées ; il en a 2');
  await V.ctx.close();
  ok('visiteur non connecté : bouton → compte par-dessus la liste → synchro → « Pour toi » (2 + 1 cartes, valeurs), étiquettes sur ses doublons (F5), suivi des souhaits');
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
  assert.match(await txt(V.p, '.dv.on .dv-title'), /Edgar v2/); assert.match(await txt(V.p, '.dv.on .dv-title'), /partagé par Martin b/); assert.match(await V.p.$eval('.dv.on .pub-report a', e => e.getAttribute('href')), /^mailto:.*signalement/, 'deck partagé : lien « Signaler ce partage »');
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
  // F1 : avec une grosse photo de profil (40 000 caractères au plus), le document écrit reste sous la règle des 900 000
  const f1 = await p.evaluate(() => {
    const keep = COLL.map, m = { ...keep }, photo = PROF.photo, bp = 'data:image/jpeg;base64,' + 'A'.repeat(39000); PROF.photo = bp;
    for (let i = 0; i < 12000; i++) m['dup card ' + i] = { n: 'Dup Card ' + i + ' With A Rather Long Name For Size Purposes', q: 3 };
    COLL.map = m; const b = trPayload(); COLL.map = keep; PROF.photo = photo;
    return { body: JSON.stringify(b).length, doc: JSON.stringify({ ...b, by: PROF.name, bp, at: Date.now() }).length, cut: !!b.cut };
  });
  assert.ok(f1.cut && f1.body <= 880000 - 39000 && f1.doc <= 900000, 'liste tronquée en comptant la photo : ' + JSON.stringify(f1));
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
  // F1 : partage trop gros même allégé → « liste trop longue » (et non « règles Firestore à publier »), rien d'écrit ; revenu sous la limite, le message part
  { const w0 = shareWrites, idle = 'for (let i = 0; i < 80 && TR.busy; i++) await sleep(100);';
    await p.evaluate(`(async () => { ${idle} window.__tp = trPayload; trPayload = () => ({ have: [], want: [{ n: 'Huge', q: 1, w: 'x'.repeat(950000) }] }); await trSync(); })()`);
    await p.waitForSelector('.tr-box.on .hint.warn'); assert.equal(shareWrites, w0, 'rien d\'écrit');
    assert.match(await txt(p, '.tr-box.on .hint.warn'), /^Liste trop longue : le lien ne peut plus être mis à jour/);
    await p.evaluate(`(async () => { trPayload = window.__tp; ${idle} await trSync(); })()`);
    await p.waitForFunction(() => !document.querySelector('.tr-box.on .hint.warn'));
    ok('F1 : photo comptée dans la taille du lien ; trop gros quand même → « liste trop longue », sans écriture'); }
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
