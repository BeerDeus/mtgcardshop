/* ── builder.js : créer un deck dans l'app (Standard ou Commander) ────────────────────────────────
   Écran plein format : onglets Deck · Collection (ajout en priorité) · Chercher (n'importe quelle carte).
   Règles : Standard 60 cartes, 4 exemplaires max (réserve de 15 facultative) ; Commander 100 cartes, une seule de chaque, un commandant.
   Le deck est enregistré comme les autres (texte), puis monté : ses cartes possédées sont réservées. */
/** Infos Scryfall des cartes de decks qui ne sont pas dans la collection ({ eu, ci, cd, im, cm, mc, tl, cl }) : gardées sur l'appareil (prix du deck, couleurs, images, viewer). */
const DM = {}; let dmReady = null;
function dmLoad() {
  if (!dmReady) dmReady = Cache.get('dm:meta', 30 * DAY).then(c => { if (c && typeof c === 'object') for (const k in c) if (!DM[k]) DM[k] = c[k]; renderDecks(); }).catch(() => {});
  return dmReady;
}
const dmSave = () => { Cache.set('dm:meta', DM); };
const dmTried = new Set();
/** Cartes ([{ key, name }], terrains de base compris si basics) dont on ne connaît ni la fiche (collection) ni l'entrée complète du cache (type, coût et couleurs compris), pas encore essayées. */
const dmMissing = (list, basics) => list.filter(c => (basics || !BASIC_NAMES.has(c.key)) && !COLL.meta[c.key] && !(DM[c.key] && DM[c.key].tl !== undefined) && !dmTried.has(c.key)).slice(0, 150);
/** Lit sur Scryfall les cartes pas encore connues ([{ key, name }]) ; retourne vrai si quelque chose est arrivé. */
async function dmFetch(list, basics) {
  const need = dmMissing(list, basics);
  if (!need.length || scryLeft() > 0) return false;
  need.forEach(c => dmTried.add(c.key));
  try { const got = await scryCollection(need.map(c => c.name)); let n = 0; for (const [k, m] of got) if (m) { DM[k] = { eu: m.eu, ci: m.ci, cd: m.cd, im: m.im, cm: m.cm, mc: m.mc, tl: m.tl, cl: m.cl }; n++; } if (n) dmSave(); return n > 0; }
  catch (e) { return false; }      // hors ligne ou limite Scryfall : l'estimation reste partielle
}
const dmOf = k => COLL.meta[k] || DM[k] || null;
const liTried = new Set();
/** Images, dans la langue de l'exemplaire, des cartes possédées de cette liste ([{ key, name }]) : lues sur Scryfall par lots de 12, une seule fois par carte (gardées 60 jours avec celles de la collection).
 *  Déjà connues, déjà tentées, anglaises ou non possédées : rien à lire. Retourne vrai si quelque chose est arrivé. */
async function ownLangFetch(list) {
  const by = {};
  for (const c of list) {
    const k = ownKey(c.key), x = COLL.map[k], l = x && x.q > 0 ? x.l : '';
    if (l && l !== 'en' && SCRY_LANG[l] && !(liKey(l, k) in COLL.li) && !liTried.has(liKey(l, k))) (by[l] = by[l] || new Map()).set(k, c.name);
  }
  const langs = Object.keys(by); if (!langs.length || scryLeft() > 0) return false;
  let n = 0;
  for (const l of langs) {
    const keys = [...by[l].keys()]; keys.forEach(k => liTried.add(liKey(l, k)));
    try { const got = await scryLangImages([...by[l].values()], l, undefined, undefined, true); for (const k of keys) { COLL.li[liKey(l, k)] = got.get(k) || ''; n++; } }
    catch (e) { /* hors ligne ou limite Scryfall : l'image du deck reste */ }
  }
  if (n) collMetaSave();
  return n > 0;
}
/** Valeur estimée d'un texte de deck, en chaîne : « ≈ 84 € » (« ≈ 84 €+ » si des cartes n'ont pas de prix), '' tant que rien n'est lu. */
function dkValueText(v) { return v.known ? `≈ ${fmt(v.cents, 'EUR')}${v.known < v.total ? '+' : ''}` : ''; }
const BD = { el: null, id: null, name: '', fmt: 'standard', cover: '', main: new Map(), side: new Map(), cmdr: [], tab: 'deck', tgt: 'main', q: '', shown: 60, dirty: false, meta: DM, tried: new Set(), cat: null, catErr: '', metaT: 0, issuesOpen: false, idx: null };
const BD_PAGE = 60;
const BD_BASICS = [['plains', 'Plains', 'Plaine'], ['island', 'Island', 'Île'], ['swamp', 'Swamp', 'Marais'], ['mountain', 'Mountain', 'Montagne'], ['forest', 'Forest', 'Forêt']];
const bdMeta = dmOf;
const bdCount = m => { let n = 0; for (const c of m.values()) n += c.qty; return n; };
const bdData = () => ({ fmt: BD.fmt, main: [...BD.main.values()], side: [...BD.side.values()], cmdr: BD.cmdr, cover: BD.cover });
const bdTot = k => ((BD.main.get(k) || {}).qty || 0) + ((BD.side.get(k) || {}).qty || 0);
/** Nom affiché : français si la carte est possédée en français (même règle que la collection), sinon anglais. */
function bdLabel(k, name) { const x = COLL.map[k]; return (x && x.l && frName(k, x.l)) || name; }
const bdCmp = (a, b) => bdLabel(a.key, a.name).localeCompare(bdLabel(b.key, b.name), 'fr', { sensitivity: 'base' });
const bdFmtName = f => (DK_FORMATS[f] || DK_FORMATS.standard).label;

