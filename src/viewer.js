/* ── viewer.js : carte en grand (navigable) + deck viewer (prix gardés, façon MTGA) ─────────────────────── */

/* L'app derrière une surcouche plein écran est inerte ; plusieurs surcouches peuvent s'empiler (viewer → carte en grand). */
let appHolds = 0;
function holdApp() { appHolds++; const a = $('#app'); a.inert = true; a.setAttribute('aria-hidden', 'true'); }
function releaseApp() { appHolds = Math.max(0, appHolds - 1); if (!appHolds && !sheets.length) { const a = $('#app'); a.inert = false; a.removeAttribute('aria-hidden'); } }

/* ── Carte en grand ───────────────────────────────────────────────────────────────────────────── */
let imgView = null;
function closeCardImage() { if (imgView) imgView.close(); }

/** Fiche image d'une carte de la liste de résultats : langue de l'offre retenue (français si FR, anglais pour un repli). */
function cardImageItem(key) {
  const c = S.deck.cards.find(x => x.key === key); if (!c || !S.run) return null;
  const st = S.run.cards[key] || {}, v = cardView(c);
  const o = v.pick && v.pick.parts[0] ? v.pick.parts[0].offer : null, bp = (st.bps || [])[0] || {};
  const small = (o && o.img) || st.img || bp.img; if (!small) return null;
  return { key, name: c.name, small, lang: o && o.lang ? o.lang : 'en', set: o ? (o.sset || o.set) : bp.set, num: o ? o.num : bp.num, setName: o && o.setName, extra: '' };
}
/** Depuis la liste de résultats : la carte touchée, et on peut passer aux suivantes dans l'ordre affiché. */
function openCardImage(key) {
  if (!S.run) return;
  const items = [];
  for (const rw of $$('#list .rw')) { if (rw.hidden) continue; const it = cardImageItem(rw.dataset.key); if (it) items.push(it); }
  const i = items.findIndex(x => x.key === key); if (i < 0) return;
  openCardViewer(items, i);
}

/* ── Aperçu en grand dans la langue voulue : la carte du même nom en français (ou la langue de la recherche), lue par lots sur Scryfall, une seule fois par carte, gardée 30 jours ───── */
const LANGV = { m: new Map(), p: new Map(), loaded: null, t: 0 };
/** Langue souhaitée pour l'aperçu d'une carte dont l'exemplaire n'impose pas la sienne : celle de la recherche (français par défaut) ; '' si anglais. */
const wantLang = () => (S.opts.lang && S.opts.lang !== 'en' && SCRY_LANG[S.opts.lang] ? S.opts.lang : '');
/** Langue de l'aperçu en grand : celle de ton exemplaire s'il en a une précisée (anglais : on ne cherche rien d'autre), sinon la langue de la recherche. owned : la carte est dans ta collection. */
function viewLang(k, owned) { const x = owned ? COLL.map[ownKey(k)] : null; return x && x.q > 0 && x.l ? (x.l === 'en' ? '' : x.l) : wantLang(); }
const langvKey = (l, n) => l + '|' + ownKey(n);
function langvLoad() {
  if (!LANGV.loaded) LANGV.loaded = (async () => { try { const o = await Cache.get('dv:lang', 30 * DAY); if (o && typeof o === 'object' && !Array.isArray(o)) for (const k in o) if (!LANGV.m.has(k)) LANGV.m.set(k, o[k]); } catch (e) { /* cache absent */ } })();
  return LANGV.loaded;
}
function langvSave() {
  clearTimeout(LANGV.t);
  LANGV.t = setTimeout(() => { while (LANGV.m.size > 4000) LANGV.m.delete(LANGV.m.keys().next().value); try { Cache.set('dv:lang', Object.fromEntries(LANGV.m)); } catch (e) { /* ignore */ } }, 1200);
}
/** Lance la lecture (lots de 12) des images de ces cartes (names : dans l'ordre où elles serviront) ; ne refait ni le connu ni l'en-cours. */
function langvPrefetch(names, lang) {
  const todo = [], seen = new Set();
  for (const n of names) { const k = langvKey(lang, n); if (seen.has(k) || LANGV.m.has(k) || LANGV.p.has(k)) continue; seen.add(k); todo.push({ k, n, ok: ownKey(n) }); }
  if (!todo.length || scryLeft() > 0) return;
  for (let i = 0; i < todo.length; i += 12) {
    const chunk = todo.slice(i, i + 12);
    const pr = (async () => {
      try { const got = await scryLangImages(chunk.map(c => c.n), lang, undefined, undefined, true); for (const c of chunk) LANGV.m.set(c.k, got.get(c.ok) || ''); langvSave(); }
      catch (e) { /* hors ligne ou limite Scryfall : l'aperçu reste anglais, réessayé à la prochaine ouverture */ }
      finally { for (const c of chunk) LANGV.p.delete(c.k); }
    })();
    for (const c of chunk) LANGV.p.set(c.k, pr);
  }
}
/** Petite image de la carte dans cette langue : url, '' si Scryfall n'en a pas, null si la lecture a échoué. */
async function langvGet(name, lang) {
  await langvLoad(); const k = langvKey(lang, name);
  if (!LANGV.m.has(k)) { if (!LANGV.p.has(k)) langvPrefetch([name], lang); if (LANGV.p.has(k)) await LANGV.p.get(k); }
  return LANGV.m.has(k) ? LANGV.m.get(k) : null;
}

