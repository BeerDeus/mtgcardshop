// Vrai SDK Firebase 12.19 (Node) : auth simulée au niveau fetch, Firestore hors ligne (écritures locales + listeners).
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (uid, email) => { const n = Math.floor(Date.now() / 1000); return [b64({ alg: 'RS256', typ: 'JWT', kid: 'x' }), b64({ iss: 'https://securetoken.google.com/m2s-mtg', aud: 'm2s-mtg', auth_time: n, user_id: uid, sub: uid, iat: n, exp: n + 3600, email, email_verified: false, firebase: { identities: { email: [email] }, sign_in_provider: 'password' } }), 'sig'].join('.'); };
const users = new Map(); const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (/identitytoolkit|securetoken/.test(u)) {
    const body = init.body ? (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body) : {};
    calls.push(u.split('?')[0].split('/').pop());
    const j = o => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    const err = (message) => new Response(JSON.stringify({ error: { code: 400, message } }), { status: 400, headers: { 'content-type': 'application/json' } });
    if (/accounts:signUp/.test(u)) {
      if (users.has(body.email)) return err('EMAIL_EXISTS');
      users.set(body.email, { uid: 'uid-' + users.size, pw: body.password });
      const us = users.get(body.email); return j({ kind: 'x', idToken: jwt(us.uid, body.email), email: body.email, refreshToken: 'r', expiresIn: '3600', localId: us.uid });
    }
    if (/accounts:signInWithPassword/.test(u)) {
      const us = users.get(body.email); if (!us || us.pw !== body.password) return err('INVALID_LOGIN_CREDENTIALS');
      return j({ kind: 'x', idToken: jwt(us.uid, body.email), email: body.email, refreshToken: 'r', expiresIn: '3600', localId: us.uid, registered: true });
    }
    if (/accounts:lookup/.test(u)) {
      const em = [...users.entries()].find(([, v]) => true)?.[0];
      const entry = [...users.entries()].pop();
      return j({ users: [{ localId: entry[1].uid, email: entry[0], emailVerified: false, providerUserInfo: [{ providerId: 'password', email: entry[0], federatedId: entry[0], rawId: entry[0] }], lastLoginAt: String(Date.now()), createdAt: String(Date.now()) }] });
    }
    if (/accounts:sendOobCode/.test(u)) return j({ email: body.email });
    return err('UNHANDLED ' + u);
  }
  return realFetch(url, init);
};

const app = await import('firebase/app'), auth = await import('firebase/auth'), fs = await import('firebase/firestore');
const { makeCloud, authMessage, cloudClearLocal } = require('../src/cloud.js');
const cloud = makeCloud({ app, auth, fs });
console.log('✓ makeCloud avec le vrai SDK (repli getFirestore sans IndexedDB)');

// état initial
const seen = [];
const unsub = cloud.onUser(u => seen.push(u && u.email));
await new Promise(r => setTimeout(r, 200));
assert.deepEqual(seen, [null]); console.log('✓ onUser : null au départ');

// inscription / doublon / connexion / mauvais mot de passe
const cred = await cloud.signUp('beer@example.com', 'secret1'); assert.equal(cred.user.email, 'beer@example.com');
await new Promise(r => setTimeout(r, 100)); assert.equal(seen.at(-1), 'beer@example.com'); console.log('✓ signUp + onUser(user)');
await assert.rejects(cloud.signUp('beer@example.com', 'secret1'), e => e.code === 'auth/email-already-in-use'); console.log('✓ doublon → auth/email-already-in-use');
await cloud.signOut(); await new Promise(r => setTimeout(r, 100)); assert.equal(seen.at(-1), null); console.log('✓ signOut');
await assert.rejects(cloud.signIn('beer@example.com', 'nope'), e => e.code === 'auth/invalid-credential'); console.log('✓ mauvais mot de passe → auth/invalid-credential');
const c2 = await cloud.signIn('beer@example.com', 'secret1'); const uid = c2.user.uid; assert.ok(uid); console.log('✓ signIn', uid);
await cloud.reset('beer@example.com'); assert.ok(calls.includes('accounts:sendOobCode')); console.log('✓ reset (sendOobCode)');

