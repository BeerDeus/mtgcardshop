/* ── cloud.js : compte + decks (Firebase Auth / Firestore). Chargé à la demande, jamais bloquant. ──
   Sans SDK (hors ligne, CSP, file://) l'app reste entièrement utilisable en mode local. */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCznNtazqWMhiYlPxce3O0Ss06mycgp6TY',
  authDomain: 'm2s-mtg.firebaseapp.com',
  projectId: 'm2s-mtg',
  storageBucket: 'm2s-mtg.firebasestorage.app',
  messagingSenderId: '760752938824',
  appId: '1:760752938824:web:92327fe6c051b8f2741d7d',
};
const FB_BASE = 'https://www.gstatic.com/firebasejs/12.19.0/';

/** Traduction (T vient de core.js ; absent quand ce fichier est chargé seul sous Node, pour les tests). */
const tcl = (s, v) => (typeof T === 'function' ? T(s, v) : v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)) : s);
/** Code d'erreur Firebase → message lisible. null = silence (l'utilisateur a juste fermé la fenêtre). */
function authMessage(e) {
  const c = (e && e.code) || '';
  const m = {
    'auth/invalid-email': 'Adresse email invalide.',
    'auth/missing-email': 'Saisis ton adresse email.',
    'auth/missing-password': 'Saisis ton mot de passe.',
    'auth/user-not-found': 'Email ou mot de passe incorrect.',
    'auth/wrong-password': 'Email ou mot de passe incorrect.',
    'auth/invalid-credential': 'Email ou mot de passe incorrect.',
    'auth/email-already-in-use': 'Un compte existe déjà avec cet email. Connecte-toi.',
    'auth/weak-password': 'Mot de passe trop court : 6 caractères minimum.',
    'auth/too-many-requests': 'Trop de tentatives. Réessaie dans quelques minutes.',
    'auth/network-request-failed': 'Pas de connexion. Réessaie une fois en ligne.',
    'auth/popup-blocked': 'Fenêtre bloquée par le navigateur. Autorise-la ou utilise l\'email.',
    'auth/popup-closed-by-user': null,
    'auth/cancelled-popup-request': null,
    'auth/operation-not-allowed': 'Cette méthode n\'est pas activée dans la console Firebase (Authentication › Mode de connexion).',
    'auth/unauthorized-domain': 'Ce domaine n\'est pas autorisé : ajoute-le dans Firebase › Authentication › Paramètres › Domaines autorisés.',
    'auth/operation-not-supported-in-this-environment': 'La connexion n\'est pas disponible dans ce contexte. Ouvre l\'app en http(s).',
    'auth/user-disabled': 'Ce compte est désactivé.',
    'auth/requires-recent-login': 'Reconnecte-toi pour continuer.',
    'auth/native-google': 'Connexion Google impossible sur ce téléphone. Réessaie, ou utilise ton e-mail.',
  };
  if (c in m) return m[c] == null ? null : tcl(m[c]);
  return c ? tcl('Connexion impossible ({code}).', { code: c.replace('auth/', '') }) : tcl('Connexion impossible.');
}

/** Appli Android : connexion Google native (plugin @capacitor-firebase/authentication, skipNativeAuth). Google refuse sa fenêtre de connexion dans
 *  une WebView : le téléphone choisit le compte, le plugin rend un jeton d'identité Google, et c'est le SDK web qui ouvre la session Firebase avec. null hors appli. */
const natGoogle = () => (typeof natPlugin === 'function' ? natPlugin('FirebaseAuthentication') : null);
async function natGoogleCred(m) {
  let r;
  try { r = await natGoogle().signInWithGoogle({ skipNativeAuth: true }); }
  catch (e) { throw Object.assign(new Error(String(e && e.message || e)), { code: /cancel|annul|12501|16:/i.test(String(e && (e.message || e.code) || '')) ? 'auth/popup-closed-by-user' : 'auth/native-google' }); }
  const c = r && r.credential; if (!c || !c.idToken) throw Object.assign(new Error('sans jeton'), { code: 'auth/popup-closed-by-user' });
  return m.auth.GoogleAuthProvider.credential(c.idToken, c.accessToken || undefined);
}

