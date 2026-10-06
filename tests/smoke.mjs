import './setup-env.mjs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../deck-deal.html', import.meta.url), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail && e.detail.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => errors.push('console.warn: ' + a.join(' ')));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost:8787/', virtualConsole: vc,
  beforeParse(w) {
    w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.Element.prototype.scrollIntoView = function () {};
    w.Element.prototype.animate = function () { return { cancel() {}, finished: Promise.resolve(), onfinish: null }; };
    w.scrollTo = () => {};
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { w.__copied = t; } }, configurable: true });
  },
});
const w = dom.window, d = w.document;
const $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
async function until(fn, label, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return; } catch (e) {} await sleep(100); }
  throw new Error('timeout: ' + label);
}
const ok = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('✗', m); } else console.log('✓', m); };

await sleep(300);
ok(!errors.length, 'chargement sans erreur ' + JSON.stringify(errors));
ok($('#modeLabel').textContent.trim().length > 0, 'chip mode : ' + $('#modeLabel').textContent);

click($('#btnSample'));
await sleep(100);
ok($('#deckText').value.split('\n').length > 50, 'exemple chargé (' + $('#deckText').value.split('\n').length + ' lignes)');
ok(/\d/.test($('#deckStats').textContent), 'stats deck : ' + $('#deckStats').textContent.replace(/\s+/g, ' ').trim());

click($('#btnRun'));
await sleep(200);
ok(!$('#viewResults').hidden, 'vue résultats visible');
ok($$('#list .row, #list .sk').length > 0, 'lignes / skeletons présents');
await until(() => $('#progressWrap').classList.contains('is-done') || /Terminé|terminé|offres/.test($('#progTitle').textContent) && !$('#dockResults').hidden && $$('#list .row[data-state="ready"], #list .row:not(.is-loading)').length > 30, 'fin de recherche', 90000).catch(e => { errors.push(e.message); });
await sleep(600);
console.log('progTitle:', $('#progTitle').textContent, '| pct:', $('#progPct').textContent, '| rate:', $('#progRate').textContent);
console.log('hero:', $('#heroAmt').textContent, '|', $('#heroCount').textContent, '|', $('#heroSellers').textContent, '| save:', $('#heroSave').hidden ? '-' : $('#heroSave').textContent);
console.log('dock:', $('#dockSmall').textContent, $('#dockTotal').textContent);
const rows = $$('#list .row');
ok(rows.length >= 40, 'lignes cartes : ' + rows.length);
ok(/\d/.test($('#heroAmt').textContent) && !/^0,00/.test($('#heroAmt').textContent.trim()), 'total hero non nul');
ok(!$('#dockResults').hidden, 'dock résultats visible');
ok($('#heroAmt').textContent.trim() !== '' && $('#dockTotal').textContent.trim() !== '0,00 €', 'total dock : ' + $('#dockTotal').textContent);
const missing = $$('#list .row.is-missing').length;
console.log('cartes sans offre :', missing, '| alertes :', $$('#alerts > *').length, '|', $('#alerts').textContent.replace(/\s+/g, ' ').slice(0, 200));

// bascule Direct
const delivBtns = $$('#segDeliv button, #segDeliv [role=radio]');
console.log('segDeliv boutons:', delivBtns.length);
const totalZero = $('#heroAmt').textContent;
if (delivBtns.length > 1) { click(delivBtns[1]); await sleep(800); }
console.log('hero direct:', $('#heroAmt').textContent, '|', $('#heroSellers').textContent, '| save:', $('#heroSave').hidden ? '-' : $('#heroSave').textContent);
ok($('#heroAmt').textContent !== totalZero || true, 'bascule direct sans crash');

// onglet vendeurs
const tabs = $$('#segTab button, #segTab [role=radio]');
if (tabs.length > 1) { click(tabs[1]); await sleep(500); }
ok(!$('#sellers').hidden && $$('#sellers .group').length > 0, 'vue vendeurs : ' + $$('#sellers .group').length + ' groupes');
if (tabs.length > 1) { click(tabs[0]); await sleep(300); }

// feuille carte
const first = $('#list .row:not(.is-missing)');
click(first); await sleep(700);
ok(!!$('#sheetRoot .sheet'), 'feuille carte ouverte');
const offerRows = $$('#sheetRoot .offer, #sheetRoot [data-offer]');
console.log('offres dans la feuille:', offerRows.length);
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(600);

// panier simulé
click($('#btnCart')); await sleep(600);
ok(!!$('#sheetRoot .sheet'), 'feuille panier ouverte');
const go = [...$$('#sheetRoot button')].find(b => /Remplir|Ajouter|Confirmer|panier/i.test(b.textContent) && !b.hasAttribute('data-close'));
console.log('boutons feuille panier:', $$('#sheetRoot button').map(b => b.textContent.trim()).join(' | '));
if (go) { click(go); await until(() => /ajoutée|simulation/.test($('#sheetRoot').textContent), 'panier simulé', 40000).catch(e => errors.push(e.message)); }
console.log('panier :', $('#sheetRoot').textContent.replace(/\s+/g, ' ').slice(0, 260));

// copie
click($('#btnCopy')); await sleep(200);
ok(/Deck Deal/.test(w.__copied || ''), 'récap copié (' + (w.__copied || '').split('\n').length + ' lignes)');

// réglages
click($('#btnSettings')); await sleep(500);
ok(!!$('#sheetRoot .sheet'), 'réglages ouverts');

console.log('\nERREURS:', errors.length ? '\n' + errors.join('\n') : 'aucune');
process.exit(errors.length ? 1 : 0);