// Firestore hors ligne : listeners + écritures locales
const db = fs.getFirestore(app.getApp()); await fs.disableNetwork(db);
const states = []; let resolveNext;
const un = cloud.watch(uid, (docs, pending) => { states.push({ ids: docs.map(d => d.id), names: docs.map(d => d.data.name), data: docs.map(d => d.data), pending }); resolveNext && resolveNext(); }, e => states.push({ err: e.code }));
const next = () => new Promise(r => { resolveNext = r; setTimeout(r, 500); });
await next();
assert.deepEqual(states.at(-1).ids, []); console.log('✓ watch : liste vide');

const id1 = cloud.newId(uid); assert.match(id1, /^[A-Za-z0-9]{20}$/);
const id2 = cloud.newId(uid); assert.notEqual(id1, id2);
let p = next(); cloud.save(uid, id1, { name: 'Alpha', text: '1 Sol Ring', updatedAt: 100, createdAt: 100 }).catch(() => {}); await p;
assert.deepEqual(states.at(-1).names, ['Alpha']); assert.equal(states.at(-1).pending, true); console.log('✓ save : visible aussitôt, hasPendingWrites=true');
p = next(); cloud.save(uid, id2, { name: 'Beta', text: '1 Path to Exile', updatedAt: 200, createdAt: 200 }).catch(() => {}); await p;
assert.deepEqual(states.at(-1).names, ['Beta', 'Alpha']); console.log('✓ tri par updatedAt décroissant');
p = next(); cloud.save(uid, id1, { name: 'Alpha 2', text: '1 Sol Ring', updatedAt: 300, createdAt: 100 }).catch(() => {}); await p;
assert.deepEqual(states.at(-1).names, ['Alpha 2', 'Beta']); console.log('✓ mise à jour du même document');
p = next(); cloud.remove(uid, id2).catch(() => {}); await p;
assert.deepEqual(states.at(-1).names, ['Alpha 2']); console.log('✓ remove');
p = next(); cloud.saveMany(uid, [{ id: cloud.newId(uid), data: { name: 'Imp 1', text: 'x', updatedAt: 400, createdAt: 400 } }, { id: cloud.newId(uid), data: { name: 'Imp 2', text: 'x', updatedAt: 500, createdAt: 500 } }]).catch(() => {}); await p;
assert.deepEqual(states.at(-1).names, ['Imp 2', 'Imp 1', 'Alpha 2']); console.log('✓ saveMany (batch)');
// relevé de prix par carte : liste de maps imbriquées dans le document, relue à l'identique
{
  const C = require('../src/core.js');
  const snap = { at: 700, mode: 'zero', lang: 'fr', sig: 'fr|SP|no', items: [{ k: 'sol ring', n: 'Sol Ring', q: 1, s: 'ok', c: 150, l: 'fr', d: 'NM', cm: 1, tl: 'Artifact', im: 'https://cards.scryfall.io/small/front/a/b/x.jpg' }, { k: 'forest', n: 'Forest', q: 5, s: 'basic' }] };
  const doc = C.deckDoc({ name: 'Avec prix', text: '1 Sol Ring', snap }, 700);
  p = next(); cloud.save(uid, cloud.newId(uid), doc).catch(() => {}); await p;
  const got = states.at(-1).data.find(d => d.name === 'Avec prix');
  assert.deepEqual(got.snap, snap, 'snap relu tel quel'); assert.deepEqual(C.readDeck('z', got).snap, snap);
  assert.deepEqual(Object.keys(doc).sort(), ['cards', 'createdAt', 'history', 'name', 'opts', 'snap', 'text', 'updatedAt'], 'champs du document = ceux autorisés par firestore.rules');
  console.log('✓ relevé de prix (snap) : écrit et relu dans Firestore');
}
// collection : écoute (3e argument = vient du cache), transaction et lecture serveur — hors ligne elles doivent échouer proprement, jamais rester suspendues
{
  const got = []; const un2 = cloud.watchColl(uid, (data, pending, fromCache) => got.push({ data, pending, fromCache }), e => got.push({ err: e.code }));
  await new Promise(r => setTimeout(r, 600));
  assert.ok(got.length && got[0].data === null && got[0].fromCache === true, 'écoute : document absent, lu depuis le cache (fromCache = true)'); console.log('✓ watchColl : 3e argument fromCache');
  const race = (pr, ms) => Promise.race([pr.then(() => ({ ok: true }), e => ({ code: e && e.code, msg: e && e.message })), new Promise(r => setTimeout(() => r({ hang: true }), ms))]);
  // txColl : exige le réseau (le SDK Node ignore disableNetwork pour les transactions et tente une vraie connexion : non testable ici ; mesuré à la main : rejet « unavailable » en ~7 s)
  assert.equal(typeof cloud.txColl, 'function'); console.log('✓ txColl exposée');
  let t0;
  t0 = Date.now(); const pl = await race(cloud.pullColl(uid), 30000);
  console.log('  pullColl hors ligne →', JSON.stringify(pl), (Date.now() - t0) + ' ms');
  assert.ok(!pl.hang && !pl.ok, 'pullColl hors ligne échoue sans rester suspendue'); console.log('✓ pullColl hors ligne : rejet propre');
  un2();
}
un(); unsub();

