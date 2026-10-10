/* ── setview.js : page d'une extension (carte « Prochaines extensions » de l'accueil) ──────────────────────────────────────────
   Toucher une extension ouvre ses cartes déjà révélées (Scryfall) : grille d'images, recherche par nom (anglais ou langue des cartes),
   filtres couleur / famille / coût (filters.js), rareté, versions spéciales (sans bordure, vitrine, illustration étendue…), tri (numéro, nom,
   rareté, prix, coût). Toucher une carte : la carte en grand (viewer.js), précédente / suivante, « Liste de souhaits » (l'illustration affichée) ;
   l'étoile d'une vignette ajoute ou retire directement cette illustration. Pastilles : exemplaires de la collection, prix Cardmarket (tendance
   Scryfall) une fois connu. Liens Scryfall et Cardmarket (« Précommander » / « Acheter ») en tête de page.
   Données : /cards/search « e:<code> » (impressions, dans l'ordre de l'extension), plus les mêmes cartes dans la langue des cartes de l'utilisateur
   (nom imprimé et image, quand Scryfall les a déjà), par la file Scryfall de l'appli. Gardées sur l'appareil 6 h pour une extension à venir
   (les révélations arrivent chaque jour), 3 jours sinon ; hors ligne ou Scryfall en pause : la copie plus ancienne sert. */
const SETV = { el: null, row: null, cards: null, list: [], st: '', err: '', f: newFilter(), rar: new Set(), sp: true, sort: 'num', shown: 120, ctrl: null, t: 0 };      // st : '' · 'load' · 'done' · 'err' ; list : cartes affichées (filtrées, triées)
const SETV_KEY = 'setv:v1:', SETV_PAGE = 120, SETV_PAGES = 8, SETV_FRESH = 6 * 3600e3, SETV_OLD = 3 * DAY;
const SETV_RAR = [['mythic', 'Mythiques'], ['rare', 'Rares'], ['uncommon', 'Peu communes'], ['common', 'Communes']];
const SETV_RANK = { mythic: 0, special: 1, bonus: 1, rare: 2, uncommon: 3, common: 4 };
const SETV_SORTS = [['num', 'Numéro'], ['name', 'Nom'], ['rar', 'Rareté'], ['price', 'Prix'], ['cmc', 'Coût']];
const SETV_IMG_RE = /^https:\/\/cards\.scryfall\.io\/[\w./-]+(\?\d+)?$/;

