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
  assert.equal(C.imgShort('https://cards.scryfall.io/small/front/6/d/6da0.jpg?1562404626'), 'small/front/6/d/6da0.jpg', 'adresse raccourcie'); assert.equal(C.imgShort('https://evil.example/x.jpg'), '');
  { const r = C.readShare('trade', JSON.stringify({ have: [], want: [], by: ' <b>Martin</b>\u0007 ', bp: 'data:image/png;base64,AAAA' }));
    assert.equal(r.by, 'bMartin/b', 'pseudo : sans balise ni caractère de contrôle'); assert.equal(r.bp, 'data:image/png;base64,AAAA');
    const bad = C.readShare('deck', JSON.stringify({ text: '1 Sol Ring', by: 'x'.repeat(99), bp: 'https://evil.example/p.png' }));
    assert.equal(bad.by.length, 30, 'pseudo tronqué'); assert.ok(!('bp' in bad), 'photo : jamais une adresse externe');
    assert.ok(!('by' in C.readShare('trade', JSON.stringify({ have: [] }))), 'sans profil : rien'); }
  assert.equal(C.readShare('trade', JSON.stringify({ have: [{ n: 'Sol Ring', q: 1, i: 'small/front/6/d/6da0.jpg' }] })).have[0].im, 'https://cards.scryfall.io/small/front/6/d/6da0.jpg', 'adresse raccourcie relue en entier');
  assert.equal(C.readShare('trade', JSON.stringify({ have: [{ n: 'Sol Ring', q: 1, i: '//evil.example/x.jpg' }] })).have[0].im, undefined, 'jamais un autre domaine');
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
{
  assert.equal(C.cmText([{ n: 'Sol Ring', q: 1 }, { n: 'Forest', q: 3 }, { n: 'Fire // Ice', q: 2 }, { n: 'sol ring', q: 1 }, { n: 'Zéro', q: 0 }]), '2 Sol Ring\n2 Fire // Ice', 'additionnées, sans terrains de base ni quantité nulle');
  const m = C.deckMissing('Commander\n1 Edgar Markov\nDeck\n4 Lightning Bolt\n10 Plains\nSB: 2 Negate', k => ({ 'lightning bolt': 3, 'edgar markov': 1 })[k] || 0);
  assert.deepEqual(m, [{ n: 'Lightning Bolt', q: 1 }, { n: 'Negate', q: 2 }], 'deck + réserve − possédées, terrains de base exclus');
  assert.deepEqual(C.deckMissing('1 Sol Ring\n2 Island', null), [{ n: 'Sol Ring', q: 1 }], 'sans collection : tout le deck');
  console.log('✓ export Cardmarket : « 2 Sol Ring » par ligne, manquantes d\'un deck (réserve comprise, terrains de base exclus)');
}
{
  // « Pour toi » : liste du propriétaire (lue comme un visiteur) contre la collection, les decks et les souhaits du visiteur
  const sh = C.readShare('trade', JSON.stringify({ have: [{ n: 'Sol Ring', q: 2, l: 'fr', f: 'Anneau solaire' }, { n: 'Sol Ring', q: 1, l: 'en', i: 'small/front/a/b/sol.jpg' }, { n: 'Llanowar Elves', q: 3, l: 'en' }, { n: 'Mana Crypt', q: 1 }, { n: 'Rhystic Study', q: 1 }],
    want: [{ n: 'Arcane Signet', q: 1 }, { n: 'Counterspell', q: 4 }, { n: 'Edgar Markov', q: 1, w: 'Masters · CMM 1' }, { n: 'Lightning Bolt', q: 2 }, { n: 'Arcane Signet', q: 9 }] }));
  const vcoll = C.collFromText(['3 Arcane Signet *FR*', '2 Counterspell', '2 Edgar Markov *EN*', '1 Lightning Bolt'].join('\n'));
  const vuse = C.deckUse(['1 Edgar Markov\n1 Sol Ring\n1 Lightning Bolt\n1 Llanowar Elves']);
  const spare = C.tradeLists(vcoll, vuse, 1, new Set()).have, want = C.tradeWant(vcoll, vuse, { 'sol ring': { n: 'Sol Ring', q: 3, i: 'https://cards.scryfall.io/normal/front/x/y/sr.jpg', w: 'Alpha · LEA 270' }, 'mana crypt': { n: 'Mana Crypt' } });
  const px = { 'sol ring': 150, 'mana crypt': 15000, 'arcane signet': 40, 'counterspell': 120 };
  const r = C.tradeMatch(sh, want, spare, k => px[k]);
  assert.deepEqual(r.get.map(x => [x.k, x.q, x.has]), [['mana crypt', 1, 1], ['sol ring', 3, 3], ['llanowar elves', 1, 3]], 'ce qu\'il a et que je cherche : la plus chère d\'abord ; q = min(ses exemplaires, ma recherche)');
  const sol = r.get.find(x => x.k === 'sol ring');
  assert.deepEqual(sol.ls, ['fr', 'en'], 'ses lignes par langue additionnées'); assert.equal(sol.it.im, 'https://cards.scryfall.io/small/front/a/b/sol.jpg', 'fiche avec image gardée');
  assert.equal(sol.w.p.w, 'Alpha · LEA 270', 'illustration que je souhaite'); assert.equal(sol.w.d, 1, 'manque à mon deck'); assert.equal(sol.u, 150); assert.equal(sol.v, 450);
  assert.equal(r.get.find(x => x.k === 'llanowar elves').v, null, 'sans prix : valeur inconnue (jamais 0)');
  assert.ok(!r.get.some(x => x.k === 'rhystic study'), 'pas cherchée : absente');
  assert.deepEqual(r.give.map(x => [x.k, x.q]), [['counterspell', 1], ['arcane signet', 1]], 'ce qu\'il cherche et que j\'ai en trop (doublons, pas le brut possédé) ; ligne en double ignorée');
  assert.ok(!r.give.some(x => x.k === 'edgar markov'), '2 Edgar possédés : 1 dans le deck + 1 en réserve → rien à échanger (F5)');
  assert.ok(!r.give.some(x => x.k === 'lightning bolt'), 'seul exemplaire, utilisé par le deck');
  assert.deepEqual(r.give.find(x => x.k === 'arcane signet').s.lines, [['fr', 2]], 'mes doublons et leur langue');
  assert.deepEqual(r.sum, { get: { n: 3, q: 5, v: 15000 + 450, nv: 1 }, give: { n: 2, q: 2, v: 120 + 40, nv: 0 } }); assert.equal(r.n, 5);
  const none = C.tradeMatch(sh, [], [], null);
  assert.deepEqual([none.get, none.give, none.n, none.sum.get], [[], [], 0, { n: 0, q: 0, v: 0, nv: 0 }], 'visiteur sans collection ni recherche : rien');
  assert.equal(C.tradeMatch({}, want, spare).n, 0, 'partage vide');
  assert.equal(C.tradeMatch(sh, want, spare).get[0].u, null, 'sans fonction de prix : triées par nom');
  console.log('✓ tradeMatch : ses doublons ∩ ma recherche, sa recherche ∩ mes doublons (decks et réserve exclus), quantités, langues, valeurs');
}

