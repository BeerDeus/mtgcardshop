// E2E contenus (sets.js, setview.js, help.js) : « Prochaines extensions » de l'accueil (faux Scryfall /sets : tri, éditions numériques et hors sujet écartées,
// produits rattachés à leur parent, cache 24 h relu au 2e lancement, carte cachée en erreur ou hors ligne) ; page d'une extension (faux /cards/search :
// grille, noms et images dans la langue des cartes, recherche, rareté, versions spéciales, tri, pastilles, étoiles de la liste de souhaits, carte en grand,
// extension sans carte révélée, copie gardée) ; Réglages › Aide et avis (feuille d'aide,
// lien d'avis mailto encodé) ; demande de note neutre (coupée sans PLAY_URL, appli Android seulement, bons moments, fréquence, session sans erreur).
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18990 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const DAY = 86400000, PLAY = 'https://play.google.com/store/apps/details?id=app.manaorbit';
const errsAll = [];
const iso = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const set = (code, name, days, type, o = {}) => ({ object: 'set', code, name, released_at: iso(days), set_type: type, digital: false, card_count: 100,
  icon_svg_uri: `https://svgs.scryfall.io/sets/${code}.svg?1700000000`, scryfall_uri: `https://scryfall.com/sets/${code}`, ...o });
// Scryfall /sets simulé (ordre de Scryfall : du plus récent au plus ancien, peu importe) : 4 lignes attendues
const SETS = [
  set('old', 'Old Expansion', -40, 'expansion'), set('rc2', 'Older Recent Core', -10, 'core'), set('rec', 'Recent Expansion', -5, 'expansion'),
  set('dig', 'Alchemy Digital', 3, 'alchemy', { digital: true }), set('dg2', 'Digital Only Expansion', 2, 'expansion', { digital: true }),
  set('tok', 'Alpha Tokens', 12, 'token', { parent_set_code: 'aaa' }), set('pro', 'Promo Pack', 2, 'promo'),
  set('aaa', 'Alpha Future', 12, 'expansion'), set('aac', 'Alpha Future Commander', 12, 'commander', { parent_set_code: 'aaa' }),
  set('bbb', 'Beta Masters', 1, 'masters'), set('xss', '<img src=x onerror="window.__xss=1">', 150, 'expansion', { icon_svg_uri: 'javascript:alert(1)', scryfall_uri: 'https://evil.example/sets/xss' }),
  set('ccc', 'Gamma Core', 200, 'core'), set('ddd', 'Delta Draft', 400, 'draft_innovation'),
];
/** Page branchée sur un /sets simulé : mode 'ok' (liste), 'err' (500), sinon le faux Scryfall commun (404). Compteur de requêtes /sets dans hits. */
async function page(o = {}) {
  const pg = await newPage(browser, world, { goto: false, ...(o.ctx ? { ctx: o.ctx } : {}), init: o.init });
  const hits = { n: 0 };
  await pg.p.route('https://api.scryfall.com/sets', route => { hits.n++; const h = { 'access-control-allow-origin': '*' };
    return o.sets === 'err' ? route.fulfill({ status: 500, headers: h, json: { object: 'error' } }) : o.sets === 'ok' ? route.fulfill({ status: 200, headers: h, json: { object: 'list', has_more: false, data: SETS } }) : route.fallback(); });
  await pg.p.route('https://svgs.scryfall.io/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' }));
  await pg.p.goto(world.url + (o.path || '')); await pg.p.waitForTimeout(700);
  await pg.p.evaluate(() => { BACKOFF.scry = [60, 60, 60]; BACKOFF.cool429 = 100; });
  errsAll.push(pg.errs);
  return { ...pg, hits };
}
const rows = p => p.$$eval('#hmSetsList .hm-set', ls => ls.map(l => { const a = l.querySelector('.hm-set-a'), c = l.querySelector('.hm-set-cm');
  return { name: a.querySelector('b').textContent, sub: a.querySelector('.hm-set-t span').textContent, when: l.querySelector('em').textContent,
    set: a.dataset.set, tag: a.tagName, icon: (a.querySelector('img') || {}).src || '',
    cm: c && { href: c.getAttribute('href'), target: c.target, rel: c.rel, text: c.textContent, label: c.getAttribute('aria-label') } }; }));
const CM = (site, name) => `https://www.cardmarket.com/${site}/Magic/Products/Search?searchString=${encodeURIComponent(name)}`;
/** Géométrie des lignes : débordements, zone de toucher du lien Cardmarket, alignement des deux pastilles, liens jamais imbriqués,
 *  et ce que touche un doigt au centre de chaque pastille (lien Cardmarket sur la sienne, lien Scryfall étiré sur la date). */
const geo = p => p.$$eval('#hmSetsList .hm-set', ls => ls.map((l, i) => {
  if (!i) document.getElementById('hmSets').scrollIntoView({ block: 'center', behavior: 'instant' });      // elementFromPoint : la carte doit être à l'écran
  const c = l.querySelector('.hm-set-cm'), cb = c.getBoundingClientRect(), pill = c.querySelector('span').getBoundingClientRect(), em = l.querySelector('em').getBoundingClientRect(), lb = l.getBoundingClientRect();
  const hit = r => { const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), x = e && e.closest('a, button'); return x ? x.className : ''; };
  return { over: l.scrollWidth > l.clientWidth || cb.right > lb.right + 0.5 || cb.left < lb.left, w: cb.width, h: cb.height, align: Math.abs(pill.right - em.right) <= 1,
    nested: !!c.parentElement.closest('a') || !!c.querySelector('a') || !!l.querySelector('.hm-set-a .hm-set-cm'), hitCm: hit(pill), hitWhen: hit(em) };
}));

