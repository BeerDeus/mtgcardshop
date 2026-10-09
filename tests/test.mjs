import './setup-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../src/core.js');

const DECK = `1 Cloud, Midgar Mercenary
1 Sol Ring
2 Swords to Plowshares *F*
1 Kíli the Resourceful
1 Sol Ring
// commentaire
Commander (1)
1 Teleportation Circle (CMM) 123
25 Plains
SB: 1 Path to Exile`;

test('parseDeck : fusion, basics, entêtes, suffixes', () => {
  const d = C.parseDeck(DECK);
  const by = Object.fromEntries(d.cards.map(c => [c.key, c.qty]));
  assert.equal(by['sol ring'], 2);
  assert.equal(by['swords to plowshares'], 2);
  assert.equal(by['teleportation circle'], 1);
  assert.equal(by['kili the resourceful'], 1);
  assert.ok(by['cloud midgar mercenary']);
  assert.equal(d.basicCopies, 25);
  assert.equal(d.basics[0].qty, 25);
  assert.ok(!('path to exile' in by), 'SB: ignoré');
  assert.equal(d.ignored, 0, 'commentaire, en-tête et banc : ignorés sans alerte'); assert.equal(C.parseDeck('1 Sol Ring\n0 Truc\n1000 Machin').ignored, 2, 'quantités invalides : signalées');
});

test('parseDeck : texte vide / sans quantité', () => {
  assert.equal(C.parseDeck('').cards.length, 0);
  assert.equal(C.parseDeck('Sol Ring').cards[0].qty, 1);
  assert.equal(C.parseDeck('3x Sol Ring').cards[0].qty, 3);
});

test('normName / frontName : double face', () => {
  assert.equal(C.frontName('Delver of Secrets // Insectile Aberration'), 'delver of secrets');
  assert.equal(C.normPart("Ranger's Hawk"), 'rangers hawk');
});

const P = {
  id: 264895, blueprint_id: 3, name_en: 'Sol Ring', quantity: 3, graded: false, on_vacation: false, bundle_size: 1,
  price: { cents: 250, currency: 'EUR' },
  properties_hash: { condition: 'Near Mint', mtg_language: 'fr', mtg_foil: false, signed: false, altered: false },
  expansion: { code: 'cmm', name_en: 'Commander Masters' },
  user: { id: 12, username: 'cartes_du_midi', country_code: 'FR', can_sell_via_hub: true, user_type: 'pro' },
};

test('normalizeProduct : champs CardTrader', () => {
  const o = C.normalizeProduct(P, { num: '400', img: null });
  assert.equal(o.price, 250);
  assert.equal(o.seller, 'cartes_du_midi');
  assert.equal(o.hub, true);
  assert.equal(o.lang, 'fr');
  assert.equal(o.set, 'cmm');
  assert.equal(o.num, '400');
  assert.equal(o.cond, 'Near Mint');
  assert.ok(C.passes(o, { cond: 'Near Mint', foil: 'any' }));
  assert.ok(!C.passes(o, { cond: 'Mint', foil: 'any' }));
  assert.ok(!C.passes(o, { cond: 'Near Mint', foil: 'yes' }));
  assert.ok(!C.passes({ ...o, vac: true }, { cond: 'Played', foil: 'any' }));
  assert.ok(!C.passes({ ...o, bundle: 4 }, { cond: 'Played', foil: 'any' }));
});

const mk = (id, sellerId, price, qty = 1, hub = true) => ({ id, sellerId, seller: 's' + sellerId, country: 'FR', hub, price, qty, cond: 'Near Mint' });

test('optimize zero : moins cher hub, ignore non-hub, gère la capacité', () => {
  const offers = {
    a: [mk(1, 1, 100, 1), mk(2, 2, 120, 5), mk(3, 3, 50, 5, false)],
    b: [mk(4, 1, 300, 1)],
  };
  const r = C.optimize([{ key: 'a', qty: 2 }, { key: 'b', qty: 1 }], offers, { mode: 'zero' });
  assert.equal(r.picks.a.cost, 100 + 120);
  assert.equal(r.items, 100 + 120 + 300);
  assert.equal(r.ship, 0);
  assert.equal(r.total, r.items);
  assert.equal(r.missing.length, 0);
});

test('optimize : carte sans offre → missing ; stock insuffisant → partial', () => {
  const r = C.optimize([{ key: 'a', qty: 3 }, { key: 'z', qty: 1 }], { a: [mk(1, 1, 100, 2)] }, { mode: 'zero' });
  assert.deepEqual(r.missing, ['z']);
  assert.deepEqual(r.partial, ['a']);
});

test('optimize direct : regroupe chez un vendeur quand le port le justifie', () => {
  const offers = {
    a: [mk(1, 1, 100), mk(2, 2, 110)],
    b: [mk(3, 2, 100), mk(4, 1, 105)],
    c: [mk(5, 2, 100), mk(6, 3, 90)],
  };
  const dem = ['a', 'b', 'c'].map(key => ({ key, qty: 1 }));
  const r = C.optimize(dem, offers, { mode: 'direct', ship: 280 });
  const ref = C.optimize(dem, offers, { mode: 'direct', ship: 0 });
  assert.ok(r.total <= r.baseline.total, 'jamais pire que le départ glouton');
  assert.ok(r.sellerCount <= r.baseline.sellers);
  assert.equal(r.sellerCount, 1, 'tout chez le vendeur 2 ou 1 : un seul port');
  assert.ok(ref.items <= r.items);
  assert.equal(r.ship, 280 * r.sellerCount);
});

test('optimize direct : jamais pire que baseline sur jeux aléatoires', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rnd = C.mulberry32(seed);
    const offers = {}, dem = [];
    for (let i = 0; i < 30; i++) {
      const key = 'c' + i; dem.push({ key, qty: 1 + Math.floor(rnd() * 2) });
      offers[key] = Array.from({ length: 6 }, (_, j) => mk(i * 10 + j, 1 + Math.floor(rnd() * 8), 20 + Math.floor(rnd() * 400), 1 + Math.floor(rnd() * 3)));
    }
    const r = C.optimize(dem, offers, { mode: 'direct', ship: 280 });
    assert.ok(r.total <= r.baseline.total, 'seed ' + seed);
    assert.equal(r.missing.length + r.partial.length, 0, 'stock suffisant : aucune carte manquante');
    for (const g of r.sellers) for (const it of g.items) assert.ok(it.n <= it.offer.qty);
  }
});

test('optimize : offre forcée respectée', () => {
  const offers = { a: [mk(1, 1, 100), mk(2, 2, 500)] };
  const r = C.optimize([{ key: 'a', qty: 1 }], offers, { mode: 'direct', ship: 280, forced: { a: 2 } });
  assert.equal(r.picks.a.parts[0].offer.id, 2);
});

test('makeDemoOffers : déterministe, ~8 % sans offre FR, EN toujours dispo', () => {
  const a = C.makeDemoOffers({ key: 'sol ring' }, 'fr'), b = C.makeDemoOffers({ key: 'sol ring' }, 'fr');
  assert.deepEqual(a, b);
  let none = 0;
  for (let i = 0; i < 400; i++) { const k = 'carte ' + i; if (!C.makeDemoOffers({ key: k }, 'fr').length) none++; assert.ok(C.makeDemoOffers({ key: k }, 'en').length >= 0); }
  assert.ok(none > 10 && none < 70, 'sans offre FR: ' + none);
});

/* ── Decks enregistrés ─────────────────────────────────────────────────────────────────── */
const E = (at, total, extra = {}) => ({ at, total, mode: 'zero', found: 75, count: 75, sig: 'fr|Slightly Played|no', ...extra });
const MIN = 60000, H = 3600000;

test('pushHistory : dédoublonne un relevé identique, empile sinon, plafonne à 40', () => {
  let h = C.pushHistory([], E(1000, 100));
  h = C.pushHistory(h, E(1000 + 10 * MIN, 100)); assert.equal(h.length, 1, 'même total, <30 min : date rafraîchie'); assert.equal(h[0].at, 1000 + 10 * MIN);
  h = C.pushHistory(h, E(1000 + 12 * MIN, 90)); assert.equal(h.length, 2, 'total différent : on empile même rapproché');
  h = C.pushHistory(h, E(1000 + 2 * H, 80)); assert.equal(h.length, 3);
  h = C.pushHistory(h, E(1000 + 3 * H, 70, { mode: 'direct' })); assert.equal(h.length, 4, 'autre mode : jamais fusionné');
  h = C.pushHistory(h, E(1000 + 3 * H + MIN, 70, { sig: 'en|Played|no' })); assert.equal(h.length, 5, 'autres critères : jamais fusionné');
  let big = []; for (let i = 0; i < 60; i++) big = C.pushHistory(big, E(i * 24 * H, 100 + i));
  assert.equal(C.HISTORY_MAX, 40); assert.equal(big.length, C.HISTORY_MAX); assert.equal(big.at(-1).total, 159); assert.equal(big[0].total, 120);
  assert.deepEqual(C.pushHistory(null, E(5, 1)).length, 1);
});

test('priceDelta / priceSeries : compare ce qui est comparable', () => {
  assert.equal(C.priceDelta([]), null);
  assert.equal(C.priceDelta([E(1, 100)]).prev, null);
  const h = [E(1, 100), E(2, 500, { mode: 'direct' }), E(3, 90, { sig: 'en|Played|no' }), E(4, 80)];
  const d = C.priceDelta(h);
  assert.equal(d.prev, 100); assert.equal(d.diff, -20); assert.equal(d.prevAt, 1);
  assert.deepEqual(C.priceSeries(h), [100, 80]);
  assert.equal(C.priceDelta([E(1, 100, { found: 70 }), E(2, 100)]).prev, null, 'couverture différente : pas de delta');
});

test('deckDoc : nom, texte tronqué, options assainies, historique nettoyé', () => {
  const d = C.deckDoc({ name: '   ', text: '1 Sol Ring\n2 Swords to Plowshares\n25 Plains', opts: { lang: 'xx', cond: 'Bof', foil: 'yes', mode: 'direct', ship: 99999, fallbackEn: false },
    history: [E(1, 100.4), { at: 'x', total: 1 }, null, { at: 5, total: 7, mode: 'zzz', found: -3 }] }, 1234);
  assert.equal(d.name, 'Sol Ring'); assert.equal(d.cards, 2); assert.equal(d.updatedAt, 1234); assert.equal(d.createdAt, 1234);
  assert.deepEqual(d.opts, { lang: 'fr', cond: 'Slightly Played', foil: 'yes', mode: 'direct', ship: 5000, fallbackEn: false });
  assert.equal(d.history.length, 2); assert.equal(d.history[0].total, 100); assert.equal(d.history[1].mode, 'zero'); assert.equal(d.history[1].found, 0);
  const long = C.deckDoc({ name: 'x'.repeat(500), text: 'y'.repeat(100000) });
  assert.equal(long.name.length, 120); assert.equal(long.text.length, 60000);
  assert.equal(C.deckDoc({ text: '' }).name, 'Nouveau deck');
  assert.equal(C.deckDoc({ name: 'A', text: '1 Sol Ring', createdAt: 42 }, 99).createdAt, 42);
});

test('readDeck : document cloud incomplet ou hostile', () => {
  const d = C.readDeck('abc', { name: 42, text: null, opts: 'oops', history: 'nope', updatedAt: 'x' });
  assert.equal(d.id, 'abc'); assert.equal(typeof d.name, 'string'); assert.equal(d.text, ''); assert.deepEqual(d.history, []); assert.equal(d.updatedAt, 0);
  assert.equal(C.readDeck('z', { name: 'Ok', text: '1 Sol Ring', updatedAt: 7, createdAt: 3 }).createdAt, 3);
});

test('relTime : paliers', () => {
  const now = 1_700_000_000_000;
  assert.equal(C.relTime(now - 10_000, now), 'à l\'instant');
  assert.match(C.relTime(now - 5 * MIN, now), /5 minutes/);
  assert.match(C.relTime(now - 3 * H, now), /3 heures/);
  assert.equal(C.relTime(now - 26 * H, now), 'hier');
  assert.match(C.relTime(now - 4 * 86400000, now), /4 jours/);
  assert.match(C.relTime(now - 40 * 86400000, now), /\d+ \p{L}+\.?/u);
  assert.equal(C.relTime(NaN, now), '');
});

test('sanitizeOpts / newDeckId', () => {
  assert.deepEqual(C.sanitizeOpts(null), { lang: 'fr', cond: 'Slightly Played', foil: 'no', mode: 'zero', ship: 280, fallbackEn: true });
  const ids = new Set(Array.from({ length: 200 }, () => C.newDeckId())); assert.equal(ids.size, 200);
  assert.ok([...ids].every(i => /^[a-z0-9]{20}$/.test(i)));
});

test('authMessage : codes Firebase en français, silence sur fermeture de popup', () => {
  const { authMessage } = require('../src/cloud.js');
  assert.match(authMessage({ code: 'auth/invalid-credential' }), /incorrect/);
  assert.match(authMessage({ code: 'auth/email-already-in-use' }), /existe déjà/);
  assert.match(authMessage({ code: 'auth/weak-password' }), /6 caractères/);
  assert.match(authMessage({ code: 'auth/unauthorized-domain' }), /Domaines autorisés/);
  assert.equal(authMessage({ code: 'auth/popup-closed-by-user' }), null);
  assert.match(authMessage({ code: 'auth/boom' }), /boom/);
  assert.match(authMessage(null), /impossible/);
});

const off = (id, lang, price, hub, extra = {}) => ({ id, lang, price, hub, qty: 4, cond: 'Near Mint', foil: false, sellerId: extra.s || id, seller: 's' + id, ...extra });

test('preferLang : la langue demandée masque les offres moins chères d\'une autre langue', () => {
  const l = [off(1, 'en', 10, true), off(2, 'fr', 50, true), off(3, 'fr', 60, false)];
  assert.deepEqual(C.preferLang(l, 'fr').map(o => o.id), [2, 3]);
  assert.deepEqual(C.preferLang([off(1, 'en', 10, true)], 'fr').map(o => o.id), [1], 'repli : rien en FR → tout');
});

test('forMode : Zero = hub seulement ; choix manuel garde toutes les langues', () => {
  const l = [off(1, 'en', 10, true), off(2, 'fr', 50, false), off(3, 'fr', 60, true)];
  assert.deepEqual(C.forMode(l, 'zero', 'fr').map(o => o.id), [3]);
  assert.deepEqual(C.forMode(l, 'direct', 'fr').map(o => o.id), [2, 3]);
  assert.deepEqual(C.forMode(l, 'direct', 'fr', true).map(o => o.id), [1, 2, 3]);
  assert.deepEqual(C.forMode(l, 'zero', 'fr', true).map(o => o.id), [1, 3]);
});

test('needsEnglish : FR présent mais aucun hub en mode Zero → repli utile (cas Starnheim Aspirant)', () => {
  const fr = { lang: 'fr', cond: 'Slightly Played', foil: 'no' };
  const frNoHub = [off(1, 'fr', 50, false)];
  assert.equal(C.needsEnglish(frNoHub, { ...fr, mode: 'zero' }), true, 'Zero : offres FR non compatibles → anglais');
  assert.equal(C.needsEnglish(frNoHub, { ...fr, mode: 'direct' }), false, 'Direct : l\'offre FR suffit');
  assert.equal(C.needsEnglish([off(1, 'fr', 50, true)], { ...fr, mode: 'zero' }), false);
  assert.equal(C.needsEnglish([], { ...fr, mode: 'direct' }), true, 'aucune offre');
  assert.equal(C.needsEnglish([off(1, 'fr', 50, true, { cond: 'Played' })], { ...fr, mode: 'zero' }), true, 'état insuffisant');
  assert.equal(C.needsEnglish([off(1, 'en', 5, true)], { ...fr, mode: 'zero' }), true, 'EN seul ne compte pas comme FR');
});

test('Zero puis Direct : l\'offre FR non-hub est choisie en Direct malgré une offre EN moins chère', () => {
  const list = [off(1, 'fr', 100, false, { s: 7 }), off(2, 'en', 30, true, { s: 8 })];
  const demand = [{ key: 'a', qty: 1 }];
  const z = C.optimize(demand, { a: C.forMode(list, 'zero', 'fr') }, { mode: 'zero' });
  const d = C.optimize(demand, { a: C.forMode(list, 'direct', 'fr') }, { mode: 'direct', ship: 0 });
  assert.equal(z.picks.a.parts[0].offer.id, 2, 'Zero : seule l\'EN est compatible');
  assert.equal(d.picks.a.parts[0].offer.id, 1, 'Direct : la FR reste prioritaire');
});

test('recapOf : cartes par langue, manquantes, partielles', () => {
  const r = C.recapOf([
    { state: 'ok', qty: 2, short: 0, parts: [{ lang: 'fr', n: 2 }] },
    { state: 'ok', qty: 1, short: 0, parts: [{ lang: 'en', n: 1 }] },
    { state: 'ok', qty: 3, short: 1, parts: [{ lang: 'fr', n: 1 }, { lang: 'en', n: 1 }] },
    { state: 'none', qty: 1 }, { state: 'nohub', qty: 1 }, { state: 'notfound', qty: 1 }, { state: 'loading', qty: 1 },
  ]);
  assert.equal(r.total, 7); assert.equal(r.found, 3); assert.equal(r.copies, 5); assert.equal(r.partial, 1);
  assert.deepEqual(r.byLang.fr, { cards: 2, copies: 3 }); assert.deepEqual(r.byLang.en, { cards: 1, copies: 2 });
  assert.deepEqual([r.none, r.nohub, r.notfound, r.loading], [1, 1, 1, 1]);
});

test('replaceParts : offre la moins chère, hors liste écartée, quantité répartie', () => {
  const list = [off(1, 'fr', 100, true, { s: 1, qty: 1 }), off(2, 'fr', 120, true, { s: 2, qty: 1 }), off(3, 'fr', 150, true, { s: 3, qty: 4 })];
  const one = C.replaceParts(list.filter(o => o.id !== 1), 1, { mode: 'zero' });
  assert.deepEqual(one.map(p => [p.offer.id, p.n]), [[2, 1]], 'prend la suivante la moins chère');
  const three = C.replaceParts(list.filter(o => o.id !== 1), 3, { mode: 'zero' });
  assert.deepEqual(three.map(p => [p.offer.id, p.n]), [[2, 1], [3, 2]], '3 exemplaires : 1 chez le 2e, 2 chez le 3e');
  const short = C.replaceParts(list.filter(o => o.id === 2), 3, { mode: 'zero' });
  assert.equal(short.reduce((a, p) => a + p.n, 0), 1, 'stock insuffisant : renvoie ce qui existe (l\'appelant voit le manque)');
  assert.deepEqual(C.replaceParts([], 2, { mode: 'zero' }), []);
});

test('replaceParts : Zero = hub seulement ; Direct préfère un vendeur déjà dans le panier', () => {
  const hubless = [off(1, 'fr', 50, false, { s: 1, qty: 2 }), off(2, 'fr', 80, true, { s: 2, qty: 2 })];
  assert.equal(C.replaceParts(hubless, 1, { mode: 'zero' })[0].offer.id, 2, 'Zero ignore les vendeurs sans hub');
  const direct = [off(1, 'fr', 100, false, { s: 1, qty: 2 }), off(2, 'fr', 120, false, { s: 2, qty: 2 })];
  assert.equal(C.replaceParts(direct, 1, { mode: 'direct', ship: 0 })[0].offer.id, 1, 'sans port : le moins cher');
  assert.equal(C.replaceParts(direct, 1, { mode: 'direct', ship: 280 })[0].offer.id, 1, 'port identique : le moins cher');
  assert.equal(C.replaceParts(direct, 1, { mode: 'direct', ship: 280, prefer: new Set([2]) })[0].offer.id, 2, 'vendeur déjà au panier : port déjà payé, 1,20 € < 1,00 € + 2,80 €');
});

test('parseLine : vide, ignorée, carte (suffixes retirés)', () => {
  assert.equal(C.parseLine('   '), undefined);
  assert.deepEqual(C.parseLine('Commander'), { ignored: true, quiet: true });
  assert.deepEqual(C.parseLine('// note'), { ignored: true, quiet: true });
  assert.deepEqual(C.parseLine('2x Sol Ring (CMM) 400 *F*'), { qty: 2, name: 'Sol Ring', key: 'sol ring' });
  assert.deepEqual(C.parseLine('Æther Vial'), { qty: 1, name: 'Æther Vial', key: 'aether vial' }, 'Æ → ae, comme « Aether Vial »');
});

test('dropCard / restoreLines : retire toutes les lignes d\'une carte, annulation exacte (LIFO)', () => {
  const text = 'Commander\n1 Sol Ring\n2 Swords to Plowshares\n\n1x sol ring (CMM)\n1 Path to Exile\n';
  const a = C.dropCard(text, 'sol ring');
  assert.equal(a.text, 'Commander\n2 Swords to Plowshares\n\n1 Path to Exile\n');
  assert.deepEqual(a.removed.map(r => r.i), [1, 4], 'les deux lignes (doublon) sont retirées');
  assert.equal(C.parseDeck(a.text).cards.some(c => c.key === 'sol ring'), false);
  const b = C.dropCard(a.text, 'path to exile');
  assert.equal(C.restoreLines(C.restoreLines(b.text, b.removed), a.removed), text, 'annuler dans l\'ordre inverse redonne le texte d\'origine');
  assert.equal(C.dropCard(text, 'inconnue').text, text, 'carte absente : texte inchangé');
  assert.equal(C.dropCard('1 Sol Ring\r\n1 Arcane Signet\r\n', 'sol ring').text, '1 Arcane Signet\r\n', 'fins de ligne Windows conservées');
  assert.equal(C.restoreLines('1 A', [{ i: 9, raw: '1 B' }]), '1 A\n1 B', 'liste raccourcie : remise à la fin');
});