/* ── Nouveau deck : nom + format ──────────────────────────────────────────────────────────────── */
function openDeckNew() {
  openSheet('Nouveau deck', 'Standard ou Commander', api => {
    api.body.innerHTML = `<div class="field-in"><label class="label" for="ndName">Nom</label><input type="text" id="ndName" maxlength="120" autocomplete="off" placeholder="Mon deck" enterkeyhint="go"></div>
      <div class="seg" id="ndFmt" role="radiogroup" aria-label="Format"></div>
      <p class="hint" id="ndHint"></p>`;
    api.setFoot('<button class="btn ghost" type="button" data-close>Annuler</button><button class="btn" type="button" id="ndGo">Créer</button>');
    const seg = $('#ndFmt', api.body), hint = $('#ndHint', api.body), name = $('#ndName', api.body);
    const paint = () => { const f = DK_FORMATS[seg._v || 'standard']; hint.textContent = f.hint; };
    mountSeg(seg, [{ v: 'standard', label: 'Standard' }, { v: 'commander', label: 'Commander' }], 'standard', paint); paint();
    const go = () => { const fmt = seg._v || 'standard'; api.close(); setTimeout(() => openBuilder({ name: name.value.trim(), fmt }), 200); };
    $('#ndGo', api.foot).onclick = go; name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    setTimeout(() => name.focus(), 380);
  });
}