/** Construit l'API cloud à partir des modules du SDK (injectables pour les tests). */
function makeCloud(m) {
  const app = m.app.getApps().length ? m.app.getApp() : m.app.initializeApp(FIREBASE_CONFIG);
  const auth = m.auth.getAuth(app);
  let db;
  try { db = m.fs.initializeFirestore(app, { localCache: m.fs.persistentLocalCache({ tabManager: m.fs.persistentMultipleTabManager() }) }); }
  catch (e) { db = m.fs.getFirestore(app); }
  const col = uid => m.fs.collection(db, 'users', uid, 'decks');
  return {
    onUser: cb => m.auth.onAuthStateChanged(auth, cb),
    signIn: (email, pw) => m.auth.signInWithEmailAndPassword(auth, email, pw),
    signUp: (email, pw) => m.auth.createUserWithEmailAndPassword(auth, email, pw),
    google: async () => {
      if (natGoogle()) return m.auth.signInWithCredential(auth, await natGoogleCred(m));      // appli Android
      const p = new m.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return m.auth.signInWithPopup(auth, p);
    },
    reset: email => m.auth.sendPasswordResetEmail(auth, email),
    signOut: () => { const g = natGoogle(); if (g) Promise.resolve(g.signOut()).catch(() => {}); return m.auth.signOut(auth); },      // appli : oublie aussi le compte Google choisi (le sélecteur réapparaît)
    /** Écoute temps réel des decks de l'utilisateur, du plus récent au plus ancien. */
    watch(uid, onData, onErr) {
      const q = m.fs.query(col(uid), m.fs.orderBy('updatedAt', 'desc'));
      return m.fs.onSnapshot(q, { includeMetadataChanges: true }, snap => onData(snap.docs.map(d => ({ id: d.id, data: d.data() })), snap.metadata.hasPendingWrites), onErr);
    },
    newId: uid => m.fs.doc(col(uid)).id,
    save: (uid, id, data) => m.fs.setDoc(m.fs.doc(col(uid), id), data),
    remove: (uid, id) => m.fs.deleteDoc(m.fs.doc(col(uid), id)),
    /** Collection possédée : un seul document users/{uid}/meta/collection { text, count, updatedAt }. onData(données | null, écritureEnAttente, vientDuCache). */
    watchColl(uid, onData, onErr) {
      return m.fs.onSnapshot(m.fs.doc(db, 'users', uid, 'meta', 'collection'), { includeMetadataChanges: true }, s => onData(s.exists() ? s.data() : null, s.metadata.hasPendingWrites, s.metadata.fromCache), onErr);
    },
    saveColl: (uid, data) => m.fs.setDoc(m.fs.doc(db, 'users', uid, 'meta', 'collection'), data),
    /** Lecture-modification-écriture atomique : fn(données | null) retourne le nouveau document (ou null = rien à écrire). Rejouée si un autre appareil écrit entre-temps. Exige le réseau. */
    txColl: (uid, fn) => m.fs.runTransaction(db, async tx => {
      const ref = m.fs.doc(db, 'users', uid, 'meta', 'collection'), s = await tx.get(ref), out = fn(s.exists() ? s.data() : null);
      if (out) tx.set(ref, out);
      return out;
    }),
    /** Lecture directe sur le serveur (jamais le cache) : { data | null }. */
    pullColl: uid => m.fs.getDocFromServer(m.fs.doc(db, 'users', uid, 'meta', 'collection')).then(s => ({ data: s.exists() ? s.data() : null })),
    /** Données annexes du compte (users/{uid}/meta/{engaged|history}) : mêmes gestes que la collection. */
    watchMeta(uid, id, onData, onErr) {
      return m.fs.onSnapshot(m.fs.doc(db, 'users', uid, 'meta', id), { includeMetadataChanges: true }, s => onData(s.exists() ? s.data() : null, s.metadata.hasPendingWrites, s.metadata.fromCache), onErr);
    },
    saveMeta: (uid, id, data) => m.fs.setDoc(m.fs.doc(db, 'users', uid, 'meta', id), data),
    pullMeta: (uid, id) => m.fs.getDocFromServer(m.fs.doc(db, 'users', uid, 'meta', id)).then(s => ({ data: s.exists() ? s.data() : null })),
    saveMany(uid, items) { const b = m.fs.writeBatch(db); items.forEach(d => b.set(m.fs.doc(col(uid), d.id), d.data)); return b.commit(); },
    /** Partages publics (shares/{id}) : identifiant aléatoire (non devinable), écriture, suppression. Lus par le visiteur via l'API REST (shareFetch). */
    /** Suppression du compte. Firebase exige une connexion récente : mot de passe redemandé, ou fenêtre Google. */
    provider: () => { const u = auth.currentUser; return u && u.providerData.some(p => p.providerId === 'password') ? 'password' : 'google'; },
    reauth(pw) {
      const u = auth.currentUser; if (!u) return Promise.reject(Object.assign(new Error('déconnecté'), { code: 'auth/no-current-user' }));
      if (pw == null && natGoogle()) return natGoogleCred(m).then(c => m.auth.reauthenticateWithCredential(u, c));
      if (pw == null) { const p = new m.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return m.auth.reauthenticateWithPopup(u, p); }
      return m.auth.reauthenticateWithCredential(u, m.auth.EmailAuthProvider.credential(u.email, pw));
    },
    /** Efface tout ce que le compte a en ligne : liens publics (liste d'échange, decks partagés), decks, documents annexes. Exige le réseau. */
    async wipe(uid) {
      const ref = (...p) => m.fs.doc(db, 'users', uid, ...p);
      const tr = await m.fs.getDocFromServer(ref('meta', 'trade')).catch(() => null), td = tr && tr.exists() ? tr.data() : {};
      const shares = [td.share, ...Object.values(td.dsh || {})].filter(x => typeof x === 'string' && x);
      for (const id of shares) await m.fs.deleteDoc(m.fs.doc(db, 'shares', id)).catch(() => {});      // lien déjà retiré : rien à faire
      const decks = await m.fs.getDocsFromServer(col(uid));
      const refs = [...decks.docs.map(d => d.ref), ...['collection', 'engaged', 'history', 'trade'].map(id => ref('meta', id)), ref('binder', 'lands')];
      for (let i = 0; i < refs.length; i += 400) { const b = m.fs.writeBatch(db); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); }
      return { decks: decks.docs.length, shares: shares.length };
    },
    deleteUser: () => m.auth.deleteUser(auth.currentUser),
    shareId: () => m.fs.doc(m.fs.collection(db, 'shares')).id,
    saveShare: (id, data) => m.fs.setDoc(m.fs.doc(db, 'shares', id), data),
    dropShare: id => m.fs.deleteDoc(m.fs.doc(db, 'shares', id)),
  };
}