/* ── 0) « Coller une liste » (accueil, home.js) : jamais l'exemple de 100 cartes quand le presse-papiers est refusé ─────────── */
{
  const { p, ctx } = await page({});
  assert.equal(await p.evaluate(() => S.isSample), true, 'appareil neuf : l\'exemple est dans le champ');
  await p.click('#btnNew'); await p.waitForTimeout(400);
  assert.deepEqual(await p.evaluate(() => [$('#deckText').value, S.deck.cards.length, document.activeElement === $('#deckText'), $('#btnRun').disabled]), ['', 0, true, true], 'presse-papiers refusé : champ vide, curseur dedans, rien à chercher');
  assert.doesNotMatch(await txt(p, '#btnRunLabel'), /72|cartes/, 'plus « Voir les prix · 72 cartes »');
  await toHome(p); await p.click('#btnNew2'); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => S.isSample && S.deck.cards.length > 50), true, '« Exemple » : inchangé');
  await ctx.close();
}
{
  const { p, ctx } = await page({ ctx: { permissions: ['clipboard-read', 'clipboard-write'] } });
  await p.evaluate(() => navigator.clipboard.writeText('1 Sol Ring\n1 Arcane Signet'));
  await p.click('#btnNew'); await p.waitForFunction(() => $('#deckText').value === '1 Sol Ring\n1 Arcane Signet');
  assert.equal(await p.evaluate(() => [S.isSample, S.deck.cards.length].join()), 'false,2'); await ctx.close();
}
ok('« Coller une liste » : champ vidé avant le presse-papiers (refusé : vide, curseur dedans ; autorisé : la liste collée), « Exemple » inchangé');

