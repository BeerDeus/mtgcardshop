/* ── decks.js : compte, decks enregistrés, historique de prix ─────────────────────────────────
   Invité : decks dans localStorage. Connecté : decks dans Firestore (users/{uid}/decks), temps réel,
   persistance hors ligne. Les decks locaux peuvent être importés dans le compte. */
const LOCAL_KEY = 'deckdeal:decks:v1', ACCT_KEY = 'deckdeal:acct';
const D = {
  list: [], localList: [], user: null, uid: null, cloud: null, state: 'idle', err: '',
  unsub: null, pending: false, listErr: '', authReady: false, hint: null, seen: new Set(), account: null, importing: new Set(),
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
  catch (e) { toast('Stockage local indisponible : le deck ne sera pas conservé'); return false; }
}
const stripDeck = d => ({ name: d.name, text: d.text, opts: d.opts, cards: d.cards, history: d.history, createdAt: d.createdAt, updatedAt: d.updatedAt });   // les prix gardés (snap) restent dans snapsRead() pour les decks locaux
const allDecks = () => (D.user ? D.list : D.localList);
const findDeck = id => (id ? allDecks().find(d => d.id === id) || null : null);
const cloudOn = () => !!(D.user && D.cloud);
/** Decks de cet appareil pas encore envoyés dans le compte. */
const importable = () => (D.user ? D.localList.filter(d => !D.importing.has(d.id)) : []);