let cloudP = null;
/** Charge le SDK une seule fois ; en cas d'échec, un nouvel appel réessaie. */
function loadCloud() {
  if (cloudP) return cloudP;
  cloudP = (async () => {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) {
      throw Object.assign(new Error(tcl('Ouvre l\'app via http(s) (proxy local ou ton hébergement) pour te connecter.')), { code: 'env' });
    }
    const [app, auth, fs] = await Promise.all([import(FB_BASE + 'firebase-app.js'), import(FB_BASE + 'firebase-auth.js'), import(FB_BASE + 'firebase-firestore.js')]);
    return makeCloud({ app, auth, fs });
  })();
  cloudP.catch(() => { cloudP = null; });
  return cloudP;
}

/** Partage public lu sans SDK ni compte (API REST Firestore) : { kind, at, … } (readShare), ou lève une erreur { code: 'gone' | 'denied' | 'net' | 'bad' }. */
const SHARE_ID_RE = /^[A-Za-z0-9]{12,40}$/;
async function shareFetch(id, fetchFn) {
  if (!SHARE_ID_RE.test(String(id || ''))) throw Object.assign(new Error('lien invalide'), { code: 'bad' });
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/shares/${id}?key=${FIREBASE_CONFIG.apiKey}`;
  let r;
  try { r = await (fetchFn || fetch)(url, { cache: 'no-store', credentials: 'omit' }); } catch (e) { throw Object.assign(new Error('réseau'), { code: 'net' }); }
  if (r.status === 404) throw Object.assign(new Error('partage introuvable'), { code: 'gone' });
  if (r.status === 403 || r.status === 401) throw Object.assign(new Error('accès refusé'), { code: 'denied' });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { code: 'net' });
  const f = ((await r.json()) || {}).fields || {}, str = k => (f[k] && typeof f[k].stringValue === 'string' ? f[k].stringValue : '');
  const out = (typeof readShare === 'function' ? readShare : require('./core.js').readShare)(str('kind'), str('d'));      // sous Node (tests) : core.js est un module à part
  if (!out) throw Object.assign(new Error('partage illisible'), { code: 'bad' });
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { FIREBASE_CONFIG, authMessage, makeCloud, shareFetch, SHARE_ID_RE };