test('sortCards : prix décroissant / croissant, sans prix en fin, A→Z, ordre du deck', () => {
  const it = [{ name: 'Élan', i: 0, cost: 150 }, { name: 'Zap', i: 1, cost: null }, { name: 'bolt', i: 2, cost: 400 }, { name: 'Arc', i: 3, cost: 150 }, { name: 'Nul', i: 4, cost: null }];
  const names = m => C.sortCards(it, m).map(x => x.name).join(',');
  assert.equal(names('price-desc'), 'bolt,Élan,Arc,Zap,Nul', 'égalité : ordre du deck ; sans prix à la fin');
  assert.equal(names('price-asc'), 'Élan,Arc,bolt,Zap,Nul', 'sans prix toujours à la fin, même en croissant');
  assert.equal(names('name'), 'Arc,bolt,Élan,Nul,Zap', 'tri alphabétique insensible aux accents et à la casse');
  assert.equal(names('deck'), 'Élan,Zap,bolt,Arc,Nul');
  assert.deepEqual(it.map(x => x.i), [0, 1, 2, 3, 4], 'entrée non modifiée');
});

test('ctCardUrl', () => { assert.equal(C.ctCardUrl(123), 'https://www.cardtrader.com/cards/123'); });

/* ── Prix gardés par deck + regroupements du viewer ── */
const SN = [
  { k: 'sol ring', n: 'Sol Ring', q: 1, s: 'ok', c: 150, cm: 1, tl: 'Artifact', im: 'https://cards.scryfall.io/small/front/a/b/x.jpg' },
  { k: 'arcane signet', n: 'Arcane Signet', q: 1, s: 'ok', c: 50, cm: 2, tl: 'Artifact' },
  { k: 'llanowar elves', n: 'Llanowar Elves', q: 2, s: 'ok', c: 40, cm: 1, tl: 'Creature — Elf Druid' },
  { k: 'command tower', n: 'Command Tower', q: 1, s: 'ok', c: 30, cm: 0, tl: 'Land' },
  { k: 'forest', n: 'Forest', q: 5, s: 'basic' },
  { k: 'wrath of god', n: 'Wrath of God', q: 1, s: 'none', cm: 4, tl: 'Sorcery' },
  { k: 'phantom', n: 'Phantom Card', q: 1, s: 'nf' },
  { k: 'craterhoof', n: 'Craterhoof Behemoth', q: 1, s: 'ok', c: 900, cm: 8, tl: 'Creature — Beast' },
  { k: 'dryad arbor', n: 'Dryad Arbor', q: 1, s: 'ok', c: 25, cm: 0, tl: 'Land Creature — Forest Dryad' },
  { k: 'mox amber', n: 'Mox Amber', q: 1, s: 'ok', c: 700, cm: 0, tl: 'Legendary Artifact' },
];
const names = g => g.items.map(i => i.n);

test('typeBucket : Artifact Creature → Créatures, Artifact Land → Terrains, Land Creature → Créatures', () => {
  assert.equal(C.typeBucket('Artifact Creature — Golem'), 'Créatures');
  assert.equal(C.typeBucket('Artifact Land'), 'Terrains');
  assert.equal(C.typeBucket('Land Creature — Forest Dryad'), 'Créatures');
  assert.equal(C.typeBucket('Legendary Enchantment — Saga'), 'Enchantements');
  assert.equal(C.typeBucket('Instant'), 'Éphémères'); assert.equal(C.typeBucket('Sorcery'), 'Rituels');
  assert.equal(C.typeBucket('Legendary Planeswalker — Jace'), 'Planeswalkers'); assert.equal(C.typeBucket('Battle — Siege'), 'Batailles');
  assert.equal(C.typeBucket(''), 'Autres'); assert.equal(C.typeBucket(undefined), 'Autres');
});

test('groupSnap mana : colonnes par coût, 7+ regroupé, terrains (basiques en dernier), introuvables à la fin', () => {
  const g = C.groupSnap(SN, 'mana');
  assert.deepEqual(g.map(x => x.id), ['m0', 'm1', 'm2', 'm4', 'm7', 'land', 'nf']);
  assert.deepEqual(names(g[0]), ['Dryad Arbor', 'Mox Amber'], 'Land Creature n\'est pas un terrain ; Mox à coût 0');
  assert.deepEqual(names(g[1]), ['Llanowar Elves', 'Sol Ring'], 'tri alphabétique dans un groupe');
  assert.equal(g[1].count, 3, 'le nombre d\'exemplaires compte la quantité (2 + 1)'); assert.equal(g[1].cost, 190);
  assert.equal(g[4].label, '7 et plus'); assert.deepEqual(names(g[4]), ['Craterhoof Behemoth']);
  assert.deepEqual(names(g[5]), ['Command Tower', 'Forest'], 'terrain non basique avant les basiques'); assert.equal(g[5].count, 6);
  assert.deepEqual(names(g[6]), ['Phantom Card']);
});

test('groupSnap prix : du plus cher au moins cher, sans offre puis basiques puis introuvables', () => {
  const g = C.groupSnap(SN, 'price');
  assert.deepEqual(g.map(x => x.id), ['p', 'np', 'b', 'nf']);
  assert.deepEqual(names(g[0]), ['Craterhoof Behemoth', 'Mox Amber', 'Sol Ring', 'Arcane Signet', 'Llanowar Elves', 'Command Tower', 'Dryad Arbor']);
  assert.equal(g[0].cost, 1895);
});

test('groupSnap prix, relevé de référence : « Sans prix » au lieu de « Sans offre »', () => {
  assert.equal(C.groupSnap(SN, 'price').find(x => x.id === 'np').label, 'Sans offre');
  assert.equal(C.groupSnap(SN, 'price', true).find(x => x.id === 'np').label, 'Sans prix');
});

test('groupSnap type : ordre fixe des familles, groupes vides absents, tri par coût puis nom', () => {
  const g = C.groupSnap(SN, 'type');
  assert.deepEqual(g.map(x => x.label), ['Créatures', 'Artefacts', 'Rituels', 'Terrains', 'Introuvables']);
  assert.deepEqual(names(g[0]), ['Dryad Arbor', 'Llanowar Elves', 'Craterhoof Behemoth']);
  assert.deepEqual(names(g[1]), ['Mox Amber', 'Sol Ring', 'Arcane Signet']);
  assert.deepEqual(C.groupSnap([], 'mana'), []);
  assert.deepEqual(C.groupSnap([{ k: 'a', n: 'A', q: 1, s: 'ok', c: 1 }], 'mana').map(x => x.id), ['m0'], 'sans info de mana : coût 0');
});

test('curveOf : exemplaires par coût, 7+ cumulé, hors terrains et introuvables', () => {
  assert.deepEqual(C.curveOf(SN), [2, 3, 1, 0, 1, 0, 0, 1]);
});

test('sanitizeSnap : nettoie, borne, ignore le superflu ; null si inutilisable', () => {
  assert.equal(C.sanitizeSnap(null), null); assert.equal(C.sanitizeSnap({ at: 1, items: [] }), null); assert.equal(C.sanitizeSnap({ items: [{ k: 'a', n: 'A' }] }), null, 'sans date');
  const s = C.sanitizeSnap({ at: 5, mode: 'bizarre', lang: 'fr', sig: 'x', items: [
    { k: 'a', n: 'A', q: 0, s: 'ok', c: 12.6, l: 'fr', cm: 3.2, evil: '<b>', im: 'u' }, { k: '', n: 'vide' }, null, { k: 'b', n: 'B', s: 'zzz', c: 5 }, { k: 'c', n: 'C', q: 2, s: 'none', c: 99 }] });
  assert.equal(s.mode, 'zero'); assert.equal(s.items.length, 3);
  assert.deepEqual(s.items[0], { k: 'a', n: 'A', q: 1, s: 'ok', c: 13, l: 'fr', im: 'u', cm: 3 }, 'prix arrondi, quantité ≥ 1, champ inconnu retiré');
  assert.equal(s.items[1].s, 'none', 'état inconnu → none'); assert.equal(s.items[1].c, undefined, 'pas de prix hors état ok'); assert.equal(s.items[2].c, undefined);
  const big = C.sanitizeSnap({ at: 1, items: Array.from({ length: C.SNAP_MAX + 50 }, (_, i) => ({ k: 'k' + i, n: 'N' + i, s: 'ok', c: 1 })) }); assert.equal(big.items.length, C.SNAP_MAX);
  assert.ok(JSON.stringify(C.sanitizeSnap({ at: 1, items: SN })).length < 2000, 'compact');
});

test('deckDoc / readDeck : le relevé de prix suit le deck, absent s\'il n\'y en a pas', () => {
  const snap = { at: 1000, mode: 'zero', lang: 'fr', sig: 'fr|SP|no', items: SN };
  const d = C.deckDoc({ name: 'Test', text: '1 Sol Ring', snap }, 5);
  assert.equal(d.snap.items.length, SN.length); assert.equal(d.snap.at, 1000);
  assert.equal(C.readDeck('x', d).snap.items[0].n, 'Sol Ring', 'relecture tolérante : le relevé est conservé');
  assert.equal('snap' in C.deckDoc({ name: 'Test', text: '1 Sol Ring' }, 5), false, 'pas de champ snap vide (compatible avec les anciennes règles Firestore)');
  assert.equal('snap' in C.readDeck('y', { name: 'N', text: '1 A', snap: { at: 'nope', items: 3 } }), false, 'relevé corrompu ignoré');
});

test('newestSnap / snapAge', () => {
  assert.equal(C.newestSnap(null, undefined), null); assert.equal(C.newestSnap({ at: 1 }, { at: 9 }, null).at, 9);
  const now = Date.now(); assert.equal(C.snapAge({ at: now - 3600e3 }, now), 'fresh'); assert.equal(C.snapAge({ at: now - 25 * 3600e3 }, now), 'old');
});


/* ── Référence Cardmarket ─────────────────────────────────────────────────────────────────── */
test('eurCents / minRef : texte Scryfall → centimes, la moins chère des impressions', () => {
  assert.equal(C.eurCents('1.23'), 123); assert.equal(C.eurCents('0.00'), null); assert.equal(C.eurCents(null), null); assert.equal(C.eurCents('abc'), null); assert.equal(C.eurCents('12'), 1200);
  const bps = [{ eu: 300, ef: 900 }, { eu: 120, ef: null }, { eu: null, ef: 700 }, {}];
  assert.equal(C.minRef(bps, false), 120); assert.equal(C.minRef(bps, true), 700); assert.equal(C.minRef([], false), null); assert.equal(C.minRef(undefined, true), null);
});

test('normalizeProduct : la référence suit l\'impression et le foil ; makeDemoOffers en simule une', () => {
  const o = C.normalizeProduct(P, { eu: 180, ef: 600 }); assert.equal(o.ref, 180);
  assert.equal(C.normalizeProduct({ ...P, properties_hash: { ...P.properties_hash, mtg_foil: true } }, { eu: 180, ef: 600 }).ref, 600);
  assert.equal(C.normalizeProduct(P, { eu: null }).ref, null); assert.equal(C.normalizeProduct(P, null).ref, null);
  const d = C.makeDemoOffers({ key: 'sol ring' }, 'en'); assert.ok(d.length && d.every(x => x.ref > 0));
});

test('refInfo : niveaux good / ok / warn, référence de repli, quantités mélangées', () => {
  const off = (price, ref, foil = false) => ({ price, ref, foil });
  assert.equal(C.refInfo([{ offer: off(100, 120), n: 1 }], []).level, 'good');
  assert.equal(C.refInfo([{ offer: off(126, 120), n: 1 }], []).level, 'good', '≤ +5 %');
  assert.equal(C.refInfo([{ offer: off(150, 120), n: 1 }], []).level, 'ok');
  const w = C.refInfo([{ offer: off(200, 120), n: 1 }], []); assert.equal(w.level, 'warn'); assert.equal(w.diff, 80); assert.equal(w.pct, 67);
  assert.equal(C.refInfo([{ offer: off(40, 25), n: 1 }], []).level, 'ok', '+60 % mais seulement 0,15 € : pas d\'alerte');
  const f = C.refInfo([{ offer: off(300, null, true), n: 2 }], [{ eu: 100, ef: 250 }]); assert.equal(f.ref, 250, 'repli : référence foil la plus basse'); assert.equal(f.level, 'ok');
  const m = C.refInfo([{ offer: off(100, 100), n: 1 }, { offer: off(300, 100), n: 3 }], []); assert.equal(m.unit, 250); assert.equal(m.ref, 100);
  assert.equal(C.refInfo([{ offer: off(100, null), n: 1 }], []), null, 'aucune référence'); assert.equal(C.refInfo([], []), null);
});

test('refTotals : somme des cartes qui ont une référence', () => {
  const t = C.refTotals([{ k: 'a', n: 'A', q: 2, s: 'ok', c: 300, rf: 100 }, { k: 'b', n: 'B', q: 1, s: 'ok', c: 50 }, { k: 'c', n: 'C', q: 3, s: 'ok', c: 400, rf: 100, ow: 1 }, { k: 'd', n: 'D', q: 1, s: 'none', rf: 5 }]);
  assert.deepEqual([t.ref, t.cost, t.n, t.cards, t.pct], [400, 700, 4, 2, 75]);
});

/* ── Évolution carte par carte ────────────────────────────────────────────────────────────── */
test('sanitizeSnap : réf., possédées, commandant, prix précédents ; état « own »', () => {
  const s = C.sanitizeSnap({ at: 9, pv: { a: 100.4, '': 5, b: -3, c: 'x' }, pa: 3, items: [{ k: 'a', n: 'A', q: 2, s: 'ok', c: 300, rf: 160.5, ow: 5, cmd: 1 }, { k: 'b', n: 'B', q: 1, s: 'own' }, { k: 'c', n: 'C', q: 1, s: 'none', rf: 50 }] });
  assert.deepEqual(s.items[0], { k: 'a', n: 'A', q: 2, s: 'ok', c: 300, rf: 161, ow: 2, cmd: 1 }, 'ow ≤ q');
  assert.equal(s.items[1].s, 'own'); assert.equal(s.items[2].rf, undefined, 'pas de réf. hors état ok');
  assert.deepEqual(s.pv, { a: 100 }); assert.equal(s.pa, 3);
  assert.equal(C.sanitizeSnap({ at: 1, pv: { a: 5 }, items: SN }).pv, undefined, 'pv sans date : ignoré');
});

test('pvOf / snapDeltas / topMovers : variations par exemplaire', () => {
  const prev = { at: 1, items: [{ k: 'a', n: 'A', q: 2, s: 'ok', c: 400 }, { k: 'b', n: 'B', q: 1, s: 'ok', c: 100 }, { k: 'c', n: 'C', q: 1, s: 'none' }, { k: 'd', n: 'D', q: 1, s: 'ok', c: 50 }] };
  const pv = C.pvOf(prev); assert.deepEqual(pv, { a: 200, b: 100, d: 50 });
  assert.equal(C.pvOf({ at: 1, items: [{ k: 'x', n: 'X', q: 1, s: 'none' }] }), null);
  const now = [{ k: 'a', n: 'A', q: 2, s: 'ok', c: 300 }, { k: 'b', n: 'B', q: 1, s: 'ok', c: 100 }, { k: 'c', n: 'C', q: 1, s: 'ok', c: 70 }, { k: 'd', n: 'D', q: 3, s: 'ok', c: 240, ow: 1 }, { k: 'e', n: 'E', q: 1, s: 'ok', c: 9 }];
  const d = C.snapDeltas(now, pv);
  assert.deepEqual([...d.keys()], ['a', 'd'], 'inchangé, nouveau et sans relevé précédent : aucun écart');
  assert.deepEqual(d.get('a'), { unit: 150, prev: 200, diff: -50, tot: -100 }); assert.deepEqual(d.get('d'), { unit: 120, prev: 50, diff: 70, tot: 140 }, 'écart × exemplaires achetés (3 − 1 possédé)');
  const m = C.topMovers(now, d, 1); assert.equal(m.up[0].item.k, 'd'); assert.equal(m.down[0].item.k, 'a'); assert.equal(C.snapDeltas(now, null).size, 0);
});

/* ── Commandant ───────────────────────────────────────────────────────────────────────────── */
test('commanderKeys : cartes sous l\'en-tête Commander, rien sans en-tête', () => {
  assert.deepEqual(C.commanderKeys('Commander (1)\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring'), ['atraxa praetors voice']);
  assert.deepEqual(C.commanderKeys('Commander\n1 Tymna the Weaver\n1 Thrasios, Triton Hero\nDeck\n1 Sol Ring'), ['tymna the weaver', 'thrasios triton hero']);
  assert.deepEqual(C.commanderKeys('1 Cloud, Midgar Mercenary\n1 Sol Ring'), []); assert.deepEqual(C.commanderKeys(''), []);
  assert.ok(C.canLead('Legendary Creature — Human Soldier')); assert.ok(C.canLead('Legendary Planeswalker — Jace')); assert.ok(!C.canLead('Creature — Elf')); assert.ok(!C.canLead('Legendary Artifact')); assert.ok(!C.canLead(undefined));
});

/* ── Collection ───────────────────────────────────────────────────────────────────────────── */
test('parseCollection : texte, ManaBox, Moxfield, Archidekt, Dragon Shield, point-virgule, guillemets', () => {
  const t = C.parseCollection('3 Sol Ring\n2x Swords to Plowshares (CMM) 12 *F*\n// note\nCommand Tower\n1 Sol Ring');
  assert.equal(t.format, 'text'); assert.deepEqual(t.items.map(x => [x.n, x.q]), [['Sol Ring', 4], ['Swords to Plowshares', 2], ['Command Tower', 1]]); assert.equal(t.copies, 7);
  const mana = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID\n"Cloud, Midgar Mercenary",fin,FF,1,normal,rare,2,1,x\nSol Ring,cmm,CM,400,foil,uncommon,1,2,y\nSol Ring,c21,C21,5,normal,uncommon,3,3,z\nDelver of Secrets // Insectile Aberration,isd,ISD,51,normal,common,1,4,w';
  const m = C.parseCollection(mana); assert.equal(m.format, 'csv'); assert.deepEqual(m.items.map(x => [x.n, x.q]), [['Cloud, Midgar Mercenary', 2], ['Sol Ring', 4], ['Delver of Secrets // Insectile Aberration', 1]], 'impressions additionnées, virgule dans un nom entre guillemets');
  assert.equal(m.items[2].k, 'delver of secrets');
  const mox = 'Count,Tradelist Count,Name,Edition,Condition,Language,Foil\n"2","0","Arcane Signet","cmm","NM","English",""\n1,1,Fellwar Stone,c21,NM,English,';
  assert.deepEqual(C.parseCollection(mox).items.map(x => [x.n, x.q]), [['Arcane Signet', 2], ['Fellwar Stone', 1]], 'Count et non Tradelist Count');
  const arch = 'Quantity,Name,Finish,Condition\n4,Llanowar Elves,Normal,NM'; assert.deepEqual(C.parseCollection(arch).items.map(x => [x.n, x.q]), [['Llanowar Elves', 4]]);
  const ds = 'sep=,\nFolder Name,Quantity,Trade Quantity,Card Name,Set Code\nBinder,2,0,Counterspell,mh2'; assert.deepEqual(C.parseCollection(ds).items.map(x => [x.n, x.q]), [['Counterspell', 2]]);
  const semi = 'Nom;Quantité;Édition\nÉclair;3;LEA'; assert.deepEqual(C.parseCollection(semi).items.map(x => [x.n, x.q]), [['Éclair', 3]], 'point-virgule, en-têtes français');
  assert.equal(C.parseCollection('Name,Set\nSol Ring,cmm').items[0].q, 1, 'sans colonne quantité : 1');
  assert.deepEqual(C.parseCollection('').items, []); assert.equal(C.parseCollection('Name,Quantity\n,3\nSol Ring,x').skipped, 1);
  assert.equal(C.parseCollection('Name,Quantity\nSol Ring,99999').items[0].q, 9999, 'quantité bornée');
});

test('ownKey / mergeColl / collToText : fusion par nom de première face, texte du cloud', () => {
  assert.equal(C.ownKey('Fire // Ice'), 'fire'); assert.equal(C.ownKey('Ranger\'s Hawk'), 'rangers hawk'); assert.equal(C.ownKey('Kíli, the Resourceful'), 'kili the resourceful');
  const a = C.mergeColl({}, C.parseCollection('2 Sol Ring\n1 Fire // Ice').items, 'add');
  assert.equal(a['sol ring'].q, 2);
  const b = C.mergeColl({ ...a, 'sol ring': { ...a['sol ring'], cm: 1, tl: 'Artifact' } }, C.parseCollection('3 Sol Ring').items, 'add'); assert.equal(b['sol ring'].q, 5); assert.equal(b['sol ring'].cm, 1, 'infos Scryfall conservées');
  const r = C.mergeColl(b, C.parseCollection('1 Arcane Signet\n1 Sol Ring').items, 'replace'); assert.deepEqual(Object.keys(r).sort(), ['arcane signet', 'sol ring']); assert.equal(r['sol ring'].q, 1); assert.equal(r['sol ring'].cm, 1, 'remplacer garde les infos déjà lues');
  const txt = C.collToText(a); assert.equal(txt, '1 Fire // Ice\n2 Sol Ring'); assert.deepEqual(C.collFromText(txt)['fire'], { n: 'Fire // Ice', q: 1 });
  assert.equal(C.collToText({ x: { n: 'X', q: 0 }, y: { n: 'Y', q: 2 } }), '2 Y', 'quantité nulle : retirée');
});