/** Carte Scryfall → ce que la page garde : nom anglais, numéro, rareté, image (normal), versions spéciales, prix, coût, type, couleurs. */
function setvCard(c) {
  const f0 = (c.card_faces && c.card_faces[0]) || {}, iu = c.image_uris || f0.image_uris || {}, fx = Array.isArray(c.frame_effects) ? c.frame_effects : [];
  const tl = String(c.type_line || f0.type_line || ''), k = ownKey(c.name);
  return { n: String(c.name || '').slice(0, 160), k, num: String(c.collector_number || '').slice(0, 12), r: String(c.rarity || ''),
    im: SETV_IMG_RE.test(iu.normal || '') ? iu.normal : '', df: !c.image_uris && Array.isArray(c.card_faces) && c.card_faces.length > 1,
    sp: c.border_color === 'borderless' || fx.includes('showcase') || fx.includes('extendedart') || (!!c.full_art && !/basic land/i.test(tl)) || !!c.promo,
    s: /basic land/i.test(tl) ? 'basic' : '', cm: Number.isFinite(c.cmc) ? c.cmc : 0, tl: tl.slice(0, 120), mc: String(c.mana_cost || f0.mana_cost || '').slice(0, 60),
    cl: (c.colors || f0.colors || []).join(''), ...eurOf(c) };
}
/** Même carte dans la langue des cartes : nom imprimé et image, par numéro de collection. */
function setvLocal(list, sl) {
  const by = new Map();
  for (const c of list) {
    const f0 = (c.card_faces && c.card_faces[0]) || {}, iu = c.image_uris || f0.image_uris || {}, dn = String(c.printed_name || f0.printed_name || '').trim();
    if (c.collector_number && !by.has(c.collector_number)) by.set(c.collector_number, { dn: dn.slice(0, 160), iml: SETV_IMG_RE.test(iu.normal || '') ? iu.normal : '', il: sl });
  }
  return by;
}
/** Toutes les impressions d'une requête (pages de 175), ou [] si Scryfall n'en a aucune (404). */
async function setvSearch(q, signal) {
  let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(q) + '&unique=prints&order=set';
  const out = [];
  for (let p = 0; url && p < SETV_PAGES; p++) {
    let j; try { j = await httpJson(limScry, url, SCRY_JSON, signal, 2); } catch (e) { if (e.code === '404') return out; throw e; }
    for (const c of (j && j.data) || []) if (!c.oversized) out.push(c);
    url = j && j.has_more && /^https:\/\/api\.scryfall\.com\//.test(j.next_page || '') ? j.next_page : null;
  }
  return out;
}
/** Cartes de l'extension : copie de l'appareil si elle est fraîche, sinon Scryfall (et la copie ancienne en secours). */
async function setvLoad(row, signal) {
  const sl = SCRY_LANG[userLang()] || 'en', key = SETV_KEY + row.code + ':' + sl, fresh = row.d >= 0 ? SETV_FRESH : SETV_OLD;
  const hit = await Cache.get(key, 30 * DAY).catch(() => null);
  if (hit && Array.isArray(hit.cards) && Date.now() - hit.at < fresh) return hit.cards;
  try {
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || scryLeft() > 0) throw Object.assign(new Error('pause'), { code: navigator.onLine === false ? 'network' : 'rate' });
    const cards = (await setvSearch('e:' + row.code, signal)).map(setvCard);
    if (sl !== 'en' && cards.length) {
      const loc = setvLocal(await setvSearch('e:' + row.code + ' lang:' + sl, signal).catch(e => { if (e.name === 'AbortError') throw e; return []; }), sl);
      for (const x of cards) { const l = loc.get(x.num); if (l) { if (l.dn && l.dn !== x.n) x.dn = l.dn; if (l.iml) { x.iml = l.iml; x.il = l.il; } } }
    }
    Cache.set(key, { at: Date.now(), cards });
    return cards;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (hit && Array.isArray(hit.cards)) return hit.cards;      // hors ligne, Scryfall en pause : la copie plus ancienne
    throw e;
  }
}

/** Ligne de l'accueil (setsPick) d'une extension, avec sa date relative. */
const setvRow = code => (SETS.list ? setsPick(SETS.list).find(r => r.code === code) || null : null);
const setvWhere = x => [SETV.row.name, SETV.row.code.toUpperCase() + ' ' + x.num].join(' · ');
const setvImg = x => x.iml || x.im;
const setvSame = (a, b) => scrySmall(a).split('?')[0] === scrySmall(b).split('?')[0];
/** État de l'étoile : 'on' (cette illustration est dans la liste de souhaits), 'other' (la carte y est, avec une autre), ''. */
function setvWishState(x) {
  const w = typeof TR !== 'undefined' && TR.wish[x.k]; if (!w) return '';
  return w.i && setvSame(w.i, setvImg(x)) ? 'on' : 'other';
}
/** Étoile d'une vignette : ajoute cette illustration (ou la met à la place d'une autre), ou la retire ; « Annuler » dans le message. */
function setvWish(x) {
  const k = x.k, img = setvImg(x); if (!k || BASIC_NAMES.has(k) || !img) return;
  const name = x.dn || x.n, was = TR.wish[k], same = !!was && !!was.i && setvSame(was.i, img);
  haptic(same ? 'tap' : 'ok');
  const undo = { label: T('Annuler'), fn: () => { if (was) TR.wish[k] = was; else delete TR.wish[k]; trChanged(); } };
  if (same) { delete TR.wish[k]; toast(T('{name} retirée de ta liste de souhaits', { name }), undo); }
  else {
    const where = setvWhere(x);
    TR.wish[k] = { n: x.n, q: was ? was.q : 1, i: img, w: where.slice(0, 90), ...(x.il && x.il !== 'en' ? { l: x.il } : {}) };
    toast(was ? T('Illustration mise à jour dans ta liste de souhaits') : T('{name} ajoutée à ta liste de souhaits ({where})', { name, where }), undo);
  }
  trChanged(); setvPaint();      // l'étoile suit tout de suite (trChanged ne repeint la page qu'en différé)
}

