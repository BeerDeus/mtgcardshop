// Langue des cartes par défaut selon l'interface et le téléphone, liens Cardmarket / CardTrader selon la langue de l'utilisateur,
// catalogues des noms imprimés par langue (gen-fr-names.mjs, routes /names-<langue>.tsv du serveur). Sans navigateur ni réseau.
import './setup-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../src/core.js');

test('defaultCardLang : interface, puis langue du téléphone, sinon anglais', () => {
  const { defaultCardLang: d } = C;
  assert.equal(d('fr', ['fr-FR']), 'fr', 'téléphone français : rien ne change');
  assert.equal(d('fr', ['de-DE', 'en-US']), 'fr', 'interface en français (choisie) : cartes françaises');
  assert.equal(d('en', ['en-US']), 'en'); assert.equal(d('en', ['en-GB', 'de-DE']), 'en', 'anglais préféré sur le téléphone');
  assert.equal(d('en', ['de-DE', 'en-US']), 'de', 'téléphone allemand, interface anglaise par défaut : cartes allemandes (repli anglais ensuite)');
  assert.equal(d('en', ['fr-FR']), 'en', 'anglais choisi sur un téléphone français : cartes anglaises');
  assert.equal(d('en', ['fr-CA', 'de-DE']), 'en', 'première langue du téléphone = langue de l\'interface : l\'interface fait foi');
  for (const [nav, want] of [['es-ES', 'es'], ['es-419', 'es'], ['it-IT', 'it'], ['pt-BR', 'pt'], ['pt-PT', 'pt'], ['ja-JP', 'jp'], ['ja', 'jp'], ['zh-CN', 'zh-CN'], ['zh-Hans-CN', 'zh-CN'], ['zh-TW', 'zh-CN'], ['de_AT', 'de'], ['DE-ch', 'de']])
    assert.equal(d('en', [nav]), want, nav);
  assert.equal(d('en', ['ko-KR']), 'en', 'coréen : pas une langue de cartes de l\'appli → anglais');
  assert.equal(d('en', ['ko-KR', 'ru-RU', 'it-IT']), 'it', 'première langue du téléphone qui existe en cartes');
  assert.equal(d('en', ['ru-RU', 'en-US', 'de-DE']), 'en');
  assert.equal(d('en', 'de-DE'), 'de', 'une seule langue en texte'); assert.equal(d('en', []), 'en'); assert.equal(d('en', undefined), 'en'); assert.equal(d('', null), 'en');
  assert.equal(d('xx', ['es-MX']), 'es', 'interface inconnue : langue du téléphone');
  // demain, une interface allemande : elle compte comme le français aujourd'hui
  C.I18N_LANGS.de = 'Deutsch';
  try {
    assert.equal(d('de', ['de-DE']), 'de'); assert.equal(d('de', ['en-US']), 'de', 'allemand choisi sur un téléphone anglais');
    assert.equal(d('en', ['de-DE']), 'en', 'anglais choisi alors que l\'allemand existe : cartes anglaises');
  } finally { delete C.I18N_LANGS.de; }
});

test('Cardmarket : site dans la langue la plus proche (fr de es it, sinon en)', () => {
  const { cmSite, cmUrl } = C;
  for (const [l, s] of [['fr', 'fr'], ['de', 'de'], ['es', 'es'], ['it', 'it'], ['en', 'en'], ['pt', 'en'], ['jp', 'en'], ['zh-CN', 'en'], ['', 'en'], [undefined, 'en'], ['xx', 'en']]) assert.equal(cmSite(l), s, String(l));
  assert.equal(cmUrl('Sol Ring', 'de'), 'https://www.cardmarket.com/de/Magic/Products/Search?searchString=Sol%20Ring');
  assert.equal(cmUrl('Fire // Ice', 'fr'), 'https://www.cardmarket.com/fr/Magic/Products/Search?searchString=Fire');
  assert.equal(cmUrl('Sol Ring', 'jp'), 'https://www.cardmarket.com/en/Magic/Products/Search?searchString=Sol%20Ring');
});