/* ── 1) Prochaines extensions : tri, filtres, parent, cache, erreurs ───────────────────────────────────────────── */
{
  const { p, ctx, hits } = await page({ sets: 'ok', ctx: { colorScheme: 'dark' } });
  assert.equal(await p.$eval('#hmSets', e => e.hidden), true, 'cachée tant que rien n\'est lu');
  await p.waitForSelector('#hmSets:not([hidden]) .hm-set', { timeout: 9000 });
  const r = await rows(p);
  assert.deepEqual(r.map(x => x.name), ['Recent Expansion', 'Beta Masters', 'Alpha Future', '<img src=x onerror="window.__xss=1">'], 'dernière sortie récente puis prochaines, par date ; 4 au plus');
  assert.deepEqual(r.map(x => x.when), ['Sortie récente', 'Demain', 'dans 12 jours', 'dans 5 mois']);
  assert.match(r[3].sub, /^\d{1,2} [a-zéû]+( \d{4})?$/, 'date seule (année si ce n\'est pas l\'année en cours) : ' + r[3].sub);
  assert.match(r[2].sub, /^\d{1,2} [a-zéû]+( \d{4})? · decks Commander$/, 'decks Commander rattachés à leur extension : ' + r[2].sub);
  assert.equal(r.filter(x => /Commander|Tokens|Digital|Promo|Older|Old /.test(x.name)).length, 0, 'enfants, numériques, jetons, promos, anciennes : écartés');
  assert.deepEqual([r[2].set, r[2].tag], ['aaa', 'BUTTON'], 'la ligne ouvre la page de l\'extension dans l\'appli');
  assert.match(r[2].icon, /^https:\/\/svgs\.scryfall\.io\/sets\/aaa\.svg/);
  assert.equal(r[3].icon, '', 'icône d\'une autre origine : écartée');
  assert.equal(await p.evaluate(() => setsPick(SETS.list).find(x => x.code === 'xss').url), 'https://scryfall.com/sets/xss', 'adresse inattendue : remplacée par la page Scryfall de l\'édition');
  assert.equal(await p.evaluate(() => window.__xss), undefined, 'nom échappé');
  assert.deepEqual(await p.$eval('#hmSetsSl', a => [a.href, a.target, a.rel, a.textContent.trim(), a.getBoundingClientRect().height >= 40]), ['https://secretlair.wizards.com/', '_blank', 'noopener', 'Secret Lair : drops en cours et à venir↗', true], 'lien Secret Lair sous la liste (les drops ne sont pas des éditions sur Scryfall)');
  assert.equal(hits.n, 1);
  assert.equal(await p.$eval('#hmSets', e => getComputedStyle(e.querySelector('.hm-set-ic img')).filter), 'invert(1) brightness(0.92)', 'icônes noires éclaircies en thème sombre');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'pas de défilement horizontal à 390 px');
  ok('accueil : extensions à venir triées, numériques / jetons / promos écartés, Commander rattaché, page de l\'extension, noms échappés');
  // Cardmarket : « Précommander » sur les éditions à venir, « Acheter » sur la sortie récente ; recherche du nom encodé, site français
  assert.deepEqual(r.map(x => x.cm), [
    { href: CM('fr', 'Recent Expansion'), target: '_blank', rel: 'noopener', text: 'Acheter↗', label: 'Acheter Recent Expansion sur Cardmarket' },
    { href: CM('fr', 'Beta Masters'), target: '_blank', rel: 'noopener', text: 'Précommander↗', label: 'Précommander Beta Masters sur Cardmarket' },
    { href: CM('fr', 'Alpha Future'), target: '_blank', rel: 'noopener', text: 'Précommander↗', label: 'Précommander Alpha Future sur Cardmarket' },
    { href: 'https://www.cardmarket.com/fr/Magic/Products/Search?searchString=%3Cimg%20src%3Dx%20onerror%3D%22window.__xss%3D1%22%3E', target: '_blank', rel: 'noopener', text: 'Précommander↗', label: 'Précommander <img src=x onerror="window.__xss=1"> sur Cardmarket' },
  ]);
  assert.equal(r[2].cm.href, 'https://www.cardmarket.com/fr/Magic/Products/Search?searchString=Alpha%20Future', 'adresse exacte (espace en %20)');
  assert.deepEqual(await p.evaluate(() => [setsCm('Duskmourn: House of Horror'), setsCm("Marvel's Spider-Man"), setsCm('  ')]),
    ['https://www.cardmarket.com/fr/Magic/Products/Search?searchString=Duskmourn%3A%20House%20of%20Horror', "https://www.cardmarket.com/fr/Magic/Products/Search?searchString=Marvel's%20Spider-Man", ''], 'nom Scryfall tel quel, encodé ; nom vide : pas de lien');
  for (const w of [390, 360]) {
    await p.setViewportSize({ width: w, height: 844 }); await p.waitForTimeout(250); const g = await geo(p);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'pas de défilement horizontal à ' + w + ' px');
    for (const x of g) {
      assert.equal(x.over, false, w + ' px : rien ne déborde de la ligne'); assert.ok(x.h >= 40 && x.w >= 40, w + ' px : zone de toucher ≥ 40 px (' + x.w + '×' + x.h + ')');
      assert.equal(x.align, true, 'pastilles alignées à droite'); assert.equal(x.nested, false, 'liens séparés, jamais imbriqués');
      assert.deepEqual([x.hitCm, x.hitWhen], ['hm-set-cm', 'hm-set-a'], w + ' px : la pastille Cardmarket au-dessus ; la date ouvre la page de l\'extension');
    }
  }
  assert.deepEqual(await p.$eval('#hmSetsList .hm-set:last-child b', b => [b.scrollWidth > b.clientWidth, getComputedStyle(b).textOverflow]), [true, 'ellipsis'], 'nom long coupé par « … »');
  await p.setViewportSize({ width: 390, height: 844 });
  // toucher : chaque lien ouvre son seul onglet (Cardmarket ou Scryfall, simulés)
  const opened = [];
  await ctx.route(/^https:\/\/(www\.cardmarket\.com|scryfall\.com)\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ok</title>' }));
  p.on('popup', pp => opened.push(pp));
  const tapTo = async (sel, o) => {
    const n = opened.length; await p.tap(sel, o);
    for (let i = 0; i < 40 && opened.length === n; i++) await p.waitForTimeout(50);
    await p.waitForTimeout(400);      // un 2e onglet (liens imbriqués) aurait eu le temps de s'ouvrir
    const got = opened.slice(n); for (const pp of got) await pp.waitForLoadState('domcontentloaded'); return got.map(pp => pp.url());
  };
  // sans force : Playwright vérifie que la pastille reçoit bien le toucher (rien posé dessus)
  assert.deepEqual(await tapTo('#hmSetsList .hm-set:nth-child(3) .hm-set-cm span'), [CM('fr', 'Alpha Future')], 'toucher « Précommander » : Cardmarket seul, pas la page Scryfall');
  // force : la date est sous le bouton étiré de la ligne, c'est lui qui reçoit le toucher : la page de l'extension, aucun onglet
  assert.deepEqual(await tapTo('#hmSetsList .hm-set:nth-child(3) em', { force: true }), [], 'toucher la date : pas d\'onglet');
  await p.waitForSelector('.setv.on'); assert.equal(await txt(p, '.setv .dv-title b'), 'Alpha Future'); await p.evaluate(() => closeSetView()); await p.waitForFunction(() => !document.querySelector('.setv'));
  for (const pp of opened) await pp.close();
  ok('Cardmarket : « Précommander » (à venir) / « Acheter » (sortie récente), recherche du nom encodé sur le site français, onglet séparé, ≥ 40 px, sans débordement à 390 et 360 px');
  // capture : accueil sombre, carte visible
  await p.$eval('#hmSets', e => e.scrollIntoView({ block: 'center', behavior: 'instant' })); await p.waitForTimeout(900);
  await p.screenshot({ path: 'shots/content-1-extensions.png' });
  await p.reload(); await p.waitForTimeout(400);
  await p.waitForSelector('#hmSets:not([hidden]) .hm-set', { timeout: 2000 });
  await p.waitForTimeout(3200);
  assert.equal(hits.n, 1, '2e lancement : liste gardée 24 h, aucune nouvelle requête');
  assert.equal((await rows(p)).length, 4);
  ok('2e lancement : liste relue dans le cache (aucune requête Scryfall)');
  // cache de plus de 24 h : relu chez Scryfall
  await p.evaluate(() => new Promise(res => { const r = indexedDB.open('deckdeal', 1); r.onsuccess = () => { const s = r.result.transaction('kv', 'readwrite').objectStore('kv'), g = s.get('sets:v1'); g.onsuccess = () => { const v = g.result; v.t -= 25 * 3600e3; s.put(v, 'sets:v1').onsuccess = res; }; }; }));
  await p.reload(); await p.waitForFunction(() => SETS.st === 'done', null, { timeout: 9000 });
  assert.equal(hits.n, 2, 'cache périmé : nouvelle lecture'); ok('cache de plus de 24 h : relu chez Scryfall');
  await ctx.close();
}
{ // anglais : « Pre-order » / « Buy », site Cardmarket anglais ; anglais choisi sur un téléphone allemand (l'interface allemande existe) : site anglais aussi
  const { p, ctx } = await page({ sets: 'ok', path: '?lang=en' });
  await p.waitForSelector('#hmSets:not([hidden]) .hm-set', { timeout: 9000 });
  const r = await rows(p);
  assert.deepEqual(r.slice(0, 3).map(x => [x.cm.href, x.cm.text, x.cm.label]), [[CM('en', 'Recent Expansion'), 'Buy↗', 'Buy Recent Expansion on Cardmarket'],
    [CM('en', 'Beta Masters'), 'Pre-order↗', 'Pre-order Beta Masters on Cardmarket'], [CM('en', 'Alpha Future'), 'Pre-order↗', 'Pre-order Alpha Future on Cardmarket']]);
  assert.equal(r[2].cm.href, 'https://www.cardmarket.com/en/Magic/Products/Search?searchString=Alpha%20Future');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await ctx.close();
  const de = await page({ sets: 'ok', path: '?lang=en', ctx: { locale: 'de-DE' } });
  await de.p.waitForSelector('#hmSets:not([hidden]) .hm-set', { timeout: 9000 });
  assert.equal((await rows(de.p))[2].cm.href, CM('en', 'Alpha Future'), 'anglais choisi sur un téléphone allemand : cardmarket.com/en (langue de l\'utilisateur)');
  await de.ctx.close();
}
ok('Cardmarket en anglais : « Pre-order » / « Buy », site /en/ (même sur un téléphone allemand : l\'anglais y est un choix)');
{ // Scryfall en erreur (500, puis un nouvel essai) : carte cachée, sans message
  const { p, ctx, hits, errs } = await page({ sets: 'err' });
  await p.waitForFunction(() => SETS.st === 'fail', null, { timeout: 9000 });
  assert.ok(hits.n >= 1); assert.equal(await p.$eval('#hmSets', e => e.hidden), true); assert.equal(await p.$('.toast.on'), null, 'aucun message');
  assert.deepEqual(errs, []); await ctx.close();
}
{ // faux Scryfall commun (404 sur /sets) : cachée aussi
  const { p, ctx } = await page({});
  await p.waitForFunction(() => SETS.st === 'fail', null, { timeout: 9000 }); assert.equal(await p.$eval('#hmSets', e => e.hidden), true); await ctx.close();
}
{ // hors ligne : aucune requête, cachée
  const { p, ctx, hits } = await page({ sets: 'ok', init: 'Object.defineProperty(navigator, "onLine", { get: () => false });' });
  await p.waitForFunction(() => SETS.st === 'fail', null, { timeout: 9000 }); assert.equal(hits.n, 0); assert.equal(await p.$eval('#hmSets', e => e.hidden), true); await ctx.close();
}
{ // accueil pas à l'écran au moment prévu (collection ouverte) : rien ; lu au retour sur l'accueil
  const { p, ctx, hits } = await page({ sets: 'ok' });
  await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.waitForTimeout(3200);
  assert.equal(hits.n, 0, 'collection ouverte : pas de lecture');
  await p.click('.coll .dv-back'); await p.waitForFunction(() => !COLL.el); await p.evaluate(() => homeSoon(0));
  await p.waitForSelector('#hmSets:not([hidden]) .hm-set', { timeout: 9000 }); assert.equal(hits.n, 1); await ctx.close();
}
ok('extensions : cachées en erreur (500, 404) et hors ligne, lues seulement quand l\'accueil est à l\'écran');
/* ── 1 bis) page d'une extension (setview.js) : cartes révélées (faux /cards/search), langue des cartes, recherche, rareté, tri, souhaits ───── */
{
  const IMG = (n, l = 'en') => `https://cards.scryfall.io/normal/front/a/a/aaa-${n}${l === 'en' ? '' : '-' + l}.jpg`;
  const card = (num, name, o = {}) => ({ object: 'card', id: 'id-' + num, name, collector_number: String(num), rarity: 'common', set: 'aaa', set_name: 'Alpha Future', lang: 'en', cmc: 2,
    mana_cost: '{1}{G}', type_line: 'Creature — Elf', colors: ['G'], image_uris: { normal: IMG(num) }, prices: { eur: null }, border_color: 'black', frame_effects: [], ...o });
  const AAA = [
    card(1, 'Zap Bolt', { cmc: 1, mana_cost: '{R}', type_line: 'Instant', colors: ['R'], prices: { eur: '0.20' } }),
    card(2, 'Elder Wurm', { rarity: 'mythic', cmc: 7, mana_cost: '{5}{G}{G}', type_line: 'Creature — Wurm', prices: { eur: '12.50' } }),
    card(3, 'Sky Angel', { rarity: 'rare', cmc: 4, mana_cost: '{3}{W}', type_line: 'Creature — Angel', colors: ['W'] }),
    card(4, 'Mind Thief', { rarity: 'uncommon', cmc: 3, mana_cost: '{2}{U}', type_line: 'Sorcery', colors: ['U'] }),
    card(5, 'Twin Door // Twin Room', { rarity: 'uncommon', image_uris: undefined, colors: undefined, type_line: 'Enchantment — Room // Enchantment — Room',
      card_faces: [{ name: 'Twin Door', mana_cost: '{1}{B}', colors: ['B'], image_uris: { normal: IMG(5) } }, { name: 'Twin Room', mana_cost: '{3}{B}', colors: ['B'], image_uris: { normal: IMG('5b') } }] }),
    card(6, 'Elder Wurm', { rarity: 'mythic', cmc: 7, mana_cost: '{5}{G}{G}', type_line: 'Creature — Wurm', border_color: 'borderless' }),
    card(7, 'Forest', { cmc: 0, mana_cost: '', type_line: 'Basic Land — Forest', colors: [] }),
  ];
  const FR = [{ ...AAA[0], lang: 'fr', printed_name: 'Éclair zap', image_uris: { normal: IMG(1, 'fr') } }];
  const pg = await page({ sets: 'ok', init: `try { localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '3 Zap Bolt', u: 1, s: '', b: null })); } catch (e) {}` });
  const { p, ctx } = pg, searches = [];
  await p.route(/^https:\/\/api\.scryfall\.com\/cards\/search\?/, route => {
    const u = new URL(route.request().url()), q = u.searchParams.get('q') || '', h = { 'access-control-allow-origin': '*' };
    if (!/^e:/.test(q)) return route.fallback();
    searches.push(q + (u.searchParams.get('page') ? ' p' + u.searchParams.get('page') : ''));
    const data = q === 'e:aaa' ? AAA : q === 'e:aaa lang:fr' ? FR : [];
    if (!data.length) return route.fulfill({ status: 404, headers: h, json: { object: 'error', code: 'not_found' } });
    const page2 = u.searchParams.get('page') === '2', part = q === 'e:aaa' ? (page2 ? data.slice(4) : data.slice(0, 4)) : data;
    route.fulfill({ status: 200, headers: h, json: { object: 'list', has_more: q === 'e:aaa' && !page2, ...(q === 'e:aaa' && !page2 ? { next_page: 'https://api.scryfall.com/cards/search?q=e%3Aaaa&unique=prints&order=set&page=2' } : {}), data: part } });
  });
  await p.waitForSelector('#hmSets:not([hidden]) .hm-set', { timeout: 9000 });
  await p.click('#hmSetsList .hm-set-a[data-set="aaa"]'); await p.waitForSelector('.setv.on');
  await p.waitForFunction(() => document.querySelectorAll('.setv-c').length === 7, null, { timeout: 8000 });
  assert.deepEqual(searches, ['e:aaa', 'e:aaa p2', 'e:aaa lang:fr'], 'impressions de l\'extension (2 pages), puis les mêmes en français');
  assert.equal(await txt(p, '.setv .dv-title b'), 'Alpha Future'); assert.match(await txt(p, '.setv .dv-title span'), /^Sortie le \d{1,2} [a-zéû]+( \d{4})? · dans 12 jours$/);
  assert.equal(await txt(p, '.setv-n'), '7 cartes révélées');
  const tiles = () => p.$$eval('.setv-c', l => l.map(c => [c.querySelector('.setv-open').getAttribute('aria-label'), (c.querySelector('.dvc-q') || {}).textContent || '', (c.querySelector('.dvc-p') || {}).textContent || '',
    c.querySelector('.setv-star') ? c.querySelector('.setv-star').className.replace('setv-star', '').trim() || 'off' : '-', (c.querySelector('img') || {}).src || '']));
  let t = await tiles();
  assert.deepEqual(t.map(x => x[0]), ['Éclair zap', 'Elder Wurm', 'Sky Angel', 'Mind Thief', 'Twin Door // Twin Room', 'Elder Wurm', 'Forest'], 'ordre de l\'extension, nom français quand Scryfall l\'a');
  assert.equal(t[0][4], IMG(1, 'fr'), 'image française'); assert.equal(t[4][4], IMG(5), 'carte à deux faces : la face avant');
  assert.deepEqual([t[0][1], t[0][2].replace(/\s/g, ' '), t[1][2].replace(/\s/g, ' '), t[2][2]], ['× 3', '0,20 €', '12,50 €', ''], 'exemplaires de la collection, prix Cardmarket quand il est connu');
  assert.deepEqual(t.map(x => x[3]), ['off', 'off', 'off', 'off', 'off', 'off', '-'], 'étoile sur chaque carte, sauf les terrains de base');
  ok('page d\'une extension : cartes révélées dans l\'ordre, nom et image en français si Scryfall les a, possédées et prix');
  // recherche (nom anglais ou français), rareté, versions spéciales, tri, filtre de couleur
  const names = async () => (await tiles()).map(x => x[0]);
  await p.fill('.setv .fsearch input', 'zap'); await p.waitForFunction(() => document.querySelectorAll('.setv-c').length === 1); assert.deepEqual(await names(), ['Éclair zap']);
  await p.fill('.setv .fsearch input', 'eclair'); await p.waitForTimeout(300); assert.deepEqual(await names(), ['Éclair zap'], 'nom français, sans accent');
  assert.equal(await txt(p, '.setv-n'), '1 carte sur 7');
  await p.fill('.setv .fsearch input', ''); await p.waitForFunction(() => document.querySelectorAll('.setv-c').length === 7);
  await p.click('.setv-rar[data-r="mythic"]'); await p.waitForFunction(() => document.querySelectorAll('.setv-c').length === 2); assert.deepEqual(await names(), ['Elder Wurm', 'Elder Wurm']);
  await p.click('.setv-sp'); await p.waitForFunction(() => document.querySelectorAll('.setv-c').length === 1); assert.equal((await tiles())[0][4], IMG(2), 'sans la version sans bordure');
  await p.click('.setv-sp'); await p.click('.setv-rar[data-r="mythic"]'); await p.waitForFunction(() => document.querySelectorAll('.setv-c').length === 7);
  await p.selectOption('.setv-sort', 'price'); await p.waitForTimeout(200); assert.deepEqual((await names()).slice(0, 2), ['Elder Wurm', 'Éclair zap'], 'tri par prix');
  await p.selectOption('.setv-sort', 'name'); await p.waitForTimeout(200); assert.deepEqual(await names(), ['Éclair zap', 'Elder Wurm', 'Elder Wurm', 'Forest', 'Mind Thief', 'Sky Angel', 'Twin Door // Twin Room'], 'tri par nom affiché');
  await p.selectOption('.setv-sort', 'num'); await p.evaluate(() => { SETV.f.colors.add('W'); setvPaint(); }); assert.deepEqual(await names(), ['Sky Angel'], 'filtre de couleur (filters.js)');
  await p.evaluate(() => { SETV.f.colors.clear(); setvPaint(); });
  ok('recherche (nom anglais ou français), rareté, versions spéciales, tri (prix, nom), couleur');
  // étoiles : ajoute cette illustration, la remplace par une autre, la retire ; français : langue retenue
  const star = i => p.click(`.setv-c[data-i="${i}"] .setv-star`), wish = k => p.evaluate(k => TR.wish[k] || null, k);
  await star(1); assert.deepEqual(await wish('elder wurm'), { n: 'Elder Wurm', q: 1, i: IMG(2), w: 'Alpha Future · AAA 2' });
  t = await tiles(); assert.deepEqual([t[1][3], t[5][3]], ['on', 'other'], 'cette illustration : étoile pleine ; l\'autre version : contour');
  await star(5); assert.equal((await wish('elder wurm')).i, IMG(6), 'version sans bordure à la place'); assert.match(await txt(p, '#toast'), /Illustration mise à jour/);
  await star(5); assert.equal(await wish('elder wurm'), null, 'retirée'); assert.match(await txt(p, '#toast'), /retirée de ta liste de souhaits/);
  await star(0); assert.deepEqual(await wish('zap bolt'), { n: 'Zap Bolt', q: 1, i: IMG(1, 'fr'), w: 'Alpha Future · AAA 1', l: 'fr' }, 'carte française : image et langue retenues');
  ok('étoiles : ajoute l\'illustration de la vignette, la remplace, la retire (Annuler dans le message) ; langue des cartes retenue');
  // carte en grand : toute la liste affichée, « Liste de souhaits » ; l'étoile suit à la fermeture
  await p.click('.setv-c[data-i="2"] .setv-open'); await p.waitForSelector('.imgv'); await p.waitForFunction(() => !document.querySelector('.imgv-wish').hidden, null, { timeout: 5000 });
  assert.deepEqual(await p.evaluate(() => [document.querySelector('.imgv-cap b').textContent, document.querySelector('.imgv-count').textContent]), ['Sky Angel', '3 / 7']);
  await p.click('.imgv-wish'); assert.equal((await wish('sky angel')).w, 'Alpha Future · AAA 3');
  await p.evaluate(() => closeCardImage()); await p.waitForFunction(() => document.querySelector('.setv-c[data-i="2"] .setv-star.on'), null, { timeout: 3000 });
  ok('carte en grand : précédente / suivante sur la liste affichée, « Liste de souhaits » ; étoile mise à jour');
  // 360 px : rien ne déborde ; fermeture ; extension sans carte révélée ; copie gardée (aucune nouvelle requête)
  await p.setViewportSize({ width: 360, height: 780 }); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => document.querySelector('.setv .dv-scroll').scrollWidth <= innerWidth), true, 'pas de défilement horizontal à 360 px');
  await p.screenshot({ path: 'shots/content-1b-extension.png' });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('.setv .dv-back'); await p.waitForFunction(() => !document.querySelector('.setv'));
  await p.click('#hmSetsList .hm-set-a[data-set="bbb"]'); await p.waitForSelector('.setv .dv-empty');
  assert.equal(await txt(p, '.setv .dv-empty b'), 'Aucune carte révélée pour l\'instant');
  await p.evaluate(() => closeSetView()); await p.waitForFunction(() => !document.querySelector('.setv'));
  const n = searches.length; await p.click('#hmSetsList .hm-set-a[data-set="aaa"]'); await p.waitForFunction(() => document.querySelectorAll('.setv-c').length === 7);
  assert.equal(searches.length, n, 'rouverte : copie de l\'appareil, aucune requête');
  assert.deepEqual(pg.errs, []); await ctx.close();
  ok('extension sans carte révélée : message ; rouverte : copie gardée ; 360 px sans débordement');
}


