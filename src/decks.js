/* ── decks.js : compte, decks enregistrés, historique de prix ─────────────────────────────────
   Invité : decks dans localStorage. Connecté : decks dans Firestore (users/{uid}/decks), temps réel,
   persistance hors ligne. Les decks locaux peuvent être importés dans le compte. */
const LOCAL_KEY = 'deckdeal:decks:v1', ACCT_KEY = 'deckdeal:acct';
const D = {
  list: [], localList: [], user: null, uid: null, cloud: null, state: 'idle', err: '',
  unsub: null, pending: false, listErr: '', authReady: false, hint: null, seen: new Set(), account: null, importing: new Set(), hold: null, checking: null,
};

/* ── Stockage local ───────────────────────────────────────────────────────────────────────── */
function localRead() {
  try {
    const a = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return (Array.isArray(a) ? a : []).filter(d => d && d.id).map(d => readDeck(d.id, d)).sort((x, y) => y.updatedAt - x.updatedAt);
  } catch (e) { return []; }
}
function localWrite(list) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); return true; }
  catch (e) { toast(T('Stockage local indisponible : le deck ne sera pas conservé')); return false; }
}
const stripDeck = d => ({ name: d.name, text: d.text, opts: d.opts, cards: d.cards, history: d.history, createdAt: d.createdAt, updatedAt: d.updatedAt });   // les prix gardés (snap) restent dans snapsRead() pour les decks locaux
const allDecks = () => (D.user ? D.list : D.localList);
const findDeck = id => (id ? allDecks().find(d => d.id === id) || null : null);
const cloudOn = () => !!(D.user && D.cloud);
/** Decks de cet appareil pas encore envoyés dans le compte. */
const importable = () => (D.user ? D.localList.filter(d => !D.importing.has(d.id)) : []);

function deckErr(err) {
  const c = (err && err.code) || '';
  if (c === 'permission-denied') return T('Accès refusé : publie les règles Firestore pour users/{uid}/decks.');
  if (c === 'unavailable') return T('Hors ligne : la modification sera envoyée au retour du réseau.');
  if (c === 'resource-exhausted') return T('Quota Firestore dépassé.');
  return c ? T('Opération impossible ({code}).', { code: c }) : T('Opération impossible.');
}

/* ── Écriture ─────────────────────────────────────────────────────────────────────────────── */
function putDeck(id, doc) {
  if (cloudOn()) {
    D.pending = true; paintSync();
    const bare = d => { const o = { ...d }; delete o.snap; return o; };
    const fail = err => { D.pending = false; D.listErr = ''; paintSync(); toast(deckErr(err)); };
    // Règles Firestore pas encore à jour : elles refusent le champ « snap ». On renvoie le deck sans lui (les prix restent sur cet appareil) et on n'insiste plus de la session.
    if (doc.snap && D.noSnap) doc = bare(doc);
    return D.cloud.save(D.user.uid, id, doc).catch(err => {
      if (err && err.code === 'permission-denied' && doc.snap) { D.noSnap = true; return D.cloud.save(D.user.uid, id, bare(doc)).catch(fail); }
      fail(err);
    });
  }
  const full = { id, ...doc }, i = D.localList.findIndex(d => d.id === id);
  if (i >= 0) D.localList[i] = full; else D.localList.unshift(full);
  D.localList.sort((a, b) => b.updatedAt - a.updatedAt);
  localWrite(D.localList.map(d => ({ id: d.id, ...stripDeck(d) })));
  renderDecks();
  return Promise.resolve();
}
function removeDeck(id) {
  if (S.deckId === id) S.deckId = null;
  snapDrop(id); engClear(id, true); trDeckGone(id);
  if (cloudOn()) return D.cloud.remove(D.user.uid, id).catch(err => toast(deckErr(err)));
  D.localList = D.localList.filter(d => d.id !== id);
  localWrite(D.localList.map(d => ({ id: d.id, ...stripDeck(d) })));
  renderDecks();
  return Promise.resolve();
}
const newIdFor = () => (cloudOn() ? D.cloud.newId(D.user.uid) : newDeckId());

/** Relevé de prix de la dernière recherche, s'il correspond bien à la liste courante et à de vraies offres. */
function snapshotEntry() {
  if (S.demo || !S.run || S.run.status !== 'done' || !S.run.live || !S.res) return null;
  if (critSig() !== S.run.crit) return null;   // critères modifiés depuis la recherche : le prix ne correspondrait plus
  const r = curRes(), found = foundCount(r); if (!found) return null;
  return { at: S.run.doneAt || Date.now(), total: totalOf(r), mode: isCm() ? 'cm' : S.opts.mode, found, count: S.deck.cards.length, sig: curSig() };
}

/** Enregistre la liste courante : met à jour le deck rattaché, ou en crée un. */
function saveCurrent(name) {
  readOpts();
  const prev = findDeck(S.deckId);
  const text = $('#deckText').value;
  let history = prev ? prev.history : [];
  const e = S.run && S.run.text.trim() === text.trim() ? snapshotEntry() : null;
  if (e) history = pushHistory(history, e);
  const snap = e ? buildSnap() : null;
  const doc = deckDoc({ name: name || (prev && prev.name), text, opts: S.opts, history, snap: snap || (prev && prev.snap), createdAt: prev && prev.createdAt });
  const id = prev ? prev.id : newIdFor();
  if (snap) snapSave(id, snap);
  putDeck(id, doc);
  S.deckId = id;
  engRefresh(id, doc.name, text);                          // deck monté : ses cartes réservées suivent la liste enregistrée
  if (e) S.runDelta = deltaFor(history);
  refreshDeck(); updateSaveButtons(); updateHeroDelta();
  return id;
}
function deltaFor(history) { const d = priceDelta(history); return d && d.prev != null ? d : null; }

/** Après une recherche live terminée : on garde le prix dans l'historique du deck rattaché. */
function recordRun() {
  const d = findDeck(S.deckId); if (!d) return;
  if (S.run.text.trim() !== d.text.trim()) return;
  const e = snapshotEntry(); if (!e) return;
  const history = pushHistory(d.history, e), snap = buildSnap();
  if (snap) snapSave(d.id, snap);
  putDeck(d.id, deckDoc({ ...d, history, snap: snap || d.snap }));
  S.runDelta = deltaFor(history); updateHeroDelta();
}

const dateShort = ts => new Date(ts).toLocaleDateString(LOC(), { day: 'numeric', month: 'short' });
function updateHeroDelta() {
  const el = $('#heroDelta'), dl = S.runDelta;
  const show = !!(dl && dl.mode === S.opts.mode && S.run && S.run.status === 'done' && !S.demo && !S.removed.length); // liste modifiée : l'écart ne porte plus sur la même liste
  el.hidden = !show; if (!show) return;
  const flat = dl.diff === 0, down = dl.diff < 0;
  el.className = 'delta-line ' + (flat ? 'flat' : down ? 'down' : 'up');
  const same = new Date(dl.prevAt).toDateString() === new Date(dl.at).toDateString();
  const date = dateShort(dl.prevAt), amount = fmt(Math.abs(dl.diff)), arrow = down ? '▼' : '▲';
  el.textContent = flat ? (same ? T('Prix inchangé depuis la dernière recherche') : T('Prix inchangé depuis le {date}', { date }))
    : same ? T('{arrow} {amount} depuis la dernière recherche', { arrow, amount }) : T('{arrow} {amount} depuis le {date}', { arrow, amount, date });
}

