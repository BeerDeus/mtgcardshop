/* ── dklist.js : écran « Mes decks » ──────────────────────────────────────────────────────────────
   Ouvert depuis le bouton de l'accueil, comme « Ma collection ». Les decks y sont des cartes : image de la carte de présentation
   (choisie dans la feuille d'un deck, sinon commandant, sinon la carte la plus chère), nom, format, couleurs, valeur.
   Filtres : format (Tous / Commander / Standard) et couleurs (le deck doit avoir toutes les couleurs cochées). */
const DKS = { el: null, fmt: '', colors: new Set(), fresh: true };
const DKS_COLORS = [['W', 'Blanc'], ['U', 'Bleu'], ['B', 'Noir'], ['R', 'Rouge'], ['G', 'Vert']];

function closeDecks() { if (DKS.el) DKS.el.__close(); }
function openDecks() {
  closeDecks();
  DKS.fresh = true;
  const wrap = document.createElement('div'); wrap.className = 'dv dks'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', T('Mes decks'));
  wrap.innerHTML = `<header class="dv-head"><button class="icon-btn dv-back" type="button" data-act="close" aria-label="${T('Fermer mes decks')}"><svg class="i"><use href="#i-back"/></svg></button>
      <div class="dv-title"><b>${T('Mes decks')}</b><span></span></div>
      <div class="coll-tools"><button class="icon-btn deck-new" id="btnNewDeck" type="button" data-act="new" aria-label="${T('Créer un deck')}" title="${T('Créer un deck')}"><svg class="i"><use href="#i-plus"/></svg></button></div></header>
    <div class="dv-scroll"><div class="dv-body dks-body">
      <div class="dks-top"><button class="sync" id="decksSync" type="button" data-act="sync" data-s="local"><i></i><span id="decksSyncTxt">${T('Sur cet appareil')}</span></button></div>
      <div class="dks-filters" id="dksFilters" hidden>
        <div class="seg" id="dksSeg" role="radiogroup" aria-label="${T('Format')}"></div>
        <div class="dks-colors" role="group" aria-label="${T('Couleurs du deck')}">${DKS_COLORS.map(([c, n]) => `<button class="dks-c" type="button" data-c="${c}" aria-pressed="false" aria-label="${T(n)}" title="${T(n)}"><i class="pip ${c}"></i></button>`).join('')}<button class="link-btn dks-reset" type="button" data-act="reset" hidden>${T('Tout afficher')}</button></div>
      </div>
      <div class="deck-list" id="deckList"></div>
    </div></div>`;
  DKS.el = wrap; const prevFocus = document.activeElement;
  const onKey = e => { if (e.key === 'Escape' && !imgView && !sheets.length && !$$('body > .dv.on').some(x => x !== wrap && wrap.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)) { e.stopPropagation(); wrap.__close(); } };
  wrap.__close = () => {
    if (DKS.el !== wrap) return; DKS.el = null; document.removeEventListener('keydown', onKey, true);
    wrap.classList.remove('on'); setTimeout(() => wrap.remove(), reduceMotion() ? 0 : 240); releaseApp();
    try { if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
  wrap.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);      // image absente : la lettre du deck reste
  mountSeg($('#dksSeg', wrap), [{ v: '', label: T('Tous') }, { v: 'commander', label: 'Commander' }, { v: 'standard', label: T('Standard') }], DKS.fmt, v => { DKS.fmt = v; dksPaint(); });
  wrap.addEventListener('click', e => {
    const col = e.target.closest('.dks-c');
    if (col) { const c = col.dataset.c; if (DKS.colors.has(c)) DKS.colors.delete(c); else DKS.colors.add(c); haptic('tap'); dksPaint(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') return wrap.__close();
    if (act === 'new') return openDeckNew();
    if (act === 'sync') return openAccount();
    if (act === 'import') { b.disabled = true; importLocal(); return; }
    if (act === 'reset') { DKS.fmt = ''; DKS.colors.clear(); $('#dksSeg', wrap).setValue(''); dksPaint(); return; }
    const id = b.closest('.deck') && b.closest('.deck').dataset.id; if (!id) return;
    if (act === 'open') openDeckViewer({ id }); else if (act === 'more') openDeckSheet(id);      // toucher le deck : son viewer ; ⋯ : la feuille (image, montage, historique…) ; « Ouvrir » charge la liste dans la saisie
  });
  document.body.appendChild(wrap); holdApp(); renderDecks();
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('on'); $('.dv-back', wrap).focus({ preventScroll: true }); }));
  haptic('tap');
}

/** Liste des decks sous les filtres. Ne touche pas au DOM si rien n'a changé (les images ne clignotent pas). */
function dksPaint() {
  const el = DKS.el; if (!el) return;
  const all = allDecks(), loading = !!D.hint && !D.authReady, imp = importable();
  const colors = DKS_COLORS.map(([c]) => c).filter(c => DKS.colors.has(c)).join('');
  const shown = all.filter(d => dkMatch(d.text, { fmt: DKS.fmt, colors })), filtered = !!(DKS.fmt || colors);
  // filtres : utiles à partir de deux decks ; une couleur qu'aucun deck n'a est grisée (sauf si elle est cochée)
  const has = new Set(all.flatMap(d => [...dkColors(d.text)]));
  $('#dksFilters', el).hidden = all.length < 2 && !filtered;
  $$('.dks-c', el).forEach(b => { const on = DKS.colors.has(b.dataset.c); b.setAttribute('aria-pressed', String(on)); b.disabled = !on && !has.has(b.dataset.c); });
  $('.dks-reset', el).hidden = !filtered;
  $('.dv-title span', el).textContent = loading ? '' : filtered ? TN(all.length, '{shown} sur {n} deck', '{shown} sur {n} decks', { shown: shown.length.toLocaleString(LOC()) }) : TN(all.length, '{n} deck', '{n} decks');
  let html = '';
  if (loading) html = '<div class="deck skel"><span class="sk art"></span><span class="sk name"></span><span class="sk meta"></span></div><div class="deck skel"><span class="sk art"></span><span class="sk name"></span><span class="sk meta"></span></div>';
  else {
    if (imp.length) html += `<div class="import-row"><span>${TN(imp.length, '{n} deck sur cet appareil', '{n} decks sur cet appareil')}</span><button class="btn" type="button" data-act="import">${T('Importer')}</button></div>`;
    html += shown.map(deckCard).join('');
    if (!all.length) html += '<div class="deck-empty">' + T('Aucun deck pour le moment. Touche « + » pour en créer un, ou colle une liste puis « Enregistrer ».') + '</div>';
    else if (!shown.length) html += '<div class="deck-empty">' + T('Aucun deck ne correspond à ces filtres.') + '</div>';
  }
  const host = $('#deckList', el);
  if (host.__html !== html) { host.innerHTML = html; host.__html = html; }
  shown.forEach(d => D.seen.add(d.id));
  dvSoon(all, DKS.fresh ? 120 : 900); DKS.fresh = false;
}
