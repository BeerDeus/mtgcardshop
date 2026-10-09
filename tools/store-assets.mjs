// Visuels de la fiche Google Play → docs/store/ : bannière 1024×500 (FR + EN) et captures 1080×1920 (FR + EN) de la vraie appli.
// L'appli est servie par le monde des tests (proxy.mjs + faux CardTrader, tests/e2e-world.mjs), Scryfall est simulé ici : aucune requête ne sort.
// Données réalistes posées dans localStorage avant le chargement (collection, decks, historique de valeur), decks EDHREC = vrai pwa/edh.bin.gz.
// Images des cartes : cartes factices dessinées ici (dégradés, aucune illustration réelle). Polices : tools/fonts/ si présentes (OFL), sinon repli système.
//   node tools/store-assets.mjs              tout (bannières + captures FR et EN)
//   node tools/store-assets.mjs feature      bannières seulement      node tools/store-assets.mjs shots en   captures anglaises seulement
//   RAW=1 : garde aussi les captures brutes de l'appli (sans bandeau) dans shots/store/ (non versionné) · CHROMIUM : chemin du navigateur
import '../tests/setup-env.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { chromium, startWorld, newPage } from '../tests/e2e-world.mjs';

const require = createRequire(import.meta.url);
const { edhUnpack } = require('../edhbin.cjs');
const OUT = 'docs/store/', PORT = 18980;
const what = process.argv[2] || 'all', onlyLang = process.argv[3] || '';
const LANGS = ['fr', 'en'].filter(l => !onlyLang || l === onlyLang);
const DAY = 86400e3, NOW = Date.now();
mkdirSync(OUT, { recursive: true });

/* ── Cartes : coût de mana et type (de mémoire, cartes connues) ; prix = tendance Cardmarket du fichier EDHREC, sinon la valeur notée ici ──────── */
const DB_TXT = `
Edgar Markov|{3}{R}{W}{B}|Legendary Creature — Vampire Knight|9.50
Sol Ring|{1}|Artifact
Arcane Signet|{2}|Artifact
Blade of the Bloodchief|{1}|Artifact — Equipment
Herald's Horn|{3}|Artifact
Orzhov Signet|{2}|Artifact
Rakdos Signet|{2}|Artifact
Skullclamp|{1}|Artifact — Equipment
Talisman of Hierarchy|{2}|Artifact
Vanquisher's Banner|{5}|Artifact
Blood Crypt||Land — Swamp Mountain|11.20
Bloodstained Mire||Land
Bojuka Bog||Land
Cavern of Souls||Land
Caves of Koilos||Land
Command Tower||Land
Dragonskull Summit||Land
Exotic Orchard||Land|0.35
Godless Shrine||Land — Plains Swamp|9.80
Isolated Chapel||Land
Luxury Suite||Land
Marsh Flats||Land
Nomad Outpost||Land
Path of Ancestry||Land|0.30
Sacred Foundry||Land — Mountain Plains|10.40
Savai Triome||Land — Mountain Plains Swamp
Secluded Courtyard||Land
Unclaimed Territory||Land
Vault of Champions||Land
Vault of the Archangel||Land
Voldaren Estate||Land
Blood Artist|{1}{B}|Creature — Vampire
Bloodletter of Aclazotz|{1}{B}{B}{B}|Creature — Vampire Demon
Bloodline Keeper // Lord of Lineage|{2}{B}{B}|Creature — Vampire
Bloodthirsty Conqueror|{3}{B}{B}|Creature — Vampire Knight
Captivating Vampire|{1}{B}{B}|Creature — Vampire
Champion of Dusk|{3}{B}{B}|Creature — Vampire Knight
Charismatic Conqueror|{1}{W}|Creature — Vampire Soldier
Clavileño, First of the Blessed|{1}{W}{B}|Legendary Creature — Vampire Cleric
Cordial Vampire|{B}{B}|Creature — Vampire
Cruel Celebrant|{W}{B}|Creature — Vampire
Drana, Liberator of Malakir|{1}{B}{B}|Legendary Creature — Vampire Ally
Edgar, Charmed Groom // Edgar Markov's Coffin|{2}{W}{B}|Legendary Creature — Vampire Noble
Elenda, the Dusk Rose|{2}{W}{B}|Legendary Creature — Vampire Knight
Forerunner of the Legion|{2}{W}|Creature — Vampire Knight
Indulgent Aristocrat|{B}|Creature — Vampire
Knight of the Ebon Legion|{B}|Creature — Vampire Knight
Legion Lieutenant|{W}{B}|Creature — Vampire Knight
Malakir Bloodwitch|{3}{B}{B}|Creature — Vampire Shaman
Markov Baron|{2}{B}|Creature — Vampire Noble
Master of Dark Rites|{2}{B}|Creature — Vampire Cleric
Mavren Fein, Dusk Apostle|{2}{W}|Legendary Creature — Vampire Cleric
Patron of the Vein|{4}{B}{B}|Creature — Vampire Shaman
Sanctum Seeker|{2}{B}{B}|Creature — Vampire Knight
Stromkirk Captain|{1}{B}{R}|Creature — Vampire Soldier
Twilight Prophet|{2}{B}{B}|Creature — Vampire Cleric
Vampire Nighthawk|{1}{B}{B}|Creature — Vampire Shaman
Vampire Socialite|{B}{R}|Creature — Vampire Noble
Vampire of the Dire Moon|{B}|Creature — Vampire
Vengeful Bloodwitch|{1}{B}|Creature — Vampire Warlock
Viscera Seer|{B}|Creature — Vampire Wizard
Vito, Thorn of the Dusk Rose|{2}{B}|Legendary Creature — Vampire Cleric
Welcoming Vampire|{2}{W}|Creature — Vampire
Yahenni, Undying Partisan|{2}{B}|Legendary Creature — Vampire
Anointed Procession|{3}{W}|Enchantment
Black Market Connections|{2}{B}|Enchantment
Exquisite Blood|{4}{B}|Enchantment
Phyrexian Arena|{1}{B}{B}|Enchantment
Sanguine Bond|{3}{B}{B}|Enchantment
Shared Animosity|{2}{R}|Enchantment
Anguished Unmaking|{1}{W}{B}|Instant
Boros Charm|{R}{W}|Instant
Dark Ritual|{B}|Instant
Path to Exile|{W}|Instant
Swords to Plowshares|{W}|Instant
Teferi's Protection|{2}{W}|Instant
Vampiric Tutor|{B}|Instant
Village Rites|{B}|Instant
Sorin, Imperious Bloodlord|{2}{B}|Legendary Planeswalker — Sorin
Damn|{B}{B}|Sorcery
Demonic Tutor|{1}{B}|Sorcery
New Blood|{2}{B}{B}|Sorcery
Olivia's Wrath|{4}{B}|Sorcery
Pact of the Serpent|{1}{B}{B}|Sorcery
Ruinous Ultimatum|{R}{R}{W}{W}{W}{B}{B}|Sorcery
Ancient Tomb||Land|61.50
Chrome Mox|{0}|Artifact|47.90
Mana Drain|{U}{U}|Instant
Force of Will|{3}{U}{U}|Instant|68.00
Rhystic Study|{2}{U}|Enchantment
Smothering Tithe|{3}{W}|Enchantment
Cyclonic Rift|{1}{U}|Instant
Fierce Guardianship|{2}{U}|Instant|27.40
Doubling Season|{4}{G}|Enchantment
Sylvan Library|{1}{G}|Enchantment|24.80
Enlightened Tutor|{W}|Instant
Esper Sentinel|{W}|Artifact Creature — Human Soldier
Deflecting Swat|{2}{R}|Instant|19.60
Polluted Delta||Land
Misty Rainforest||Land
Verdant Catacombs||Land
Flooded Strand||Land
Birds of Paradise|{G}|Creature — Bird
Craterhoof Behemoth|{5}{G}{G}{G}|Creature — Beast|18.40
Wrath of God|{2}{W}{W}|Sorcery|4.20
Lightning Bolt|{R}|Instant
Counterspell|{U}{U}|Instant
Cultivate|{2}{G}|Sorcery
Kodama's Reach|{2}{G}|Sorcery
Farseek|{1}{G}|Sorcery
Nature's Lore|{1}{G}|Sorcery
Llanowar Elves|{G}|Creature — Elf Druid|0.25
Lightning Greaves|{2}|Artifact — Equipment
Swiftfoot Boots|{2}|Artifact — Equipment|1.10
Heroic Intervention|{1}{G}|Instant
Beast Within|{2}{G}|Instant|0.90
Chaos Warp|{2}{R}|Instant|1.40
Blasphemous Act|{8}{R}|Sorcery
Mystic Remora|{U}|Enchantment
Reliquary Tower||Land
Atraxa, Praetors' Voice|{G}{W}{U}{B}|Legendary Creature — Phyrexian Angel Horror|5.20
The Ur-Dragon|{4}{W}{U}{B}{R}{G}|Legendary Creature — Dragon Avatar|12.80
Krenko, Mob Boss|{2}{R}{R}|Legendary Creature — Goblin Warrior|3.40
Giada, Font of Hope|{1}{W}|Legendary Creature — Angel|3.10
Coat of Arms|{5}|Artifact
Goblin King|{1}{R}{R}|Creature — Goblin
Goblin Chieftain|{1}{R}{R}|Creature — Goblin
Goblin Recruiter|{1}{R}|Creature — Goblin
Kiki-Jiki, Mirror Breaker|{2}{R}{R}{R}|Legendary Creature — Goblin Shaman
Purphoros, God of the Forge|{3}{R}|Legendary Enchantment Creature — God
Muxus, Goblin Grandee|{4}{R}{R}|Legendary Creature — Goblin Noble
Blood Moon|{2}{R}|Enchantment
Goblin Bombardment|{1}{R}|Enchantment
Impact Tremors|{1}{R}|Enchantment
Siege-Gang Commander|{3}{R}{R}|Creature — Goblin
Skirk Prospector|{R}|Creature — Goblin
Goblin Matron|{2}{R}|Creature — Goblin
Vorinclex, Monstrous Raider|{4}{G}{G}|Legendary Creature — Phyrexian Praetor
Oko, Thief of Crowns|{1}{G}{U}|Legendary Planeswalker — Oko
Teferi, Master of Time|{2}{U}|Legendary Planeswalker — Teferi
Bloom Tender|{1}{G}|Creature — Elf Druid
Evolution Sage|{2}{G}|Creature — Elf Druid
Innkeeper's Talent|{1}{G}|Enchantment — Class
Scalding Tarn||Land
Wooded Foothills||Land
Arid Mesa||Land
Prismatic Vista||Land
Urza's Saga||Enchantment Land — Urza's Saga
Jeska's Will|{2}{R}|Sorcery
Boseiju, Who Endures||Legendary Land
Otawara, Soaring City||Legendary Land
Urborg, Tomb of Yawgmoth||Legendary Land
Nykthos, Shrine to Nyx||Legendary Land
Mana Confluence||Land
Sensei's Divining Top|{1}|Artifact
Gemstone Caverns||Legendary Land
Cabal Coffers||Land
Phyrexian Tower||Legendary Land
Mox Amber|{0}|Legendary Artifact
The Great Henge|{7}{G}{G}|Legendary Artifact
Shadowspear|{1}|Legendary Artifact — Equipment
Ragavan, Nimble Pilferer|{R}|Legendary Creature — Monkey Pirate
Worldly Tutor|{G}|Instant
Force of Negation|{1}{U}{U}|Instant
Commander's Plate|{1}|Artifact — Equipment
Finale of Devastation|{X}{G}{G}|Sorcery
Phyrexian Altar|{3}|Artifact
Exploration|{G}|Enchantment
Necropotence|{B}{B}{B}|Enchantment
Green Sun's Zenith|{G}|Sorcery
Mondrak, Glory Dominus|{2}{W}{W}|Legendary Creature — Phyrexian Horror
Deadly Rollick|{3}{B}|Instant
The Ozolith|{1}|Legendary Artifact
`;
const slug = n => String(n).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const front = n => String(n).split('//')[0].trim().toLowerCase();
const DB = new Map();
for (const l of DB_TXT.trim().split('\n')) { const [name, cost, type, eur] = l.split('|'); DB.set(front(name), { name, cost, type, eur: eur ? Math.round(Number(eur) * 100) : 0 }); }