/* ── Chargement d'un deck dans la saisie ──────────────────────────────────────────────────── */
function applyOpts(o) {
  Object.assign(S.opts, o);
  $('#optLang').value = o.lang; $('#optCond').value = o.cond; $('#optFallback').checked = !!o.fallbackEn;
  $('#optShip').value = (o.ship / 100).toFixed(2).replace('.', ',');
  $('#segFoil').setValue(o.foil); $('#segMode').setValue(o.mode);
  syncShip(); modeHint(); saveStore();
}
function loadDeck(id, quiet) {
  const d = findDeck(id); if (!d) return;
  closeDecks();      // l'écran « Mes decks » laisse la place à la saisie
  if (S.run && S.run.status === 'running') S.run.ctrl.abort();
  $('#deckText').value = d.text; S.isSample = false; S.deckId = d.id; S.runDelta = null;
  applyOpts(d.opts);
  if (S.view !== 'input') showView('input');
  refreshDeck(); updateSaveButtons();
  if (quiet) return;
  window.scrollTo({ top: $('.field').offsetTop - 70, behavior: reduceMotion() ? 'auto' : 'smooth' });
  toast(T('Deck chargé'));
}
function detachDeck() { S.deckId = null; S.runDelta = null; refreshDeck(); updateSaveButtons(); updateHeroDelta(); }

/* ── Rendu : liste des decks ──────────────────────────────────────────────────────────────── */
function deltaChip(h) {
  const d = deltaFor(h); if (!d || d.diff === 0) return '';
  return `<span class="delta ${d.diff < 0 ? 'down' : 'up'}">${d.diff < 0 ? '−' : '+'}${fmt(Math.abs(d.diff))}</span>`;
}
const COLOR_NAMES = { W: 'blanc', U: 'bleu', B: 'noir', R: 'rouge', G: 'vert' };
/** Pastilles de couleur d'un deck (d'après ses terrains de base). */
function pips(text) { const c = dkColors(text); return c ? `<span class="deck-pips" role="img" aria-label="${T('Couleurs : {list}', { list: [...c].map(x => T(COLOR_NAMES[x])).join(', ') })}" title="${T('Couleurs d\'après les terrains de base')}">${[...c].map(x => `<i class="pip ${x}"></i>`).join('')}</span>` : ''; }
const deckFmt = d => dkFmtOf(d.text);
/** Image de la carte de présentation d'un deck (grande taille), '' tant que sa fiche n'est pas lue. */
const coverImg = c => { if (!c) return ''; const o = ownLangImg(c.key), m = dmOf(c.key); return o ? o.src : (m && m.im) || ''; };      // carte possédée : dans la langue de l'exemplaire
const coverUrl = c => coverImg(c).replace('/small/', '/normal/');
function deckCard(d, i) {
  const dl = priceDelta(d.history), fresh = !D.seen.has(d.id), fk = deckFmt(d), dv = dkValue(d.text, dmOf), vt = dv.total && !dv.missing.length ? dkValueText(dv) : '';
  const cv = dkCoverCard(d.text, dmOf), art = coverUrl(cv), hue = hash32(d.id) % 360;
  return `<div class="deck${fresh ? ' fresh' : ''}" data-id="${esc(d.id)}" data-active="${d.id === S.deckId ? 1 : 0}" style="--i:${i}">
    <button class="deck-main" type="button" data-act="open"><span class="dvc-art deck-art tilt" style="--h:${hue}"><b>${esc((d.name.trim()[0] || '?').toUpperCase())}</b>${art ? `<img alt="" loading="lazy" decoding="async" src="${esc(art)}">` : ''}<span class="deck-price">${dl ? `<b>${fmt(dl.total)}</b>${deltaChip(d.history)}` : ''}</span></span>
      <span class="deck-top"><span class="deck-name">${esc(d.name)}</span></span>
      <span class="deck-tags">${fk ? `<span class="deck-fmt ${fk}">${DK_FORMATS[fk].label}</span>` : ''}${pips(d.text)}</span>
      <span class="deck-meta"><span class="deck-line">${esc(dkCountText(d.text))}${vt ? ' · <span title="' + T('Valeur estimée : prix tendance Cardmarket') + '">' + esc(vt) + '</span>' : ''}${engIsOn(d.id) ? ' · <b class="mounted">' + T('monté') + '</b>' : ''}</span><span class="deck-ago">${esc(relTime(d.updatedAt))}</span></span></button>
    <button class="deck-more" type="button" data-act="more" aria-label="${T('Options de {name}', { name: esc(d.name) })}"><svg class="i"><use href="#i-more"/></svg></button></div>`;
}
/** Bouton « Mes decks » de l'accueil + écran des decks s'il est ouvert. */
function renderDecks() {
  alSoon(); trSoon();
  const list = allDecks(), mounted = list.filter(d => engIsOn(d.id)).length, loading = !!D.hint && !D.authReady, btn = $('#btnDecks');
  btn.dataset.empty = list.length ? '0' : '1';
  $('#decksSub').textContent = loading ? T('Chargement…') : list.length ? `${TN(list.length, '{n} deck', '{n} decks')}${mounted ? ' · ' + TN(mounted, '{n} monté', '{n} montés') : ''}` : T('Crée ou colle un deck');
  dksPaint();
  paintSync(); updateSaveButtons(); homeSoon();
}
let dvT = 0;
/** Lit en arrière-plan les fiches des cartes des decks affichés (hors collection) : image de présentation d'abord, puis prix pour la valeur estimée. */
function dvSoon(decks, delay) {
  clearTimeout(dvT); if (!decks.length) return;
  dvT = setTimeout(async () => {
    await dmLoad();
    const covers = decks.map(d => dkCoverCard(d.text, dmOf)).filter(c => c && !dmOf(c.key)), miss = decks.flatMap(d => dkValue(d.text, dmOf).missing);
    const a = covers.length ? await dmFetch(covers) : false, b = miss.length ? await dmFetch(miss) : false;
    const c = await ownLangFetch(decks.map(d => dkCoverCard(d.text, dmOf)).filter(Boolean));      // carte de présentation possédée dans une autre langue : son image dans cette langue
    if ((a || b || c) && DKS.el) renderDecks();
  }, delay == null ? 900 : delay);
}
function paintSync() {
  const el = $('#decksSync'), t = $('#decksSyncTxt'); if (!el || !t) return;      // l'écran « Mes decks » n'est pas ouvert
  let s = 'local', txt = T('Sur cet appareil · se connecter');
  if (D.user) {
    if (D.listErr) { s = 'error'; txt = D.listErr; }
    else if (D.pending) { s = 'pending'; txt = T('Synchronisation…'); }
    else { s = 'synced'; txt = T('Synchronisé'); }
  } else if (D.state === 'unavailable') txt = T('Sur cet appareil');
  el.dataset.s = s; t.textContent = txt;
  el.disabled = !D.user && D.state === 'unavailable';
}
function updateSaveButtons() {
  const has = S.deck && S.deck.cards.length > 0, d = findDeck(S.deckId);
  const b1 = $('#btnSave'); b1.disabled = !has; b1.title = d ? T('Mettre à jour « {name} »', { name: d.name }) : T('Enregistrer comme nouveau deck');
  const b2 = $('#btnSave2'); b2.classList.toggle('saved', !!d);
  $('#btnSave2Txt').textContent = d ? T('Enregistré') : T('Enregistrer');
  $('use', b2).setAttribute('href', d ? '#i-check' : '#i-bookmark');
  $$('.deck', DKS.el || document.createElement('div')).forEach(el => { el.dataset.active = el.dataset.id === S.deckId ? '1' : '0'; });
}
function renderAccountBtn() {
  const b = $('#btnAccount'), l = D.user ? ((PROF.name || D.user.displayName || D.user.email || '?').trim()[0] || '?').toUpperCase() : (D.hint && !D.authReady ? D.hint.l : '');
  b.dataset.in = l ? '1' : '0'; $('#avatarLetter').textContent = l;
  profImg(b, D.user ? profAvatar() : '');
  b.setAttribute('aria-label', D.user ? T('Compte : {email}', { email: PROF.name || D.user.email || '' }) : T('Compte'));
}