/* ── Illustration choisie pour une carte (dans la langue affichée) : gardée sur l'appareil, rejouée dans tous les aperçus d'une carte seule ───── */
const ART_KEY = 'deckdeal:art:v1';
let ART = null;
const artAll = () => { if (!ART) { try { const o = JSON.parse(localStorage.getItem(ART_KEY) || '{}'); ART = o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { ART = {}; } } return ART; };
const artK = (l, n) => l + '|' + ownKey(n);
const artGet = (l, n) => { const v = artAll()[artK(l, n)]; return v && Array.isArray(v.u) && v.u.length ? v : null; };
function artSave() { try { localStorage.setItem(ART_KEY, JSON.stringify(artAll())); } catch (e) { /* stockage plein : le choix reste pour cette session */ } }
function artSet(l, n, u, w) { const a = artAll(), k = artK(l, n); delete a[k]; a[k] = { u, w }; const ks = Object.keys(a); for (const x of ks.slice(0, Math.max(0, ks.length - 400))) delete a[x]; artSave(); }
function artDrop(l, n) { if (delete artAll()[artK(l, n)]) artSave(); }

/**
 * Visionneuse : items = [{ key, name, small, lang, set, num, setName, extra, wl, ln }] ; index de départ.
 * Bouton « Illustrations » : les impressions de la carte dans la langue affichée (Scryfall), au choix ; le choix est gardé quand l'aperçu n'est pas celui d'une offre.
 * wl : langue souhaitée si la carte n'a pas la sienne (image seule en anglais, ou impression sans image dans la langue de l'offre) → la carte du même nom (ln : nom anglais à chercher) dans cette langue, si elle existe.
 * Précédent / suivant : boutons, flèches du clavier, glissement. Chaque carte est chargée dans sa langue (repli anglais signalé).
 */
function openCardViewer(items, index) {
  if (!items.length) return;
  closeCardImage();
  const wrap = document.createElement('div'); wrap.className = 'imgv'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
  const multi = items.length > 1;
  wrap.innerHTML = `<button class="icon-btn imgv-x" type="button" aria-label="Fermer"><svg class="i"><use href="#i-close"/></svg></button>
    ${multi ? '<span class="imgv-count" aria-live="polite"></span><button class="imgv-nav prev" type="button" aria-label="Carte précédente"><svg class="i"><use href="#i-back"/></svg></button><button class="imgv-nav next" type="button" aria-label="Carte suivante"><svg class="i"><use href="#i-back"/></svg></button>' : ''}
    <div class="imgv-card tilt" data-busy="1"><img class="imgv-ph" alt="" hidden><img class="imgv-img" alt="" hidden><span class="imgv-spin"></span></div>
    <div class="imgv-cap"><b></b><span class="imgv-sub"></span><span class="imgv-extra" hidden></span><img class="imgv-shot" alt="Ta photo" hidden></div>
    <div class="imgv-acts"><button class="btn ghost small imgv-flip" type="button" hidden>Retourner la carte</button><button class="imgv-art" type="button" hidden aria-expanded="false">Illustrations</button></div>
    <div class="imgv-vars" hidden><div class="imgv-vh" aria-live="polite"></div><div class="imgv-vl"></div></div>`;
  const card = $('.imgv-card', wrap), img = $('.imgv-img', wrap), ph = $('.imgv-ph', wrap), sub = $('.imgv-sub', wrap), flipB = $('.imgv-flip', wrap), title = $('.imgv-cap b', wrap), extra = $('.imgv-extra', wrap), shotEl = $('.imgv-shot', wrap);
  const countEl = $('.imgv-count', wrap), prevB = $('.imgv-nav.prev', wrap), nextB = $('.imgv-nav.next', wrap);
  const artB = $('.imgv-art', wrap), varsEl = $('.imgv-vars', wrap), varsH = $('.imgv-vh', wrap), varsL = $('.imgv-vl', wrap);
  const prevFocus = document.activeElement, from = pressOrigin(), fromEl = from ? MO.press : null, idx0 = Math.max(0, Math.min(items.length - 1, index | 0));
  const lk = l => ({ ja: 'jp', ko: 'kr', zhs: 'zh-CN', zht: 'zh-TW' }[l] || l);
  let idx = Math.max(0, Math.min(items.length - 1, index | 0)), ctrl = null, urls = [], face = 0, it = null, lang = 'en', enBig = '', where = '', shown = 'en', vars = [], canSave = false, wantOpen = false, varT = 0, pickAt = -1;
  const wl0 = items.find(x => x.wl && x.plain && (x.lang || 'en') === 'en');
  if (wl0) { const ord = [...items.slice(idx), ...items.slice(0, idx)].filter(x => x.wl === wl0.wl && x.plain && (x.lang || 'en') === 'en'); langvLoad().then(() => langvPrefetch(ord.map(x => x.ln || x.name), wl0.wl)); }      // les suivantes sont déjà là quand on glisse
  const api = imgView = { close() {
    if (imgView !== api) return; imgView = null; if (ctrl) ctrl.abort(); clearTimeout(varT);
    if (idx === idx0 && fromEl && fromEl.isConnected) flipTo(card, fromEl.getBoundingClientRect(), 280);      // retour vers la vignette d'origine
    wrap.classList.remove('on'); document.removeEventListener('keydown', onKey, true);
    setTimeout(() => wrap.remove(), reduceMotion() ? 0 : 260);
    releaseApp();
    try { if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  } };
  const caption = (l0, note) => { const l = lk(l0); shown = l; sub.innerHTML = `<span class="imgv-lang">${flag(l)}${esc(LANGS[l] || l)}</span>${where ? `<span>${esc(where)}</span>` : ''}${note ? `<em>${esc(note)}</em>` : ''}`; };
  const show = i => {                                            // charge l'image en arrière-plan puis fondu : jamais de carte à moitié dessinée
    face = i; const probe = new Image(), mine = it;
    probe.onload = () => { if (imgView !== api || it !== mine) return; img.src = probe.src; img.hidden = false; requestAnimationFrame(() => img.classList.add('ok')); card.dataset.busy = '0'; };
    probe.onerror = () => { if (imgView !== api || it !== mine) return; card.dataset.busy = '0'; if (urls[i] !== enBig) { urls = [enBig]; caption('en', lang === 'en' ? '' : 'Image française indisponible : version anglaise'); show(0); flipB.hidden = true; } };
    img.classList.remove('ok'); card.dataset.busy = '1'; probe.src = urls[i];
  };
  const go = n => {
    idx = n; it = items[n]; if (ctrl) ctrl.abort(); ctrl = new AbortController(); const my = ctrl, mine = it;
    lang = it.lang || 'en'; enBig = it.big || it.small.replace('/small/', '/large/'); urls = []; face = 0;
    where = [it.setName, it.set && it.num ? String(it.set).toUpperCase() + ' ' + it.num : ''].filter(Boolean).join(' · ');
    wrap.setAttribute('aria-label', it.name); title.textContent = it.name;
    ph.src = it.small; ph.hidden = false; img.hidden = true; img.classList.remove('ok'); img.removeAttribute('src'); card.dataset.busy = '1'; img.alt = it.name;
    caption(lang, ''); flipB.hidden = true; flipB.textContent = 'Retourner la carte';
    clearTimeout(varT); vars = []; canSave = false; pickAt = -1; artB.hidden = true; artB.setAttribute('aria-expanded', 'false'); if (!wantOpen) { varsEl.hidden = true; wrap.classList.remove('has-vars'); } else { varsL.innerHTML = ''; varsH.textContent = ''; }
    extra.textContent = it.extra || ''; extra.hidden = !it.extra;
    if (it.shot) shotEl.src = it.shot; else shotEl.removeAttribute('src'); shotEl.hidden = !it.shot; wrap.classList.toggle('has-shot', !!it.shot);      // photo prise au scan (cartes à vérifier) : sous la carte, pour comparer
    if (multi) { countEl.textContent = (n + 1) + ' / ' + items.length; prevB.disabled = n === 0; nextB.disabled = n === items.length - 1; }
    (async () => {
      let r = null;
      if (!it.plain && it.set && !scryLeft()) { try { r = await scryImage({ set: it.set, num: it.num, lang }, my.signal); } catch (e) { if (e.name === 'AbortError') return; } }   // plain : image seule (collection), pas de lecture Scryfall
      if (imgView !== api || it !== mine) return;
      let wu = null;      // carte seule en anglais, ou impression sans image française : la version dans la langue voulue
      if (it.wl && ((it.plain && lang === 'en') || (r && r.missing && r.urls.length < 2))) { wu = await langvGet(it.ln || it.name, it.wl); if (imgView !== api || it !== mine) return; }
      if (wu) { urls = [wu.replace('/small/', '/large/')]; lang = it.wl; caption(lang, ''); flipB.hidden = true; }
      else if (r && r.urls.length) {
        urls = r.urls; caption(r.lang || lang, r.missing ? 'Pas d\'image française sur Scryfall : version anglaise' : '');
        flipB.hidden = urls.length < 2; flipB.textContent = 'Retourner la carte';
      } else if (it.plain) { urls = [enBig]; caption(lang, wu === '' ? 'Pas d\'image française sur Scryfall : version anglaise' : ''); }                                // image seule : la langue est celle de l'image fournie
      else { urls = [enBig]; caption('en', lang === 'en' ? '' : 'Image française indisponible : version anglaise'); }
      canSave = !!(it.plain || wu);      // l'aperçu d'une offre garde l'impression de l'offre : on peut feuilleter les illustrations, pas les retenir
      const pf = canSave ? artGet(shown, it.ln || it.name) : null;      // illustration choisie plus tôt pour cette carte (dans cette langue)
      if (pf) { urls = pf.u.slice(); where = pf.w || ''; caption(shown, ''); flipB.hidden = urls.length < 2; flipB.textContent = 'Retourner la carte'; }
      show(0);
      varT = setTimeout(() => loadVars(mine, my), wantOpen ? 120 : 320);      // pas de requête pendant un glissé rapide d'une carte à l'autre
    })();
  };
  /** Impressions de la carte dans la langue affichée : le bouton « Illustrations · N » apparaît s'il y en a au moins deux. */
  const loadVars = async (mine, my) => {
    if (imgView !== api || it !== mine || my.signal.aborted || scryLeft() > 0) return;
    let list = []; try { list = await scryArtPrints(it.ln || it.name, shown, my.signal); } catch (e) { return; }
    if (imgView !== api || it !== mine) return;
    vars = list;
    if (list.length < 2) { varsEl.hidden = true; wrap.classList.remove('has-vars'); return; }
    artB.hidden = false; artB.textContent = 'Illustrations · ' + list.length;
    if (wantOpen) varsOpen(true);      // la liste ouverte reste ouverte d'une carte à l'autre (sauf carte à une seule impression)
  };
  const baseOf = u => String(u || '').split('?')[0];
  const varsPaint = () => {
    const cur = baseOf(urls[0]), sel = vars.findIndex(p => baseOf(p.urls[0]) === cur), pf = canSave && artGet(shown, it.ln || it.name);
    pickAt = sel;
    varsL.innerHTML = (pf ? '<button type="button" class="imgv-v def" data-i="-1" aria-label="Revenir à l\'illustration par défaut"><i>Par défaut</i></button>' : '')
      + vars.map((p, i) => `<button type="button" class="imgv-v" data-i="${i}" aria-pressed="${i === sel}" aria-label="${esc(p.sn)} ${esc(String(p.set).toUpperCase())} ${esc(p.num)}${p.fx.length ? ', ' + esc(p.fx.join(', ')) : ''}"><img alt="" loading="lazy" decoding="async" src="${esc(p.th)}"><span>${esc(String(p.set).toUpperCase())} ${esc(p.num)}</span><small>${esc(p.y)}${p.fx.length ? ' · ' + esc(p.fx.join(', ')) : ''}</small></button>`).join('');
    const p = sel >= 0 ? vars[sel] : null;
    varsH.textContent = p ? `${p.sn} · ${canSave ? 'retenue pour cette carte' : 'aperçu seulement : l\'offre garde son impression'}` : (pf ? 'Illustration par défaut' : 'Touche une illustration' + (canSave ? '' : ' · aperçu seulement'));
    const on = varsL.querySelector('[aria-pressed="true"]'); if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  };
  const varsOpen = on => {
    varsEl.hidden = !on; artB.setAttribute('aria-expanded', String(on)); wrap.classList.toggle('has-vars', on);
    if (on) varsPaint();
  };
  artB.onclick = () => { haptic('tap'); wantOpen = varsEl.hidden; varsOpen(wantOpen); };
  varsL.addEventListener('click', e => {
    const b = e.target.closest('.imgv-v'); if (!b) return; haptic('tap');
    const i = Number(b.dataset.i), name = it.ln || it.name;
    if (i < 0) { artDrop(shown, name); go(idx); return; }      // « Par défaut » : l'aperçu repart de l'image d'origine
    const p = vars[i]; if (!p) return;
    urls = p.urls.slice(); face = 0; where = [p.sn, String(p.set).toUpperCase() + ' ' + p.num].filter(Boolean).join(' · ');
    caption(shown, ''); flipB.hidden = urls.length < 2; flipB.textContent = 'Retourner la carte'; show(0);
    if (canSave) artSet(shown, name, urls.slice(), where);
    varsPaint();
  });
  const step = d => { const n = idx + d; if (!multi || n < 0 || n >= items.length) return; haptic('tap'); go(n); };
  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); api.close(); }
    else if (e.key === 'ArrowRight') { e.stopPropagation(); step(1); }
    else if (e.key === 'ArrowLeft') { e.stopPropagation(); step(-1); }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.closest('.imgv-x')) return api.close();
    if (e.target.closest('.imgv-nav.prev')) step(-1); else if (e.target.closest('.imgv-nav.next')) step(1);
  });
  flipB.onclick = () => { haptic('tap'); show((face + 1) % urls.length); flipB.textContent = face === 0 ? 'Retourner la carte' : 'Voir le recto'; };
  let sx = null, sy = 0;                                         // glissement horizontal : carte suivante / précédente
  wrap.addEventListener('touchstart', e => { const t = e.touches[0]; sx = e.touches.length === 1 && !e.target.closest('.imgv-vars') ? t.clientX : null; sy = t.clientY; }, { passive: true });
  wrap.addEventListener('touchend', e => { if (sx == null) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null; if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1); }, { passive: true });
  document.body.appendChild(wrap); holdApp();
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('on'); $('.imgv-x', wrap).focus({ preventScroll: true }); }));
  haptic('tap'); go(idx);
  flipFrom(card, from);      // la carte part de la vignette touchée
}