/* ── Ouverture ────────────────────────────────────────────────────────────────────────────────── */
/** Ouvre l'éditeur : un nouveau deck { name, fmt } ou un deck enregistré { id }. */
function openBuilder(o) {
  if (BD.el) return;
  const prev = o.id ? findDeck(o.id) : null;
  Object.assign(BD, { id: prev ? prev.id : null, name: prev ? prev.name : (o.name || ''), tab: 'deck', tgt: 'main', q: '', shown: BD_PAGE, dirty: false, issuesOpen: false, idx: null, main: new Map(), side: new Map(), cmdr: [], cover: '' });
  if (prev) {
    const p = dkParse(prev.text);
    BD.fmt = p.fmt || (p.cmdr.length || p.main.reduce((a, c) => a + c.qty, 0) >= 99 ? 'commander' : 'standard');
    p.main.forEach(c => BD.main.set(c.key, c)); p.side.forEach(c => BD.side.set(c.key, c)); BD.cmdr = p.cmdr; BD.cover = p.cover;      // la carte de présentation choisie est gardée
    if (BD.fmt === 'commander') BD.side.clear();      // pas de réserve en Commander
  } else BD.fmt = o.fmt === 'commander' ? 'commander' : 'standard';
  collFrLoad();
  const wrap = document.createElement('div'); wrap.className = 'dv bd'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Créateur de deck');
  wrap.innerHTML = `<header class="dv-head"><button class="icon-btn dv-back" type="button" data-act="close" aria-label="Fermer"><svg class="i"><use href="#i-back"/></svg></button>
      <div class="dv-title"><b id="bdTitle"></b><span id="bdSub"></span></div>
      <button class="btn small bd-save" type="button" data-act="save" id="bdSave">Enregistrer</button></header>
    <div class="dv-scroll"><div class="dv-body bd-body">
      <div class="bd-sum" id="bdSum"></div>
      <div class="seg" id="bdSeg" role="tablist" aria-label="Contenu"></div>
      <div class="bd-ctl" id="bdCtl"></div>
      <div class="bd-list" id="bdList"></div></div></div>`;
  BD.el = wrap; const prevFocus = document.activeElement;
  const onKey = e => { if (e.key === 'Escape' && !sheets.length && !imgView) { e.stopPropagation(); bdClose(); } };
  wrap.__close = () => {
    if (BD.el !== wrap) return; BD.el = null; clearTimeout(BD.metaT); document.removeEventListener('keydown', onKey, true);
    wrap.classList.remove('on'); setTimeout(() => wrap.remove(), reduceMotion() ? 0 : 240); releaseApp();
    try { if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
  wrap.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  mountSeg($('#bdSeg', wrap), [{ v: 'deck', label: 'Deck' }, { v: 'coll', label: 'Collection' }, { v: 'find', label: 'Chercher' }], 'deck', bdTab);
  wrap.addEventListener('click', bdClick);
  wrap.addEventListener('input', e => {
    if (e.target.id === 'bdName') { BD.name = e.target.value; BD.dirty = true; bdHead(); }
    else if (e.target.id === 'bdQ') { BD.q = e.target.value; BD.shown = BD_PAGE; bdList(); }
  });
  wrap.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'bdName') { e.preventDefault(); e.target.blur(); } });
  document.body.appendChild(wrap); holdApp();
  bdTab('deck'); bdPaint(); bdMetaSoon();
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('on'); $('.dv-back', wrap).focus({ preventScroll: true }); }));
  haptic('tap');
}
function bdClose(force) {
  if (!BD.el) return;
  if (!force && BD.dirty) {
    openSheet('Quitter sans enregistrer ?', null, api => {
      api.body.innerHTML = '<p class="hint">Les changements de ce deck seront perdus.</p>';
      api.setFoot('<button class="btn ghost" type="button" data-close>Continuer</button><button class="btn danger" type="button" id="bdLeave">Quitter</button>');
      $('#bdLeave', api.foot).onclick = () => { api.close(); bdClose(true); };
    });
    return;
  }
  BD.el.__close();
}

/* ── Données de la carte (couleurs, image) : collection d'abord, sinon Scryfall ───────────────── */
function bdMetaSoon() {
  clearTimeout(BD.metaT); BD.metaT = setTimeout(bdMetaLoad, 700);
}
async function bdMetaLoad() {
  if (!BD.el) return;
  const list = [...BD.main.values(), ...BD.cmdr, ...(BD.want || [])];
  if (await dmFetch(list) && BD.el) bdPaint();
}

/* ── Modifications ────────────────────────────────────────────────────────────────────────────── */
/** Ajoute (d = 1) ou retire (d = −1) un exemplaire de la carte k dans la zone tgt (main · side · cmdr). Retourne false si la règle du format l'interdit. */
function bdChange(tgt, k, name, d) {
  const f = DK_FORMATS[BD.fmt];
  if (tgt === 'cmdr') {
    const i = BD.cmdr.findIndex(c => c.key === k);
    if (d > 0) {
      if (i >= 0) return false;
      if (BD.cmdr.length >= 2) { toast('Deux commandants au maximum (partenaires)'); haptic('warn'); return false; }
      BD.cmdr.push({ key: k, name }); BD.main.delete(k);
    } else if (i >= 0) BD.cmdr.splice(i, 1); else return false;
  } else {
    const m = BD[tgt], cur = m.get(k), q = cur ? cur.qty : 0;
    if (q + d < 0) return false;
    if (d > 0) {
      if (BD.cmdr.some(c => c.key === k)) { toast('Cette carte est déjà ton commandant'); haptic('warn'); return false; }
      if (!BASIC_NAMES.has(k) && bdTot(k) + 1 > f.copies) { toast(f.copies === 1 ? 'Commander : un seul exemplaire de chaque carte' : `${f.copies} exemplaires au maximum (deck et réserve)`); haptic('warn'); return false; }
      if (tgt === 'side' && bdCount(BD.side) + 1 > f.side) { toast(`Réserve : ${f.side} cartes au maximum`); haptic('warn'); return false; }
    }
    if (q + d === 0) m.delete(k); else m.set(k, { key: k, name: cur ? cur.name : name, qty: q + d });
  }
  BD.dirty = true; bdPaint(); bdMetaSoon(); return true;
}