/* ── Profil : pseudo et photo (users/{uid}/meta/profile), affichés sur les liens partagés ──────────── */
const PROF_KEY = 'deckdeal:profile:v1', PROF_NAME_MAX = 30, PROF_PHOTO_MAX = 40000;
const PROF = { uid: '', name: '', photo: '', unsub: null };
const profClean = s => String(s || '').replace(/[\p{Cc}\p{Cf}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, PROF_NAME_MAX);      // Cf : caractères invisibles de mise en forme (U+202E, U+200B, U+2066–2069…) qui retourneraient « Liste d'échange de … » sur le lien partagé
const profPhotoOk = s => typeof s === 'string' && s.length <= PROF_PHOTO_MAX && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
/** Avatar : photo choisie, sinon celle du compte Google, sinon rien (l'initiale reste). */
const profAvatar = () => PROF.photo || (D.user && typeof D.user.photoURL === 'string' && /^https:\/\//.test(D.user.photoURL) ? D.user.photoURL : '');
/** Ce que voient les visiteurs d'un lien partagé : le pseudo et la photo choisis (jamais l'e-mail ni la photo Google). */
const profShare = () => ({ ...(PROF.name ? { by: PROF.name } : {}), ...(PROF.photo ? { bp: PROF.photo } : {}) });
/** Image d'avatar posée sur un élément (bouton du compte, en-tête de la feuille) ; image injoignable (hors ligne) : retour à l'initiale. */
function profImg(el, src) {
  let im = $('img.av-img', el);
  if (!src) { if (im) im.remove(); el.dataset.img = '0'; return; }
  if (!im) { im = document.createElement('img'); im.className = 'av-img'; im.alt = ''; im.referrerPolicy = 'no-referrer'; im.onerror = () => { im.remove(); el.dataset.img = '0'; }; el.appendChild(im); }
  if (im.getAttribute('src') !== src) im.src = src;
  el.dataset.img = '1';
}
function profLoad(uid) {
  PROF.name = ''; PROF.photo = '';
  try { const o = JSON.parse(localStorage.getItem(PROF_KEY) || 'null'); if (uid && o && o.uid === uid) { PROF.name = profClean(o.name); PROF.photo = profPhotoOk(o.photo) ? o.photo : ''; } } catch (e) { /* stockage indisponible */ }
}
function profStore() { try { if (PROF.uid) localStorage.setItem(PROF_KEY, JSON.stringify({ uid: PROF.uid, name: PROF.name, photo: PROF.photo })); else localStorage.removeItem(PROF_KEY); } catch (e) { /* ignore */ } }
/** Changement de compte : profil de l'appareil, puis celui du compte (jamais renvoyé tout seul : écrit seulement quand on l'enregistre). */
function profUser(user) {
  if (PROF.unsub) { try { PROF.unsub(); } catch (e) { /* ignore */ } PROF.unsub = null; }
  PROF.uid = user ? user.uid : ''; profLoad(PROF.uid); if (!user) profStore();
  if (!user || !D.cloud || !D.cloud.watchMeta) return;
  PROF.unsub = D.cloud.watchMeta(user.uid, 'profile', (data, pending, fromCache) => {
    if (PROF.uid !== user.uid || (fromCache && !data)) return;
    const name = data ? profClean(data.name) : '', photo = data && profPhotoOk(data.photo) ? data.photo : '';
    if (name === PROF.name && photo === PROF.photo) return;
    PROF.name = name; PROF.photo = photo; profStore(); renderAccountBtn(); paintAccount(); trSoon(1500);      // liens partagés mis à jour avec le nouveau nom
  }, () => { /* règles pas encore publiées : le profil reste celui de l'appareil */ });
}
/** Enregistre le profil : appliqué tout de suite sur l'appareil, envoyé au compte (hors ligne : à la reconnexion ; règles refusées : signalé). */
function profSave(patch) {
  const u = D.user; if (!u || !cloudOn()) throw new Error('offline');
  const name = 'name' in patch ? profClean(patch.name) : PROF.name, photo = 'photo' in patch && (patch.photo === '' || profPhotoOk(patch.photo)) ? patch.photo : PROF.photo;
  Promise.resolve().then(() => D.cloud.saveMeta(u.uid, 'profile', { ...(name ? { name } : {}), ...(photo ? { photo } : {}), updatedAt: Date.now() }))
    .catch(err => toast(err && err.code === 'permission-denied' ? T('Profil gardé sur cet appareil : règles Firestore à publier.') : T('Profil gardé sur cet appareil : envoi au compte impossible.')));
  PROF.name = name; PROF.photo = photo; profStore(); renderAccountBtn(); paintAccount(); trSoon(1500);
}
/** Photo choisie → carré de 128 px recadré au centre, en JPEG (quelques Ko, gardé dans le compte). */
async function profPhotoFrom(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight); if (!s) throw new Error('image');
    const c = document.createElement('canvas'); c.width = c.height = 128;
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
    for (const q of [0.82, 0.7, 0.55]) { const d = c.toDataURL('image/jpeg', q); if (profPhotoOk(d)) return d; }
    throw new Error('image');
  } finally { URL.revokeObjectURL(url); }
}
/** Compte › Modifier le profil : photo (choisie, ou celle de Google par défaut) et pseudo. */
function openProfile() {
  if (!D.user) return;
  openSheet(T('Profil'), T('Affiché sur tes liens partagés'), api => {
    const b = api.body; let photo = PROF.photo;
    const paint = () => {
      const av = photo || (D.user && D.user.photoURL) || '';
      b.innerHTML = `<div class="prof-top"><span class="who-av prof-av" id="pfAv">${esc(((PROF.name || D.user.displayName || D.user.email || '?').trim()[0] || '?').toUpperCase())}</span>
          <div class="prof-acts"><button class="btn ghost small" type="button" id="pfPick">${T(photo ? 'Changer la photo' : 'Choisir une photo')}</button>${photo ? `<button class="link-btn" type="button" id="pfDel">${T(D.user.photoURL ? 'Revenir à la photo Google' : 'Retirer la photo')}</button>` : ''}
            <input type="file" id="pfFile" accept="image/*" hidden></div></div>
        <div class="field-in"><label class="label" for="pfName">${T('Pseudo')}</label><input id="pfName" maxlength="${PROF_NAME_MAX}" autocomplete="nickname" spellcheck="false" value="${esc($('#pfName', b) ? $('#pfName', b).value : PROF.name)}" placeholder="${esc(T('Ton pseudo'))}">
          <span class="hint">${T('Visible par les personnes qui ont un de tes liens : « Liste d\'échange de {name} ». Ton e-mail n\'y apparaît jamais.', { name: T('ton pseudo') })}</span></div>
        <p class="hint" id="pfMsg" role="status"></p>`;
      profImg($('#pfAv', b), av);
      $('#pfPick', b).onclick = () => $('#pfFile', b).click();
      $('#pfFile', b).onchange = async e => { const f = e.target.files && e.target.files[0]; if (!f) return; try { photo = await profPhotoFrom(f); paint(); } catch (x) { $('#pfMsg', b).textContent = T('Image illisible : choisis une photo JPEG ou PNG.'); } };
      const del = $('#pfDel', b); if (del) del.onclick = () => { photo = ''; paint(); };
    };
    paint();
    api.setFoot(`<button class="btn" type="button" id="pfSave">${T('Enregistrer')}</button>`);
    $('#pfSave', api.foot).onclick = () => {
      try { profSave({ name: $('#pfName', b).value, photo }); api.close(); toast(T('Profil enregistré')); }
      catch (err) { $('#pfMsg', b).textContent = T('Enregistrement impossible : vérifie ta connexion.'); }
    };
  });
}