test('applyOwned : possédées au plus la quantité demandée, reste à acheter', () => {
  const cards = C.parseDeck('2 Sol Ring\n1 Arcane Signet\n1 Fire // Ice\n1 Command Tower').cards;
  const own = { 'sol ring': 1, 'arcane signet': 4, fire: 1 };
  C.applyOwned(cards, k => own[k]);
  assert.deepEqual(cards.map(c => [c.own, c.need]), [[1, 1], [1, 0], [1, 0], [0, 1]], 'ownKey appliqué aux clés du deck (« fire // ice » → « fire »)');
  C.applyOwned(cards, null); assert.deepEqual(cards.map(c => [c.own, c.need]), [[0, 2], [0, 1], [0, 1], [0, 1]]);
});

/* ── Filtres et stats ─────────────────────────────────────────────────────────────────────── */
const FI = [
  { k: 'sol ring', n: 'Sol Ring', q: 1, s: 'ok', c: 100, cm: 1, tl: 'Artifact', cl: '' }, { k: 'swords', n: 'Swords to Plowshares', q: 1, s: 'ok', c: 200, cm: 1, tl: 'Instant', cl: 'W' },
  { k: 'atraxa', n: 'Atraxa', q: 1, s: 'ok', c: 900, cm: 4, tl: 'Legendary Creature — Phyrexian', cl: 'WUBG' }, { k: 'forest', n: 'Forest', q: 5, s: 'basic' },
  { k: 'tower', n: 'Command Tower', q: 1, s: 'ok', c: 30, cm: 0, tl: 'Land', cl: '' }, { k: 'ghost', n: 'Ghost Card', q: 1, s: 'nf' }, { k: 'big', n: 'Big', q: 1, s: 'none', cm: 9, tl: 'Creature — Giant', cl: 'R' }];
test('filterItems : texte, couleurs (ou), famille, coût ; sans infos = exclu dès qu\'un filtre de fiche est actif', () => {
  const names = f => C.filterItems(FI, f).map(i => i.n);
  assert.equal(C.filterItems(FI, null), FI); assert.equal(C.filterItems(FI, { q: '  ', colors: new Set() }), FI);
  assert.deepEqual(names({ q: 'sol' }), ['Sol Ring']); assert.deepEqual(names({ q: 'PLOWSHARES' }), ['Swords to Plowshares']); assert.deepEqual(names({ q: 'ghost' }), ['Ghost Card'], 'le texte seul garde les introuvables');
  assert.deepEqual(names({ colors: new Set(['W']) }), ['Swords to Plowshares', 'Atraxa']); assert.deepEqual(names({ colors: new Set(['U', 'R']) }), ['Atraxa', 'Big']);
  assert.deepEqual(names({ colors: new Set(['C']) }), ['Sol Ring', 'Command Tower']); assert.deepEqual(names({ colors: new Set(['G']) }), ['Atraxa', 'Forest'], 'Forest est verte');
  assert.deepEqual(names({ type: 'Créatures' }), ['Atraxa', 'Big']); assert.deepEqual(names({ type: 'Terrains' }), ['Forest', 'Command Tower']);
  assert.deepEqual(names({ cmc: 1 }), ['Sol Ring', 'Swords to Plowshares']); assert.deepEqual(names({ cmc: 7 }), ['Big'], '7 = 7 et plus'); assert.deepEqual(names({ cmc: 0 }), ['Forest', 'Command Tower']);
  assert.deepEqual(names({ colors: new Set(['W']), type: 'Éphémères', cmc: 1, q: 'sword' }), ['Swords to Plowshares'], 'filtres cumulés');
  assert.ok(C.filterActive({ q: 'x' })); assert.ok(C.filterActive({ colors: new Set(['W']) })); assert.ok(C.filterActive({ cmc: 0 })); assert.ok(!C.filterActive({ q: ' ', colors: new Set(), type: '', cmc: '' })); assert.ok(!C.filterActive(null));
  assert.equal(C.itemColors({ s: 'basic', k: 'snow covered island' }), 'U'); assert.equal(C.itemType({ s: 'basic' }), 'Terrains');
});

test('collStats : exemplaires, courbe, couleurs, familles, valeur, plus chères ; cartes sans infos comptées à part', () => {
  const items = [
    { k: 'a', n: 'A', q: 2, cm: 1, tl: 'Artifact', cl: '', eu: 150 }, { k: 'b', n: 'B', q: 1, cm: 4, tl: 'Creature — Elf', cl: 'G', eu: 25 }, { k: 'c', n: 'C', q: 3, cm: 9, tl: 'Legendary Creature — X', cl: 'WU', eu: 1000 },
    { k: 'd', n: 'D', q: 4, cm: 0, tl: 'Basic Land — Forest', cl: '', eu: 10 }, { k: 'e', n: 'E', q: 2, cm: 2, tl: 'Instant', cl: 'R' }, { k: 'f', n: 'F', q: 7 }];
  const s = C.collStats(items);
  assert.deepEqual([s.unique, s.copies, s.known, s.unknown, s.lands, s.spells], [6, 19, 5, 1, 4, 8]);
  assert.deepEqual(s.curve, [0, 2, 2, 0, 1, 0, 0, 3]); assert.deepEqual(s.colors, { W: 0, U: 0, B: 0, R: 2, G: 1, M: 3, C: 2 });
  assert.equal(s.types['Créatures'], 4); assert.equal(s.types['Terrains'], 4); assert.equal(s.types['Éphémères'], 2);
  assert.equal(s.value, 150 * 2 + 25 + 3000 + 40); assert.equal(s.valued, 4); assert.deepEqual(s.top.map(x => x.n), ['C', 'A', 'D', 'B'], 'par lot : prix × exemplaires (D : 4 × 0,10 € passe devant B : 1 × 0,25 €)'); assert.deepEqual(s.topUnit.map(x => x.n), ['C', 'A', 'B', 'D'], 'par carte'); assert.deepEqual(s.top.map(x => x.lot), [3000, 300, 40, 25]);
  assert.equal(C.collStats([]).copies, 0);
});

/* ── Reconnaissance des noms (OCR) ────────────────────────────────────────────────────────── */
const NAMES = ['Sol Ring', 'Swords to Plowshares', 'Lightning Bolt', 'Counterspell', 'Opt', 'Fog', 'Cloud, Midgar Mercenary', 'Delver of Secrets // Insectile Aberration', 'Mother of Runes', 'Rhystic Study', 'Wrath of God', 'Wrath of the Wild', 'Arcane Signet'];
const IDX = C.nameIndex(NAMES);
test('lev : distance bornée', () => {
  assert.equal(C.lev('kitten', 'sitting', 5), 3); assert.equal(C.lev('abc', 'abc', 2), 0); assert.ok(C.lev('abcdef', 'uvwxyz', 2) > 2); assert.ok(C.lev('a', 'abcdef', 2) > 2); assert.equal(C.lev('', 'ab', 3), 2);
});
test('matchName : exact, fautes d\'OCR, mana lu comme du texte, trop loin → rien', () => {
  const nm = (raw, min) => { const m = C.matchName(raw, IDX, min); return m && m.name; };
  assert.equal(nm('Sol Ring'), 'Sol Ring'); assert.equal(C.matchName('Sol Ring', IDX).score, 1);
  assert.equal(nm('SOL  RING'), 'Sol Ring'); assert.equal(nm('Lightning Bo1t'), 'Lightning Bolt'); assert.equal(nm('Lightnlng B0lt'), 'Lightning Bolt');
  assert.equal(nm('Swords to Plowshares ®@'), 'Swords to Plowshares', 'symboles de mana'); assert.equal(nm('Counterspell UU'), 'Counterspell', 'petit mot parasite de fin');
  assert.equal(nm('Rhystic Studv'), 'Rhystic Study'); assert.equal(nm('Cloud Midgar Mercenary'), 'Cloud, Midgar Mercenary', 'virgule oubliée');
  assert.equal(nm('Delver of Secrets'), 'Delver of Secrets // Insectile Aberration', 'première face seule');
  assert.equal(nm('Wrath of Gcd'), 'Wrath of God'); assert.equal(nm('Draw a card.'), null); assert.equal(nm('Flying, vigilance'), null); assert.equal(nm('xx'), null);
  assert.equal(nm('Op'), null, 'trop court'); assert.equal(nm('Fag'), null, '3 lettres : une faute suffit à refuser'); assert.equal(nm('Opt'), 'Opt');
  assert.equal(nm('Rhystic Study WUBG'), 'Rhystic Study', 'coût de mana lu comme un mot'); assert.ok(C.matchName('Rhystic Study RHO', IDX).score >= 0.9); assert.equal(nm('Wrath of GOD'), 'Wrath of God', 'dernier mot en capitales : le nom entier gagne'); assert.ok(C.matchName('Rhystic Study LLB', IDX).score >= 0.9);
  const m = C.matchName('Mother of Rune5', IDX); assert.ok(m.score >= 0.84 && m.score < 1);
  assert.ok(C.matchName('Wrath of the Wlld', IDX).name === 'Wrath of the Wild');
});
test('ocrMatches : plusieurs cartes, doublons additionnés, lignes de règles ignorées', () => {
  const lines = [{ text: 'Sol Ring', y: 10 }, { text: 'Artifact', y: 40 }, { text: '{T}: Add {C}{C}.', y: 80 }, { text: 'Lightning Bo1t R', y: 200 }, { text: 'Sol Rinq', y: 400 }, { text: '', y: 5 }, { text: 'Lightning Bolt deals 3 damage to any target.', y: 250 }];
  const r = C.ocrMatches(lines, IDX);
  assert.deepEqual(r.map(x => [x.name, x.q]), [['Sol Ring', 2], ['Lightning Bolt', 1]]); assert.equal(r[0].score, 1, 'meilleur score gardé');
  assert.deepEqual(C.ocrMatches([], IDX), []);
});

test('spanMatches / ocrMatches(spans) : plusieurs noms sur une ligne, mots isolés refusés', () => {
  const sp = C.spanMatches('Sol Ring Lightning Bolt Rhystic Study', IDX);
  assert.deepEqual(sp.map(x => x.name), ['Sol Ring', 'Lightning Bolt', 'Rhystic Study'], 'ordre de lecture');
  assert.deepEqual(C.spanMatches('Draw a card. Fog', IDX), [], 'nom trop court au milieu : refusé');
  assert.deepEqual(C.spanMatches('Sol', IDX), []); assert.deepEqual(C.spanMatches('', IDX), []);
  const r = C.ocrMatches([{ text: 'Sol Ring   Counterspell  Sol Ring' }, { text: 'Wrath of God' }], IDX, true);
  assert.deepEqual(r.map(x => [x.name, x.q]), [['Sol Ring', 2], ['Counterspell', 1], ['Wrath of God', 1]]);
  assert.deepEqual(C.ocrMatches([{ text: 'Sol Ring Counterspell' }], IDX, false).map(x => x.name).length, 0, 'sans spans : une ligne = un nom, la ligne double n\'est pas devinée');
});


/* ── Partage ──────────────────────────────────────────────────────────────────────────────── */
test('extractShared : liste en texte gardée, liens relevés, simple lien = pas de liste', () => {
  const a = C.extractShared({ title: 'Deck', text: '1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n1 Counterspell\nhttps://edhrec.com/average-decks/x.' });
  assert.equal(a.text.split('\n').length, 4); assert.deepEqual(a.urls, ['https://edhrec.com/average-decks/x']);
  const b = C.extractShared({ title: 'Atraxa - EDHREC', url: 'https://edhrec.com/average-decks/atraxa-praetors-voice' }); assert.equal(b.text, ''); assert.equal(b.urls.length, 1);
  const c = C.extractShared({ text: 'Regarde ça https://moxfield.com/decks/abc123' }); assert.equal(c.text, ''); assert.deepEqual(c.urls, ['https://moxfield.com/decks/abc123']);
  assert.deepEqual(C.extractShared({}), { text: '', urls: [] }); assert.deepEqual(C.extractShared(null), { text: '', urls: [] });
});

