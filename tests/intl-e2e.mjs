// E2E langue des cartes : par défaut celle de l'utilisateur (interface : allemande → offres allemandes, repli anglais ; sinon téléphone : japonais → cartes japonaises), choix explicite gardé,
// changement de langue de l'interface suivi tant que rien n'a été choisi, anciens réglages (« fr » enregistré par défaut) recalculés, decks enregistrés,
// liens Cardmarket (fiche, Wants) dans la langue de l'utilisateur. Captures 390 px, thème sombre : SHOTS=dossier (facultatif).
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, startWorld, newPage, txt, ok, toInput } from './e2e-world.mjs';

const world = await startWorld({ port: 18925, env: { CARDTRADER_TOKEN: '' } });      // sans token : prix Cardmarket (lien « Voir sur Cardmarket » dans la fiche)
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const SHOTS = process.env.SHOTS || ''; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const decks = [{ id: 'd1', name: 'Vieux deck', text: '1 Sol Ring', opts: { lang: 'fr', cond: 'Near Mint', foil: 'no', mode: 'zero', ship: 280, fallbackEn: true }, cards: 1, history: [], createdAt: 1, updatedAt: 1 }];
/** Page mobile dans une langue de téléphone ; ui : langue de l'interface déjà choisie ; seed : réglages enregistrés. Posés une seule fois (pas à chaque rechargement). */
const page = (locale, { ui = '', seed = '', path = '' } = {}) => newPage(browser, world, { path, ctx: { locale, colorScheme: 'dark' }, init: `try {
  if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('deckdeal:onboard', '1'); ${ui ? `localStorage.setItem('deckdeal:lang', '${ui}');` : ''}
    localStorage.setItem('deckdeal:decks:v1', ${JSON.stringify(JSON.stringify(decks))}); ${seed} }
} catch (e) {}` });
const state = p => p.evaluate(() => ({ ui: I18N.lang, lang: S.opts.lang, set: S.opts.langSet, sel: document.querySelector('#optLang').value, saved: (JSON.parse(localStorage.getItem('deckdeal:v1') || '{}').opts || {}) }));
const reload = async p => { await p.reload(); await p.waitForTimeout(700); };
const cmLink = async p => {      // recherche au prix Cardmarket, fiche de Sol Ring : lien « Voir sur Cardmarket »
  await toInput(p); await p.fill('#deckText', '1 Sol Ring'); await p.waitForTimeout(250); await p.click('#btnRun');
  await p.waitForFunction(() => S.run && S.run.status === 'done', null, { timeout: 20000 }); await p.waitForTimeout(400);
  await p.click('.row[data-key="sol ring"]'); await p.waitForSelector('.sheet-wrap.open .cm-price');
  const href = await p.$eval('.sheet-wrap.open a[href*="cardmarket.com"]', a => a.href); await p.keyboard.press('Escape'); await p.waitForTimeout(350);
  return href;
};