/* ── Feuille : enregistrer ────────────────────────────────────────────────────────────────── */
function openSaveSheet() {
  const text = $('#deckText').value, n = parseDeck(text).cards.length;
  if (!n) { toast(T('Colle d\'abord une liste')); return; }
  readOpts();
  const modeName = S.opts.mode === 'zero' ? 'Zero' : 'Direct', cm = priceSrc() === 'cm';      // prix Cardmarket : langue, état et mode CardTrader ne changent rien au prix, on ne les annonce pas
  openSheet(T('Enregistrer le deck'), null, api => {
    const where = D.user ? T('Enregistré sur ton compte ({email}).', { email: esc(D.user.email || '') })
      : T('Enregistré sur cet appareil.') + (D.state !== 'unavailable' ? ' ' + T('{login} pour le retrouver partout.', { login: `<button class="link-btn link-inline" type="button" id="svLogin">${T('Connecte-toi')}</button>` }) : '');
    const cardsTxt = esc(dkCountText(text));      // exemplaires, comme Mes decks et le viewer (« 41/100 cartes » en Commander)
    api.body.innerHTML = `<div class="field-in"><label class="label" for="svName">${T('Nom')}</label><input type="text" id="svName" maxlength="120" autocomplete="off" value="${esc(suggestName(text))}"></div>
      <p class="hint">${cm ? T('{cards} · prix Cardmarket.', { cards: cardsTxt }) : `${cardsTxt} · ${esc(LANGS[S.opts.lang] || S.opts.lang)} · ${esc(COND_SHORT[S.opts.cond] || S.opts.cond)} min · ${modeName}. ${T('Les critères sont enregistrés avec la liste.')}`}</p>
      <p class="hint" id="svWhere">${where}</p>`;
    api.setFoot(`<button class="btn ghost" type="button" data-close>${T('Annuler')}</button><button class="btn" type="button" id="svGo">${T('Enregistrer')}</button>`);
    const input = $('#svName', api.body), go = $('#svGo', api.foot);
    const sync = () => { go.disabled = !input.value.trim(); }; input.oninput = sync;
    const run = () => {
      if (go.disabled) return; const id = saveCurrent(input.value.trim()); api.close();
      const msg = cloudOn() ? T('Deck enregistré sur ton compte') : T('Deck enregistré'), al = alSaveOffer(text, id);      // alertes possibles mais coupées, et des cartes manquent : proposées ici (alerts.js)
      toast(al ? msg + ' · ' + T('Me prévenir des baisses ?') : msg, al);
    };
    go.onclick = run; input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
    const lg = $('#svLogin', api.body); if (lg) lg.onclick = () => { api.close(); setTimeout(openAccount, 120); };
  });
}