/* ── Deck viewer ──────────────────────────────────────────────────────────────────────────────── */
const DV_SORT_KEY = 'deckdeal:dv-sort';
const DV = { anim: false, el: null, sort: 'mana', snap: null, deckId: null, name: '', live: false, adhoc: false, pub: false, prevFocus: null, flat: [], f: newFilter(), framed: null, fb: null, text: '', loading: false, sb: [] };
try { const v = localStorage.getItem(DV_SORT_KEY); if (['mana', 'price', 'type'].includes(v)) DV.sort = v; } catch (e) { /* stockage indisponible */ }

/** Commandants de la liste : cartes sous un en-tête « Commander », sinon la première carte si elle est légendaire (export EDHREC). */
function commandersOf(text, cards, metaOf) {
  const ks = commanderKeys(text).filter(k => cards.some(c => c.key === k));
  if (!ks.length && cards[0]) { const m = metaOf(cards[0]); if (m && canLead(m.tl)) ks.push(cards[0].key); }
  return new Set(ks);
}

/** Relevé de la recherche en cours, carte par carte (null si pas de vraie recherche terminée). */
function buildSnap() {
  if (S.demo || !S.run || S.run.status !== 'done' || !S.run.live || !S.res) return null;
  if (critSig() !== S.run.crit) return null;                 // critères modifiés depuis la recherche : les prix ne correspondraient plus
  const at = S.run.doneAt || Date.now(), cmd = commandersOf(S.run.text, S.deck.cards, c => (S.run.cards[c.key] || {}).meta);
  const items = [];
  for (const c of S.deck.cards) {
    const st = S.run.cards[c.key] || {}, v = cardView(c), m = st.meta || {}, bp = (st.bps || [])[0] || {};
    if (v.s === 'stale') return null;                        // collection modifiée depuis la recherche : prix incomplets, rien à garder
    const it = { k: c.key, n: c.name, q: c.qty, s: v.s === 'ok' ? 'ok' : v.s === 'own' ? 'own' : v.s === 'notfound' ? 'nf' : v.s === 'nohub' ? 'nohub' : 'none' };
    if (m.cm != null) { it.cm = m.cm; it.mc = m.mc; it.tl = m.tl; it.cl = m.cl; }
    const o = v.pick && v.pick.parts[0] ? v.pick.parts[0].offer : null;
    it.im = (o && o.img) || st.img || bp.img || '';
    if (c.own > 0) it.ow = c.own;
    if (cmd.has(c.key)) it.cmd = 1;
    if (o) {
      it.c = v.pick.cost; it.l = o.lang || ''; it.d = COND_SHORT[o.cond] || ''; it.st = o.sset || o.set || ''; it.nu = o.num || ''; it.sn = o.setName || ''; it.sl = o.seller + (o.country ? ' · ' + o.country : '');
      if (st.fellBack && o.lang === 'en') it.fb = 1;
      if (v.pick.short > 0) it.sh = v.pick.short;
      const ri = refInfo(v.pick.parts, st.bps); if (ri) it.rf = ri.ref;
    } else { it.st = bp.set || ''; it.nu = bp.num || ''; it.sn = bp.setName || ''; }
    items.push(it);
  }
  for (const b of S.deck.basics || []) items.push({ k: b.key, n: b.name, q: b.qty, s: 'basic' });
  const snap = { at, mode: S.opts.mode, lang: S.opts.lang, sig: curSig(), items };
  // Évolution : les prix unitaires du relevé précédent de ce deck (jamais celui de la même recherche : un deuxième « Enregistrer » ne doit pas effacer l'écart).
  const prev = snapOf(findDeck(S.deckId));
  if (prev) {
    if (prev.at === at) { if (prev.pv) { snap.pv = prev.pv; snap.pa = prev.pa; } }
    else if (prev.at < at && prev.lang === snap.lang) { const pv = pvOf(prev); if (pv) { snap.pv = pv; snap.pa = prev.at; } }
  }
  return sanitizeSnap(snap);
}

