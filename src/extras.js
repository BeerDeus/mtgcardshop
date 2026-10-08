/* ── extras.js : panier acheté (« J'ai acheté »), decks montés (cartes engagées), synchro de ces données et de l'historique de valeur ──────
   · Après « Remplir le panier », les cartes réellement mises au panier sont gardées sur l'appareil : une bannière propose de les ajouter à la
     collection une fois l'achat fait sur CardTrader (quantités ajustables si une partie seulement a été prise).
   · Un deck « monté » réserve les exemplaires de la collection qu'il contient : les autres decks ne les comptent plus comme possédés.
   · Engagés et historique de valeur passent par le compte (users/{uid}/meta/engaged et /history) ; sans les règles Firestore à jour,
     tout reste sur l'appareil et un message le dit une fois. */
const BUY_KEY = 'deckdeal:buy:v1', ENG_KEY = 'deckdeal:eng:v1';
const XS = { buy: null, eng: {}, warned: false, docs: { engaged: { unsub: null, uid: '', state: 'off', pushT: 0 }, history: { unsub: null, uid: '', state: 'off', pushT: 0 } } };

function xsRead() {
  try { XS.buy = buyClean(JSON.parse(localStorage.getItem(BUY_KEY) || 'null')); } catch (e) { XS.buy = null; }
  try { const r = JSON.parse(localStorage.getItem(ENG_KEY) || 'null'); XS.eng = engClean(r && r.d); } catch (e) { XS.eng = {}; }
}
function buyWrite() { try { if (XS.buy) localStorage.setItem(BUY_KEY, JSON.stringify(XS.buy)); else localStorage.removeItem(BUY_KEY); } catch (e) { /* stockage indisponible : le panier à valider ne survivra pas au rechargement */ } }
function engWrite() { try { localStorage.setItem(ENG_KEY, JSON.stringify({ d: XS.eng })); } catch (e) { toast('Stockage plein : les cartes réservées n\'ont pas pu être enregistrées'); } }

/* ── « J'ai acheté » ──────────────────────────────────────────────────────────────────────────── */
/** Après un remplissage de panier : garde les cartes réellement ajoutées (replace : panier vidé avant). */
function buyRemember(added, replace) {
  if (!added || !added.length) return;
  XS.buy = buyMerge(XS.buy, added, replace); buyWrite(); buyPaint();
}
function buyPaint() {
  const el = $('#buyBar'); if (!el) return;
  const b = XS.buy;
  if (!b) { el.hidden = true; el.innerHTML = ''; return; }
  const cards = b.items.length, copies = b.items.reduce((a, i) => a + i.q, 0);
  el.hidden = false;
  el.innerHTML = `<span class="ib-ico" aria-hidden="true"><svg class="i"><use href="#i-cart"/></svg></span>
    <span class="ib-txt"><b>Panier rempli · ${nf0(cards)} carte${cards > 1 ? 's' : ''}</b><span>${nf0(copies)} exemplaire${copies > 1 ? 's' : ''} · ${esc(relTime(b.at))}. Achetées sur CardTrader ?</span></span>
    <button class="btn small" type="button" data-act="buy">J'ai acheté</button>
    <button class="ib-x" type="button" data-act="buyx" aria-label="Ignorer ce panier"><svg class="i"><use href="#i-close"/></svg></button>`;
}
function buyDrop(msg) { XS.buy = null; buyWrite(); buyPaint(); if (msg) toast(msg); }
function openBuySheet() {
  const b = XS.buy; if (!b) return;
  const rows = b.items.map(i => ({ ...i, a: i.q, have: collQty(i.k) }));
  openSheet('J\'ai acheté', `Panier du ${new Date(b.at).toLocaleDateString(LOC(), { day: 'numeric', month: 'long' })}`, api => {
    const total = () => rows.reduce((a, r) => a + r.a, 0);
    const paint = () => {
      api.body.innerHTML = `<p class="hint">Ajuste les quantités si tu n'as pas tout pris. Les cartes ajoutées seront déduites des prochaines recherches.</p>
        <div class="buy-list">${rows.map((r, i) => `<div class="buy-row${r.a ? '' : ' off'}" data-i="${i}"><span class="b-n"><b>${esc(r.n)}</b><small>${r.l ? flag(r.l) : ''}${r.have ? `${nf0(r.have)} déjà dans ta collection` : 'nouvelle dans ta collection'}</small></span>
          <span class="qstep"><button type="button" data-d="-1" aria-label="Moins de ${esc(r.n)}">−</button><b>${r.a}</b><button type="button" data-d="1" aria-label="Plus de ${esc(r.n)}"${r.a >= r.q ? ' disabled' : ''}>+</button></span></div>`).join('')}</div>`;
      const n = total();
      api.setFoot(`<button class="btn ghost" type="button" id="buyNone">Rien acheté</button><button class="btn" type="button" id="buyGo"${n ? '' : ' disabled'}>Ajouter ${nf0(n)} exemplaire${n > 1 ? 's' : ''}</button>`);
      $('#buyNone', api.foot).onclick = () => { api.close(); buyDrop('Panier ignoré'); };
      $('#buyGo', api.foot).onclick = () => {
        const add = rows.filter(r => r.a > 0).map(r => ({ k: r.k, n: r.n, q: r.a, ...(r.l ? { l: r.l } : {}) })); if (!add.length) return;
        const before = COLL.map, prevBuy = XS.buy, n = add.reduce((a, x) => a + x.q, 0);
        collAdd(add, 'add'); collEnrich(); XS.buy = null; buyWrite(); buyPaint(); api.close(); haptic('ok');
        toast(`${nf0(n)} exemplaire${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} à ta collection`, { label: 'Annuler', fn: () => { COLL.map = before; collChanged(); XS.buy = prevBuy; buyWrite(); buyPaint(); } });
      };
    };
    paint();
    api.body.onclick = e => {
      const btn = e.target.closest('.qstep button'), row = e.target.closest('.buy-row'); if (!btn || !row || btn.disabled) return;
      const r = rows[Number(row.dataset.i)]; r.a = Math.max(0, Math.min(r.q, r.a + Number(btn.dataset.d))); haptic('tap');
      const sc = api.body.scrollTop; paint(); api.body.scrollTop = sc;
    };
  });
}