/* ── Feuille : un deck (renommer, historique, dupliquer, supprimer) ───────────────────────── */
function chartSvg(values, w) {
  const h = 72, pad = 9;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = i => pad + (w - 2 * pad) * (values.length === 1 ? 0.5 : i / (values.length - 1));
  const y = v => max === min ? h / 2 : h - pad - (h - 2 * pad) * ((v - min) / span);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const last = values.length - 1;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${T('Évolution du prix')}"><polygon class="ar" points="${pad},${h} ${pts.join(' ')} ${(w - pad).toFixed(1)},${h}" opacity=".55"/><polyline class="ln" points="${pts.join(' ')}"/><circle class="dt" cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="4.5"/></svg>`;
}
function openDeckSheet(id) {
  const d = findDeck(id); if (!d) return;
  openSheet(d.name, T('{cards} · modifié {ago}', { cards: dkCountText(d.text), ago: relTime(d.updatedAt) }), api => {
    const series = priceSeries(d.history), lastE = d.history[d.history.length - 1], same = lastE ? d.history.filter(e => sameKind(e, lastE)) : [];
    const rows = d.history.slice().reverse().slice(0, 14).map((e, i, arr) => {
      const p = arr.slice(i + 1).find(x => sameKind(x, e)); const df = p ? e.total - p.total : null;
      const when = new Date(e.at).toLocaleString(LOC(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<span class="d">${esc(when)} · ${e.mode === 'cm' ? 'Cardmarket' : e.mode === 'zero' ? 'Zero' : 'Direct'}</span><span class="delta ${df == null || df === 0 ? 'flat' : df < 0 ? 'down' : 'up'}">${df == null || df === 0 ? '' : (df < 0 ? '−' : '+') + fmt(Math.abs(df))}</span><span class="t">${fmt(e.total)}</span>`;
    }).join('');
    api.body.innerHTML = `<div class="field-in"><label class="label" for="dkName">${T('Nom')}</label><input type="text" id="dkName" maxlength="120" autocomplete="off" value="${esc(d.name)}"></div>
      <button class="coll-open dk-cover" type="button" id="dkCover"><span class="cover-th" aria-hidden="true"></span><span class="coll-t"><b>${T('Image du deck')}</b><span id="dkCoverSub"></span></span><svg class="i chev" aria-hidden="true"><use href="#i-chev"/></svg></button>
      <label class="switch-row" for="dkMount"><span class="t"><b>${T('Deck monté')}</b><span class="hint" id="dkMountHint"></span></span><span class="switch"><input type="checkbox" id="dkMount"><i></i></span></label>
      <div class="dk-val" id="dkVal"></div>
      <div class="sec-title">${T('Historique des prix')}</div>
      ${series.length >= 2 ? chartSvg(series, Math.max(220, (api.body.clientWidth || 376) - 36)) + `<div class="chart-cap"><span>${esc(dateShort(same[0].at))}</span><span>${T('{n} relevés · de {min} à {max}', { n: series.length, min: esc(fmt(Math.min(...series))), max: esc(fmt(Math.max(...series))) })}</span><span>${esc(dateShort(lastE.at))}</span></div>` : ''}
      ${rows ? `<div class="hist">${rows}</div>` : '<p class="hint">' + T('Aucun relevé. Lance une recherche avec ce deck chargé, en mode live : le prix est enregistré à chaque fois.') + '</p>'}
      <button class="link-btn link-inline" type="button" id="dkEdit">${T('Modifier les cartes (éditeur)')}</button>
      <button class="link-btn link-inline" type="button" id="dkDup">${T('Dupliquer ce deck')}</button>
      <button class="link-btn link-inline" type="button" id="dkOwn">${T('Ajouter ses cartes à ma collection')}</button>`;
    api.setFoot(`<button class="btn ghost-danger" type="button" id="dkDel">${T('Supprimer')}</button><button class="btn" type="button" id="dkOpen">${T('Ouvrir')}</button>`);
    const name = $('#dkName', api.body);
    name.onchange = () => {
      const v = name.value.trim(); if (!v) { name.value = d.name; return; }
      if (v !== d.name) { const cur = findDeck(id); if (cur) { putDeck(id, deckDoc({ ...cur, name: v })); $('.sheet-head h2', api.wrap).textContent = v; toast(T('Deck renommé')); } }
    };
    name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } };
    $('#dkOpen', api.foot).onclick = () => { api.close(); loadDeck(id); };
    const paintCover = () => {      // carte de présentation : celle choisie, sinon le commandant, sinon la plus chère
      const cur = findDeck(id) || d, cv = dkCoverCard(cur.text, dmOf), im = coverUrl(cv).replace('/normal/', '/small/');
      $('.cover-th', api.body).innerHTML = im ? `<img alt="" src="${esc(im)}">` : `<b>${esc((cur.name.trim()[0] || '?').toUpperCase())}</b>`;
      $('#dkCoverSub', api.body).textContent = cv ? `${cv.name} · ${cv.auto ? T('automatique') : T('choisie')}` : T('Aucune carte');
    };
    paintCover(); $('#dkCover', api.body).onclick = () => openCoverPicker(id, paintCover);
    dmLoad().then(() => dmFetch([dkCoverCard((findDeck(id) || d).text, dmOf)].filter(Boolean))).then(ok => ok && paintCover());
    engBindSwitch(id, $('#dkMount', api.body), $('#dkMountHint', api.body));
    const valEl = $('#dkVal', api.body);      // valeur estimée du deck (Cardmarket), même monté : pas besoin de chercher des offres
    const paintVal = fetched => {
      const cur = findDeck(id) || d, v = dkValue(cur.text, dmOf), fk = deckFmt(cur);
      valEl.innerHTML = v.known ? `<b>${esc(dkValueText(v))}</b><span>${T('valeur estimée')}${fk ? ' · ' + DK_FORMATS[fk].label : ''} · ${TN(v.known, 'prix tendance Cardmarket de {n} carte sur {total} (terrains de base exclus, cartes possédées comprises)', 'prix tendance Cardmarket de {n} cartes sur {total} (terrains de base exclus, cartes possédées comprises)', { total: v.total })}</span>`
        : v.missing.length && !fetched ? '<span>' + T('Estimation de la valeur du deck…') + '</span>' : '<span>' + T('Valeur estimée indisponible (prix des cartes non lus : réessaie en ligne).') + '</span>';
    };
    paintVal(false); dmLoad().then(() => { paintVal(false); return dmFetch(dkValue((findDeck(id) || d).text, dmOf).missing); }).then(() => paintVal(true));
    $('#dkOwn', api.body).onclick = () => {
      const cur = findDeck(id) || d, cards = parseDeck(cur.text).cards; if (!cards.length) return;
      const before = COLL.map, n = cards.reduce((a, c) => a + c.qty, 0);
      collAdd(cards.map(c => ({ k: ownKey(c.name), n: c.name, q: c.qty })), 'add'); api.close(); haptic('ok');
      toast(TN(n, '{n} carte ajoutée à ta collection (terrains de base exclus)', '{n} cartes ajoutées à ta collection (terrains de base exclus)'), { label: T('Annuler'), fn: () => { COLL.map = before; collChanged(); } });
      collEnrich();
    };
    $('#dkEdit', api.body).onclick = () => { api.close(); setTimeout(() => openBuilder({ id }), 200); };
    $('#dkDup', api.body).onclick = () => {
      const cur = findDeck(id) || d, nid = newIdFor();
      putDeck(nid, deckDoc({ ...cur, name: (cur.name + ' ' + T('(copie)')).slice(0, 120), history: [], createdAt: Date.now() }));
      api.close(); toast(T('Deck dupliqué'));
    };
    const del = $('#dkDel', api.foot); let armed = 0;
    del.onclick = () => {
      if (!armed) { armed = setTimeout(() => { armed = 0; del.textContent = T('Supprimer'); del.className = 'btn ghost-danger'; }, 4000); del.textContent = T('Confirmer'); del.className = 'btn danger'; return; }
      clearTimeout(armed); removeDeck(id); api.close(); toast(T('Deck supprimé'));
    };
  });
}

/** Choisit (ou, avec un nom vide, efface) la carte de présentation d'un deck. Le deck garde sa place dans la liste. */
function setDeckCover(id, name) {
  const cur = findDeck(id); if (!cur) return;
  const text = dkSetCover(cur.text, name); if (text === cur.text) return;
  if (S.deckId === id && $('#deckText').value === cur.text) { $('#deckText').value = text; refreshDeck(); }      // deck chargé dans la saisie : elle suit, sinon « Enregistrer » effacerait le choix
  putDeck(id, deckDoc({ ...cur, text }, cur.updatedAt));
}
/** Feuille : toutes les cartes du deck (commandant d'abord, puis les plus chères) ; toucher une carte la choisit. done : rappelé après le choix. */
function openCoverPicker(id, done) {
  const d0 = findDeck(id); if (!d0) return;
  openSheet(T('Image du deck'), T('Touche la carte qui illustrera ce deck'), api => {
    api.body.innerHTML = `<div class="field-in"><label class="label" for="cvQ">${T('Chercher dans le deck')}</label><input type="search" id="cvQ" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${T('Nom de la carte')}"></div><div class="cv-grid" id="cvGrid"></div>`;
    api.setFoot(`<button class="btn ghost" type="button" data-close>${T('Annuler')}</button><button class="btn ghost" type="button" id="cvAuto">${T('Automatique')}</button>`);
    const q = $('#cvQ', api.body), grid = $('#cvGrid', api.body);
    const pool = () => {
      const t = (findDeck(id) || d0).text, pd = parseDeck(t), cm = new Set(commanderKeys(t)), seen = new Set(), out = [];
      for (const c of [...pd.cards, ...dkSideCards(t)]) { const k = ownKey(c.key); if (!seen.has(k)) { seen.add(k); out.push({ key: k, name: c.name, cmd: cm.has(c.key) }); } }
      const eu = c => { const m = dmOf(c.key); return m && Number.isFinite(m.eu) ? m.eu : -1; };
      return out.sort((a, b) => (b.cmd - a.cmd) || (eu(b) - eu(a)) || a.name.localeCompare(b.name));
    };
    const paint = () => {
      const cur = dkCoverCard((findDeck(id) || d0).text, dmOf), chosen = cur && !cur.auto ? cur.key : '', f = q.value.trim().toLowerCase();
      const list = pool().filter(c => !f || c.name.toLowerCase().includes(f)).slice(0, 150);
      grid.innerHTML = list.map(c => { const im = coverImg(c); return `<button type="button" class="cv-card" data-n="${esc(c.name)}" aria-pressed="${c.key === chosen}" aria-label="${c.cmd ? T('{name}, commandant', { name: esc(c.name) }) : esc(c.name)}"><span class="dvc-art" style="--h:${hash32(c.key) % 360}"><b>${esc((c.name.trim()[0] || '?').toUpperCase())}</b><i>${esc(c.name)}</i>${im ? `<img alt="" loading="lazy" decoding="async" src="${esc(im)}">` : ''}</span></button>`; }).join('') || '<p class="hint">' + T('Aucune carte de ce nom.') + '</p>';
    };
    grid.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
    grid.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
    q.oninput = paint; paint();
    dmLoad().then(() => dmFetch(pool())).then(ok => ok && paint());      // images des cartes pas encore connues
    const pick = name => { setDeckCover(id, name); haptic('ok'); api.close(); toast(name ? T('Image du deck choisie') : T('Image automatique')); if (done) done(); };
    grid.onclick = e => { const b = e.target.closest('.cv-card'); if (b) pick(b.dataset.n); };
    $('#cvAuto', api.foot).onclick = () => pick('');
  });
}

/* ── Feuille : compte ─────────────────────────────────────────────────────────────────────── */
function openAccount(view) {
  openSheet(T('Compte'), null, api => { D.account = { api, mode: 'in', del: view === 'delete' }; paintAccount(); });
}
function accountOpen() { return D.account && sheets.indexOf(D.account.api) >= 0; }
function paintAccount() {
  if (!accountOpen()) return;
  const { api } = D.account, b = api.body;
  // écran de suppression déjà affiché pour ce compte : pas de nouveau rendu (une synchro qui reprend effacerait le message d'erreur, le mot de passe saisi ou l'état « Suppression… »)
  if (D.user && D.account.del && $('#acWipeLocal', b) && $('#acDelGo', api.foot) && b.dataset.delFor === D.user.uid) return;
  api.setFoot('');
  if (D.user) return D.account.del ? paintAccountDelete(api) : paintAccountIn(api);
  if (D.state === 'loading' || D.state === 'idle') { b.innerHTML = '<div class="status" data-ok="0"><span class="dot"></span><span>' + T('Chargement…') + '</span></div>'; return; }
  if (D.state === 'unavailable') {
    b.innerHTML = `<div class="status" data-ok="0"><span class="dot"></span><span>${esc(D.err)}</span></div>
      <p class="hint">${T('Ta collection, tes decks, l\'historique de valeur et ta liste d\'échange restent sur cet appareil. Le compte permet de les sauvegarder et de les retrouver sur tous tes appareils.')}</p>
      <button class="btn ghost small" type="button" id="acRetry" style="align-self:flex-start">${T('Réessayer')}</button>`;
    $('#acRetry', b).onclick = () => { connectCloud(); };
    return;
  }
  paintAuthForm(api);
}
function paintAuthForm(api) {
  const b = api.body, st = D.account, up = st.mode === 'up';
  b.innerHTML = `<div class="auth">${st.del ? '<div class="status" data-ok="0"><span class="dot"></span><span>' + T('Connecte-toi au compte à supprimer.') + '</span></div>' : ''}
    <div class="seg" id="acSeg" role="radiogroup" aria-label="${T('Connexion ou création de compte')}"></div>
    <form id="acForm" novalidate>
      <div class="field-in"><label class="label" for="acEmail">${T('E-mail')}</label><input type="email" id="acEmail" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" value="${esc(st.email || '')}"></div>
      <div class="field-in"><label class="label" for="acPw">${T('Mot de passe')}</label><input type="password" id="acPw" autocomplete="${up ? 'new-password' : 'current-password'}" ${up ? 'minlength="6"' : ''}>${up ? '<span class="hint">' + T('6 caractères minimum.') + '</span>' : ''}</div>
      <div class="auth-msg" id="acMsg" role="alert" hidden></div>
      <button class="btn block" type="submit" id="acGo">${up ? T('Créer mon compte') : T('Me connecter')}</button>
      ${up ? '' : '<button class="link-btn link-inline" type="button" id="acForgot">' + T('Mot de passe oublié ?') + '</button>'}
    </form>
    <div class="divider"><span>${T('ou')}</span></div>
    <button class="btn ghost block" type="button" id="acGoogle">${T('Continuer avec Google')}</button>
    <p class="hint">${T('Ta collection, tes decks, l\'historique de valeur et ta liste d\'échange sont sauvegardés sur ton compte. Ton token CardTrader reste sur cet appareil.')}</p></div>`;
  mountSeg($('#acSeg', b), [{ v: 'in', label: T('Connexion') }, { v: 'up', label: T('Créer un compte') }], st.mode, v => { st.email = $('#acEmail', b).value; st.mode = v; paintAccount(); });
  const msg = (t, ok) => { const m = $('#acMsg', b); m.hidden = !t; m.textContent = t || ''; m.classList.toggle('ok', !!ok); };
  const busy = (on, label) => { $('#acGo', b).disabled = on; $('#acGoogle', b).disabled = on; if (label) $('#acGo', b).textContent = on ? label : (up ? T('Créer mon compte') : T('Me connecter')); };
  // lien « supprimer mon compte » (?delete-account) : la feuille reste ouverte et passe à l'écran de suppression (onUser la repeint s'il n'est pas encore passé)
  const done = () => { if (!st.del) { api.close(); toast(T('Connecté')); return; } toast(T('Connecté')); if (D.user) paintAccount(); };
  const fail = e => { busy(false, true); msg(authMessage(e)); };
  $('#acForm', b).onsubmit = async e => {
    e.preventDefault(); msg('');
    const email = $('#acEmail', b).value.trim(), pw = $('#acPw', b).value;
    if (!email) return msg(T('Saisis ton adresse email.')); if (!pw) return msg(T('Saisis ton mot de passe.'));
    if (up && pw.length < 6) return msg(T('Mot de passe trop court : 6 caractères minimum.'));
    busy(true, up ? T('Création…') : T('Connexion…'));
    try { await (up ? D.cloud.signUp(email, pw) : D.cloud.signIn(email, pw)); done(); } catch (err) { fail(err); }
  };
  $('#acGoogle', b).onclick = async () => { msg(''); busy(true); try { await D.cloud.google(); done(); } catch (err) { fail(err); } };
  const fg = $('#acForgot', b);
  if (fg) fg.onclick = async () => {
    const email = $('#acEmail', b).value.trim(); if (!email) return msg(T('Saisis d\'abord ton adresse email.'));
    try { await D.cloud.reset(email); msg(T('Email de réinitialisation envoyé à {email}. Pense à vérifier les courriers indésirables.', { email }), true); }
    catch (err) { const t = authMessage(err); msg(err && err.code === 'auth/user-not-found' ? T('Si un compte existe avec cet email, un message vient d\'être envoyé.') : t, err && err.code === 'auth/user-not-found'); }
  };
}
function paintAccountIn(api) {
  const u = D.user, b = api.body, local = importable().length;
  const n = D.list.length;
  const state = D.listErr ? D.listErr : D.pending ? T('Synchronisation…') : TN(n, 'Synchronisé · {n} deck', 'Synchronisé · {n} decks');
  b.innerHTML = `<div class="who"><span class="who-av" id="acAv">${esc(((PROF.name || u.displayName || u.email || '?').trim()[0] || '?').toUpperCase())}</span><div class="who-t"><b>${esc(PROF.name || u.email || u.displayName || T('Compte'))}</b>${PROF.name && u.email ? `<span class="who-mail">${esc(u.email)}</span>` : ''}<span id="acState">${esc(state)}</span></div></div>
    <button class="btn ghost small" type="button" id="acProfile" style="align-self:flex-start">${T('Modifier le profil')}</button>
    ${local ? `<div class="import-row"><span>${TN(local, '{n} deck sur cet appareil', '{n} decks sur cet appareil')}</span><button class="btn" type="button" id="acImport">${T('Importer')}</button></div>` : ''}
    <p class="hint">${T('Ta collection, tes decks, l\'historique de valeur et ta liste d\'échange sont sauvegardés sur ton compte et synchronisés sur tous tes appareils connectés. Ton token CardTrader reste sur cet appareil.')}</p>`;      // identifiant du compte pour ALLOWED_UIDS : se lit dans la console Firebase (Authentication › Users), plus dans l'appli
  profImg($('#acAv', b), profAvatar()); $('#acProfile', b).onclick = openProfile;
  b.insertAdjacentHTML('beforeend', '<button class="link-btn link-inline ac-del" type="button" id="acDel">' + T('Supprimer mon compte') + '</button>');
  $('#acDel', b).onclick = () => { D.account.del = true; paintAccount(); };
  api.setFoot('<button class="btn ghost-danger" type="button" id="acOut">' + T('Se déconnecter') + '</button>');
  $('#acOut', api.foot).onclick = async e => { e.target.disabled = true; try { await D.cloud.signOut(); api.close(); toast(T('Déconnecté')); } catch (err) { e.target.disabled = false; toast(T('Déconnexion impossible')); } };
  const im = $('#acImport', b); if (im) im.onclick = e => { e.target.disabled = true; importLocal(); };
}

/** Suppression définitive du compte (exigée par Google Play) : reconnexion, effacement des données en ligne, puis du compte. */
function paintAccountDelete(api) {
  const b = api.body, pw = D.cloud.provider() === 'password';
  b.dataset.delFor = D.user ? D.user.uid : '';
  b.innerHTML = `<div class="auth">
    <div class="status" data-ok="0"><span class="dot"></span><span>${T('<b>Suppression définitive</b> de {who}', { who: esc(D.user.email || T('ce compte')) })}</span></div>
    <p class="hint">${T('Tout ce que le compte a en ligne est effacé : decks, collection, historique de valeur, liste d\'échange et liens partagés. C\'est irréversible.')}</p>
    <div class="switch-row"><span class="t"><b>${T('Effacer aussi cet appareil')}</b><span class="hint">${T('Collection, decks et réglages gardés sur ce téléphone ou cet ordinateur.')}</span></span><label class="switch"><input type="checkbox" id="acWipeLocal" checked><i></i></label></div>
    ${pw ? '<div class="field-in"><label class="label" for="acDelPw">' + T('Mot de passe, pour confirmer') + '</label><input type="password" id="acDelPw" autocomplete="current-password"></div>' : '<p class="hint">' + T('Google te demandera de confirmer ton identité.') + '</p>'}
    <div class="auth-msg" id="acMsg" role="alert" hidden></div></div>`;
  api.setFoot(`<button class="btn ghost" type="button" id="acDelNo">${T('Annuler')}</button><button class="btn danger" type="button" id="acDelGo">${T('Supprimer définitivement')}</button>`);
  const msg = t => { const m = $('#acMsg', b); m.hidden = !t; m.textContent = t || ''; };
  $('#acDelNo', api.foot).onclick = () => { D.account.del = false; paintAccount(); };
  $('#acDelGo', api.foot).onclick = async e => {
    const btn = e.target, local = $('#acWipeLocal', b).checked, p = pw ? $('#acDelPw', b).value : null;
    if (pw && !p) return msg(T('Saisis ton mot de passe.'));
    msg(''); btn.disabled = true; btn.textContent = T('Vérification…');
    try { await D.cloud.reauth(p); }
    catch (err) { btn.disabled = false; btn.textContent = T('Supprimer définitivement'); const t = authMessage(err); if (t) msg(t); return; }
    btn.textContent = T('Suppression…');
    const uid = D.uid;
    // Plus aucune synchronisation pendant l'effacement : sinon une copie locale pourrait être renvoyée dans le compte.
    if (D.unsub) { try { D.unsub(); } catch (x) { /* ignore */ } D.unsub = null; }
    collUser(null); xsUser(null); trUser(null); D.uid = null;
    // liens créés ici mais peut-être jamais arrivés dans le document « trade » du compte : effacés aussi
    try { await D.cloud.wipe(uid, TR.who === uid ? [TR.share, ...Object.values(TR.dsh)] : []); await D.cloud.deleteUser(); }
    catch (err) {
      D.uid = uid; onUser(D.user);      // rien de cassé : on reprend la synchronisation
      btn.disabled = false; btn.textContent = T('Supprimer définitivement');
      msg(err && err.code === 'auth/requires-recent-login' ? T('Reconnecte-toi puis recommence.') : err && /^auth\//.test(err.code || '') ? authMessage(err) : T('Suppression impossible pour l\'instant (connexion ?). Rien n\'a été perdu de ce qui reste : réessaie.'));
      return;
    }
    api.close();
    Promise.resolve().then(() => D.cloud.signOut()).catch(() => {});      // appli : oublie aussi le compte Google choisi sur le téléphone
    if (local) wipeDevice();
    else { await deviceForget(); toast(T('Compte supprimé')); setTimeout(() => location.reload(), 700); }      // client Firestore arrêté : on repart d'une page neuve
  };
}
/** Ce que l'appareil garde du compte hors de ses données : abonnement aux alertes de prix sur le serveur (sinon il notifierait encore, sans moyen
 *  de couper), notifications, cache Firestore. Après une suppression de compte et dans wipeDevice ; jamais bloquant (réseau absent : on passe). */
async function deviceForget() {
  const within = (f, ms) => Promise.race([Promise.resolve().then(f).catch(() => {}), sleep(ms)]);
  await within(alDisable, 5000); await within(pushDisable, 3000);
  await cloudClearLocal(D.cloud);
}
/** Efface tout ce que l'appli garde sur cet appareil (réglages, collection, decks, caches), puis recharge. */
async function wipeDevice() {
  await deviceForget();
  try { Object.keys(localStorage).filter(k => /^deckdeal[:-]/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
  try { await Cache.clear(); } catch (e) { /* ignore */ }
  try { if (typeof caches !== 'undefined') for (const k of await caches.keys()) if (k.startsWith('deckdeal-')) await caches.delete(k); } catch (e) { /* ignore */ }
  toast(T('Données effacées')); setTimeout(() => location.reload(), 700);
}

/** Envoie les decks de cet appareil dans le compte. Les copies locales ne sont retirées qu'une fois le serveur d'accord. */
function importLocal() {
  const todo = importable(); if (!cloudOn() || !todo.length) return;
  const uid = D.user.uid, items = todo.map(d => ({ localId: d.id, id: D.cloud.newId(uid), data: stripDeck(d) }));
  items.forEach(x => D.importing.add(x.localId)); renderDecks(); paintAccount();
  toast(T('Import en cours…'));
  D.cloud.saveMany(uid, items.map(x => ({ id: x.id, data: x.data }))).then(() => {
    const gone = new Set(items.map(x => x.localId));
    gone.forEach(i => D.importing.delete(i));
    D.localList = D.localList.filter(d => !gone.has(d.id));
    localWrite(D.localList.map(d => ({ id: d.id, ...stripDeck(d) })));
    renderDecks(); paintAccount(); toast(TN(items.length, '{n} deck importé', '{n} decks importés'));
  }).catch(err => { items.forEach(x => D.importing.delete(x.localId)); renderDecks(); paintAccount(); toast(deckErr(err)); });
}

/* ── Compte supprimé depuis un autre appareil ─────────────────────────────────────────────────
   Après une suppression, le jeton d'un appareil resté connecté vaut encore jusqu'à 1 h et les règles Firestore ne vérifient que l'uid : sa synchro
   recréerait pour toujours les documents effacés. Chaque synchro note donc les documents du compte vus sur le serveur (acctSaw) ; si l'un d'eux
   disparaît (acctLost), plus rien ne part vers le compte (acctHeld) et on demande à Firebase s'il existe encore (acctCheck). */
const SEEN_KEY = 'deckdeal:seen:v1', ACCT_CHECK = { wait: 6000 }, ACCT_GONE = /^auth\/(user-not-found|user-disabled|user-token-expired|invalid-user-token)$/;
const acctSeen = () => { try { const o = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
const acctSeenSet = o => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(o)); } catch (e) { /* stockage indisponible */ } };
/** Le document id (collection, engaged, history, trade) du compte uid existe sur le serveur : lu ou écrit par cet appareil. */
function acctSaw(id, uid) { const o = acctSeen(); if (o[id] !== uid) { o[id] = uid; acctSeenSet(o); } }
/** Le serveur dit le document absent. Déjà vu ici pour ce compte : effacé (compte supprimé ailleurs ?) → true, l'appelant n'envoie rien.
 *  Jamais vu : vraie première synchro → false, l'appelant envoie ce que l'appareil a, comme avant. */
function acctLost(id, uid) {
  if (acctSeen()[id] !== uid) return false;
  D.hold = uid; acctCheck(uid); return true;
}
/** Rien ne doit partir vers ce compte : ce n'est plus le compte connecté (suppression en cours ici : D.uid vidé), ou un document a disparu. */
const acctHeld = uid => !uid || uid !== D.uid || D.hold === uid;
async function acctCheck(uid) {
  if (D.checking === uid) return; D.checking = uid;
  try {
    // deux « le compte existe » à quelques secondes d'écart : l'autre appareil efface les données AVANT le compte
    let alive = 0;
    for (let i = 0; i < 4 && alive < 2; i++) {
      if (i) await sleep(ACCT_CHECK.wait);
      if (D.uid !== uid || !D.user) return;
      try { await D.user.reload(); alive++; }
      catch (e) { if (ACCT_GONE.test((e && e.code) || '')) { acctOut(uid); return; } }      // réseau : on ne sait pas encore, on réessaie
    }
    if (alive < 2 || D.uid !== uid) return;            // pas de réponse sûre : rien ne repart vers le compte pendant cette session
    // compte bien là (document effacé à la main dans la console, suppression interrompue) : première synchro, l'appareil le reconstitue
    const o = acctSeen(); for (const k in o) if (o[k] === uid) delete o[k]; acctSeenSet(o);
    D.hold = null; collUser(D.user); xsUser(D.user); trUser(D.user);
  } finally { if (D.checking === uid) D.checking = null; }
}
/** Compte supprimé ou désactivé : synchro arrêtée tout de suite, puis déconnexion (appli : compte Google du téléphone oublié aussi). */
function acctOut(uid) {
  if (D.uid === uid) { if (D.unsub) { try { D.unsub(); } catch (e) { /* ignore */ } D.unsub = null; } collUser(null); xsUser(null); trUser(null); }
  Promise.resolve().then(() => D.cloud.signOut()).catch(() => {});
  toast(T('Ce compte a été supprimé ou désactivé : tu es déconnecté.'));
}

/* ── Connexion au cloud ───────────────────────────────────────────────────────────────────── */
function onUser(user) {
  const prev = D.uid;
  if (D.unsub) { try { D.unsub(); } catch (e) { /* ignore */ } D.unsub = null; }
  D.user = user; D.uid = user ? user.uid : null; D.list = []; D.pending = false; D.listErr = ''; D.authReady = true;
  if (prev !== D.uid) { S.deckId = null; S.runDelta = null; D.seen.clear(); D.hold = null; }
  try {
    if (user) localStorage.setItem(ACCT_KEY, JSON.stringify({ l: ((user.displayName || user.email || '?').trim()[0] || '?').toUpperCase() }));
    else localStorage.removeItem(ACCT_KEY);
  } catch (e) { /* ignore */ }
  if (user) {
    D.unsub = D.cloud.watch(user.uid, (docs, pending) => {
      D.list = docs.map(x => readDeck(x.id, x.data)); D.pending = pending; D.listErr = '';
      if (S.deckId && !pending && !D.list.some(d => d.id === S.deckId)) S.deckId = null;
      renderDecks(); renderAccountBtn(); paintAccount(); refreshDeck();
    }, err => {
      D.listErr = err && err.code === 'permission-denied' ? T('Règles Firestore à publier') : T('Synchronisation impossible');
      console.error(err); renderDecks(); paintAccount();
      toast(deckErr(err));
    });
  }
  renderAccountBtn(); renderDecks(); paintAccount(); refreshDeck();
  collUser(user); xsUser(user); trUser(user); if (prev !== D.uid) profUser(user);
  if (prev !== D.uid && typeof checkServer === 'function') { CTX.serverOk = null; checkServer(); }      // autre compte : a-t-il droit au token du serveur ?
  if (!user && prev) updateHeroDelta();
}
async function connectCloud() {
  D.state = 'loading'; D.err = ''; paintAccount(); paintSync();
  try { D.cloud = await loadCloud(); }
  catch (e) {
    D.state = 'unavailable';
    D.err = e && e.code === 'env' ? e.message : T('Connexion indisponible depuis ici : SDK Firebase bloqué ou hors ligne. Ta collection et tes decks restent sur cet appareil.');
    D.authReady = true; renderAccountBtn(); renderDecks(); paintAccount(); paintSync(); collPaintHead();
    return;
  }
  D.state = 'ready';
  D.cloud.onUser(onUser);
}

function initDecks() {
  D.localList = localRead();
  try { D.hint = JSON.parse(localStorage.getItem(ACCT_KEY) || 'null'); } catch (e) { D.hint = null; }
  if (D.hint && typeof D.hint.l !== 'string') D.hint = null;
  // Jeton d'identité envoyé au proxy. On attend (6 s max) que la session enregistrée soit restaurée, sinon une recherche lancée dès l'ouverture passerait pour « non connecté ».
  CTX.idToken = async force => {
    for (let i = 0; i < 60 && !D.authReady; i++) await sleep(100);
    try { return D.user ? await D.user.getIdToken(!!force) : ''; } catch (e) { return ''; }
  };
  $('#btnAccount').onclick = openAccount;
  $('#btnDecks').onclick = openDecks;
  $('#btnSave').onclick = () => { if (S.deckId && findDeck(S.deckId)) { saveCurrent(); toast(T('Deck mis à jour')); } else openSaveSheet(); };
  $('#btnViewer').onclick = () => openDeckViewer({ live: true });
  $('#btnSave2').onclick = () => {
    if (!S.run) return;
    if (S.deckId && findDeck(S.deckId)) { saveCurrent(); toast(snapshotEntry() ? T('Deck et prix mis à jour') : T('Deck mis à jour')); } else openSaveSheet();
  };
  $('#deckStats').addEventListener('click', e => { if (e.target.closest('[data-act="detach"]')) detachDeck(); });
  renderAccountBtn(); renderDecks(); dmLoad();
  setTimeout(connectCloud, 0);
}