/* ── Collection : union, comparaison ; scan : meilleure lecture, cadrage, anti-doublon ───────────────── */
test('unionColl / sameColl : plus grande quantité, infos conservées, comparaison par clés et quantités', () => {
  const a = C.collFromText('2 Sol Ring\n1 Counterspell'), b = C.collFromText('3 Sol Ring\n1 Arcane Signet');
  b['sol ring'] = { ...b['sol ring'], cm: 1 };
  const u = C.unionColl(a, b);
  assert.deepEqual(Object.keys(u).sort(), ['arcane signet', 'counterspell', 'sol ring']); assert.equal(u['sol ring'].q, 3); assert.equal(u['sol ring'].cm, 1, 'infos de l\'autre côté gardées');
  assert.equal(a['sol ring'].q, 2, 'entrées non modifiées');
  assert.deepEqual(Object.keys(C.unionColl({}, b)).sort(), ['arcane signet', 'sol ring']); assert.deepEqual(C.unionColl(a, null), a);
  assert.ok(C.sameColl(a, C.collFromText('1 Counterspell\n2 Sol Ring'))); assert.ok(!C.sameColl(a, b)); assert.ok(!C.sameColl(a, C.collFromText('2 Sol Ring\n2 Counterspell'))); assert.ok(C.sameColl(null, {}));
});
test('bestMatch : la lecture la plus sûre, null si rien', () => {
  const m = C.bestMatch([{ text: 'Lightning Bo1t', y: 10 }, { text: 'Sol Ring', y: 20 }], IDX); assert.equal(m.name, 'Sol Ring'); assert.equal(m.score, 1);
  assert.equal(C.bestMatch([{ text: 'Draw a card.', y: 5 }], IDX), null); assert.equal(C.bestMatch([], IDX), null);
});
test('frWords : mots utiles d\'un nom lu, trait d\'union et apostrophe séparent', () => {
  assert.deepEqual(C.frWords('Coière-de Dieu'), ['Coière', 'Dieu']);
  assert.deepEqual(C.frWords("Sceau d'Arcane"), ['Arcane', 'Sceau']);
  assert.deepEqual(C.frWords('Elfes de Llanowar 12'), ['Llanowar', 'Elfes']);
  assert.deepEqual(C.frWords('Dieu Dieu'), ['Dieu']); assert.deepEqual(C.frWords('de la'), []); assert.deepEqual(C.frWords(null), []);
});
test('coverMap : rectangle écran → pixels de la vidéo (object-fit: cover)', () => {
  const r = C.coverMap(400, 800, 1280, 720, { x: 0, y: 100, w: 400, h: 80 });
  assert.deepEqual(r, { x: 460, y: 90, w: 360, h: 72 }, 'vidéo recadrée sur les côtés : 400×800 écran, échelle 1,11');
  const whole = C.coverMap(400, 225, 1280, 720, { x: 0, y: 0, w: 400, h: 225 }); assert.deepEqual(whole, { x: 0, y: 0, w: 1280, h: 720 }, 'même rapport : toute la vidéo');
  const out = C.coverMap(400, 800, 1280, 720, { x: -50, y: 790, w: 600, h: 200 }); assert.ok(out.x >= 0 && out.y >= 0 && out.x + out.w <= 1280 && out.y + out.h <= 720 && out.w >= 1 && out.h >= 1, 'borné à la vidéo');
});
test('makeFpsWatch : alerte seulement si l\'aperçu reste lent plusieurs secondes, jamais sur une image fluide ni après une pause', () => {
  const run = (fps, secs, w, t0 = 0) => { const out = []; for (let t = t0; t < t0 + secs * 1000; t += 1000 / fps) out.push(w.feed(t)); return out; };
  const a = C.makeFpsWatch(14, 3000, 2000); assert.ok(run(30, 8, a).every(r => !r.low), '30 i/s : jamais d\'alerte');
  const b = C.makeFpsWatch(14, 3000, 2000), r = run(6, 8, b); assert.equal(r.filter(x => x.low).length, 1, 'une seule alerte sur 8 s à 6 i/s');
  assert.ok(Math.abs(r.at(-1).fps - 6) < 1.5, 'fps mesuré ≈ 6');
  const c = C.makeFpsWatch(14, 3000, 2000); run(6, 3, c); c.feed(20000); assert.ok(run(30, 5, c, 20033).every(x => !x.low), 'pause longue (onglet masqué) : mesure remise à zéro');
  const d = C.makeFpsWatch(14, 3000, 2000); run(6, 2.5, d); assert.ok(run(30, 5, d, 2500).every(x => !x.low), 'ça redevient fluide avant la fin du délai : pas d\'alerte');
  const e = C.makeFpsWatch(); e.feed(0); assert.deepEqual(e.feed(100), { fps: 0, low: false }, 'pas assez de recul : pas de mesure');
});
test('langue des cartes : marqueur *FR*, colonne CSV, texte cloud aller-retour, une langue lue = sa propre ligne', () => {
  assert.equal(C.cardLang('Français'), 'fr'); assert.equal(C.cardLang('ja'), 'jp'); assert.equal(C.cardLang('English'), 'en'); assert.equal(C.cardLang('xx'), ''); assert.equal(C.cardLang(null), '');
  assert.deepEqual(C.parseLine('2 Sol Ring *FR*'), { qty: 2, name: 'Sol Ring', key: 'sol ring', lang: 'fr' });
  assert.equal(C.parseLine('2 Sol Ring *F*').lang, undefined, '*F* = foil, pas une langue'); assert.equal(C.parseLine('1 Sol Ring *ZZ*').lang, undefined);
  const csv = C.parseCollection('Name,Quantity,Language\nSol Ring,2,French\nArcane Signet,1,en\nSol Ring,1,fr\nCounterspell,1,');
  assert.deepEqual(csv.items.map(i => [i.n, i.q, i.l]), [['Sol Ring', 3, 'fr'], ['Arcane Signet', 1, 'en'], ['Counterspell', 1, undefined]]);
  assert.equal(C.parseCollection('3 Sol Ring *DE*\n1 Counterspell').items[0].l, 'de');
  const coll = { 'sol ring': { n: 'Sol Ring', q: 2, l: 'fr' }, counterspell: { n: 'Counterspell', q: 1 } };
  const t = C.collToText(coll); assert.equal(t, '1 Counterspell\n2 Sol Ring *FR*');
  const back = C.collFromText(t); assert.equal(back['sol ring'].l, 'fr'); assert.equal(back.counterspell.l, undefined); assert.ok(C.sameColl(coll, back));
  assert.ok(!C.sameColl(coll, { ...coll, 'sol ring': { n: 'Sol Ring', q: 2 } }), 'langue différente = collection différente (synchro)');
  const m1 = C.mergeColl(coll, [{ k: 'sol ring', n: 'Sol Ring', q: 1, l: 'en' }, { k: 'counterspell', n: 'Counterspell', q: 1 }], 'add');
  assert.equal(m1['sol ring'].q, 3); assert.deepEqual(m1['sol ring'].x, { fr: 2, en: 1 }, 'une langue lue ≠ celle de la carte : sa propre ligne'); assert.equal(m1['sol ring'].l, 'fr', 'langue la plus fournie'); assert.equal(m1.counterspell.l, undefined, 'sans langue lue : inchangé');
  assert.equal(C.mergeColl(coll, [{ k: 'counterspell', n: 'Counterspell', q: 1 }], 'add')['sol ring'].l, 'fr', 'autres cartes intactes');
  assert.equal(C.unionColl({ a: { n: 'A', q: 1 } }, { a: { n: 'A', q: 2, l: 'fr' } }).a.l, 'fr', 'union : langue du compte gardée si l\'appareil n\'en a pas');
});
test('une carte, plusieurs langues : lignes, texte (une ligne par langue), import CSV, ajout, fusion ligne par ligne', () => {
  const E = (lines, d) => C.collFromLines({ n: 'Sol Ring', ...(d ? { d } : {}) }, lines);
  const e = E([['fr', 2], ['en', 1]]);
  assert.deepEqual(e, { n: 'Sol Ring', q: 3, l: 'fr', x: { fr: 2, en: 1 } }); assert.deepEqual(C.collLines(e), [['fr', 2], ['en', 1]], 'ordre d\'affichage : fr, en…');
  assert.deepEqual(E([['en', 5], ['fr', 1], ['', 2]]).x, { fr: 1, en: 5, '': 2 }); assert.equal(E([['en', 5], ['fr', 1]]).l, 'en', 'la plus fournie');
  assert.equal(E([['fr', 1], ['en', 1]]).l, 'fr', 'égalité : fr d\'abord'); assert.equal(E([['', 3], ['fr', 1]]).l, undefined, 'non précisée majoritaire : pas de langue');
  assert.deepEqual(E([['fr', 2]]), { n: 'Sol Ring', q: 2, l: 'fr' }, 'une seule langue : pas de x'); assert.equal(E([['fr', 0]]), null); assert.deepEqual(E([['fr', 1], ['fr', 2]]), { n: 'Sol Ring', q: 3, l: 'fr' }, 'même langue : additionnée');
  assert.deepEqual(C.collLines({ q: 2 }), [['', 2]]); assert.deepEqual(C.collLines(null), []); assert.deepEqual(C.collLines({ q: 0 }), []);
  // texte : une ligne par langue, date sur chaque ligne, aller-retour
  const coll = { 'sol ring': E([['fr', 2], ['en', 1]], 1700000000), counterspell: { n: 'Counterspell', q: 1 } };
  const t = C.collToText(coll, true); assert.equal(t.split('\n').length, 3); assert.match(t, /^1 Counterspell\n2 Sol Ring \(D[0-9a-z]+\) \*FR\*\n1 Sol Ring \(D[0-9a-z]+\) \*EN\*$/);
  const back = C.collFromText(t); assert.deepEqual(back['sol ring'], coll['sol ring']); assert.ok(C.sameColl(coll, back)); assert.equal(C.collToText(coll), '1 Counterspell\n2 Sol Ring *FR*\n1 Sol Ring *EN*', 'export sans date');
  assert.ok(!C.sameColl(coll, { ...coll, 'sol ring': E([['fr', 1], ['en', 2]]) }), 'même total, autre répartition : collection différente');
  // import : une ligne par langue (CSV ManaBox / texte), sans langue + langue = deux lignes
  const csv = C.parseCollection('Name,Quantity,Language\nSol Ring,2,French\nSol Ring,1,English\nSol Ring,1,fr\nArcane Signet,1,');
  assert.deepEqual(csv.items.map(i => [i.n, i.q, i.l, i.x]), [['Sol Ring', 4, 'fr', { fr: 3, en: 1 }], ['Arcane Signet', 1, undefined, undefined]]); assert.equal(csv.copies, 5);
  assert.deepEqual(C.parseCollection('1 Sol Ring\n2 Sol Ring *FR*').items[0].x, { fr: 2, '': 1 });
  // ajout : langue lue → sa ligne ; sans langue → rejoint la langue dominante ; carte neuve sans langue → non précisée
  let m = C.mergeColl(coll, [{ k: 'sol ring', n: 'Sol Ring', q: 2, l: 'en' }], 'add'); assert.deepEqual(m['sol ring'].x, { fr: 2, en: 3 }); assert.equal(m['sol ring'].l, 'en'); assert.equal(m['sol ring'].d, 1700000000, 'date d\'ajout gardée');
  m = C.mergeColl(coll, [{ k: 'sol ring', n: 'Sol Ring', q: 1 }], 'add'); assert.deepEqual(m['sol ring'].x, { fr: 3, en: 1 }, 'sans langue : rejoint la plus fournie (fr)');
  m = C.mergeColl(coll, [{ k: 'sol ring', n: 'Sol Ring', q: 1, l: 'de' }, { k: 'sol ring', n: 'Sol Ring', q: 2, l: 'de' }], 'add'); assert.deepEqual(m['sol ring'].x, { fr: 2, en: 1, de: 3 }, 'deux lots du même appel : cumulés');
  m = C.mergeColl({}, [{ k: 'x', n: 'X', q: 2 }], 'add', 5); assert.deepEqual(m.x, { n: 'X', q: 2, d: 5 });
  m = C.mergeColl(coll, [{ k: 'sol ring', n: 'Sol Ring', q: 1, l: 'de' }], 'replace'); assert.deepEqual(Object.keys(m), ['sol ring']); assert.deepEqual(m['sol ring'], { n: 'Sol Ring', q: 1, l: 'de', d: 1700000000 }, 'remplacement : seules les lignes importées');
  // fusion entre appareils, ligne par ligne
  const A = { 'sol ring': E([['fr', 2]]) }, local = { 'sol ring': E([['fr', 2], ['en', 1]]) }, remote = { 'sol ring': E([['fr', 3]]) };
  let r = C.merge3(A, local, remote); assert.deepEqual(r['sol ring'].x, { fr: 3, en: 1 }, '+1 EN ici, +1 FR là-bas : les deux');
  r = C.merge3(A, local, A); assert.deepEqual(r['sol ring'].x, { fr: 2, en: 1 }, 'ligne ajoutée ici, compte inchangé : gardée'); r = C.merge3(A, A, local); assert.deepEqual(r['sol ring'].x, { fr: 2, en: 1 }, 'ligne venue du compte');
  r = C.merge3(local, { 'sol ring': E([['fr', 2]]) }, { 'sol ring': E([['fr', 2], ['en', 1], ['de', 4]]) }); assert.deepEqual(r['sol ring'].x, { fr: 2, de: 4 }, 'EN retirée ici, DE ajoutée là-bas : les deux');
  r = C.merge3(A, { 'sol ring': E([['fr', 2], ['en', 1]]) }, { 'sol ring': E([['fr', 2], ['en', 1]]) }); assert.deepEqual(r['sol ring'].x, { fr: 2, en: 1 }, 'même changement des deux côtés : pas de doublon');
  r = C.merge3(null, local, remote); assert.deepEqual(r['sol ring'].x, { fr: 3, en: 1 }, 'sans base : plus grande quantité par langue (union)');
  assert.deepEqual(C.unionColl(local, remote)['sol ring'].x, { fr: 3, en: 1 });
  assert.deepEqual(C.unionColl({ a: { n: 'A', q: 5 } }, { a: { n: 'A', q: 3, l: 'fr', x: { fr: 1, en: 1, '': 1 } } }).a.x, { fr: 1, en: 1, '': 3 }, 'non précisées : 5 contre 3 → 5 au total, les langues connues en font partie');
});
test('prix réels : offre la moins chère achetable (critères, hub en Zero, langue), prix unitaire, valeur', () => {
  const o = (id, price, x = {}) => ({ id, price, qty: 2, cond: 'Near Mint', foil: false, lang: 'fr', hub: true, vac: false, graded: false, signed: false, altered: false, bundle: 1, cur: 'EUR', ...x });
  const opts = { cond: 'Slightly Played', foil: 'no', mode: 'zero', lang: 'fr' };
  const offers = [o(1, 900, { hub: false }), o(2, 750, { cond: 'Heavily Played' }), o(3, 800), o(4, 700, { foil: true }), o(5, 650, { vac: true }), o(6, 600, { lang: 'en' }), o(7, 850), o(8, 500, { qty: 0 })];
  assert.equal(C.cheapestOffer(offers, opts).id, 3, 'Zero : hub seulement, état ≥ SP, hors foil / vacances / autre langue / stock nul');
  assert.equal(C.cheapestOffer(offers, { ...opts, mode: 'direct' }).price, 800, 'Direct : 8,00 € (le vendeur non-hub à 9,00 € n\'est pas moins cher)');
  assert.equal(C.cheapestOffer([o(9, 400, { hub: false })], opts), null, 'Zero : aucune offre hub'); assert.equal(C.cheapestOffer([o(9, 400, { hub: false })], { ...opts, mode: 'direct' }).price, 400);
  assert.equal(C.cheapestOffer(offers, { ...opts, lang: 'en' }).id, 6, 'langue demandée'); assert.equal(C.cheapestOffer([], opts), null); assert.equal(C.cheapestOffer(null, opts), null);
  assert.equal(C.cheapestOffer([o(1, 500), o(2, 500, { qty: 9 })], opts).id, 2, 'égalité : plus gros stock, comme l\'optimiseur');
  assert.equal(C.unitPrice({ eu: 1300, rp: 750 }), 750, 'prix réel prioritaire'); assert.equal(C.unitPrice({ eu: 1300, rp: null }), 1300, 'aucune offre : estimation'); assert.equal(C.unitPrice({ eu: 1300 }), 1300); assert.equal(C.unitPrice({}), null); assert.equal(C.unitPrice({ rp: 0, eu: null }), null);
  const sig = C.pxSig('fr', opts); assert.equal(sig, 'fr|Slightly Played|no|zero'); assert.notEqual(sig, C.pxSig('fr', { ...opts, mode: 'direct' })); assert.notEqual(sig, C.pxSig('en', opts));
  const now = 10 * 86400000, px = { p: 100, t: now - 3600000, s: sig };
  assert.equal(C.pxStale(px, sig, now, 2 * 86400000), false); assert.equal(C.pxStale(px, sig + 'x', now, 2 * 86400000), true, 'critères changés'); assert.equal(C.pxStale({ ...px, t: now - 3 * 86400000 }, sig, now, 2 * 86400000), true, 'trop ancien'); assert.equal(C.pxStale(undefined, sig, now, 1), true); assert.equal(C.pxStale({ p: null, t: now, s: sig }, sig, now, 1000), false, 'aucune offre lue = lu');
  const mk = (k, q, eu, rp, tl = 'Artifact') => ({ k, n: k, q, tl, cm: 1, cl: '', eu, ...(rp !== undefined ? { rp } : {}) });
  const st = C.collStats([mk('a', 2, 1300, 750), mk('b', 1, 500), mk('c', 1, 400, null), mk('d', 1, null)]);
  assert.equal(st.value, 2 * 750 + 500 + 400, 'valeur : prix réels, sinon estimations'); assert.equal(st.valued, 3); assert.equal(st.real, 1);
  assert.deepEqual(st.top.map(i => [i.k, i.up]), [['a', 750], ['b', 500], ['c', 400]], '« les plus chères » sur le prix utilisé');
});
test('date d\'ajout : posée à la 1re entrée, texte du compte lisible par l\'ancienne version, fusion sans perte', () => {
  const T0 = 1760000000, T1 = T0 + 90;
  let c = C.mergeColl({}, C.parseCollection('2 Sol Ring *FR*\n1 Fire // Ice').items, 'add', T0);
  assert.equal(c['sol ring'].d, T0); assert.equal(c['fire'].d, T0);
  c = C.mergeColl(c, C.parseCollection('1 Sol Ring\n1 Arcane Signet').items, 'add', T1);
  assert.equal(c['sol ring'].d, T0, 'une carte déjà là garde sa date'); assert.equal(c['arcane signet'].d, T1); assert.equal(c['sol ring'].q, 3);
  const old = { 'ancienne': { n: 'Ancienne', q: 1 } };
  assert.equal(C.mergeColl(old, [{ k: 'ancienne', n: 'Ancienne', q: 1 }], 'add', T1)['ancienne'].d, undefined, 'une carte d\'avant le suivi reste sans date');
  const r = C.mergeColl(c, C.parseCollection('1 Arcane Signet\n1 Mox Amber').items, 'replace', T1 + 5); assert.equal(r['arcane signet'].d, T1, 'remplacer garde la date'); assert.equal(r['mox amber'].d, T1 + 5);
  // texte : avec dates (stockage, compte), sans (export) ; aller-retour exact
  const txt = C.collToText(c, true); assert.match(txt, /^1 Arcane Signet \(D[0-9a-z]{6}\)$/m); assert.match(txt, /^3 Sol Ring \(D[0-9a-z]{6}\) \*FR\*$/m);
  assert.deepEqual(C.collFromText(txt), c); assert.equal(C.collToText(c), '1 Arcane Signet\n1 Fire // Ice\n3 Sol Ring *FR*', 'export sans repère');
  assert.deepEqual(C.collFromText('2 Sol Ring *FR*\n1 Mox Amber'), { 'sol ring': { n: 'Sol Ring', q: 2, l: 'fr' }, 'mox amber': { n: 'Mox Amber', q: 1 } }, 'texte sans dates (ancien compte) : accepté');
  // l'ancienne version (parseCollection sans option) lit le même texte sans y voir de date
  const o = C.parseCollection(txt).items.map(i => [i.k, i.n, i.q, i.l || '']).sort(); assert.deepEqual(o, [['arcane signet', 'Arcane Signet', 1, ''], ['fire', 'Fire // Ice', 1, ''], ['sol ring', 'Sol Ring', 3, 'fr']]);
  // import d'un texte qui contient un code d'extension ressemblant : jamais pris pour une date
  assert.equal(C.parseCollection('1 Sol Ring (Dabcdef)').items[0].d, undefined);
  // merge3 : un appareil qui ne connaît pas les dates (ancienne version) ne les efface pas
  const base = { 'sol ring': { n: 'Sol Ring', q: 1, d: T0 } };
  assert.equal(C.merge3(base, base, { 'sol ring': { n: 'Sol Ring', q: 2 } })['sol ring'].d, T0, 'quantité changée ailleurs sans date');
  assert.equal(C.merge3(null, { 'sol ring': { n: 'Sol Ring', q: 1, d: T1 } }, { 'sol ring': { n: 'Sol Ring', q: 1, d: T0 } })['sol ring'].d, T0, 'la plus ancienne date connue');
  assert.equal(C.sameColl({ a: { n: 'A', q: 1, d: T0 } }, { a: { n: 'A', q: 1 } }), true, 'la date seule ne déclenche pas de synchro');
});
test('merge3 : fusion carte par carte de deux appareils (ajout, retrait, quantité, langue, rejeu)', () => {
  const E = (q, l) => ({ n: 'X', q, ...(l ? { l } : {}) });
  const m = (b, l, r) => C.merge3(b, l, r);
  const q = (o, k) => (o[k] ? o[k].q : 0);
  // ajout / retrait de l'autre appareil récupérés tant qu'ici rien n'a bougé
  let r = m({ a: E(1), b: E(2) }, { a: E(1), b: E(2) }, { a: E(1), b: E(2), c: E(3) }); assert.deepEqual(Object.keys(r).sort(), ['a', 'b', 'c']);
  r = m({ a: E(1), b: E(2) }, { a: E(1), b: E(2) }, { a: E(1) }); assert.deepEqual(Object.keys(r), ['a'], 'retrait venu du compte appliqué');
  r = m({ a: E(1), b: E(2) }, { a: E(1), b: E(2) }, { a: E(1), b: E(5) }); assert.equal(q(r, 'b'), 5, 'quantité venue du compte');
  // changements d'ici préservés, même si le compte n'a pas bougé
  r = m({ a: E(1) }, { a: E(1), n: E(2) }, { a: E(1) }); assert.equal(q(r, 'n'), 2, 'ajout d\'ici gardé');
  r = m({ a: E(1), b: E(2) }, { a: E(1) }, { a: E(1), b: E(2) }); assert.ok(!r.b, 'retrait d\'ici gardé');
  // deux appareils ajoutent des cartes différentes en même temps : les deux
  r = m({ a: E(1) }, { a: E(1), x: E(1) }, { a: E(1), y: E(4) }); assert.deepEqual(Object.keys(r).sort(), ['a', 'x', 'y']); assert.equal(q(r, 'y'), 4);
  // une carte modifiée des deux côtés : les écarts s'additionnent
  r = m({ a: E(2) }, { a: E(3) }, { a: E(4) }); assert.equal(q(r, 'a'), 5, '+1 ici, +2 là-bas = +3');
  r = m({ a: E(3) }, { a: E(1) }, { a: E(2) }); assert.ok(!r.a, '−2 ici, −1 là-bas : plus rien');
  // même changement des deux côtés (ou fusion rejouée après un envoi incertain) : pas de doublon
  r = m({ a: E(2) }, { a: E(3) }, { a: E(3) }); assert.equal(q(r, 'a'), 3, 'rejeu : pas de double comptage');
  r = m({ a: E(2) }, { a: E(5), z: E(1) }, { a: E(5), z: E(1) }); assert.equal(q(r, 'a'), 5); assert.equal(q(r, 'z'), 1);
  // retrait contre modification : la modification l'emporte, dans les deux sens
  r = m({ a: E(2) }, {}, { a: E(3) }); assert.equal(q(r, 'a'), 3, 'retiré ici, +1 là-bas : gardée');
  r = m({ a: E(2) }, { a: E(3) }, {}); assert.equal(q(r, 'a'), 3, '+1 ici, retirée là-bas : gardée');
  r = m({ a: E(2) }, {}, {}); assert.deepEqual(r, {}, 'retirée des deux côtés');
  // langue
  r = m({ a: E(1) }, { a: E(1, 'fr') }, { a: E(1) }); assert.equal(r.a.l, 'fr', 'langue posée ici');
  r = m({ a: E(1) }, { a: E(1) }, { a: E(1, 'de') }); assert.equal(r.a.l, 'de', 'langue posée là-bas');
  r = m({ a: E(1) }, { a: E(2, 'fr') }, { a: E(3, 'de') }); assert.equal(q(r, 'a'), 5); assert.deepEqual(r.a.x, { fr: 2, de: 3 }, 'deux langues posées en même temps : chacune garde sa ligne'); assert.equal(r.a.l, 'de', 'langue la plus fournie');
  r = m({ a: E(1, 'fr') }, { a: E(2, 'fr') }, { a: E(1) }); assert.equal(q(r, 'a'), 2); assert.deepEqual(r.a.x, { fr: 1, '': 1 }, 'langue effacée là-bas, +1 FR ici : une ligne chacune');
  // sans base (première connexion) : union, plus grande quantité, langue connue
  r = m(null, { a: E(1), b: E(2) }, { a: E(3, 'fr'), c: E(1) }); assert.deepEqual(Object.keys(r).sort(), ['a', 'b', 'c']); assert.equal(q(r, 'a'), 3, '1 sans langue ici = probablement les 3 FR du compte : pas de double compte'); assert.equal(r.a.l, 'fr'); assert.equal(r.a.x, undefined);
  // entrées jamais mutées, résultat indépendant
  const loc = { a: E(1) }, rem = { a: E(1), b: E(1) }; r = m({ a: E(1) }, loc, rem); r.b.q = 99; assert.equal(rem.b.q, 1); assert.equal(loc.a.q, 1);
  assert.deepEqual(m(null, null, null), {}); assert.equal(q(m({ a: E(1) }, { a: E(20000) }, { a: E(1) }), 'a'), 20000, 'quantité d\'ici (plafond appliqué par l\'appli)');
  // idempotence : fusionner deux fois le même compte ne change rien
  const base = { a: E(1), b: E(2) }, loc2 = { a: E(2), n: E(1) }, rem2 = { b: E(3), z: E(1) };
  const once = m(base, loc2, rem2), twice = m(rem2, once, rem2); assert.ok(C.sameColl(once, twice), 'fusion stable');
});
test('collStats : source CT (prix réel, sinon estimation) ou CM (estimation Cardmarket seule), valeur de l\'autre source en regard', () => {
  const mk = (k, q, eu, rp) => ({ k, n: k, q, tl: 'Artifact', cm: 1, cl: '', eu, ...(rp !== undefined ? { rp } : {}) });
  const items = [mk('a', 2, 1300, 750), mk('b', 1, 500), mk('c', 1, 400, null), mk('d', 1, null, 900)];
  const ct = C.collStats(items), ct2 = C.collStats(items, 'ct'), junk = C.collStats(items, 'zz'), cm = C.collStats(items, 'cm');
  assert.equal(ct.src, 'ct'); assert.equal(ct2.value, ct.value); assert.equal(junk.src, 'ct', 'source inconnue : CT');
  assert.equal(ct.value, 2 * 750 + 500 + 400 + 900); assert.equal(ct.real, 2); assert.equal(ct.valued, 4);
  assert.equal(cm.src, 'cm'); assert.equal(cm.value, 2 * 1300 + 500 + 400, 'CM : estimations seules, le prix réel est ignoré'); assert.equal(cm.valued, 3, 'une carte sans estimation Cardmarket n\'est pas comptée'); assert.equal(cm.real, 0);
  assert.deepEqual(cm.top.map(i => [i.k, i.up, i.lot, i.rl]), [['a', 1300, 2600, false], ['b', 500, 500, false], ['c', 400, 400, false]], 'plus chères en CM : lot = prix × exemplaires, tag « prix réel » sur la source choisie');
  assert.deepEqual(ct.top.map(i => [i.k, i.up, i.lot, i.rl]), [['a', 750, 1500, true], ['d', 900, 900, true], ['b', 500, 500, false], ['c', 400, 400, false]], 'par lot : 2 × 7,50 € devant 1 × 9,00 €'); assert.deepEqual(ct.topUnit.map(i => i.k), ['d', 'a', 'b', 'c'], 'par carte');
  assert.deepEqual(ct.alt, { value: 2 * 1300 + 500 + 400, valued: 3 }, 'CT : valeur CM en regard'); assert.deepEqual(cm.alt, { value: ct.value, valued: 4 }, 'CM : valeur CT en regard');
  assert.equal(C.srcPrice({ eu: 100, rp: 90 }, 'cm').u, 100); assert.equal(C.srcPrice({ eu: 100, rp: 90 }, 'ct').real, true); assert.equal(C.srcPrice({ eu: 100 }, 'ct').real, false); assert.equal(C.srcPrice({ rp: 90 }, 'cm'), null); assert.equal(C.srcPrice({}, 'ct'), null);
  assert.equal(C.srcPrice({ eu: 90, rp: 90 }, 'ct').real, true, 'prix réel égal à l\'estimation : reste un prix réel');
});
/* ── Catalogue français ───────────────────────────────────────────────────────────────────── */
const FR_ROWS = ['Anneau solaire\tSol Ring\tfr/sol.jpg', 'Épées aux charrues\tSwords to Plowshares\thttps://x/y.jpg', 'Éclair\tLightning Bolt\t', 'Contresort\tCounterspell', 'Œil de la tempête\tStorm Eye\tfr/eye.jpg', 'Vampire de la baronnie\tBarony Vampire\tfr/bv.jpg', 'Colère de Dieu\tWrath of God\tfr/wog.jpg', 'Signe arcanique\tArcane Signet\tfr/as.jpg', 'Étude rhystique\tRhystic Study\tfr/rs.jpg', 'Mère des runes\tMother of Runes\tfr/mr.jpg', 'Seigneur des Tréfonds\tLord of the Pit\tfr/lp.jpg'];
test('normPart : œ / æ dépliés, accents et apostrophes retirés', () => {
  assert.equal(C.normPart('Œil de la tempête'), 'oeil de la tempete'); assert.equal(C.normPart('Cœur de l\'œuf Æther'), 'coeur de loeuf aether'); assert.equal(C.normPart('Oeil de la tempete'), C.normPart('Œil de la tempête'), 'OCR sans ligature = nom imprimé');
});
test('levw : fautes d\'OCR courantes coûtent moins qu\'une vraie différence', () => {
  assert.equal(C.levw('sol ring', 'sol ring', 2), 0); assert.equal(C.levw('sol rinq', 'sol ring', 3), 0.5, 'q/g : confusion d\'OCR'); assert.equal(C.levw('sol rinq', 'sol ring', 3, false), 1, 'sans pondération : coût plein');
  assert.equal(C.levw('abc', 'abd', 3), 1, 'substitution ordinaire : coût plein'); assert.ok(C.levw('abcdef', 'uvwxyz', 2) > 2, 'trop loin : > max');
});
test('frCatalog / matchFr / bestOf : nom imprimé → carte anglaise + image française ; à égalité le français', () => {
  const fc = C.frCatalog(FR_ROWS.concat(['pas de tabulation', '\tsans nom', 'Éclair\tDoublon\t']));
  assert.equal(fc.n, FR_ROWS.length, 'lignes invalides et doublons ignorés'); assert.equal(fc.by.get(C.normPart('Éclair')).en, 'Lightning Bolt', 'premier nom gardé');
  const m = C.matchFr([{ text: 'Anneau solaíre' }], fc); assert.equal(m.name, 'Sol Ring'); assert.equal(m.key, 'sol ring'); assert.equal(m.card, 'fr'); assert.equal(m.img, C.FR_IMG + 'fr/sol.jpg', 'chemin relatif → CDN Scryfall');
  assert.equal(C.matchFr([{ text: 'Épées aux charrue' }], fc).img, 'https://x/y.jpg', 'URL complète gardée'); assert.equal(C.matchFr([{ text: 'Contresort' }], fc).img, '');
  assert.equal(C.matchFr([{ text: 'zzzzzzzz qqqq' }], fc), null); assert.equal(C.matchFr([{ text: 'Sol Ring' }], null), null, 'pas de catalogue : rien');
  assert.equal(C.matchFr([{ text: 'Œil de la tempête' }], fc).name, 'Storm Eye'); assert.equal(C.matchFr([{ text: 'Oeil de la tempete' }], fc).name, 'Storm Eye');
  const A = { score: 0.9, card: 'fr' }, B = { score: 0.9, card: 'en' };
  assert.equal(C.bestOf(A, B), A, 'égalité : français'); assert.equal(C.bestOf({ score: 0.8, card: 'fr' }, B), B, 'anglais plus sûr'); assert.equal(C.bestOf(A, { score: 0.95, card: 'en' }).card, 'en'); assert.equal(C.bestOf(null, B), B); assert.equal(C.bestOf(A, null), A); assert.equal(C.bestOf(null, null), null);
});
test('frCatalog : un nom français partagé par deux cartes n\'est jamais « sûr » (à vérifier)', () => {
  const fc = C.frCatalog(['Dépérissement\tSicken\tfr/a.jpg', 'Dépérissement\tWaste Away\tfr/b.jpg', 'Anneau solaire\tSol Ring\tfr/c.jpg', 'Anneau solaire\tSol Ring\tfr/d.jpg', 'Collision // Colosse\tCollision // Colossus\t', 'Collision // Autre\tCollision // Other\t']);
  assert.deepEqual([...fc.amb], ['deperissement'], 'ambigus : cartes différentes, même nom ; même carte listée deux fois ou même recto : pas ambigu (clé de collection = recto)');
  const a = C.matchFr([{ text: 'Dépérissement' }], fc); assert.equal(a.amb, true); assert.ok(a.score <= 0.83, 'plafonné sous le seuil « sûr » (0,84)'); assert.equal(a.name, 'Sicken', 'la 1re est proposée');
  const s = C.matchFr([{ text: 'Anneau solaire' }], fc); assert.equal(s.amb, undefined); assert.equal(s.score, 1);
});
test('frNames / frCatalog.fr : nom anglais (clé de collection) → nom imprimé français, face avant seulement', () => {
  const rows = FR_ROWS.concat(['Collision // Colosse\tCollision // Colossus\t', 'pas de tabulation', '\tsans nom', 'Éclair bis\tLightning Bolt\t']);
  const m = C.frNames(rows), fc = C.frCatalog(rows);
  assert.equal(m.get(C.ownKey('Sol Ring')), 'Anneau solaire'); assert.equal(m.get('lightning bolt'), 'Éclair', 'le premier nom imprimé est gardé');
  assert.equal(m.get(C.ownKey('Collision // Colossus')), 'Collision', 'carte double : face avant'); assert.equal(m.get('collision'), 'Collision');
  assert.equal(m.get('inconnu'), undefined); assert.equal(C.frNames(null).size, 0, 'pas de lignes : carte vide');
  assert.deepEqual([...m], [...fc.fr], 'même résultat que le catalogue complet (sans l\'index flou)'); assert.equal(C.frFront('A // B'), 'A'); assert.equal(C.frFront('Sans face'), 'Sans face');
});
test('byName / filterItems : une carte FR se trie et se cherche par son nom affiché (français), l\'anglais reste trouvable', () => {
  const items = [{ k: 'sol ring', n: 'Sol Ring', dn: 'Anneau solaire' }, { k: 'arcane signet', n: 'Arcane Signet' }, { k: 'counterspell', n: 'Counterspell', dn: 'Contresort' }, { k: 'wrath of god', n: 'Wrath of God' }];
  assert.deepEqual(items.slice().reverse().sort(C.byName).map(i => i.dn || i.n), ['Anneau solaire', 'Arcane Signet', 'Contresort', 'Wrath of God']);
  const q = t => C.filterItems(items, { q: t, colors: new Set() }).map(i => i.k);
  assert.deepEqual(q('anneau'), ['sol ring'], 'recherche par le nom français'); assert.deepEqual(q('sol ring'), ['sol ring'], 'et par le nom anglais'); assert.deepEqual(q('contre'), ['counterspell']); assert.deepEqual(q('Arcane'), ['arcane signet']);
});
test('NAME_CMP : même ordre que localeCompare(…, \'fr\', base), en français comme en anglais', () => {
  const names = ['Æther Vial', 'aether vial', 'Élan', 'elan', 'Éclair', 'Eclair', 'Zap', 'zap', 'Ça', 'Ca', 'Lim-Dûl\'s Vault', 'Lim-Dul\'s Vault', 'Fire // Ice', 'Fire', '_Rare', '1996 World Champion', 'Ponder', 'Pondre', 'Œil', 'Oeil', 'Ætherize', 'Arcane Signet', 'arcane signet', 'Jötun Grunt', 'Jotun Grunt', '', 'Ñ', 'N'];
  const ref = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }), sgn = x => Math.sign(x);
  for (const lang of ['fr', 'en', 'de']) {
    C.I18N.lang = lang;
    for (const a of names) for (const b of names) assert.equal(sgn(C.NAME_CMP(a, b)), sgn(ref(a, b)), `${lang} : ${a} / ${b}`);
    assert.deepEqual(names.slice().sort(C.NAME_CMP), names.slice().sort(ref), lang + ' : même tri');
  }
  C.I18N.lang = 'fr';
});
test('noms français bruités par l\'OCR : retrouvés, jamais une mauvaise carte', () => {
  const fc = C.frCatalog(FR_ROWS), en = C.nameIndex(FR_ROWS.map(r => r.split('\t')[1]));
  const noise = [s => s.slice(0, -1), s => s.slice(1), s => s.replace(/e/, 'c'), s => s.replace(/i/, 'l'), s => s.replace(/o/, '0'), s => s.toUpperCase(), s => s + ' |', s => s.replace(/ /, ''), s => s.replace(/é/g, 'e'), s => s.replace(/a/, 'o')];
  let tot = 0, ok = 0, wrong = 0, enOk = 0;
  for (const r of FR_ROWS) {
    const [fr, name] = r.split('\t');
    for (const f of noise) {
      const raw = f(fr); tot++;
      const m = C.matchFr([{ text: raw }], fc); if (m && m.score >= 0.72) { if (m.name === name) ok++; else wrong++; }
      const e = C.bestMatch([{ text: raw }], en); if (e && e.score >= 0.72 && e.name === name) enOk++;
    }
  }
  assert.equal(wrong, 0, 'aucune confusion entre cartes'); assert.ok(ok / tot >= 0.9, `${ok}/${tot} retrouvés en français`); assert.ok(ok > enOk, 'le catalogue français bat la lecture anglaise sur du texte français (' + ok + ' vs ' + enOk + ')');
});

