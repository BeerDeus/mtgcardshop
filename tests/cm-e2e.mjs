// E2E « prix Cardmarket » : sans token CardTrader, l'appli donne le prix tendance de chaque carte (relevé du serveur, sinon Scryfall),
// sans livraison ni vendeurs ; avec un token perso, elle cherche les offres CardTrader avec CE token (en-tête X-CT-Token).
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { chromium, startWorld, newPage, txt, ok, toInput } from './e2e-world.mjs';

const world = await startWorld({ port: 18930, env: { CARDTRADER_TOKEN: '' } });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const DECK = '1 Sol Ring\n2 Craterhoof Behemoth\n1 Carte Qui N Existe Pas';
const settle = p => p.waitForFunction(() => S.run && S.run.status !== 'running', null, { timeout: 30000 });
const amt = (p, re) => p.waitForFunction(r => new RegExp(r).test(document.querySelector('#heroAmt').textContent), re.source, { timeout: 5000 });
const run = async p => { await toInput(p); await p.fill('#deckText', DECK); await p.waitForTimeout(250); await p.click('#btnRun'); await settle(p); await p.waitForTimeout(400); };

{ // 1) sans relevé du serveur : Scryfall (prix de l'impression par défaut)
  const { p, errs } = await newPage(browser, world);
  await p.goto(world.url); await p.waitForTimeout(700);
  assert.equal(await p.evaluate(() => priceSrc()), 'cm'); assert.equal(await txt(p, '#modeLabel'), 'Cardmarket'); ok('serveur sans token, aucun token perso : prix Cardmarket par défaut (puce « Cardmarket »)');
  await run(p);
  assert.equal(await p.evaluate(() => S.run.status), 'done');
  assert.equal(await txt(p, '#progTitle'), 'Prix Cardmarket');
  assert.equal(await txt(p, '#heroLabel'), 'Prix Cardmarket, à partir de');
  await amt(p, /19,50/);      // 1 × 1,50 + 2 × 9,00
  assert.equal(await p.$eval('#segDeliv', e => e.hidden), true); assert.equal(await p.$eval('#segTab', e => e.closest('.toolbar').hidden), true);
  assert.equal(await txt(p, '#btnCartTxt'), 'Copier pour Cardmarket');
  assert.equal(world.reqs(), 0, 'aucune requête CardTrader');
  assert.ok(world.scry.some(s => s.startsWith('POST /cards/collection')), 'Scryfall interrogé (pas de relevé serveur)');
  assert.match(await txt(p, '.row[data-key="carte qui n existe pas"]'), /Nom introuvable/);
  assert.match(await txt(p, '.row[data-key="craterhoof behemoth"]'), /Cardmarket.*Tendance · 2 × 9,00/);
  assert.match(await txt(p, '#recap'), /Prix tendance Cardmarket · impression la moins chère · hors port/);
  ok('recherche : prix tendance par carte (Scryfall), total 19,50 €, ni livraison ni vendeurs, aucune requête CardTrader, nom inconnu signalé');
  await p.click('.row[data-key="sol ring"]'); await p.waitForSelector('.sheet-wrap.open .cm-price');
  assert.match(await txt(p, '.cm-price'), /1,50/); assert.match(await p.$eval('.sheet-wrap.open a[href*="cardmarket.com"]', a => a.href), /cardmarket\.com\/fr\/Magic\/Products\/Search\?searchString=Sol%20Ring/);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400); ok('fiche carte : prix par exemplaire + lien Cardmarket');
  await p.evaluate(() => { window.__clip = ''; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
  await p.click('#btnCart'); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.__clip), '1 Sol Ring\n2 Craterhoof Behemoth\n1 Carte Qui N Existe Pas'); assert.match(await txt(p, '#toast'), /Wants list Cardmarket/);
  ok('« Copier pour Cardmarket » : liste prête pour une Wants list');
  assert.deepEqual(errs, []); await p.context().close();
}

{ // 2) avec le relevé du serveur : prix « à partir de » sans Scryfall ; puis token perso → CardTrader avec ce token
  world.scry.length = 0;
  const { p, errs } = await newPage(browser, world);
  await p.route('**/prices.tsv', r => r.fulfill({ status: 200, contentType: 'text/tab-separated-values', body: '#MOPX1 2026-10-08T09:00:00Z 2\nSol Ring\t120\t100\nCraterhoof Behemoth\t800\t950\n' }));
  await p.goto(world.url); await p.waitForTimeout(700);
  await run(p);
  await amt(p, /17,20/);      // 1,20 + 2 × 8,00 (relevé)
  assert.equal(world.scry.filter(s => s.startsWith('POST /cards/collection')).length, 1, 'Scryfall seulement pour la carte absente du relevé');
  assert.match(await txt(p, '.step[data-id="prints"]'), /8 oct/);
  ok('relevé du serveur : prix « à partir de » sans Scryfall (sauf carte absente), date du relevé affichée');

  // réglages : source des prix + token perso
  const ctHdr = []; p.on('request', r => { if (/\/api\/(marketplace|blueprints|expansions|info|jobs)/.test(r.url())) ctHdr.push(r.headers()['x-ct-token'] || ''); });
  await p.click('#btnSettings'); await p.waitForSelector('#segSrc');
  assert.equal(await p.$eval('#segSrc', e => e._v), 'cm'); assert.match(await txt(p, '#connMsg'), /Prix tendance Cardmarket.*ajoute ton token/);
  await p.click('#segSrc [data-v="ct"]'); await p.waitForTimeout(200); assert.equal(await p.$eval('#segSrc', e => e._v), 'cm', 'CardTrader sans token : refusé'); assert.match(await txt(p, '#toast'), /token CardTrader/);
  await p.fill('#setToken', 'mon-token-cardtrader-1234567890'); await p.waitForTimeout(150);
  assert.equal(await p.$eval('#segSrc', e => e._v), 'ct'); assert.match(await txt(p, '#connMsg'), /CardTrader avec ton token/); assert.equal(await txt(p, '#modeLabel'), 'CardTrader');
  ok('réglages : Cardmarket par défaut, CardTrader seulement avec un token, statut et puce à jour');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.click('#btnBack'); await p.click('#btnRun'); await settle(p);
  assert.equal(await p.evaluate(() => S.run.src), 'ct'); assert.ok(world.reqs() > 0, 'offres CardTrader lues');
  assert.ok(ctHdr.length && ctHdr.every(h => h === 'mon-token-cardtrader-1234567890'), 'chaque requête CardTrader porte le token de l\'utilisateur');
  assert.equal(await p.$eval('#segDeliv', e => e.hidden), false); assert.equal(await txt(p, '#btnCartTxt'), 'Remplir le panier');
  ok('token perso : recherche CardTrader via le serveur avec ce token (X-CT-Token), livraison et panier de retour');
  await p.click('#btnSettings'); await p.waitForSelector('#segSrc'); await p.click('#segSrc [data-v="cm"]'); await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => [S.src, priceSrc()].join()), 'cm,cm'); assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('deckdeal:v1')).src), 'cm');
  ok('choix « Cardmarket » gardé même avec un token');
  assert.deepEqual(errs, []); await p.context().close();
}

await browser.close(); world.stop();
console.log('\nCM E2E OK');
process.exit(0);