/** Relevé de référence d'un deck sans prix gardé (ou dont tout est possédé) : valeur estimée au prix tendance Cardmarket, image / coût / type lus sur Scryfall (cache des decks).
 *  c = valeur des q exemplaires (pas un coût d'achat) · ow = exemplaires libres dans la collection · ref : relevé de référence, jamais enregistré. */
function refSnapOf(text, id, pub) {
  const pd = parseDeck(text); if (!pd.cards.length && !pd.basics.length) return null;
  const cmd = dkFormat(text) === 'standard' ? new Set() : commandersOf(text, pd.cards, c => dmOf(ownKey(c.key)));
  const items = [];
  for (const c of pd.cards) {
    const k = ownKey(c.key), m = dmOf(k) || {}, ow = pub ? 0 : Math.min(c.qty, engFree(collQty(k), XS.eng, k, id));
    const it = { k: c.key, n: c.name, q: c.qty, s: Number.isFinite(m.eu) ? 'ok' : 'none' };
    if (it.s === 'ok') it.c = Math.round(m.eu * c.qty);
    if (m.cm != null) { it.cm = m.cm; it.mc = m.mc; it.tl = m.tl; it.cl = m.cl; }
    if (m.im) it.im = m.im;
    if (ow > 0) it.ow = ow;
    if (cmd.has(c.key)) it.cmd = 1;
    items.push(it);
  }
  for (const b of pd.basics) items.push({ k: b.key, n: b.name, q: b.qty, s: 'basic', im: basicIm(b.key) });
  const snap = sanitizeSnap({ at: Date.now(), mode: 'zero', lang: '', sig: '', items });
  if (snap) snap.ref = true;
  return snap;
}
/** Rien à acheter ni à chiffrer dans ce relevé (tout est possédé) : seul le relevé de référence a quelque chose à montrer. */
const snapNothingToBuy = snap => !snap.items.some(i => i.s !== 'own' && i.s !== 'basic');
/** Réserve (Standard, lignes « SB: ») : cartes à part, jamais comptées dans le total ; prix = tendance Cardmarket (la recherche d'offres ne la chiffre pas). sb : 1 · k préfixé « sb: ». */
function sbItemsOf(text, id, pub) {
  const out = [];
  for (const c of dkSideCards(text)) {
    const k = ownKey(c.key), m = dmOf(k) || {}, ow = pub ? 0 : Math.min(c.qty, engFree(collQty(k), XS.eng, k, id));
    const it = { k: 'sb:' + k, n: c.name, q: Math.min(999, c.qty), s: Number.isFinite(m.eu) ? 'ok' : 'none', sb: 1 };
    if (it.s === 'ok') it.c = Math.round(m.eu * c.qty);
    if (m.cm != null) { it.cm = m.cm; it.mc = m.mc; it.tl = m.tl; it.cl = m.cl; }
    if (m.im) it.im = m.im;
    if (ow > 0) it.ow = ow;
    out.push(it);
  }
  return out;
}
/** Image d'une carte possédée dans la langue de l'exemplaire (la plus fournie : fr, de, en…) : { src, lang }. null si la carte n'est pas dans la collection, sans langue précisée,
 *  ou sans image dans cette langue (Scryfall ne l'a pas encore donnée) : l'image du deck reste alors. Affichage seulement, jamais gardé dans un relevé. */
function ownLangImg(k) {
  const kk = ownKey(k), x = COLL.map[kk]; if (!x || !(x.q > 0) || !x.l) return null;
  const im = collImage(kk, x.l, (COLL.meta[kk] || {}).im);
  return im.src && im.lang === x.l ? im : null;
}
/** Cartes possédées d'une liste d'items du viewer : leur image passe dans la langue de l'exemplaire (ol = langue montrée). */
const dvOwnIm = items => items.map(i => {
  if (!(i.ow > 0 || i.s === 'own')) return i;
  const o = ownLangImg(String(i.k).replace(/^sb:/, ''));
  return o && o.src !== i.im ? { ...i, im: o.src, ol: o.lang } : i;
});
/** Terrains de base : image lue sur Scryfall (cache des decks), ajoutée à l'affichage seulement, jamais gardée dans le relevé. */
const basicIm = k => { const m = dmOf(ownKey(k)); return (m && m.im) || ''; };
function dvBasics(snap) {
  if (!snap || !snap.items.some(i => i.s === 'basic' && !i.im && basicIm(i.k))) return snap;
  return { ...snap, items: snap.items.map(i => (i.s === 'basic' && !i.im && basicIm(i.k) ? { ...i, im: basicIm(i.k) } : i)) };
}
/** Cartes dont le viewer a besoin ([{ key, name }]) : le deck entier si le relevé est de référence, sinon seulement la réserve ; terrains de base toujours (images). */
function dvNeeds() {
  const pd = parseDeck(DV.text), ref = DV.snap && DV.snap.ref;
  return [...(ref ? pd.cards : []), ...dkSideCards(DV.text), ...pd.basics].map(c => ({ key: ownKey(c.key), name: c.name }));
}
/** Lit sur Scryfall ce qui manque (images, coûts, prix du relevé de référence, de la réserve et des terrains), puis reconstruit l'affichage si le viewer est toujours ouvert. */
async function dvMetaLoad(wrap) {
  const list = dvNeeds();
  if (dmMissing(list, true).length) {
    DV.loading = !!(DV.snap && DV.snap.ref); DV.framed = null; dvRender();
    try { await dmFetch(list, true); } catch (e) { /* hors ligne : l'affichage reste partiel */ }
    if (DV.el !== wrap) return;
    DV.loading = false; dvRebuild(); dvRender();
  }
  // cartes possédées dans une autre langue que l'anglais : leur image, dans cette langue, si Scryfall ne l'a pas encore donnée
  if (DV.pub) return;
  const pd = parseDeck(DV.text); let got = false;
  try { got = await ownLangFetch([...pd.cards, ...dkSideCards(DV.text)]); } catch (e) { /* ignore */ }
  if (got && DV.el === wrap) { dvRebuild(); dvRender(); }
}
/** Relevé de référence, réserve et images des terrains recalculés d'après les fiches connues (le relevé de prix, lui, ne change pas). */
function dvRebuild() {
  if (DV.snap && DV.snap.ref) DV.snap = refSnapOf(DV.text, DV.deckId, DV.pub);
  DV.snap = dvBasics(DV.snap);
  if (DV.snap && !DV.pub) DV.snap = { ...DV.snap, items: dvOwnIm(DV.snap.items) };
  DV.sb = DV.snap ? (DV.pub ? sbItemsOf(DV.text, null, true) : dvOwnIm(sbItemsOf(DV.text, DV.deckId))) : []; DV.framed = null;
}