test('CardTrader : panier en français pour l\'interface française, sans langue imposée sinon', () => {
  const { ctCartUrl, I18N } = C, was = I18N.lang;
  try {
    I18N.lang = 'fr'; assert.equal(ctCartUrl(), 'https://www.cardtrader.com/fr-FR/cart/edit', 'français : adresse inchangée');
    I18N.lang = 'en'; assert.equal(ctCartUrl(), 'https://www.cardtrader.com/cart/edit');
  } finally { I18N.lang = was; }
});

test('gen-fr-names.mjs : catalogue de n\'importe quelle langue imprimée, français inchangé', async () => {
  const G = await import('../gen-fr-names.mjs');
  const de = { lang: 'de', name: 'Sol Ring', printed_name: 'Sol-Ring', image_uris: { small: 'https://cards.scryfall.io/small/front/a/b/ab.jpg?1' } };
  assert.equal(G.namesRow(de, 'de'), 'Sol-Ring\tSol Ring\tfront/a/b/ab.jpg'); assert.equal(G.namesRow(de, 'fr'), '', 'autre langue : rien');
  const ja = { lang: 'ja', name: 'Fire // Ice', card_faces: [{ name: 'Fire', printed_name: '火' }, { name: 'Ice', printed_name: '氷', image_uris: {} }] };
  assert.equal(G.namesRow(ja, 'ja'), '火 // 氷\tFire // Ice\t');
  const fr = { lang: 'fr', name: 'Sol Ring', printed_name: 'Anneau solaire', image_uris: { small: 'https://cards.scryfall.io/small/front/a/b/ab.jpg' } };
  assert.equal(G.frRow(fr), G.namesRow(fr, 'fr')); assert.equal(G.frRow(fr), 'Anneau solaire\tSol Ring\tfront/a/b/ab.jpg');
  assert.equal(G.namesFile('fr'), 'fr-names.tsv', 'français : nom de fichier historique (l\'appli le lit déjà)'); assert.equal(G.namesFile('de'), 'names-de.tsv');
  assert.equal(G.parseArgs([]).lang, 'fr'); assert.match(G.parseArgs([]).out, /pwa\/fr-names\.tsv$/);
  assert.match(G.parseArgs(['--lang', 'zhs']).out, /pwa\/names-zhs\.tsv$/); assert.deepEqual(G.parseArgs(['x.tsv', '--lang', 'de']), { lang: 'de', out: 'x.tsv' });
  for (const bad of [['--lang', 'en'], ['--lang', '../x'], ['--lang', 'DE'], ['--lang'], ['--lang', '__proto__']]) assert.throws(() => G.parseArgs(bad), /Langue inconnue/, bad.join(' '));
  // les mêmes langues des deux côtés : générateur et routes du serveur ; et toutes les langues de cartes de l'appli (sauf l'anglais) y ont un catalogue
  const proxy = readFileSync(new URL('../proxy.mjs', import.meta.url), 'utf8'), served = JSON.parse(/const NAME_LANGS = (\[[^\]]*\])/.exec(proxy)[1].replace(/'/g, '"'));
  assert.deepEqual(served.slice().sort(), Object.keys(G.NAME_LANGS).sort());
  const data = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8'), scry = new Function('return ' + /const SCRY_LANG = (\{[^}]*\})/.exec(data)[1])();
  for (const l of ['fr', 'de', 'es', 'it', 'pt', 'jp', 'zh-CN']) assert.ok(served.includes(scry[l]), l + ' → ' + scry[l]);
});

test('noms imprimés d\'une autre langue (allemand) : decklist, import, scan, partage ; français inchangé', () => {
  const { namesLangOf, frIndex, frUse, FRX, parseLine, parseDeck, parseCollection, frCatalog, matchFr, nameSuggest, shareCard } = C;
  assert.equal(namesLangOf('de', 'en'), 'de'); assert.equal(namesLangOf('fr', 'en'), 'fr'); assert.equal(namesLangOf('es', 'fr'), 'es'); assert.equal(namesLangOf('pt', 'en'), 'pt');
  assert.equal(namesLangOf('en', 'en'), '', 'cartes anglaises, interface anglaise : aucun catalogue'); assert.equal(namesLangOf('en', 'fr'), 'fr', 'interface française : noms français (comme avant)');
  assert.equal(namesLangOf('jp', 'en'), '', 'japonais : pas encore (clé Unicode)'); assert.equal(namesLangOf('zh-CN', 'fr'), 'fr');
  const rows = readFileSync(new URL('./fixtures/names-de.tsv', import.meta.url), 'utf8').split('\n').filter(r => r && r[0] !== '#');
  const was = { ix: FRX.ix, l: FRX.l };
  try {
    frUse(frIndex(rows), 'de'); assert.equal(FRX.l, 'de');
    const p = parseLine('4 Blitzschlag'); assert.deepEqual([p.qty, p.name, p.key, p.dn, p.fr], [4, 'Lightning Bolt', 'lightning bolt', 'Blitzschlag', 1]);
    assert.equal(parseLine('1 Schwerter zu Pflugscharen').key, 'swords to plowshares'); assert.equal(parseLine('1 schwerter zu pflugscharen').dn, 'Schwerter zu Pflugscharen', 'casse ignorée');
    assert.equal(parseLine('1 Sol-Ring').key, 'sol ring', 'même nom en deux langues : la carte reste'); assert.equal(parseLine('1 Lightning Bolt').dn, undefined, 'nom anglais : inchangé');
    const d = parseDeck('4 Blitzschlag\n2 Gebirge\n1 Zorn Gottes'); assert.deepEqual(d.cards.map(c => c.key), ['lightning bolt', 'wrath of god']); assert.deepEqual(d.basics.map(c => c.key), ['mountain'], '« Gebirge » : terrain de base');
    const c = parseCollection('2 Blitzschlag\n1 Counterspell\n3 Riesenwuchs *EN*', { fr: true, lang: '' }); const by = Object.fromEntries(c.items.map(x => [x.k, x]));
    assert.equal(c.fr, 2); assert.equal(by['lightning bolt'].l, 'de', 'nom allemand : exemplaire allemand'); assert.equal(by['counterspell'].l, undefined); assert.equal(by['giant growth'].l, 'en', 'langue de la ligne d\'abord');
    const cat = frCatalog(rows, 'de'), m = matchFr([{ text: 'Blitzschlaq' }], cat); assert.equal(m && m.name, 'Lightning Bolt'); assert.equal(m.card, 'de', 'carte lue en allemand : exemplaire allemand');
    assert.equal(frCatalog(rows).l, 'fr', 'sans langue : français (comme avant)');
    assert.ok(nameSuggest('Rhystische Studie', null, 3).some(s => s.n === 'Rhystic Study' && s.p === 'Rhystische Studien'), 'noms proches : catalogue allemand');
  } finally { frUse(was.ix, was.l); }
  assert.equal(shareCard({ n: 'Sol Ring', q: 1, l: 'fr', f: 'Anneau solaire' }).dn, 'Anneau solaire', 'partage d\'avant : nom français');
  assert.equal(shareCard({ n: 'Sol Ring', q: 1, l: 'de', f: 'Anneau solaire' }).dn, undefined);
  const g = shareCard({ n: 'Lightning Bolt', q: 1, l: 'de', f: 'Blitzschlag', fl: 'de' }); assert.deepEqual([g.dn, g.fn], ['Blitzschlag', 'Blitzschlag'], 'nom imprimé allemand sur une ligne allemande');
  assert.equal(shareCard({ n: 'Lightning Bolt', q: 1, l: 'fr', f: 'Blitzschlag', fl: 'de' }).dn, undefined, 'ligne française : pas le nom allemand');
});