/** Cartes affichées : recherche et filtres, rareté, versions spéciales, puis tri. */
function setvView() {
  const all = (SETV.cards || []).filter(x => (SETV.sp || !x.sp) && (!SETV.rar.size || SETV.rar.has(x.r === 'special' || x.r === 'bonus' ? 'mythic' : x.r)));
  const list = filterItems(all, SETV.f), num = x => parseInt(x.num, 10) || 0, nm = x => x.dn || x.n;
  const by = {
    num: (a, b) => num(a) - num(b) || a.num.localeCompare(b.num),
    name: (a, b) => nm(a).localeCompare(nm(b), LOC()),
    rar: (a, b) => (SETV_RANK[a.r] ?? 5) - (SETV_RANK[b.r] ?? 5) || num(a) - num(b),
    price: (a, b) => (b.eu || 0) - (a.eu || 0) || num(a) - num(b),
    cmc: (a, b) => a.cm - b.cm || num(a) - num(b),
  }[SETV.sort] || ((a, b) => num(a) - num(b));
  return list.slice().sort(by);
}
/** Éléments de la carte en grand pour la liste affichée (image seule ; carte à deux faces : lue sur Scryfall pour pouvoir la retourner). */
const setvItems = list => list.map(x => ({ key: x.k, name: x.dn || x.n, ln: x.n, small: setvImg(x), big: setvImg(x).replace('/normal/', '/large/'), lang: x.il || 'en',
  set: SETV.row.code, num: x.num, setName: SETV.row.name, plain: !x.df }));