/* ── Affichage ────────────────────────────────────────────────────────────────────────────────── */
function bdHead() {
  const el = BD.el; if (!el) return;
  const ck = dkCheck(BD.fmt, bdData(), bdMeta);
  $('#bdTitle', el).textContent = BD.name.trim() || 'Nouveau deck';
  $('#bdSub', el).textContent = `${bdFmtName(BD.fmt)} · ${ck.n}/${ck.size}`;
  const sv = $('#bdSave', el), need = !ck.n || (BD.fmt === 'commander' && !BD.cmdr.length);
  sv.disabled = need; sv.title = need ? (BD.fmt === 'commander' && !BD.cmdr.length ? 'Choisis un commandant' : 'Ajoute des cartes') : '';
}
function bdSumHtml() {
  const ck = dkCheck(BD.fmt, bdData(), bdMeta), pct = Math.max(0, Math.min(100, Math.round(ck.n / ck.size * 100)));
  const st = ck.n === ck.size ? 'full' : ck.n > ck.size ? 'over' : '';
  const bad = ck.issues.filter(i => i.lv === 'bad').length;
  const list = BD.issuesOpen ? ck.issues : ck.issues.slice(0, 3);
  const val = dkValueText(dkValue(dkBuildText(bdData()), dmOf));
  return `<div class="bd-top"><div class="bd-count ${st}"><b>${nf0(ck.n)}</b><span>/ ${ck.size} cartes</span></div>${val ? `<div class="bd-val" title="Prix tendance Cardmarket, cartes possédées comprises, terrains de base exclus">${esc(val)}</div>` : ''}${BD.fmt === 'standard' ? `<div class="bd-side${ck.side > DK_FORMATS.standard.side ? ' over' : ''}"><b>${nf0(ck.side)}</b><span>/ ${DK_FORMATS.standard.side} en réserve</span></div>` : ''}</div>
    <div class="bd-bar ${st}"><i style="width:${pct}%"></i></div>
    ${ck.issues.length ? `<ul class="bd-issues">${list.map(i => `<li class="${i.lv}">${esc(i.t)}</li>`).join('')}</ul>${ck.issues.length > 3 ? `<button class="link-btn link-inline" type="button" data-act="issues">${BD.issuesOpen ? 'Réduire' : `Voir les ${ck.issues.length - 3} autres alertes`}</button>` : ''}`
      : '<p class="bd-ok">Deck complet et conforme.</p>'}`;
}
/** Pastilles d'une carte : possédée ou non, engagée ailleurs. ctx : 'deck' (rangée du deck) · 'coll' / 'find' (liste de cartes à ajouter). */
function bdTags(k, q, ctx) {
  if (BASIC_NAMES.has(k)) return '';
  const own = collQty(k), eg = engTotal(XS.eng, k, BD.id), out = [];
  if (ctx !== 'deck' && BD.cmdr.some(c => c.key === k)) out.push('<span class="tag accent">Commandant</span>');
  if (ctx === 'deck') out.push(own >= q ? '<span class="tag good">Possédée</span>' : own > 0 ? `<span class="tag warn">${own} possédée${own > 1 ? 's' : ''} sur ${q}</span>` : '<span class="tag">À acheter</span>');
  else out.push(own ? `<span class="tag good">× ${own} possédée${own > 1 ? 's' : ''}</span>` : '<span class="tag">Pas dans ta collection</span>');
  if (own && eg) out.push(`<span class="tag warn" title="Réservées par un autre deck complet">${eg} engagée${eg > 1 ? 's' : ''} ailleurs</span>`);
  return out.join('');
}
function bdRow(k, name, q, tgt, ctx, label) {
  const x = COLL.map[k], m = bdMeta(k), l = x ? x.l : '', nm = label || bdLabel(k, name), hue = hash32(k) % 360, letter = esc((nm.trim()[0] || '?').toUpperCase());
  const img = m && m.im ? collImage(k, l, m.im).src : '', tags = bdTags(k, q, ctx);
  return `<div class="crow bd-row" data-k="${esc(k)}" data-n="${esc(name)}" data-t="${tgt}"><span class="thumb" style="--h:${hue}">${letter}${img ? `<img alt="" loading="lazy" decoding="async" src="${esc(img)}">` : ''}</span>
    <span class="row-main"><span class="row-top"><span class="row-name">${esc(nm)}</span></span>${tags ? `<span class="row-meta">${tags}</span>` : ''}</span>
    <span class="qstep"><button type="button" data-d="-1" aria-label="Retirer un exemplaire de ${esc(nm)}">−</button><b>${q}</b><button type="button" data-d="1" aria-label="Ajouter un exemplaire de ${esc(nm)}">+</button></span></div>`;
}
function bdDeckHtml() {
  const mainAll = [...BD.main.values()], basicKeys = new Set(BD_BASICS.map(b => b[0]));
  const spells = mainAll.filter(c => !BASIC_NAMES.has(c.key)).sort(bdCmp), others = mainAll.filter(c => BASIC_NAMES.has(c.key) && !basicKeys.has(c.key)).sort(bdCmp);
  let h = '';
  if (BD.fmt === 'commander') {
    h += `<div class="sec-title">Commandant${BD.cmdr.length > 1 ? 's' : ''}</div>`;
    h += BD.cmdr.length ? BD.cmdr.map(c => bdRow(c.key, c.name, 1, 'cmdr', 'deck')).join('') : '<button class="btn ghost small" type="button" data-act="pick-cmdr" style="align-self:flex-start">Choisir un commandant</button>';
  }
  h += `<div class="sec-title">Deck · ${nf0(bdCount(BD.main))}</div>`;
  h += spells.length ? spells.map(c => bdRow(c.key, c.name, c.qty, 'main', 'deck')).join('') : '<p class="hint">Ajoute des cartes depuis « Collection » (les tiennes) ou « Chercher » (toutes les cartes).</p>';
  h += `<div class="sec-title">Terrains de base · ${nf0(mainAll.filter(c => BASIC_NAMES.has(c.key)).reduce((a, c) => a + c.qty, 0))}</div>`;
  h += BD_BASICS.map(([k, en, fr]) => bdRow(k, en, (BD.main.get(k) || {}).qty || 0, 'main', 'deck', fr)).join('') + others.map(c => bdRow(c.key, c.name, c.qty, 'main', 'deck')).join('');
  if (BD.fmt === 'standard') {
    const side = [...BD.side.values()].sort(bdCmp);
    h += `<div class="sec-title">Réserve · ${nf0(bdCount(BD.side))} <span class="bd-opt">facultative</span></div>`;
    h += side.length ? side.map(c => bdRow(c.key, c.name, c.qty, 'side', 'deck')).join('') : '<p class="hint">Jusqu\'à 15 cartes. Choisis « Réserve » dans l\'onglet Collection ou Chercher.</p>';
  }
  return h;
}
function bdIndex() {
  if (BD.idx) return BD.idx;
  return (BD.idx = Object.entries(COLL.map).map(([k, x]) => { const dn = (x.l && frName(k, x.l)) || ''; return { k, n: x.n, dn, s: normPart(x.n + ' ' + dn + ' ' + frOf(k)) }; })
    .sort((a, b) => (a.dn || a.n).localeCompare(b.dn || b.n, 'fr', { sensitivity: 'base' })));
}
function bdAddRow(k, name, label) {
  const tgt = BD.tgt, q = tgt === 'cmdr' ? (BD.cmdr.some(c => c.key === k) ? 1 : 0) : ((BD[tgt].get(k) || {}).qty || 0);
  return bdRow(k, name, q, tgt, 'coll', label);
}
function bdCollHtml() {
  if (!collCount()) return '<div class="deck-empty">Ta collection est vide. Utilise « Chercher » pour ajouter n\'importe quelle carte au deck.</div>';
  const words = normPart(BD.q).split(' ').filter(Boolean);
  let items = bdIndex().filter(it => words.every(w => it.s.includes(w)));
  if (BD.tgt === 'cmdr') items = items.filter(it => (COLL.meta[it.k] || {}).cd);
  const shown = items.slice(0, BD.shown);
  let h = BD.tgt === 'cmdr' ? '<p class="hint">Les cartes de ta collection qui peuvent être commandant.' + (COLL.enrich ? ' Lecture des cartes en cours…' : '') + '</p>' : '';
  h += shown.map(it => bdAddRow(it.k, it.n, it.dn)).join('');
  if (!items.length) h += `<p class="hint">${words.length ? 'Aucune carte de ta collection ne correspond.' : BD.tgt === 'cmdr' ? 'Aucun commandant possible dans ta collection (ou cartes pas encore lues).' : ''}</p>`;
  if (items.length > shown.length) h += `<button class="link-btn more-decks" type="button" data-act="more">Afficher ${Math.min(BD_PAGE, items.length - shown.length)} cartes de plus (${nf0(items.length - shown.length)} restantes)</button>`;
  return h;
}
function bdFindHtml() {
  if (BD.catErr) return `<div class="status" data-ok="0"><span class="dot"></span><span>${esc(BD.catErr)}</span></div>`;
  if (!BD.cat) return '<div class="status" data-ok="0"><span class="dot"></span><span>Chargement du catalogue (une seule fois)…</span></div>';
  const q = BD.q.trim();
  if (q.length < 2) return '<p class="hint">Tape au moins 2 lettres du nom (anglais) : toutes les cartes Magic sont cherchables ici.</p>';
  const sug = collSuggest(BD.cat, q, 20); BD.want = sug.map(n => ({ key: ownKey(n), name: n })); bdMetaSoon();
  return sug.map(n => bdAddRow(ownKey(n), n)).join('') || '<p class="hint">Aucune carte de ce nom. Vérifie l\'orthographe (nom anglais).</p>';
}
function bdList() {
  const el = BD.el; if (!el) return;
  $('#bdList', el).innerHTML = BD.tab === 'deck' ? bdDeckHtml() : BD.tab === 'coll' ? bdCollHtml() : bdFindHtml();
}
function bdPaint() {
  const el = BD.el; if (!el) return;
  bdHead(); $('#bdSum', el).innerHTML = bdSumHtml(); bdList();
}
/** Changement d'onglet : contrôles (nom · cible + recherche) puis liste. */
function bdTab(v) {
  const el = BD.el; if (!el) return;
  BD.tab = v; BD.q = ''; BD.shown = BD_PAGE;
  const ctl = $('#bdCtl', el); $('#bdSeg', el).setValue(v);
  if (v === 'deck') ctl.innerHTML = `<div class="field-in"><label class="label" for="bdName">Nom du deck</label><input type="text" id="bdName" maxlength="120" autocomplete="off" placeholder="Mon deck" value="${esc(BD.name)}"></div>`;
  else {
    const opts = BD.fmt === 'commander' ? [{ v: 'main', label: 'Deck' }, { v: 'cmdr', label: 'Commandant' }] : [{ v: 'main', label: 'Deck' }, { v: 'side', label: 'Réserve' }];
    if (!opts.some(o => o.v === BD.tgt)) BD.tgt = 'main';
    ctl.innerHTML = `<div class="bd-add"><span>Ajouter au</span><div class="seg" id="bdTgt" role="radiogroup" aria-label="Ajouter au"></div></div>
      <div class="field-in"><label class="label" for="bdQ">${v === 'coll' ? 'Chercher dans ma collection' : 'Nom de la carte'}</label><input type="text" id="bdQ" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${v === 'coll' ? 'Nom français ou anglais' : 'Sol Ring'}" enterkeyhint="search"></div>`;
    mountSeg($('#bdTgt', ctl), opts, BD.tgt, t => { BD.tgt = t; BD.shown = BD_PAGE; bdList(); });
    if (v === 'find' && !BD.cat && !BD.catErr) collCatalog().then(c => { BD.cat = c; if (BD.el && BD.tab === 'find') bdList(); }).catch(e => { BD.catErr = e && e.code === 'rate' ? 'Scryfall demande une pause, réessaie dans une minute.' : 'Catalogue Scryfall injoignable : réessaie plus tard.'; if (BD.el && BD.tab === 'find') bdList(); });
    if (v === 'coll') { BD.idx = null; if ((collMissing().length || collLangMissingCount()) && !COLL.enrichErr) collEnrich(); }
  }
  bdList();
  const sc = $('.dv-scroll', el); if (sc) sc.scrollTop = 0;
}