/* ── 2) Réglages › Aide et avis ; feuille d'aide ; avis par e-mail ──────────────────────────────────────────────── */
{
  const seed = `localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '2 Sol Ring\\n1 Craterhoof Behemoth', u: 1, s: '', b: null }));`;
  const { p, ctx } = await page({ init: seed, ctx: { colorScheme: 'dark' } });
  await p.click('#btnSettings'); await p.waitForSelector('#helpBox .sec-title');
  assert.equal(await txt(p, '#helpBox .sec-title'), 'Aide et avis');
  assert.deepEqual(await p.$$eval('#helpBox .btn', b => b.map(x => x.textContent)), ['Comment ça marche', 'Envoyer un avis'], 'navigateur : pas de « Noter »');
  const href = await p.$eval('#helpBox a[data-help="mail"]', a => a.getAttribute('href'));
  const m = /^mailto:martin\.stuis11@gmail\.com\?subject=([^&]*)&body=([^&]*)$/.exec(href);
  assert.ok(m, 'mailto : adresse, objet, corps : ' + href.slice(0, 120));
  assert.equal(m[1], 'Mana%20Orbit%20%C2%B7%20avis', 'objet encodé (espaces en %20, point médian en UTF-8)');
  assert.doesNotMatch(href, /[ +\n]/, 'aucun espace, « + » ni retour à la ligne bruts');
  const body = decodeURIComponent(m[2]), lines = body.split('\r\n'), info = await p.evaluate(() => [DD_BUILD, navigator.userAgent]);
  assert.deepEqual(lines.slice(0, 3), ['', '', ''], 'place pour le message en tête');
  assert.ok(lines.includes('Ces informations aident à reproduire un bug. Ta collection n\'est pas envoyée.'));
  assert.ok(lines.includes('Version : ' + info[0])); assert.ok(lines.includes('Plateforme : web')); assert.ok(lines.some(l => /^Langue : fr \(/.test(l)));
  assert.ok(lines.includes('Navigateur : ' + info[1]), 'navigateur (user agent)');
  assert.doesNotMatch(body, /Sol Ring|Craterhoof/, 'jamais la collection');
  assert.ok(!/\r\n/.test(body.replace(/\r\n/g, '')) && !/[^\r]\n/.test(body), 'fins de ligne CRLF');
  ok('Réglages : « Aide et avis », mailto encodé (objet, version, plateforme, langue, navigateur, phrase de confidentialité), sans la collection');
  await p.$eval('#helpBox', e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await p.click('#helpBox [data-help="open"]'); await p.waitForFunction(() => document.querySelectorAll('.sheet-wrap.open').length === 2);
  assert.equal(await txt(p, '.hp-sheet .sheet-head h2'), 'Comment ça marche');
  assert.equal(await p.$$eval('.hp-sheet .hp-q', q => q.length), 8, '8 questions');
  assert.equal(await p.$$eval('.hp-sheet .hp-q[open]', q => q.length), 0, 'toutes repliées');
  await p.click('.hp-sheet .hp-q[data-i="0"] summary'); await p.waitForTimeout(150);
  assert.match(await txt(p, '.hp-sheet .hp-q[data-i="0"] p'), /Nouveau panier » › Critères › Prix/);
  await p.click('.hp-sheet .hp-q[data-i="2"] summary'); await p.waitForTimeout(150);
  assert.deepEqual(await p.$$eval('.hp-sheet .hp-q[open]', q => q.map(x => x.dataset.i)), ['2'], 'une seule question ouverte à la fois');
  assert.match(await p.$eval('.hp-sheet .sheet-foot a[data-help="mail"]', a => a.getAttribute('href')), /^mailto:martin\.stuis11@gmail\.com\?subject=Mana%20Orbit%20%C2%B7%20avis&body=/);
  await p.waitForTimeout(500); await p.screenshot({ path: 'shots/content-2-aide.png' });
  await p.keyboard.press('Escape'); await p.waitForFunction(() => document.querySelectorAll('.sheet-wrap.open').length === 1);
  ok('feuille « Comment ça marche » depuis les Réglages : 8 questions repliables, une ouverte à la fois, avis en pied');
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  await toHome(p); await p.click('#btnHelp'); await p.waitForSelector('.hp-sheet.open');
  ok('accueil : « Comment ça marche ? » ouvre la même aide');
  await ctx.close();
}
{ // anglais : rubrique, aide et lien de l'accueil traduits
  const { p, ctx } = await page({ path: '?lang=en' });
  assert.equal(await txt(p, '#btnHelp'), '? How does it work?');
  await p.click('#btnSettings'); await p.waitForSelector('#helpBox .sec-title');
  assert.equal(await txt(p, '#helpBox .sec-title'), 'Help and feedback'); assert.match(await txt(p, '#helpBox'), /Send feedback/);
  const body = decodeURIComponent(/body=(.*)$/.exec(await p.$eval('#helpBox a[data-help="mail"]', a => a.getAttribute('href')))[1]);
  assert.match(body, /This information helps us reproduce a bug\. Your collection is not sent\.\r\nVersion: \w+\r\nPlatform: web\r\nLanguage: en/);
  await p.click('#helpBox [data-help="open"]'); await p.waitForSelector('.hp-sheet.open');
  assert.deepEqual((await p.$$eval('.hp-sheet summary', s => s.map(x => x.textContent))).slice(0, 2), ['Cardmarket or CardTrader: which prices?', 'How do I add my cards?']);
  await ctx.close();
}
ok('anglais : « Help and feedback », aide et corps du mail traduits');

/* ── 3) Demande de note ───────────────────────────────────────────────────────────────────────────────────────── */
// appli Android simulée (coque avec le plugin ManaOrbit : version de l'APK), collection et deck enregistré prêts à être « complets »
const shell = `window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: n => n === 'ManaOrbit', Plugins: { ManaOrbit: {
  setWidget: async () => ({}), info: async () => ({ firebase: true, version: '1.0', build: 1 }), addListener: () => ({ remove: async () => {} }) } } };`;
const seedRate = (o = {}) => `try { const now = Date.now();
  localStorage.setItem('deckdeal:coll:v1', JSON.stringify({ t: '2 Sol Ring\\n1 Arcane Signet\\n1 Command Tower\\n1 Wrath of God', u: 1, s: '', b: null }));
  localStorage.setItem('deckdeal:decks:v1', JSON.stringify(['d1', 'd2', 'd3', 'd4', 'd5'].map((id, i) => ({ id, name: 'Deck ' + (i + 1), text: '1 Sol Ring\\n1 Arcane Signet', opts: {}, cards: 2, updatedAt: now - 3600e3 }))));
  ${o.onboard === false ? '' : `localStorage.setItem('deckdeal:onboard', String(now - ${o.days ?? 5} * ${DAY}));`}
  ${o.state ? `localStorage.setItem('deckdeal:rate', ${JSON.stringify(JSON.stringify(o.state))}.replace('"AT"', String(now - ${o.ago || 0})));` : ''}
  } catch (e) {}`;
const mount = (p, id) => p.evaluate(id => { const d = findDeck(id); engSet(id, d.name, d.text); }, id);
const sheetUp = p => p.$('.rate-sheet');
const rateSt = p => p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:rate') || 'null'));
async function ratePage(o = {}) {
  const pg = await page({ init: seedRate(o) + (o.web ? '' : shell), ctx: o.ctx });
  await pg.p.evaluate(url => { RATE.wait = 300; if (url) RATE.url = url; }, o.url === undefined ? PLAY : o.url);
  await pg.p.evaluate(() => { document.addEventListener('click', e => { if (e.target.closest('[data-rate="go"]')) e.preventDefault(); }, true); });      // « Noter » : on garde la page (le lien est vérifié à part)
  await pg.p.evaluate(() => homeSoon(0)); await pg.p.waitForTimeout(300);                                                                               // premier relevé des decks complets (aucun)
  return pg;
}
{ // PLAY_URL vide (valeur livrée) : rien, même dans l'appli et après un bon moment
  const { p, ctx } = await ratePage({ url: '' });
  assert.equal(await p.evaluate(() => [PLAY_URL, RATE.url, isNativeApp()].join('|')), '||true');
  await mount(p, 'd1'); await p.waitForTimeout(1500);
  assert.equal(await sheetUp(p), null, 'aucune demande'); assert.equal(await rateSt(p), null, 'rien d\'enregistré');
  await p.click('#btnSettings'); await p.waitForSelector('#helpBox .btn');
  assert.equal(await p.$('#helpBox [data-help="rate"]'), null, 'pas de bouton « Noter »');
  await ctx.close();
}
ok('note : coupée tant que PLAY_URL est vide (ni demande, ni bouton, ni compteur)');
{ // appli Android, adresse de test : deck devenu complet → demande neutre, après la fermeture de la feuille ouverte
  const { p, ctx } = await ratePage({ ctx: { colorScheme: 'dark' } });
  assert.deepEqual((await rateSt(p)).dk, [], 'premier relevé des decks complets');
  await p.click('#btnSettings'); await p.waitForSelector('#helpBox [data-help="rate"]');
  assert.equal(await p.$eval('#helpBox [data-help="rate"]', a => [a.getAttribute('href'), a.target].join()), PLAY + ',_blank', 'Réglages : « Noter sur le Play Store »');
  assert.match(await p.$eval('#helpBox a[data-help="mail"]', a => decodeURIComponent(a.getAttribute('href'))), /Plateforme : appli Android 1\.0 \(1\)/, 'avis : version de l\'APK');
  await mount(p, 'd1'); await p.waitForTimeout(1200);
  assert.equal(await sheetUp(p), null, 'feuille ouverte (Réglages) : la demande attend');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.rate-sheet.open', { timeout: 4000 });
  assert.equal(await txt(p, '.rate-sheet .sheet-head h2'), 'Noter Mana Orbit');
  assert.equal(await txt(p, '.rate-sheet .rate-hero p'), 'Si Mana Orbit t\'est utile, une note sur le Play Store aide beaucoup.');
  assert.deepEqual(await p.$$eval('.rate-sheet .sheet-foot .btn', b => b.map(x => x.textContent)), ['Plus tard', 'Noter'], 'deux choix, aucune question sur l\'avis');
  assert.equal(await p.$eval('.rate-sheet [data-rate="go"]', a => [a.getAttribute('href'), a.target, a.rel].join()), PLAY + ',_blank,noopener');
  assert.equal(await p.$$eval('.rate-sheet input, .rate-sheet [role="radio"], .rate-sheet .star', e => e.length), 0, 'aucune note à choisir dans l\'appli');
  await p.waitForTimeout(500); await p.screenshot({ path: 'shots/content-3-note.png' });
  let st = await rateSt(p); assert.equal(st.n, 1); assert.ok(Date.now() - st.at < 60000);
  await p.click('.rate-sheet [data-close].btn'); await p.waitForFunction(() => !document.querySelector('.rate-sheet'));
  ok('note : demande neutre « Noter » / « Plus tard » après un deck devenu complet, une fois la feuille ouverte fermée');
  // « Plus tard » : plus rien pendant 120 jours, même après un nouveau bon moment
  await mount(p, 'd2'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, '« Plus tard » : rien avant 120 jours');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('deckdeal:rate')); s.at -= 119 * 864e5; localStorage.setItem('deckdeal:rate', JSON.stringify(s)); });
  await mount(p, 'd3'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, '119 jours : toujours rien');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('deckdeal:rate')); s.at -= 2 * 864e5; localStorage.setItem('deckdeal:rate', JSON.stringify(s)); });
  await mount(p, 'd4'); await p.waitForSelector('.rate-sheet.open', { timeout: 4000 });
  st = await rateSt(p); assert.equal(st.n, 2, '121 jours plus tard : de nouveau');
  await p.click('.rate-sheet [data-rate="go"]'); await p.waitForFunction(() => !document.querySelector('.rate-sheet'));
  assert.equal((await rateSt(p)).done, 1, '« Noter » : plus jamais');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('deckdeal:rate')); s.at -= 400 * 864e5; localStorage.setItem('deckdeal:rate', JSON.stringify(s)); });
  await mount(p, 'd5'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, 'après « Noter » : jamais plus');
  ok('note : « Plus tard » = 120 jours ; « Noter » = plus jamais');
  await ctx.close();
}
{ // un deck démonté puis remonté, ou déjà complet au premier relevé : pas un nouveau moment ; 3 demandes au plus
  const { p, ctx } = await ratePage({ state: { n: 3, at: 'AT', dk: [] }, ago: 200 * DAY });
  await mount(p, 'd1'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, '3 demandes déjà faites : plus jamais'); await ctx.close();
}
for (const [o, why] of [[{ web: true }, 'navigateur (pas l\'appli Android)'], [{ days: 3 }, 'première utilisation il y a 3 jours'], [{ onboard: false }, 'première utilisation inconnue']]) {
  const { p, ctx } = await ratePage(o);
  await mount(p, 'd1'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, why + ' : aucune demande'); await ctx.close();
}
{ // session avec une erreur : aucune demande
  const { p, ctx } = await ratePage();
  await p.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'test' })));
  await mount(p, 'd1'); await p.waitForTimeout(1500); assert.equal(await sheetUp(p), null, 'erreur dans la session : aucune demande'); await ctx.close();
}
ok('note : seulement dans l\'appli Android, après 4 jours d\'utilisation, 3 fois au plus, jamais dans une session avec une erreur');
{ // fin d'un scan : 5 exemplaires ajoutés ou plus = bon moment (la demande attend la fin du toast « Annuler ») ; moins de 5 : rien
  const { p, ctx } = await ratePage();
  const scanAdd = items => p.evaluate(items => { SC.items = new Map(items.map(([name, q], i) => ['s' + i, { id: 's' + i, key: ownKey(name), name, q, l: 'fr', maybe: false }])); scanRecap(); }, items);
  await scanAdd([['Llanowar Elves', 2], ['Edgar Markov', 2]]); await p.waitForSelector('.rc-sheet.open [data-rc="go"]'); await p.click('.rc-sheet [data-rc="go"]');
  await p.waitForSelector('#toast.on'); await p.evaluate(() => document.querySelector('#toast').classList.remove('on')); await p.waitForTimeout(1500);
  assert.equal(await sheetUp(p), null, '4 exemplaires : pas assez');
  await scanAdd([['Swords to Plowshares', 3], ['Llanowar Elves', 2]]); await p.waitForSelector('.rc-sheet.open [data-rc="go"]'); await p.click('.rc-sheet [data-rc="go"]');
  await p.waitForSelector('#toast.on'); await p.waitForTimeout(1200);
  assert.equal(await sheetUp(p), null, 'toast « Annuler » à l\'écran : la demande attend');
  await p.evaluate(() => document.querySelector('#toast').classList.remove('on'));
  await p.waitForSelector('.rate-sheet.open', { timeout: 4000 });
  assert.equal(await p.evaluate(() => COLL.map[ownKey('Swords to Plowshares')].q), 3, 'cartes bien ajoutées');
  await ctx.close();
}
ok('note : après 5 exemplaires ou plus ajoutés d\'un scan, une fois le toast parti');

assert.deepEqual(errsAll.flat(), [], 'aucune erreur page : ' + errsAll.flat().join(' | '));
await browser.close(); world.stop();
console.log('\nCONTENT E2E OK'); process.exit(0);
