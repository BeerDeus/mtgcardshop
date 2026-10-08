// gen-prices.mjs : prix « à partir de » par carte, lus en flux dans le fichier complet de Scryfall
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pxAdd, pxText, pxStream } from '../gen-prices.mjs';

const card = (name, eur, usd, extra = {}) => ({ name, prices: { eur, usd, eur_foil: extra.ef ?? null, usd_foil: null }, games: ['paper'], set_type: 'expansion', layout: 'normal', border_color: 'black', ...extra });
const m = new Map();
pxAdd(m, card('Sol Ring', '1.50', '1.20'));
pxAdd(m, card('Sol Ring', '0.90', '2.00'));
pxAdd(m, card('Sol Ring', '0.10', '0.10', { border_color: 'gold', set_type: 'memorabilia' }));      // bordure dorée : pas une vraie carte de jeu
pxAdd(m, card('Sol Ring', '0.05', null, { digital: true }));
pxAdd(m, card('Sol Ring', '0.05', null, { games: ['mtgo'] }));
pxAdd(m, card('Foil Only', null, null, { ef: '3.00' }));
pxAdd(m, card('Sans Prix', null, null));
pxAdd(m, card('Token', '0.10', null, { layout: 'token' }));
assert.deepEqual(m.get('Sol Ring'), { e: 90, u: 120 }, 'moins cher par devise, impressions exotiques ignorées');
assert.deepEqual(m.get('Foil Only'), { e: 300, u: 0 }, 'foil seulement : prix foil');
assert.equal(m.has('Token'), false);
const t = pxText(m, '2026-10-08');
assert.equal(t, '#MOPX1 2026-10-08 2\nFoil Only\t300\t\nSol Ring\t90\t120\n', 'cartes sans prix absentes, triées');
console.log('✓ pxAdd / pxText : plus bas prix papier, bordures dorées / numériques / jetons ignorés');

const lines = ['[', JSON.stringify(card('A', '1.00', '1.00')) + ',', JSON.stringify(card('B', '2.00', null)) + ',', JSON.stringify(card('A', '0.50', null)), ']'].join('\n');
const chunks = []; for (let i = 0; i < lines.length; i += 7) chunks.push(Buffer.from(lines.slice(i, i + 7)));      // morceaux coupés n'importe où
const m2 = new Map(), n = await pxStream(Readable.from(chunks), m2);
assert.equal(n, 3); assert.deepEqual(m2.get('A'), { e: 50, u: 100 }); assert.deepEqual(m2.get('B'), { e: 200, u: 0 });
console.log('✓ pxStream : lecture en flux, objets coupés entre deux morceaux');
{ // fichier sur une seule ligne (minifié), accolades dans les chaînes, puis le même compressé en gzip
  const { gzipSync } = await import('node:zlib');
  const one = JSON.stringify([card('C', '3.00', null, { oracle_text: 'Pay {1}: draw "a card" \\ }' }), card('D', '4.00', '5.00')]);
  const cut = s => { const out = []; for (let i = 0; i < s.length; i += 5) out.push(Buffer.from(s.slice(i, i + 5))); return out; };
  const m3 = new Map(); assert.equal(await pxStream(Readable.from(cut(one)), m3), 2); assert.deepEqual(m3.get('C'), { e: 300, u: 0 }); assert.deepEqual(m3.get('D'), { e: 400, u: 500 });
  const gz = gzipSync(Buffer.from(one)), parts = []; for (let i = 0; i < gz.length; i += 7) parts.push(gz.subarray(i, i + 7));
  const m4 = new Map(); assert.equal(await pxStream(Readable.from(parts), m4), 2); assert.deepEqual(m4.get('D'), { e: 400, u: 500 });
  console.log('✓ pxStream : fichier minifié sur une ligne, accolades et guillemets dans les textes, gzip détecté');
}
console.log('\nPRICES OK');