test('gen-fr-names.mjs : la ligne générée est identique à frRow() de l\'app (data.js)', async () => {
  const { readFileSync } = await import('node:fs'), src = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8');
  const imgOf = /^const imgOf = .*;$/m.exec(src)[0], fn = /^function frRow\(c, sl = 'fr'\) \{[\s\S]*?^\}/m.exec(src)[0];
  const appRow = new Function(imgOf + '\n' + fn + '\nreturn frRow;')(), { frRow, namesRow } = await import('../gen-fr-names.mjs');
  const cards = [
    { lang: 'fr', name: 'Sol Ring', printed_name: 'Anneau solaire', image_uris: { small: 'https://cards.scryfall.io/small/front/a/b/ab.jpg?1700' } },
    { lang: 'fr', name: 'Delver of Secrets // Insectile Aberration', card_faces: [{ name: 'Delver of Secrets', printed_name: 'Explorateur de secrets', image_uris: { small: 'https://cards.scryfall.io/small/front/c/d/cd.jpg?1' } }, { name: 'Insectile Aberration', printed_name: 'Aberration insectoïde' }] },
    { lang: 'fr', name: 'Edgar Markov', printed_name: 'Edgar Markov' }, { lang: 'en', name: 'Sol Ring', printed_name: 'Sol Ring' }, { lang: 'fr', name: 'Sans nom imprimé' }, { name: 'Sol Ring', printed_name: 'Anneau solaire', image_uris: { small: 'https://x/small/p.jpg' } }, null,
  ];
  for (const c of cards) assert.equal(frRow(c), appRow(c), JSON.stringify(c));
  for (const c of [...cards, { lang: 'de', name: 'Lightning Bolt', printed_name: 'Blitzschlag', image_uris: { small: 'https://cards.scryfall.io/small/front/e/f/ef.jpg?2' } }]) assert.equal(namesRow(c, 'de'), appRow(c, 'de'), 'allemand : ' + JSON.stringify(c));      // même ligne pour les autres langues (names-de.tsv)
  assert.equal(frRow(cards[0]), 'Anneau solaire\tSol Ring\tfront/a/b/ab.jpg'); assert.equal(frRow(cards[1]), 'Explorateur de secrets // Aberration insectoïde\tDelver of Secrets // Insectile Aberration\tfront/c/d/cd.jpg'); assert.equal(frRow(cards[3]), ''); assert.equal(frRow(null), '');
});

/* ── Commander : éligibilité, fichier EDHREC, decks à compléter ───────────────────────────────── */
test('canBeCommander : légendaire créature, véhicule/vaisseau avec F/E, texte « can be your commander », double faces, légalité', () => {
  const T = (type_line, extra = {}) => ({ type_line, legalities: { commander: 'legal' }, ...extra });
  assert.equal(C.canBeCommander(T('Legendary Creature — Vampire')), 1);
  assert.equal(C.canBeCommander(T('Creature — Elf')), 0);
  assert.equal(C.canBeCommander(T('Legendary Artifact')), 0);
  assert.equal(C.canBeCommander(T('Legendary Planeswalker — Teferi', { oracle_text: 'Teferi can be your commander.' })), 1);
  assert.equal(C.canBeCommander(T('Legendary Artifact — Vehicle', { power: '3', toughness: '3' })), 1, 'véhicule légendaire avec F/E');
  assert.equal(C.canBeCommander(T('Legendary Artifact — Vehicle')), 0, 'sans F/E : non');
  assert.equal(C.canBeCommander(T('Legendary Artifact — Spacecraft', { power: '2', toughness: '5' })), 1);
  assert.equal(C.canBeCommander(T('Legendary Creature — Angel', { legalities: { commander: 'banned' } })), 0, 'bannie');
  assert.equal(C.canBeCommander(T('Legendary Creature — Angel', { legalities: { commander: 'not_legal' } })), 0);
  const dfc = (a, b, layout) => ({ layout, legalities: { commander: 'legal' }, type_line: a + ' // ' + b, card_faces: [{ type_line: a }, { type_line: b }] });
  assert.equal(C.canBeCommander(dfc('Legendary Creature — Human', 'Legendary Creature — Werewolf', 'transform')), 1);
  assert.equal(C.canBeCommander(dfc('Creature — Human', 'Legendary Creature — Werewolf', 'transform')), 0, 'transformation : face avant seulement');
  assert.equal(C.canBeCommander(dfc('Legendary Enchantment', 'Legendary Creature — God', 'modal_dfc')), 1, 'double face modale : l\'une ou l\'autre');
  assert.equal(C.canBeCommander(null), 0); assert.equal(C.canBeCommander({}), 0);
  assert.equal(C.isCmdrType('Legendary Creature — Elf'), true); assert.equal(C.isCmdrType('Legendary Artifact'), false); assert.equal(C.isCmdrType(undefined), false);
});