/* Relevés gardés sur cet appareil (toujours) ; ils sont aussi dans le document du deck quand le compte l'accepte (règles Firestore à jour). */
const SNAPS_KEY = 'deckdeal:snaps:v1';
function snapsRead() { try { const o = JSON.parse(localStorage.getItem(SNAPS_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
function snapSave(id, snap) {
  if (!id || !snap) return;
  const all = snapsRead(); all[id] = snap;
  const keep = Object.keys(all).sort((a, b) => ((all[b] && all[b].at) || 0) - ((all[a] && all[a].at) || 0)).slice(0, 30), out = {};
  for (const k of keep) out[k] = all[k];
  try { localStorage.setItem(SNAPS_KEY, JSON.stringify(out)); } catch (e) { /* quota : le relevé du compte reste utilisable */ }
}
function snapDrop(id) { const all = snapsRead(); if (!(id in all)) return; delete all[id]; try { localStorage.setItem(SNAPS_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ } }
const snapOf = d => (d ? newestSnap(d.snap, sanitizeSnap(snapsRead()[d.id])) : null);

const dvImg = it => (it.im ? it.im.replace('/small/', '/normal/') : '');
const dvLetter = it => esc((it.n.trim()[0] || '?').toUpperCase());
/** Écart notable d'une carte (≥ 5 % ou ≥ 0,20 € par exemplaire) : flèche sur la vignette. */
const dvMoved = d => !!d && (Math.abs(d.diff) >= 20 || Math.abs(d.diff) >= d.prev * 0.05);
function dvTile(it, i, snap, dl) {
  const hue = hash32(it.k) % 360, art = dvImg(it), d = dl && dl.get(it.k), mv = dvMoved(d) ? `<em class="${d.diff < 0 ? 'dn' : 'up'}" aria-hidden="true">${d.diff < 0 ? '▼' : '▲'}</em>` : '';
  const ref = !!snap.ref || !!it.sb, full = ref && it.ow >= it.q;
  const tag = it.s === 'ok' ? `<span class="dvc-p">${esc(fmt(it.c))}${mv}</span>`
    : it.s === 'own' ? '<span class="dvc-p own">Possédée</span>'
    : it.s === 'nf' ? '<span class="dvc-p bad">Introuvable</span>' : it.s === 'basic' ? '' : `<span class="dvc-p warn">${ref ? 'Prix inconnu' : 'Aucune offre'}</span>`;
  const en = ref ? (it.ow ? `<span class="dvc-l${full ? ' own' : ''}">${full ? '✓' : it.ow + '/' + it.q}</span>` : '')
    : it.s === 'ok' && it.l && snap.lang && it.l !== snap.lang ? `<span class="dvc-l">${esc(it.l.toUpperCase())}</span>` : '';
  const q = it.q > 1 ? `<span class="dvc-q">×${it.q}</span>` : '';
  const label = `${it.n}${it.q > 1 ? ', ×' + it.q : ''}${it.s === 'ok' ? ', ' + fmt(it.c) : it.s === 'own' ? ', dans ta collection' : it.s === 'nf' ? ', introuvable' : it.s === 'basic' ? '' : ref ? ', prix inconnu' : ', aucune offre'}${it.sb ? ', réserve' : ''}${ref && it.ow ? (full ? ', possédée' : `, ${it.ow} possédée${it.ow > 1 ? 's' : ''}`) : ''}${d && dvMoved(d) ? (d.diff < 0 ? ', en baisse' : ', en hausse') : ''}`;
  return `<button type="button" class="dvc" data-s="${it.s}" data-i="${i}" aria-label="${esc(label)}"><span class="dvc-art" style="--h:${hue}"><b>${dvLetter(it)}</b><i>${esc(it.n)}</i>${art ? `<img alt="" loading="lazy" decoding="async" src="${esc(art)}">` : ''}</span>${q}${en}${tag}</button>`;
}
/** Courbe de mana : c = exemplaires par coût (0 à 7+). interactive : barres cliquables (le viewer saute au groupe). */
function curveBars(c, interactive) {
  const max = Math.max(1, ...c), tag = interactive ? 'button type="button"' : 'div', end = interactive ? 'button' : 'div';
  return `<div class="dv-curve" role="img" aria-label="Courbe de mana : ${c.map((n, m) => n + ' carte' + (n > 1 ? 's' : '') + ' à ' + (m === 7 ? '7 et plus' : m)).join(', ')}">${c.map((n, m) => `<${tag} class="dv-bar" data-m="${m}" ${interactive && !n ? 'disabled' : ''} ${interactive ? `aria-label="Coût ${m === 7 ? '7 et plus' : m} : ${n}"` : ''}><span class="dv-n">${n || ''}</span><span class="dv-col"><i style="height:${Math.round(n / max * 100)}%"></i></span><span class="dv-x">${m === 7 ? '7+' : m}</span></${end}>`).join('')}</div>`;
}
const dvCurve = items => curveBars(curveOf(items), true);

/** Commandant mis en avant : grande carte, coût de mana, prix. */
function dvHero(it, idx, snap, dl) {
  const art = dvImg(it), hue = hash32(it.k) % 360, d = dl && dl.get(it.k);
  const price = it.s === 'ok' ? `<b>${esc(fmt(it.c))}</b>${it.rf ? `<span class="cmd-ref">Réf. Cardmarket ${esc(fmt(it.rf))}</span>` : ''}${snap.ref && it.ow ? `<span class="cmd-ref">${it.ow >= it.q ? 'Dans ta collection' : 'Possédé en ' + it.ow + ' ex.'}</span>` : ''}${d && dvMoved(d) ? `<span class="delta ${d.diff < 0 ? 'down' : 'up'}">${d.diff < 0 ? '−' : '+'}${esc(fmt(Math.abs(d.tot)))}</span>` : ''}`
    : it.s === 'own' ? '<b class="own">Dans ta collection</b>' : it.s === 'nf' ? '<b class="bad">Introuvable</b>' : `<b class="warn">${snap.ref ? 'Prix inconnu' : 'Aucune offre'}</b>`;
  return `<button type="button" class="dv-cmd" data-i="${idx}" aria-label="Commandant : ${esc(it.n)}"><span class="dvc-art tilt" style="--h:${hue}"><b>${dvLetter(it)}</b>${art ? `<img alt="" loading="lazy" decoding="async" src="${esc(art)}">` : ''}</span>
    <span class="cmd-t"><small>${/planeswalker/i.test(it.tl || '') ? 'Planeswalker commandant' : 'Commandant'}</small><strong>${esc(it.n)}</strong>${it.tl ? `<span class="cmd-tl">${esc(it.tl)}</span>` : ''}${it.mc ? `<span class="cmd-mc">${manaHtml(it.mc)}</span>` : ''}<span class="cmd-p">${price}</span></span></button>`;
}

/** Évolution depuis le relevé précédent : écart total et plus fortes variations. */
function dvEvolution(snap, dl) {
  if (!snap.pv || !snap.pa || !dl.size) return '';
  let total = 0; for (const d of dl.values()) total += d.tot;
  const mv = topMovers(snap.items, dl, 3), same = new Date(snap.pa).toDateString() === new Date(snap.at).toDateString();
  const row = (x, cls) => `<button type="button" class="mv ${cls}" data-k="${esc(x.item.k)}"><span>${esc(x.item.n)}</span><i>${esc(fmt(x.prev))} → ${esc(fmt(x.unit))}</i><b>${x.diff < 0 ? '−' : '+'}${esc(fmt(Math.abs(x.tot)))}</b></button>`;
  return `<div class="dv-evo"><div class="dv-evo-h"><span>Depuis ${same ? 'la recherche de ' + new Date(snap.pa).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'le ' + esc(dateShort(snap.pa))}</span><b class="${total === 0 ? 'flat' : total < 0 ? 'down' : 'up'}">${total === 0 ? 'Inchangé' : (total < 0 ? '▼ −' : '▲ +') + esc(fmt(Math.abs(total)))}</b></div>
    ${mv.down.length || mv.up.length ? `<div class="dv-mv">${mv.down.map(x => row(x, 'down')).join('')}${mv.up.map(x => row(x, 'up')).join('')}</div>` : ''}</div>`;
}
/** Total payé face au prix de référence Cardmarket des mêmes cartes. */
function dvRefLine(items) {
  const t = refTotals(items); if (t.cards < 3) return '';
  const lvl = t.pct <= 5 ? 'good' : t.pct >= 40 ? 'warn' : '';
  return `<div class="dv-ref ${lvl}"><span>Réf. Cardmarket pour les mêmes cartes : <b>${esc(fmt(t.ref))}</b></span><b>${t.pct === 0 ? 'identique' : (t.pct < 0 ? '−' : '+') + Math.abs(t.pct) + ' %'}</b></div>`;
}

/** Cadre du viewer : résumé, bascule de tri, filtres. Reconstruit seulement quand le relevé change (la saisie ne doit pas perdre le focus). */
function dvFrame(snap) {
  const el = DV.el, items = snap.items, found = items.filter(i => i.s === 'ok'), total = found.reduce((a, i) => a + i.c, 0);
  const copies = items.reduce((a, i) => a + i.q, 0), miss = items.filter(i => i.s === 'nf').length, none = items.filter(i => i.s === 'none' || i.s === 'nohub').length, own = items.filter(i => i.s === 'own').length;
  const ref = !!snap.ref, old = !ref && !DV.live && snapAge(snap) === 'old';
  const crit = ref ? 'Valeur estimée · prix tendance Cardmarket' + (items.some(i => i.ow) ? ' · ✓ dans ta collection' : '') : [LANGS[snap.lang] || snap.lang, snap.mode === 'zero' ? 'CardTrader Zero' : 'Direct'].filter(Boolean).join(' · ');
  const when = ref ? (DV.loading ? 'Lecture des cartes et des prix…' : 'Prix de référence, pas des offres') : DV.live ? 'Prix de la recherche en cours' : `Prix du ${dateShort(snap.at)} · ${relTime(snap.at)}`;
  DV.dl = snapDeltas(items, snap.pv);
  const sbN = DV.sb.reduce((a, i) => a + i.q, 0), sbTxt = sbN ? ` · réserve ${sbN}` : '';
  const todo = ref ? items.reduce((a, i) => a + (i.s === 'basic' ? 0 : Math.max(0, i.q - (i.ow || 0))), 0) : 0;
  $('.dv-title span', el).textContent = DV.pub ? `${copies} carte${copies > 1 ? 's' : ''}${sbTxt} · partagé, lecture seule` : ref ? `${copies} carte${copies > 1 ? 's' : ''} · ${todo ? todo + ' à trouver' : 'toutes possédées'}${none ? ' · ' + none + ' sans prix' : ''}${sbTxt}`
    : `${copies} carte${copies > 1 ? 's' : ''}${own ? ' · ' + own + ' possédée' + (own > 1 ? 's' : '') : ''}${miss ? ' · ' + miss + ' introuvable' + (miss > 1 ? 's' : '') : ''}${none ? ' · ' + none + ' sans offre' : ''}${sbTxt}`;
  $('.dv-body', el).innerHTML = `<section class="dv-sum">
      <div class="dv-total"><span class="dv-eur">${ref ? '≈ ' : ''}<span class="dv-amt">${esc(fmt(total))}</span>${ref && none ? '+' : ''}</span><span class="dv-crit">${ref ? '' : 'Articles · '}${esc(crit)}</span></div>
      <div class="dv-age" data-age="${old ? 'old' : 'fresh'}"><span>${esc(when)}</span>${DV.live || ref ? '' : '<button class="link-btn" type="button" data-act="refresh">Actualiser</button>'}</div>
      ${dvEvolution(snap, DV.dl)}${dvRefLine(items)}
      ${dvCurve(items)}
      <button class="btn ghost block dv-hand" type="button" data-act="hand"><svg class="i"><use href="#i-stack"/></svg>Main de départ</button>
    </section>
    <div id="dvCmd"></div>
    <div class="seg dv-seg" id="dvSeg"></div>
    <div id="dvF"></div>
    <div class="dv-groups"></div>`;
  mountSeg($('#dvSeg', el), [{ v: 'mana', label: 'Mana' }, { v: 'price', label: 'Prix' }, { v: 'type', label: 'Type' }], DV.sort, v => {
    DV.sort = v; try { localStorage.setItem(DV_SORT_KEY, v); } catch (e) { /* ignore */ } haptic('tap'); DV.anim = true; dvGroups();
    const g = $('.dv-groups', DV.el), sc = $('.dv-scroll', DV.el); if (g && sc) sc.scrollTop = Math.min(sc.scrollTop, g.offsetTop - 8);
  });
  $('#dvSeg', el).setValue(DV.sort);
  { const a = $('.dv-amt', el); a._v = DV.shownTotal == null ? 0 : DV.shownTotal; DV.shownTotal = total; tween(a, total); }      // le total défile depuis 0 à l'ouverture, puis d'une valeur à l'autre
  DV.fb = mountFilters($('#dvF', el), DV.f, () => dvGroups(), { placeholder: 'Rechercher dans le deck' });
}
/** Commandant + groupes de cartes, d'après le tri et les filtres. */
function dvGroups() {
  const snap = DV.snap, el = DV.el; if (!snap || !el) return;
  const sc = $('.dv-scroll', el), keep = sc ? sc.scrollTop : 0;
  const all = snap.items.concat(DV.sb), filtered = filterItems(all, DV.f), act = filterActive(DV.f);
  const cmds = filtered.filter(i => i.cmd), rest = filtered.filter(i => !i.cmd), dl = DV.dl;
  DV.flat = [];
  const flat = it => DV.flat.push(it) - 1;
  $('#dvCmd', el).innerHTML = cmds.length ? `<div class="dv-cmds">${cmds.map(c => dvHero(c, flat(c), snap, dl)).join('')}</div>` : '';
  const groups = groupSnap(rest, DV.sort, !!snap.ref); let n = DV.flat.length;
  const hidden = (DV.f.colors.size || DV.f.type || DV.f.cmc !== '') ? all.filter(i => !hasMeta(i)).length : 0;
  $('.dv-groups', el).innerHTML = (act ? `<p class="hint dv-fcount">${filtered.length} carte${filtered.length > 1 ? 's' : ''} sur ${all.length}${hidden ? ` · ${hidden} sans infos de type ou de coût ${snap.ref ? '(pas encore lues)' : '(prix gardés avant cette version) : relance la recherche'}` : ''}</p>` : '')
    + (groups.map(g => `<section class="dv-g" data-g="${esc(g.id)}"><h3><span>${/^m\d$/.test(g.id) ? 'Coût ' + esc(g.label) : esc(g.label)}</span><small>${g.count} carte${g.count > 1 ? 's' : ''}${g.cost ? ' · ' + (g.id === 'sb' ? '≈ ' : '') + esc(fmt(g.cost)) : ''}${g.id === 'sb' ? ' · prix tendance' : ''}</small></h3><div class="dv-grid">${g.items.map(it => { flat(it); return dvTile(it, n++, snap, dl); }).join('')}</div></section>`).join('')
      || (cmds.length ? '' : '<p class="hint listempty">Aucune carte ne correspond.</p>'));
  if (sc) sc.scrollTop = keep;
  if (DV.anim) { DV.anim = false; stagger($$('.dv-grid', el), $('.dv-cmds', el)); }
}
function dvRender() {
  const snap = DV.snap, el = DV.el; if (!el) return;
  const foot = $('.dv-foot', el), edit = $('[data-act="edit"]', foot), refresh = $('[data-act="refresh"]', foot), close = $('[data-act="close"]', foot);
  if (!snap) {
    DV.framed = null;
    $('.dv-body', el).innerHTML = '<div class="dv-empty"><b>Ce deck est vide</b><p>Ajoute des cartes à la liste pour les voir ici.</p></div>';
    $('.dv-title span', el).textContent = ''; foot.hidden = !DV.deckId; edit.hidden = DV.live || !DV.deckId; refresh.hidden = true; close.hidden = !DV.live && !DV.adhoc; return;
  }
  if (DV.framed !== snap) { dvFrame(snap); DV.framed = snap; }
  dvGroups();
  // relevé de référence : « Chercher les offres » seulement s'il reste des cartes à acheter (tout possédé : rien à chercher)
  const ref = !!snap.ref, todo = ref && snap.items.some(i => i.s !== 'basic' && i.q > (i.ow || 0));
  refresh.textContent = ref ? 'Chercher les offres' : 'Actualiser';
  foot.hidden = false; edit.hidden = DV.live || !DV.deckId; refresh.hidden = DV.live || !DV.deckId || (ref && !todo);
  close.hidden = !DV.live && !DV.adhoc;
}
function dvItemFor(it) {
  if (it.s === 'nf' || !it.im) return null;
  const dl = DV.dl && DV.dl.get(it.k), mv = dl && dvMoved(dl) ? ` · ${dl.diff < 0 ? '▼ −' : '▲ +'}${fmt(Math.abs(dl.diff))} par exemplaire` : '';
  const ref = it.rf ? ` · réf. Cardmarket ${fmt(it.rf)}` : '';
  const own = it.ow ? (it.ow >= it.q ? 'dans ta collection' : `${it.ow} possédée${it.ow > 1 ? 's' : ''} sur ${it.q}`) : '';
  const rf2 = (DV.snap && DV.snap.ref) || it.sb;
  const extra = it.s === 'basic' ? 'Terrain de base' : rf2 ? [it.sb ? 'Réserve' : '', it.s === 'ok' ? fmt(it.c) + (it.q > 1 ? ' pour ' + it.q : '') + ' · prix tendance Cardmarket' : 'Prix inconnu', own].filter(Boolean).join(' · ') : it.s === 'ok' ? [fmt(it.c) + (it.q > 1 ? ' pour ' + (it.q - (it.ow || 0)) : ''), it.d, it.sl].filter(Boolean).join(' · ') + (it.sh ? ` · ${it.sh} manquante${it.sh > 1 ? 's' : ''}` : '') + (it.ow ? ` · ${it.ow} possédée${it.ow > 1 ? 's' : ''}` : '') + ref + mv
    : it.s === 'own' ? 'Dans ta collection' : 'Aucune offre avec tes critères';
  const ol = !!it.ol;      // image de ta propre carte (sa langue) : pas la version de l'offre, donc ni extension ni numéro à relire sur Scryfall
  return { key: it.k, name: it.n, wl: ol ? '' : viewLang(String(it.k).replace(/^sb:/, ''), it.ow > 0 || it.s === 'own'), small: it.im, lang: it.ol || it.l || 'en', set: ol ? '' : it.st, num: ol ? '' : it.nu, setName: ol ? '' : it.sn, extra, plain: ol || ((it.s === 'own' || it.s === 'basic' || rf2) && !it.st) };
}
function dvOpenCard(i) {
  const list = [], at = new Map();
  DV.flat.forEach((it, k) => { const v = dvItemFor(it); if (v) { at.set(k, list.length); list.push(v); } });
  if (at.has(i)) openCardViewer(list, at.get(i));
}
function closeDeckViewer() { if (DV.el) DV.el.__close(); }
/** Ouvre le viewer d'un deck enregistré ({ id }), de la recherche en cours ({ live: true }) ou d'une liste quelconque ({ text, name } : deck EDHREC ;
 *  pub : deck reçu par un lien public, en lecture seule, sans rien de la collection de cet appareil). */
function openDeckViewer({ id, live, text, name, pub } = {}) {
  closeDeckViewer(); closeCardImage();
  const adhoc = !id && !live && typeof text === 'string', d = id ? findDeck(id) : null;
  DV.live = !!live; DV.adhoc = adhoc; DV.pub = !!pub; DV.deckId = adhoc ? null : id || (live ? S.deckId : null) || null;
  DV.snap = adhoc ? null : live ? buildSnap() : snapOf(d); DV.framed = null; DV.dl = null; DV.f = newFilter(); DV.anim = true; DV.shownTotal = null;
  DV.name = adhoc ? String(name || 'Deck') : d ? d.name : (live && findDeck(S.deckId) ? findDeck(S.deckId).name : 'Liste en cours');
  if (live && !DV.snap) { toast('Lance une recherche pour voir le deck'); return; }
  // Pas de prix gardé (ou tout est possédé, donc rien à chiffrer) : même viewer, avec la valeur estimée du deck au prix tendance Cardmarket
  DV.text = adhoc ? text : live ? S.run.text : d ? d.text : ''; DV.loading = false;
  if (!DV.snap || snapNothingToBuy(DV.snap)) DV.snap = refSnapOf(DV.text, DV.deckId, DV.pub);
  dvRebuild();
  const wrap = document.createElement('div'); wrap.className = 'dv'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Deck viewer · ' + DV.name);
  wrap.innerHTML = `<header class="dv-head"><button class="icon-btn dv-back" type="button" data-act="close" aria-label="Fermer le viewer"><svg class="i"><use href="#i-back"/></svg></button>
      <div class="dv-title"><b>${esc(DV.name)}</b><span></span></div>${DV.pub ? '' : '<button class="icon-btn" type="button" data-act="share" aria-label="Partager ce deck (lien en lecture seule)" title="Partager"><svg class="i"><use href="#i-share"/></svg></button>'}</header>
    <div class="dv-scroll"><div class="dv-body"></div></div>
    <footer class="dv-foot"><button class="btn ghost" type="button" data-act="edit">Modifier la liste</button><button class="btn" type="button" data-act="refresh">Actualiser</button><button class="btn" type="button" data-act="close">Fermer</button></footer>`;
  DV.el = wrap; DV.prevFocus = document.activeElement;
  const onKey = e => { if (e.key === 'Escape' && !imgView && !sheets.length) { e.stopPropagation(); wrap.__close(); } };
  wrap.__close = () => {
    if (DV.el !== wrap) return; DV.el = null; document.removeEventListener('keydown', onKey, true);
    if (DV.pub) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } }
    wrap.classList.remove('on'); setTimeout(() => wrap.remove(), reduceMotion() ? 0 : 240); releaseApp();
    try { if (DV.prevFocus && DV.prevFocus.focus && DV.prevFocus.isConnected) DV.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
  wrap.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);   // image absente : la vignette de nom reste
  wrap.addEventListener('click', e => {
    const tile = e.target.closest('.dvc, .dv-cmd'); if (tile) return dvOpenCard(Number(tile.dataset.i));
    const mv = e.target.closest('.mv'); if (mv) { const i = DV.flat.findIndex(x => x.k === mv.dataset.k); if (i >= 0) dvOpenCard(i); return; }
    const bar = e.target.closest('button.dv-bar'); if (bar && !bar.disabled) {
      const m = bar.dataset.m; const go = () => { const g = $(`.dv-g[data-g="m${m}"]`, wrap); if (g) { $('.dv-scroll', wrap).scrollTo({ top: g.offsetTop - 56, behavior: reduceMotion() ? 'auto' : 'smooth' }); } };
      if (DV.sort !== 'mana') { DV.sort = 'mana'; $('#dvSeg', wrap).setValue('mana'); dvGroups(); } haptic('tap'); return go();
    }
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const act = b.dataset.act, deck = DV.deckId;
    if (act === 'close') wrap.__close();
    else if (act === 'hand') openHand();
    else if (act === 'share') shareDeck(DV.deckId && !DV.live ? { id: DV.deckId } : { text: DV.text, name: DV.name });
    else if (act === 'edit' && deck) { wrap.__close(); loadDeck(deck); }
    else if (act === 'refresh' && deck && !DV.live) { wrap.__close(); refreshDeckPrices(deck); }
  });
  document.body.appendChild(wrap); holdApp(); dvRender();
  dvMetaLoad(wrap);
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('on'); $('.dv-back', wrap).focus({ preventScroll: true }); }));
  if (!DV.pub) haptic('tap');      // ouvert par un lien au chargement : pas de geste, le navigateur refuserait la vibration
}
/** « Actualiser » : recharge le deck, relit les prix (cache serveur ignoré) puis propose de revenir au viewer. */
async function refreshDeckPrices(id) {
  const d = findDeck(id); if (!d) return;
  const before = (snapOf(d) || {}).at || 0;
  loadDeck(id, true);
  await startRun(true);
  const cur = findDeck(id), now = snapOf(cur);
  if (S.run && S.run.status === 'done' && now && now.at > before) toast('Prix actualisés', { label: 'Voir le deck', fn: () => openDeckViewer({ id }) });
}

/* ── Main de départ : 7 cartes au hasard dans la bibliothèque (commandant et réserve à part), et les chances d'avoir 0 à 7 terrains (loi hypergéométrique) ── */
const pctTxt = p => (p >= 0.995 ? '100' : p < 0.005 && p > 0 ? '< 1' : String(Math.round(p * 100))) + ' %';
function openHand() {
  const snap = DV.snap; if (!snap) return;
  const lib = libraryOf(snap.items), isLand = it => it.s === 'basic' || isLandType(it.tl);
  if (lib.length < 7) { toast('Il faut au moins 7 cartes dans le deck'); return; }
  const L = lib.filter(isLand).length, unknown = new Set(lib.filter(it => it.s !== 'basic' && it.tl == null).map(it => it.k)).size, odds = handLandOdds(lib.length, L, 7);
  openSheet('Main de départ', `${lib.length} cartes dans la bibliothèque · ${L} terrain${L > 1 ? 's' : ''}`, api => {
    let hand = [];
    const paint = () => {
      const lands = hand.filter(isLand).length, max = Math.max(...odds);
      api.body.innerHTML = `<div class="hand-grid">${hand.map((it, i) => `<button type="button" class="dvc hand-c" data-i="${i}" aria-label="${esc(it.n)}"><span class="dvc-art" style="--h:${hash32(it.k) % 360}"><b>${dvLetter(it)}</b><i>${esc(it.n)}</i>${dvImg(it) ? `<img alt="" decoding="async" src="${esc(dvImg(it))}">` : ''}</span></button>`).join('')}</div>
        <p class="hand-sum"><b>${lands} terrain${lands > 1 ? 's' : ''}</b> · ${7 - lands} sort${7 - lands > 1 ? 's' : ''}</p>
        <h3 class="cs-h">Terrains en main de départ <small>sur 7 cartes</small></h3>
        <div class="odds" role="img" aria-label="${odds.map((p, k) => k + ' terrain' + (k > 1 ? 's' : '') + ' : ' + pctTxt(p)).join(', ')}">${odds.map((p, k) => `<div class="odd${k === lands ? ' on' : ''}"><span>${k}</span><i style="--w:${(p / max * 100).toFixed(1)}%"></i><b>${pctTxt(p)}</b></div>`).join('')}</div>
        <p class="hint">Entre 2 et 4 terrains : ${pctTxt(odds[2] + odds[3] + (odds[4] || 0))} des mains.${unknown ? ` ${unknown} carte${unknown > 1 ? 's' : ''} au type pas encore lu, comptée${unknown > 1 ? 's' : ''} comme sort${unknown > 1 ? 's' : ''}.` : ''}</p>`;
    };
    const deal = () => { hand = drawHand(lib, 7); paint(); stagger($('.hand-grid', api.body)); };
    api.setFoot('<button class="btn ghost" type="button" data-close>Fermer</button><button class="btn" type="button" data-act="redeal">Nouvelle main</button>');
    api.foot.addEventListener('click', e => { if (e.target.closest('[data-act="redeal"]')) { haptic('tap'); deal(); } });
    api.body.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
    api.body.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
    api.body.addEventListener('click', e => {
      const c = e.target.closest('.hand-c'); if (!c) return;
      const list = [], at = new Map();
      hand.forEach((it, i) => { const v = dvItemFor(it); if (v) { at.set(i, list.length); list.push(v); } });
      const i = Number(c.dataset.i); if (at.has(i)) openCardViewer(list, at.get(i)); else toast('Pas d\'aperçu pour cette carte');
    });
    deal();
  });
}