{ // Suppression du compte (faux SDK : le vrai Firestore hors ligne ne lit pas le serveur) : liens publics, decks, documents annexes, puis le compte
  const log = [], store = new Map([['users/u1/decks/d1', {}], ['users/u1/decks/d2', {}], ['users/u1/meta/trade', { share: 'S1', dsh: { d1: 'S2', d2: '' } }], ['users/u1/meta/collection', {}], ['shares/S1', {}], ['shares/S2', {}], ['shares/S3', {}], ['shares/REFUS', {}], ['shares/AUTRE', {}]]);
  const ref = (...p) => ({ path: p.slice(1).join('/') });
  const user = { email: 'a@b.c', providerData: [{ providerId: 'password' }] };
  let google = { refuse: false };
  const m = {
    app: { getApps: () => [1], getApp: () => ({}) },
    auth: { getAuth: () => ({ currentUser: user }), EmailAuthProvider: { credential: (e, p) => ({ e, p }) }, GoogleAuthProvider: class { setCustomParameters() {} static credential(t) { return { t }; } },
      reauthenticateWithCredential: async (u, c) => { log.push('reauth:' + (c.p || c.t)); if (c.p !== 'ok' && !(c.t && !google.refuse)) throw Object.assign(new Error('x'), { code: 'auth/invalid-credential' }); },
      signInWithCredential: async (a, c) => { log.push('cred:' + c.t); if (google.refuse) throw Object.assign(new Error('x'), { code: 'auth/invalid-credential' }); return { user }; },
      signInWithPopup: async () => { log.push('popup-in'); if (google.refuse) throw Object.assign(new Error('x'), { code: 'auth/invalid-credential' }); },
      reauthenticateWithPopup: async () => { log.push('popup'); if (google.refuse) throw Object.assign(new Error('x'), { code: 'auth/invalid-credential' }); }, deleteUser: async u => { log.push('deleteUser:' + u.email); } },
    fs: { initializeFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}), collection: (...p) => ({ path: p.slice(1).join('/') }), doc: (...p) => p.length === 1 ? { id: 'n' } : ref(...p),
      getDocFromServer: async r => ({ exists: () => store.has(r.path), data: () => store.get(r.path) }),
      getDocsFromServer: async c => ({ docs: [...store.keys()].filter(k => k.startsWith(c.path + '/')).map(k => ({ ref: { path: k } })) }),
      deleteDoc: async r => { log.push('del:' + r.path); if (r.path === 'shares/REFUS') throw Object.assign(new Error('refusé'), { code: 'permission-denied' }); store.delete(r.path); },
      writeBatch: () => { const ops = []; return { delete: r => ops.push(r.path), commit: async () => { log.push('batch:' + ops.length); ops.forEach(k => store.delete(k)); } }; },
      terminate: async () => { log.push('terminate'); }, clearIndexedDbPersistence: async () => { log.push('clearPersistence'); } },
  };
  const c = makeCloud(m);
  assert.equal(c.provider(), 'password');
  await assert.rejects(c.reauth('mauvais'), e => e.code === 'auth/invalid-credential');
  await c.reauth('ok');
  // liens connus de l'appareil seulement (S3), déjà retiré (PARTI : pas de suppression tentée), doublon (S1), refusé (REFUS : compté, on continue)
  const r = await c.wipe('u1', ['S3', 'S1', 'PARTI', 'REFUS', '']); await c.deleteUser();
  assert.deepEqual(r, { decks: 2, shares: 5, failed: 1 });
  assert.deepEqual([...store.keys()], ['shares/REFUS', 'shares/AUTRE'], 'tout le compte effacé (sauf le lien refusé), rien d\'autre');
  assert.deepEqual(log, ['reauth:mauvais', 'reauth:ok', 'del:shares/S1', 'del:shares/S2', 'del:shares/S3', 'del:shares/REFUS', 'batch:7', 'deleteUser:a@b.c']);
  user.providerData = [{ providerId: 'google.com' }]; assert.equal(c.provider(), 'google'); await c.reauth(null); assert.equal(log.at(-1), 'popup');
  console.log('✓ suppression du compte : reconnexion, liens publics (compte + appareil, absents ignorés, échecs comptés), decks et documents annexes effacés, puis le compte');

  // cache Firestore de l'appareil : par le SDK (arrêt puis effacement), sinon bases IndexedDB « firestore/… »
  log.length = 0; assert.equal(await cloudClearLocal(c), true); assert.deepEqual(log, ['terminate', 'clearPersistence']);
  const gone = []; globalThis.indexedDB = { databases: async () => [{ name: 'firestore/[DEFAULT]/m2s-mtg/main' }, { name: 'firebaseLocalStorageDb' }, { name: 'deckdeal' }], deleteDatabase: n => { gone.push(n); const q = {}; setTimeout(() => q.onsuccess && q.onsuccess()); return q; } };
  assert.equal(await cloudClearLocal(null), false); assert.deepEqual(gone, ['firestore/[DEFAULT]/m2s-mtg/main'], 'sans SDK : seules les bases Firestore');
  gone.length = 0; assert.equal(await cloudClearLocal({ clearLocal: async () => { throw Object.assign(new Error('autre onglet'), { code: 'failed-precondition' }); } }), false); assert.deepEqual(gone, ['firestore/[DEFAULT]/m2s-mtg/main'], 'SDK en échec : repli');
  globalThis.indexedDB = { databases: () => new Promise(() => {}) }; const t0 = Date.now(); await cloudClearLocal({ clearLocal: () => new Promise(() => {}) });
  assert.ok(Date.now() - t0 < 9000, 'jamais bloquant'); delete globalThis.indexedDB;
  console.log('✓ cache Firestore effacé : SDK (terminate + clearIndexedDbPersistence), repli IndexedDB, jamais bloquant');

  // connexion Google : jeton refusé ≠ « mot de passe incorrect » ; APK sans plugin : jamais la fenêtre web ; message du plugin affiché
  google.refuse = true; log.length = 0;
  await assert.rejects(c.google(), e => e.code === 'auth/google-refused'); await assert.rejects(c.reauth(null), e => e.code === 'auth/google-refused');
  assert.match(authMessage({ code: 'auth/google-refused' }), /^Google a refusé la connexion : réessaie, ou utilise ton e-mail\.$/); assert.match(authMessage({ code: 'auth/invalid-credential' }), /incorrect/, 'e-mail : inchangé');
  globalThis.isNativeApp = () => true; let plugin = null; globalThis.natPlugin = () => plugin; log.length = 0;
  await assert.rejects(c.google(), e => e.code === 'auth/native-missing'); await assert.rejects(c.reauth(null), e => e.code === 'auth/native-missing');
  assert.deepEqual(log, [], 'APK sans plugin : ni signInWithPopup ni reauthenticateWithPopup');
  assert.equal(authMessage({ code: 'auth/native-missing' }), 'Connexion Google indisponible dans cette version de l\'appli : mets-la à jour, ou utilise ton e-mail.');
  const warns = [], warn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  plugin = { signInWithGoogle: async () => { throw new Error('10: <b>Developer</b> error & "SHA-1"'); } };
  const ng = await c.google().catch(e => e); console.warn = warn;
  assert.equal(ng.code, 'auth/native-google'); assert.match(warns.join(), /10: <b>Developer/, 'message natif dans la console');
  assert.equal(authMessage(ng), 'Connexion Google impossible sur ce téléphone. Réessaie, ou utilise ton e-mail. (10: b Developer /b error SHA-1)', 'message du plugin ajouté, sans balisage');
  plugin = { signInWithGoogle: async () => { throw new Error('The user canceled the sign-in flow.'); } }; assert.equal(authMessage(await c.google().catch(e => e)), null, 'annulation : silence');
  plugin = { signInWithGoogle: async () => ({ credential: { idToken: 'jeton' } }) }; google.refuse = false; log.length = 0;
  await c.google(); await c.reauth(null); assert.deepEqual(log, ['cred:jeton', 'reauth:jeton']);
  delete globalThis.isNativeApp; delete globalThis.natPlugin;
  console.log('✓ Google : jeton refusé → message Google ; APK sans plugin → « mets-la à jour », sans fenêtre web ; erreur native détaillée');
}
console.log('\nCLOUD OK');
process.exit(0);