const EDH_TXT = [
  '#edh\t1\t2026-10-05T04:00:00Z',
  'C\tedgar-markov\t12345\tWBR\tEdgar Markov', 'I\tedgar-markov\tfront/a/b/edgar.jpg',
  'C\ttymna-thrasios\t4000\tWUBG\tTymna the Weaver\tThrasios, Triton Hero',
  'C\tcraterhoof\t100\tG\tCraterhoof Behemoth',
  'D\tedgar-markov\tedhrec\tDeck moyen\thttps://edhrec.com/average-decks/edgar-markov',
  'K\t1\tSol Ring', 'K\t1\tArcane Signet', 'K\t1\tCommand Tower', 'K\t1\tFire // Ice', 'K\t10\tPlains', 'K\t2\tRelentless Rats',
  ...Array.from({ length: 20 }, (_, i) => `K\t1\tFiller ${i}`),
  'D\ttymna-thrasios\tedhrec\tDeck moyen\tjavascript:alert(1)',
  'K\t1\tSol Ring', ...Array.from({ length: 25 }, (_, i) => `K\t1\tFiller ${i}`),
  'D\tcraterhoof\tarchidekt\tUn deck\thttps://archidekt.com/decks/1', 'K\t1\tSol Ring',
  'D\tinconnu\tedhrec\t\t', 'K\t1\tNe doit pas compter',
  'P\t150\tSol Ring', 'P\t40\tArcane Signet', 'P\t100\tFiller 0', 'P\t200\tFire // Ice', 'P\t0\tFiller 1', 'P\tabc\tFiller 2',
  'G\tSol Ring', 'G\tFire // Ice', 'G\tTymna the Weaver', 'G\t',
].join('\n');
test('parseEdh : commandants, paires, images, decks, prix ; lignes invalides ignorées', () => {
  const d = C.parseEdh(EDH_TXT);
  assert.equal(d.v, 1); assert.equal(d.at, '2026-10-05T04:00:00Z'); assert.equal(d.cmds.length, 3);
  assert.deepEqual(d.cmds[1].keys, ['tymna the weaver', 'thrasios triton hero']); assert.equal(d.cmds[1].ci, 'WUBG'); assert.equal(d.cmds[0].decks, 12345);
  assert.equal(d.cmds[0].img, 'https://cards.scryfall.io/small/front/a/b/edgar.jpg'); assert.equal(d.cmds[1].img, '');
  assert.equal(d.by.get('thrasios triton hero').slug, 'tymna-thrasios', 'chaque membre d\'une paire retrouve le commandant');
  assert.equal(d.decks.length, 3, 'deck d\'un commandant inconnu ignoré'); assert.equal(d.decks[0].cards.length, 6 + 20);
  assert.equal(d.decks[0].url, 'https://edhrec.com/average-decks/edgar-markov'); assert.equal(d.decks[1].url, '', 'lien non https ignoré'); assert.equal(d.decks[2].src, 'archidekt');
  assert.deepEqual(d.decks[0].cards[3], ['fire', 'Fire // Ice', 1], 'clé = première face'); assert.deepEqual(d.decks[0].cards[5], ['relentless rats', 'Relentless Rats', 2]);
  assert.equal(d.price.get('sol ring'), 150); assert.equal(d.price.get('fire'), 200); assert.ok(!d.price.has('filler 1') && !d.price.has('filler 2'), 'prix nul ou illisible ignoré');
  assert.equal(C.parseEdh('').cmds.length, 0); assert.equal(C.parseEdh('n\'importe quoi\nC\tx').cmds.length, 0); assert.equal(C.parseEdh(null).v, 0);
});
test('edhRank : possédées / manquantes / coût, basics ignorés, filtres et tris', () => {
  const d = C.parseEdh(EDH_TXT), own = { 'edgar markov': 1, 'sol ring': 1, 'arcane signet': 2, 'fire': 1, 'filler 0': 1, 'plains': 5 }, qty = k => own[k] || 0;
  const rows = C.edhRank(d, qty, { sort: 'miss' }), by = Object.fromEntries(rows.map(r => [r.cmd.slug, r]));
  // deck Edgar : Edgar + Sol Ring, Arcane Signet, Command Tower, Fire // Ice, 2 Relentless Rats, 20 fillers (Plains ignoré) = 1 + 4 + 2 + 20 = 27
  const e = by['edgar-markov']; assert.equal(e.total, 27); assert.equal(e.have, 1 + 1 + 1 + 1 + 1, 'Edgar, Sol Ring, Arcane Signet, Fire // Ice, Filler 0'); assert.equal(e.miss, 22);
  assert.equal(e.mine, true); assert.equal(e.owned.length, 5);
  assert.equal(e.cost, 2 * 0, 'Command Tower, Rats et 19 fillers sans prix : rien dans le coût'); assert.equal(e.unpriced, 1 + 2 + 19);
  assert.equal(e.missing.length, 1 + 1 + 19); assert.equal(e.missing.find(x => x.k === 'relentless rats').q, 2);
  // deck Tymna + Thrasios : 2 commandants + Sol Ring + 25 fillers = 28 ; Sol Ring + Filler 0 possédés
  const t = by['tymna-thrasios']; assert.equal(t.total, 28); assert.equal(t.have, 2); assert.equal(t.mine, false);
  // exemplaires possédés mais déjà réservés par des decks montés (held) : comptés à part, `have` ne change pas
  assert.equal(e.eng, 0, 'sans held : rien d\'engagé');
  const hd = { 'sol ring': 1, 'arcane signet': 1, 'fire': 2, 'edgar markov': 1 }, rh = C.edhRank(d, qty, { sort: 'miss', held: k => hd[k] || 0 }), byh = Object.fromEntries(rh.map(r => [r.cmd.slug, r]));
  assert.equal(byh['edgar-markov'].have, 5); assert.equal(byh['edgar-markov'].eng, 3, 'commandant + Sol Ring + Fire // Ice ; Arcane Signet : 2 possédées, 1 réservée, 1 libre → pas engagée');
  assert.deepEqual(byh['edgar-markov'].owned.filter(x => x.eg).map(x => [x.k, x.eg]).sort(), [['edgar markov', 1], ['fire', 1], ['sol ring', 1]], 'détail par carte (eg)');
  assert.equal(byh['tymna-thrasios'].eng, 1, 'Sol Ring seulement'); assert.equal(byh['tymna-thrasios'].have, 2);
  assert.equal(C.edhRank(d, qty, { sort: 'miss', held: k => 99 }).find(r => r.cmd.slug === 'edgar-markov').eng, 5, 'tout réservé : toutes les possédées sont engagées, jamais plus');
  assert.deepEqual(rows.map(r => r.cmd.slug), ['edgar-markov', 'tymna-thrasios'], 'tri : moins de cartes manquantes d\'abord (22 contre 26) ; craterhoof : 1 carte seulement (< 20) → ignoré');
  // coût avec prix
  const pr = C.edhRank(d, k => 0, { sort: 'cost' }), e2 = pr.find(r => r.cmd.slug === 'edgar-markov'); assert.equal(e2.cost, 150 + 40 + 200 + 100, 'Sol Ring + Arcane Signet + Fire // Ice + Filler 0'); assert.equal(e2.missing[0].n, 'Fire // Ice', 'les plus chères d\'abord');
  // filtres
  assert.deepEqual(C.edhRank(d, qty, { mine: true }).map(r => r.cmd.slug), ['edgar-markov'], 'je possède le commandant');
  assert.deepEqual(C.edhRank(d, qty, { cols: new Set(['W', 'B', 'R']) }).map(r => r.cmd.slug), ['edgar-markov'], 'identité WBR tient dans le choix ; WUBG non');
  assert.deepEqual(C.edhRank(d, qty, { cols: new Set(['W', 'U', 'B', 'G']) }).map(r => r.cmd.slug).sort(), ['tymna-thrasios']);
  assert.deepEqual(C.edhRank(d, k => 0, { budget: 200 }).map(r => r.cmd.slug), [], 'budget ≤ 2 € : Tymna en coûte 2,50 €, Edgar 4,90 €');
  assert.deepEqual(C.edhRank(d, k => 0, { budget: 300 }).map(r => r.cmd.slug), ['tymna-thrasios']);
  assert.deepEqual(C.edhRank(d, k => 0, { budget: 500 }).map(r => r.cmd.slug).sort(), ['edgar-markov', 'tymna-thrasios']);
  assert.deepEqual(C.edhRank(d, qty, { sort: 'pop' }).map(r => r.cmd.slug), ['edgar-markov', 'tymna-thrasios'], 'populaires : plus de decks d\'abord');
  { const e = d.bySlug.get('edgar-markov'), t = d.bySlug.get('tymna-thrasios'), r0 = [e.rank, t.rank]; e.rank = 2; t.rank = 1;
    assert.deepEqual(C.edhRank(d, qty, { sort: 'pop' }).map(r => r.cmd.slug), ['tymna-thrasios', 'edgar-markov'], 'meilleur tier : suit le rang (celui du mois), pas le total de decks'); [e.rank, t.rank] = r0; }
  assert.equal(C.edhRank(null, qty).length, 0);
});
test('edhRank : recherche par commandant (mots, accents, paires) ou par carte (hors terrains de base)', () => {
  const d = C.parseEdh(EDH_TXT), qty = k => 0, slugs = o => C.edhRank(d, qty, o).map(r => r.cmd.slug);
  assert.deepEqual(C.edhTokens('  Thrasios,  TRITON héro '), ['thrasios', 'triton', 'hero'], 'accents, ponctuation, casse');
  assert.deepEqual(C.edhTokens('Fire // Ice'), ['fire', 'ice']); assert.deepEqual(C.edhTokens('!!'), []);
  assert.deepEqual(slugs({ q: 'edgar' }).sort(), slugs({ q: 'EDGAR markov' }).sort()); assert.ok(slugs({ q: 'edgar' }).every(x => x === 'edgar-markov') && slugs({ q: 'edgar' }).length >= 1, 'tous les decks d\'Edgar, pas les autres');
  assert.deepEqual(slugs({ q: 'tymna' }), ['tymna-thrasios']); assert.deepEqual(slugs({ q: 'thrasios' }), ['tymna-thrasios'], 'l\'autre membre de la paire');
  assert.deepEqual(slugs({ q: 'tymna thrasios' }), ['tymna-thrasios'], 'mots répartis sur les deux noms'); assert.deepEqual(slugs({ q: 'eDgAr', qm: 'cmd', tiers: new Set(['D']) }), [], 'combiné aux filtres');
  assert.deepEqual(slugs({ q: 'zzz' }), []); assert.equal(slugs({ q: '!!' }).length, slugs({}).length, 'recherche vide de sens = pas de filtre');
  assert.ok(C.edhRank(d, qty, { q: 'edgar' }).every(r => r.hit === null), 'recherche commandant : pas de hit');
  const rs = C.edhRank(d, qty, { q: 'sol ring', qm: 'card' }); assert.ok(rs.length >= 2 && rs.every(r => r.hit.length === 1 && r.hit[0][0] === 'sol ring' && r.hit[0][1] === 'Sol Ring'), 'decks contenant Sol Ring');
  assert.deepEqual(C.edhRank(d, qty, { q: 'rats', qm: 'card' }).map(r => [r.cmd.slug, r.hit[0][1]]).slice(0, 1), [['edgar-markov', 'Relentless Rats']], 'sous-chaîne de nom');
  assert.deepEqual(C.edhRank(d, qty, { q: 'ice', qm: 'card' }).map(r => r.hit[0]).slice(0, 1), [['fire', 'Fire // Ice']], 'carte à deux faces : on trouve aussi par la 2e face');
  assert.deepEqual(C.edhRank(d, qty, { q: 'ol ring', qm: 'card' }), [], 'chaque mot doit commencer un mot du nom (pas de milieu de mot)'); assert.ok(C.edhRank(d, qty, { q: 'rin sol', qm: 'card' }).length >= 2, 'début de mot, ordre libre');
  assert.deepEqual(C.edhRank(d, qty, { q: 'plains', qm: 'card' }), [], 'terrains de base exclus de la recherche');
});
const EB = require('../src/edhbin.js');
test('edhPack / edhUnpack : dictionnaire, doublons et commandant retirés, nom complet des cartes à deux faces, prix, Game Changers, liens', () => {
  const m = { v: 1, at: 'T', cmds: [{ slug: 'a', decks: 5, ci: 'WB', names: ['Alpha One'], img: 'f/a.jpg' }, { slug: 'b', decks: 3, ci: 'G', names: ['Bee', 'Cee, Two'], img: '' }],
    decks: [{ slug: 'a', src: 'edhrec', label: 'Deck moyen', url: 'https://edhrec.com/average-decks/a', cards: [['Sol Ring', 1], ['Alpha One', 1], ['Fire', 2], ['Sol Ring', 3], ['Plains', 8], ['Fire // Ice', 1]] },
      { slug: 'b', src: 'archidekt', label: 'x', url: 'https://archidekt.com/decks/77', cards: [['Fire // Ice', 1], ['Zed', 1], ['Bee', 1]] }, { slug: 'a', src: 'edhrec', label: '', url: '', cards: [['Zed', 4]] }, { slug: 'inconnu', src: 'edhrec', cards: [['X', 1]] }],
    price: new Map([['Sol Ring', 150], ['Fire // Ice', 200], ['Absent', 5], ['Zed', 0]]), gc: ['Sol Ring', 'Gamma'] };
  const bin = EB.edhPack(m, C.ownKey), r = EB.edhUnpack(bin);
  assert.deepEqual(r.cmds.map(c => [c.slug, c.decks, c.ci, c.names, c.img]), [['a', 5, 'WB', ['Alpha One'], 'f/a.jpg'], ['b', 3, 'G', ['Bee', 'Cee, Two'], '']]);
  assert.equal(r.dk.length, 3, 'deck d\'un commandant inconnu ignoré'); assert.deepEqual(r.dk.map(d => [d[0], d[1], d[2], d[3]]), [[0, 'edhrec', 'Deck moyen', 0], [1, 'archidekt', 'x', 77], [0, 'edhrec', '', '']], 'liens : deck moyen = 0, Archidekt = numéro, aucun = vide');
  assert.deepEqual([...r.off], [0, 3, 5, 6]); assert.deepEqual([...r.ids].map(i => r.names[i]), ['Sol Ring', 'Fire // Ice', 'Plains', 'Fire // Ice', 'Zed', 'Zed'], 'doublon (Sol Ring ×3, Fire / Fire // Ice) et commandant retirés ; la 1re ligne gagne ; une seule entrée « Fire // Ice » (nom complet)');
  assert.deepEqual([...r.qty], [1, 2, 8, 1, 1, 4]); assert.equal(r.pr[r.names.indexOf('Sol Ring')], 150); assert.equal(r.pr[r.names.indexOf('Fire // Ice')], 200); assert.equal(r.pr[r.names.indexOf('Zed')], 0, 'prix nul ignoré'); assert.ok(!r.names.includes('Absent'));
  assert.deepEqual([...r.gc].map(i => r.names[i]), ['Sol Ring', 'Gamma'], 'une Game Changers hors des decks entre quand même dans le dictionnaire');
  assert.equal(r.v, 1); assert.equal(r.at, 'T');
  for (const cut of [0, 5, 11, bin.length - 4, bin.length - 1]) assert.throws(() => EB.edhUnpack(bin.slice(0, cut)), /format|tronqu|noms|decks/, 'fichier tronqué à ' + cut);
  assert.throws(() => EB.edhUnpack(new Uint8Array(40)), /format/); assert.equal(EB.edhUnpack(EB.edhPack({ v: 0, at: '', cmds: [], decks: [], price: [], gc: [] }, C.ownKey)).names.length, 0, 'fichier vide valide');
  const off4 = new Uint8Array(bin.length + 3); off4.set(bin, 3); assert.equal(EB.edhUnpack(off4.subarray(3)).names.length, r.names.length, 'tampon non aligné : copie');
});
test('parseEdhBin = parseEdh : index identique (commandants, rangs, prix, Game Changers, cartes des decks, liens)', () => {
  const t = C.parseEdh(EDH_TXT), bin = EB.edhPack(C.edhModelFromTsv(EDH_TXT), C.ownKey), b = C.parseEdhBin(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  assert.deepEqual(b.cmds.map(c => [c.slug, c.rank, c.tier, c.keys, c.img]), t.cmds.map(c => [c.slug, c.rank, c.tier, c.keys, c.img])); assert.deepEqual([...b.price], [...t.price]); assert.deepEqual([...b.gc], [...t.gc]);
  assert.deepEqual(b.decks.map(d => [d.slug, d.src, d.label, d.url, d.cards]), t.decks.map(d => [d.slug, d.src, d.label, d.url, d.cards]));
  assert.equal(b.decks[0].url, 'https://edhrec.com/average-decks/edgar-markov'); assert.equal(b.decks[1].url, '', 'lien non https ignoré'); assert.equal(b.decks[2].url, 'https://archidekt.com/decks/1');
  assert.equal(b.by.get('thrasios triton hero').slug, 'tymna-thrasios'); assert.equal(C.cmdrClass({ k: 'edgar markov' }, b).ed, 12345);
  assert.throws(() => C.parseEdhBin(new Uint8Array(10).buffer));
});
const TH_FILL = n => Array.from({ length: n }, (_, i) => ['Filler ' + i, 1]);
const TH_MODEL = { v: 1, at: 'T', cmds: [
  { slug: 'a', decks: 100, ci: 'W', names: ['Alpha'], img: '', themes: [['control', 'Control', 40], ['lifegain', 'Lifegain', 25]] },
  { slug: 'b', decks: 80, ci: 'B', names: ['Bee'], img: '', themes: [['lifegain', 'Lifegain', 30], ['mill', 'Mill', 10], ['nul', 'Nul', 0], ['', 'Vide', 5]] },
  { slug: 'c', decks: 50, ci: 'G', names: ['Cee'], img: '' }],
  decks: [{ slug: 'a', src: 'edhrec', label: 'Deck moyen', url: 'https://edhrec.com/average-decks/a', cards: TH_FILL(40) }, { slug: 'a', src: 'archidekt', label: 'x', url: 'https://archidekt.com/decks/5', cards: TH_FILL(30) },
    { slug: 'b', src: 'edhrec', label: '', url: '', cards: TH_FILL(30) }, { slug: 'c', src: 'edhrec', label: '', url: '', cards: TH_FILL(30) }], price: [], gc: [] };
test('thèmes EDHREC : dictionnaire partagé (en-tête), thèmes par commandant, invalides écartés, fichier sans thèmes toujours lisible', () => {
  const bin = EB.edhPack(TH_MODEL, C.ownKey), raw = EB.edhUnpack(bin);
  assert.deepEqual(raw.themes, [['control', 'Control'], ['lifegain', 'Lifegain'], ['mill', 'Mill']], 'un seul dictionnaire ; nombre nul et identifiant vide écartés');
  assert.deepEqual(raw.cmds.map(c => c.th), [[[0, 40], [1, 25]], [[1, 30], [2, 10]], []]);
  const d = C.parseEdhBin(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  assert.deepEqual(d.themes.map(t => [t.slug, t.label, t.cmds, t.decks]), [['control', 'Control', 1, 2], ['lifegain', 'Lifegain', 2, 3], ['mill', 'Mill', 1, 1]], 'commandants et decks par thème (les decks Archidekt héritent du commandant)');
  assert.deepEqual(d.themeOrder, [1, 0, 2], 'du plus au moins présent'); assert.equal(d.themeIx.get('mill'), 2);
  assert.deepEqual(d.cmds[1].th, [[1, 30], [2, 10]]); assert.deepEqual(d.cmds[2].th, []); assert.ok(d.cmds[1].thSet.has(2) && !d.cmds[1].thSet.has(0));
  assert.deepEqual(d.decks.map(x => x.cmd.th.length), [2, 2, 2, 0]);
  const slugs = (o) => C.edhRank(d, () => 0, o).map(r => r.cmd.slug + ':' + r.deck.src).sort();
  assert.deepEqual(slugs({ sort: 'pop' }), ['a:archidekt', 'a:edhrec', 'b:edhrec', 'c:edhrec'], 'sans thème : tous');
  assert.deepEqual(slugs({ sort: 'pop', themes: new Set(['lifegain']) }), ['a:archidekt', 'a:edhrec', 'b:edhrec'], 'un thème : tous les decks du commandant, Archidekt compris');
  assert.deepEqual(slugs({ sort: 'pop', themes: new Set(['lifegain', 'control']) }), ['a:archidekt', 'a:edhrec'], 'plusieurs thèmes : le commandant les a tous (ET)');
  assert.deepEqual(slugs({ themes: new Set(['mill', 'control']) }), [], 'aucun commandant n\'a les deux');
  assert.deepEqual(slugs({ themes: new Set(['inconnu']) }), [], 'thème absent du fichier : aucun deck');
  assert.deepEqual(slugs({ sort: 'pop', themes: new Set(['lifegain']), cols: new Set(['W']) }), ['a:archidekt', 'a:edhrec'], 'se combine aux autres filtres');
  assert.deepEqual(slugs({ sort: 'pop', themes: new Set() }).length, 4, 'ensemble vide = pas de filtre');
  const old = C.parseEdh(EDH_TXT); assert.deepEqual(old.themes, []); assert.deepEqual(old.themeOrder, []); assert.deepEqual(old.cmds.map(c => c.th), [[], [], []]);
  assert.equal(C.edhRank(old, () => 0, { themes: new Set(['control']) }).length, 0, 'fichier sans thèmes + thème demandé : aucun deck (l\'appli retire ces thèmes de la sélection)');
  const nt = EB.edhUnpack(EB.edhPack({ ...TH_MODEL, cmds: TH_MODEL.cmds.map(c => ({ ...c, themes: undefined })) }, C.ownKey)); assert.deepEqual(nt.themes, []);
  const head = JSON.parse(new TextDecoder().decode(EB.edhPack({ ...TH_MODEL, cmds: TH_MODEL.cmds.map(c => ({ ...c, themes: [] })) }, C.ownKey).subarray(8, 8 + 200)).replace(/\}[^}]*$/, '}')); assert.ok(!('tl' in head), 'pas de dictionnaire quand il n\'y a aucun thème');
});
test('thèmes EDHREC : compteurs et ordre selon les decks restants (couleurs, thèmes déjà choisis), sélectionnés en tête à égalité, zéros en dernier', () => {
  const bin = EB.edhPack(TH_MODEL, C.ownKey), d = C.parseEdhBin(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)), qty = () => 0;
  const view = o => { const rows = C.edhRank(d, qty, o), counts = C.edhThemeCounts(d, rows); return { n: rows.length, counts, order: C.edhThemeOrder(d, counts, o.themes) }; };
  const ix = s => d.themeIx.get(s), lg = ix('lifegain'), ct = ix('control'), mi = ix('mill');
  let v = view({}); assert.equal(v.n, 4); assert.equal(v.counts[ct], 2, 'a : 2 decks (EDHREC + Archidekt)'); assert.equal(v.counts[lg], 3); assert.equal(v.counts[mi], 1); assert.deepEqual(v.order, [lg, ct, mi]);
  v = view({ cols: new Set(['W']) }); assert.equal(v.n, 2); assert.deepEqual([v.counts[ct], v.counts[lg], v.counts[mi]], [2, 2, 0], 'mono blanc : seuls les decks du commandant blanc comptent'); assert.deepEqual(v.order, [lg, ct, mi], 'égalité : le plus présent dans tout le fichier d\'abord ; zéro en dernier');
  v = view({ cols: new Set(['B']) }); assert.deepEqual([v.counts[ct], v.counts[lg], v.counts[mi]], [0, 1, 1]); assert.deepEqual(v.order, [lg, mi, ct]);
  v = view({ themes: new Set(['mill']) }); assert.equal(v.n, 1); assert.deepEqual([v.counts[ct], v.counts[lg], v.counts[mi]], [0, 1, 1], 'thème choisi : compté parmi les decks qui le portent'); assert.deepEqual(v.order, [mi, lg, ct], 'à égalité, le thème choisi passe devant');
  v = view({ themes: new Set(['lifegain']) }); assert.equal(v.counts[lg], v.n, 'un thème choisi vaut le nombre de decks restants'); assert.deepEqual(v.order, [lg, ct, mi]);
  v = view({ themes: new Set(['mill', 'control']) }); assert.equal(v.n, 0); assert.deepEqual(v.counts, [0, 0, 0], 'aucun deck : tout à zéro');
  assert.deepEqual(C.edhThemeCounts(C.parseEdh(EDH_TXT), C.edhRank(C.parseEdh(EDH_TXT), qty, {})), [], 'fichier sans thèmes');
});
test('edhRank : listes à la demande (missing / owned / gc) identiques à l\'ancien calcul, rangs recalculés à chaque appel', () => {
  const d = C.parseEdh(EDH_TXT), own = { 'edgar markov': 1, 'sol ring': 1, 'fire': 1 }, qty = k => own[k] || 0, rows = C.edhRank(d, qty, { sort: 'miss' }), e = rows.find(r => r.cmd.slug === 'edgar-markov');
  assert.ok(Object.getOwnPropertyDescriptor(e, 'missing') === undefined, 'pas calculées avant le premier accès'); assert.deepEqual(e.owned.map(x => x.n), ['Edgar Markov', 'Sol Ring', 'Fire // Ice'], 'commandant d\'abord, puis l\'ordre du deck'); assert.ok(Object.getOwnPropertyDescriptor(e, 'missing') !== undefined, 'gardées après le calcul');
  assert.deepEqual(e.gc, ['Sol Ring', 'Fire // Ice'], 'Game Changers du deck, dans l\'ordre ; Tymna n\'est pas dans ce deck'); assert.equal(e.br, 3, '2 Game Changers → bracket 3');
  assert.equal(e.missing.find(x => x.k === 'relentless rats').q, 2); assert.equal(e.missing[0].u, 100, 'les plus chères d\'abord'); assert.ok(e.missing.every(x => x.q > 0));
  own['arcane signet'] = 1; const again = C.edhRank(d, qty, { sort: 'miss' }).find(r => r.cmd.slug === 'edgar-markov'); assert.equal(again.have, e.have + 1, 'la collection est relue à chaque appel');
  assert.deepEqual(C.edhRank(d, qty, { cols: new Set(['G']) }).map(r => r.cmd.slug), [], 'identité WBR ⊄ G ; craterhoof : 1 carte seulement');
});
test('tiers (popularité), bracket estimé (Game Changers), tri « plus possédées »', () => {
  assert.deepEqual([1, 30, 31, 150, 151, 500, 501, 1500, 1501, 99999].map(C.edhTier), ['S', 'S', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D']);
  assert.deepEqual([0, 1, 3, 4, 9].map(C.edhBracket), [2, 3, 3, 4, 4], '0 Game Changer → 2 · 1 à 3 → 3 · 4 et plus → 4');
  const d = C.parseEdh(EDH_TXT); assert.deepEqual(d.cmds.map(c => [c.rank, c.tier]), [[1, 'S'], [2, 'S'], [3, 'S']], 'rang = ordre par nombre de decks (12 345 · 4 000 · 100)');
  assert.deepEqual([...d.gc].sort(), ['fire', 'sol ring', 'tymna the weaver'], 'Game Changers : clé = première face, ligne vide ignorée');
  const own = { 'edgar markov': 1, 'sol ring': 1 }, rows = C.edhRank(d, k => own[k] || 0, { sort: 'have' }), by = Object.fromEntries(rows.map(r => [r.cmd.slug, r]));
  assert.deepEqual(by['edgar-markov'].gc, ['Sol Ring', 'Fire // Ice']); assert.equal(by['edgar-markov'].br, 3); assert.equal(by['tymna-thrasios'].br, 3, 'le commandant compte : Tymna + Sol Ring');
  assert.deepEqual(by['tymna-thrasios'].gc, ['Tymna the Weaver', 'Sol Ring']); assert.equal(by['edgar-markov'].tier, 'S'); assert.equal(by['edgar-markov'].rank, 1);
  assert.equal(by['edgar-markov'].missing.find(x => x.k === 'fire').gc, true); assert.equal(by['edgar-markov'].owned.find(x => x.k === 'sol ring').gc, true); assert.equal(by['edgar-markov'].missing.find(x => x.k === 'command tower').gc, false);
  const noGc = C.edhRank(C.parseEdh(EDH_TXT.replace(/\nG\t[^\n]*/g, '')), k => 0, {}); assert.ok(noGc.length && noGc.every(r => r.br === 0 && r.gc.length === 0), 'sans liste Game Changers : pas de bracket');
  // tri « plus possédées » : le deck dont on possède le plus de cartes, à égalité le moins de manquantes
  assert.deepEqual(C.edhRank(d, k => 3, { sort: 'have' }).map(r => r.cmd.slug), ['tymna-thrasios', 'edgar-markov'], 'Tymna : 28 possédées, Edgar : 27');
  assert.deepEqual(C.edhRank(d, k => 3, { sort: 'miss' }).map(r => r.cmd.slug), ['edgar-markov', 'tymna-thrasios'], 'à 0 manquante partout : départage par popularité');
  assert.deepEqual(C.edhRank(d, k => (k === 'tymna the weaver' || k === 'thrasios triton hero' ? 1 : 0), {}).map(r => r.cmd.slug), ['tymna-thrasios', 'edgar-markov'], 'tri par défaut = plus possédées (2 contre 0)');
  // deck faussé (cartes en trop) : ignoré
  const big = ['#edh\t1\t2026-10-05T00:00:00Z', 'C\tgros\t10\tG\tGros Commandant', 'D\tgros\tarchidekt\t\t']; for (let j = 0; j < 110; j++) big.push(`K\t1\tCarte ${j}`);
  assert.equal(C.edhRank(C.parseEdh(big.join('\n')), k => 0, {}).length, 0, '110 cartes : écarté'); assert.equal(C.edhRank(C.parseEdh(big.slice(0, 3 + 99).join('\n')), k => 0, {}).length, 1, '99 cartes + commandant : gardé');
  // filtre par tier : 40 commandants → 30 S puis 10 A
  const many = ['#edh\t1\t2026-10-05T00:00:00Z']; for (let i = 0; i < 40; i++) { many.push(`C\tcmd-${i}\t${1000 - i}\tG\tCommandant ${i}`, `D\tcmd-${i}\tedhrec\t\t`); for (let j = 0; j < 25; j++) many.push(`K\t1\tCarte ${j}`); }
  const md = C.parseEdh(many.join('\n')), tiers = r => new Set(r.map(x => x.tier));
  assert.equal(md.cmds[29].tier, 'S'); assert.equal(md.cmds[30].tier, 'A');
  const all = C.edhRank(md, k => 0, {}); assert.equal(all.length, 40);
  assert.deepEqual([...tiers(C.edhRank(md, k => 0, { tiers: new Set(['A']) }))], ['A']); assert.equal(C.edhRank(md, k => 0, { tiers: new Set(['A']) }).length, 10);
  assert.equal(C.edhRank(md, k => 0, { tiers: new Set(['S', 'A']) }).length, 40); assert.equal(C.edhRank(md, k => 0, { tiers: new Set(['B']) }).length, 0); assert.equal(C.edhRank(md, k => 0, { tiers: new Set() }).length, 40, 'aucun tier choisi = tous');
});
test('edhDeckText / cmdrClass / filtre Commander', () => {
  const d = C.parseEdh(EDH_TXT), txt = C.edhDeckText(d.decks[0]);
  assert.match(txt, /^Commander\n1 Edgar Markov\n\n1 Sol Ring\n/); assert.match(txt, /\n10 Plains\n/); assert.match(txt, /\n2 Relentless Rats\n/);
  const pd = C.parseDeck(txt); assert.equal(pd.basicCopies, 10); assert.ok(pd.cards.some(c => c.key === 'sol ring'));
  assert.deepEqual(C.commanderKeys(txt), ['edgar markov'], 'le commandant est reconnu par l\'en-tête');
  const tt = C.edhDeckText(d.decks[1]); assert.match(tt, /^Commander\n1 Tymna the Weaver\n1 Thrasios, Triton Hero\n\n/);
  assert.deepEqual(C.cmdrClass({ k: 'edgar markov', tl: 'Legendary Creature — Vampire' }, d), { cx: 2, ed: 12345 });
  assert.deepEqual(C.cmdrClass({ k: 'zzz', tl: 'Legendary Creature — Elf' }, d), { cx: 1, ed: 0 }, 'éligible mais pas dans EDHREC');
  assert.deepEqual(C.cmdrClass({ k: 'zzz', tl: 'Legendary Creature — Elf', cd: 0 }, null), { cx: 0, ed: 0 }, 'l\'info précise l\'emporte sur le type');
  assert.deepEqual(C.cmdrClass({ k: 'zzz', tl: 'Legendary Planeswalker', cd: 1 }, null), { cx: 1, ed: 0 });
  assert.deepEqual(C.cmdrClass({ k: 'zzz' }, null), { cx: 0, ed: 0 });
  const items = [{ k: 'a', n: 'A', cx: 2, tl: 'x' }, { k: 'b', n: 'B', cx: 1, tl: 'x' }, { k: 'c', n: 'C', cx: 0, tl: 'x' }, { k: 'd', n: 'D' }];
  assert.deepEqual(C.filterItems(items, { cmdr: 'can' }).map(i => i.k), ['a', 'b']); assert.deepEqual(C.filterItems(items, { cmdr: 'played' }).map(i => i.k), ['a']);
  assert.equal(C.filterItems(items, { cmdr: '' }).length, 4); assert.equal(C.filterActive({ q: '', colors: new Set(), type: '', cmc: '', cmdr: 'can' }), true); assert.equal(C.filterActive({ q: '', colors: new Set(), type: '', cmc: '', cmdr: '' }), false);
});

/* ── Valeur dans le temps : relevés, variations, baseline ─────────────────────────────────────── */
test('histPush : un relevé par jour, trié, borné', () => {
  const D = 86400000, t0 = new Date(2026, 8, 1, 12).getTime();
  let h = C.histPush([], { t: t0, v: 1000, n: 5, q: 9 });
  h = C.histPush(h, { t: t0 + 3600e3, v: 1100, n: 5, q: 9 }); assert.equal(h.length, 1, 'même jour : remplacé'); assert.equal(h[0].v, 1100);
  h = C.histPush(h, { t: t0 + 2 * D, v: 1300.4, n: 6, q: 10 }); h = C.histPush(h, { t: t0 + D, v: 1200, n: 6, q: 10 });
  assert.deepEqual(h.map(x => x.v), [1100, 1200, 1300], 'trié par date, centimes entiers');
  assert.equal(C.histPush(h, { t: t0 + 3 * D, v: 1, n: 0, q: 0 }, 3).length, 3, 'borné : les plus anciens partent'); assert.equal(C.histPush(h, { t: t0 + 3 * D, v: 1, n: 0, q: 0 }, 3)[0].v, 1200);
  assert.equal(C.histPush(null, { t: t0, v: 5, n: 1, q: 1 }).length, 1); assert.equal(C.histPush([{ t: 'x', v: 1 }, null], { t: t0, v: 5, n: 1, q: 1 }).length, 1, 'entrées illisibles ignorées');
});
test('histDelta : variation sur 7 / 30 jours, sinon null', () => {
  const D = 86400000, t0 = new Date(2026, 8, 1, 12).getTime(), h = [0, 1, 2, 7, 14, 20, 30].map((d, i) => ({ t: t0 + d * D, v: 1000 + i * 100, n: 1, q: 1 }));
  const w = C.histDelta(h, 7); assert.equal(w.from.v, 1500, 'relevé du jour 20 : le plus proche de 30 − 7 = 23 → jour 20'); assert.equal(w.d, 100); assert.equal(Math.round(w.pct * 10) / 10, 6.7);
  const m = C.histDelta(h, 30); assert.equal(m.from.v, 1000); assert.equal(m.d, 600);
  assert.equal(C.histDelta(h.slice(-2), 30), null, 'pas assez d\'historique'); assert.equal(C.histDelta([h[0]], 7), null); assert.equal(C.histDelta([], 7), null);
  assert.equal(C.histDelta([{ t: t0, v: 0, n: 0, q: 0 }, { t: t0 + 8 * D, v: 500, n: 1, q: 1 }], 7).pct, null, 'départ à 0 : pas de pourcentage');
});
test('baseRoll / baseRef / pxMovers : variations de prix carte par carte', () => {
  const D = 86400000; let b = C.baseRoll(null, { a: 100 }, 1000); assert.deepEqual(b, { cur: { t: 1000, p: { a: 100 } }, prev: null });
  assert.equal(C.baseRoll(b, { a: 150 }, 1000 + 3 * D), b, 'moins de 7 jours : inchangée');
  const b2 = C.baseRoll(b, { a: 150 }, 1000 + 8 * D); assert.equal(b2.prev.p.a, 100); assert.equal(b2.cur.p.a, 150); assert.equal(C.baseRef(b2).p.a, 100, 'on compare à la période précédente'); assert.equal(C.baseRef(b).p.a, 100); assert.equal(C.baseRef(null), null);
  const items = [{ k: 'a', n: 'A', q: 3, eu: 150 }, { k: 'b', n: 'B', q: 1, eu: 1000 }, { k: 'c', n: 'C', q: 2, eu: 50 }, { k: 'd', n: 'D', q: 1, eu: 90 }, { k: 'e', n: 'E', q: 1, eu: 100 }, { k: 'f', n: 'F', q: 1 }];
  const ref = { t: 0, p: { a: 100, b: 1100, c: 100, d: 100, e: 100, g: 5 } };
  const m = C.pxMovers(items, ref, 25);
  assert.deepEqual(m.list.map(x => x.k), ['a', 'c'], 'a +50 % × 3 ; b −9 % et d −10 % : sous le seuil ; c −50 % × 2 ; e inchangé ; f sans prix'); assert.equal(m.list[0].lot, 150); assert.equal(m.list[1].lot, -100);
  assert.equal(m.total, 150 - 100 - 100 - 10, 'total : Σ variation × quantité (a +150, b −100, c −100, d −10)'); assert.equal(m.all, 4);
  assert.deepEqual(C.pxMovers(items, ref, 5).list.map(x => x.k), ['a', 'b', 'c'], 'seuil 5 % : b compte ; d (−10 c/ex.) reste ignoré, sous 20 centimes'); assert.deepEqual(C.pxMovers(items, null), { total: 0, list: [], all: 0 });
});

test('achats « J\'ai acheté » : fusion des paniers, remplacement après vidage, lecture tolérante', () => {
  const t0 = 1_700_000_000_000;
  let b = C.buyMerge(null, [{ n: 'Sol Ring', q: 1, l: 'fr' }, { n: 'Llanowar Elves', q: 2 }, { n: '', q: 3 }, { n: 'Rien', q: 0 }], false, t0);
  assert.deepEqual(b.items.map(i => [i.k, i.q, i.l || '']), [['llanowar elves', 2, ''], ['sol ring', 1, 'fr']]);
  assert.equal(b.at, t0);
  b = C.buyMerge(b, [{ n: 'Sol Ring', q: 2, l: 'en' }, { n: 'Arcane Signet', q: 1 }], false, t0 + 1);
  assert.deepEqual(b.items.map(i => [i.k, i.q, i.l || '']), [['arcane signet', 1, ''], ['llanowar elves', 2, ''], ['sol ring', 3, 'en']], 'même carte : quantités additionnées, dernière langue');
  assert.deepEqual(C.buyMerge(b, [{ n: 'Command Tower', q: 1 }], true, t0 + 2).items.map(i => i.k), ['command tower'], 'panier vidé avant : on repart de zéro');
  assert.equal(C.buyMerge(b, [], true), null, 'rien d\'ajouté après un vidage : plus de panier en attente');
  assert.equal(C.buyMerge(null, [{ n: 'X', q: 5000 }]).items[0].q, 999, 'plafonné');
  assert.equal(C.buyClean({ at: t0, items: [{ n: 'Sol Ring', q: 2, l: 'FR' }, { n: 5, q: 1 }, { n: 'Zéro', q: 0 }] }, t0 + 1000).items.length, 1);
  assert.equal(C.buyClean({ at: t0, items: [{ n: 'Sol Ring', q: 2 }] }, t0 + 31 * 86400000), null, 'plus de 30 jours : abandonné');
  assert.equal(C.buyClean('x'), null); assert.equal(C.buyClean({ at: 1, items: 'x' }), null);
});

test('cartes engagées : réservation par deck, exemplaires libres, fusion entre appareils', () => {
  const owned = { 'sol ring': 2, 'llanowar elves': 1, plains: 10, 'arcane signet': 0 };
  const own = k => owned[k] || 0;
  const A = C.engSnapshot('1 Sol Ring\n2 Llanowar Elves\n1 Arcane Signet\n20 Plains', own);
  assert.deepEqual(A, { 'sol ring': 1, 'llanowar elves': 1 }, 'au plus les exemplaires possédés ; terrains de base et cartes non possédées ignorés');
  const t = 1_700_000_000_000;
  const eng = { a: { n: 'Deck A', at: t, q: A }, b: { n: 'Deck B', at: t, q: { 'sol ring': 1 } }, c: { n: 'Vide', at: t, q: {} } };
  assert.equal(C.engTotal(eng, 'sol ring'), 2); assert.equal(C.engTotal(eng, 'sol ring', 'a'), 1);
  assert.equal(C.engFree(2, eng, 'sol ring'), 0, '2 possédées − 2 réservées');
  assert.equal(C.engFree(2, eng, 'sol ring', 'a'), 1, 'le deck A peut utiliser ses propres cartes : seul B retient la sienne');
  assert.equal(C.engFree(1, eng, 'llanowar elves'), 0); assert.equal(C.engFree(1, eng, 'llanowar elves', 'a'), 1);
  assert.equal(C.engFree(0, eng, 'sol ring'), 0, 'jamais négatif');
  assert.deepEqual(C.engDecksOf(eng, 'sol ring').map(d => d.id), ['a', 'b']);
  assert.deepEqual(C.engActive(eng).map(x => x[0]), ['a', 'b'], 'un deck démonté (q vide) n\'engage rien');
  // fusion : la trace la plus récente de chaque deck gagne, un démontage plus récent l'emporte, les vieilles traces vides disparaissent
  const dev1 = { a: { n: 'Deck A', at: t + 10, q: {} }, b: { n: 'Deck B', at: t, q: { 'sol ring': 1 } } };
  const dev2 = { a: { n: 'Deck A', at: t + 5, q: A }, d: { n: 'Deck D', at: t + 7, q: { 'sol ring': 1 } }, old: { n: 'Vieux', at: t - 90 * 86400000, q: {} } };
  const m = C.engMerge(dev1, dev2, t + 20);
  assert.deepEqual(Object.keys(m).sort(), ['a', 'b', 'd']); assert.deepEqual(m.a.q, {}, 'démontage plus récent');
  assert.ok(C.engSame(m, C.engMerge(dev2, dev1, t + 20)), 'commutatif');
  assert.ok(C.engSame(m, C.engMerge(m, dev1, t + 20)), 'idempotent');
  assert.deepEqual(C.engClean({ 'bad id!': { q: { x: 1 } }, ok: { n: 'x', at: t, q: { 'sol ring': 'abc', plains: 3.7, neg: -1 } } }, t), { ok: { n: 'x', at: t, q: { plains: 3 } } });
  assert.deepEqual(C.engClean(null), {}); assert.deepEqual(C.engClean([1]), {});
});

test('historique de valeur : fusion de deux appareils, un relevé par jour, plafond', () => {
  const day = 86400000, t0 = new Date(2026, 8, 1, 10).getTime();
  const a = [{ t: t0, v: 1000, n: 5, q: 6 }, { t: t0 + day, v: 1100, n: 5, q: 6 }];
  const b = [{ t: t0 + day + 3600000, v: 1150, n: 6, q: 7 }, { t: t0 + 2 * day, v: 1200, n: 6, q: 7 }, { t: NaN, v: 1 }, null];
  const m = C.histMerge(a, b);
  assert.deepEqual(m.map(h => h.v), [1000, 1150, 1200], 'même jour : le relevé le plus tardif l\'emporte');
  assert.ok(C.histSame(m, C.histMerge(b, a)), 'commutatif'); assert.ok(C.histSame(m, C.histMerge(m, a)), 'idempotent');
  assert.equal(C.histMerge(Array.from({ length: 450 }, (_, i) => ({ t: t0 + i * day, v: i, n: 1, q: 1 })), []).length, 400, 'plafonné à 400 jours, les plus récents gardés');
  assert.deepEqual(C.histMerge('x', undefined), []);
});

/* ── Créateur de deck ─────────────────────────────────────────────────────────────────────────── */
test('créateur de deck : texte ↔ liste, lu par le reste de l\'app (commandant, réserve ignorée du prix)', () => {
  const d = { fmt: 'commander', main: [{ name: 'Sol Ring', qty: 1 }, { name: 'Forest', qty: 30 }], side: [{ name: 'Negate', qty: 2 }], cmdr: [{ name: 'Edgar Markov' }] };
  const t = C.dkBuildText(d);
  assert.equal(t.split('\n')[0], '// Deck Deal : commander');
  assert.equal(C.dkFormat(t), 'commander'); assert.equal(C.dkFormat('1 Sol Ring'), '');
  assert.ok(!/SB:/.test(t), 'pas de réserve en Commander');
  assert.deepEqual(C.commanderKeys(t), ['edgar markov'], 'bloc « Commander » lu comme celui d\'un export');
  const pd = C.parseDeck(t); assert.equal(pd.cards.length, 2, 'commandant + Sol Ring à chercher'); assert.equal(pd.basicCopies, 30);
  const back = C.dkParse(t); assert.equal(back.fmt, 'commander'); assert.deepEqual(back.cmdr, [{ key: 'edgar markov', name: 'Edgar Markov' }]);
  assert.deepEqual(back.main.map(c => [c.name, c.qty]), [['Sol Ring', 1], ['Forest', 30]]);
  assert.equal(C.dkBuildText({ fmt: 'commander', main: back.main, side: back.side, cmdr: back.cmdr }), t, 'aller-retour identique');
  // Standard : la réserve est écrite en « SB: » (ni cherchée ni chiffrée) mais bien lue
  const s = C.dkBuildText({ fmt: 'standard', main: [{ name: 'Lightning Bolt', qty: 4 }], side: [{ name: 'Negate', qty: 2 }, { name: 'Lightning Bolt', qty: 1 }], cmdr: [] });
  assert.match(s, /\nSB: 2 Negate\nSB: 1 Lightning Bolt$/); assert.equal(C.parseDeck(s).cards.length, 1, 'la réserve n\'est pas cherchée');
  const ps = C.dkParse(s); assert.deepEqual(ps.side.map(c => [c.name, c.qty]), [['Negate', 2], ['Lightning Bolt', 1]]); assert.equal(ps.fmt, 'standard');
  assert.deepEqual(C.dkSideCards(s).map(c => c.key), ['negate', 'lightning bolt']);
});
test('créateur de deck : lit une liste venue d\'ailleurs (sections, Sideboard, Maybeboard, DFC)', () => {
  const t = 'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n1 Fire // Ice\n\nSideboard\n1 Negate\n\nMaybeboard\n1 Mana Crypt\n';
  const p = C.dkParse(t);
  assert.deepEqual(p.cmdr.map(c => c.key), ['atraxa praetors voice']); assert.deepEqual(p.main.map(c => c.key), ['sol ring', 'fire'], 'DFC : clé = face avant');
  assert.deepEqual(p.side.map(c => c.key), ['negate']); assert.equal(p.fmt, '');
  assert.deepEqual(C.dkParse('4 Bolt\n4 Bolt\nSB: 1 Bolt\n').main.map(c => c.qty), [8], 'doublons additionnés');
});
test('créateur de deck : règles Standard (60 · 4 exemplaires · réserve 15) et Commander (100 · singleton · commandant)', () => {
  const c = (name, qty) => ({ key: C.ownKey(name), name, qty }), lv = r => r.issues.map(i => i.lv + ':' + i.t.split(' ')[0]);
  // Standard
  let r = C.dkCheck('standard', { main: [c('Lightning Bolt', 4), c('Mountain', 20)], side: [], cmdr: [] });
  assert.equal(r.n, 24); assert.equal(r.size, 60); assert.deepEqual(r.issues.map(i => i.lv), ['warn']); assert.match(r.issues[0].t, /36 cartes/);
  r = C.dkCheck('standard', { main: [c('Lightning Bolt', 4), c('Mountain', 56)], side: [c('Lightning Bolt', 1)], cmdr: [] });
  assert.equal(r.n, 60); assert.equal(r.issues.length, 1, 'terrains de base illimités ; Bolt : 4 en main + 1 en réserve = 5'); assert.match(r.issues[0].t, /Lightning Bolt : 5 exemplaires/); assert.equal(r.issues[0].lv, 'bad');
  r = C.dkCheck('standard', { main: [c('Mountain', 60)], side: [c('A', 8), c('B', 8)].map(x => ({ ...x, qty: 4 })), cmdr: [] }); assert.equal(r.side, 8); assert.equal(r.issues.length, 0, 'réserve de 8 : correct');
  r = C.dkCheck('standard', { main: [c('Mountain', 60)], side: [c('A', 4), c('B', 4), c('C', 4), c('D', 4)], cmdr: [] }); assert.equal(r.side, 16); assert.match(r.issues[0].t, /Réserve de 16/);
  assert.equal(C.dkCheck('standard', { main: [c('Mountain', 61)], side: [], cmdr: [] }).issues.length, 0, '61 cartes : permis');
  // Commander
  const meta = { 'edgar markov': { ci: 'RWB' }, 'sol ring': { ci: '' }, 'craterhoof behemoth': { ci: 'G' }, 'swords to plowshares': { ci: 'W' } };
  const mo = k => meta[k] || null;
  r = C.dkCheck('commander', { main: [c('Sol Ring', 1)], side: [], cmdr: [] }, mo); assert.deepEqual(lv(r), ['bad:Aucun', 'warn:Il']); assert.match(r.issues[1].t, /Il manque 99 cartes/);
  r = C.dkCheck('commander', { main: [c('Sol Ring', 1), c('Forest', 98)], side: [], cmdr: [{ key: 'edgar markov', name: 'Edgar Markov' }] }, mo); assert.equal(r.n, 100); assert.deepEqual(r.issues, [], 'commandant + 99 = 100');
  r = C.dkCheck('commander', { main: [c('Sol Ring', 2), c('Forest', 98)], side: [], cmdr: [{ key: 'edgar markov', name: 'Edgar Markov' }] }, mo); assert.equal(r.n, 101);
  assert.ok(r.issues.some(i => /1 carte en trop/.test(i.t)) && r.issues.some(i => /Sol Ring : 2 exemplaires \(un seul/.test(i.t)), 'trop de cartes + singleton');
  r = C.dkCheck('commander', { main: [c('Craterhoof Behemoth', 1), c('Swords to Plowshares', 1), c('Forest', 97)], side: [], cmdr: [{ key: 'edgar markov', name: 'Edgar Markov' }] }, mo);
  assert.deepEqual(r.issues.map(i => i.lv), ['warn'], 'Craterhoof (G) hors identité RWB ; Swords (W) dedans'); assert.match(r.issues[0].t, /Craterhoof Behemoth sort de l'identité/);
  r = C.dkCheck('commander', { main: [c('Edgar Markov', 1), c('Forest', 98)], side: [], cmdr: [{ key: 'edgar markov', name: 'Edgar Markov' }] }, mo); assert.ok(r.issues.some(i => /déjà ton commandant/.test(i.t)));
  assert.ok(C.dkCheck('commander', { main: [], side: [], cmdr: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }, { key: 'c', name: 'C' }] }).issues.some(i => /Deux commandants/.test(i.t)));
  r = C.dkCheck('commander', { main: [c('Forest', 99)], side: [], cmdr: [{ key: 'sol ring', name: 'Sol Ring' }] }, k => ({ ci: '', cd: 0 })); assert.deepEqual(r.issues.map(i => i.t), ['Sol Ring ne peut normalement pas être commandant.'], 'commandant non éligible (lu sur Scryfall)');
  assert.deepEqual(C.dkCheck('commander', { main: [c('Forest', 99)], side: [], cmdr: [{ key: 'sol ring', name: 'Sol Ring' }] }, () => ({ ci: '' })).issues, [], 'éligibilité inconnue : pas d\'alerte');
  // couleurs inconnues : pas de contrôle (pas d'alerte fantaisiste)
  r = C.dkCheck('commander', { main: [c('Craterhoof Behemoth', 1), c('Forest', 98)], side: [], cmdr: [{ key: 'edgar markov', name: 'Edgar Markov' }] }, () => null); assert.deepEqual(r.issues, []);
});
test('deck monté : la réserve (SB:) est aussi mise de côté, sans doubler une carte déjà dans le deck', () => {
  const owned = { 'lightning bolt': 4, negate: 3, 'sol ring': 1 }, of = k => owned[k] || 0;
  assert.deepEqual(C.engSnapshot('4 Lightning Bolt\n1 Sol Ring\n20 Mountain\nSB: 2 Negate\nSB: 1 Lightning Bolt\nSB: 1 Pithing Needle', of), { 'lightning bolt': 4, negate: 2, 'sol ring': 1 }, 'au plus les exemplaires possédés (4), Pithing Needle non possédée');
});

test('chinois : alias de langue, texte « *ZH* » ou « *ZH-CN* », une ligne par langue, recherche en français sur une carte anglaise', () => {
  for (const x of ['zh', 'ZH', 'zhs', 'zht', 'zh-CN', 'ZH-CN', 'Chinese', 'chinois', 'Chinese Simplified']) assert.equal(C.cardLang(x), 'zh-CN', x);
  assert.equal(C.langCode('zh-CN'), 'ZH'); assert.equal(C.langCode('fr'), 'FR'); assert.equal(C.langCode(''), '');
  assert.equal(C.parseLine('2 Sol Ring *ZH*').lang, 'zh-CN'); assert.equal(C.parseLine('2 Sol Ring *ZH-CN*').lang, 'zh-CN'); assert.equal(C.parseLine('2 Sol Ring *ZH-CN*').name, 'Sol Ring');
  const p = C.parseCollection('2 Sol Ring *ZH*\n1 Sol Ring *FR*\n1 Counterspell *ZH-CN*');
  const m = C.mergeColl({}, p.items, 'replace');
  assert.deepEqual(C.collLines(m['sol ring']), [['fr', 1], ['zh-CN', 2]], 'tri : fr avant zh-CN'); assert.equal(m['sol ring'].q, 3); assert.equal(m['counterspell'].l, 'zh-CN');
  const t = C.collToText(m); assert.match(t, /2 Sol Ring \*ZH\*/); assert.ok(!/ZH-CN/.test(t));
  assert.deepEqual(C.collLines(C.collFromText(t)['sol ring']), [['fr', 1], ['zh-CN', 2]], 'aller-retour du texte');
  const csv = C.parseCollection('Name,Quantity,Language\nSol Ring,2,zhs\nSol Ring,1,Chinese Traditional');
  assert.deepEqual(csv.items.map(i => [i.q, i.lang || i.l]), [[3, 'zh-CN']].map(a => a), 'ManaBox zhs / zht : même ligne chinoise');
  assert.equal(C.sanitizeOpts({ lang: 'zh-CN' }).lang, 'zh-CN', 'langue de recherche CardTrader : zh-CN');
  // recherche : le nom français (fn) trouve la carte même si l'exemplaire est anglais ; le nom affiché reste anglais
  const items = [{ n: 'Sol Ring', fn: 'Anneau solaire', q: 1, l: 'en' }, { n: 'Counterspell', q: 1 }];
  assert.deepEqual(C.filterItems(items, { q: 'anneau' }).map(i => i.n), ['Sol Ring']); assert.deepEqual(C.filterItems(items, { q: 'sol ring' }).map(i => i.n), ['Sol Ring']); assert.deepEqual(C.filterItems(items, { q: 'counter' }).map(i => i.n), ['Counterspell']);
});

test('valeur estimée d\'un deck : Cardmarket × exemplaires, terrains de base et réserve exclus, cartes pas encore lues signalées', () => {
  const meta = { 'sol ring': { eu: 150 }, 'arcane signet': { eu: 40 }, 'mana vault': { eu: null } };
  const t = '// Deck Deal : commander\nCommander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n2 Arcane Signet\n1 Mana Vault\n30 Forest\nSB: 1 Swords to Plowshares';
  const v = C.dkValue(t, k => meta[k]);
  assert.deepEqual({ cents: v.cents, known: v.known, total: v.total, noPrice: v.noPrice }, { cents: 230, known: 2, total: 4, noPrice: 1 }, '150 + 2 × 40 ; Mana Vault sans prix ; Forest et SB ignorés');
  assert.deepEqual(v.missing.map(c => c.name), ['Edgar Markov'], 'à lire sur Scryfall');
  assert.equal(C.dkValue('', k => null).total, 0);
});

test('couleurs d\'un deck : d\'après ses terrains de base (ordre WUBRG, enneigés compris, Wastes ignorés)', () => {
  assert.equal(C.dkColors('4 Sol Ring\n10 Swamp\n12 Mountain\n2 Snow-Covered Swamp\n3 Wastes'), 'BR');
  assert.equal(C.dkColors('1 Forest\n1 Plains\n1 Island\n1 Swamp\n1 Mountain'), 'WUBRG');
  assert.equal(C.dkColors('1 Sol Ring\n1 Command Tower'), '');
});

/* ── Carte de présentation, filtres de l'écran « Mes decks » ───────────────────────────────── */
test('dkSetCover / dkCover : ligne de commentaire juste après le format, remplacée, retirée', () => {
  const t = '// Deck Deal : standard\nDeck\n4 Sol Ring';
  const a = C.dkSetCover(t, 'Sol Ring');
  assert.equal(a, '// Deck Deal : standard\n// Deck Deal cover : Sol Ring\nDeck\n4 Sol Ring'); assert.equal(C.dkCover(a), 'Sol Ring');
  const b = C.dkSetCover(a, 'Wrath of God'); assert.equal(b.split('\n').filter(l => /cover/.test(l)).length, 1); assert.equal(C.dkCover(b), 'Wrath of God');
  assert.equal(C.dkSetCover(b, ''), t, 'vide : retirée');
  assert.equal(C.dkSetCover('1 Sol Ring', 'Sol Ring'), '// Deck Deal cover : Sol Ring\n1 Sol Ring', 'liste sans format : en tête');
  assert.equal(C.dkFormat(a), 'standard', 'la ligne de cover ne se confond pas avec le format'); assert.equal(C.parseDeck(a).cards.length, 1, 'ignorée par la lecture de la liste'); assert.equal(C.parseDeck(a).ignored, 0, 'sans être signalée');
});
test('dkBuildText / dkParse gardent la carte de présentation', () => {
  const txt = C.dkBuildText({ fmt: 'standard', main: [{ name: 'Sol Ring', qty: 4 }], side: [{ name: 'Negate', qty: 2 }], cmdr: [], cover: 'Negate' });
  assert.match(txt, /^\/\/ Deck Deal : standard\n\/\/ Deck Deal cover : Negate\nDeck\n4 Sol Ring\n\nSB: 2 Negate$/);
  assert.equal(C.dkParse(txt).cover, 'Negate'); assert.equal(C.dkParse('Deck\n1 Sol Ring').cover, '');
  assert.equal(C.dkBuildText({ fmt: 'standard', main: [{ name: 'Sol Ring', qty: 1 }] }).includes('cover'), false);
});
test('dkCoverCard : choisie > commandant > plus chère hors terrains > première', () => {
  const meta = { 'sol ring': { eu: 150, tl: 'Artifact' }, 'arcane signet': { eu: 40, tl: 'Artifact' }, 'volrath s stronghold': { eu: 900, tl: 'Land' }, 'edgar markov': { eu: 500, tl: 'Legendary Creature' } };
  const m = k => meta[k] || null;
  assert.deepEqual(C.dkCoverCard('1 Sol Ring\n1 Arcane Signet', m), { key: 'sol ring', name: 'Sol Ring', auto: true });
  assert.equal(C.dkCoverCard("1 Arcane Signet\n1 Volrath's Stronghold", m).name, 'Arcane Signet', 'jamais un terrain tant qu\'il y a autre chose');
  assert.equal(C.dkCoverCard('1 Volrath\'s Stronghold', m).name, 'Volrath\'s Stronghold', 'seul : le terrain');
  assert.equal(C.dkCoverCard('// Deck Deal : commander\nCommander\n1 Edgar Markov\n\nDeck\n1 Sol Ring', m).name, 'Edgar Markov', 'commandant');
  assert.deepEqual(C.dkCoverCard('// Deck Deal cover : Arcane Signet\n1 Sol Ring\n1 Arcane Signet', m), { key: 'arcane signet', name: 'Arcane Signet', auto: false });
  assert.equal(C.dkCoverCard('// Deck Deal cover : Negate\nDeck\n1 Sol Ring\n\nSB: 1 Negate', m).auto, false, 'une carte de la réserve peut être choisie');
  assert.equal(C.dkCoverCard('// Deck Deal cover : Carte disparue\n1 Sol Ring', m).name, 'Sol Ring', 'carte retirée du deck : retour au choix automatique');
  assert.equal(C.dkCoverCard('1 Inconnue\n1 Autre', () => null).name, 'Inconnue', 'sans prix connu : la première');
  assert.equal(C.dkCoverCard('', m), null);
});
test('dkMatch : format et couleurs (toutes celles demandées)', () => {
  const std = '// Deck Deal : standard\nDeck\n4 Sol Ring\n10 Swamp\n12 Mountain', cmd = 'Commander\n1 Edgar Markov\n\nDeck\n1 Sol Ring\n5 Plains\n5 Swamp', none = '1 Sol Ring';
  assert.equal(C.dkFmtOf(std), 'standard'); assert.equal(C.dkFmtOf(cmd), 'commander', 'en-tête Commander sans ligne de format'); assert.equal(C.dkFmtOf(none), '');
  assert.equal(C.dkMatch(std, {}), true); assert.equal(C.dkMatch(none, { fmt: '', colors: '' }), true);
  assert.equal(C.dkMatch(std, { fmt: 'standard' }), true); assert.equal(C.dkMatch(std, { fmt: 'commander' }), false); assert.equal(C.dkMatch(none, { fmt: 'standard' }), false, 'format inconnu : ni l\'un ni l\'autre');
  assert.equal(C.dkMatch(std, { colors: 'R' }), true); assert.equal(C.dkMatch(std, { colors: 'BR' }), true); assert.equal(C.dkMatch(std, { colors: 'RW' }), false, 'toutes les couleurs');
  assert.equal(C.dkMatch(cmd, { fmt: 'commander', colors: 'WB' }), true); assert.equal(C.dkMatch(none, { colors: 'W' }), false, 'sans terrains de base : aucune couleur');
});

test('export CSV de la collection (format Moxfield) : relu par l\'import, une ligne par langue', () => {
  const map = { 'sol ring': { n: 'Sol Ring', q: 3, l: 'fr', x: { fr: 2, en: 1 } }, 'fire': { n: 'Fire // Ice', q: 1 }, 'x': { n: 'Krenko, "Tin" Lord', q: 2, l: 'de' } };
  const csv = C.collToCsv(map), lines = csv.trim().split('\n');
  assert.equal(lines[0], 'Count,Tradelist Count,Name,Edition,Condition,Language,Foil');
  assert.deepEqual(lines.slice(1), ['1,0,Fire // Ice,,Near Mint,,', '2,0,"Krenko, ""Tin"" Lord",,Near Mint,German,', '2,0,Sol Ring,,Near Mint,French,', '1,0,Sol Ring,,Near Mint,English,']);
  const back = C.parseCollection(csv);
  assert.equal(back.format, 'csv'); assert.equal(back.copies, 6);
  const sr = back.items.find(i => i.n === 'Sol Ring'); assert.deepEqual(sr.x, { fr: 2, en: 1 });
  assert.equal(back.items.find(i => /Krenko/.test(i.n)).n, 'Krenko, "Tin" Lord');
  assert.equal(C.parseCollection('Quantity,Product Name,Set\n2,Sol Ring,CMM\n').items[0].q, 2, 'TCGplayer : « Product Name »');
});
test('export CSV : un nom qui ressemble à une formule (Excel, LibreOffice) est neutralisé, les vrais noms « +2 Mace » restent intacts', () => {
  const row = n => C.collToCsv({ k: { n, q: 2 } }).trim().split('\n')[1];
  assert.equal(row('=HYPERLINK("http://x","clic")'), '2,0,"\'=HYPERLINK(""http://x"",""clic"")",,Near Mint,,');
  assert.equal(row('@SUM(A1)'), "2,0,'@SUM(A1),,Near Mint,,");
  assert.equal(row('-2+3+cmd|\' /C calc\'!A0'), "2,0,'-2+3+cmd|' /C calc'!A0,,Near Mint,,", 'DDE : signe suivi d\'une formule');
  assert.equal(row('+1'), "2,0,'+1,,Near Mint,,", 'signe et chiffres seuls : formule');
  assert.equal(row('\tSol Ring'), "2,0,'\tSol Ring,,Near Mint,,");
  assert.equal(row('\rSol Ring'), '2,0,"\'\rSol Ring",,Near Mint,,');
  assert.equal(row('+2 Mace'), '2,0,+2 Mace,,Near Mint,,', 'vrai nom de carte : intact');
  assert.equal(row('-1 Kobold\'s Lance, Hunter'), '2,0,"-1 Kobold\'s Lance, Hunter",,Near Mint,,', 'signe, chiffres, espace, mots : intact');
  assert.equal(row('Sol Ring'), '2,0,Sol Ring,,Near Mint,,');
  assert.equal(row('Fire // Ice'), '2,0,Fire // Ice,,Near Mint,,');
  assert.match(C.collToCsv({ k: { n: 'Sol Ring', q: 3 } }), /\n3,0,Sol Ring,/, 'colonnes de nombres jamais touchées');
});

test('i18n : T, TN, choix de la langue', () => {
  const { T, TN, I18N, i18nPick } = C;
  const all = { en: { 'Bonjour {who}': 'Hello {who}', '{n} carte': '{n} card', '{n} cartes': '{n} cards' } };
  assert.equal(i18nPick({ nav: 'fr-BE', robot: false, all }), 'fr'); assert.equal(T('Bonjour {who}', { who: 'Ana' }), 'Bonjour Ana');
  assert.equal(TN(0, '{n} carte', '{n} cartes'), '0 carte'); assert.equal(TN(2, '{n} carte', '{n} cartes'), '2 cartes'); assert.equal(TN(1500, '{n} carte', '{n} cartes'), (1500).toLocaleString('fr-FR') + ' cartes');
  assert.equal(i18nPick({ nav: 'en-US', robot: false, all }), 'en'); assert.equal(T('Bonjour {who}', { who: 'Ana' }), 'Hello Ana'); assert.equal(T('Inconnu'), 'Inconnu', 'clé absente : français');
  assert.equal(TN(0, '{n} carte', '{n} cartes'), '0 cards'); assert.equal(TN(1, '{n} carte', '{n} cartes'), '1 card'); assert.equal(TN(1500, '{n} carte', '{n} cartes'), '1,500 cards');
  assert.equal(i18nPick({ nav: 'de-DE', robot: false, all }), 'en', 'autre langue : anglais');
  assert.equal(i18nPick({ nav: 'en-US', robot: true, all }), 'fr', 'navigateur de test : français');
  assert.equal(i18nPick({ nav: 'fr-FR', robot: true, saved: 'en', all }), 'en', 'choix gardé prioritaire');
  assert.equal(i18nPick({ nav: 'fr-FR', robot: false, saved: 'xx', all }), 'fr', 'langue inconnue ignorée');
  i18nPick({ nav: 'fr-FR', robot: true, all }); assert.equal(I18N.lang, 'fr');
});

test('i18n : langues livrées seulement (dictionnaire présent), langue du téléphone, pluriels et nombres de chaque langue', () => {
  const { T, TN, LOC, I18N, i18nPick, i18nHas, i18nLangs, I18N_LANGS } = C;
  assert.equal(I18N_LANGS.de, 'Deutsch'); assert.equal(I18N_LANGS.es, 'Español', 'chaque langue écrite dans sa langue');
  const all = { en: { '{n} carte': '{n} card', '{n} cartes': '{n} cards' }, de: { 'Bonjour {who}': 'Hallo {who}', '{n} carte': '{n} Karte', '{n} cartes': '{n} Karten' } };
  assert.deepEqual([i18nHas('fr', all), i18nHas('en', all), i18nHas('de', all), i18nHas('es', all), i18nHas('xx', all), i18nHas('', all)], [true, true, true, false, false, false], 'espagnol sans dictionnaire : pas livré');
  assert.deepEqual(i18nLangs(all), [['fr', 'Français'], ['en', 'English'], ['de', 'Deutsch']], 'Réglages et accueil : langues livrées, chacune dans sa langue');
  assert.equal(i18nHas('de'), false, 'sous Node sans dictionnaires : seul le français');
  try {
    assert.equal(i18nPick({ nav: 'de-DE', robot: false, all }), 'de'); assert.equal(T('Bonjour {who}', { who: 'Ana' }), 'Hallo Ana'); assert.equal(LOC(), 'de-DE');
    assert.deepEqual([TN(0, '{n} carte', '{n} cartes'), TN(1, '{n} carte', '{n} cartes'), TN(2, '{n} carte', '{n} cartes'), TN(1500, '{n} carte', '{n} cartes')], ['0 Karten', '1 Karte', '2 Karten', '1.500 Karten'], 'allemand : 1 seul au singulier, « 1.500 »');
    assert.equal(new Intl.NumberFormat(LOC(), { style: 'currency', currency: 'EUR' }).format(1234.56), '1.234,56 €', 'prix en euros, écriture allemande');
    assert.equal(i18nPick({ nav: 'de-AT', robot: false, all }), 'de'); assert.equal(LOC(), 'de-AT', 'Autriche : sa variante');
    assert.equal(i18nPick({ nav: ['nl-NL', 'de-CH', 'en-US'], robot: false, all }), 'de', 'première langue livrée du téléphone'); assert.equal(LOC(), 'de-CH'); assert.equal(I18N.nav, 'nl-NL');
    assert.equal(i18nPick({ nav: ['de', 'en-US'], robot: false, all }), 'de'); assert.equal(LOC(), 'de-DE', 'langue sans pays : celle de LOC_DEF');
    assert.equal(i18nPick({ nav: 'en-US', robot: false, saved: 'de', all }), 'de', 'choix gardé');
    assert.equal(i18nPick({ nav: 'es-MX', robot: false, all }), 'en', 'espagnol pas encore livré : anglais');
    assert.equal(i18nPick({ nav: 'de-DE', robot: false, saved: 'es', all }), 'de', 'choix d\'une langue retirée : ignoré');
    assert.equal(i18nPick({ nav: 'de-DE', robot: true, all }), 'fr', 'navigateur de test : français');
    assert.equal(i18nPick({ nav: 'fr-CA', robot: false, all }), 'fr'); assert.equal(LOC(), 'fr-FR', 'français : toujours fr-FR');
    assert.equal(i18nPick({ nav: 'en-US', robot: false, all }), 'en'); assert.equal(LOC(), 'en-US', 'anglais : inchangé');
    i18nPick({ nav: 'de-DE', robot: false, all: { ...all, es: {} }, saved: 'es' }); assert.deepEqual([I18N.lang, LOC(), TN(1, '{n} carte', '{n} cartes'), TN(1e6, '{n} carte', '{n} cartes')], ['es', 'es-ES', '1 carte', '1.000.000 cartes'], 'espagnol livré : es-ES, pluriel « many » → pluriel');
    i18nPick({ nav: ['es-MX'], robot: false, all: { ...all, es: {} } }); assert.equal(LOC(), 'es-MX');
    i18nPick({ nav: ['de_XX!!'], robot: false, all }); assert.equal(I18N.lang, 'de'); assert.equal(LOC(), 'de-DE', 'étiquette illisible : jamais d\'erreur');
  } finally { i18nPick({ nav: 'fr-FR', robot: true, all }); }
  assert.equal(TN(1, '{n} carte', '{n} cartes'), '1 carte'); assert.equal(TN(0, '{n} carte', '{n} cartes'), '0 carte', 'français : 0 et 1 au singulier');
});