{ // 1) téléphone allemand, interface allemande → offres allemandes, puis anglaises par le repli (comme le français)
  const { p, errs } = await page('de-DE', { ui: 'de' });
  let s = await state(p);
  assert.equal(s.ui, 'de'); assert.equal(await p.evaluate(() => navigator.languages[0]), 'de-DE');
  assert.equal(s.lang, 'de', 'langue des cartes : allemand'); assert.equal(s.set, false, 'pas un choix : elle suivra la langue de l\'utilisateur'); assert.equal(s.sel, 'de');
  await toInput(p);
  assert.equal(await p.$eval('#optLang', e => e.selectedOptions[0].textContent.trim()), 'Deutsch'); assert.equal(await p.$eval('#optFallback', e => e.checked), true, 'repli anglais gardé');
  if (SHOTS) { await p.$eval('#optLang', e => e.closest('.panel').scrollIntoView({ block: 'center' })); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/intl-de-new-cart.png' }); }
  ok('téléphone allemand (interface allemande) : « Sprache » = Deutsch, repli anglais actif');
  assert.match(await cmLink(p), /^https:\/\/www\.cardmarket\.com\/de\/Magic\/Products\/Search\?searchString=Sol%20Ring$/);
  assert.match(await txt(p, '#recap'), /Cardmarket/);
  await p.evaluate(() => { window.__open = ''; window.open = u => { window.__open = u; }; window.__clip = ''; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
  await p.click('#btnCart'); await p.waitForSelector('#toast.on .toast-act'); await p.click('#toast .toast-act');
  assert.equal(await p.evaluate(() => window.__open), 'https://www.cardmarket.com/de/Magic/Wants', 'Wants list : site allemand');
  ok('liens Cardmarket (fiche carte, Wants list) : site allemand');
  s = await state(p); assert.deepEqual([s.saved.lang, s.saved.langSet], ['de', false], 'enregistré sans être figé');
  await p.evaluate(() => loadDeck('d1', true)); s = await state(p);
  assert.equal(s.lang, 'de', 'deck enregistré avec l\'ancien défaut (français) : la langue de l\'utilisateur reste'); assert.equal(s.sel, 'de');
  assert.equal(await p.evaluate(() => S.opts.cond), 'Near Mint', 'les autres critères du deck s\'appliquent');
  ok('deck enregistré en « français » par l\'ancien défaut : cartes toujours cherchées en allemand');
  if (SHOTS) { await p.evaluate(() => window.scrollTo(0, 0)); await p.click('#btnSettings'); await p.waitForSelector('.sheet-wrap.open .sheet-head'); await p.waitForTimeout(450); await p.screenshot({ path: SHOTS + '/intl-de-settings.png' }); await p.keyboard.press('Escape'); await p.waitForTimeout(350); }
  // 2) choix explicite : gardé au rechargement, et même quand l'interface change de langue
  await toInput(p); await p.selectOption('#optLang', 'es'); await p.waitForTimeout(200);
  s = await state(p); assert.deepEqual([s.lang, s.set, s.saved.lang, s.saved.langSet], ['es', true, 'es', true]);
  await reload(p); s = await state(p); assert.deepEqual([s.lang, s.set, s.sel], ['es', true, 'es'], 'choix gardé au rechargement');
  await p.evaluate(() => loadDeck('d1', true)); assert.equal((await state(p)).lang, 'fr', 'langue choisie à la main : les critères du deck s\'appliquent comme avant');
  await toInput(p); await p.selectOption('#optLang', 'es'); await p.waitForTimeout(200);
  await p.click('#btnSettings'); await p.waitForSelector('#setLang'); await p.waitForSelector('.sheet-wrap.open .sheet-head');
  await Promise.all([p.waitForEvent('load'), p.selectOption('#setLang', 'fr')]); await p.waitForTimeout(700);
  s = await state(p); assert.deepEqual([s.ui, s.lang, s.set], ['fr', 'es', true], 'interface passée en français : la langue choisie reste');
  ok('choix explicite de la langue des cartes : gardé au rechargement et au changement de langue de l\'interface');
  assert.deepEqual(errs, []); await p.context().close();
}
{ // 3) sans choix, changer la langue de l'interface déplace la langue des cartes (réglages, puis premier lancement)
  const { p, errs } = await page('fr-FR');
  let s = await state(p); assert.deepEqual([s.ui, s.lang, s.set], ['fr', 'fr', false], 'téléphone français : rien ne change pour les utilisateurs actuels');
  assert.match(await cmLink(p), /cardmarket\.com\/fr\/Magic\//);
  await p.click('#btnSettings'); await p.waitForSelector('#setLang'); await p.waitForSelector('.sheet-wrap.open .sheet-head');
  await Promise.all([p.waitForEvent('load'), p.selectOption('#setLang', 'en')]); await p.waitForTimeout(700);
  s = await state(p); assert.deepEqual([s.ui, s.lang, s.set], ['en', 'en', false], 'anglais choisi sur un téléphone français : cartes anglaises');
  assert.match(await cmLink(p), /cardmarket\.com\/en\/Magic\//);
  ok('téléphone français : français par défaut ; interface passée en anglais (réglages) → cartes anglaises, Cardmarket en anglais');
  await p.context().close();
  const o = await page('fr-FR', { path: '?onboarding' });
  await o.p.evaluate(() => { localStorage.removeItem('deckdeal:onboard'); obOpen(); }); await o.p.waitForSelector('.ob [data-ob="lang:en"]');
  await Promise.all([o.p.waitForEvent('load'), o.p.click('.ob [data-ob="lang:en"]')]); await o.p.waitForTimeout(700);
  s = await state(o.p); assert.deepEqual([s.ui, s.lang], ['en', 'en'], 'premier lancement : « English » → cartes anglaises');
  ok('premier lancement : le choix de la langue de l\'interface déplace aussi celle des cartes');
  assert.deepEqual([...errs, ...o.errs], []); await o.p.context().close();
}
{ // 4) téléphone anglais : anglais ; téléphone japonais (pas d'interface japonaise) avec réglages d'avant (« fr » enregistré par défaut, sans drapeau) : recalculé → japonais
  const { p, errs } = await page('en-US', { ui: 'en' });
  let s = await state(p); assert.deepEqual([s.lang, s.sel], ['en', 'en']);
  assert.match(await cmLink(p), /cardmarket\.com\/en\/Magic\//); assert.deepEqual(errs, []); await p.context().close();
  const old = JSON.stringify({ opts: { lang: 'fr', cond: 'Near Mint', foil: 'any', mode: 'zero', ship: 280, fallbackEn: true } });
  const it = await page('ja-JP', { ui: 'en', seed: `localStorage.setItem('deckdeal:v1', ${JSON.stringify(old)});` });
  s = await state(it.p); assert.deepEqual([s.lang, s.set, s.sel], ['jp', false, 'jp'], 'ancien défaut « fr » : recalculé'); assert.equal(await it.p.evaluate(() => S.opts.cond + '|' + S.opts.foil), 'Near Mint|any', 'autres critères gardés');
  assert.deepEqual(it.errs, []); await it.p.context().close();
  const chosen = JSON.stringify({ opts: { lang: 'jp', cond: 'Near Mint', foil: 'no', mode: 'zero', ship: 280, fallbackEn: true } });
  const jp = await page('de-DE', { ui: 'en', seed: `localStorage.setItem('deckdeal:v1', ${JSON.stringify(chosen)});` });
  s = await state(jp.p); assert.deepEqual([s.lang, s.set], ['jp', true], 'ancienne langue autre que le français : forcément choisie, gardée');
  await reload(jp.p); s = await state(jp.p); assert.deepEqual([s.lang, s.set], ['jp', true]);
  assert.deepEqual(jp.errs, []); await jp.p.context().close();
  ok('téléphone anglais : cartes anglaises ; anciens réglages : « fr » par défaut recalculé, autre langue gardée comme un choix');
}

await browser.close(); world.stop();
console.log('\nINTL E2E OK'); process.exit(0);
