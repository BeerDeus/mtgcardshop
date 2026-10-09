// Dictionnaires des langues de l'interface (src/i18n/<code>[.<partie>].json) face à l'anglais, la référence : mêmes fichiers et mêmes clés,
// mêmes {variables}, mêmes balises HTML, aucune valeur vide ni restée en français (sauf les mots qui s'écrivent pareil : SAME).
// Espaces de tête et de fin : les mêmes que la clé (le texte est collé à d'autres) ; ponctuation finale (« : », « … », « . »…) : différences listées, sans échec.
// Langue de I18N_LANGS sans dictionnaire (espagnol avant sa livraison) : sautée, l'appli ne la propose pas. Sans navigateur ni réseau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { I18N_LANGS } = require('../src/core.js');

const DIR = new URL('../src/i18n/', import.meta.url);
// <code>.json → partie '' ; <code>.<partie>.json → partie ; même règle que build.mjs
const FILES = {};
for (const f of readdirSync(DIR).sort()) {
  const m = /^([a-z]{2}(?:-[A-Z]{2})?)(?:\.([a-z0-9-]+))?\.json$/.exec(f); if (!m) continue;
  let d; try { d = JSON.parse(readFileSync(new URL(f, DIR), 'utf8')); } catch (e) { d = e; }
  (FILES[m[1]] = FILES[m[1]] || {})[m[2] || ''] = { f, d };
}
const merged = l => Object.assign({}, ...Object.entries(FILES[l] || {}).sort(([a], [b]) => (a === '') - (b === '') || (a < b ? -1 : 1)).map(([, x]) => x.d));
const EN = merged('en');

// Clés dont la traduction peut rester identique au français : noms propres et de marques, termes du jeu repris tels quels (Commander, Deck, Planeswalker,
// Game Changer, Tier…), mots identiques dans la langue. '*' : toutes les langues ; sinon la liste d'une langue. Un texte sans lettre ({a} → {b}, {n} %) passe toujours.
const SAME = {
  '*': ['Mana Orbit', 'OK', 'Commander', 'cEDH', 'Archidekt', 'Game Changer', '{n} Game Changer', '{n} Game Changers', 'Planeswalkers', 'Deck', 'Decks', 'deck', '{n} deck', '{n} decks',
    'Tier', 'Tier {t}', 'tier {t}', 'Premium', 'Budget', 'Widget', 'Auto', 'web', 'Version {v}', 'non-foil', 'Format', 'Stats'],
  de: ['Profil', 'Liste', 'Mana', 'Standard', 'Decklist'],
  es: [],
};
const sameOk = (l, k) => SAME['*'].includes(k) || (SAME[l] || []).includes(k) || !/\p{L}/u.test(k.replace(/\{\w+\}/g, '').replace(/<[^>]+>/g, ''));
const vars = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const tags = s => [...String(s).matchAll(/<[^>]+>/g)].map(m => m[0]).sort();
const end = s => ((/(…|\.\.\.|[:.?!])\s*$/.exec(s) || [''])[0].trim().replace('...', '…'));

const LANGS = [...new Set([...Object.keys(I18N_LANGS), ...Object.keys(FILES)])].filter(l => l !== 'fr' && l !== 'en').sort();

test('anglais : référence lisible, chaque langue livrée est proposée par l\'appli', () => {
  for (const [l, parts] of Object.entries(FILES)) for (const { f, d } of Object.values(parts)) assert.ok(!(d instanceof Error) && d && typeof d === 'object' && !Array.isArray(d), f + ' : JSON illisible ' + (d && d.message || ''));
  assert.ok(Object.keys(EN).length > 1000, 'dictionnaires anglais');
  for (const l of Object.keys(FILES)) assert.ok(Object.prototype.hasOwnProperty.call(I18N_LANGS, l), `src/i18n/${l}*.json : langue absente de I18N_LANGS (core.js), jamais proposée`);
  assert.ok(!FILES.fr, 'le français est la langue du code : pas de dictionnaire');
});

