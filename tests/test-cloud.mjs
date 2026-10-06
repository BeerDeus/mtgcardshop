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
const { makeCloud } = require('../src/cloud.js');
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
console.log('\nCLOUD OK');
process.exit(0);