/* ── QR code (src/qr.js) : décodeur indépendant écrit d'après la norme (tables recopiées, lecture façon ZXing), et matrices de référence ── */
const Q = createRequire(import.meta.url)('../src/qr.js');
const QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const QR_M = { 1: [[1, 26, 16]], 2: [[1, 44, 28]], 3: [[1, 70, 44]], 4: [[2, 50, 32]], 5: [[2, 67, 43]], 6: [[4, 43, 27]], 7: [[4, 49, 31]], 8: [[2, 60, 38], [2, 61, 39]], 9: [[3, 58, 36], [2, 59, 37]], 10: [[4, 69, 43], [1, 70, 44]] };      // niveau M : [blocs, octets, dont données]
const GF = { exp: [], log: [] }; { let x = 1; for (let i = 0; i < 255; i++) { GF.exp[i] = x; GF.log[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; } }
const gmul = (a, b) => (a && b ? GF.exp[(GF.log[a] + GF.log[b]) % 255] : 0);
const bchOk = (word, gen, dataBits, eccBits) => { let r = (word >> eccBits) << eccBits; for (let i = dataBits + eccBits - 1; i >= eccBits; i--) if ((r >> i) & 1) r ^= gen << (i - eccBits); return r === (word & ((1 << eccBits) - 1)); };
/** Matrice (lignes, 1 = foncé) → { v, mask, text } ; lève une erreur si un contrôle échoue (motifs, format, version, Reed-Solomon, remplissage). */
function qrDecode(m) {
  const n = m.length, v = (n - 17) / 4, get = (x, y) => m[y][x];
  assert.ok(Number.isInteger(v) && v >= 1 && v <= 10, 'taille ' + n);
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) assert.equal(get(ox + x, oy + y), +(x === 0 || x === 6 || y === 0 || y === 6 || (x > 1 && x < 5 && y > 1 && y < 5)), 'repère');
  for (let i = 8; i < n - 8; i++) { assert.equal(get(i, 6), +(i % 2 === 0), 'synchronisation'); assert.equal(get(6, i), +(i % 2 === 0)); }
  assert.equal(get(8, n - 8), 1, 'module toujours foncé');
  let f1 = 0, f2 = 0;      // format : copie autour du repère haut gauche, puis copie partagée bas gauche / haut droit (bit de poids fort d'abord)
  for (let x = 0; x < 6; x++) f1 = (f1 << 1) | get(x, 8);
  f1 = (f1 << 1) | get(7, 8); f1 = (f1 << 1) | get(8, 8); f1 = (f1 << 1) | get(8, 7);
  for (let y = 5; y >= 0; y--) f1 = (f1 << 1) | get(8, y);
  for (let y = n - 1; y >= n - 7; y--) f2 = (f2 << 1) | get(8, y);
  for (let x = n - 8; x < n; x++) f2 = (f2 << 1) | get(x, 8);
  assert.equal(f1, f2, 'deux copies du format'); const fmt = f1 ^ 0x5412;
  assert.ok(bchOk(fmt, 0x537, 5, 10), 'BCH du format'); assert.equal(fmt >> 13, 0, 'niveau M'); const mask = (fmt >> 10) & 7;
  if (v >= 7) { let vb = 0; for (let y = 5; y >= 0; y--) for (let x = n - 9; x >= n - 11; x--) vb = (vb << 1) | get(x, y); assert.equal(vb >> 12, v, 'version écrite'); assert.ok(bchOk(vb, 0x1F25, 6, 12), 'BCH de la version');
    let vb2 = 0; for (let x = 5; x >= 0; x--) for (let y = n - 9; y >= n - 11; y--) vb2 = (vb2 << 1) | get(x, y); assert.equal(vb2, vb, 'deux copies de la version'); }
  const fn = Array.from({ length: n }, () => new Uint8Array(n)), region = (l, t, w, h) => { for (let y = t; y < t + h; y++) for (let x = l; x < l + w; x++) fn[y][x] = 1; };
  region(0, 0, 9, 9); region(n - 8, 0, 8, 9); region(0, n - 8, 9, 8); region(6, 9, 1, n - 17); region(9, 6, n - 17, 1);
  const al = QR_ALIGN[v]; for (let a = 0; a < al.length; a++) for (let b = 0; b < al.length; b++) { if ((a === 0 && (b === 0 || b === al.length - 1)) || (a === al.length - 1 && b === 0)) continue; region(al[b] - 2, al[a] - 2, 5, 5);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) assert.equal(get(al[b] + dx, al[a] + dy), +(Math.max(Math.abs(dx), Math.abs(dy)) !== 1), 'alignement'); }
  if (v >= 7) { region(n - 11, 0, 3, 6); region(0, n - 11, 6, 3); }
  const masked = [(i, j) => (i + j) % 2 === 0, i => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0, (i, j) => ((i >> 1) + Math.floor(j / 3)) % 2 === 0, (i, j) => (i * j) % 6 === 0, (i, j) => (i * j) % 6 < 3, (i, j) => (i + j + (i * j) % 3) % 2 === 0][mask];      // i : ligne, j : colonne
  const raw = []; let up = true, cur = 0, nb = 0;
  for (let j = n - 1; j > 0; j -= 2) {
    if (j === 6) j--;
    for (let c = 0; c < n; c++) { const i = up ? n - 1 - c : c; for (let k = 0; k < 2; k++) { const x = j - k; if (fn[i][x]) continue; cur = (cur << 1) | (get(x, i) ^ +masked(i, x)); if (++nb === 8) { raw.push(cur); cur = nb = 0; } } }
    up = !up;
  }
  const groups = QR_M[v].flatMap(([k, len, dlen]) => Array.from({ length: k }, () => ({ len, dlen, d: [], e: [] })));
  let o = 0; const maxD = Math.max(...groups.map(g => g.dlen));
  for (let i = 0; i < maxD; i++) for (const g of groups) if (i < g.dlen) g.d.push(raw[o++]);
  for (let i = 0; i < groups[0].len - groups[0].dlen; i++) for (const g of groups) g.e.push(raw[o++]);
  assert.equal(o, groups.reduce((a, g) => a + g.len, 0), 'tous les octets lus');
  for (const g of groups) for (let k = 0; k < g.e.length; k++) { let s = 0; const ak = GF.exp[k]; for (const c of [...g.d, ...g.e]) s = gmul(s, ak) ^ c; assert.equal(s, 0, 'syndrome Reed-Solomon nul'); }
  const data = groups.flatMap(g => g.d), bits = data.flatMap(b => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1)); let p = 0;
  const take = k => { let x = 0; for (let i = 0; i < k; i++) x = (x << 1) | bits[p++]; return x; };
  assert.equal(take(4), 4, 'mode octets'); const len = take(v < 10 ? 8 : 16), bytes = Array.from({ length: len }, () => take(8));
  const rest = bits.length - p; if (rest >= 4) assert.equal(take(4), 0, 'fin de message'); else take(rest);
  while (p % 8) assert.equal(take(1), 0, 'complément à l\'octet');
  for (let pad = 0xEC; p < bits.length; pad ^= 0xEC ^ 0x11) assert.equal(take(8), pad, 'remplissage 0xEC / 0x11');
  return { v, mask, text: new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)) };
}
{
  const url = 'https://card.m2s-photo.fr/?p=Abcdef1234567890XyZw', d = qrDecode(Q.qrMatrix(url).m);
  assert.deepEqual([d.text, d.v], [url, 4], 'lien de partage (49 octets) : version 4');
  { const m = Q.qrMatrix(url).m.map(r => r.slice()), n = m.length; m[n - 1][n - 1] ^= 1; assert.throws(() => qrDecode(m), /Reed-Solomon/, 'le décodeur voit un module faux');
    const f = Q.qrMatrix(url).m.map(r => r.slice()); f[8][0] ^= 1; assert.throws(() => qrDecode(f), /format/, 'et un format abîmé'); }
  for (let v = 1; v <= 10; v++) {      // chaque version, pleine (capacité M en mode octets), tous les masques
    const cap = Q.qrDataCap(v), len = Math.floor((cap * 8 - 4 - (v < 10 ? 8 : 16)) / 8), t = ('https://card.m2s-photo.fr/?p=' + 'Xy7'.repeat(80)).slice(0, len);
    for (let k = 0; k < 8; k++) { const mx = Q.qrMatrix(t, k), r = qrDecode(mx.m); assert.deepEqual([r.text, r.v, r.mask], [t, v, k], `version ${v}, masque ${k}`); }
    if (v < 10) assert.equal(Q.qrMatrix(t + 'z').v, v + 1, 'un octet de plus : version suivante');
  }
  const fr = 'Liste d\'échange · Anneau solaire ✓'; assert.equal(qrDecode(Q.qrMatrix(fr).m).text, fr, 'UTF-8');
  assert.throws(() => Q.qrMatrix('x'.repeat(214)), /trop long/, 'au-delà de la version 10 : refusé'); assert.equal(Q.qrMatrix('x'.repeat(213)).v, 10);
  // matrices de référence (Project Nayuki, qrcodegen 1.8.0, niveau M, masque automatique) : identiques bit à bit, masque compris
  const REF = [['Mana Orbit', 1, 4, 'fe83fc13506e9cbb7565dba9aec16507faafe018008bafcdae7581caa5f9fa26e540004eeffa53d04881baa995d251ee8a2104738feb608'],
    [url, 4, 4, 'fea6a13fc1275c506e9adbabb75b1895dba8cd7aec167a5107faaaaafe01e4fa008be1e5fc9c9db3e392a5ebd152b5b3f001ef4867c9a5b3dc328ae4ad84d10b8ef07628dfa91450d3a3a3c151d555204c8a36f832a7dd68349c386812ce5c1a98b9fae2dbccfd806aa2c5bfb948ab504740d11baf39efddd121fdd2e98c34e104f3b988fed676c48'],
    ['https://card.m2s-photo.fr/?p=AbcdefGhijklmnopQRST&utm=0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop-ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8, 4, 'fed95d365cbfc116ad57c9d06e9bbcc4fa6bb756dc9142a5dba8243fb082ec1425b1055107faaaaaaaaafe0103346313008bad73f7c87c8e3d0539cdb328d53dbec3109daf5f701d9f7e7a4cbd4dd8a5aba4c9dc194bae00c88c5b9841ed0f92255edb2895f2bf4a585246d3a5baa2d1518c1a4f87385f76713b5064533d1cc9f127af63761b107eebaffc6be0f13bd463f916babf32b19eab647f6719074733e62efc80ff0c98d260fda448a087982a87a3699115d0dd714950a10e3c28614ef612248522b85676fa41604dd6cf69661ac5b7720e51929af1c63dac73a2e32319eb7623895dbef1711d07c56d6e58e18c1443d835e3f15be5dcfa006155118dc73fa8bbac81aa10417ac6df516bad28fe6fffe5d059d07c1106e91fd0fa3acf04ff88d2e506feb774f09d598']];
  for (const [t, v, mask, hex] of REF) {
    const mx = Q.qrMatrix(t), bits = [...hex].flatMap(h => [...parseInt(h, 16).toString(2).padStart(4, '0')].map(Number)), n = v * 4 + 17;
    assert.deepEqual([mx.v, mx.mask], [v, mask], 'version et masque de la référence : ' + t.slice(0, 20));
    for (let y = 0; y < n; y++) assert.deepEqual([...mx.m[y]], bits.slice(y * n, y * n + n), `ligne ${y} identique à la référence (${t.slice(0, 20)}…)`);
    assert.equal(qrDecode(mx.m).text, t);
  }
  // SVG : un chemin qui couvre exactement les modules foncés, marge de 4 modules
  const { n, svg } = Q.qrSvg(url), mx = Q.qrMatrix(url), got = Array.from({ length: mx.n }, () => new Uint8Array(mx.n));
  assert.equal(n, mx.n + 8); assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"`));
  for (const [, x, y, w] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) for (let i = 0; i < +w; i++) { assert.equal(got[y - 4][x - 4 + i], 0, 'jamais deux fois'); got[y - 4][x - 4 + i] = 1; }
  assert.deepEqual(got.map(r => [...r].join('')), [...mx.m].map(r => [...r].join('')), 'SVG = matrice');
  console.log('✓ QR code : décodé (repères, format, version, masque, Reed-Solomon, texte) pour les versions 1 à 10 et les 8 masques, identique aux matrices de référence, SVG fidèle');
}
console.log('test-trade OK');