for (const l of LANGS) {
  test(`${l} (${I18N_LANGS[l] || '?'}) : mêmes clés que l'anglais, variables, balises, rien de vide ni d'oublié`, t => {
    if (!FILES[l]) { console.log(`  ${l} : aucun dictionnaire (src/i18n/${l}*.json), langue sautée (l'appli ne la propose pas)`); t.skip('pas de dictionnaire'); return; }
    const parts = FILES[l], bad = [];
    // fichier par fichier : la même découpe que l'anglais (une partie = une fonction de l'appli)
    assert.deepEqual(Object.keys(parts).sort(), Object.keys(FILES.en).sort(), `${l} : mêmes fichiers que l'anglais (en.<partie>.json → ${l}.<partie>.json)`);
    for (const [p, { f, d }] of Object.entries(parts)) {
      const en = FILES.en[p].d, miss = Object.keys(en).filter(k => !(k in d)), extra = Object.keys(d).filter(k => !(k in en));
      if (miss.length || extra.length) bad.push(`${f} : ${miss.length} clé(s) manquante(s) ${JSON.stringify(miss.slice(0, 5))}, ${extra.length} en trop ${JSON.stringify(extra.slice(0, 5))}`);
      for (const [k, v] of Object.entries(d)) {
        if (typeof v !== 'string' || !v.trim()) { bad.push(`${f} : valeur vide pour ${JSON.stringify(k)}`); continue; }
        if (vars(k).join() !== vars(v).join()) bad.push(`${f} : variables ${JSON.stringify(vars(k))} ≠ ${JSON.stringify(vars(v))} : ${JSON.stringify(k)} → ${JSON.stringify(v)}`);
        if (tags(k).join('') !== tags(v).join('')) bad.push(`${f} : balises HTML différentes : ${JSON.stringify(k)} → ${JSON.stringify(v)}`);
        if (v === k && !sameOk(l, k)) bad.push(`${f} : resté en français : ${JSON.stringify(k)} (sinon l'ajouter à SAME)`);
        if (/^\s/.test(k) !== /^\s/.test(v) || /\s$/.test(k) !== /\s$/.test(v)) bad.push(`${f} : espaces de tête ou de fin différents : ${JSON.stringify(k)} → ${JSON.stringify(v)}`);
      }
    }
    assert.deepEqual(Object.keys(merged(l)).sort(), Object.keys(EN).sort(), `${l} : toutes les clés de l'anglais, aucune de plus`);
    assert.deepEqual(bad, [], `${l} : ${bad.length} problème(s)`);
    // à relire, sans échec : ponctuation finale différente de la clé, même clé traduite différemment selon le fichier (en.json / <code>.json tranche)
    const punct = [], twice = new Map();
    for (const { f, d } of Object.values(parts)) for (const [k, v] of Object.entries(d)) {
      if (end(k) !== end(v)) punct.push(`${f} : « ${end(k)} » → « ${end(v)} » : ${JSON.stringify(k.slice(-40))} → ${JSON.stringify(v.slice(-40))}`);
      const w = twice.get(k); if (w && w.v !== v) w.alt.add(v); else if (!w) twice.set(k, { v, alt: new Set() });
    }
    const conflicts = [...twice].filter(([, w]) => w.alt.size).map(([k, w]) => `${JSON.stringify(k)} : ${[w.v, ...w.alt].map(x => JSON.stringify(x)).join(' / ')}`);
    console.log(`  ${l} : ${Object.keys(merged(l)).length} textes, ${Object.keys(parts).length} fichiers ; ponctuation finale différente (à relire, sans échec) : ${punct.length}`);
    for (const x of punct) console.log('    · ' + x);
    if (conflicts.length) { console.log(`  ${l} : même clé, traductions différentes selon le fichier (à relire) : ${conflicts.length}`); for (const x of conflicts) console.log('    · ' + x); }
  });
}