/** Carte d'une rangée de l'éditeur pour la visionneuse (appui sur sa vignette) : image dans la langue possédée si Scryfall l'a donnée, sinon anglaise. */
function bdViewItem(row) {
  const k = row.dataset.k, m = bdMeta(k); if (!m || !m.im) return null;
  const x = COLL.map[k], l = x ? x.l : '', im = collImage(k, l, m.im), own = collQty(k);
  return { key: k, lid: k + '|' + row.dataset.t, name: bdLabel(k, row.dataset.n), ln: row.dataset.n, wl: viewLang(k, true), small: im.src, lang: im.lang, plain: true,
    extra: `${own ? own + ' exemplaire' + (own > 1 ? 's' : '') + ' dans ta collection' : 'Pas dans ta collection'}${Number.isFinite(m.eu) ? ' · réf. Cardmarket ' + fmt(m.eu, 'EUR') : ''}` };
}

/* ── Interactions ─────────────────────────────────────────────────────────────────────────────── */
function bdClick(e) {
  const st = e.target.closest('.qstep button[data-d]');
  if (st) {
    const row = st.closest('.bd-row'); if (!row) return;
    const d = Number(st.dataset.d), k = row.dataset.k, tgt = row.dataset.t;
    if (bdChange(tgt, k, row.dataset.n, d)) haptic('tap');
    return;
  }
  const th = e.target.closest('.thumb');
  if (th && th.querySelector('img.ok')) {
    const rows = $$('.bd-row', BD.el), list = rows.map(bdViewItem), row = th.closest('.bd-row'), i = rows.indexOf(row);
    if (i >= 0 && list[i]) { const L = list.filter(Boolean); openCardViewer(L, L.indexOf(list[i])); }
    return;
  }
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'close') bdClose();
  else if (act === 'save') bdSave();
  else if (act === 'issues') { BD.issuesOpen = !BD.issuesOpen; bdPaint(); }
  else if (act === 'more') { BD.shown += BD_PAGE; bdList(); }
  else if (act === 'pick-cmdr') { BD.tgt = 'cmdr'; $('#bdSeg', BD.el).setValue('coll'); bdTab('coll'); haptic('tap'); }
}

