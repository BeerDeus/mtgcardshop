// Générateur EDHREC : fonctions pures sur des JSON de forme EDHREC, puis exécution complète contre de faux EDHREC / Scryfall / Archidekt locaux.
import './setup-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { normKey, edhSlug, namesOf, cardviewsOf, commandersOf, moreOf, avgLines, archidektDeck, archidektList, buildEdh, themesOf, GENERAL_THEMES } from '../gen-edhrec.mjs';
const C = createRequire(import.meta.url)('../src/core.js'), EB = createRequire(import.meta.url)('../src/edhbin.js');

test('normKey = ownKey de l\'app ; edhSlug', () => {
  for (const n of ["Atraxa, Praetors' Voice", 'Fire // Ice', 'Lim-Dûl the Necromancer', 'Æther Vial', 'Jötun Grunt', 'Sol Ring', "Y'shtola, Night's Blessed", 'Kenrith, the Returned King']) assert.equal(normKey(n), C.ownKey(n), n);
  assert.equal(edhSlug("Atraxa, Praetors' Voice"), 'atraxa-praetors-voice'); assert.equal(edhSlug('Esika, God of the Tree // The Prismatic Bridge'), 'esika-god-of-the-tree'); assert.equal(edhSlug("Y'shtola, Night's Blessed"), 'yshtola-nights-blessed');
});
const LIST = { header: 'Top', container: { json_dict: { cardlists: [{ header: 'Commanders', tag: 'commanders', more: '/pages/commanders/year-2.json', cardviews: [
  { sanitized: 'atraxa-praetors-voice', name: "Atraxa, Praetors' Voice", num_decks: 35000, color_identity: ['G', 'W', 'U', 'B'] },
  { sanitized: 'tymna-the-weaver', name: 'Tymna the Weaver + Thrasios, Triton Hero', num_decks: 9000, color_identity: ['W', 'U', 'B', 'G'] },
  { sanitized: 'sans-decks', name: 'Zéro', num_decks: 0 }, { sanitized: 'Mauvais Slug!', name: 'X', num_decks: 5 }, { name: 'Sans slug', num_decks: 5 }, null] }] } } };
