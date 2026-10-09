// E2E nouvel utilisateur et decks EDHREC réservés aux comptes : collection vide (onglets gardés, états vides Cartes / Stats, Échange utilisable),
// onglet « Decks » sans compte (écran de connexion), compte e-mail non vérifié (lien envoyé à l'inscription, « Renvoyer » limité à 1 / min,
// trop de demandes, « J'ai cliqué sur le lien »), compte Google de l'appli Android (accès direct), tuile « Deck à monter ».
// Vrai SDK Firebase (bundle servi à la place du CDN), auth simulée par routes (comme e2e-account), Firestore hors ligne. Captures dans shots/gate-*.png
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, startWorld, newPage, txt, ok, toHome } from './e2e-world.mjs';

const world = await startWorld({ port: 18985 });
const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM || '/opt/pw-browsers/chromium'), args: ['--no-sandbox'] });
const SHARED = readFileSync('tests/.tmp/fb-shared.js', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── faux Firebase Auth (identitytoolkit / securetoken) : comptes, adresse vérifiée ou non, envois de liens ─────────────── */
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const users = new Map(), oob = [], CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let oobFail = '', lookups = 0;
const jwt = email => { const u = users.get(email), n = Math.floor(Date.now() / 1000); return [b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' }), b64({ iss: 'https://securetoken.google.com/m2s-mtg', aud: 'm2s-mtg', auth_time: n, user_id: u.uid, sub: u.uid, iat: n, exp: n + 3600, email, email_verified: u.verified, firebase: { identities: { [u.prov]: [email] }, sign_in_provider: u.prov } }), 'sig'].join('.'); };
const claims = t => JSON.parse(Buffer.from(String(t || '').split('.')[1] || 'e30', 'base64url').toString());
async function wireFirebase(ctx) {
  for (const n of ['app', 'auth', 'firestore']) await ctx.route(`https://www.gstatic.com/firebasejs/12.19.0/firebase-${n}.js`, r => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/javascript' }, body: "export * from 'https://fb.test/shared.js';" }));
  await ctx.route('https://fb.test/shared.js', r => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/javascript' }, body: SHARED }));
  await ctx.route(/firestore\.googleapis\.com|apis\.google\.com|firebaseapp\.com/, r => r.abort());
  await ctx.route(/identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/, async route => {
    const req = route.request(); if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const op = req.url().split('?')[0].split('/').pop();
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { body = Object.fromEntries(new URLSearchParams(req.postData() || '')); }
    const j = o => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(o) });
    const err = m => route.fulfill({ status: 400, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: 400, message: m } }) });
    const tok = email => ({ kind: 'x', idToken: jwt(email), email, refreshToken: 'r:' + email, expiresIn: '3600', localId: users.get(email).uid, registered: true });
    if (op === 'accounts:signUp') { if (users.has(body.email)) return err('EMAIL_EXISTS'); users.set(body.email, { uid: 'uid-' + (users.size + 1), pw: body.password, verified: false, prov: 'password' }); return j(tok(body.email)); }
    if (op === 'accounts:signInWithPassword') { const x = users.get(body.email); if (!x || x.pw !== body.password) return err('INVALID_LOGIN_CREDENTIALS'); return j(tok(body.email)); }
    if (op === 'accounts:lookup') { lookups++; const email = claims(body.idToken).email, x = users.get(email); if (!x) return err('USER_NOT_FOUND'); return j({ users: [{ localId: x.uid, email, emailVerified: x.verified, providerUserInfo: [{ providerId: x.prov, email, federatedId: email, rawId: email }], lastLoginAt: String(Date.now()), createdAt: String(Date.now()) }] }); }
    if (op === 'accounts:sendOobCode') {
      oob.push({ type: body.requestType, email: claims(body.idToken).email || body.email, url: body.continueUrl || '', lang: req.headers()['x-firebase-locale'] || '' });
      if (oobFail) return err(oobFail);
      return j({ email: claims(body.idToken).email || body.email });
    }
    if (op === 'accounts:signInWithIdp') {      // connexion Google (jeton d'identité rendu par le plugin natif de l'appli Android)
      const email = 'goog@test.dev'; if (!users.has(email)) users.set(email, { uid: 'uid-google', pw: '', verified: false, prov: 'google.com' });      // adresse non marquée vérifiée ici : seul « google.com » doit ouvrir l'accès
      return j({ ...tok(email), providerId: 'google.com', federatedId: 'https://accounts.google.com/123', emailVerified: true, kind: 'identitytoolkit#VerifyAssertionResponse' });
    }
    if (op === 'token') { const email = String(body.refresh_token || '').replace(/^r:/, ''); if (!users.has(email)) return err('TOKEN_EXPIRED'); return j({ access_token: jwt(email), id_token: jwt(email), refresh_token: body.refresh_token, expires_in: '3600', token_type: 'Bearer', user_id: users.get(email).uid }); }
    return j({ projectId: 'm2s-mtg', authorizedDomains: ['localhost', '127.0.0.1'] });
  });
}
/* ── fichier EDHREC : deux commandants ─────────────────────────────────────────────────────────── */
const filler = (n, from = 0) => Array.from({ length: n }, (_, i) => `K\t1\tFiller ${from + i}`);
const EDH = ['#edh\t1\t2026-10-03T04:00:00Z', 'C\tedgar-markov\t12345\tWBR\tEdgar Markov', 'C\tcraterhoof-behemoth\t100\tG\tCraterhoof Behemoth',
  'D\tedgar-markov\tedhrec\tDeck moyen\thttps://edhrec.com/average-decks/edgar-markov', 'K\t1\tSol Ring', 'K\t1\tArcane Signet', 'K\t8\tPlains', ...filler(60),
  'D\tcraterhoof-behemoth\tedhrec\tDeck moyen\t', 'K\t1\tLlanowar Elves', 'K\t1\tSol Ring', ...filler(60, 100), 'P\t150\tSol Ring', 'P\t40\tArcane Signet'].join('\n');