function setvTile(x, i) {
  const name = x.dn || x.n, own = collQty(x.k), ws = BASIC_NAMES.has(x.k) ? null : setvWishState(x), img = setvImg(x);
  return `<div class="dvc setv-c" style="--h:${hash32(x.k) % 360}" data-i="${i}">
    <button class="setv-open" type="button" aria-label="${esc(name)}"><span class="dvc-art"><b>${esc((name.trim()[0] || '?').toUpperCase())}</b>${img ? `<img alt="" loading="lazy" decoding="async" src="${esc(img)}">` : `<i>${esc(name)}</i>`}</span></button>
    ${ws === null ? '' : `<button class="setv-star${ws ? ' ' + ws : ''}" type="button" data-act="wish" aria-pressed="${ws === 'on'}" aria-label="${esc(ws === 'on' ? T('Retirer {name} de ta liste de souhaits', { name }) : T('Ajouter {name} à ta liste de souhaits', { name }))}">${ws === 'on' ? '★' : '☆'}</button>`}
    ${own ? `<span class="dvc-q" title="${esc(T('Dans ta collection'))}">× ${own}</span>` : ''}${x.eu ? `<span class="dvc-p">${esc(fmt(x.eu, 'EUR'))}</span>` : ''}</div>`;
}
/** Repeint la page (en-tête, réglages, grille). Le défilement est gardé. */
function setvPaint() {
  const el = SETV.el; if (!el) return;
  const row = SETV.row, all = SETV.cards || [], up = row.d >= 0;
  $('.dv-title span', el).textContent = (up ? T('Sortie le {date}', { date: setsDate(row) }) + ' · ' + setsWhen(row.d) : T('Sortie le {date}', { date: setsDate(row) }));
  const body = $('.setv-grid', el), st = $('.setv-st', el), more = $('.setv-more', el);
  $$('.setv-rar', el).forEach(b => b.setAttribute('aria-pressed', String(SETV.rar.has(b.dataset.r))));
  $('.setv-sp', el).setAttribute('aria-pressed', String(!SETV.sp));
  if (SETV.st !== 'done') {
    body.innerHTML = ''; more.hidden = true; $('.setv-ctl', el).hidden = true;
    st.innerHTML = SETV.st === 'err' ? `<div class="dv-empty"><b>${T('Cartes indisponibles')}</b><p>${esc(SETV.err)}</p><button class="btn ghost" type="button" data-act="retry">${T('Réessayer')}</button></div>`
      : `<p class="hint listempty">${T('Chargement des cartes de l\'extension…')}</p>`;
    return;
  }
  $('.setv-ctl', el).hidden = !all.length;
  if (!all.length) {
    body.innerHTML = ''; more.hidden = true;
    st.innerHTML = `<div class="dv-empty"><b>${T('Aucune carte révélée pour l\'instant')}</b><p>${T('Les cartes apparaissent ici au fil des révélations (Scryfall).')}</p></div>`;
    return;
  }
  const list = setvView(), shown = list.slice(0, SETV.shown);
  SETV.list = list;
  const filtered = list.length !== all.length;
  st.innerHTML = `<p class="hint setv-n">${filtered ? TN(list.length, '{n} carte sur {total}', '{n} cartes sur {total}', { total: nf0(all.length) }) : up ? TN(all.length, '{n} carte révélée', '{n} cartes révélées') : TN(all.length, '{n} carte', '{n} cartes')}</p>`
    + (list.length ? '' : `<p class="hint listempty">${T('Aucune carte ne correspond.')}</p>`);
  body.innerHTML = shown.map(setvTile).join('');
  const left = list.length - shown.length;
  more.hidden = left <= 0; if (left > 0) more.textContent = T('Afficher {a} de plus · {b} restantes', { a: nf0(Math.min(SETV_PAGE, left)), b: nf0(left) });
}
/** Liste de souhaits ou collection changée ailleurs (carte en grand…) : étoiles et pastilles repeintes. */
function setvSoon() { if (SETV.el && SETV.st === 'done') { clearTimeout(SETV.t); SETV.t = setTimeout(setvPaint, 60); } }

async function setvFetchPaint() {
  const el = SETV.el, row = SETV.row; if (!el) return;
  if (SETV.ctrl) SETV.ctrl.abort(); const ctrl = SETV.ctrl = new AbortController();
  SETV.st = 'load'; SETV.err = ''; setvPaint();
  try { SETV.cards = await setvLoad(row, ctrl.signal); SETV.st = 'done'; }
  catch (e) {
    if (e.name === 'AbortError' || SETV.el !== el) return;
    SETV.st = 'err'; SETV.err = e && e.code === 'rate' ? T('Scryfall demande une pause, réessaie dans une minute.') : T('Scryfall injoignable : vérifie ta connexion, puis réessaie.');
  }
  if (SETV.el === el) setvPaint();
}