/* ── Decks EDHREC réels (pwa/edh.bin.gz) : listes, prix Cardmarket en centimes, images des commandants ─────────────────────────────── */
const BIN = readFileSync('pwa/edh.bin.gz'), EDH = edhUnpack(new Uint8Array(gunzipSync(BIN)));
const PRICE = new Map(); EDH.names.forEach((n, i) => { if (EDH.pr[i]) PRICE.set(front(n), EDH.pr[i]); });
const FULL = new Map(); EDH.names.forEach(n => { if (!FULL.has(front(n)) || n.includes('//')) FULL.set(front(n), n); });
const IMG_OF = new Map(); EDH.cmds.forEach(c => { if (c.img) IMG_OF.set(c.img.replace(/^front\//, ''), c.names[0]); });
/** Deck EDHREC d'un commandant : [[nom, quantité]] (commandant compris, en tête). kind : 'avg' (deck moyen) ou 'budget' / 'premium'. */
function edhDeck(cmd, kind = 'avg') {
  const ci = EDH.cmds.findIndex(c => c.names.length === 1 && c.names[0] === cmd); if (ci < 0) throw new Error('commandant absent du fichier EDHREC : ' + cmd);
  const j = EDH.dk.findIndex(d => d[0] === ci && (d[4] || 'avg') === kind); if (j < 0) throw new Error('deck ' + kind + ' absent : ' + cmd);
  const out = [[cmd, 1]]; for (let e = EDH.off[j]; e < EDH.off[j + 1]; e++) out.push([EDH.names[EDH.ids[e]], EDH.qty[e]]);
  return out;
}
/* ── Noms français imprimés (pwa/fr-names.tsv, même fichier que le site) ─────────────────────────────────────────────────────────── */
const FR = new Map(), FR_IMG = new Map();
for (const l of readFileSync('pwa/fr-names.tsv', 'utf8').split('\n')) { const [p, en, im] = l.split('\t'); if (!p || !en || l[0] === '#') continue; if (!FR.has(front(en))) FR.set(front(en), p); if (im) FR_IMG.set(im, en); }
const BASICS = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };

/** Fiche d'une carte : nom complet, coût, type, prix (centimes), couleurs. null si la carte est inconnue. */
function card(name) {
  const k = front(name), d = DB.get(k), basic = BASICS[k];
  if (!d && !PRICE.has(k) && !basic && !FULL.has(k)) return null;
  const full = (d && d.name) || FULL.get(k) || name, cost = d ? d.cost : '', type = d ? d.type : basic ? 'Basic Land — ' + name : '';
  const colors = [...new Set((cost.match(/[WUBRG]/g) || []))];
  const cmc = (cost.match(/\{[^}]+\}/g) || []).reduce((a, s) => a + (/^\{\d+\}$/.test(s) ? Number(s.slice(1, -1)) : /X/.test(s) ? 0 : 1), 0);
  return { name: full, cost, type, cmc, colors, ci: basic ? [basic] : colors, eur: basic ? 0 : PRICE.get(k) || (d && d.eur) || 20 + hash(k) % 180, fr: FR.get(k) || '' };      // prix inconnu du fichier : quelques dizaines de centimes
}
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
/** Aléa déterministe (même rendu à chaque lancement). */
const rnd = seed => { let x = hash(seed) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };

/* ── Collection : 88 % du deck moyen d'Edgar Markov (le « deck à monter »), une partie des decks enregistrés, des incontournables, des terrains de base ─── */
const EDGAR = edhDeck('Edgar Markov'), KRENKO = edhDeck('Krenko, Mob Boss'), ATRAXA = edhDeck("Atraxa, Praetors' Voice"), URD = edhDeck('The Ur-Dragon'), GIADA = edhDeck('Giada, Font of Hope');
const TO_BUY = new Set(['Bloodthirsty Conqueror', 'Anointed Procession', 'Exquisite Blood', 'Luxury Suite', 'Vault of Champions', 'Black Market Connections', 'Bloodletter of Aclazotz', 'Charismatic Conqueror', 'Savai Triome', 'Marsh Flats'].map(front));
const OWN = new Map();      // clé → { name, q }
const own = (n, q = 1) => { const c = card(n); if (!c || BASICS[front(n)] || TO_BUY.has(front(n))) return; const k = front(n), o = OWN.get(k); if (o) o.q = Math.max(o.q, q); else OWN.set(k, { name: c.name, q }); };
/** Vrac : cartes bon marché des decks de commandants Magic « maison » (aucune licence externe), une de chaque. */
const BULK_CMDS = ['Kaalia of the Vast', 'Jodah, the Unifier', 'Nekusar, the Mindrazer', "Yuriko, the Tiger's Shadow", 'Kenrith, the Returned King', 'Isshin, Two Heavens as One', 'Miirym, Sentinel Wyrm', 'Chatterfang, Squirrel General', 'Muldrotha, the Gravetide', 'Animar, Soul of Elements', 'Arcades, the Strategist', 'Oloro, Ageless Ascetic', 'Breya, Etherium Shaper', 'Meren of Clan Nel Toth', 'Teysa Karlov', 'Gishath, Sun\'s Avatar', 'Wilhelt, the Rotcleaver', 'Lathril, Blade of the Elves'];
const NOT_MAGIC = /\b(Ring|Halfling|Bowmasters|Mithril|Lotho|Gandalf|Frodo|Samwise|Bilbo|Gollum|Sméagol|Sauron|Aragorn|Shire|Mordor|Rohan|Gondor|Eorl|Nazgûl|Doctor|TARDIS|Dalek|Vault-Tec|Nuka|Brotherhood|Chocobo|Moogle|Materia|Spider|Marvel|Assassin|Animus|Templar)\b/i;
{
  const r = rnd('collection'), cheap = n => { const c = card(n); return c && (DB.has(front(n)) || (c.eur > 0 && c.eur < 400)); };
  for (const [n] of EDGAR) if (!TO_BUY.has(front(n))) own(n);
  for (const [deck, part] of [[KRENKO, 0.55], [ATRAXA, 0.42], [URD, 0.36], [GIADA, 0.5]]) for (const [n] of deck) if (r() < part && cheap(n)) own(n);
  for (const [k, d] of DB) if (!OWN.has(k) && r() < 0.8) own(d.name);
  for (const cmd of BULK_CMDS) for (const [n] of edhDeck(cmd)) { const c = card(n); if (c && !DB.has(front(n)) && c.eur > 0 && c.eur < 150 && !NOT_MAGIC.test(n) && r() < 0.6) own(n); }
  for (const [k, o] of OWN) { const c = card(o.name); if (c.eur && c.eur < 250 && !/Land/.test(c.type) && r() < 0.45) o.q = 2 + Math.floor(r() * 3); }      // doublons de cartes bon marché : la liste d'échange
  for (const n of ['Sol Ring', 'Arcane Signet', 'Swords to Plowshares', 'Lightning Bolt', 'Counterspell', 'Cultivate']) { own(n); OWN.get(front(n)).q = 3 + (hash(n) % 2); }
}
const LANDS = [['Plains', 36], ['Island', 24], ['Swamp', 41], ['Mountain', 33], ['Forest', 27]];
const priced = [...OWN.values()].map(o => ({ ...o, c: card(o.name) })).filter(o => o.c.eur > 0);
const VALUE = priced.reduce((a, o) => a + o.c.eur * o.q, 0), COPIES = [...OWN.values()].reduce((a, o) => a + o.q, 0) + LANDS.reduce((a, l) => a + l[1], 0);
/** Quelques exemplaires dans d'autres langues parmi les cartes les plus chères (en tête de la liste triée par prix) : capture « Chaque carte, sa langue ». */
const LANG_FIX = { fr: { 'chrome mox': 'JA', 'mox amber': 'EN', 'the great henge': 'DE' }, en: { 'chrome mox': 'JA', 'deflecting swat': 'FR', 'the great henge': 'DE' } };
/** Texte de la collection : FR → une bonne part des cartes en français (nom imprimé connu), EN → exemplaires anglais ; LANG_FIX par-dessus (même tirage pour les autres). */
function collText(lang) {
  const r = rnd('langs'), lines = [], fix = LANG_FIX[lang] || {};
  for (const o of OWN.values()) { const c = card(o.name), auto = lang === 'fr' && c.fr && r() < 0.62 && c.fr.length <= 20 && !c.fr.includes(',') ? 'FR' : 'EN'; lines.push(`${o.q} ${o.name} *${fix[front(o.name)] || auto}*`); }
  for (const [n, q] of LANDS) lines.push(`${q} ${n}`);
  return lines.join('\n');
}
const deckText = cards => '// Deck Deal : commander\nCommander\n1 ' + cards[0][0] + '\n\nDeck\n' + cards.slice(1).map(([n, q]) => q + ' ' + n).join('\n');
const DECKS = lang => [
  { id: 'd-krenko', name: lang === 'fr' ? 'Krenko gobelins' : 'Krenko Goblins', cards: KRENKO, at: NOW - 3 * 3600e3 },
  { id: 'd-atraxa', name: lang === 'fr' ? 'Atraxa poison' : 'Atraxa Poison', cards: ATRAXA, at: NOW - 2 * DAY },
  { id: 'd-urd', name: lang === 'fr' ? 'Ur-Dragon' : 'The Ur-Dragon', cards: URD, at: NOW - 6 * DAY },
  { id: 'd-giada', name: lang === 'fr' ? 'Giada anges' : 'Giada Angels', cards: GIADA, at: NOW - 13 * DAY },
].map(d => ({ id: d.id, name: d.name, text: deckText(d.cards), opts: {}, cards: d.cards.reduce((a, c) => a + c[1], 0), history: [], createdAt: d.at - 20 * DAY, updatedAt: d.at }));
/** Historique de valeur : 120 jours, hausse régulière (achats, prix), dernier relevé = valeur actuelle. */
function history() {
  const r = rnd('hist'), out = [], n = 120;
  for (let i = n; i >= 0; i--) {
    const t = NOW - i * DAY - 3 * 3600e3, p = 1 - i / n, base = VALUE * (0.78 + 0.22 * Math.pow(p, 1.4)) + (i > 40 ? -9000 : 0), noise = (r() - 0.5) * VALUE * 0.012;
    out.push({ t, v: Math.round(i ? base + noise : VALUE), n: priced.length, q: COPIES });
  }
  out[out.length - 8].v = VALUE - 8640;      // il y a 7 jours : « ▲ +86 € · 7 j » à l'accueil
  return out;
}
console.log(`collection : ${OWN.size} cartes différentes, ${COPIES} exemplaires, ${(VALUE / 100).toFixed(2)} €`);

/* ── Cartes factices (SVG) : cadre à la couleur de la carte, illustration abstraite, nom (français si l'image est française) ─────────────────── */
const FRAME = { W: ['#f4eedb', '#cfc4a2'], U: ['#6b9be0', '#2d5a9c'], B: ['#6a6070', '#2b2530'], R: ['#e48466', '#a3402c'], G: ['#69b07a', '#2c6a43'], M: ['#ecd27c', '#b38c37'], C: ['#c3cad2', '#7d8893'], L: ['#bba684', '#7a6649'] };
const PIP = { W: '#f8f6d8', U: '#9cc3ff', B: '#b9aac6', R: '#ff8f72', G: '#86d79c' };
const xesc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function artSvg(name, w, h, id) {
  const r = rnd('art' + name), hu = Math.floor(r() * 360), h2 = (hu + 30 + r() * 60) % 360, sx = 0.2 + r() * 0.6, sy = 0.18 + r() * 0.25;
  const ridge = (y0, amp, seed) => { const q = rnd(seed); let d = `M0 ${h}`; for (let i = 0; i <= 8; i++) d += ` L${(w * i / 8).toFixed(1)} ${(h * y0 - q() * h * amp).toFixed(1)}`; return d + ` L${w} ${h}Z`; };
  return `<defs><linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hu},62%,70%)"/><stop offset=".65" stop-color="hsl(${h2},55%,46%)"/><stop offset="1" stop-color="hsl(${h2},50%,26%)"/></linearGradient>
    <radialGradient id="sun${id}"><stop offset="0" stop-color="hsl(${(hu + 180) % 360},95%,88%)"/><stop offset=".35" stop-color="hsl(${(hu + 180) % 360},90%,75%)" stop-opacity=".9"/><stop offset="1" stop-color="hsl(${(hu + 180) % 360},90%,75%)" stop-opacity="0"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#sky${id})"/><circle cx="${w * sx}" cy="${h * sy}" r="${h * 0.42}" fill="url(#sun${id})"/>
    <path d="${ridge(0.72, 0.28, name + 'a')}" fill="hsl(${h2},32%,30%)" fill-opacity=".85"/><path d="${ridge(0.9, 0.22, name + 'b')}" fill="hsl(${(h2 + 20) % 360},36%,17%)"/>`;
}
/** Ligne de type d'une carte française : types principaux traduits, sous-types omis (« Créature légendaire », « Terrain de base »…). */
function frType(t) {
  const main = String(t || '').split('—')[0].trim(); if (!main) return '';
  const W = { Artifact: 'artefact', Creature: 'créature', Enchantment: 'enchantement', Instant: 'éphémère', Sorcery: 'rituel', Land: 'terrain', Planeswalker: 'planeswalker' };
  const ws = main.split(/\s+/), types = ws.filter(w => W[w]).map(w => W[w]), leg = ws.includes('Legendary'), basic = ws.includes('Basic');
  const s = (types.includes('créature') ? ['créature', ...types.filter(x => x !== 'créature')] : types).join(' ') + (basic ? ' de base' : '') + (leg ? ' légendaire' : '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function cardSvg(name, lang) {
  const c = card(name) || { name, cost: '', type: '', colors: [], ci: [] }, shown = lang === 'fr' && c.fr ? c.fr : c.name.split('//')[0].trim();
  const f = /Land/.test(c.type) ? (c.ci.length === 1 && /Basic/.test(c.type) ? FRAME[c.ci[0]] : FRAME.L) : c.colors.length > 1 ? FRAME.M : c.colors.length ? FRAME[c.colors[0]] : FRAME.C;
  const pips = (c.cost.match(/\{[^}]+\}/g) || []).map(s => s.slice(1, -1)), px = 446 - pips.length * 25;
  const pipSvg = pips.map((s, i) => `<circle cx="${px + i * 25 + 12}" cy="53" r="10.5" fill="${PIP[s] || '#d8d2c6'}" stroke="#0006" stroke-width="1"/>${PIP[s] ? '' : `<text x="${px + i * 25 + 12}" y="58.5" font-size="14" font-weight="700" text-anchor="middle" fill="#222" font-family="Inter,sans-serif">${xesc(s)}</text>`}`).join('');
  const nameW = Math.min(390 - pips.length * 25, shown.length * 13.2), type = lang === 'fr' ? frType(c.type) : c.type;
  const lines = rnd('txt' + name), tl = [0, 1, 2, 3].map(i => `<rect x="54" y="${476 + i * 30}" width="${(220 + lines() * 160).toFixed(0)}" height="9" rx="4.5" fill="#00000026"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680"><defs><linearGradient id="fr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${f[0]}"/><stop offset="1" stop-color="${f[1]}"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf8f0"/><stop offset="1" stop-color="#e2dccd"/></linearGradient></defs>
    <rect width="488" height="680" rx="26" fill="#121214"/><rect x="16" y="16" width="456" height="648" rx="17" fill="url(#fr)"/>
    <rect x="30" y="32" width="428" height="44" rx="9" fill="url(#bar)" stroke="#0005"/>
    <text x="46" y="62" font-family="'Bricolage Grotesque','Inter Display',Inter,sans-serif" font-weight="700" font-size="23" fill="#1d1a16"${shown.length * 13.2 > nameW ? ` textLength="${nameW}" lengthAdjust="spacingAndGlyphs"` : ''}>${xesc(shown)}</text>${pipSvg}
    <svg x="40" y="84" width="408" height="300" viewBox="0 0 408 300">${artSvg(c.name, 408, 300, 'c')}</svg><rect x="40" y="84" width="408" height="300" fill="none" stroke="#0007" stroke-width="2"/>
    <rect x="30" y="392" width="428" height="38" rx="8" fill="url(#bar)" stroke="#0005"/><text x="46" y="417" font-family="Inter,sans-serif" font-weight="600" font-size="16" fill="#2a2620">${xesc(type)}</text>
    <rect x="40" y="440" width="408" height="200" rx="6" fill="#f3efe4" fill-opacity=".92"/>${tl}</svg>`;
}
const artCropSvg = name => `<svg xmlns="http://www.w3.org/2000/svg" width="626" height="457" viewBox="0 0 408 300">${artSvg(name, 408, 300, 'a')}</svg>`;

/* ── Faux Scryfall (toutes les cartes connues ci-dessus et dans le fichier EDHREC) et images factices ─────────────────────────────────────── */
const SETS = [['cmm', 'Commander Masters'], ['vow', 'Innistrad: Crimson Vow'], ['cmr', 'Commander Legends'], ['fdn', 'Foundations'], ['m3c', 'Modern Horizons 3 Commander'], ['lci', 'The Lost Caverns of Ixalan']];
const BY_SLUG = new Map();
const imgUrl = (size, c, l) => { const s = slug(c.name.split('//')[0]); BY_SLUG.set(s, c.name); return `https://cards.scryfall.io/${size}/front/${l === 'fr' ? 'fr' : 'x'}/${s}.jpg`; };
function scryCard(name, lang = 'en') {
  const c = card(name); if (!c) return null;
  const [set, setName] = SETS[hash(c.name) % SETS.length];
  return { object: 'card', id: 's-' + slug(c.name), name: c.name, lang, ...(lang === 'fr' && c.fr ? { printed_name: c.fr } : {}), set, set_name: setName, collector_number: String(10 + hash(c.name) % 300), released_at: '2024-02-09',
    cmc: c.cmc, type_line: c.type, mana_cost: c.cost, colors: c.colors, color_identity: c.ci, oracle_text: '', legalities: { commander: 'legal' }, prices: { eur: c.eur ? (c.eur / 100).toFixed(2) : null, eur_foil: null },
    image_uris: { small: imgUrl('small', c, lang), normal: imgUrl('normal', c, lang), large: imgUrl('large', c, lang), art_crop: imgUrl('art_crop', c, lang) } };
}
const namesIn = q => [...String(q).matchAll(/!"(.+?)"/g)].map(m => m[1]);
let BY_NUM = null;
const CORS = { 'access-control-allow-origin': '*' };
async function scryRoute(route) {
  const req = route.request(), u = new URL(req.url()), json = (o, status = 200) => route.fulfill({ status, headers: CORS, json: o }), nf = () => json({ object: 'error', code: 'not_found', status: 404 }, 404);
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
  if (u.pathname === '/cards/collection') {
    const ids = (JSON.parse(req.postData() || '{}').identifiers || []), data = [], not_found = [];
    for (const i of ids) { const c = scryCard(i.name || ''); if (c) data.push(c); else not_found.push(i); }
    return json({ object: 'list', not_found, data });
  }
  if (u.pathname === '/cards/search') {
    const q = u.searchParams.get('q') || '', nm = namesIn(q), l = (/lang:([a-z]+)/.exec(q) || [])[1];
    if (u.searchParams.get('unique') === 'prints' && l) return nf();      // pas d'autres illustrations
    if (l === 'fr') { const data = nm.map(n => card(n)).filter(c => c && c.fr).map(c => scryCard(c.name, 'fr')); return data.length ? json({ object: 'list', has_more: false, data }) : nf(); }
    if (l) return nf();
    const data = nm.map(n => scryCard(n)).filter(Boolean); return data.length ? json({ object: 'list', has_more: false, total_cards: data.length, data }) : nf();
  }
  if (u.pathname === '/cards/named') {
    const c = scryCard(u.searchParams.get('exact') || u.searchParams.get('fuzzy') || ''); if (!c) return nf();
    if (u.searchParams.get('format') === 'image') return route.fulfill({ status: 200, headers: CORS, contentType: 'image/svg+xml', body: cardSvg(c.name, 'en') });
    return json(c);
  }
  if (u.pathname === '/catalog/card-names') return json({ object: 'catalog', data: [...new Set([...EDH.names, ...[...DB.values()].map(d => d.name)])] });
  const m = /^\/cards\/([^/]+)\/([^/]+)(?:\/([a-z]+))?$/.exec(u.pathname);
  if (m) {      // carte par extension et numéro (image en grand)
    if (!BY_NUM) { BY_NUM = new Map(); for (const x of [...DB.values()].map(d => d.name).concat(EDH.names)) { const c = scryCard(x); if (c && !BY_NUM.has(c.set + '/' + c.collector_number)) BY_NUM.set(c.set + '/' + c.collector_number, c.name); } }
    const n = BY_NUM.get(m[1] + '/' + m[2]); return n ? json(scryCard(n, m[3] || 'en')) : nf();
  }
  return nf();
}
function imgRoute(route) {
  const u = new URL(route.request().url()), m = /^\/([a-z_]+)\/(?:front|back)\/(.+)$/.exec(u.pathname);
  let name = '', lang = 'en';
  if (m) {
    const tail = m[2];
    if (IMG_OF.has(tail)) name = IMG_OF.get(tail);
    else if (FR_IMG.has('front/' + tail)) { name = FR_IMG.get('front/' + tail); lang = 'fr'; }
    else { const f = /^(fr|x|[0-9a-f])\/(?:[0-9a-f]\/)?(.+?)(?:-v\d+)?(?:-(en|fr))?\.(?:jpg|png)$/.exec(tail); if (f) { name = BY_SLUG.get(f[2]) || f[2].replace(/-/g, ' '); if (f[1] === 'fr' || f[3] === 'fr') lang = 'fr'; } }
  }
  const body = m && m[1] === 'art_crop' ? artCropSvg(name || 'x') : cardSvg(name || 'Carte', lang);
  return route.fulfill({ status: 200, headers: { ...CORS, 'cache-control': 'max-age=86400' }, contentType: 'image/svg+xml', body });
}

/* ── Polices de l'appli : tools/fonts/*.woff2 (Bricolage Grotesque, Instrument Sans, OFL) servies à la place de Google Fonts, sinon repli système ─── */
const FONT_DIR = 'tools/fonts/', FONT_FILES = { 'Bricolage Grotesque': 'bricolage-grotesque-latin-opsz-normal.woff2', 'Instrument Sans': 'instrument-sans-latin-wght-normal.woff2' };
const HAVE_FONTS = Object.values(FONT_FILES).every(f => existsSync(FONT_DIR + f));
const FONT_CSS = HAVE_FONTS ? Object.entries(FONT_FILES).map(([fam, f]) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:200 800;font-display:block;src:url(https://fonts.gstatic.com/local/${f}) format('woff2')}`).join('\n')
  : `@font-face{font-family:'Bricolage Grotesque';font-weight:200 800;src:local('Inter Display SemiBold'),local('Inter Display'),local('Inter')}@font-face{font-family:'Instrument Sans';font-weight:200 800;src:local('Inter'),local('Liberation Sans')}`;
if (!HAVE_FONTS) console.log('polices absentes de tools/fonts/ : repli sur les polices du système');
async function fontRoute(route) {
  const u = new URL(route.request().url());
  if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/css', body: FONT_CSS });
  const f = u.pathname.replace('/local/', ''); if (HAVE_FONTS && Object.values(FONT_FILES).includes(f)) return route.fulfill({ status: 200, headers: CORS, contentType: 'font/woff2', body: readFileSync(FONT_DIR + f) });
  return route.abort();
}

/* ── Caméra simulée pour le scan : le haut d'une carte posée sur un tapis de jeu (flux d'un canvas) ────────────────────────────────────────── */
function camScene(lang) {
  const inner = cardSvg('Vampiric Tutor', lang).replace('<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680">', '<svg x="0" y="0" width="488" height="680" viewBox="0 0 488 680">');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs>
    <radialGradient id="mat" cx=".5" cy=".3" r=".9"><stop offset="0" stop-color="#2a2f4a"/><stop offset="1" stop-color="#0c0e18"/></radialGradient>
    <radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
    <filter id="sh" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="18"/></filter><filter id="soft"><feGaussianBlur stdDeviation="1.1"/></filter></defs>
    <rect width="1280" height="720" fill="url(#mat)"/>
    <g transform="translate(640 372) rotate(-1.6) scale(2.62) translate(-244 -54)"><rect x="6" y="14" width="488" height="680" rx="26" fill="#000" opacity=".6" filter="url(#sh)"/><g filter="url(#soft)">${inner}</g></g>
    <rect width="1280" height="720" fill="url(#vig)"/><rect width="1280" height="720" fill="#fff" opacity=".04"/></svg>`;
}

/* ── Données posées dans le navigateur avant le chargement ─────────────────────────────────────────────────────────────────────────────── */
function seed(lang) {
  return {
    'deckdeal:lang': lang,
    'deckdeal:v1': JSON.stringify({ opts: { lang: lang === 'fr' ? 'fr' : 'en', cond: 'Slightly Played', foil: 'no', mode: 'zero', ship: 280, fallbackEn: true }, src: 'cm', token: '', appKey: '', theme: 'dark', haptic: true, sort: 'deck', useColl: true, push: false, demoPref: false, draft: null }),
    'deckdeal:coll:v1': JSON.stringify({ t: collText(lang), u: NOW - 3 * 3600e3, s: '', b: null }),
    'deckdeal:decks:v1': JSON.stringify(DECKS(lang)),
    'deckdeal:coll:hist': JSON.stringify(history()),
    'deckdeal:coll:pxat': String(NOW - 3 * 3600e3),
    'deckdeal:onboard': '1', 'deckdeal:scnote': 'off',
  };
}
/* ── Mise en page d'une capture : bandeau de légende en haut, écran de l'appli (984 × 1584 px = 410 × 660 à ×2,4) qui sort par le bas ──────── */
const VIEW = { width: 410, height: 660 }, DPR = 2.4, SCR = { x: 48, y: 336, w: 984, h: 1584 };
let world = null, browser = null;
async function openApp(lang) {
  const init = `(() => { try { if (!localStorage.getItem('store:seeded')) { const S = ${JSON.stringify(seed(lang))}; for (const k in S) localStorage.setItem(k, S[k]); localStorage.setItem('store:seeded', '1'); } } catch (e) {}
    window.__noFpsWatch = true;
    const CAM = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(camScene(lang)).toString('base64'))};
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d'), im = new Image(); im.src = CAM; await im.decode();
      const draw = () => g.drawImage(im, 0, 0); draw(); setInterval(draw, 120); return cv.captureStream(12);
    };
  })();`;
  const c = await newPage(browser, world, { goto: false, perms: ['camera'], init, ctx: { viewport: VIEW, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: lang === 'fr' ? 'fr-FR' : 'en-GB', timezoneId: 'Europe/Paris' } });
  const { ctx, p } = c;
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(world.url) || /^(data|blob):/.test(u) ? r.continue() : r.abort(); });      // rien ne sort
  await p.route('https://api.scryfall.com/**', scryRoute);
  await p.route('https://cards.scryfall.io/**', imgRoute);
  await p.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, fontRoute);
  await p.route('**/edh.bin.gz', r => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'content-encoding': 'gzip' }, body: BIN }));
  await p.route('**/fr-names.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: readFileSync('pwa/fr-names.tsv') }));
  await p.route('**/prices.tsv', r => r.fulfill({ status: 404, body: '' }));
  await p.goto(world.url + (lang === 'en' ? '?lang=en' : ''));
  await p.waitForFunction(() => typeof COLL !== 'undefined' && Object.keys(COLL.map).length > 50);
  await p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; collEnrich(); });      // infos des cartes (sur un vrai téléphone, déjà en cache)
  await p.waitForFunction(() => !collMissing().length && !COLL.enrich, null, { timeout: 60000 });
  await p.addStyleTag({ content: '.coll-sync{display:none!important}' });      // « compte indisponible » : Firebase est coupé ici, pas chez l'utilisateur
  await p.waitForFunction(() => EDH.data && HM.best, null, { timeout: 60000 });
  return c;
}
/** Revient à l'accueil : ferme feuilles, visionneuses, scan, collection, decks. */
const toHome = p => p.evaluate(() => { try { sheets.slice().reverse().forEach(s => s.close()); } catch (e) { /* aucune */ } for (const f of [closeCardImage, closeDeckViewer, closeScan, closeCollection, closeDecks]) try { f(); } catch (e) { /* déjà fermé */ } showView('home'); window.scrollTo(0, 0); }).then(() => p.waitForTimeout(700));
/** Attend que les images visibles soient chargées. */
const imgsReady = p => p.waitForFunction(() => [...document.images].filter(i => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; }).every(i => i.complete), null, { timeout: 15000 }).catch(() => {});
/** Fait défiler pour que `target` arrive en haut : la coupure tombe juste sous l'élément précédent (pas de liseré d'un bloc à moitié caché sous l'en-tête). */
const scrollIn = (p, scroller, target) => p.evaluate(([s, t]) => {
  const sc = document.querySelector(s), el = document.querySelector(t); if (!sc || !el) return;
  const top = el.getBoundingClientRect().top; let b = top - 12;
  for (const x of sc.querySelectorAll('*')) { const r = x.getBoundingClientRect(); if (r.height && r.bottom <= top + 0.5 && r.bottom > top - 40) b = Math.max(b, r.bottom); }
  sc.scrollTop += b + 1 - sc.getBoundingClientRect().top;
}, [scroller, target]);

/** Les captures, dans l'ordre de la fiche (le scan d'abord, comme chez tous les concurrents) : légende (FR, EN ; *mot* en dégradé foil) et mise en état de l'appli.
 *  Aucune promesse que l'utilisateur sans token ne verrait pas : prix tendance Cardmarket seulement, pas d'offres CardTrader. */
const SHOTS = [
  { id: '01-scan', en: '01-scan', cap: { fr: ['Scanne tes cartes *VF ou VO*', 'Lues sur ton téléphone, la photo n\'est jamais envoyée'], en: ['*Scan* cards in any language', 'Read on your phone, photos never leave it'] },
    async go(p, lang) {
      await p.evaluate(() => openScan()); await p.waitForSelector('.scan .sc-stage[data-cam="on"]', { timeout: 15000 });
      await p.evaluate(lang => {
        const l = lang === 'fr' ? 'fr' : 'en', add = (name, cl, q) => { for (let i = 0; i < q; i++) scanAdd({ key: ownKey(name), name, card: cl, score: 0.97, raw: name }, 1, false); };
        add('Edgar Markov', 'en', 1); add('Sol Ring', 'fr', 2); add('Rhystic Study', l, 1); add('Cyclonic Rift', 'en', 1); add("Teferi's Protection", l, 1); add('Vampiric Tutor', l, 1);
        scanHint('✓ Vampiric Tutor', 'ok'); clearTimeout(SC.hintT);
      }, lang);
      await p.waitForTimeout(1200); await imgsReady(p); await p.waitForTimeout(400);
    } },
  { id: '02-accueil', en: '02-home', cap: { fr: ['La *cote* de ta collection', 'Au prix tendance Cardmarket, mise à jour chaque jour'], en: ['Your collection, *valued*', 'Cardmarket trend prices, updated daily'] },
    async go(p) { await p.waitForFunction(() => HM.v != null && HM.v === homeValue() && [...document.querySelectorAll('#hmFan img')].length === 3, null, { timeout: 20000 }); await imgsReady(p); await p.waitForTimeout(2600); } },
  { id: '03-decks-a-monter', en: '03-decks-to-build', cap: { fr: ['Les decks que tu peux *monter*', 'Decks Commander comparés à ta collection'], en: ['Decks you can *build*', 'Commander decks matched to your cards'] },
    async go(p) { await p.evaluate(() => openCollection('decks')); await p.waitForSelector('.dk-res .crow, .dk-res [role="button"]', { timeout: 30000 }); await p.waitForTimeout(1500); await scrollIn(p, '.coll.on .dv-scroll', '.dk-res .coll-list'); await imgsReady(p); await p.waitForTimeout(800); } },
  { id: '04-valeur', en: '04-value', cap: { fr: ['Suis sa valeur *jour après jour*', 'Courbe, variations à 7 et 30 jours, alertes de prix'], en: ['Watch its value *grow*', 'Daily chart, 7- and 30-day changes, price alerts'] },
    async go(p) { await p.evaluate(() => openCollection('stats')); await p.waitForSelector('.coll.on .vl-box'); await p.waitForTimeout(1500); } },
  { id: '05-collection', en: '05-collection', cap: { fr: ['Chaque carte, *sa langue*', 'VF, VO, japonais… et son prix Cardmarket'], en: ['Every copy, *its language*', 'English, French, Japanese… and its Cardmarket price'] },
    async go(p) { await p.evaluate(() => openCollection('list')); await p.waitForSelector('.coll.on'); await p.selectOption('#collSort', 'price'); await p.waitForTimeout(900); await imgsReady(p); await p.waitForTimeout(600); } },
  { id: '06-recherche', en: '06-search', cap: { fr: ['Colle une liste, vois le *prix*', 'Sans les cartes que tu as déjà, prête pour Cardmarket'], en: ['Paste a list, see the *price*', 'Minus the cards you own, ready for Cardmarket'] },
    async go(p) {
      await p.evaluate(t => { showView('input'); const ta = document.querySelector('#deckText'); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); }, deckText(EDGAR));
      await p.waitForTimeout(500); await p.click('#btnRun');
      await p.waitForFunction(() => S.run && S.run.status !== 'running' && !document.querySelector('#viewResults').hidden, null, { timeout: 60000 }); await p.waitForTimeout(1800);
      await p.selectOption('#optSort', 'price-desc'); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(900);
    } },
  { id: '07-deck', en: '07-deck', cap: { fr: ['Chaque deck *en un coup d\'œil*', 'Valeur, courbe de mana, main de départ'], en: ['Every deck *at a glance*', 'Value, mana curve, opening hand'] },
    async go(p) { await p.evaluate(() => { const r = HM.best.r; openDeckViewer({ text: edhDeckText(r.deck), name: r.cmd.names.join(' + ') }); }); await p.waitForSelector('.dv.on'); await p.waitForTimeout(2500); await imgsReady(p); await p.waitForTimeout(500); } },
  { id: '08-echange', en: '08-trade', cap: { fr: ['Tes échanges *en un lien*', 'Doublons et cartes recherchées, toujours à jour'], en: ['Trade with *one link*', 'Your spares and wants, always up to date'] },
    async go(p) {
      await p.evaluate(() => openCollection('trade')); await p.waitForSelector('.coll.on .tr-box'); await p.waitForTimeout(1000);
      // lien public tel qu'il apparaît une fois connecté (ici, pas de compte Firebase) : même rendu que l'appli, adresse du site
      await p.evaluate(() => { const u = D.user; D.user = { uid: 'store' }; TR.share = 'k7Qe2xPm4w'; const h = trShareBoxHtml(TR.st || trState()); D.user = u; TR.share = null; document.querySelector('.tr-box').outerHTML = h; document.querySelector('.tr-link input').value = 'https://card.m2s-photo.fr/?p=k7Qe2xPm4w'; });
      await scrollIn(p, '.coll.on .dv-scroll', '.tr-box'); await imgsReady(p); await p.waitForTimeout(500);
    } },
];

/* ── Composition : fond aurore, légende, écran de l'appli ─────────────────────────────────────────────────────────────────────────────── */
const fontData = f => existsSync(FONT_DIR + f) ? `url(data:font/woff2;base64,${readFileSync(FONT_DIR + f).toString('base64')}) format('woff2'),` : '';
const FACES = `@font-face{font-family:'MO Display';font-weight:200 800;src:${fontData(FONT_FILES['Bricolage Grotesque'])}local('Inter Display'),local('Inter')}
  @font-face{font-family:'MO Text';font-weight:200 800;src:${fontData(FONT_FILES['Instrument Sans'])}local('Inter'),local('Liberation Sans')}`;
const FOIL = 'linear-gradient(100deg,#ff8fc3 0%,#ffd479 28%,#7be8c8 52%,#7fb0ff 76%,#c79bff 100%)';
const AURORA = (w, h, k = 1) => `<div class="au" style="left:${-0.24 * w}px;top:${-0.13 * h}px;width:${0.8 * w * k}px;height:${0.8 * w * k}px;background:radial-gradient(circle,rgba(63,143,224,.55),transparent 66%)"></div>
  <div class="au" style="right:${-0.3 * w}px;top:${0.05 * h}px;width:${0.75 * w * k}px;height:${0.75 * w * k}px;background:radial-gradient(circle,rgba(224,83,61,.42),transparent 66%)"></div>
  <div class="au" style="left:${-0.25 * w}px;top:${0.48 * h}px;width:${0.7 * w * k}px;height:${0.7 * w * k}px;background:radial-gradient(circle,rgba(58,154,94,.36),transparent 66%)"></div>
  <div class="au" style="right:${-0.22 * w}px;top:${0.66 * h}px;width:${0.7 * w * k}px;height:${0.7 * w * k}px;background:radial-gradient(circle,rgba(199,155,255,.36),transparent 66%)"></div>`;
const capHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*(.+?)\*/g, '<em>$1</em>');
function shotPage([title, sub], src) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FACES}
  html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#0b0f1c;-webkit-font-smoothing:antialiased}
  .au{position:absolute;border-radius:50%;filter:blur(40px)}
  .st{position:absolute;width:4px;height:4px;border-radius:50%;background:#fff;opacity:.28}
  .cap{position:absolute;left:70px;right:70px;top:0;height:${SCR.y - 14}px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
  h1{margin:0;font:760 70px/1.04 'MO Display',sans-serif;letter-spacing:-.028em;color:#f4f6ff;text-wrap:balance}
  h1 em{font-style:normal;background:${FOIL};-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:.04em}
  p{margin:20px 0 0;font:500 33px/1.3 'MO Text',sans-serif;letter-spacing:-.003em;color:#a9b3cf;text-wrap:balance}
  .dev{position:absolute;left:${SCR.x - 13}px;top:${SCR.y - 13}px;width:${SCR.w + 26}px;height:${SCR.h + 40}px;border-radius:74px 74px 0 0;background:linear-gradient(180deg,#323a5e,#151b30 22%,#0f1426);
    box-shadow:0 0 0 1.5px rgba(255,255,255,.13),0 -18px 90px rgba(127,150,255,.22),0 40px 120px rgba(0,0,0,.6)}
  .dev::after{content:'';position:absolute;left:13px;top:13px;width:${SCR.w}px;height:${SCR.h}px;border-radius:61px 61px 0 0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);pointer-events:none}
  .scr{position:absolute;left:13px;top:13px;width:${SCR.w}px;height:${SCR.h + 30}px;border-radius:61px 61px 0 0;overflow:hidden;background:#0b0f1c}
  .scr img{display:block;width:${SCR.w}px;height:${SCR.h}px}
  </style></head><body>${AURORA(1080, 1920)}
  <i class="st" style="left:150px;top:70px"></i><i class="st" style="left:930px;top:250px"></i><i class="st" style="left:860px;top:42px;opacity:.18"></i><i class="st" style="left:96px;top:300px;opacity:.16"></i>
  <div class="cap"><h1>${capHtml(title)}</h1><p>${capHtml(sub)}</p></div>
  <div class="dev"><div class="scr"><img src="${src}"></div></div></body></html>`;
}
let comp = null;
/** Rend une page HTML en image : PNG si elle tient sous 1 Mo, sinon JPEG de haute qualité. Retourne le chemin écrit. */
async function render(html, w, h, base) {
  if (!comp) comp = await browser.newPage({ deviceScaleFactor: 1 });
  await comp.setViewportSize({ width: w, height: h }); await comp.setContent(html, { waitUntil: 'load' });
  await comp.evaluate(() => document.fonts.ready); await comp.waitForTimeout(150);
  let buf = await comp.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } }), file = base + '.png';
  if (buf.length > 1000000) { buf = await comp.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: w, height: h } }); file = base + '.jpg'; }
  for (const ext of ['.png', '.jpg']) if (base + ext !== file && existsSync(base + ext)) unlinkSync(base + ext);      // l'autre format d'un rendu précédent
  writeFileSync(file, buf); return file;
}
async function shotsFor(lang) {
  const t0 = Date.now(), { ctx, p, errs } = await openApp(lang), dir = OUT + lang + '/'; mkdirSync(dir, { recursive: true });
  for (const s of SHOTS) {
    await toHome(p); await s.go(p, lang);
    await p.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }); await p.waitForTimeout(250);      // pas d'anneau de focus
    const shot = await p.screenshot({ type: 'png' });
    if (process.env.RAW) { mkdirSync('shots/store/', { recursive: true }); writeFileSync('shots/store/' + lang + '-' + s.id + '.png', shot); }
    const f = await render(shotPage(s.cap[lang], 'data:image/png;base64,' + shot.toString('base64')), 1080, 1920, dir + (lang === 'fr' ? s.id : s.en));
    console.log(`  ${f}  ${(statSync(f).size / 1024).toFixed(0)} Ko`);
  }
  if (errs.length) console.log('  erreurs de la page :\n  ' + errs.join('\n  '));
  await ctx.close(); console.log(`  ${lang} : ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

/* ── Bannière 1024 × 500 : logo, nom, accroche, cartes foil en éventail sur l'aurore de l'appli ─────────────────────────────────────────── */
const LOGO = `
    <g transform="rotate(-20 50 52)"><path d="M12 52A38 13 0 0 1 88 52" fill="none" stroke="#9aa3b8" stroke-width="2.4" stroke-linecap="round"/><circle cx="27.7" cy="41.5" r="3.4" fill="#ff7a5c" fill-opacity=".85"/><circle cx="72.3" cy="41.5" r="3.4" fill="#6fd08c" fill-opacity=".85"/></g>
    <g transform="rotate(-11 51 50)"><rect x="37" y="27" width="28" height="41" rx="5" fill="url(#foil)"/><rect x="39.6" y="29.6" width="22.8" height="35.8" rx="3.2" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.1"/></g>
    <g transform="rotate(-20 50 52)"><path d="M12 52A38 13 0 0 0 88 52" fill="none" stroke="#9aa3b8" stroke-width="2.4" stroke-linecap="round"/><circle cx="86.1" cy="56" r="4.3" fill="#7fb0ff"/><circle cx="50" cy="65" r="4.3" fill="#f8f6d8"/><circle cx="13.9" cy="56" r="4.3" fill="#b5a3c8"/></g>`;      // même dessin que tools/make-icons.mjs
const FOIL_STOPS = '<stop offset="0" stop-color="#ff8fc3"/><stop offset=".26" stop-color="#ffd479"/><stop offset=".5" stop-color="#7be8c8"/><stop offset=".74" stop-color="#7fb0ff"/><stop offset="1" stop-color="#c79bff"/>';
const TAG = { fr: 'Ta collection Magic,<br><b>sa valeur</b>, tes decks.', en: 'Your Magic collection,<br><b>its value</b>, your decks.' };
/** Éventail de cartes foil tenu en main (pivot sous les cartes), cerclé d'une orbite à cinq billes comme le logo. */
function fanSvg() {
  const P = { x: 772, y: 618 }, R = 352, W = 146, H = 204, angles = [-20, -6.8, 6.8, 20], dim = [0.2, 0.11, 0.04, 0];
  const cards = angles.map((a, i) => {
    const t = a * Math.PI / 180, cx = P.x + R * Math.sin(t), cy = P.y - R * Math.cos(t);
    return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${a})">
      <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="14" fill="#000" opacity=".5" filter="url(#blur)" transform="translate(4 14)"/>
      <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="14" fill="url(#f${i})"/>
      <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="14" fill="url(#sheen)"/>
      <rect x="${-W / 2 + 8}" y="${-H / 2 + 8}" width="${W - 16}" height="${H - 16}" rx="9" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"/>
      <rect x="${-W / 2 + 17}" y="${-H / 2 + 20}" width="${W - 34}" height="${H * 0.36}" rx="6" fill="#fff" fill-opacity=".18"/>
      <rect x="${-W / 2 + 17}" y="${H * 0.06}" width="${W * 0.55}" height="6" rx="3" fill="#fff" fill-opacity=".36"/><rect x="${-W / 2 + 17}" y="${H * 0.06 + 15}" width="${W - 34}" height="6" rx="3" fill="#fff" fill-opacity=".26"/><rect x="${-W / 2 + 17}" y="${H * 0.06 + 30}" width="${W * 0.45}" height="6" rx="3" fill="#fff" fill-opacity=".26"/>
      ${dim[i] ? `<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="14" fill="#0b0f1c" opacity="${dim[i]}"/>` : ''}</g>`;
  }).join('');
  const O = { x: 772, y: 276, rx: 238, ry: 64, rot: -12 }, pt = d => { const t = d * Math.PI / 180; return [(O.x + O.rx * Math.cos(t)).toFixed(1), (O.y + O.ry * Math.sin(t)).toFixed(1)]; };
  const dot = (d, r, c, op = 1) => { const [x, y] = pt(d); return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" fill-opacity="${op}" stroke="#0b0f1c" stroke-opacity=".35" stroke-width="2"/>`; };
  const half = front => `<path d="M${O.x - O.rx} ${O.y}A${O.rx} ${O.ry} 0 0 ${front ? 0 : 1} ${O.x + O.rx} ${O.y}" fill="none" stroke="${front ? '#c3cbe0' : '#8f98b0'}" stroke-opacity="${front ? 0.85 : 0.5}" stroke-width="3" stroke-linecap="round"/>`;
  const grads = [0, 1, 2, 3].map(i => `<linearGradient id="f${i}" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${i * 7 - 10} .5 .5)">${FOIL_STOPS}</linearGradient>`).join('');
  return `<svg class="fan" viewBox="0 0 1024 500"><defs>${grads}
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".32" stop-color="#fff" stop-opacity="0"/><stop offset=".68" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12"/></filter>
    <radialGradient id="glow"><stop offset="0" stop-color="#b9c8ff" stop-opacity=".22"/><stop offset="1" stop-color="#b9c8ff" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="${O.x}" cy="${O.y}" rx="300" ry="230" fill="url(#glow)"/>
    <g transform="rotate(${O.rot} ${O.x} ${O.y})">${half(false)}${dot(208, 9, '#ff7a5c', 0.85)}${dot(326, 9, '#6fd08c', 0.85)}</g>
    ${cards}
    <g transform="rotate(${O.rot} ${O.x} ${O.y})">${half(true)}${dot(28, 12, '#7fb0ff')}${dot(96, 12, '#f8f6d8')}${dot(160, 12, '#b5a3c8')}</g></svg>`;
}
function featurePage(lang) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FACES}
  html,body{margin:0;width:1024px;height:500px;overflow:hidden;background:#0b0f1c;-webkit-font-smoothing:antialiased}
  .au{position:absolute;border-radius:50%;filter:blur(30px)}
  .st{position:absolute;width:3px;height:3px;border-radius:50%;background:#fff;opacity:.35}
  .txt{position:absolute;left:66px;top:0;height:500px;display:flex;flex-direction:column;justify-content:center}
  .brand{display:flex;align-items:center;gap:10px}
  .brand svg{width:92px;height:92px;flex:none;margin-left:-10px;filter:drop-shadow(0 6px 22px rgba(127,176,255,.4))}
  h1{margin:0;font:800 70px/1 'MO Display',sans-serif;letter-spacing:-.028em;color:#f5f7ff;white-space:nowrap}
  p{margin:26px 0 0 4px;font:500 28px/1.32 'MO Text',sans-serif;color:#b9c2dc;letter-spacing:-.002em}
  p b{font-weight:600;background:${FOIL};-webkit-background-clip:text;background-clip:text;color:transparent}
  .fan{position:absolute;inset:0}
  </style></head><body>
  <div class="au" style="left:-180px;top:-260px;width:620px;height:620px;background:radial-gradient(circle,rgba(63,143,224,.6),transparent 66%)"></div>
  <div class="au" style="left:600px;top:-300px;width:560px;height:560px;background:radial-gradient(circle,rgba(199,155,255,.44),transparent 66%)"></div>
  <div class="au" style="left:690px;top:190px;width:560px;height:560px;background:radial-gradient(circle,rgba(224,83,61,.46),transparent 66%)"></div>
  <div class="au" style="left:160px;top:260px;width:520px;height:520px;background:radial-gradient(circle,rgba(58,154,94,.34),transparent 66%)"></div>
  <i class="st" style="left:560px;top:64px"></i><i class="st" style="left:600px;top:430px;opacity:.22"></i><i class="st" style="left:985px;top:52px;opacity:.25"></i><i class="st" style="left:44px;top:446px;opacity:.2"></i>
  ${fanSvg()}
  <div class="txt"><div class="brand"><svg viewBox="6 8 88 88"><defs><linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">${FOIL_STOPS}</linearGradient></defs>${LOGO}</svg><h1>Mana Orbit</h1></div>
    <p>${TAG[lang]}</p></div>
  </body></html>`;
}


world = await startWorld({ port: PORT, env: { ALLOWED_UIDS: 'store-owner' } });      // comme en production : token CardTrader du serveur réservé au compte du propriétaire, le visiteur n'a que Cardmarket
browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--font-render-hinting=none'] });
try {
  if (what === 'all' || what === 'feature') for (const l of LANGS) { const f = await render(featurePage(l), 1024, 500, OUT + (l === 'fr' ? 'feature-graphic' : 'feature-graphic-en')); console.log(`  ${f}  ${(statSync(f).size / 1024).toFixed(0)} Ko`); }
  if (what === 'all' || what === 'shots') for (const l of LANGS) await shotsFor(l);
} finally { await browser.close(); world.stop(); }
process.exit(0);