let edhHits = 0;
async function page(opts = {}) {
  const pg = await newPage(browser, world, { goto: false, ctx: { colorScheme: 'dark' }, ...opts });
  await wireFirebase(pg.ctx);
  await pg.p.route('**/edh.bin.gz', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await pg.p.route('**/edh.tsv', r => { edhHits++; return r.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8', body: EDH }); });
  await pg.p.goto(world.url); await pg.p.waitForFunction(() => D.authReady && D.state === 'ready', null, { timeout: 15000 });
  return pg;
}
const sheetOpen = p => p.waitForSelector('.sheet-wrap.open .sheet', { timeout: 5000 });
const sheetGone = p => p.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 5000 });
const tab = async (p, v) => { await p.click(`#collSeg [data-v="${v}"]`); await p.waitForTimeout(250); };
const shot = (p, n) => p.screenshot({ path: `shots/gate-${n}.png` });
const FS_OFF = /firestore|Firestore|WebChannel/;      // Firestore hors ligne (réseau coupé par le test) : messages attendus
const visible = (p, sel) => p.$eval(sel, e => !!e.offsetParent).catch(() => false);

/* ═══ 1. Nouvel utilisateur : collection vide, onglets gardés ════════════════════════════════════ */
const A = await page();
const { p } = A;
await toHome(p);
assert.equal(await p.$eval('#btnColl', e => e.dataset.empty), '1');
assert.equal(await txt(p, '#hmBuildSub'), 'Decks EDHREC · Connecte-toi'); assert.equal(await p.$eval('#btnBuild', e => e.dataset.lock), '1'); assert.ok(await p.$('#hmBuildPct svg'), 'cadenas à la place du pourcentage');
await sleep(2800); assert.equal(edhHits, 0, 'sans compte : la tuile ne télécharge pas le fichier EDHREC');
await p.$eval('#btnBuild', e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(250); await shot(p, '0-accueil');
ok('accueil sans compte : tuile « Decks EDHREC · Connecte-toi » (cadenas, aucun chiffre ni téléchargement)');
await p.click('#btnColl'); await p.waitForSelector('.coll.on'); await p.waitForTimeout(300);
assert.ok(await visible(p, '#collSeg'), 'onglets visibles avec une collection vide');
assert.deepEqual(await p.$$eval('#collSeg .seg-opt', b => b.map(x => x.dataset.v)), ['list', 'stats', 'decks', 'trade']);
assert.match(await txt(p, '.coll-main .dv-empty'), /^Pas encore de cartes pour l'instant Scanne tes cartes pour débuter\. Scanner Importer Ajouter à la main Pour 1 000 cartes ou plus/);
assert.deepEqual(await p.$$eval('.coll-main .coll-cta .btn', b => b.map(x => [x.dataset.act, x.classList.contains('ghost')].join())), ['scan,false', 'import,true', 'add,true'], 'Scanner en premier (bouton plein)');
assert.equal(await visible(p, '.coll-px'), false, 'pas de bouton « € » sans carte'); assert.equal(await visible(p, '.coll-fwrap'), false, 'ni recherche, ni filtres, ni tri');
await shot(p, '1-cartes-vide');
await p.click('.coll-main [data-act="add"]'); await sheetOpen(p); assert.ok(await p.$('.sheet-wrap.open')); await p.keyboard.press('Escape'); await sheetGone(p);
ok('Cartes : « Pas encore de cartes pour l\'instant », Scanner / Importer / Ajouter à la main (feuille ouverte), ni € ni filtres');
await tab(p, 'stats');
assert.match(await txt(p, '.coll-main .dv-empty'), /^Pas encore de stats .* Scanner des cartes$/); assert.ok(await p.$('.coll-main [data-act="scan"]'));
await shot(p, '1b-stats-vide');
ok('Stats : état vide qui mène au scan');
await tab(p, 'trade'); await p.waitForSelector('#trSub');
assert.match(await txt(p, '.coll-main'), /Aucun doublon pour l'instant/); assert.equal(await visible(p, '.coll-fwrap'), false);
await p.click('#trSub .seg-opt[data-v="want"]'); await p.waitForTimeout(200);
assert.ok(await p.$('.coll-main [data-act="wadd"]'), 'Je recherche : « Ajouter une carte »');
await p.click('.coll-main [data-act="wadd"]'); await sheetOpen(p); await p.waitForSelector('#waName');
await p.fill('#waName', 'Sol Ri'); await p.waitForSelector('#waList .ca-opt[data-n="Sol Ring"]', { timeout: 8000 }); await p.click('#waList .ca-opt[data-n="Sol Ring"]');
await p.keyboard.press('Escape'); await sheetGone(p); await p.waitForTimeout(300);
assert.match(await txt(p, '.coll-main .tr-list'), /Sol Ring/, 'une carte recherchée s\'affiche sans collection');
await p.evaluate(() => { for (const k in TR.wish) delete TR.wish[k]; trChanged(); });
ok('Échange : « À échanger » vide, « Je recherche » utilisable sans carte');

/* ═══ 2. Onglet Decks sans compte : écran de connexion (feuille Compte réutilisée) ═══════════════ */
await tab(p, 'decks'); await p.waitForSelector('.gate[data-gate="out"]');
assert.match(await txt(p, '.gate'), /^Les decks EDHREC sont réservés aux comptes Connecte-toi pour comparer/);
assert.deepEqual(await p.$$eval('.gate .coll-cta .btn', b => b.map(x => x.textContent.trim())), ['Continuer avec Google', 'Se connecter par e-mail']);
assert.equal(await p.$('.crow.dk'), null); assert.equal(edhHits, 0, 'aucun téléchargement EDHREC derrière l\'écran');
await shot(p, '2-decks-sans-compte');
ok('Decks sans compte : « Les decks EDHREC sont réservés aux comptes », pourquoi, Google / e-mail, rien de chargé');

/* ═══ 3. Inscription par e-mail : lien de vérification envoyé tout de suite ══════════════════════ */
await p.click('.gate [data-act="gmail"]'); await sheetOpen(p); await p.waitForSelector('#acForm'); await p.waitForTimeout(400);
await p.click('#acSeg .seg-opt[data-v="up"]'); await p.waitForSelector('#acPw[autocomplete="new-password"]');
await p.fill('#acEmail', 'lea@example.com'); await p.fill('#acPw', 'secret12'); await p.click('#acGo'); await sheetGone(p);
await p.waitForSelector('.gate[data-gate="verify"][data-sent="1"]', { timeout: 6000 });
assert.equal(oob.length, 1); assert.deepEqual(oob[0], { type: 'VERIFY_EMAIL', email: 'lea@example.com', url: '', lang: 'fr' }, 'lien de vérification, e-mail en français, sans adresse de retour hors https');
assert.match(await txt(p, '#toast'), /Compte créé · lien de vérification envoyé à lea@example\.com/);
assert.match(await txt(p, '.gate'), /^Vérifie ton adresse e-mail Un lien t'a été envoyé à lea@example\.com\. Touche-le, puis reviens ici\./);
const sendBtn = () => p.$eval('.gate [data-act="gsend"]', b => [b.disabled, b.textContent.trim()]);
let [dis, label] = await sendBtn(); assert.equal(dis, true); assert.match(label, /^Renvoyer l'e-mail · (60|59|58) s$/, label);
assert.equal(await p.$eval('.gate .coll-cta .btn', b => b.dataset.act), 'gcheck', 'lien envoyé : « J\'ai cliqué sur le lien » en premier');
await shot(p, '3-verifie-adresse');
ok('inscription : lien envoyé (VERIFY_EMAIL, langue fr), onglet Decks → « Vérifie ton adresse e-mail », Renvoyer grisé 60 s');
// feuille Compte : « Adresse non vérifiée · Renvoyer »
await p.evaluate(() => openAccount()); await sheetOpen(p); await p.waitForSelector('.who-vf');
assert.match(await txt(p, '.who-vf'), /^Adresse non vérifiée · Renvoyer · \d+ s$/); assert.equal(await p.$eval('#acVf', b => b.disabled), true);
await p.waitForTimeout(300); await shot(p, '3b-compte-non-verifie');
await p.keyboard.press('Escape'); await sheetGone(p);
ok('feuille Compte : « Adresse non vérifiée · Renvoyer » (même attente d\'une minute)');

/* ═══ 4. Renvoyer : une fois par minute, trop de demandes ═══════════════════════════════════════ */
const age = ms => p.evaluate(ms => { const o = JSON.parse(localStorage.getItem('deckdeal:vf:v1')); for (const k in o) o[k] -= ms; localStorage.setItem('deckdeal:vf:v1', JSON.stringify(o)); vfTick(); }, ms);
await age(61000); [dis, label] = await sendBtn(); assert.deepEqual([dis, label], [false, 'Renvoyer l\'e-mail']);
await p.click('.gate [data-act="gsend"]'); await p.waitForFunction(() => !document.querySelector('#gateMsg').hidden);
assert.equal(oob.length, 2); assert.equal(await txt(p, '#gateMsg'), 'E-mail envoyé. Pense à regarder dans les courriers indésirables.');
[dis, label] = await sendBtn(); assert.equal(dis, true); assert.match(label, /· (60|59) s$/);
await p.click('.gate [data-act="gsend"]', { force: true }); await p.waitForTimeout(300); assert.equal(oob.length, 2, 'grisé : aucun envoi de plus');
ok('Renvoyer : un e-mail de plus, puis grisé une minute (une touche de plus n\'envoie rien)');
oobFail = 'TOO_MANY_ATTEMPTS_TRY_LATER'; await age(61000);
await p.click('.gate [data-act="gsend"]'); await p.waitForFunction(() => /Trop de tentatives/.test(document.querySelector('#gateMsg').textContent));
assert.equal(await txt(p, '#gateMsg'), 'Trop de tentatives. Réessaie dans quelques minutes.'); [dis] = await sendBtn(); assert.equal(dis, true, 'refusé par Firebase : on attend quand même la minute');
oobFail = '';
ok('trop de demandes (auth/too-many-requests) : message, bouton grisé');

/* ═══ 5. « J'ai cliqué sur le lien » ═════════════════════════════════════════════════════════════ */
await p.click('.gate [data-act="gcheck"]'); await p.waitForFunction(() => /pas encore vérifiée/.test(document.querySelector('#gateMsg').textContent));
assert.equal(await txt(p, '#gateMsg'), 'Adresse pas encore vérifiée : touche le lien reçu par e-mail, puis réessaie.'); assert.equal(await p.$('.crow.dk'), null);
const lk = lookups; await p.evaluate(() => { EDH.vfSeen = 0; document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(600);      // retour dans l'appli : relu en silence
assert.equal(lookups, lk + 1, 'retour dans l\'appli : compte relu'); assert.ok(await p.$('.gate[data-gate="verify"]'), 'toujours pas vérifiée : écran inchangé');
users.get('lea@example.com').verified = true;      // le lien de l'e-mail est touché (dans le navigateur, sur le site de Firebase)
await p.click('.gate [data-act="gcheck"]'); await p.waitForSelector('.crow.dk', { timeout: 8000 });
assert.match(await txt(p, '#toast'), /Adresse vérifiée/); assert.equal(await p.$('.gate'), null);
assert.equal(await p.evaluate(() => D.user.emailVerified), true);
assert.deepEqual(await p.$$eval('.crow.dk .dk-have', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim())), ['0 / 63 possédées', '0 / 63 possédées'], 'decks affichés avec 0 carte (0 % partout)');
assert.ok(edhHits >= 1);
await p.evaluate(() => openAccount()); await sheetOpen(p); await p.waitForTimeout(200); assert.equal(await p.$('.who-vf'), null, 'feuille Compte : plus de « non vérifiée »'); await p.keyboard.press('Escape'); await sheetGone(p);
ok('« J\'ai cliqué sur le lien » : pas encore → message ; vérifiée → decks EDHREC affichés (0 / 63), feuille Compte à jour');
await p.click('.coll [data-act="close"]'); await p.waitForFunction(() => !document.querySelector('.coll')); await toHome(p); await p.waitForTimeout(300);
assert.equal(await p.$eval('#btnBuild', e => e.dataset.lock), '0'); assert.equal(await txt(p, '#hmBuildSub'), 'Decks EDHREC comparés à ta collection');
ok('accueil : tuile « Deck à monter » sans cadenas une fois l\'adresse vérifiée');
// rechargement : session restaurée par le SDK (adresse relue sur le serveur), accès direct
await p.reload(); await p.waitForFunction(() => D.authReady && D.user, null, { timeout: 15000 });
await p.evaluate(() => openCollection('decks')); await p.waitForSelector('.crow.dk', { timeout: 8000 });
ok('rechargement : compte vérifié restauré, decks affichés directement');
// déconnexion : l'écran revient
await p.evaluate(() => D.cloud.signOut()); await p.waitForSelector('.gate[data-gate="out"]', { timeout: 5000 });
ok('déconnexion : l\'onglet Decks repasse à l\'écran de connexion');
assert.deepEqual(A.errs.filter(e => !FS_OFF.test(e)), []);
await A.ctx.close();

/* ═══ 6. Appli Android, compte Google : accès direct ═════════════════════════════════════════════ */
{
  const G = await page({ init: () => {
    window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: n => n === 'FirebaseAuthentication', Plugins: { FirebaseAuthentication: {
      signInWithGoogle: async () => ({ user: null, credential: { providerId: 'google.com', idToken: 'jeton-google-natif', accessToken: 'acc' } }), signOut: async () => {} } } };
  } });
  const g = G.p;
  await toHome(g); await g.click('#btnBuild'); await g.waitForSelector('.gate[data-gate="out"]');
  ok('appli : tuile « Deck à monter » → onglet Decks, écran de connexion');
  // import de 10 cartes : le coup d'œil ne calcule rien des decks EDHREC sans compte, il mène à l'écran de connexion
  const hits0 = edhHits;
  await g.click('#collSeg [data-v="list"]'); await g.click('.coll-tools [data-act="import"]'); await g.waitForSelector('#ciText');
  await g.fill('#ciText', ['Sol Ring', 'Swords to Plowshares', 'Arcane Signet', 'Wrath of God', 'Craterhoof Behemoth', 'Command Tower', 'Llanowar Elves', "Ranger's Hawk", 'Edgar Markov', 'Phantom Card'].map(n => '1 ' + n).join('\n')); await g.waitForTimeout(200); await g.click('#ciGo');
  await g.waitForSelector('.sheet-wrap.open .gl-tiles', { timeout: 6000 }); await g.waitForSelector('.gl-edh');
  assert.equal(await txt(g, '.gl-edh'), 'Decks EDHREC à finir avec tes cartes : réservés aux comptes Voir'); assert.equal(edhHits, hits0, 'coup d\'œil sans compte : fichier EDHREC non téléchargé');
  await g.click('.gl-edh [data-g="decks"]'); await sheetGone(g); await g.waitForSelector('.gate[data-gate="out"]');
  assert.equal(await g.evaluate(() => EDH.budget), 0, 'pas de filtre « ≤ 60 € » posé derrière l\'écran');
  assert.equal(await g.$eval('.coll-px', e => !!e.offsetParent), true, 'avec des cartes : bouton « € » de retour');
  ok('coup d\'œil après import, sans compte : « Decks EDHREC à finir… réservés aux comptes », Voir → écran de connexion, rien de téléchargé');
  await g.click('.gate [data-act="ggoogle"]'); await g.waitForSelector('.crow.dk', { timeout: 8000 });
  assert.equal(await g.evaluate(() => [D.user.email, D.user.providerData.map(x => x.providerId).join(), D.user.emailVerified].join('|')), 'goog@test.dev|google.com|false', 'accès par le fournisseur Google (même sans emailVerified)');
  assert.equal(oob.filter(o => o.email === 'goog@test.dev').length, 0, 'compte Google : aucun e-mail de vérification');
  ok('appli Android : « Continuer avec Google » (compte du téléphone) → decks affichés tout de suite, aucun lien de vérification');
  assert.deepEqual(G.errs.filter(e => !FS_OFF.test(e)), []);
  await G.ctx.close();
}

/* ═══ 7. Anglais ═════════════════════════════════════════════════════════════════════════════════ */
{
  const E = await page(); const e = E.p;
  await e.goto(world.url + '?lang=en'); await e.waitForFunction(() => D.authReady && I18N.lang === 'en', null, { timeout: 15000 });
  await e.evaluate(() => openCollection('list')); await e.waitForSelector('.coll .dv-empty');
  assert.match(await txt(e, '.coll-main .dv-empty'), /^No cards yet Scan your cards to get started\. Scan Import Add manually/);
  await e.click('#collSeg [data-v="stats"]'); await e.waitForTimeout(200); assert.match(await txt(e, '.coll-main .dv-empty'), /^No stats yet /);
  await e.click('#collSeg [data-v="decks"]'); await e.waitForSelector('.gate');
  assert.match(await txt(e, '.gate'), /^EDHREC decks are for accounts only Sign in to compare .* Continue with Google Sign in with email “My decks” stays open to everyone, no account needed\.$/);
  ok('anglais : états vides et écran des decks traduits');
  assert.deepEqual(E.errs.filter(x => !FS_OFF.test(x)), []); await E.ctx.close();
}

await browser.close(); world.stop();
console.log('\nGATE E2E OK'); process.exit(0);
