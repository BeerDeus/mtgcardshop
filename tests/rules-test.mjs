// Règles Firestore (firestore.rules) contre l'émulateur : partages publics et réglages de la liste d'échange.
// Facultatif (lourd) : nécessite l'émulateur Firestore et @firebase/rules-unit-testing. Sans eux, le test s'ignore.
//   npm i --no-save firebase-tools @firebase/rules-unit-testing --legacy-peer-deps   (dans tests/, ou RULES_DEPS=<dossier node_modules>)
//   npx firebase emulators:exec --only firestore --project demo-deckdeal "node tests/rules-test.mjs"
import './setup-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const req = createRequire(process.env.RULES_DEPS ? process.env.RULES_DEPS.replace(/\/?$/, '/') : import.meta.url);
let T, F;
try { T = req('@firebase/rules-unit-testing'); F = req('firebase/firestore'); } catch (e) { console.log('· @firebase/rules-unit-testing absent : test des règles ignoré'); process.exit(0); }
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('· émulateur Firestore absent (FIRESTORE_EMULATOR_HOST) : test des règles ignoré'); process.exit(0); }
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env = await T.initializeTestEnvironment({ projectId: 'demo-deckdeal', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } });
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } = F;
const tag = uid => createHash('sha256').update(uid).digest('hex');
const u1 = env.authenticatedContext('u1').firestore(), u2 = env.authenticatedContext('u2').firestore(), anon = env.unauthenticatedContext().firestore();
const share = (o, extra = {}) => ({ o, kind: 'trade', v: 1, updatedAt: Date.now(), d: '{"have":[],"want":[]}', ...extra });
const ok = m => console.log('✓', m);

await T.assertFails(setDoc(doc(anon, 'shares/s1'), share(tag('u1'))));
await T.assertFails(setDoc(doc(u1, 'shares/s1'), share(tag('u2'))));
await T.assertFails(setDoc(doc(u1, 'shares/s1'), share(tag('u1'), { uid: 'u1' })));
await T.assertFails(setDoc(doc(u1, 'shares/s1'), share(tag('u1'), { kind: 'evil' })));
await T.assertFails(setDoc(doc(u1, 'shares/s1'), share(tag('u1'), { d: 'x'.repeat(900001) })));
await T.assertFails(setDoc(doc(u1, 'shares/s1'), share(tag('u1').toUpperCase().replace(/[0-9]/g, 'f'))));
await T.assertSucceeds(setDoc(doc(u1, 'shares/s1'), share(tag('u1'))));
await T.assertSucceeds(setDoc(doc(u1, 'shares/d1'), share(tag('u1'), { kind: 'deck', d: '{"name":"x","text":"1 Sol Ring"}' })));
ok('création : propriétaire seul (empreinte SHA-256 de son UID), champs et tailles contrôlés, jamais l\'UID');
await T.assertSucceeds(getDoc(doc(anon, 'shares/s1')));
await T.assertSucceeds(getDoc(doc(u2, 'shares/s1')));
await T.assertFails(getDocs(collection(anon, 'shares')));
await T.assertFails(getDocs(collection(u2, 'shares')));
ok('lecture : quiconque a le lien ; liste des partages impossible');
await T.assertFails(setDoc(doc(u2, 'shares/s1'), share(tag('u2'))));
await T.assertFails(updateDoc(doc(u2, 'shares/s1'), { d: '{}' }));
await T.assertFails(deleteDoc(doc(u2, 'shares/s1')));
await T.assertFails(deleteDoc(doc(anon, 'shares/s1')));
await T.assertSucceeds(setDoc(doc(u1, 'shares/s1'), share(tag('u1'), { d: '{"have":[{"n":"Sol Ring","q":2}],"want":[]}' })));
await T.assertSucceeds(deleteDoc(doc(u1, 'shares/s1')));
ok('modification et suppression : propriétaire seul');

const trade = (extra = {}) => ({ keep: 1, kept: ['sol ring'], wish: { 'mana crypt': { n: 'Mana Crypt', q: 1 } }, share: 's1', dsh: { deck1: 'd1' }, updatedAt: Date.now(), ...extra });
await T.assertSucceeds(setDoc(doc(u1, 'users/u1/meta/trade'), trade()));
await T.assertSucceeds(setDoc(doc(u1, 'users/u1/meta/trade'), trade({ share: '', dsh: {} })));
await T.assertFails(setDoc(doc(u2, 'users/u1/meta/trade'), trade()));
await T.assertFails(getDoc(doc(u2, 'users/u1/meta/trade')));
await T.assertFails(setDoc(doc(u1, 'users/u1/meta/trade'), trade({ evil: 1 })));
await T.assertFails(setDoc(doc(u1, 'users/u1/meta/trade'), trade({ kept: 'sol ring' })));
await T.assertSucceeds(setDoc(doc(u1, 'users/u1/meta/collection'), { text: '1 Sol Ring', count: 1, updatedAt: 1 }));
await T.assertSucceeds(setDoc(doc(u1, 'users/u1/decks/x'), { name: 'Deck', text: '1 Sol Ring', updatedAt: 1 }));
ok('réglages de la liste d\'échange : propriétaire seul, forme contrôlée ; collection et decks inchangés');

await env.cleanup();
console.log('RULES OK');
process.exit(0);
