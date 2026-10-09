// E2E anglais : ?lang=en (gardé ensuite), textes de la page et du code traduits, nombres et prix au format anglais, retour au français par les réglages.
// Relève aussi les textes encore en français sur les écrans principaux (liste affichée, à relire), sans faire échouer le test pour autant.
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toInput, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18940, env: { CARDTRADER_TOKEN: '' } });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const FR = /\b(les|des|une|ton|tes|avec|pour|dans|cartes?|prix|aucune?|réglages|vérifie|ajoute|choisis|enregistr\w+|à|é\w*)\b/i;
const leftovers = async p => p.evaluate(fr => {
  const re = new RegExp(fr, 'i'), out = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode, el = n.parentElement; if (!el || el.closest('script,style,textarea,[hidden]') || !el.offsetParent) continue;
    const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t.length > 2 && re.test(t)) out.add(t.slice(0, 90));
  }
  return [...out];
}, FR.source);

const { p, errs } = await newPage(browser, world, { goto: false });
await p.goto(world.url + '?lang=en'); await p.waitForTimeout(800);
assert.equal(await p.evaluate(() => [I18N.lang, document.documentElement.lang, localStorage.getItem('deckdeal:lang')].join()), 'en,en,en');
assert.equal(await p.evaluate(() => location.search), '', 'adresse nettoyée');
assert.match(await txt(p, '#btnDecks'), /My decks/); assert.match(await txt(p, '#hmNew'), /New cart/i); assert.equal(await p.evaluate(() => priceSrc()), 'cm');
const home = await leftovers(p); console.log('  accueil, encore en français :', home.length ? home : 'rien');
ok('?lang=en : langue gardée, accueil en anglais');
// dictionnaire : bloc JSON inerte de la page (jamais compilé comme du code), analysé seulement pour l'anglais
assert.equal(await p.evaluate(() => [typeof I18N_ALL, document.getElementById('i18n-en').type, T('Nouvelle version disponible'), T('Recharger')].join('|')), 'undefined|application/json|New version available|Reload');
ok('dictionnaire anglais lu depuis son bloc JSON (toast de mise à jour traduit)');

await toInput(p); await p.fill('#deckText', '1 Sol Ring\n2 Craterhoof Behemoth'); await p.waitForTimeout(250); await p.click('#btnRun');
await p.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 20000 }); await p.waitForTimeout(900);
assert.match(await txt(p, '#heroAmt'), /€19\.50/, 'prix au format anglais'); assert.match(await txt(p, '#heroLabel'), /Cardmarket/); assert.doesNotMatch(await txt(p, '#heroLabel'), /partir/);
assert.match(await txt(p, '#btnCartTxt'), /Cardmarket/); assert.doesNotMatch(await txt(p, '#btnCartTxt'), /Copier/);
const res = await leftovers(p); console.log('  résultats, encore en français :', res.length ? res : 'rien');
ok('recherche au prix Cardmarket : libellés et montants en anglais (€19.50)');

await p.click('#btnSettings'); await p.waitForSelector('#setLang'); await p.waitForSelector('.sheet-wrap.open .sheet-head');      // classe « open » posée deux images après l'ouverture
assert.match(await txt(p, '.sheet-wrap.open .sheet-head'), /Settings/); assert.match(await txt(p, '.sheet-body .fan'), /unofficial Fan Content/);
const set = await leftovers(p); console.log('  réglages, encore en français :', set.length ? set : 'rien');
await Promise.all([p.waitForEvent('load'), p.selectOption('#setLang', 'fr')]); await p.waitForTimeout(700);
assert.equal(await p.evaluate(() => I18N.lang), 'fr'); await toHome(p); assert.match(await txt(p, '#btnDecks'), /Mes decks/);
assert.equal(await p.evaluate(() => I18N.dict), null, 'français : aucun dictionnaire analysé');
ok('Réglages › Langue : retour au français (rechargement), choix gardé');
assert.deepEqual(errs, []);
await browser.close(); world.stop();
console.log('\nI18N E2E OK'); process.exit(0);