/* ── Enregistrement : comme un deck normal, puis monté ────────────────────────────────────────── */
function bdSave() {
  const ck = dkCheck(BD.fmt, bdData(), bdMeta);
  if (!ck.n) { toast('Ajoute d\'abord des cartes'); return; }
  if (BD.fmt === 'commander' && !BD.cmdr.length) { toast('Choisis d\'abord un commandant'); return; }
  readOpts();
  const prev = BD.id ? findDeck(BD.id) : null, text = dkBuildText(bdData());
  const name = BD.name.trim().slice(0, 120) || (prev && prev.name) || ('Deck ' + bdFmtName(BD.fmt));
  const doc = deckDoc({ name, text, opts: prev ? prev.opts : S.opts, history: prev ? prev.history : [], snap: prev && prev.snap, createdAt: prev && prev.createdAt });
  const id = prev ? prev.id : newIdFor();
  putDeck(id, doc);
  let reserved = 0;
  if (prev) engRefresh(id, name, text);                                   // deck déjà monté : ses cartes réservées suivent la liste
  else { const q = engSnapshot(text, collQty); reserved = Object.values(q).reduce((a, x) => a + x, 0); if (reserved) engSet(id, name, text); }      // nouveau deck : monté automatiquement
  if (S.deckId === id) { $('#deckText').value = text; refreshDeck(); updateSaveButtons(); }
  const nb = ck.issues.filter(i => i.lv === 'bad' || i.lv === 'warn').length;
  bdClose(true); haptic('ok');
  const msg = prev ? 'Deck mis à jour' : `Deck créé${reserved ? ` · ${nf0(reserved)} carte${reserved > 1 ? 's' : ''} réservée${reserved > 1 ? 's' : ''} de ta collection` : ''}`;
  toast(nb && !prev ? msg + ' · incomplet' : msg, { label: 'Ouvrir', fn: () => loadDeck(id) });
}
