// Liste d'échange, partage public et main de départ : logique pure de src/core.js.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../src/core.js');

const coll = C.collFromText(['4 Sol Ring *FR*', '1 Sol Ring *EN*', '1 Arcane Signet', '3 Lightning Bolt *FR*', '2 Counterspell', '12 Forest', '2 Fire // Ice *EN*'].join('\n'));
const decks = [
  '// Deck Deal : commander\nCommander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n10 Forest',
  '1 Sol Ring\n4 Lightning Bolt\nSB: 1 Counterspell\n1 Fire // Ice',
];
const use = C.deckUse(decks);
{
  assert.equal(use.get('sol ring').q, 2, 'somme des decks'); assert.equal(use.get('counterspell').q, 1, 'réserve comprise');
  assert.equal(use.get('fire').q, 1, 'carte double : clé de la face avant'); assert.ok(!use.has('forest'), 'terrains de base exclus');
  assert.equal(use.get('atraxa praetors voice').q, 1, 'commandant compris');
  console.log('✓ deckUse : somme des decks, réserve et commandant compris, terrains de base exclus');
}
{
  let r = C.tradeLists(coll, use, 1, new Set());
  const by = k => r.have.find(x => x.k === k);
  assert.equal(by('sol ring').q, 2, '5 possédées − 2 decks − 1 réserve');
  assert.deepEqual(by('sol ring').lines, [['fr', 1], ['en', 1]], 'gardées d\'abord en FR : 1 FR + 1 EN à l\'échange');
  assert.ok(!by('arcane signet') && !by('lightning bolt') && !by('fire'), 'cartes toutes utilisées (ou manquantes) : rien à échanger');
  assert.ok(!by('forest'), 'terrains de base jamais proposés');
  assert.ok(!by('counterspell'), '2 − 1 (réserve d\'un deck) − 1 (réserve de sécurité) = 0');
  r = C.tradeLists(coll, use, 0, new Set());
  assert.equal(r.have.find(x => x.k === 'sol ring').q, 3); assert.equal(r.have.find(x => x.k === 'counterspell').q, 1, 'réserve 0 : tout ce que les decks n\'utilisent pas');
  r = C.tradeLists(coll, use, 0, new Set(['sol ring']));
  assert.ok(!r.have.some(x => x.k === 'sol ring')); assert.deepEqual(r.held, [{ k: 'sol ring', n: 'Sol Ring', q: 3 }], 'carte gardée à la main : listée à part');
  assert.equal(C.tradeLists({ 'x': { n: 'X', q: 1 } }, new Map(), 1).have.length, 0, 'un seul exemplaire, réserve 1 : rien');
  console.log('✓ tradeLists : possédé − decks − réserve, langues gardées dans l\'ordre, « Garder », terrains de base exclus');
}
{
  const w = C.tradeWant(coll, use, { 'lightning bolt': { n: 'Lightning Bolt', q: 2 }, 'mana crypt': { n: 'Mana Crypt' }, 'forest': { n: 'Forest', q: 3 } });
  const by = k => w.find(x => x.k === k);
  assert.deepEqual(by('lightning bolt'), { k: 'lightning bolt', n: 'Lightning Bolt', q: 3, d: 1, w: 2 }, 'manque 1 aux decks + 2 souhaités');
  assert.deepEqual(by('mana crypt'), { k: 'mana crypt', n: 'Mana Crypt', q: 1, d: 0, w: 1 }, 'souhait seul, 1 par défaut');
  assert.equal(by('atraxa praetors voice').q, 1, 'commandant non possédé : recherché');
  assert.ok(!by('forest') && !by('sol ring'), 'terrains de base et cartes déjà là : non');
  const wp = C.tradeWant(coll, use, { 'mana crypt': { n: 'Mana Crypt', q: 1, i: 'https://cards.scryfall.io/normal/front/a/b/mc.jpg', w: 'Eternal Masters · EMA 225', l: 'fr' } });
  assert.deepEqual(wp.find(x => x.k === 'mana crypt').p, { i: 'https://cards.scryfall.io/normal/front/a/b/mc.jpg', w: 'Eternal Masters · EMA 225', l: 'fr' }, 'illustration retenue');
  assert.equal(C.scrySmall('https://cards.scryfall.io/normal/front/a/b/mc.jpg?1'), 'https://cards.scryfall.io/small/front/a/b/mc.jpg?1');
  console.log('✓ tradeWant : manquantes des decks + liste de souhaits (avec l\'illustration retenue)');
}
{
  const ok = C.readShare('trade', JSON.stringify({ at: 5, have: [{ n: 'Sol Ring', q: 2, l: 'fr', f: 'Anneau solaire', i: 'https://cards.scryfall.io/small/front/a/b/x.jpg?123', c: 1, t: 'Artifact', o: '', m: '{1}' }, { n: '', q: 1 }, { n: 'Evil', q: 1, i: 'https://evil.example/p.gif', l: 'xx', o: '<b>' }], want: [{ n: 'Mana Crypt', q: 1 }] }));
  assert.equal(ok.have.length, 2, 'carte sans nom écartée');
  assert.deepEqual(ok.have[0], { k: 'sol ring', n: 'Sol Ring', q: 2, l: 'fr', fn: 'Anneau solaire', dn: 'Anneau solaire', im: 'https://cards.scryfall.io/small/front/a/b/x.jpg?123', cm: 1, tl: 'Artifact', cl: '', mc: '{1}' });
  assert.deepEqual(ok.have[1], { k: 'evil', n: 'Evil', q: 1 }, 'image hors Scryfall, langue et couleurs inconnues : ignorées');
  assert.equal(C.readShare('trade', JSON.stringify({ want: [{ n: 'Mana Crypt', q: 1, w: 'Eternal Masters · EMA 225' }] })).want[0].pw, 'Eternal Masters · EMA 225', 'libellé de l\'illustration recherchée');
  assert.equal(C.readShare('trade', '{oops'), null); assert.equal(C.readShare('nope', '{}'), null);
  assert.deepEqual(C.readShare('deck', JSON.stringify({ name: 'Mon deck', text: '1 Sol Ring', at: 3 })), { kind: 'deck', at: 3, name: 'Mon deck', text: '1 Sol Ring' });
  assert.equal(C.readShare('deck', JSON.stringify({ name: 'Vide', text: '// rien' })), null, 'deck vide : illisible');
  console.log('✓ readShare : contenu d\'un autre compte revérifié (images Scryfall seulement, langues, couleurs, tailles)');
}
{
  assert.ok(C.isLandType('Land') && C.isLandType('Legendary Land') && C.isLandType('Artifact Land') && C.isLandType('Basic Snow Land — Forest'));
  assert.ok(!C.isLandType('Creature — Elf') && !C.isLandType('Instant // Land') && !C.isLandType(''), 'carte modale sort // terrain : pas un terrain');
  const lib = C.libraryOf([{ k: 'a', q: 4 }, { k: 'cmd', q: 1, cmd: 1 }, { k: 'sb', q: 3, sb: 1 }, { k: 'b', q: 2 }]);
  assert.equal(lib.length, 6, 'commandant et réserve hors de la bibliothèque');
  const h = C.drawHand(lib, 7, C.mulberry32(1)); assert.equal(h.length, 6, 'jamais plus que la bibliothèque');
  const big = C.libraryOf([{ k: 'x', q: 60 }]).map((x, i) => ({ ...x, i })), seen = new Set();
  for (let s = 1; s < 40; s++) { const hand = C.drawHand(big, 7, C.mulberry32(s)); assert.equal(hand.length, 7); assert.equal(new Set(hand.map(x => x.i)).size, 7, 'sans remise'); hand.forEach(x => seen.add(x.i)); }
  assert.ok(seen.size > 45, 'tirages variés');
  const o = C.handLandOdds(60, 24, 7), sum = o.reduce((a, x) => a + x, 0);
  assert.equal(o.length, 8); assert.ok(Math.abs(sum - 1) < 1e-9, 'somme = 1');
  assert.ok(Math.abs(o[3] - 0.30870) < 1e-4, '60 cartes dont 24 terrains : ≈ 30,9 % de mains à 3 terrains (' + o[3] + ')');
  assert.ok(Math.abs(C.handLandOdds(99, 36, 7)[0] - 0.037165) < 1e-5, 'Commander 99 cartes, 36 terrains : ≈ 3,7 % sans terrain');
  assert.deepEqual(C.handLandOdds(5, 5, 7), [0, 0, 0, 0, 0, 1], 'paquet plus petit que la main');
  console.log('✓ main de départ : terrains (face avant), bibliothèque sans commandant ni réserve, tirage sans remise, loi hypergéométrique');
}
{
  const { shareFetch } = createRequire(import.meta.url)('../src/cloud.js');
  const calls = [], res = (status, body) => async url => { calls.push(url); return { status, ok: status >= 200 && status < 300, json: async () => body }; };
  const code = async (id, f) => { try { await shareFetch(id, f); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(await code('../../x', res(200, {})), 'bad'); assert.equal(await code('abc', res(200, {})), 'bad'); assert.equal(calls.length, 0, 'identifiant invalide : aucune requête');
  assert.equal(await code('Abcdef123456789', res(404, {})), 'gone'); assert.equal(await code('Abcdef123456789', res(403, {})), 'denied'); assert.equal(await code('Abcdef123456789', res(500, {})), 'net');
  assert.equal(await code('Abcdef123456789', async () => { throw new Error('x'); }), 'net');
  assert.match(calls[0], /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/m2s-mtg\/databases\/\(default\)\/documents\/shares\/Abcdef123456789\?key=/);
  assert.equal(await code('Abcdef123456789', res(200, { fields: { kind: { stringValue: 'trade' }, d: { stringValue: '{nope' } } })), 'bad');
  const sh = await shareFetch('Abcdef123456789', res(200, { fields: { o: { stringValue: 'x' }, kind: { stringValue: 'deck' }, d: { stringValue: JSON.stringify({ name: 'D', text: '1 Sol Ring', at: 9 }) } } }));
  assert.deepEqual(sh, { kind: 'deck', at: 9, name: 'D', text: '1 Sol Ring' });
  console.log('✓ shareFetch : API REST Firestore sans compte, identifiant contrôlé avant toute requête, erreurs lisibles');
}
console.log('test-trade OK');