/* ── Decks montés : cartes de la collection réservées ─────────────────────────────────────────── */
const engIsOn = id => !!(XS.eng[id] && Object.keys(XS.eng[id].q).length);
/** Empreinte des decks montés (id + date de dernière modification) : sert à invalider les listes qui en dépendent. */
const engSig = () => Object.keys(XS.eng).sort().map(id => id + ':' + XS.eng[id].at).join(',');
const engCount = id => (XS.eng[id] ? Object.values(XS.eng[id].q).reduce((a, x) => a + x, 0) : 0);
/** Exemplaires libres pour le deck en cours de recherche : possédés − réservés par les autres decks montés. */
const engOwned = k => engFree(collQty(k), XS.eng, k, S.deckId);
/** Exemplaires de la liste courante mis de côté par d'autres decks (non déduits du panier) et les decks concernés. */
function engHeldBack(cards) {
  let n = 0; const names = new Set();
  for (const c of cards) {
    const k = ownKey(c.key), own = collQty(k); if (!own) continue;
    const lost = Math.min(c.qty, own) - Math.min(c.qty, engOwned(k));
    if (lost > 0) { n += lost; for (const d of engDecksOf(XS.eng, k)) if (d.id !== S.deckId) names.add(d.n || 'un deck'); }
  }
  return { n, names: [...names] };
}
function engApplied() {
  refreshDeck(); renderDecks();
  if (COLL.el) collPaintBody(true);
  if (S.run && S.view === 'results') scheduleRecompute(true);
}
function engSaved() { engWrite(); xsPushSoon('engaged'); engApplied(); }
/** Monte un deck : réserve les exemplaires possédés de sa liste. */
function engSet(id, name, text) {
  XS.eng = { ...XS.eng, [id]: { n: String(name || '').slice(0, 120), at: Date.now(), q: engSnapshot(text, collQty) } };
  engSaved();
}
/** Démonte un deck (la trace vide est gardée pour que les autres appareils le sachent). */
function engClear(id, quiet) {
  if (!XS.eng[id]) return;
  if (!engIsOn(id)) { if (quiet) { const x = { ...XS.eng }; delete x[id]; XS.eng = x; engWrite(); } return; }
  XS.eng = { ...XS.eng, [id]: { n: XS.eng[id].n, at: Date.now(), q: {} } };
  engSaved();
}
/** Liste enregistrée à nouveau : un deck monté suit sa liste (nouveau relevé des cartes possédées). */
function engRefresh(id, name, text) {
  if (!engIsOn(id)) return;
  const q = engSnapshot(text, collQty), cur = XS.eng[id];
  if (JSON.stringify(q) === JSON.stringify(cur.q) && cur.n === name) return;
  engSet(id, name, text);
}
/** Interrupteur « Deck complet » (deck monté) de la feuille d'un deck. */
function engBindSwitch(id, cb, hint) {
  const paint = () => {
    const n = engCount(id); cb.checked = engIsOn(id);
    hint.textContent = cb.checked
      ? `${nf0(n)} exemplaire${n > 1 ? 's' : ''} de ta collection réservé${n > 1 ? 's' : ''} pour ce deck : ils ne sont plus déduits du panier des autres decks.`
      : 'Réserve les cartes de ta collection qui sont dans ce deck : elles ne seront plus déduites du panier de tes autres decks.';
  };
  paint();
  cb.onchange = () => {
    if (cb.checked) {
      const d = findDeck(id);
      if (!d || !Object.keys(engSnapshot(d.text, collQty)).length) { cb.checked = false; toast('Aucune carte de ce deck n\'est dans ta collection'); return; }
      engSet(id, d.name, d.text); haptic('ok'); toast('Deck complet : cartes réservées');
    } else { engClear(id); haptic('tap'); toast('Deck non complet : cartes à nouveau disponibles'); }
    paint();
  };
}
/** Pastille d'une carte de la collection réservée par un ou plusieurs decks. */
function engTag(k) {
  const ds = engDecksOf(XS.eng, k); if (!ds.length) return '';
  const q = ds.reduce((a, d) => a + d.q, 0), names = ds.map(d => d.n || 'deck');
  return `<span class="tag mount" title="Réservée pour : ${esc(names.join(', '))}">${q > 1 ? '× ' + nf0(q) + ' · ' : ''}${esc(names[0].length > 18 ? names[0].slice(0, 17) + '…' : names[0])}${names.length > 1 ? ' +' + (names.length - 1) : ''}</span>`;
}