test('commandersOf / cardviewsOf / moreOf : formes EDHREC, entrées invalides ignorées', () => {
  const l = commandersOf(LIST); assert.equal(l.length, 2);
  assert.deepEqual(l[0], { slug: 'atraxa-praetors-voice', names: ["Atraxa, Praetors' Voice"], decks: 35000, ci: 'WUBG' }, 'identité triée WUBRG');
  assert.deepEqual(l[1].names, ['Tymna the Weaver', 'Thrasios, Triton Hero'], 'paire : deux noms');
  assert.equal(moreOf(LIST), 'commanders/year-2.json'); assert.equal(moreOf({ a: { next: 'https://evil.example/x.json' } }), ''); assert.equal(moreOf({}), ''); assert.equal(moreOf({ more: 'https://json.edhrec.com/pages/commanders/p3.json' }), 'commanders/p3.json');
  assert.equal(cardviewsOf({ deep: { a: [{ sanitized: 'x', name: 'X' }] } }).length, 1, 'repli : parcours complet'); assert.equal(commandersOf(null).length, 0);
});
test('namesOf : paire « A // B » ou « A + B », carte à deux faces = un seul nom', () => {
  assert.deepEqual(namesOf("Kraum, Ludevic's Opus // Tymna the Weaver", 'kraum-ludevics-opus-tymna-the-weaver'), ["Kraum, Ludevic's Opus", 'Tymna the Weaver']);
  assert.deepEqual(namesOf('Frodo, Adventurous Hobbit // Sam, Loyal Attendant', 'frodo-adventurous-hobbit-sam-loyal-attendant'), ['Frodo, Adventurous Hobbit', 'Sam, Loyal Attendant']);
  assert.deepEqual(namesOf('Esika, God of the Tree // The Prismatic Bridge', 'esika-god-of-the-tree'), ['Esika, God of the Tree // The Prismatic Bridge'], 'double face : adresse = première face');
  assert.deepEqual(namesOf('Tymna the Weaver + Thrasios, Triton Hero', 'x'), ['Tymna the Weaver', 'Thrasios, Triton Hero']);
  assert.deepEqual(namesOf('Sol Ring', 'sol-ring'), ['Sol Ring']); assert.deepEqual(namesOf('', 'x'), []);
});
test('avgLines : formes deck[] / deck{} / archidekt[], commandant retiré, fusion, nettoyage', () => {
  const a = avgLines({ deck: ["1 Atraxa, Praetors' Voice", '1 Sol Ring', '1x Arcane Signet *F*', '7 Forest', '1 Command Tower (CMM) 350', '1 Sol Ring', 'Mystic Remora'] }, ["Atraxa, Praetors' Voice"]);
  assert.deepEqual(a, [['Sol Ring', 2], ['Arcane Signet', 1], ['Forest', 7], ['Command Tower', 1], ['Mystic Remora', 1]]);
  assert.deepEqual(avgLines({ deck: { commander: ['X'], cards: { Creatures: [['Llanowar Elves', 1]], Lands: [['Forest', 5], ['Forest', 2]] } } }, ['X']), [['Llanowar Elves', 1], ['Forest', 7]]);
  assert.deepEqual(avgLines({ archidekt: [{ c: 'Sol Ring', q: 1 }, { c: 'Island', q: 3 }] }), [['Sol Ring', 1], ['Island', 3]]);
  assert.deepEqual(avgLines({}), []); assert.deepEqual(avgLines(null), []); assert.equal(avgLines({ deck: ['1 ' + 'x'.repeat(5)] })[0][1], 1);
});
test('themesOf : seulement les thèmes généraux, au moins 1 % des decks du commandant (et 5), triés, 8 au plus', () => {
  const tl = [['control', 'Control', 3260], ['cats', 'Cats', 900], ['lifegain', 'Lifegain', 1254], ['pingers', 'Pingers', 800], ['discard', 'Discard', 300], ['mill', 'Mill', 90], ['stax', 'Stax', 456], ['stax', 'Stax', 999], ['aristocrats', 'Aristocrats', 0], ['x', '', 900], ['+1/+1-counters', '+1/+1 Counters', 700], ['sans nombre', 'Burn', 'abc']].map(([slug, value, count]) => ({ slug, value, count }));
  assert.deepEqual(themesOf({ panels: { taglinks: tl } }, 55977).map(t => t[0]), ['control', 'lifegain', 'stax', '+1/+1-counters'], '1 % de 55 977 = 560 : Discard (300) trop rare ; le 1er Stax (456) aussi, le doublon (999) passe ; Cats / Pingers : pas des thèmes généraux');
  assert.deepEqual(themesOf({ panels: { taglinks: tl } }, 3000).map(t => t[0]), ['control', 'lifegain', '+1/+1-counters', 'stax', 'discard', 'mill'], '1 % de 3 000 = 30 : Mill (90) aussi, trié par nombre ; doublon de slug : le 1er seul');
  assert.deepEqual(themesOf({ panels: { taglinks: tl } }, 3000), [['control', 'Control', 3260], ['lifegain', 'Lifegain', 1254], ['+1/+1-counters', '+1/+1 Counters', 700], ['stax', 'Stax', 456], ['discard', 'Discard', 300], ['mill', 'Mill', 90]]);
  assert.deepEqual(themesOf({ taglinks: [{ slug: 'x y', value: 'Control\tX', count: 50 }, { slug: 'burn', value: 'Burn', count: 4 }, { slug: 'control', value: 'Control', count: 5 }] }, 0), [['control', 'Control', 5]], 'forme à la racine ; décompte inconnu : plancher de 5 decks ; tabulation du libellé nettoyée (non général : écarté)');
  assert.deepEqual(themesOf({}), []); assert.deepEqual(themesOf(null, 10), []); assert.deepEqual(themesOf({ panels: { taglinks: 'x' } }), []);
  const many = [...GENERAL_THEMES].slice(0, 20).map((v, i) => ({ slug: v.replace(/ /g, '-') + i, value: v, count: 1000 - i })); assert.equal(themesOf({ panels: { taglinks: many } }, 1000).length, 8, '8 au plus');
  for (const v of ['control', 'lifegain', 'discard', 'mill', 'sacrifice', 'aristocrats', 'stax', 'combo', 'reanimator']) assert.ok(GENERAL_THEMES.has(v), v);
  for (const v of ['cats', 'wizards', 'humans', 'dragons', 'pingers', 'aikido', 'foretell', 'cascade', 'commander matters']) assert.ok(!GENERAL_THEMES.has(v), v + ' n\'est pas un thème général');
});
test('chaque thème général a sa description et un nom affichable côté appli (src/edh.js)', () => {
  const src = readFileSync(new URL('../src/edh.js', import.meta.url), 'utf8'), keys = b => [...new RegExp('const ' + b + ' = \\{([\\s\\S]*?)\\n?\\};?\\n').exec(src)[1].matchAll(/'([^']+)': '/g)].map(m => m[1]);
  const info = keys('EDH_THEME_INFO'), fr = keys('EDH_THEME_FR');
  assert.deepEqual([...GENERAL_THEMES].filter(t => !info.includes(t)), [], 'thèmes sans description'); assert.deepEqual(info.filter(t => !GENERAL_THEMES.has(t)), [], 'descriptions de thèmes qui n\'existent pas');
  assert.deepEqual(fr.filter(t => !GENERAL_THEMES.has(t)), [], 'noms français de thèmes qui n\'existent pas'); assert.equal(info.length, GENERAL_THEMES.size);
  const text = Object.fromEntries([...src.match(/const EDH_THEME_INFO = \{([\s\S]*?)\n\};/)[1].matchAll(/'([^']+)': '((?:[^'\\]|\\.)*)'/g)].map(m => [m[1], m[2]])); assert.ok(Object.values(text).every(v => v.length >= 200 && v.length <= 420 && / Ex\. : [^·]+( · [^·]+){0,2}$/.test(v)), 'description de 200 à 420 caractères, terminée par « Ex. : » et 1 à 3 cartes séparées par « · »'); assert.ok(!/"/.test(Object.values(text).join('')), 'pas de guillemets droits');
});
test('archidektDeck / archidektList / buildEdh : roundtrip avec parseEdh', () => {
  const d = archidektDeck({ name: 'Mon\tdeck', viewCount: 1200, updatedAt: '2026-05-04T03:02:01.123Z', cards: [{ quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Edgar Markov' }, prices: { cm: 3.5 } } }, { quantity: 1, categories: ['Ramp'], card: { oracleCard: { name: 'Sol Ring' }, prices: { cm: 5, cmMinimum: 1.2 } } }, { quantity: 1, categories: ['Maybeboard'], card: { oracleCard: { name: 'Nope' }, prices: { cm: 99 } } }, { quantity: 2, categories: [], card: { name: 'Plains', prices: { tcg: 0.1 } } }] });
  assert.deepEqual(d.cmd, ['Edgar Markov']); assert.deepEqual(d.cards, [['Sol Ring', 1], ['Plains', 2]]); assert.equal(d.name, 'Mon deck'); assert.equal(d.views, 1200);
  assert.equal(d.u, '2026-05-04'); assert.equal(d.eur, 350 + 120 + 20, 'prix : impression la moins chère (minimum) d\'abord, commandant compris, maybeboard exclu, repli TCGplayer');
  assert.deepEqual(archidektList({ results: [{ id: 5, name: 'A', viewCount: 9, updatedAt: '2025-01-02T00:00:00Z', size: 100, edhBracket: 5 }, { id: 'x' }, null] }), [{ id: 5, name: 'A', views: 9, u: '2025-01-02', size: 100, br: 5 }]); assert.deepEqual(archidektList({ decks: [{ id: 7 }] }).map(x => x.id), [7]); assert.deepEqual(archidektList(null), []);
  const txt = buildEdh({ at: '2026-10-05T00:00:00Z', cmds: [{ slug: 'edgar-markov', names: ['Edgar Markov'], decks: 10, ci: 'WBR' }, { slug: 'tt', names: ['A', 'B'], decks: 5, ci: '' }], decks: [{ slug: 'edgar-markov', src: 'archidekt', label: d.name + ' · 1 200 vues', url: 'https://archidekt.com/decks/1', cards: d.cards }, { slug: 'tt', src: 'edhrec', label: '', url: 'javascript:x', cards: [['Sol Ring', 1]] }], price: new Map([['Sol Ring', 150], ['Gratuit', 0]]), img: new Map([['edgar-markov', 'front/a/b/c.jpg']]) });
  const p = C.parseEdh(txt); assert.equal(p.v, 1); assert.equal(p.cmds.length, 2); assert.equal(p.cmds[0].img, 'https://cards.scryfall.io/small/front/a/b/c.jpg'); assert.deepEqual(p.cmds[1].keys, ['a', 'b']);
  assert.equal(p.decks[0].src, 'archidekt'); assert.equal(p.decks[0].url, 'https://archidekt.com/decks/1'); assert.equal(p.decks[1].url, ''); assert.equal(p.price.get('sol ring'), 150); assert.ok(!p.price.has('gratuit'));
});

/* ── exécution complète contre de faux serveurs ──────────────────────────────────────────────── */
const NAMES = Array.from({ length: 120 }, (_, i) => `Commandant ${String.fromCharCode(65 + i % 26)}${i}`);
const slugOf = n => edhSlug(n);
const CARDS = Array.from({ length: 80 }, (_, i) => `Carte ${i}`);
const REC = new Date(Date.now() - 7 * 86400000).toISOString();      // decks Archidekt « récents » : mis à jour il y a une semaine
function fake({ lists = true, scryList = false, noArch = false, gc = 'ok', archN = 1, month = '', oldArch = false } = {}) {
  const seen = { avg: 0, scry: 0, arch: 0, search: 0, archDeck: 0 };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), send = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const cv = (from, to) => NAMES.slice(from, to).map((n, i) => ({ sanitized: slugOf(n), name: n, num_decks: 5000 - (from + i) * 10, color_identity: ['W', 'U'].slice(0, 1 + (from + i) % 2) }));
      if (u.pathname === '/edh/commanders/year.json') return lists ? send({ container: { json_dict: { cardlists: [{ cardviews: cv(0, 70), more: '/pages/commanders/year-2.json' }] } } }) : send({}, 404);
      if (u.pathname === '/edh/commanders/year-2.json') return lists ? send({ container: { json_dict: { cardlists: [{ cardviews: cv(70, 120) }] } } }) : send({}, 404);
      // liste du mois : 'ok' (en-tête « Past Month », un commandant récent absent de la liste longue) · 'wrong' (EDHREC renvoie en fait la liste longue)
      const mv = (n, d) => ({ sanitized: slugOf(n), name: n, num_decks: d, color_identity: ['B'] });
      if (u.pathname === '/edh/commanders/month.json' && month === 'ok') return send({ container: { json_dict: { cardlists: [{ header: 'Past Month', tag: 'pastmonth', more: '/pages/commanders/month-pastmonth-1.json', cardviews: [mv('Nouveau Commandant', 900), mv(NAMES[50], 800), mv(NAMES[0], 100)] }] } } });
      if (u.pathname === '/edh/commanders/month-pastmonth-1.json' && month === 'ok') return send({ container: { json_dict: { cardlists: [{ header: 'Past Month', cardviews: [mv(NAMES[10], 3)] }] } } });
      if (u.pathname === '/edh/commanders/month.json' && month === 'wrong') return send({ container: { json_dict: { cardlists: [{ header: 'Past 2 Years', tag: 'past2years', cardviews: [mv(NAMES[99], 99999)] }] } } });
      if (u.pathname.startsWith('/edh/commanders/')) return send({}, 404);
      const m = /^\/edh\/average-decks\/(.+)\.json$/.exec(u.pathname);
      if (m) {
        seen.avg++; const n = NAMES.find(x => slugOf(x) === m[1]); if (!n || NAMES.indexOf(n) % 17 === 5) return send({}, 404);
        const ix = NAMES.indexOf(n), tg = [{ count: 400, slug: 'control', value: 'Control' }, { count: 300, slug: 'cats', value: 'Cats' }, { count: 120, slug: 'lifegain', value: 'Lifegain' }, { count: 3, slug: 'mill', value: 'Mill' }, ...(ix % 3 === 0 ? [{ count: 90, slug: 'discard', value: 'Discard' }] : [])];
        return send({ deck: ['1 ' + n, ...CARDS.slice(0, 60).map(c => '1 ' + c), '12 Forest', '1 Fire // Ice'], panels: { taglinks: tg } });
      }
      if (u.pathname === '/scry/cards/collection' && req.method === 'POST') {
        seen.scry++; const ids = JSON.parse(body).identifiers.map(i => i.name), data = [];
        for (const n of ids) { if (/Carte 7$/.test(n)) continue; data.push({ name: n === 'Fire' ? 'Fire // Ice' : n, color_identity: ['W'], prices: { eur: n === 'Carte 1' ? '2.50' : n === 'Carte 2' || n === 'Carte 3' ? null : '0.10', eur_foil: n === 'Carte 3' ? '9.99' : null }, image_uris: { small: `https://cards.scryfall.io/small/front/a/b/${slugOf(n)}.jpg?17` } }); }
        return send({ object: 'list', data });
      }
      if (u.pathname === '/scry/cards/search' && /^is:g/.test(u.searchParams.get('q'))) {      // Game Changers : 'ok' · 'variant' (la 1re écriture est refusée) · 'none' · 'few' (trop peu pour être plausible)
        const q = u.searchParams.get('q'); (seen.gcq = seen.gcq || []).push(q);
        if (gc === 'none' || (gc === 'variant' && q === 'is:gamechanger')) return send({ object: 'error', code: 'bad_request', details: 'Unknown is: value' }, 400);
        return send({ has_more: false, data: Array.from({ length: gc === 'few' ? 3 : 25 }, (_, i) => ({ name: i === 0 ? 'Fire // Ice' : i === 1 ? 'Carte 1' : 'Game Changer ' + i })) });
      }
      if (u.pathname === '/scry/cards/search') { seen.search++; return send({ has_more: false, data: scryList ? NAMES.map(n => ({ name: n, color_identity: ['G'] })) : [] }); }
      // Archidekt : archN decks par commandant (ids 100 + i + 1000 j, du plus au moins vu, le j-ième coûte 1 + 2j € la carte) ; bracket 5 : un deck cEDH (id 20100 + i).
      // Le 3e commandant (carte à deux faces) n'est trouvé que sous son nom complet « Recto // Verso » ; oldArch : decks mis à jour il y a 2 ans.
      if (u.pathname === '/arch/decks/v3/') {
        seen.arch++; if (noArch) return send({ error: 'x' }, 500); let c = u.searchParams.get('commanderName'); assert.equal(u.searchParams.get('deckFormat'), '3'); (seen.archQ = seen.archQ || []).push(c);
        if (c === NAMES[2]) return send({ count: -1, next: null, results: [], message: 'No commander name `' + c + '` was found' });
        if (c === NAMES[2] + ' // Verso') c = NAMES[2];
        const i = NAMES.indexOf(c), at = oldArch ? '2024-01-02T03:04:05Z' : REC;
        if (u.searchParams.get('edhBracket') === '5') return send({ results: [{ id: 20100 + i, name: 'cEDH ' + c, viewCount: 8000, updatedAt: at, size: 100, edhBracket: 5 }] });
        return send({ count: archN, next: null, results: Array.from({ length: archN }, (_, j) => ({ id: 100 + i + 1000 * j, name: (j ? 'Autre deck ' : 'Deck ') + c, viewCount: 4200 - j * 100, updatedAt: at, size: 100, edhBracket: j === 0 ? 3 : null })) });
      }
      if (u.pathname === '/scry/cards/named') return u.searchParams.get('exact') === NAMES[2] ? send({ name: NAMES[2] + ' // Verso' }) : send({ object: 'error' }, 404);
      if (u.pathname === '/top16/api/graphql' && req.method === 'POST') { seen.top16 = (seen.top16 || 0) + 1; assert.match(JSON.parse(body).query, /SIX_MONTHS/); return send({ data: { commanders: { edges: [{ node: { name: NAMES[0] } }, { node: { name: 'Inconnu / Personne' } }] } } }); }
      const a = /^\/arch\/decks\/(\d+)\/$/.exec(u.pathname);
      if (a) { seen.archDeck++; const id = Number(a[1]), n = NAMES[(id - 100) % 1000], eur = id >= 20000 ? 9 : 1 + 2 * Math.floor(id / 1000), pr = { prices: { cm: eur } }, at = oldArch ? '2024-01-02T03:04:05Z' : REC; return send({ name: 'Deck ' + n, viewCount: 4200, updatedAt: at, cards: [{ quantity: 1, categories: ['Commander'], card: { oracleCard: { name: n }, ...pr } }, ...CARDS.slice(10, 80).map(c => ({ quantity: 1, categories: [], card: { oracleCard: { name: c }, ...pr } })), { quantity: id === 101 ? 80 : 25, categories: [], card: { oracleCard: { name: 'Forest' }, prices: { cm: 0.02 } } }] }); }      // 70 + 25 = 95 cartes ; le 1er deck du 2e commandant : 150 (écarté)
      send({ error: 'nf' }, 404);
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` })));
}
const run = (base, env, out) => new Promise(res => {
  const p = spawn('node', ['gen-edhrec.mjs', out], { env: { ...process.env, EDH_BASE: base + '/edh/', SCRY_BASE: base + '/scry/', ARCH_BASE: base + '/arch/', EDH_TOP16_BASE: base + '/top16/', EDH_GAP: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', code => res({ code, o }));
});
test('exécution complète : liste paginée, decks moyens, Archidekt, prix et images Scryfall', async () => {
  const f = await fake(), dir = mkdtempSync(join(tmpdir(), 'edh-')), out = join(dir, 'edh.tsv');
  try {
    const r = await run(f.base, { EDH_TOP: '60', EDH_ARCH: '1', EDH_ARCH_TOP: '3', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '100' }, out); assert.equal(r.code, 0, r.o);
    assert.ok(existsSync(out)); const p = C.parseEdh(readFileSync(out, 'utf8'));
    assert.equal(p.v, 1); assert.equal(p.cmds.length, 120, 'les deux pages de la liste'); assert.equal(p.cmds[0].names[0], 'Commandant A0'); assert.ok(p.cmds[0].decks > p.cmds[1].decks, 'triés par decks');
    const edh = p.decks.filter(d => d.src === 'edhrec'), arch = p.decks.filter(d => d.src === 'archidekt');
    assert.equal(edh.length, 60 - edhMissing(60), 'decks moyens : 60 premiers moins ceux en 404 (indices ≡ 5 mod 17)');
    assert.ok(edh.every(d => d.cards.length >= 60 && d.cards.some(c => c[1] === 'Fire // Ice')), 'cartes lues, DFC conservée');
    assert.ok(!edh[0].cards.some(c => C.ownKey(c[1]) === C.ownKey(NAMES[0])), 'commandant retiré du deck');
    assert.ok(edh[0].cards.some(c => c[1] === 'Forest' && c[2] === 12), 'basics avec leur quantité');
    assert.ok(!arch.some(d => d.slug === C.parseEdh(readFileSync(out, 'utf8')).cmds[1].slug), 'deck Archidekt de 150 cartes écarté (taille hors 90-101)');
    assert.ok(arch.every(d => /^https:\/\/archidekt\.com\/decks\/\d+$/.test(d.url)), 'liens Archidekt');
    assert.deepEqual(arch.map(d => [d.cmd.names[0], d.label]).sort(), [[NAMES[0], 'Deck ' + NAMES[0]], [NAMES[0], 'Deck ' + NAMES[0]], [NAMES[2], 'Deck ' + NAMES[2]]].sort(), 'un deck récent par commandant (le 2e : 150 cartes, écarté), le cEDH du 1er ; le 3e retrouvé sous son nom à deux faces');
    assert.ok(f.seen.archQ.includes(NAMES[2] + ' // Verso'), 'nom complet demandé à Scryfall puis cherché'); assert.equal(f.seen.top16, 1, 'EDHTop16 interrogé une fois');
    assert.equal(p.price.get('carte 1'), 250); assert.equal(p.price.get('carte 0'), 10); assert.ok(!p.price.has('carte 2'), 'sans prix : absent'); assert.equal(p.price.get('carte 3'), 999, 'repli sur le prix foil'); assert.ok(!p.price.has('carte 7'), 'inconnue de Scryfall');
    assert.equal(p.price.get('fire'), 10, 'DFC : clé = première face');
    assert.equal(p.cmds[0].img, 'https://cards.scryfall.io/small/front/a/b/commandant-a0.jpg', 'image sans paramètre ?');
    assert.ok(f.seen.scry >= 2 && f.seen.scry <= 5, 'cartes demandées par lots de 75 (' + f.seen.scry + ' requêtes)');
    assert.match(r.o, /commandants, \d+ decks \(dont \d+ Archidekt\), \d+ prix/);
    assert.equal(p.gc.size, 25, 'Game Changers lus'); assert.ok(p.gc.has('fire') && p.gc.has('carte 1') && p.gc.has('game changer 24'), 'clé = première face'); assert.deepEqual(f.seen.gcq, ['is:gamechanger']);
    assert.match(readFileSync(out, 'utf8'), /\nG\tFire\n/, 'nom de première face écrit');
  } finally { f.srv.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('classement du mois : la liste du mois d\'abord (commandant récent compris), compte long gardé, rang et tier sur le mois ; liste « du mois » qui n\'en est pas une : ignorée', async () => {
  const f = await fake({ month: 'ok' }), dir = mkdtempSync(join(tmpdir(), 'edh-')), out = join(dir, 'edh.bin.gz');
  try {
    const r = await run(f.base, { EDH_TOP: '40', EDH_ARCH: '0', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '100' }, out); assert.equal(r.code, 0, r.o);
    assert.match(r.o, /4 dans la liste du mois/);
    const raw = EB.edhUnpack(gunzipSync(readFileSync(out))), p = C.parseEdhBin(gunzipSync(readFileSync(out)));
    assert.equal(raw.rk, 'month'); assert.equal(p.rk, 'month');
    assert.deepEqual(raw.cmds.slice(0, 4).map(c => [c.names[0], c.dm]), [['Nouveau Commandant', 900], [NAMES[50], 800], [NAMES[0], 100], [NAMES[10], 3]], 'le mois d\'abord, dans son ordre');
    const by = n => p.cmds.find(c => c.names[0] === n);
    assert.equal(by(NAMES[50]).decks, 5000 - 500, 'compte long conservé (seuils des thèmes, affichage)'); assert.equal(by(NAMES[50]).dm, 800);
    assert.equal(by(NAMES[50]).rank, 2); assert.equal(by(NAMES[0]).rank, 3); assert.equal(by(NAMES[10]).rank, 4); assert.equal(by(NAMES[1]).rank, 5, 'hors du mois : après, sur le compte long');
    assert.equal(by(NAMES[50]).tier, 'S'); assert.equal(by('Nouveau Commandant').decks, 900, 'commandant récent : compte du mois');
    assert.ok(p.decks.some(d => d.cmd.names[0] === NAMES[50]), 'deck moyen lu pour un commandant du mois classé loin sur la liste longue');
  } finally { f.srv.close(); rmSync(dir, { recursive: true, force: true }); }
  const g = await fake({ month: 'wrong' }), dir2 = mkdtempSync(join(tmpdir(), 'edh-')), out2 = join(dir2, 'edh.bin.gz');
  try {
    const r = await run(g.base, { EDH_TOP: '40', EDH_ARCH: '0', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '100' }, out2); assert.equal(r.code, 0, r.o);
    assert.match(r.o, /période « long » au lieu de « month » : ignorée/); assert.match(r.o, /classement sur la liste longue/);
    const raw = EB.edhUnpack(gunzipSync(readFileSync(out2))); assert.equal(raw.rk, ''); assert.ok(raw.cmds.every(c => c.dm === 0)); assert.equal(raw.cmds[0].names[0], NAMES[0]);
  } finally { g.srv.close(); rmSync(dir2, { recursive: true, force: true }); }
});
const edhMissing = n => { let c = 0; for (let i = 0; i < n; i++) if (i % 17 === 5) c++; return c; };
test('Game Changers : 2e écriture si la 1re est refusée ; liste absente ou trop courte → pas de lignes G (le fichier reste valide)', async () => {
  for (const [gc, expect, queries] of [['variant', 25, ['is:gamechanger', 'is:gamechangers']], ['none', 0, ['is:gamechanger', 'is:gamechangers', 'is:gc']], ['few', 0, ['is:gamechanger', 'is:gamechangers', 'is:gc']]]) {
    const f = await fake({ gc }), dir = mkdtempSync(join(tmpdir(), 'edh-')), out = join(dir, 'edh.tsv');
    try {
      const r = await run(f.base, { EDH_TOP: '40', EDH_ARCH: '0', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '100' }, out); assert.equal(r.code, 0, gc + ' : ' + r.o);
      const p = C.parseEdh(readFileSync(out, 'utf8')); assert.equal(p.gc.size, expect, gc); assert.deepEqual(f.seen.gcq, queries, gc); assert.ok(p.decks.length >= 30, 'le reste du fichier est intact');
      if (!expect) assert.match(r.o, /Game Changers : liste indisponible/);
    } finally { f.srv.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});
test('liste EDHREC absente → repli Scryfall ; Archidekt en panne → ignoré ; résultat maigre → fichier conservé', async () => {
  const f = await fake({ lists: false, scryList: true, noArch: true }), dir = mkdtempSync(join(tmpdir(), 'edh-')), out = join(dir, 'edh.tsv');
  try {
    const r = await run(f.base, { EDH_TOP: '40', EDH_ARCH: '2', EDH_ARCH_TOP: '10', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '30', EDH_DEBUG: join(dir, 'dbg') }, out); assert.equal(r.code, 0, r.o);
    const p = C.parseEdh(readFileSync(out, 'utf8')); assert.ok(p.decks.length >= 30 && p.decks.every(d => d.src === 'edhrec'), 'pas de deck Archidekt'); assert.match(r.o, /repli Scryfall|complétée par le classement Scryfall/); assert.match(r.o, /abandon de cette source/);
    assert.ok(existsSync(join(dir, 'dbg', 'log.txt')) && existsSync(join(dir, 'dbg', 'avg-' + p.decks[0].slug + '.json')), 'échantillons de débogage écrits');
    rmSync(out); const r2 = await run(f.base, { EDH_TOP: '4', EDH_ARCH: '0', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '30' }, out); assert.equal(r2.code, 1); assert.match(r2.o, /trop maigre/); assert.ok(!existsSync(out), 'rien d\'écrit');
  } finally { f.srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

/* ── sortie binaire (EDH2 + gzip) et cache incrémental des decks Archidekt ───────────────────────── */
import { gunzipSync } from 'node:zlib';
import { buildBin, loadPrev, prevArch } from '../gen-edhrec.mjs';
const readBin = f => C.parseEdhBin(new Uint8Array(gunzipSync(readFileSync(f))).buffer);
test('sortie binaire : même contenu que le texte (commandants, decks, prix, images, Game Changers), nettement plus petite', async () => {
  const f = await fake(), dir = mkdtempSync(join(tmpdir(), 'edh-')), bin = join(dir, 'edh.bin.gz'), txt = join(dir, 'edh.tsv');
  try {
    const env = { EDH_TOP: '60', EDH_ARCH: '1', EDH_ARCH_TOP: '3', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '100' };
    const r1 = await run(f.base, env, bin); assert.equal(r1.code, 0, r1.o); const r2 = await run(f.base, env, txt); assert.equal(r2.code, 0, r2.o);
    const b = readBin(bin), t = C.parseEdh(readFileSync(txt, 'utf8'));
    assert.equal(b.v, 1); assert.equal(b.cmds.length, t.cmds.length); assert.deepEqual(b.cmds.map(c => [c.slug, c.decks, c.ci, c.names, c.img, c.rank, c.tier]), t.cmds.map(c => [c.slug, c.decks, c.ci, c.names, c.img, c.rank, c.tier]));
    assert.equal(b.decks.length, t.decks.length); assert.deepEqual(b.decks.map(d => [d.slug, d.src, d.label, d.url, d.cards.length]), t.decks.map(d => [d.slug, d.src, d.label, d.url, d.cards.length]));
    assert.deepEqual(b.decks[0].cards, t.decks[0].cards.map(x => x)); assert.deepEqual([...b.price].sort(), [...t.price].sort()); assert.deepEqual([...b.gc].sort(), [...t.gc].sort());
    assert.ok(readFileSync(bin).length < readFileSync(txt).length / 2, 'binaire compressé : moins de la moitié du texte');
    assert.match(r1.o, /\.bin\.gz/);
    const withAvg = b.decks.filter(d => d.src === 'edhrec').map(d => d.cmd), themed = b.cmds.filter(c => c.th.length);
    assert.equal(themed.length, withAvg.length, 'chaque commandant avec un deck moyen a des thèmes'); assert.ok(withAvg.every(c => c.th.length >= 2 && c.th.length <= 3));
    assert.deepEqual(b.themes.map(t => t.slug).sort(), ['control', 'discard', 'lifegain'], 'Cats (pas général) et Mill (3 decks < 1 %) absents');
    assert.deepEqual(b.cmds[0].th.map(([i, n]) => [b.themes[i].slug, b.themes[i].label, n]), [['control', 'Control', 400], ['lifegain', 'Lifegain', 120], ['discard', 'Discard', 90]], 'commandant 0 : thèmes triés par nombre');
    for (const d of b.decks.filter(x => x.src === 'archidekt')) assert.ok(d.cmd.th.length >= 2, 'un deck Archidekt a les thèmes de son commandant');
    assert.ok(b.themes.every(t => t.decks > 0 && t.cmds > 0)); assert.match(r1.o, /avec des thèmes EDHREC/); assert.match(r1.o, /thèmes \(exemple\)/);
  } finally { f.srv.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('Archidekt : Budget / Premium / Populaire / cEDH, incrémental (decks connus pas relus), rotation, ancien gardé si le site tombe', async () => {
  const f = await fake({ archN: 2 }), dir = mkdtempSync(join(tmpdir(), 'edh-')), out = join(dir, 'edh.bin.gz');
  try {
    const env = { EDH_TOP: '60', EDH_ARCH: '2', EDH_ARCH_TOP: '4', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '100', EDH_ARCH_ROT: '1000000' };
    const arch = () => readBin(out).decks.filter(d => d.src === 'archidekt'), raw = () => EB.edhUnpack(gunzipSync(readFileSync(out)));
    const r1 = await run(f.base, env, out); assert.equal(r1.code, 0, r1.o);
    // commandants 0, 2, 3 : 2 decks récents de prix différents → Budget + Premium ; le 1 : son 1er deck (150 cartes) écarté → un seul, « Populaire » ; le 0 a aussi son deck cEDH
    const kinds = arch().map(d => [d.cmd.names[0], d.k]).sort(); assert.deepEqual(kinds, [[NAMES[0], 'budget'], [NAMES[0], 'cedh'], [NAMES[0], 'premium'], [NAMES[1], 'pop'], [NAMES[2], 'budget'], [NAMES[2], 'premium'], [NAMES[3], 'budget'], [NAMES[3], 'premium']].sort());
    const b0 = arch().find(d => d.cmd.names[0] === NAMES[0] && d.k === 'budget'), p0 = arch().find(d => d.cmd.names[0] === NAMES[0] && d.k === 'premium');
    assert.ok(b0.p > 0 && p0.p > b0.p * 1.25, 'Budget moins cher que Premium : ' + b0.p + ' / ' + p0.p); assert.equal(b0.u, REC.slice(0, 10)); assert.equal(b0.v, 4200); assert.equal(arch().find(d => d.k === 'cedh').url, 'https://archidekt.com/decks/20100');
    assert.equal(readBin(out).decks.find(d => d.src === 'edhrec').k, 'avg', 'deck moyen : type avg');
    assert.equal(raw().dk.find(d => d[1] === 'archidekt').length, 8, 'type, date, vues, prix écrits');
    assert.equal(f.seen.arch, 6, '4 commandants (le 3e cherché deux fois : nom à deux faces) + 1 cEDH'); assert.equal(f.seen.archDeck, 9, '8 decks lus (dont celui écarté) + le cEDH');
    // 2e passage, hors rotation : tout est gardé, rien n'est cherché
    f.seen.arch = 0; f.seen.archDeck = 0; const r2 = await run(f.base, env, out); assert.equal(r2.code, 0, r2.o);
    assert.equal(f.seen.arch, 0); assert.equal(f.seen.archDeck, 0); assert.deepEqual(arch().map(d => d.url + d.k).sort(), kinds.length && arch().map(d => d.url + d.k).sort()); assert.match(r2.o, /4 commandants gardés du fichier précédent, 0 à chercher/);
    // rotation : tout le monde est cherché, mais un deck connu et pas modifié n'est pas relu (seul celui écarté l'est)
    const before = arch().map(d => d.url + d.k).sort();
    f.seen.arch = 0; f.seen.archDeck = 0; assert.equal((await run(f.base, { ...env, EDH_ARCH_ROT: '1' }, out)).code, 0);
    assert.equal(f.seen.arch, 6); assert.equal(f.seen.archDeck, 1, 'decks connus réutilisés'); assert.deepEqual(arch().map(d => d.url + d.k).sort(), before);
    const pv = loadPrev(out), cs = [...pv.keys()].map(slug => ({ slug }));
    assert.equal(prevArch(pv, cs), 4, 'commandants avec un deck (hors cEDH)'); assert.equal(prevArch(pv, cs.slice(0, 2)), 2, 'garde-fou : seuls les commandants traités comptent');
    assert.equal(loadPrev(join(dir, 'absent.bin.gz')).size, 0); assert.equal(pv.size, 4); assert.equal(loadPrev(join(dir, 'x.tsv')).size, 0); assert.equal(pv.get(slugOf(NAMES[0])).find(d => d.k === 'budget').u, REC.slice(0, 10));
  } finally { f.srv.close(); rmSync(dir, { recursive: true, force: true }); }
  // decks anciens seulement : le plus vu, « Populaire » ; pas de cEDH ancien
  const o = await fake({ archN: 2, oldArch: true }), dirO = mkdtempSync(join(tmpdir(), 'edh-')), outO = join(dirO, 'edh.bin.gz');
  try {
    assert.equal((await run(o.base, { EDH_TOP: '60', EDH_ARCH: '2', EDH_ARCH_TOP: '4', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '100' }, outO)).code, 0);
    const a = readBin(outO).decks.filter(d => d.src === 'archidekt'); assert.ok(a.length >= 3 && a.every(d => d.k === 'pop' && d.u === '2024-01-02'), a.map(d => d.k + d.u).join(' '));
  } finally { o.srv.close(); rmSync(dirO, { recursive: true, force: true }); }
  // Archidekt en panne : les anciens decks restent
  const g = await fake({ archN: 2, noArch: true }), dir2 = mkdtempSync(join(tmpdir(), 'edh-')), out2 = join(dir2, 'edh.bin.gz'), f2 = await fake({ archN: 2 });
  try {
    const env = { EDH_TOP: '60', EDH_ARCH: '2', EDH_ARCH_TOP: '4', EDH_MIN_DECKS: '30', EDH_MIN_CMDS: '100', EDH_ARCH_ROT: '1' };
    assert.equal((await run(f2.base, env, out2)).code, 0); const before = readBin(out2).decks.filter(d => d.src === 'archidekt').map(d => d.url + d.k).sort(); assert.equal(before.length, 8);
    const r = await run(g.base, env, out2); assert.equal(r.code, 0, r.o); assert.match(r.o, /abandon de cette source \(les anciens decks sont gardés\)/);
    assert.deepEqual(readBin(out2).decks.filter(d => d.src === 'archidekt').map(d => d.url + d.k).sort(), before, 'rien perdu');
  } finally { g.srv.close(); f2.srv.close(); rmSync(dir2, { recursive: true, force: true }); }
});
test('pickBudget : le moins cher et le plus cher ; un seul, prix inconnu ou écart < 25 % → le plus vu, « Populaire »', async () => {
  const { pickBudget } = await import('../gen-edhrec.mjs'), d = (id, p) => ({ id, p });
  assert.deepEqual(pickBudget([d(1, 300), d(2, 100), d(3, 900), d(4, 500)]).map(x => [x.id, x.k]), [[2, 'budget'], [3, 'premium']]);
  assert.deepEqual(pickBudget([d(1, 300)]).map(x => [x.id, x.k]), [[1, 'pop']]); assert.deepEqual(pickBudget([d(1, 300), d(2, 320)]).map(x => [x.id, x.k]), [[1, 'pop']]);
  assert.deepEqual(pickBudget([d(1, 300), d(2, 0)]).map(x => [x.id, x.k]), [[1, 'pop']], 'prix inconnu'); assert.deepEqual(pickBudget([]), []);
});
test('sameCmd : le deck doit avoir exactement le commandant (ou la paire) cherché', async () => {
  const { sameCmd } = await import('../gen-edhrec.mjs'), pair = ['Tymna the Weaver', 'Thrasios, Triton Hero'];
  assert.equal(sameCmd(['Thrasios, Triton Hero', 'Tymna the Weaver'], pair), true, 'ordre libre'); assert.equal(sameCmd(['tymna the weaver', 'THRASIOS TRITON HERO'], pair), true, 'casse et ponctuation');
  assert.equal(sameCmd(['Tymna the Weaver', 'Kraum, Ludevic\'s Opus'], pair), false, 'autre partenaire'); assert.equal(sameCmd(['Tymna the Weaver'], pair), false, 'un seul des deux');
  assert.equal(sameCmd(['Edgar Markov'], ['Edgar Markov']), true); assert.equal(sameCmd(['Edgar Markov', 'Tymna the Weaver'], ['Edgar Markov']), false, 'commandant en trop'); assert.equal(sameCmd([], ['Edgar Markov']), false);
});