function deckErr(err) {
  const c = (err && err.code) || '';
  if (c === 'permission-denied') return 'Accès refusé : publie les règles Firestore pour users/{uid}/decks.';
  if (c === 'unavailable') return 'Hors ligne : la modification sera envoyée au retour du réseau.';
  if (c === 'resource-exhausted') return 'Quota Firestore dépassé.';
  return 'Opération impossible' + (c ? ' (' + c + ')' : '') + '.';
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
  snapDrop(id); engClear(id, true);
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
  return { at: S.run.doneAt || Date.now(), total: totalOf(r), mode: S.opts.mode, found, count: S.deck.cards.length, sig: curSig() };
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

const dateShort = ts => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
function updateHeroDelta() {
  const el = $('#heroDelta'), dl = S.runDelta;
  const show = !!(dl && dl.mode === S.opts.mode && S.run && S.run.status === 'done' && !S.demo && !S.removed.length); // liste modifiée : l'écart ne porte plus sur la même liste
  el.hidden = !show; if (!show) return;
  const flat = dl.diff === 0, down = dl.diff < 0;
  el.className = 'delta-line ' + (flat ? 'flat' : down ? 'down' : 'up');
  const same = new Date(dl.prevAt).toDateString() === new Date(dl.at).toDateString();
  const since = same ? 'la dernière recherche' : 'le ' + dateShort(dl.prevAt);
  el.textContent = flat ? `Prix inchangé depuis ${since}` : `${down ? '▼' : '▲'} ${fmt(Math.abs(dl.diff))} depuis ${since}`;
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
  toast('Deck chargé');
}
function detachDeck() { S.deckId = null; S.runDelta = null; refreshDeck(); updateSaveButtons(); updateHeroDelta(); }

/* ── Rendu : liste des decks ──────────────────────────────────────────────────────────────── */
function deltaChip(h) {
  const d = deltaFor(h); if (!d || d.diff === 0) return '';
  return `<span class="delta ${d.diff < 0 ? 'down' : 'up'}">${d.diff < 0 ? '−' : '+'}${fmt(Math.abs(d.diff))}</span>`;
}
const COLOR_NAMES = { W: 'blanc', U: 'bleu', B: 'noir', R: 'rouge', G: 'vert' };
/** Pastilles de couleur d'un deck (d'après ses terrains de base). */
function pips(text) { const c = dkColors(text); return c ? `<span class="deck-pips" role="img" aria-label="Couleurs : ${[...c].map(x => COLOR_NAMES[x]).join(', ')}" title="Couleurs d'après les terrains de base">${[...c].map(x => `<i class="pip ${x}"></i>`).join('')}</span>` : ''; }
const deckFmt = d => dkFmtOf(d.text);
/** Image de la carte de présentation d'un deck (grande taille), '' tant que sa fiche n'est pas lue. */
const coverImg = c => { if (!c) return ''; const o = ownLangImg(c.key), m = dmOf(c.key); return o ? o.src : (m && m.im) || ''; };      // carte possédée : dans la langue de l'exemplaire
const coverUrl = c => coverImg(c).replace('/small/', '/normal/');
function deckCard(d, i) {
  const dl = priceDelta(d.history), fresh = !D.seen.has(d.id), fk = deckFmt(d), dv = dkValue(d.text, dmOf), vt = dv.total && !dv.missing.length ? dkValueText(dv) : '';
  const cv = dkCoverCard(d.text, dmOf), art = coverUrl(cv), hue = hash32(d.id) % 360;
  return `<div class="deck${fresh ? ' fresh' : ''}" data-id="${esc(d.id)}" data-active="${d.id === S.deckId ? 1 : 0}" style="--i:${i}">
    <button class="deck-main" type="button" data-act="open"><span class="dvc-art deck-art" style="--h:${hue}"><b>${esc((d.name.trim()[0] || '?').toUpperCase())}</b>${art ? `<img alt="" loading="lazy" decoding="async" src="${esc(art)}">` : ''}<span class="deck-price">${dl ? `<b>${fmt(dl.total)}</b>${deltaChip(d.history)}` : ''}</span></span>
      <span class="deck-top"><span class="deck-name">${esc(d.name)}</span></span>
      <span class="deck-tags">${fk ? `<span class="deck-fmt ${fk}">${DK_FORMATS[fk].label}</span>` : ''}${pips(d.text)}</span>
      <span class="deck-meta"><span class="deck-line">${d.cards} carte${d.cards > 1 ? 's' : ''}${vt ? ' · <span title="Valeur estimée : prix tendance Cardmarket">' + esc(vt) + '</span>' : ''}${engIsOn(d.id) ? ' · <b class="mounted">complet</b>' : ''}</span><span class="deck-ago">${esc(relTime(d.updatedAt))}</span></span></button>
    <button class="deck-more" type="button" data-act="more" aria-label="Options de ${esc(d.name)}"><svg class="i"><use href="#i-more"/></svg></button></div>`;
}
/** Bouton « Mes decks » de l'accueil + écran des decks s'il est ouvert. */
function renderDecks() {
  alSoon();
  const list = allDecks(), mounted = list.filter(d => engIsOn(d.id)).length, loading = !!D.hint && !D.authReady, btn = $('#btnDecks');
  btn.dataset.empty = list.length ? '0' : '1';
  $('#decksSub').textContent = loading ? 'Chargement…' : list.length ? `${list.length} deck${list.length > 1 ? 's' : ''}${mounted ? ' · ' + mounted + ' complet' + (mounted > 1 ? 's' : '') : ''}` : 'Crée un deck ou colle une liste puis « Enregistrer ».';
  dksPaint();
  paintSync(); updateSaveButtons();
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
  let s = 'local', txt = 'Sur cet appareil · se connecter';
  if (D.user) {
    if (D.listErr) { s = 'error'; txt = D.listErr; }
    else if (D.pending) { s = 'pending'; txt = 'Synchronisation…'; }
    else { s = 'synced'; txt = 'Synchronisé'; }
  } else if (D.state === 'unavailable') txt = 'Sur cet appareil';
  el.dataset.s = s; t.textContent = txt;
  el.disabled = !D.user && D.state === 'unavailable';
}
function updateSaveButtons() {
  const has = S.deck && S.deck.cards.length > 0, d = findDeck(S.deckId);
  const b1 = $('#btnSave'); b1.disabled = !has; b1.title = d ? 'Mettre à jour « ' + d.name + ' »' : 'Enregistrer comme nouveau deck';
  const b2 = $('#btnSave2'); b2.classList.toggle('saved', !!d);
  $('#btnSave2Txt').textContent = d ? 'Enregistré' : 'Enregistrer';
  $('use', b2).setAttribute('href', d ? '#i-check' : '#i-bookmark');
  $$('.deck', DKS.el || document.createElement('div')).forEach(el => { el.dataset.active = el.dataset.id === S.deckId ? '1' : '0'; });
}
function renderAccountBtn() {
  const b = $('#btnAccount'), l = D.user ? ((D.user.displayName || D.user.email || '?').trim()[0] || '?').toUpperCase() : (D.hint && !D.authReady ? D.hint.l : '');
  b.dataset.in = l ? '1' : '0'; $('#avatarLetter').textContent = l;
  b.setAttribute('aria-label', D.user ? 'Compte : ' + (D.user.email || '') : 'Compte');
}

/* ── Feuille : enregistrer ────────────────────────────────────────────────────────────────── */
function openSaveSheet() {
  const text = $('#deckText').value, n = parseDeck(text).cards.length;
  if (!n) { toast('Colle d\'abord une liste'); return; }
  readOpts();
  const modeName = S.opts.mode === 'zero' ? 'Zero' : 'Direct';
  openSheet('Enregistrer le deck', null, api => {
    const where = D.user ? `Enregistré sur ton compte (${esc(D.user.email || '')}).`
      : `Enregistré sur cet appareil.${D.state !== 'unavailable' ? ' <button class="link-btn link-inline" type="button" id="svLogin">Connecte-toi</button> pour le retrouver partout.' : ''}`;
    api.body.innerHTML = `<div class="field-in"><label class="label" for="svName">Nom</label><input type="text" id="svName" maxlength="120" autocomplete="off" value="${esc(suggestName(text))}"></div>
      <p class="hint">${n} cartes · ${esc(LANGS[S.opts.lang] || S.opts.lang)} · ${esc(COND_SHORT[S.opts.cond] || S.opts.cond)} min · ${modeName}. Les critères sont enregistrés avec la liste.</p>
      <p class="hint" id="svWhere">${where}</p>`;
    api.setFoot('<button class="btn ghost" type="button" data-close>Annuler</button><button class="btn" type="button" id="svGo">Enregistrer</button>');
    const input = $('#svName', api.body), go = $('#svGo', api.foot);
    const sync = () => { go.disabled = !input.value.trim(); }; input.oninput = sync;
    const run = () => { if (go.disabled) return; saveCurrent(input.value.trim()); api.close(); toast(cloudOn() ? 'Deck enregistré sur ton compte' : 'Deck enregistré'); };
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
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Évolution du prix"><polygon class="ar" points="${pad},${h} ${pts.join(' ')} ${(w - pad).toFixed(1)},${h}" opacity=".55"/><polyline class="ln" points="${pts.join(' ')}"/><circle class="dt" cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="4.5"/></svg>`;
}
function openDeckSheet(id) {
  const d = findDeck(id); if (!d) return;
  openSheet(d.name, `${d.cards} carte${d.cards > 1 ? 's' : ''} · modifié ${relTime(d.updatedAt)}`, api => {
    const series = priceSeries(d.history), lastE = d.history[d.history.length - 1], same = lastE ? d.history.filter(e => sameKind(e, lastE)) : [];
    const rows = d.history.slice().reverse().slice(0, 14).map((e, i, arr) => {
      const p = arr.slice(i + 1).find(x => sameKind(x, e)); const df = p ? e.total - p.total : null;
      const when = new Date(e.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<span class="d">${esc(when)} · ${e.mode === 'zero' ? 'Zero' : 'Direct'}</span><span class="delta ${df == null || df === 0 ? 'flat' : df < 0 ? 'down' : 'up'}">${df == null || df === 0 ? '' : (df < 0 ? '−' : '+') + fmt(Math.abs(df))}</span><span class="t">${fmt(e.total)}</span>`;
    }).join('');
    api.body.innerHTML = `<div class="field-in"><label class="label" for="dkName">Nom</label><input type="text" id="dkName" maxlength="120" autocomplete="off" value="${esc(d.name)}"></div>
      <button class="coll-open dk-cover" type="button" id="dkCover"><span class="cover-th" aria-hidden="true"></span><span class="coll-t"><b>Image du deck</b><span id="dkCoverSub"></span></span><svg class="i chev" aria-hidden="true"><use href="#i-chev"/></svg></button>
      <label class="switch-row" for="dkMount"><span class="t"><b>Deck complet</b><span class="hint" id="dkMountHint"></span></span><span class="switch"><input type="checkbox" id="dkMount"><i></i></span></label>
      <div class="dk-val" id="dkVal"></div>
      <div class="sec-title">Historique des prix</div>
      ${series.length >= 2 ? chartSvg(series, Math.max(220, (api.body.clientWidth || 376) - 36)) + `<div class="chart-cap"><span>${esc(dateShort(same[0].at))}</span><span>${series.length} relevés · de ${esc(fmt(Math.min(...series)))} à ${esc(fmt(Math.max(...series)))}</span><span>${esc(dateShort(lastE.at))}</span></div>` : ''}
      ${rows ? `<div class="hist">${rows}</div>` : '<p class="hint">Aucun relevé. Lance une recherche avec ce deck chargé, en mode live : le prix est enregistré à chaque fois.</p>'}
      <button class="link-btn link-inline" type="button" id="dkEdit">Modifier les cartes (éditeur)</button>
      <button class="link-btn link-inline" type="button" id="dkDup">Dupliquer ce deck</button>
      <button class="link-btn link-inline" type="button" id="dkOwn">Ajouter ses cartes à ma collection</button>`;
    api.setFoot('<button class="btn ghost-danger" type="button" id="dkDel">Supprimer</button><button class="btn" type="button" id="dkOpen">Ouvrir</button>');
    const name = $('#dkName', api.body);
    name.onchange = () => {
      const v = name.value.trim(); if (!v) { name.value = d.name; return; }
      if (v !== d.name) { const cur = findDeck(id); if (cur) { putDeck(id, deckDoc({ ...cur, name: v })); $('.sheet-head h2', api.wrap).textContent = v; toast('Deck renommé'); } }
    };
    name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } };
    $('#dkOpen', api.foot).onclick = () => { api.close(); loadDeck(id); };
    const paintCover = () => {      // carte de présentation : celle choisie, sinon le commandant, sinon la plus chère
      const cur = findDeck(id) || d, cv = dkCoverCard(cur.text, dmOf), im = coverUrl(cv).replace('/normal/', '/small/');
      $('.cover-th', api.body).innerHTML = im ? `<img alt="" src="${esc(im)}">` : `<b>${esc((cur.name.trim()[0] || '?').toUpperCase())}</b>`;
      $('#dkCoverSub', api.body).textContent = cv ? `${cv.name} · ${cv.auto ? 'automatique' : 'choisie'}` : 'Aucune carte';
    };
    paintCover(); $('#dkCover', api.body).onclick = () => openCoverPicker(id, paintCover);
    dmLoad().then(() => dmFetch([dkCoverCard((findDeck(id) || d).text, dmOf)].filter(Boolean))).then(ok => ok && paintCover());
    engBindSwitch(id, $('#dkMount', api.body), $('#dkMountHint', api.body));
    const valEl = $('#dkVal', api.body);      // valeur estimée du deck (Cardmarket), même monté : pas besoin de chercher des offres
    const paintVal = fetched => {
      const cur = findDeck(id) || d, v = dkValue(cur.text, dmOf), fk = deckFmt(cur);
      valEl.innerHTML = v.known ? `<b>${esc(dkValueText(v))}</b><span>valeur estimée${fk ? ' · ' + DK_FORMATS[fk].label : ''} · prix tendance Cardmarket de ${v.known} carte${v.known > 1 ? 's' : ''} sur ${v.total} (terrains de base exclus, cartes possédées comprises)</span>`
        : v.missing.length && !fetched ? '<span>Estimation de la valeur du deck…</span>' : '<span>Valeur estimée indisponible (prix des cartes non lus : réessaie en ligne).</span>';
    };
    paintVal(false); dmLoad().then(() => { paintVal(false); return dmFetch(dkValue((findDeck(id) || d).text, dmOf).missing); }).then(() => paintVal(true));
    $('#dkOwn', api.body).onclick = () => {
      const cur = findDeck(id) || d, cards = parseDeck(cur.text).cards; if (!cards.length) return;
      const before = COLL.map, n = cards.reduce((a, c) => a + c.qty, 0);
      collAdd(cards.map(c => ({ k: ownKey(c.name), n: c.name, q: c.qty })), 'add'); api.close(); haptic('ok');
      toast(`${nf0(n)} carte${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} à ta collection (terrains de base exclus)`, { label: 'Annuler', fn: () => { COLL.map = before; collChanged(); } });
      collEnrich();
    };
    $('#dkEdit', api.body).onclick = () => { api.close(); setTimeout(() => openBuilder({ id }), 200); };
    $('#dkDup', api.body).onclick = () => {
      const cur = findDeck(id) || d, nid = newIdFor();
      putDeck(nid, deckDoc({ ...cur, name: (cur.name + ' (copie)').slice(0, 120), history: [], createdAt: Date.now() }));
      api.close(); toast('Deck dupliqué');
    };
    const del = $('#dkDel', api.foot); let armed = 0;
    del.onclick = () => {
      if (!armed) { armed = setTimeout(() => { armed = 0; del.textContent = 'Supprimer'; del.className = 'btn ghost-danger'; }, 4000); del.textContent = 'Confirmer'; del.className = 'btn danger'; return; }
      clearTimeout(armed); removeDeck(id); api.close(); toast('Deck supprimé');
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
  openSheet('Image du deck', 'Touche la carte qui illustrera ce deck', api => {
    api.body.innerHTML = '<div class="field-in"><label class="label" for="cvQ">Chercher dans le deck</label><input type="search" id="cvQ" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Nom de la carte"></div><div class="cv-grid" id="cvGrid"></div>';
    api.setFoot('<button class="btn ghost" type="button" data-close>Annuler</button><button class="btn ghost" type="button" id="cvAuto">Automatique</button>');
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
      grid.innerHTML = list.map(c => { const im = coverImg(c); return `<button type="button" class="cv-card" data-n="${esc(c.name)}" aria-pressed="${c.key === chosen}" aria-label="${esc(c.name)}${c.cmd ? ', commandant' : ''}"><span class="dvc-art" style="--h:${hash32(c.key) % 360}"><b>${esc((c.name.trim()[0] || '?').toUpperCase())}</b><i>${esc(c.name)}</i>${im ? `<img alt="" loading="lazy" decoding="async" src="${esc(im)}">` : ''}</span></button>`; }).join('') || '<p class="hint">Aucune carte de ce nom.</p>';
    };
    grid.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
    grid.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
    q.oninput = paint; paint();
    dmLoad().then(() => dmFetch(pool())).then(ok => ok && paint());      // images des cartes pas encore connues
    const pick = name => { setDeckCover(id, name); haptic('ok'); api.close(); toast(name ? 'Image du deck choisie' : 'Image automatique'); if (done) done(); };
    grid.onclick = e => { const b = e.target.closest('.cv-card'); if (b) pick(b.dataset.n); };
    $('#cvAuto', api.foot).onclick = () => pick('');
  });
}

/* ── Feuille : compte ─────────────────────────────────────────────────────────────────────── */
function openAccount() {
  openSheet('Compte', null, api => { D.account = { api, mode: 'in' }; paintAccount(); });
}
function accountOpen() { return D.account && sheets.indexOf(D.account.api) >= 0; }
function paintAccount() {
  if (!accountOpen()) return;
  const { api } = D.account, b = api.body;
  api.setFoot('');
  if (D.user) return paintAccountIn(api);
  if (D.state === 'loading' || D.state === 'idle') { b.innerHTML = '<div class="status" data-ok="0"><span class="dot"></span><span>Chargement…</span></div>'; return; }
  if (D.state === 'unavailable') {
    b.innerHTML = `<div class="status" data-ok="0"><span class="dot"></span><span>${esc(D.err)}</span></div>
      <p class="hint">Tes decks restent enregistrés sur cet appareil. Le compte permet de les retrouver sur tous tes appareils.</p>
      <button class="btn ghost small" type="button" id="acRetry" style="align-self:flex-start">Réessayer</button>`;
    $('#acRetry', b).onclick = () => { connectCloud(); };
    return;
  }
  paintAuthForm(api);
}
function paintAuthForm(api) {
  const b = api.body, st = D.account, up = st.mode === 'up';
  b.innerHTML = `<div class="auth">
    <div class="seg" id="acSeg" role="radiogroup" aria-label="Connexion ou création de compte"></div>
    <form id="acForm" novalidate>
      <div class="field-in"><label class="label" for="acEmail">Email</label><input type="email" id="acEmail" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" value="${esc(st.email || '')}"></div>
      <div class="field-in"><label class="label" for="acPw">Mot de passe</label><input type="password" id="acPw" autocomplete="${up ? 'new-password' : 'current-password'}" ${up ? 'minlength="6"' : ''}>${up ? '<span class="hint">6 caractères minimum.</span>' : ''}</div>
      <div class="auth-msg" id="acMsg" role="alert" hidden></div>
      <button class="btn block" type="submit" id="acGo">${up ? 'Créer mon compte' : 'Me connecter'}</button>
      ${up ? '' : '<button class="link-btn link-inline" type="button" id="acForgot">Mot de passe oublié ?</button>'}
    </form>
    <div class="divider"><span>ou</span></div>
    <button class="btn ghost block" type="button" id="acGoogle">Continuer avec Google</button>
    <p class="hint">Tes decks sont enregistrés sur ton compte. Ton token CardTrader et ton adresse restent sur cet appareil.</p></div>`;
  mountSeg($('#acSeg', b), [{ v: 'in', label: 'Connexion' }, { v: 'up', label: 'Créer un compte' }], st.mode, v => { st.email = $('#acEmail', b).value; st.mode = v; paintAccount(); });
  const msg = (t, ok) => { const m = $('#acMsg', b); m.hidden = !t; m.textContent = t || ''; m.classList.toggle('ok', !!ok); };
  const busy = (on, label) => { $('#acGo', b).disabled = on; $('#acGoogle', b).disabled = on; if (label) $('#acGo', b).textContent = on ? label : (up ? 'Créer mon compte' : 'Me connecter'); };
  const done = () => { api.close(); toast('Connecté'); };
  const fail = e => { busy(false, true); msg(authMessage(e)); };
  $('#acForm', b).onsubmit = async e => {
    e.preventDefault(); msg('');
    const email = $('#acEmail', b).value.trim(), pw = $('#acPw', b).value;
    if (!email) return msg('Saisis ton adresse email.'); if (!pw) return msg('Saisis ton mot de passe.');
    if (up && pw.length < 6) return msg('Mot de passe trop court : 6 caractères minimum.');
    busy(true, up ? 'Création…' : 'Connexion…');
    try { await (up ? D.cloud.signUp(email, pw) : D.cloud.signIn(email, pw)); done(); } catch (err) { fail(err); }
  };
  $('#acGoogle', b).onclick = async () => { msg(''); busy(true); try { await D.cloud.google(); done(); } catch (err) { fail(err); } };
  const fg = $('#acForgot', b);
  if (fg) fg.onclick = async () => {
    const email = $('#acEmail', b).value.trim(); if (!email) return msg('Saisis d\'abord ton adresse email.');
    try { await D.cloud.reset(email); msg(`Email de réinitialisation envoyé à ${email}. Pense à vérifier les courriers indésirables.`, true); }
    catch (err) { const t = authMessage(err); msg(err && err.code === 'auth/user-not-found' ? 'Si un compte existe avec cet email, un message vient d\'être envoyé.' : t, err && err.code === 'auth/user-not-found'); }
  };
}
function paintAccountIn(api) {
  const u = D.user, b = api.body, local = importable().length;
  const n = D.list.length;
  const state = D.listErr ? D.listErr : D.pending ? 'Synchronisation…' : `Synchronisé · ${n} deck${n > 1 ? 's' : ''}`;
  b.innerHTML = `<div class="who"><span class="who-av">${esc(((u.displayName || u.email || '?').trim()[0] || '?').toUpperCase())}</span><div class="who-t"><b>${esc(u.email || u.displayName || 'Compte')}</b><span id="acState">${esc(state)}</span></div></div>
    ${local ? `<div class="import-row"><span>${local} deck${local > 1 ? 's' : ''} sur cet appareil</span><button class="btn" type="button" id="acImport">Importer</button></div>` : ''}
    <p class="hint">Tes decks et leur historique de prix sont synchronisés sur tous les appareils connectés à ce compte. Ton token CardTrader et ton adresse restent sur cet appareil.</p>
    ${CTX.proxy ? `<div class="sec-title">Accès au serveur</div>
      ${CTX.needsLogin ? '<div class="status" data-ok="1"><span class="dot"></span><span>Le serveur est réservé aux comptes autorisés : plus de clé à saisir.</span></div>' : '<p class="hint">Pour réserver ce serveur à ton compte (et supprimer la clé APP_KEY), ajoute cet identifiant dans les variables d\'environnement Hostinger sous le nom <b>ALLOWED_UIDS</b>, puis redéploie.</p>'}
      <div class="uid-row"><code id="acUid">${esc(u.uid)}</code><button class="btn ghost small" type="button" id="acCopyUid">Copier</button></div>` : ''}`;
  api.setFoot('<button class="btn ghost-danger" type="button" id="acOut">Se déconnecter</button>');
  $('#acOut', api.foot).onclick = async e => { e.target.disabled = true; try { await D.cloud.signOut(); api.close(); toast('Déconnecté'); } catch (err) { e.target.disabled = false; toast('Déconnexion impossible'); } };
  const im = $('#acImport', b); if (im) im.onclick = e => { e.target.disabled = true; importLocal(); };
  const cu = $('#acCopyUid', b); if (cu) cu.onclick = () => copyText(u.uid);
}

/** Envoie les decks de cet appareil dans le compte. Les copies locales ne sont retirées qu'une fois le serveur d'accord. */
function importLocal() {
  const todo = importable(); if (!cloudOn() || !todo.length) return;
  const uid = D.user.uid, items = todo.map(d => ({ localId: d.id, id: D.cloud.newId(uid), data: stripDeck(d) }));
  items.forEach(x => D.importing.add(x.localId)); renderDecks(); paintAccount();
  toast('Import en cours…');
  D.cloud.saveMany(uid, items.map(x => ({ id: x.id, data: x.data }))).then(() => {
    const gone = new Set(items.map(x => x.localId));
    gone.forEach(i => D.importing.delete(i));
    D.localList = D.localList.filter(d => !gone.has(d.id));
    localWrite(D.localList.map(d => ({ id: d.id, ...stripDeck(d) })));
    renderDecks(); paintAccount(); toast(`${items.length} deck${items.length > 1 ? 's' : ''} importé${items.length > 1 ? 's' : ''}`);
  }).catch(err => { items.forEach(x => D.importing.delete(x.localId)); renderDecks(); paintAccount(); toast(deckErr(err)); });
}

/* ── Connexion au cloud ───────────────────────────────────────────────────────────────────── */
function onUser(user) {
  const prev = D.uid;
  if (D.unsub) { try { D.unsub(); } catch (e) { /* ignore */ } D.unsub = null; }
  D.user = user; D.uid = user ? user.uid : null; D.list = []; D.pending = false; D.listErr = ''; D.authReady = true;
  if (prev !== D.uid) { S.deckId = null; S.runDelta = null; D.seen.clear(); }
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
      D.listErr = err && err.code === 'permission-denied' ? 'Règles Firestore à publier' : 'Synchronisation impossible';
      console.error(err); renderDecks(); paintAccount();
      toast(deckErr(err));
    });
  }
  renderAccountBtn(); renderDecks(); paintAccount(); refreshDeck();
  collUser(user); xsUser(user);
  if (!user && prev) updateHeroDelta();
}
async function connectCloud() {
  D.state = 'loading'; D.err = ''; paintAccount(); paintSync();
  try { D.cloud = await loadCloud(); }
  catch (e) {
    D.state = 'unavailable';
    D.err = e && e.code === 'env' ? e.message : 'Connexion indisponible depuis ici : SDK Firebase bloqué ou hors ligne. Les decks restent enregistrés sur cet appareil.';
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
  $('#btnSave').onclick = () => { if (S.deckId && findDeck(S.deckId)) { saveCurrent(); toast('Deck mis à jour'); } else openSaveSheet(); };
  $('#btnViewer').onclick = () => openDeckViewer({ live: true });
  $('#btnSave2').onclick = () => {
    if (!S.run) return;
    if (S.deckId && findDeck(S.deckId)) { saveCurrent(); toast(snapshotEntry() ? 'Deck et prix mis à jour' : 'Deck mis à jour'); } else openSaveSheet();
  };
  $('#deckStats').addEventListener('click', e => { if (e.target.closest('[data-act="detach"]')) detachDeck(); });
  renderAccountBtn(); renderDecks(); dmLoad();
  setTimeout(connectCloud, 0);
}