function closeSetView() { if (SETV.el) SETV.el.__close(); }
/** Ouvre la page d'une extension de l'accueil (code Scryfall). Recherche, filtres et tri repartent de zéro à chaque extension. */
function openSetView(code) {
  const row = setvRow(code); if (!row) return;
  closeSetView();
  Object.assign(SETV, { row, cards: null, st: '', err: '', f: newFilter(), rar: new Set(), sp: true, sort: 'num', shown: SETV_PAGE, list: [] });
  const cm = setsCm(row.name), past = row.d < 0;
  const wrap = document.createElement('div'); wrap.className = 'dv setv'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', row.name);
  wrap.innerHTML = `<header class="dv-head"><button class="icon-btn dv-back" type="button" data-act="close" aria-label="${T('Fermer')}"><svg class="i"><use href="#i-back"/></svg></button>
      <span class="setv-ic" aria-hidden="true">${row.icon ? `<img alt="" decoding="async" src="${esc(row.icon)}">` : ''}</span>
      <div class="dv-title"><b>${esc(row.name)}</b><span></span></div></header>
    <div class="dv-scroll"><div class="dv-body setv-body">
      <div class="setv-links">${cm ? `<a class="btn small" href="${esc(cm)}" target="_blank" rel="noopener">${esc(past ? T('Acheter') : T('Précommander'))} ↗</a>` : ''}<a class="btn ghost small" href="${esc(row.url)}" target="_blank" rel="noopener">Scryfall ↗</a></div>
      <div class="setv-ctl" hidden>
        <div class="setv-f"></div>
        <div class="setv-chips" role="group" aria-label="${T('Rareté')}"><label class="sortsel"><span>${T('Trier')}</span><select class="setv-sort" aria-label="${T('Trier les cartes')}">${SETV_SORTS.map(([v, l]) => `<option value="${v}">${T(l)}</option>`).join('')}</select></label>${SETV_RAR.map(([r, l]) => `<button type="button" class="fopt setv-rar" data-r="${r}" aria-pressed="false"><i class="setv-r ${r}" aria-hidden="true"></i>${T(l)}</button>`).join('')}<button type="button" class="fopt setv-sp" aria-pressed="false">${T('Sans les versions spéciales')}</button></div>
      </div>
      <div class="setv-st"></div>
      <div class="dv-grid setv-grid"></div>
      <button class="btn ghost block setv-more" type="button" hidden></button>
    </div></div>`;
  SETV.el = wrap; const prevFocus = document.activeElement;
  const onKey = e => { if (e.key === 'Escape' && !imgView && !sheets.length && !$$('body > .dv.on').some(x => x !== wrap && wrap.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)) { e.stopPropagation(); wrap.__close(); } };
  wrap.__close = () => {
    if (SETV.el !== wrap) return; SETV.el = null; if (SETV.ctrl) SETV.ctrl.abort(); document.removeEventListener('keydown', onKey, true);
    wrap.classList.remove('on'); setTimeout(() => wrap.remove(), reduceMotion() ? 0 : 240); releaseApp();
    try { if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
  wrap.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);      // image absente : la lettre de la carte reste
  mountFilters($('.setv-f', wrap), SETV.f, () => { SETV.shown = SETV_PAGE; setvPaint(); }, { placeholder: T('Rechercher une carte') });
  $('.setv-sort', wrap).onchange = e => { SETV.sort = e.target.value; SETV.shown = SETV_PAGE; setvPaint(); };
  wrap.addEventListener('click', e => {
    const t = e.target, tile = t.closest('.setv-c'), b = t.closest('button, a');
    if (!b) return;
    if (b.dataset.act === 'close') return wrap.__close();
    if (b.dataset.act === 'retry') return setvFetchPaint();
    if (b.classList.contains('setv-rar')) { const r = b.dataset.r; if (SETV.rar.has(r)) SETV.rar.delete(r); else SETV.rar.add(r); haptic('tap'); SETV.shown = SETV_PAGE; return setvPaint(); }
    if (b.classList.contains('setv-sp')) { SETV.sp = !SETV.sp; haptic('tap'); SETV.shown = SETV_PAGE; return setvPaint(); }
    if (b.classList.contains('setv-more')) { SETV.shown += SETV_PAGE; return setvPaint(); }
    if (!tile) return;
    const i = Number(tile.dataset.i), x = SETV.list[i]; if (!x) return;
    if (b.dataset.act === 'wish') return setvWish(x);
    if (b.classList.contains('setv-open')) openCardViewer(setvItems(SETV.list), i);      // la vignette touchée (.dvc-art) sert de départ à l'agrandissement (motion.js)
  });
  document.body.appendChild(wrap); holdApp(); setvPaint(); setvFetchPaint();
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('on'); $('.dv-back', wrap).focus({ preventScroll: true }); }));
  haptic('tap');
}