/* ── Synchro avec le compte (engagés, historique de valeur) ───────────────────────────────────── */
function xsFail(id, err) {
  const d = XS.docs[id]; d.state = 'error';
  if (err && err.code === 'permission-denied' && !XS.warned) { XS.warned = true; toast('Règles Firestore à publier pour synchroniser decks complets et historique (voir README)'); }
}
function xsUser(user) {
  for (const id in XS.docs) { const d = XS.docs[id]; if (d.unsub) { try { d.unsub(); } catch (e) { /* ignore */ } d.unsub = null; } clearTimeout(d.pushT); d.state = 'off'; d.uid = ''; }
  if (!user || !D.cloud || !D.cloud.watchMeta) return;
  for (const id in XS.docs) {
    const d = XS.docs[id]; d.state = 'sync'; d.uid = user.uid;
    d.unsub = D.cloud.watchMeta(user.uid, id, (data, pending, fromCache) => xsRemote(id, user.uid, data, pending, fromCache), err => xsFail(id, err));
  }
}
function xsRemote(id, uid, data, pending, fromCache) {
  if (pending || fromCache || D.uid !== uid) return;                      // écho d'une écriture en cours ou copie locale du SDK : on attend le serveur
  const d = XS.docs[id]; d.state = 'ok';
  if (id === 'engaged') {
    const remote = data ? engClean(data.decks) : {}, merged = engMerge(XS.eng, remote);
    if (!engSame(merged, XS.eng)) { XS.eng = merged; engWrite(); engApplied(); }
    if (!engSame(merged, remote)) xsPushSoon('engaged');
  } else {
    const remote = data && Array.isArray(data.pts) ? data.pts.map(p => (Array.isArray(p) ? { t: p[0], v: p[1], n: p[2], q: p[3] } : null)).filter(Boolean) : [], merged = histMerge(VAL.hist, remote);
    if (!histSame(merged, VAL.hist)) { VAL.hist = merged; VAL.memo = null; valSave(false); paintCollSection(); if (COLL.el) collPaintBody(true); }
    if (!histSame(merged, remote)) xsPushSoon('history');
  }
}
function xsPushSoon(id) { const d = XS.docs[id]; if (!d || !d.uid) return; clearTimeout(d.pushT); d.pushT = setTimeout(() => xsPush(id), 900); }
async function xsPush(id) {
  const d = XS.docs[id]; if (!d || !d.uid || d.uid !== D.uid || !cloudOn() || !D.cloud.saveMeta) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const doc = id === 'engaged' ? { decks: XS.eng, updatedAt: Date.now() } : { pts: VAL.hist.map(h => [h.t, h.v, h.n | 0, h.q | 0]), updatedAt: Date.now() };
  try { await D.cloud.saveMeta(d.uid, id, doc); d.state = 'ok'; } catch (err) { xsFail(id, err); }
}

function xsInit() {
  xsRead(); buyPaint();
  const bar = $('#buyBar');
  if (bar) bar.addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (!b) return; haptic('tap'); if (b.dataset.act === 'buy') openBuySheet(); else buyDrop(); });
}
