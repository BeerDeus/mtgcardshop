/* ── app.js : interface ─────────────────────────────────────────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
// Noms des langues de cartes, déjà traduits (« français » / « French ») : on les insère dans des phrases traduites (T('Offres en {lang}', …)).
const LANGS = { fr: T('français'), en: T('anglais'), de: T('allemand'), es: T('espagnol'), it: T('italien'), pt: T('portugais'), jp: T('japonais'), 'zh-CN': T('chinois') };
const FLAGS = {
  fr: '<rect width="8" height="16" fill="#0055A4"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#EF4135"/>',
  en: '<rect width="24" height="16" fill="#012169"/><path d="M0 0L24 16M24 0L0 16" stroke="#fff" stroke-width="3.2"/><path d="M0 0L24 16M24 0L0 16" stroke="#C8102E" stroke-width="1.1"/><path d="M12 0V16M0 8H24" stroke="#fff" stroke-width="5.4"/><path d="M12 0V16M0 8H24" stroke="#C8102E" stroke-width="3.2"/>',
  de: '<rect width="24" height="5.4" fill="#000"/><rect y="5.3" width="24" height="5.4" fill="#DD0000"/><rect y="10.6" width="24" height="5.4" fill="#FFCE00"/>',
  es: '<rect width="24" height="16" fill="#AA151B"/><rect y="4" width="24" height="8" fill="#F1BF00"/>',
  it: '<rect width="8" height="16" fill="#009246"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#CE2B37"/>',
  pt: '<rect width="24" height="16" fill="#FF0000"/><rect width="9.6" height="16" fill="#006600"/><circle cx="9.6" cy="8" r="2.7" fill="#FFCC29" stroke="#fff" stroke-width=".6"/>',
  jp: '<rect width="24" height="16" fill="#fff"/><circle cx="12" cy="8" r="4.7" fill="#BC002D"/>',
  'zh-CN': '<rect width="24" height="16" fill="#DE2910"/><polygon points="4.20,1.30 4.85,3.30 6.96,3.30 5.25,4.54 5.90,6.55 4.20,5.31 2.50,6.55 3.15,4.54 1.44,3.30 3.55,3.30" fill="#FFDE00"/><polygon points="7.59,2.10 8.04,1.57 7.67,0.99 8.31,1.25 8.76,0.72 8.71,1.41 9.35,1.67 8.68,1.83 8.63,2.52 8.26,1.94" fill="#FFDE00"/><polygon points="9.06,3.70 9.69,3.42 9.62,2.73 10.08,3.25 10.71,2.97 10.36,3.56 10.82,4.08 10.15,3.93 9.80,4.53 9.73,3.84" fill="#FFDE00"/><polygon points="9.10,5.89 9.79,5.90 10.02,5.25 10.22,5.91 10.91,5.92 10.34,6.32 10.54,6.98 9.99,6.56 9.43,6.96 9.65,6.31" fill="#FFDE00"/><polygon points="7.70,7.36 8.33,7.64 8.79,7.13 8.71,7.82 9.34,8.10 8.67,8.24 8.60,8.93 8.25,8.33 7.58,8.47 8.04,7.96" fill="#FFDE00"/>',
};
/** Drapeau de la langue d'une carte (pas du pays du vendeur). */
function flag(lang) {
  const g = FLAGS[lang]; const name = LANGS[lang] || lang || '?';
  return g ? `<svg class="flag" viewBox="0 0 24 16" role="img" aria-label="${esc(name)}"><title>${esc(name)}</title>${g}</svg>` : `<span class="flag-x">${esc(String(lang || '?').toUpperCase())}</span>`;
}
/** Pastille langue : drapeau seul si c'est la langue demandée, drapeau + code en orange si c'est un repli. */
function langTag(lang) {
  if (!lang) return '';
  const diff = lang !== S.opts.lang;
  return `<span class="tag lang${diff ? ' warn' : ''}">${flag(lang)}${diff ? esc(String(lang).toUpperCase()) : ''}</span>`;
}

const SAMPLE = `1 Cloud, Midgar Mercenary
1 Aang, the Last Airbender
1 Angel of the Ruins
1 Appa, Steadfast Guardian
1 Aven Interrupter
1 Cloister Gargoyle
1 Curious Colossus
1 Esper Sentinel
1 Felidar Guardian
1 Flickering Hound
1 Flickerwisp
1 Giver of Runes
1 Glorious Protector
1 Goliath Paladin
1 Guardian of Ghirapur
1 Guide of Souls
1 Icewind Stalwart
1 Karmic Guide
1 Kíli the Resourceful
1 Loran of the Third Path
1 Moonshaker Cavalry
1 Mother of Runes
1 Nadaar, Selfless Paladin
1 Phelia, Exuberant Shepherd
1 Radiant Solar
1 Ranger's Hawk
1 Recruiter of the Guard
1 Restoration Angel
1 Seasoned Dungeoneer
1 Skyclave Apparition
1 Summon: Yojimbo
1 Sun Titan
1 Tataru Taru
1 Voice of Victory
1 White Plume Adventurer
1 Witch Enchanter
1 Abandoned Air Temple
1 Buried Ruin
1 Eiganjo, Seat of the Empire
1 Emeria, the Sky Ruin
1 Ishgard, the Holy See
1 Minas Tirith
1 Monumental Henge
25 Plains
1 Scavenger Grounds
1 Arcane Signet
1 Delver's Torch
1 Fellwar Stone
1 Liquimetal Torque
1 Panharmonicon
1 Pearl Medallion
1 Sarevok's Tome
1 Sol Ring
1 Springleaf Drum
1 Sword of Fire and Ice
1 Sword of Hearth and Home
1 Sword of Light and Shadow
1 Trailblazer's Torch
1 Avatar's Wrath
1 Emeria's Call
1 Ondu Inversion
1 Winds of Abandon
1 Bilbo's Gambit
1 Clever Concealment
1 Cosmic Intervention
1 Ephemerate
1 Flare of Fortitude
1 Get Lost
1 Path to Exile
1 Razorgrass Ambush
1 Reprieve
1 Restoration Magic
1 Sejiri Shelter
1 Swords to Plowshares
1 Sigarda's Aid
1 Teleportation Circle`;

/* ── État ─────────────────────────────────────────────────────────────────────────────────── */
const S = {
  demo: true, demoPref: null, src: 'auto', proxy: false, token: '', appKey: '', theme: 'auto', draft: null,
  opts: { lang: 'fr', cond: 'Slightly Played', foil: 'no', mode: 'zero', ship: 280, fallbackEn: true },
  deck: { cards: [], basics: [], lines: 0, ignored: 0, copies: 0, basicCopies: 0 },
  view: 'home', tab: 'cards', run: null, res: null, fo: {}, overrides: {}, cur: 'EUR', isSample: false, wake: null, deckId: null, runDelta: null,
  enBusy: null, enCtrl: null, gone: new Set(), haptic: true, sort: 'deck', filter: 'all', removed: [], useColl: true, push: false,
};
let runSeq = 0;
/** Critères qui fixent les prix lus : s'ils changent après la recherche, les prix gardés ne correspondent plus. */
const critSig = () => [S.opts.lang, S.opts.cond, S.opts.foil].join('|');
const ownSig = () => { const n = S.deck.cards.reduce((a, c) => a + (c.own || 0), 0); return n ? '|o' + n : ''; };
/** Signature d'une recherche pour comparer l'historique : critères + cartes déjà possédées (le total change si la collection change). */
const curSig = () => critSig() + ownSig();
const deckLabel = () => { const d = findDeck(S.deckId); return d ? d.name : suggestName($('#deckText').value); };

function loadStore() { try { return JSON.parse(localStorage.getItem('deckdeal:v1') || '{}'); } catch (e) { return {}; } }
function saveStore() {
  try {
    localStorage.setItem('deckdeal:v1', JSON.stringify({ opts: S.opts, src: S.src, token: S.token, appKey: S.appKey, theme: S.theme, haptic: S.haptic, sort: S.sort, useColl: S.useColl, push: S.push, demoPref: S.demoPref, draft: S.isSample ? null : $('#deckText').value }));
  } catch (e) { /* stockage indisponible */ }
}

/* ── Retour haptique (Android/Chrome ; iOS ne l'expose pas) ──────────────────────────────────── */
const HAP = { tap: 8, ok: [14, 50, 14], warn: [26, 60, 26], bad: [70, 50, 70] };
function haptic(kind = 'tap') {
  if (!S.haptic || reduceMotion()) return;
  try { if (navigator.vibrate) navigator.vibrate(HAP[kind] || HAP.tap); } catch (e) { /* refusé : sans importance */ }
}

/* ── Utilitaires UI ───────────────────────────────────────────────────────────────────────── */
const fmtCache = {};
function fmt(c, cur) {
  cur = cur || S.cur || 'EUR';
  const f = fmtCache[cur] || (fmtCache[cur] = new Intl.NumberFormat(LOC(), { style: 'currency', currency: cur }));
  return f.format(c / 100);
}
function tween(el, to) {
  const from = el._v == null ? 0 : el._v; el._v = to;
  if (reduceMotion() || from === to) { cancelAnimationFrame(el._raf); delete el.dataset.tw; el.textContent = fmt(to); return; }
  const t0 = performance.now(), d = 620; cancelAnimationFrame(el._raf); el.dataset.tw = '1';      // data-tw : le chiffre défile encore
  const step = now => {
    const p = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) el._raf = requestAnimationFrame(step); else delete el.dataset.tw;
  };
  el._raf = requestAnimationFrame(step);
}
let toastT;
/** act : { label, fn } → bouton dans le toast (ex. Annuler), affiché plus longtemps. */
function toast(msg, act) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('act', !!act);
  if (act) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = act.label;
    b.onclick = () => { t.classList.remove('on'); clearTimeout(toastT); act.fn(); };
    t.appendChild(b);
  }
  t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), act ? 6500 : 2700);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(T('Copié')); return; } catch (e) { /* repli */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand && document.execCommand('copy'); ta.remove();
    toast(ok ? T('Copié') : T('Copie impossible, sélectionne le texte à la main'));
  } catch (e) { toast(T('Copie impossible')); }
}
async function lockScreen() { try { S.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* refusé */ } }
function unlockScreen() { try { if (S.wake) S.wake.release(); } catch (e) { /* ignore */ } S.wake = null; }

function mountSeg(root, options, value, onChange) {
  root.style.setProperty('--n', options.length);
  root.innerHTML = '<span class="seg-thumb"></span>' + options.map(o =>
    `<button type="button" class="seg-opt" role="radio" aria-checked="false" data-v="${esc(o.v)}"><span>${esc(o.label)}</span>${o.sub != null ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join('');
  const set = (v, fire) => {
    const i = Math.max(0, options.findIndex(o => o.v === v));
    root.style.setProperty('--idx', i);
    $$('.seg-opt', root).forEach((b, k) => b.setAttribute('aria-checked', String(k === i)));
    root._v = options[i].v;
    if (fire) haptic('tap');
    if (fire && onChange) onChange(options[i].v);
  };
  root.onclick = e => { const b = e.target.closest('.seg-opt'); if (b) set(b.dataset.v, true); };
  root.setValue = v => set(v, false);
  root.setLabel = (v, t) => { const n = $(`.seg-opt[data-v="${v}"] span`, root); if (n) n.textContent = t; };
  root.setSub = (v, t) => { const n = $(`.seg-opt[data-v="${v}"] small`, root); if (n) n.textContent = t; };
  set(value, false);
}

/* ── Sheets ───────────────────────────────────────────────────────────────────────────────── */
const sheets = [];

/* ── Pastilles flottantes : une tâche longue reste visible quand son écran d'origine ne l'est plus ── */
const floaters = new Set(), seen = new Map();
const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => { for (const e of es) seen.set(e.target, e.isIntersecting); syncFloat(); }) : null;
function watchSeen(el) { if (io && el && !seen.has(el)) { seen.set(el, true); io.observe(el); } }
const isSeen = el => seen.get(el) !== false;
/** rule() : true = la pastille doit s'afficher. Réévaluée à chaque ouverture/fermeture de feuille et changement de visibilité. */
function floatTask(label, o, rule) {
  const t = Tasks.start(label, { ...o, hidden: true });
  const f = { t, sync() { if (t.done) floaters.delete(f); else t.show(!!rule()); } };
  floaters.add(f); f.sync();
  return t;
}
function syncFloat() { for (const f of [...floaters]) f.sync(); Tasks.layout(); }

/** Glisser la poignée ou l'en-tête vers le bas ferme la feuille (téléphone) : elle suit le doigt, part si on l'a tirée assez loin ou assez vite, sinon revient. */
function sheetDrag(wrap, api) {
  const sh = $('.sheet', wrap), bd = $('.sheet-backdrop', wrap); let y0 = 0, t0 = 0, dy = 0, on = false;
  const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width:720px)').matches;
  const down = e => { if (wide() || on || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('button')) return; on = true; y0 = e.clientY; t0 = e.timeStamp; dy = 0; sh.classList.add('drag'); try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } };
  const move = e => { if (!on) return; dy = Math.max(0, e.clientY - y0); sh.style.transform = `translate(-50%,${dy}px)`; bd.style.opacity = String(Math.max(0, 1 - dy / Math.max(1, sh.offsetHeight))); };
  const up = e => {
    if (!on) return; on = false; sh.classList.remove('drag');
    const far = dy > sh.offsetHeight * .28 || dy / Math.max(1, e.timeStamp - t0) > .6;
    sh.style.transform = ''; bd.style.opacity = ''; if (far) { haptic('tap'); api.close(); }
  };
  for (const h of [$('.grab', wrap), $('.sheet-head', wrap)]) { h.addEventListener('pointerdown', down); h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up); }
}
function openSheet(title, sub, build) {
  const wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grab"></div>
      <div class="sheet-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
        <button class="icon-btn" type="button" data-close aria-label="${T('Fermer')}"><svg class="i"><use href="#i-close"/></svg></button></div>
      <div class="sheet-body"></div><div class="sheet-foot" hidden></div></div>`;
  const prev = document.activeElement;
  $('#toast').classList.remove('on');
  const api = { body: $('.sheet-body', wrap), foot: $('.sheet-foot', wrap), wrap,
    close() {
      const i = sheets.indexOf(api); if (i < 0) return; sheets.splice(i, 1);
      syncFloat();
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), reduceMotion() ? 0 : 440);
      if (!sheets.length && !appHolds) { const app = $('#app'); app.inert = false; app.removeAttribute('aria-hidden'); }
      try { if (prev && prev.focus) prev.focus(); } catch (e) { /* ignore */ }
    },
    setFoot(html) { api.foot.hidden = !html; api.foot.innerHTML = html || ''; } };
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) api.close(); });
  sheetDrag(wrap, api);
  $('#sheetRoot').appendChild(wrap); sheets.push(api); syncFloat();
  const app = $('#app'); app.inert = true; app.setAttribute('aria-hidden', 'true');
  build(api);
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('open'); const c = $('[data-close].icon-btn', wrap); if (c) c.focus({ preventScroll: true }); }));
  return api;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheets.length) sheets[sheets.length - 1].close(); });

/* ── Saisie ───────────────────────────────────────────────────────────────────────────────── */
let draftT;
function refreshDeck() {
  const d = parseDeck($('#deckText').value); S.deck = d;
  applyOwned(d.cards, S.useColl ? engOwned : null);
  const buy = d.cards.filter(c => c.need > 0).length, owned = d.cards.length - buy;
  const chips = [];
  const dk = findDeck(S.deckId);
  if (dk) chips.push(`<span class="stat deckchip"><b>${esc(dk.name)}</b><button class="stat-x" type="button" data-act="detach" aria-label="${T('Détacher ce deck')}"><svg class="i"><use href="#i-close"/></svg></button></span>`);
  if (S.isSample) chips.push(`<span class="stat accent"><b>${T('Exemple')}</b> ${T('liste de démonstration')}</span>`);
  if (d.cards.length) chips.push(`<span class="stat">${TN(buy, '<b>{n}</b> carte à chercher', '<b>{n}</b> cartes à chercher')}</span>`);
  if (owned) chips.push(`<span class="stat good">${TN(owned, '<b>{n}</b> déjà possédée', '<b>{n}</b> déjà possédées')}</span>`);
  if (d.basicCopies) chips.push(`<span class="stat">${T('<b>{n}</b> terrains de base à part', { n: d.basicCopies })}</span>`);
  if (d.ignored) chips.push(`<span class="stat warn">${TN(d.ignored, '<b>{n}</b> ligne ignorée', '<b>{n}</b> lignes ignorées')}</span>`);
  $('#deckStats').innerHTML = chips.join('');
  const n = d.cards.length;
  $('#btnRunLabel').textContent = !n ? T('Colle une liste pour commencer') : !buy ? T('Tout est dans ta collection') : priceSrc() === 'cm' ? TN(buy, 'Voir les prix · {n} carte', 'Voir les prix · {n} cartes') : TN(buy, 'Chercher les offres · {n} carte', 'Chercher les offres · {n} cartes');
  $('#btnRun').disabled = !buy;
  paintCollSwitch();
  updateSaveButtons();
  clearTimeout(draftT); draftT = setTimeout(saveStore, 400);
  homeSoon();
}

function readOpts() {
  S.opts.lang = $('#optLang').value; S.opts.cond = $('#optCond').value;
  S.opts.foil = $('#segFoil')._v; S.opts.mode = $('#segMode')._v;
  S.opts.fallbackEn = $('#optFallback').checked;
  const v = parseFloat(String($('#optShip').value || '0').replace(',', '.'));
  S.opts.ship = Math.max(0, Math.round((isNaN(v) ? 0 : v) * 100));
}
function syncShip() { $('#shipField').hidden = S.opts.mode !== 'direct'; }
function modeHint() {
  $('#modeHint').textContent = S.opts.mode === 'zero'
    ? T('CardTrader Zero regroupe tous les vendeurs dans un seul colis (9 à 14 jours). Les frais et la livraison sont calculés par CardTrader.')
    : T('Chaque vendeur expédie lui-même. Mana Orbit minimise articles + port estimé, en regroupant les cartes chez moins de vendeurs.');
}

/* ── Vues ─────────────────────────────────────────────────────────────────────────────────── */
/** Vues : home (accueil) → input (« Nouveau panier » : saisie et critères) → results. */
const VIEWS = ['home', 'input', 'results'];
function showView(v) {
  const prev = S.view; S.view = v;
  const dir = prev === v ? '' : VIEWS.indexOf(v) > VIEWS.indexOf(prev) ? 'fwd' : 'back', el = $(v === 'home' ? '#viewHome' : v === 'input' ? '#viewInput' : '#viewResults');
  el.classList.remove('fwd', 'back'); if (dir) el.classList.add(dir);      // de la droite en avançant, de la gauche en revenant
  $('#app').dataset.view = v; $('#viewHome').hidden = v !== 'home'; $('#viewInput').hidden = v !== 'input'; $('#viewResults').hidden = v !== 'results';
  $('#dockInput').hidden = v !== 'input'; $('#dockResults').hidden = v !== 'results';
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (v === 'home') homeSoon(0);
}

/* ── Recherche ────────────────────────────────────────────────────────────────────────────── */
const STEP_DEFS = [['prints', T('Lecture des impressions')], ['catalog', T('Catalogue CardTrader')], ['offers', T('Offres')], ['fallback', T('Repli en anglais')]];
const STEP_CM = [['prints', T('Relevé Cardmarket du jour')], ['catalog', T('Cartes hors relevé (Scryfall)')], ['offers', T('Prix par carte')]];
function buildSteps() {
  const cm = S.run && S.run.src === 'cm';
  $('#steps').innerHTML = (cm ? STEP_CM : STEP_DEFS).map(([id, t]) =>
    `<li class="step" data-id="${id}" data-state="idle"><span class="st-ico"></span><span>${id === 'offers' && !cm ? esc(T('Offres en {lang}', { lang: LANGS[S.opts.lang] || S.opts.lang })) : esc(t)}</span><span class="det"></span></li>`).join('');
}
function setStep(id, state, detail) {
  const li = $(`.step[data-id="${id}"]`); if (!li) return;
  li.dataset.state = state; $('.det', li).textContent = detail || '';
  if (state === 'run' && S.run) { S.run.step = (li.children[1].textContent || '') + (detail ? ' · ' + detail : ''); paintSearchTask(); }
}
function setProgress(f) {
  f = Math.max(0, Math.min(1, f));
  $('#progFill').style.width = (f * 100).toFixed(1) + '%'; $('#progPct').textContent = T('{n} %', { n: Math.round(f * 100) });
  if (S.run) { S.run.frac = f; paintSearchTask(); }
}
function paintSearchTask() {
  const r = S.run, t = r && r.task; if (!t || t.done) return;
  t.set(Math.round(r.frac * 100), 100, T('{n} %', { n: Math.round(r.frac * 100) }) + (r.step ? ' · ' + r.step : ''));
}
function setRate(rps, total, extra) { const rs = rps.toFixed(1); $('#progRate').textContent = T('{total} requêtes · {rps} / s', { total, rps: LOC() === 'fr-FR' ? rs.replace('.', ',') : rs }) + (extra ? ' · ' + extra : ''); }

/** Une ligne de la liste : le bouton de la carte + une petite croix (visible une fois la carte scannée). */
function makeRow(c, i) {
  const rw = document.createElement('div'); rw.className = 'rw'; rw.dataset.key = c.key;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'row'; b.dataset.key = c.key; b.style.setProperty('--i', i);
  const x = document.createElement('button'); x.type = 'button'; x.className = 'rx'; x.dataset.key = c.key; x.title = T('Retirer de la liste');
  x.setAttribute('aria-label', T('Retirer {name} de la liste', { name: c.name })); x.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-close"/></svg>';
  rw.append(b, x); return rw;
}
function buildList() {
  const list = $('#list'); list.innerHTML = ''; list.classList.remove('settled'); clearTimeout(list._settle); list._order = null;
  S.deck.cards.forEach((c, i) => { const rw = makeRow(c, i); list.appendChild(rw); updateRow($('.row', rw), c, c.need === 0 ? { s: 'own' } : { s: 'loading' }, null); });
  list._settle = setTimeout(() => list.classList.add('settled'), 1700); // l'entrée en cascade ne doit pas rejouer quand on réordonne
  const bs = S.deck.basics;
  const note = $('#basicsNote');
  note.hidden = !bs.length;
  if (bs.length) note.textContent = T('Terrains de base non cherchés : {list}. Prends-les en lot chez un seul vendeur ou en boutique.', { list: bs.map(b => `${b.qty} × ${b.name}`).join(', ') });
  applyView(true);
}

/* ── Liste : tri, filtres, retrait d'une carte ────────────────────────────────────────────────── */
const FILTERS = [['all', T('Toutes')], ['none', T('Sans offre')], ['lang', T('Autre langue')], ['manual', T('Choix manuel')], ['own', T('Possédées')]];
function filterMatch(f, c, v) {
  if (f === 'none') return v.s === 'none' || v.s === 'nohub' || v.s === 'notfound';
  if (f === 'lang') return v.s === 'ok' && v.pick.parts.some(p => p.offer.lang && p.offer.lang !== S.opts.lang);
  if (f === 'manual') return !!S.overrides[c.key];
  if (f === 'own') return c.own > 0;
  return true;
}
/** Anime un changement d'ordre ou de contenu de la liste : chaque ligne glisse de son ancienne place à la nouvelle (FLIP). */
function flip(mutate) {
  const list = $('#list'), vh = window.innerHeight || 800, before = new Map(), still = reduceMotion();
  if (!still) for (const el of $$('.rw', list)) if (!el.hidden) before.set(el, el.getBoundingClientRect().top);
  mutate();
  if (still || !list.offsetParent || !before.size) return;
  const far = t => t < -120 || t > vh + 120;
  for (const el of $$('.rw', list)) {
    if (el.hidden) continue;
    const t1 = el.getBoundingClientRect().top, t0 = before.get(el);
    try {
      if (t0 == null) { if (!far(t1)) el.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' }); continue; }
      const dy = t0 - t1; if (Math.abs(dy) < 2 || (far(t0) && far(t1))) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
    } catch (e) { /* animations indisponibles */ }
  }
}
/** Met la liste à l'écran en accord avec l'état : cartes présentes, tri, filtre, puces de filtre. */
function applyView(force) {
  if (!S.run) return;
  const list = $('#list');
  const items = S.deck.cards.map((c, i) => { const v = cardView(c); return { c, i, v, name: c.name, cost: v.s === 'ok' ? v.pick.cost : null }; });
  const counts = {}; for (const [k] of FILTERS) counts[k] = items.filter(x => filterMatch(k, x.c, x.v)).length;
  if (S.filter !== 'all' && !counts[S.filter]) S.filter = 'all';
  const fc = $('#fchips'), shownF = FILTERS.filter(([k]) => k === 'all' || counts[k] > 0);
  const fsig = S.filter + '|' + shownF.map(([k]) => k + counts[k]).join(',');
  if (fc._sig !== fsig) { fc._sig = fsig; fc.hidden = shownF.length < 2; fc.innerHTML = shownF.map(([k, t]) => `<button type="button" class="fchip" role="radio" aria-checked="${k === S.filter}" data-f="${k}">${t}<b>${counts[k]}</b></button>`).join(''); }
  const sortSel = $('#optSort'); if (sortSel.value !== S.sort) sortSel.value = S.sort;
  // Pendant la recherche, un tri par prix réordonnerait la liste à chaque résultat : on l'applique à la fin (ou dès que tu le demandes).
  const running = S.run.status === 'running', mode = force || !running || S.sort === 'deck' || S.sort === 'name' ? S.sort : 'deck';
  const shown = sortCards(items.filter(x => filterMatch(S.filter, x.c, x.v)), mode), shownKeys = new Set(shown.map(x => x.c.key));
  const order = shown.concat(items.filter(x => !shownKeys.has(x.c.key)));
  const sig = order.map(x => x.c.key + (shownKeys.has(x.c.key) ? '' : '~')).join('|');
  $('#listEmpty').hidden = shown.length > 0 || !items.length;
  if (list._order === sig && $$('.rw', list).length === items.length) return;
  list._order = sig;
  const have = new Map($$('.rw', list).map(el => [el.dataset.key, el])), want = new Set(items.map(x => x.c.key));
  flip(() => {
    for (const [k, el] of have) if (!want.has(k)) el.remove();
    order.forEach((x, idx) => {
      let el = have.get(x.c.key);
      if (!el) { el = makeRow(x.c, x.i); updateRow($('.row', el), x.c, x.v, S.run.cards[x.c.key]); }
      el.hidden = !shownKeys.has(x.c.key);
      if (list.children[idx] !== el) list.insertBefore(el, list.children[idx] || null);
    });
  });
}
function paintUndo() {
  const n = S.removed.length, bar = $('#undoBar'); bar.hidden = !n; if (!n) return;
  $('#undoTxt').textContent = n === 1 ? T('{name} retirée de la liste', { name: S.removed[0].name }) : T('{n} cartes retirées de la liste', { n });
  $('#undoAll').textContent = n === 1 ? T('Remettre') : T('Tout remettre');
}
/** Retire une carte de la liste (et donc du panier) : ses lignes sortent de la decklist, annulable. */
function removeCard(key) {
  const c = S.deck.cards.find(x => x.key === key); if (!c || !S.run) return;
  const ta = $('#deckText'), r = dropCard(ta.value, key); if (!r.removed.length) return;
  haptic('tap');
  S.removed.push({ key, name: c.name, qty: c.qty, removed: r.removed });
  ta.value = r.text; S.isSample = false; refreshDeck(); paintUndo();
  const rw = $$('.rw', $('#list')).find(el => el.dataset.key === key), go = () => scheduleRecompute(true);
  if (rw && !reduceMotion()) { rw.style.pointerEvents = 'none'; try { rw.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(28px) scale(.97)' }], { duration: 190, easing: 'ease-in', fill: 'forwards' }).onfinish = go; } catch (e) { go(); } } else go();
  toast(T('{name} retirée', { name: c.name + (c.qty > 1 ? ' × ' + c.qty : '') }), { label: T('Annuler'), fn: () => undoRemove(false) });
}
/** Annule le dernier retrait, ou tous (dans l'ordre inverse, pour retrouver la liste d'origine). */
function undoRemove(all) {
  if (!S.removed.length) return;
  const ta = $('#deckText'); let n = 0, last = null;
  do { last = S.removed.pop(); ta.value = restoreLines(ta.value, last.removed); n++; } while (all && S.removed.length);
  S.isSample = false; refreshDeck(); paintUndo(); haptic('tap'); scheduleRecompute(true);
  toast(n > 1 ? T('{n} cartes remises', { n }) : T('{name} remise', { name: last.name }));
}

/** Message + action pour un refus d'accès du proxy, selon la raison renvoyée (auth_required, forbidden, bad_token, bad_app_key…). */
function authHint(e, svc = 'CardTrader') {
  const r = e && e.reason;
  if (r === 'auth_required' && CTX.needsLogin) return { msg: T('Connecte-toi pour utiliser ce serveur : il est réservé à ton compte.'), action: 'account', label: T('Se connecter') };
  if (r === 'forbidden') return { msg: T('Ce compte n\'est pas autorisé sur ce serveur. Dans Compte, copie ton identifiant et ajoute-le à ALLOWED_UIDS (Hostinger).'), action: 'account', label: T('Compte') };
  if (r === 'bad_token') return { msg: T('Connexion au compte invalide : déconnecte-toi puis reconnecte-toi.'), action: 'account', label: T('Compte') };
  if (r === 'token_expired') return { msg: T('Session expirée : relance la recherche.'), action: null, label: null };
  return { msg: T('{svc} refuse l\'accès. Vérifie le token ou la clé du proxy.', { svc }), action: 'settings', label: T('Réglages') };
}
async function startRun(fresh) {
  fresh = fresh === true;                                    // true : « Actualiser les prix » (ignore le cache du serveur)
  readOpts(); refreshDeck();
  const cards = S.deck.cards; if (!cards.length) return;
  if (!cards.some(c => c.need > 0)) { toast(T('Tout est déjà dans ta collection')); return; }
  if (!S.demo && !S.token && CTX.proxy && CTX.hasToken && CTX.needsLogin && CTX.serverOk == null && typeof D !== 'undefined' && D.user) await checkServer();      // compte tout juste connecté : a-t-il droit au token du serveur ?
  const src = priceSrc();
  if (COLL.pxRun) { COLL.pxRun.ctrl.abort(); toast(T('Lecture des prix réels interrompue : la recherche passe avant')); }
  if (S.run && S.run.ctrl) S.run.ctrl.abort();
  if (S.run && S.run.task) S.run.task.remove();
  if (S.enCtrl) S.enCtrl.abort(); S.enBusy = null;
  saveStore();
  const run = { id: ++runSeq, src, status: 'running', ctrl: new AbortController(), cards: {}, error: null, t0: performance.now(), text: $('#deckText').value, live: src !== 'demo', sig: curSig(), crit: critSig() };
  for (const c of cards) run.cards[c.key] = { fetched: false, offers: [], notFound: false, fellBack: false, bps: [], img: null };
  S.run = run; S.overrides = {}; S.gone = new Set(); S.cur = 'EUR'; S.fo = {}; S.tab = 'cards'; S.runDelta = null; S.removed = []; S.filter = 'all'; paintUndo();
  run.frac = 0; run.step = ''; run.cacheAge = 0;
  watchSeen($('#progressCard'));
  const title = src === 'demo' ? T('Recherche simulée') : src === 'cm' ? T('Prix Cardmarket') : T('Recherche des offres');
  run.task = floatTask(title, { total: 100, sub: T('Démarrage…') }, () => sheets.length > 0 || !isSeen($('#progressCard')));
  S.res = { zero: optimize([], {}, { mode: 'zero' }), direct: optimize([], {}, { mode: 'direct' }) };
  $('#segTab').setValue('cards'); $('#list').hidden = false; $('#cardsPane').hidden = false; $('#sellers').hidden = true;
  $('#progressWrap').classList.remove('closed'); $('#heroPartial').hidden = false; $('#btnCancel').hidden = false;
  $('#progTitle').textContent = title;
  $('#alerts').innerHTML = ''; $('#alerts')._sig = '';
  buildSteps(); setProgress(0); $('#progRate').textContent = T('Démarrage…'); $('#progHint').hidden = true; $('#btnViewer').disabled = true;
  syncSegDeliv(); buildList(); updateHero(); updateDock();
  showView('results'); lockScreen();

  const alive = () => !run.ctrl.signal.aborted && S.run === run;
  const skip = new Set(cards.filter(c => c.need === 0).map(c => c.key));              // cartes possédées en totalité : pas d'offres à lire
  const push = src === 'ct' ? await pushPayload(deckLabel()) : null;                  // notification de fin si tu quittes l'app (null si désactivée ; seulement pour une recherche CardTrader, qui peut durer)
  if (S.run !== run) return;
  pendingSave(push ? { text: run.text, opts: { ...S.opts }, deckId: S.deckId, at: Date.now() } : null);   // pour reprendre depuis la notification si l'app est fermée entre-temps
  const hooks = {
    step: (id, st, d) => { if (alive()) setStep(id, st, d); },
    progress: f => { if (alive()) setProgress(f); },
    rate: (r, t, x) => { if (alive()) setRate(r, t, x); },
    hint: on => { if (alive()) $('#progHint').hidden = !on; },                       // « le serveur lit les offres : tu peux quitter l'app »
    cacheAge: a => { if (alive() && a > run.cacheAge) run.cacheAge = a; },             // âge (s) du plus vieux prix servi par le cache du serveur
    card: (key, p) => {
      if (!alive()) return; const st = run.cards[key]; if (!st) return;
      st.fetched = true; st.offers = p.fellBack ? st.offers.concat(p.offers || []) : (p.offers || []); st.bps = p.bps || st.bps; st.notFound = !!p.notFound; st.img = p.img || st.img; if (p.meta) st.meta = p.meta; if (p.skipped) st.skipped = true;
      if (p.fellBack) st.fellBack = true;
      scheduleRecompute();
    },
    // Repli anglais utile : aucune offre exploitable dans la langue demandée, avec le mode actuel (Zero = vendeurs hub seulement).
    needsEn: key => { const st = run.cards[key]; return !!st && needsEnglish(st.offers, S.opts); },
  };
  try {
    await (src === 'demo' ? runDemo : src === 'cm' ? runCm : runLive)(cards, { ...S.opts, fresh, skip, push }, hooks, run.ctrl.signal);
    if (S.run === run) run.status = 'done';
  } catch (e) {
    if (S.run !== run) return;
    if (e.name === 'AbortError') { run.status = 'cancelled'; }
    else {
      run.status = 'error';
      const svc = /scryfall/.test(e.host || '') ? 'Scryfall' : 'CardTrader';
      const own = typeof location !== 'undefined' && e.host && e.host === location.host;
      const ah = e.code === 'auth' ? authHint(e, svc) : null;
      const m = { notoken: [T('Token CardTrader manquant.'), 'settings', T('Réglages')], auth: ah ? [ah.msg, ah.action, ah.label] : [],
        network: [CTX.proxy ? (/scryfall/.test(e.host || '') && !e.offline ? T('Scryfall ne répond plus (limite probable pour ton IP). Attends 2 minutes ou change de réseau, puis relance : les cartes déjà traitées sont en cache.') : e.offline ? T('Tu es hors ligne. Reconnecte-toi puis relance : les cartes déjà traitées sont en cache.') : own ? T('Le proxy ne répond plus ({host}). Relance : les cartes déjà traitées sont en cache.', { host: e.host }) : T('Impossible de joindre {host}. Vérifie ta connexion puis relance : les cartes déjà traitées sont en cache.', { host: e.host || T('CardTrader ou Scryfall') })) : T('Impossible de joindre CardTrader depuis le navigateur. Lance le proxy local (node proxy.mjs) et ouvre l\'app depuis http://localhost:8787.'), 'settings', T('Réglages')],
        rate: [T('{svc} limite les requêtes. Réessaie dans une minute.', { svc }), null, null] }[e.code] || [T('La recherche a échoué : {msg}.', { msg: e.message || T('erreur inconnue') }), null, null];
      run.error = { msg: m[0], action: m[1], label: m[2] };
    }
  } finally {
    if (S.run === run) {
      pendingSave(null);
      unlockScreen(); scheduleRecompute(true);
      if (run.status === 'done') { run.doneAt = Date.now(); recordRun(); }
      $('#heroPartial').hidden = true; $('#btnCancel').hidden = true; $('#progHint').hidden = true;
      $('#btnViewer').disabled = run.status !== 'done' || !run.live;
      if (run.status === 'done') {
        setProgress(1); $('#progTitle').textContent = src === 'cm' ? T('Prix Cardmarket') : T('Recherche terminée');
        { const h = $('#hero'); h.classList.remove('shine'); void h.offsetWidth; h.classList.add('shine'); }      // un reflet passe sur le total, une fois
        setTimeout(() => { if (S.run === run) $('#progressWrap').classList.add('closed'); }, reduceMotion() ? 0 : 900);
      } else { $('#progTitle').textContent = run.status === 'cancelled' ? T('Recherche arrêtée') : T('Recherche interrompue'); }
      updateAlerts(); updateDock();
      haptic(run.status === 'done' ? (S.deck.cards.some(c => /^(none|nohub|notfound)$/.test(cardView(c).s)) ? 'warn' : 'ok') : run.status === 'error' ? 'bad' : 'tap');
      const t = run.task;
      if (run.status === 'done') { const n = S.deck.cards.filter(c => c.need > 0).length, ok = S.deck.cards.filter(c => cardView(c).s === 'ok').length; t.finish(src === 'cm' ? T('Prix Cardmarket lus') : T('Recherche terminée'), ok === n ? 'ok' : 'warn', src === 'cm' ? TN(n, '{ok} / {n} carte avec un prix', '{ok} / {n} cartes avec un prix', { ok }) : TN(n, '{ok} / {n} carte avec offre', '{ok} / {n} cartes avec offre', { ok })); }
      else if (run.status === 'cancelled') t.remove();
      else t.finish(T('Recherche interrompue'), 'bad', run.error ? run.error.msg : '');
    }
  }
}

let rcTimer = 0;
function scheduleRecompute(now) {
  if (now) { clearTimeout(rcTimer); rcTimer = 0; recompute(); return; }
  if (rcTimer) return;
  rcTimer = setTimeout(() => { rcTimer = 0; recompute(); }, 240);
}

function recompute() {
  if (!S.run) return;
  const demand = [], byZ = {}, byD = {}; S.fo = {};
  for (const c of S.deck.cards) {
    if (c.need === 0) continue;                                   // déjà possédée : rien à acheter
    const st = S.run.cards[c.key]; if (!st || !st.fetched || st.notFound) continue;
    const list = st.offers.filter(o => passes(o, S.opts) && !S.gone.has(o.productId)); S.fo[c.key] = list;
    if (!list.length) continue;
    if (!S.cur || S.cur === 'EUR') S.cur = list[0].cur || 'EUR';
    // Langue demandée prioritaire dans chaque mode : une offre anglaise ne masque jamais une offre française (sauf choix manuel).
    const keep = !!S.overrides[c.key];
    demand.push({ key: c.key, qty: c.need });
    byZ[c.key] = forMode(list, 'zero', S.opts.lang, keep); byD[c.key] = forMode(list, 'direct', S.opts.lang, keep);
  }
  S.res = { zero: optimize(demand, byZ, { mode: 'zero', forced: S.overrides }), direct: optimize(demand, byD, { mode: 'direct', ship: S.opts.ship, forced: S.overrides }) };
  updateHero(); updateRows(); applyView(false); updateAlerts(); updateDock();
  if (S.tab === 'sellers') renderSellers(false);
}

/* ── Source des prix ──────────────────────────────────────────────────────────────────────────
   demo : prix simulés · ct : offres réelles CardTrader (ton token, ou celui du serveur si ton compte y a droit) · cm : prix tendance Cardmarket, sans token. */
function ctReady() { return !!S.token || (CTX.proxy && CTX.hasToken && ((!CTX.needsLogin && !CTX.needsKey) || CTX.serverOk === true || (CTX.needsKey && !!CTX.appKey))); }
function priceSrc() { return S.demo ? 'demo' : S.src !== 'cm' && ctReady() ? 'ct' : 'cm'; }
const isCm = () => !!S.run && S.run.src === 'cm';
/** Ce compte peut-il chercher avec le token du serveur ? (réservé à ALLOWED_UIDS) Revérifié à chaque changement de compte. */
async function checkServer() {
  if (!CTX.proxy || !CTX.hasToken || !CTX.needsLogin) return;
  try {
    const t = CTX.idToken ? await CTX.idToken() : ''; if (!t) { CTX.serverOk = false; modeLabel(); adsRefresh(); return; }
    const r = await fetch('__me', { headers: { 'x-firebase-token': t }, cache: 'no-store' }); const j = r.ok ? await r.json() : null;
    CTX.serverOk = !!(j && j.server);
  } catch (e) { CTX.serverOk = false; }
  modeLabel(); adsRefresh();      // bandeau de pub (appli Android) : jamais pour un compte autorisé
}

/* ── Rendu : résumé ───────────────────────────────────────────────────────────────────────── */
function curRes() { return S.res[isCm() ? 'zero' : S.opts.mode]; }
function totalOf(r) { return S.opts.mode === 'direct' && !isCm() ? r.total : r.items; }
function foundCount(r) { return S.deck.cards.filter(c => { const p = r.picks[c.key]; return p && p.parts.length; }).length; }

function syncSegDeliv() {
  const seg = $('#segDeliv'), cm = isCm();
  seg.hidden = cm; $('#segTab').closest('.toolbar').hidden = cm;           // prix Cardmarket : ni livraison ni vendeurs
  if (!seg._init) { mountSeg(seg, [{ v: 'zero', label: T('Zero · 1 colis'), sub: '—' }, { v: 'direct', label: 'Direct · —', sub: '—' }], S.opts.mode, v => { S.opts.mode = v; $('#segMode').setValue(v); syncShip(); modeHint(); saveStore(); recompute(); }); seg._init = true; }
  seg.setValue(S.opts.mode);
}
function updateHero() {
  const r = curRes(), z = S.res.zero, d = S.res.direct;
  const running = S.run && S.run.status === 'running';
  tween($('#heroAmt'), totalOf(r));
  const cm = isCm();
  $('#heroLabel').textContent = cm ? T('Prix Cardmarket, à partir de') : S.opts.mode === 'zero' ? T('Total articles') : T('Total estimé, port inclus');
  $('#heroCount').textContent = T('{found} / {total} cartes', { found: foundCount(r), total: S.deck.cards.filter(c => c.need > 0).length });
  $('#heroSellers').textContent = cm ? T('Prix tendance, hors port') : S.opts.mode === 'zero' ? T('Un colis via Zero') : TN(r.sellerCount, '{n} vendeur', '{n} vendeurs');
  const sv = $('#heroSave'), diff = S.opts.mode === 'direct' && !cm ? r.baseline.total - r.total : 0;
  sv.hidden = !(diff >= 1 && !running) ; if (!sv.hidden) sv.textContent = T('Économie de {amount} avec le regroupement', { amount: fmt(diff) });
  updateHeroDelta(); updateRecap();
  const seg = $('#segDeliv');
  seg.setSub('zero', T('{amount} + frais', { amount: fmt(z.items) })); seg.setLabel('direct', TN(d.sellerCount, 'Direct · {n} vendeur', 'Direct · {n} vendeurs')); seg.setSub('direct', fmt(d.total));
}
function updateDock() {
  const r = curRes(); const running = S.run && S.run.status === 'running';
  const cm = isCm();
  $('#dockSmall').textContent = (cm ? T('Prix Cardmarket') : S.opts.mode === 'zero' ? T('Articles · Zero') : T('Port inclus · Direct')) + (running ? ' · ' + T('en cours') : '');
  tween($('#dockTotal'), totalOf(r));
  $('#btnCart').disabled = running || !foundCount(r);
  $('#btnCartTxt').textContent = cm ? T('Copier pour Cardmarket') : T('Remplir le panier');
}

/* ── Rendu : lignes ───────────────────────────────────────────────────────────────────────── */
function cardView(c) {
  if (c.need === 0) return { s: 'own' };
  const st = S.run.cards[c.key];
  if (!st || !st.fetched) return { s: 'loading' };
  if (st.skipped) return { s: 'stale' };                     // possédée au lancement (offres non lues), plus entièrement depuis : à relancer
  if (st.notFound) return { s: 'notfound' };
  const list = S.fo[c.key] || [];
  if (!list.length) return { s: 'none' };
  const pick = curRes().picks[c.key];
  if (!pick || !pick.parts.length) return { s: 'nohub' };
  return { s: 'ok', pick };
}
function updateRows() {
  $$('.row', $('#list')).forEach(el => {
    const c = S.deck.cards.find(x => x.key === el.dataset.key); if (!c) return;
    updateRow(el, c, cardView(c), S.run.cards[c.key]);
  });
}
function updateRow(el, c, v, st) {
  const pick = v.pick, ri = pick ? refInfo(pick.parts, st && st.bps) : null;
  const sig = v.s + '|' + (pick ? pick.parts.map(p => p.offer.id + ':' + p.n).join(',') : '') + '|' + (st && st.fellBack ? 1 : 0) + '|' + S.opts.lang + '|' + S.cur + '|' + (c.own || 0) + '|' + c.need + '|' + (ri ? ri.ref + ri.level : '') + '|' + (st && st.img ? 1 : 0);
  if (el._sig === sig) return; el._sig = sig;
  const rw = el.parentNode; if (rw && rw.classList && rw.classList.contains('rw')) rw.classList.toggle('scanned', v.s !== 'loading');
  const prevCost = el._cost; el._cost = v.s === 'ok' ? pick.cost : null;
  const hue = hash32(c.key) % 360, letter = esc((c.name.trim()[0] || '?').toUpperCase());
  const top = pick && pick.parts[0] ? pick.parts[0].offer : null;
  const img = (top && top.img) || (st && st.img);
  const thumb = `<span class="thumb" style="--h:${hue}">${letter}${img ? `<img alt="" loading="lazy" decoding="async" src="${esc(img)}">` : ''}</span>`;
  const qty = c.need > 1 ? `<span class="tag accent">× ${c.need}</span>` : '';
  const ownTag = c.own > 0 && c.need > 0 ? `<span class="tag good">${TN(c.own, '{n} possédée', '{n} possédées')}</span>` : '';
  const langName = LANGS[S.opts.lang] || S.opts.lang;
  el.classList.toggle('is-missing', v.s === 'none' || v.s === 'notfound' || v.s === 'nohub');
  el.classList.toggle('is-own', v.s === 'own');
  if (v.s === 'loading') {
    el.innerHTML = `${thumb}<span class="row-main"><span class="row-name">${esc(c.name)}</span><span class="sk meta"></span></span><span class="row-price"><span class="sk price"></span></span>`;
  } else if (v.s === 'own') {
    el.innerHTML = `${thumb}<span class="row-main"><span class="row-name">${esc(c.name)}</span><span class="row-meta">${c.qty > 1 ? `<span class="tag accent">× ${c.qty}</span>` : ''}<span class="tag good">${T('Dans ta collection')}</span></span></span><span class="row-price"><span class="tag good">${T('Possédée')}</span></span>`;
  } else if (v.s === 'ok' && top.cm) {
    const n = pick.parts.reduce((a, p) => a + p.n, 0);
    el.innerHTML = `${thumb}<span class="row-main"><span class="row-name">${esc(c.name)}</span><span class="row-meta">${qty}${ownTag}<span class="tag">Cardmarket</span></span><span class="row-seller">${T('Tendance')}${n > 1 ? ' · ' + n + ' × ' + fmt(top.price) : ''}</span></span><span class="row-price"><b>${fmt(pick.cost)}</b></span>`;
  } else if (v.s === 'ok') {
    const tags = [];
    tags.push(`<span class="tag">${esc((top.set || '').toUpperCase())}${top.num ? ' ' + esc(top.num) : ''}</span>`);
    tags.push(`<span class="tag">${esc(COND_SHORT[top.cond] || top.cond || '?')}</span>`);
    if (top.lang) tags.unshift(langTag(top.lang));
    if (top.foil) tags.push('<span class="tag accent">Foil</span>');
    if (pick.parts.length > 1) tags.push(`<span class="tag">${TN(pick.parts.length - 1, '+{n} offre', '+{n} offres')}</span>`);
    if (pick.short > 0) tags.push(`<span class="tag warn">${T('Il en manque {n}', { n: pick.short })}</span>`);
    if (ri) tags.push(`<span class="tag ref ${ri.level}" title="${esc(T('Prix de référence Cardmarket par exemplaire (donné par Scryfall) : {ref}. Ton prix : {unit}.', { ref: fmt(ri.ref), unit: fmt(ri.unit) }))}">CM ${esc(fmt(ri.ref))}${ri.level === 'warn' ? ' · +' + T('{n} %', { n: ri.pct }) : ''}</span>`);
    const n = pick.parts.reduce((a, p) => a + p.n, 0);
    const small = pick.parts.length === 1 && n > 1 ? `${n} × ${fmt(top.price, top.cur)}` : '';
    el.innerHTML = `${thumb}<span class="row-main"><span class="row-name">${esc(c.name)}</span><span class="row-meta">${qty}${ownTag}${tags.join('')}</span><span class="row-seller">${esc(top.seller)}${top.country ? ' · ' + esc(top.country) : ''}</span></span><span class="row-price"><b${prevCost != null && prevCost !== pick.cost ? ' class="flash"' : ''}>${fmt(pick.cost, top.cur)}</b>${small ? `<small>${small}</small>` : ''}</span>`;
  } else {
    const msg = v.s === 'notfound' ? T('Nom introuvable, vérifie l\'orthographe')
      : v.s === 'none' && isCm() ? T('Pas de prix Cardmarket connu')
      : v.s === 'stale' ? T('Collection modifiée : relance la recherche')
      : v.s === 'nohub' ? T('Aucune offre compatible Zero')
        : (st && st.fellBack ? T('Aucune offre, même en anglais') : T('Aucune offre en {lang}', { lang: langName }));
    el.innerHTML = `${thumb}<span class="row-main"><span class="row-name">${esc(c.name)}</span>${ownTag ? `<span class="row-meta">${ownTag}</span>` : ''}<span class="row-miss">${esc(msg)}</span></span><span class="row-price">${v.s === 'stale' ? '' : `<span class="tag">${v.s === 'notfound' ? T('Erreur') : T('Voir')}</span>`}</span>`;
  }
}

/* ── Rendu : vendeurs ─────────────────────────────────────────────────────────────────────── */
function renderSellers(animate) {
  const r = curRes(), host = $('#sellers'); const nameOf = k => (S.deck.cards.find(c => c.key === k) || {}).name || k;
  host.innerHTML = r.sellers.map((g, i) => {
    const items = g.items.slice().sort((a, b) => nameOf(a.key).localeCompare(nameOf(b.key))).map(it =>
      `<div class="gi"><span>${it.n > 1 ? it.n + ' × ' : ''}${esc(nameOf(it.key))}${it.offer.lang ? flag(it.offer.lang) : ''}</span><span>${fmt(it.offer.price * it.n, it.offer.cur)}</span></div>`).join('');
    return `<div class="group" style="--i:${animate ? i : 0}${animate ? '' : ';animation:none'}"><div class="group-head"><div class="who"><b>${esc(g.seller)}</b><span class="tag">${esc(g.country || '?')}</span>${g.hub ? '<span class="tag good">Zero</span>' : ''}</div><div class="sum">${fmt(g.subtotal, g.items[0].offer.cur)}<small>${TN(g.count, '{n} carte', '{n} cartes')}</small></div></div>${items}</div>`;
  }).join('') || `<p class="hint">${T('Aucune offre retenue pour le moment.')}</p>`;
  const seg = $('#segTab'); seg.setLabel('cards', T('Cartes · {n}', { n: foundCount(r) })); seg.setLabel('sellers', T('Vendeurs · {n}', { n: r.sellerCount }));
}

/* ── Alertes ──────────────────────────────────────────────────────────────────────────────── */
function updateAlerts() {
  if (!S.run) return;
  const items = [];
  if (S.run.error) items.push({ k: 'bad', html: esc(S.run.error.msg) + (S.run.error.action ? ` <button type="button" data-act="${S.run.error.action}">${esc(S.run.error.label)}</button>` : '') });
  if (S.run.status === 'cancelled') items.push({ k: '', html: T('Recherche arrêtée : les résultats sont partiels.') });
  if (S.run.status === 'done' && S.run.cacheAge >= 90) { const m = Math.round(S.run.cacheAge / 60), ago = m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''); items.push({ k: '', html: `${T('Prix lus il y a {ago} (cache du serveur).', { ago })} <button type="button" data-act="refresh">${T('Actualiser les prix')}</button>` }); }
  if (S.run.status !== 'running') {
    let none = 0, nohub = 0, nf = [], short = 0, enNone = 0, enHub = 0, stale = 0;
    for (const c of S.deck.cards) {
      const v = cardView(c), st = S.run.cards[c.key], cand = S.opts.lang !== 'en' && !!st && !st.fellBack && !S.enBusy; // repli anglais encore possible
      if (v.s === 'none') { none++; if (cand) enNone++; } else if (v.s === 'nohub') { nohub++; if (cand) enHub++; }
      else if (v.s === 'notfound') nf.push(c.name); else if (v.s === 'stale') stale++; else if (v.s === 'ok' && v.pick.short > 0) short++;
    }
    const ln = LANGS[S.opts.lang] || S.opts.lang, en = S.opts.fallbackEn && S.opts.lang !== 'en';
    const enBtn = n => n ? ` <button type="button" data-act="en-all">${T('Trouver en anglais')}</button>` : '';
    const seeBtn = ` <button type="button" data-act="goto">${T('Voir')}</button>`;
    if (stale) items.push({ k: '', html: `${TN(stale, '{n} carte n\'est plus dans ta collection : prix à chercher.', '{n} cartes ne sont plus dans ta collection : prix à chercher.')} <button type="button" data-act="rerun">${T('Relancer la recherche')}</button>` });
    if (S.enBusy) items.push({ k: '', html: T('Recherche en anglais · {done} / {total}…', { done: S.enBusy.done, total: S.enBusy.total }) });
    if (none && isCm()) items.push({ k: '', html: TN(none, '{n} carte sans prix Cardmarket connu.', '{n} cartes sans prix Cardmarket connu.') + seeBtn });
    else if (none) items.push({ k: '', html: (en ? TN(none, '{n} carte sans offre en {lang} ni en anglais.', '{n} cartes sans offre en {lang} ni en anglais.', { lang: esc(ln) }) : TN(none, '{n} carte sans offre en {lang}.', '{n} cartes sans offre en {lang}.', { lang: esc(ln) })) + seeBtn + enBtn(enNone) });
    if (nohub) items.push({ k: '', html: `${TN(nohub, '{n} carte sans offre compatible Zero.', '{n} cartes sans offre compatible Zero.')} <button type="button" data-act="direct">${T('Passer en Direct')}</button>${enBtn(enHub)}` });
    if (nf.length) items.push({ k: 'bad', html: T('Nom introuvable : {names}', { names: esc(nf.slice(0, 3).join(', ')) + (nf.length > 3 ? '…' : '') }) });
    if (short) items.push({ k: '', html: TN(short, '{n} carte en quantité insuffisante.', '{n} cartes en quantité insuffisante.') });
  }
  const host = $('#alerts'), sig = JSON.stringify(items);
  if (host._sig === sig) return; host._sig = sig;
  host.innerHTML = items.map(a => `<div class="alert ${a.k}"><svg class="i"><use href="#i-alert"/></svg><div class="grow">${a.html}</div></div>`).join('');
}

/** « Trouver en anglais » : lance le repli anglais pour toutes les cartes sans offre exploitable (en gardant leurs offres actuelles). */
async function findEnglishAll() {
  if (!S.run || S.enBusy || S.opts.lang === 'en') return;
  const cands = S.deck.cards.filter(c => { const v = cardView(c), st = S.run.cards[c.key]; return st && !st.fellBack && !st.notFound && (v.s === 'none' || v.s === 'nohub'); });
  if (!cands.length) return;
  if (S.enCtrl) S.enCtrl.abort();
  const ctrl = S.enCtrl = new AbortController(), run = S.run;
  S.enBusy = { done: 0, total: cands.length }; updateAlerts();
  watchSeen($('#alerts'));
  const task = floatTask(T('Recherche en anglais'), { total: cands.length, sub: `0 / ${cands.length}` }, () => sheets.length > 0 || !isSeen($('#alerts')));
  let failed = 0, aborted = false, i = 0;
  const worker = async () => {
    while (i < cands.length && !ctrl.signal.aborted) {
      const c = cands[i++], st = run.cards[c.key];
      try {
        const offers = S.demo ? (await sleep(140, ctrl.signal), makeDemoOffers(c, 'en')) : await searchOneEnglish(c, st, S.opts, ctrl.signal);
        st.offers = st.offers.concat(offers); st.fellBack = true;
      } catch (e) { if (e.name === 'AbortError') { aborted = true; return; } failed++; }
      if (S.enBusy) { S.enBusy.done++; updateAlerts(); task.set(S.enBusy.done, cands.length, `${S.enBusy.done} / ${cands.length}`); } scheduleRecompute();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, cands.length) }, worker));
  if (S.enCtrl === ctrl) S.enBusy = null;
  if (aborted || S.run !== run) { task.remove(); updateAlerts(); return; }
  scheduleRecompute(true);
  const ok = cands.filter(c => cardView(c).s === 'ok').length;
  // Le français accorde « cartes » avec le total et « trouvée(s) » avec le nombre trouvé : trois phrases distinctes.
  const msg = T(cands.length > 1 ? (ok > 1 ? '{ok} / {total} cartes trouvées en anglais' : '{ok} / {total} cartes trouvée en anglais') : '{ok} / {total} carte trouvée en anglais', { ok, total: cands.length })
    + (failed ? ' · ' + TN(failed, '{n} erreur', '{n} erreurs') : '');
  const shown = task.isShown(); task.finish(T('Recherche en anglais terminée'), ok === cands.length ? 'ok' : 'warn', msg);
  if (!shown) toast(msg);
}

/* ── Récapitulatif (en haut des résultats) ─────────────────────────────────────────────────── */
function updateRecap() {
  const host = $('#recap'); if (!host) return;
  if (!S.run || !S.deck.cards.length) { host.hidden = true; return; }
  const own = S.deck.cards.filter(c => c.need === 0).length;
  const items = S.deck.cards.filter(c => c.need > 0).map(c => {
    const v = cardView(c);
    return { state: v.s, qty: c.qty, short: v.pick ? v.pick.short : 0, parts: v.pick ? v.pick.parts.map(p => ({ lang: p.offer.lang, n: p.n })) : [] };
  });
  const r = recapOf(items);
  const langs = Object.keys(r.byLang).sort((a, b) => (b === S.opts.lang) - (a === S.opts.lang) || r.byLang[b].cards - r.byLang[a].cards);
  const chip = (cls, html) => `<span class="rchip ${cls}">${html}</span>`;
  const chips = langs.filter(l => r.byLang[l].cards > 0 || r.byLang[l].copies > 0).map(l => chip(l === S.opts.lang ? '' : 'warn', `${flag(l)}<b>${r.byLang[l].cards}</b> ${esc(LANGS[l] || l)}`));
  if (own) chips.push(chip('good', TN(own, '<b>{n}</b> possédée', '<b>{n}</b> possédées')));
  if (r.none) chips.push(chip('warn', T('<b>{n}</b> sans offre', { n: r.none })));
  if (r.nohub) chips.push(chip('warn', T('<b>{n}</b> hors Zero', { n: r.nohub })));
  if (r.partial) chips.push(chip('warn', TN(r.partial, '<b>{n}</b> incomplète', '<b>{n}</b> incomplètes')));
  if (r.notfound) chips.push(chip('bad', TN(r.notfound, '<b>{n}</b> introuvable', '<b>{n}</b> introuvables')));
  if (r.loading) chips.push(chip('', T('<b>{n}</b> en cours', { n: r.loading })));
  const foil = S.opts.foil === 'no' ? T('non-foil') : S.opts.foil === 'yes' ? 'foil' : T('foil ou non');
  const crit = isCm() ? [T('prix tendance Cardmarket'), T('impression la moins chère'), T('hors port')] : [LANGS[S.opts.lang] || S.opts.lang, T('état ≥ {cond}', { cond: COND_SHORT[S.opts.cond] || S.opts.cond }), foil, S.opts.mode === 'zero' ? 'CardTrader Zero' : 'Direct'];
  if (!isCm() && S.opts.fallbackEn && S.opts.lang !== 'en') crit.push(T('repli anglais'));
  const html = `<div class="recap-top"><b>${r.found}</b><span> / ${T('{n} cartes trouvées', { n: r.total })}</span><i></i><span>${TN(r.copies, '{n} exemplaire', '{n} exemplaires')}</span></div>`
    + (chips.length ? `<div class="recap-chips">${chips.join('')}</div>` : '')
    + `<div class="recap-crit">${esc(crit.join(' · ').replace(/^./, m => m.toUpperCase()))}</div>`;
  if (host._sig !== html) { host._sig = html; host.innerHTML = html; }
  host.hidden = false;
}

/* ── Fiche carte ──────────────────────────────────────────────────────────────────────────── */
function openCardSheet(key) {
  const c = S.deck.cards.find(x => x.key === key); if (!c || !S.run) return;
  const st = S.run.cards[key]; if (!st || !st.fetched) return;
  const mode = S.opts.mode;
  const list = (S.fo[key] || []).filter(o => mode !== 'zero' || o.hub).slice().sort((a, b) => a.price - b.price).slice(0, 14);
  const chosen = new Set((curRes().picks[key] || { parts: [] }).parts.map(p => p.offer.id));
  const ri = refInfo((curRes().picks[key] || { parts: [] }).parts, st.bps), need0 = c.need;
  const ownBtn = api => {
    if (!need0) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'link-btn link-inline ownbtn';
    b.textContent = need0 > 1 ? T('Je possède déjà ces {n} exemplaires', { n: need0 }) : T('Je possède déjà cette carte');
    b.onclick = () => { collBump(ownKey(c.name), c.name, need0); api.close(); haptic('ok'); scheduleRecompute(true); toast(T('{name} ajoutée à ta collection', { name: c.name }), { label: T('Annuler'), fn: () => { collBump(ownKey(c.name), c.name, -need0); scheduleRecompute(true); } }); };
    api.body.appendChild(b);
  };
  if (isCm()) {
    openSheet(c.name, c.qty > 1 ? T('{n} exemplaires', { n: c.qty }) : null, api => {
      const o = (S.fo[key] || [])[0];
      api.body.innerHTML = `${o ? `<div class="cm-price"><b>${fmt(o.price)}</b><span>${T('Prix tendance Cardmarket de l\'impression la moins chère, par exemplaire.')}</span></div>` : `<p class="hint">${st.notFound ? T('Scryfall ne connaît pas ce nom. Corrige-le dans la liste.') : T('Aucun prix Cardmarket connu pour cette carte.')}</p>`}
        <a class="btn ghost small" href="${esc(cmUrl(c.name, S.opts.lang))}" target="_blank" rel="noopener noreferrer" style="align-self:flex-start">${T('Voir sur Cardmarket ↗')}</a>
        <p class="hint">${T('Les offres réelles des vendeurs, leur port et le remplissage du panier demandent ton token CardTrader (Réglages › Prix).')}</p>`;
      ownBtn(api); alWatchBtn(api, c.name);
    });
    return;
  }
  openSheet(c.name, c.qty > 1 ? T('{n} exemplaires', { n: c.qty }) : null, api => {
    if (!list.length) {
      const canEn = S.opts.lang !== 'en' && !st.fellBack && !st.notFound;
      const hubOnly = !st.notFound && (S.fo[key] || []).length > 0; // des offres existent, mais aucune compatible Zero
      const ln = LANGS[S.opts.lang] || S.opts.lang;
      api.body.innerHTML = `<p class="hint">${st.notFound ? T('Scryfall ne connaît pas ce nom. Corrige-le dans la liste.') : hubOnly ? T(canEn ? 'Des offres en {lang} existent, mais aucune n\'est compatible Zero. Passe en Direct pour les voir, ou cherche en anglais.' : 'Des offres en {lang} existent, mais aucune n\'est compatible Zero. Passe en Direct pour les voir.', { lang: esc(ln) }) : T('Aucune offre ne correspond à tes critères.')}</p>`;
      const enBtn = `<button class="btn" type="button" id="btnEn">${T('Chercher en anglais')}</button>`;
      if (hubOnly && mode === 'zero') {
        api.setFoot(`<button class="btn ghost" type="button" id="btnDirect">${T('Passer en Direct')}</button>${canEn ? enBtn : ''}`);
        $('#btnDirect', api.foot).onclick = () => { S.opts.mode = 'direct'; $('#segMode').setValue('direct'); syncSegDeliv(); syncShip(); modeHint(); saveStore(); recompute(); api.close(); };
      } else if (canEn) api.setFoot(enBtn);
      ownBtn(api); alWatchBtn(api, c.name);
      if (canEn) {
        $('#btnEn', api.foot).onclick = async e => {
          e.target.disabled = true; e.target.textContent = T('Recherche…');
          try {
            const offers = S.demo ? makeDemoOffers(c, 'en') : await searchOneEnglish(c, st, S.opts, S.run.ctrl.signal);
            if (S.demo) await sleep(350);
            st.offers = st.offers.concat(offers); st.fellBack = true; st.fetched = true; scheduleRecompute(true); api.close(); toast(offers.length ? T('Offres anglaises ajoutées') : T('Aucune offre en anglais non plus'));
          } catch (err) { e.target.disabled = false; e.target.textContent = T('Chercher en anglais'); toast(T('Recherche impossible : {msg}', { msg: err.message || T('erreur') })); }
        };
      }
      return;
    }
    const link = o => S.run.live && o.bpId != null ? `<a class="o-ext" href="${esc(ctCardUrl(o.bpId))}" target="_blank" rel="noopener noreferrer" aria-label="${T('Voir la carte sur CardTrader')}" title="${T('Voir sur CardTrader')}"><svg class="i" aria-hidden="true"><use href="#i-ext"/></svg></a>` : '';
    api.body.innerHTML = `<div class="offers">${list.map(o => `<div class="offer-row"><button type="button" class="offer" data-id="${esc(o.id)}" aria-pressed="${chosen.has(o.id)}">
      <span class="o-who">${esc(o.seller)}${o.country ? `<i>${esc(o.country)}</i>` : ''}</span><span class="o-price">${fmt(o.price, o.cur)}</span>
      <span class="o-meta"><span class="tag">${esc((o.set || '').toUpperCase())}${o.num ? ' ' + esc(o.num) : ''}</span><span class="tag">${esc(COND_SHORT[o.cond] || o.cond)}</span>${langTag(o.lang)}${o.foil ? '<span class="tag accent">Foil</span>' : ''}${o.hub ? '<span class="tag good">Zero</span>' : ''}<span class="tag">${T('{n} dispo', { n: o.qty })}</span></span></button>${link(o)}</div>`).join('')}</div>
      ${ri ? `<p class="hint refline" data-l="${ri.level}">${T('<b>Réf. Cardmarket {ref}</b> par exemplaire (prix Scryfall) · ton prix {unit}', { ref: esc(fmt(ri.ref)), unit: esc(fmt(ri.unit)) })}${ri.diff === 0 ? '' : ` (${ri.pct > 0 ? '+' : '−'}${T('{n} %', { n: Math.abs(ri.pct) })})`}</p>` : ''}
      ${mode === 'zero' ? `<p class="hint">${T('Seules les offres compatibles Zero sont listées.')}</p>` : ''}${S.run.live ? `<p class="hint">${T('Touche ↗ pour voir la carte et ses vendeurs sur CardTrader.')}</p>` : ''}`;
    ownBtn(api); alWatchBtn(api, c.name);
    api.body.onclick = e => {
      const b = e.target.closest('.offer'); if (!b) return;
      const id = list.find(o => String(o.id) === b.dataset.id); if (!id) return;
      S.overrides[key] = id.id; haptic('tap'); scheduleRecompute(true); api.close(); toast(T('Offre choisie'));
    };
    if (S.overrides[key]) {
      api.setFoot(`<button class="btn ghost" type="button" id="btnAuto">${T('Revenir au choix automatique')}</button>`);
      $('#btnAuto', api.foot).onclick = () => { delete S.overrides[key]; scheduleRecompute(true); api.close(); };
    }
  });
}

/** Prix Cardmarket : copie les cartes à acheter pour une Wants list Cardmarket (Shopping Wizard). */
function cmCopyRun() { cmCopy(S.deck.cards.filter(c => c.need > 0).map(c => ({ n: c.name, q: c.need })), T('tout est déjà dans ta collection')); }

/* ── Panier ───────────────────────────────────────────────────────────────────────────────── */
function cartParts() {
  const r = curRes(), out = [];
  for (const c of S.deck.cards) { const p = r.picks[c.key]; if (p) for (const x of p.parts) out.push({ offer: x.offer, n: x.n, name: c.name, key: c.key }); }
  const sellers = new Set(out.map(o => o.offer.sellerId)), mode = S.opts.mode;
  for (const pt of out) {
    const same = new Set(out.filter(o => o.key === pt.key).map(o => o.offer.productId)); // les autres lignes de la même carte ne sont pas des remplaçantes
    // Remplaçantes : mêmes critères et même langue prioritaire ; en Direct, un vendeur déjà au panier évite un port de plus.
    pt.alt = (tried, need) => replaceParts(forMode((S.fo[pt.key] || []).filter(o => !tried.has(o.productId) && !same.has(o.productId) && !S.gone.has(o.productId)), mode, S.opts.lang, false), need, { mode, ship: S.opts.ship, prefer: sellers });
  }
  return out;
}
function openCartSheet() {
  const r = curRes(), parts = cartParts(); if (!parts.length) return;
  const nItems = parts.reduce((a, p) => a + p.n, 0);
  const money = m => m && typeof m.cents === 'number' ? fmt(m.cents, m.currency) : null;
  const plural = cartPlural;
  openSheet(T('Remplir le panier'), 'CardTrader', api => {
    const status = (msg, ok = 0) => `<div class="status" data-ok="${ok}"><span class="dot"></span><span>${msg}</span></div>`;
    const begin = msg => { api.setFoot(''); api.body.innerHTML = status(`<span id="cartMsg">${esc(msg)}</span>`) + '<div class="track cartbar"><div class="fill" id="cartFill"></div></div>'; };
    let task = null;
    const prog = (label, i, n, short) => {
      const f = $('#cartFill', api.body), m = $('#cartMsg', api.body);
      if (f) f.style.width = (100 * i / n) + '%'; if (m) m.textContent = `${label}… ${i} / ${n}`;
      if (task) task.set(i, n, `${short} ${i} / ${n}`);
    };
    const intro = () => {
      api.body.innerHTML = `<dl class="kv"><dt>${T('Articles')}</dt><dd>${nItems}</dd><dt>${T('Livraison')}</dt><dd>${S.opts.mode === 'zero' ? T('Zero, 1 colis') : TN(r.sellerCount, '{n} vendeur', '{n} vendeurs')}</dd><dt class="total">${T('Total articles')}</dt><dd>${fmt(r.items)}</dd></dl>
        ${S.demo ? '' : `<div class="switch-row"><span class="t"><b>${T('Vider le panier d\'abord')}</b><span class="hint">${T('Retire tout ce qui est déjà dans ton panier CardTrader (même ajouté hors Mana Orbit), avec confirmation.')}</span></span><label class="switch"><input type="checkbox" id="cfClear"><i></i></label></div>`}
        <p class="hint">${S.demo ? T('Mode démo : le panier est simulé, rien n\'est envoyé à CardTrader.') : T('Les articles sont ajoutés à ton panier CardTrader. Si une offre n\'est plus disponible, Mana Orbit essaie automatiquement la suivante. Le paiement se fait sur CardTrader, rien n\'est acheté ici.')}</p>`;
      api.setFoot(`<button class="btn ghost" type="button" data-close>${T('Annuler')}</button><button class="btn" type="button" id="btnGo">${T('Remplir le panier')}</button>`);
      $('#btnGo', api.foot).onclick = () => go(!S.demo && !!($('#cfClear', api.body) || {}).checked);
    };

    // Étape 1 : lecture du panier + confirmation (aucune tâche flottante tant que rien n'est parti).
    async function go(clearFirst) {
      const ctrl = new AbortController();
      if (clearFirst) {
        begin(T('Lecture du panier…'));
        let cur;
        try { cur = await cartRead(ctrl.signal); }
        catch (e) { api.body.innerHTML = `<div class="fail"><b>${T('Le panier CardTrader n\'a pas pu être lu.')}</b><span>${esc(cartErrText(e))}</span></div>`; api.setFoot(`<button class="btn ghost" type="button" data-close>${T('Fermer')}</button><button class="btn" type="button" id="cfRetry">${T('Réessayer')}</button>`); $('#cfRetry', api.foot).onclick = () => go(true); return; }
        if (cur.items.length) {
          const qty = cur.items.reduce((a, i) => a + i.quantity, 0), tot = money(cur.subtotal);
          api.body.innerHTML = status(T('Ton panier CardTrader contient {copies} ({lines}). Ils seront retirés, puis tes {offers} seront ajoutées.', { copies: plural(qty, 'exemplaire'), lines: plural(cur.items.length, 'ligne') + (tot ? ' · ' + tot : ''), offers: plural(parts.length, 'offre') }));
          api.setFoot(`<button class="btn ghost" type="button" id="cfBack">${T('Annuler')}</button><button class="btn danger" type="button" id="cfSure">${T('Vider puis remplir')}</button>`);
          $('#cfBack', api.foot).onclick = intro;
          $('#cfSure', api.foot).onclick = () => run(cur.items, ctrl);
          return;
        }
      }
      run(null, ctrl);
    }

    // Étape 2 : vidage éventuel, puis ajout. La fenêtre peut être fermée : tout continue, la pastille flottante prend le relais.
    async function run(clearItems, ctrl) {
      task = floatTask(T('Remplissage du panier'), { total: parts.length, sub: T('Démarrage…') }, () => !sheets.includes(api));
      const bye = (msg, kind, d) => { const shown = task.isShown(); task.finish(msg, kind, d); haptic(kind); if (!shown && !sheets.includes(api)) toast(msg); };
      try {
        if (clearItems) {
          begin(T('Vidage du panier…')); task.label(T('Vidage du panier'));
          const cl = await cartClear(clearItems, ctrl.signal, (d, t) => prog(T('Vidage du panier'), d, t, T('Vidage')));
          const left = (await cartRead(ctrl.signal)).items.length;
          if (left || cl.failed.length) {
            const n = left || cl.failed.length;
            api.body.innerHTML = `<div class="fail"><b>${TN(n, 'Le panier n\'a pas pu être entièrement vidé ({n} ligne restante).', 'Le panier n\'a pas pu être entièrement vidé ({n} lignes restantes).')}</b><span>${T('Rien n\'a été ajouté.')}</span>${cl.failed.slice(0, 5).map(f => `<span>${esc(f.name)} : ${esc(f.reason)}</span>`).join('')}</div>`;
            api.setFoot(`<button class="btn ghost" type="button" data-close>${T('Fermer')}</button><button class="btn" type="button" id="cfForce">${T('Remplir quand même')}</button>`);
            $('#cfForce', api.foot).onclick = () => run(null, new AbortController());
            return bye(T('Panier non vidé'), 'warn', TN(n, '{n} ligne restante', '{n} lignes restantes'));
          }
        }
        begin(T('Ajout des articles…')); task.label(T('Remplissage du panier'));
        const res = await cartFill(parts, S.opts.mode, null, ctrl.signal, (i, n) => prog(T('Ajout des articles'), i, n, T('Ajout')), S.demo);
        if (res.gone.length) { res.gone.forEach(id => S.gone.add(id)); scheduleRecompute(true); } // offres indisponibles : retirées de la recherche
        if (!S.demo) buyRemember(res.added, !!clearItems);      // « J'ai acheté » : les cartes réellement au panier attendent ta validation
        const rep = res.replaced.length;
        const sim = S.demo ? ' ' + T('(simulation)') : '';
        let html = status(TN(res.ok, '{n} offre ajoutée', '{n} offres ajoutées') + (rep ? ' ' + TN(rep, 'dont {n} remplacée', 'dont {n} remplacées') : '') + sim + '.', 1);
        if (rep) html += `<div class="swap"><b>${TN(rep, '{n} offre remplacée (plus disponible)', '{n} offres remplacées (plus disponibles)')}</b>${res.replaced.slice(0, 8).map(x => { const t = x.to.map(u => `${u.n > 1 ? u.n + ' × ' : ''}${esc(u.offer.seller)} · ${fmt(u.offer.price * u.n, u.offer.cur)}`).join(' + '); return `<span>${esc(x.name)} : ${esc(x.from.seller)} · ${fmt(x.from.price * x.n, x.from.cur)} → ${t}</span>`; }).join('')}</div>`;
        if (res.failed.length) html += `<div class="fail"><b>${TN(res.failed.length, '{n} non ajoutée', '{n} non ajoutées')}</b>${res.failed.slice(0, 8).map(f => `<span>${esc(f.name)} : ${esc(f.reason)}</span>`).join('')}</div>`;
        if (!S.demo) {
          try {
            const cart = await ct('cart', { signal: ctrl.signal });
            const rows = [[T('Articles'), money(cart.subtotal)], [T('Frais CardTrader Zero'), money(cart.ct_zero_fee_amount)], [T('Port'), money(cart.shipping_cost)]].filter(x => x[1]);
            if (rows.length) html += `<dl class="kv">${rows.map(x => `<dt>${x[0]}</dt><dd>${x[1]}</dd>`).join('')}</dl><p class="hint">${T('CardTrader confirme le total final à la caisse.')}</p>`;
          } catch (e) { html += `<p class="hint">${T('Le panier est rempli, mais ses totaux n\'ont pas pu être lus.')}</p>`; }
        }
        api.body.innerHTML = html;
        api.setFoot(`<button class="btn ghost" type="button" data-close>${T('Fermer')}</button>${S.demo ? '' : `<a class="btn" style="text-decoration:none" href="https://www.cardtrader.com/fr-FR/cart/edit" target="_blank" rel="noopener">${T('Ouvrir sur CardTrader')}</a>`}`);
        const det = TN(res.ok, '{n} offre ajoutée', '{n} offres ajoutées') + (rep ? ', ' + TN(rep, '{n} remplacée', '{n} remplacées') : '') + sim;
        if (res.failed.length) bye(T('Panier partiellement rempli'), 'warn', det + ', ' + TN(res.failed.length, '{n} non ajoutée', '{n} non ajoutées'));
        else bye(T('Panier rempli'), 'ok', det);
      } catch (e) {
        bye(T('Panier non rempli'), 'bad', cartErrText(e));
        api.body.innerHTML = `<div class="fail"><b>${T('Le panier n\'a pas pu être rempli.')}</b><span>${esc(cartErrText(e))}</span></div>`;
        api.setFoot(`<button class="btn ghost" type="button" data-close>${T('Fermer')}</button>`);
      }
    }
    intro();
  });
}
const cartErrText = e => e.code === 'auth' ? authHint(e).msg : e.code === 'network' ? T('CardTrader est injoignable.') : (e.message || T('Erreur'));
/** « 3 exemplaires », « 1 ligne », « 2 offres » (panier CardTrader). */
const cartPlural = (n, w) => w === 'ligne' ? TN(n, '{n} ligne', '{n} lignes') : w === 'offre' ? TN(n, '{n} offre', '{n} offres') : TN(n, '{n} exemplaire', '{n} exemplaires');

/* ── Réglages ─────────────────────────────────────────────────────────────────────────────── */
/** « Nouveau panier » : choix Cardmarket / CardTrader (seulement si CardTrader est disponible), critères propres à CardTrader masqués en Cardmarket.
 *  Appelée à chaque changement de token, de compte ou de serveur (ancien nom gardé : modeLabel). */
function modeLabel() {
  const src = priceSrc(), f = $('#srcField'), seg = $('#segSrcRun'); if (!f) return;
  $('#viewInput').dataset.src = src === 'ct' ? 'ct' : 'cm';
  f.hidden = src === 'demo' || !ctReady();
  if (!seg._init) { seg._init = true; mountSeg(seg, [{ v: 'cm', label: 'Cardmarket' }, { v: 'ct', label: 'CardTrader' }], src === 'ct' ? 'ct' : 'cm', v => { S.src = v === 'cm' ? 'cm' : 'auto'; saveStore(); modeLabel(); }); }
  else seg.setValue(src === 'ct' ? 'ct' : 'cm');
  $('#srcHint').textContent = src === 'ct' ? T('Vraies offres des vendeurs (état, langue, port) et panier le moins cher, rempli sur CardTrader.') : T('Prix tendance de chaque carte, tout de suite, et liste à copier pour Cardmarket.');
  if (typeof refreshDeck === 'function' && $('#deckText')) refreshDeck();
}
function applyTheme() {
  const r = document.documentElement;
  if (S.theme === 'light' || S.theme === 'dark') r.setAttribute('data-theme', S.theme); else r.removeAttribute('data-theme');
}
function syncCTX() { CTX.token = S.token; CTX.appKey = S.appKey; }
/** Réglages › Gérer les notifications : fin de recherche (push) et alertes de prix, dans leur propre feuille. */
function openNotifSettings() {
  openSheet(T('Notifications'), T('Fin de recherche et alertes de prix'), api => {
    api.body.innerHTML = `<div class="sec-title">${T('Fin de recherche')}</div><div id="pushBox" class="installbox"></div>
      <div class="sec-title">${T('Alertes de prix')}</div><div id="alertBox" class="installbox"></div>`;
    paintPushBox($('#pushBox', api.body)); alPaintBox($('#alertBox', api.body));
  });
}
function openSettings() {
  openSheet(T('Réglages'), T('Prix, compte et affichage'), api => {
    api.body.innerHTML = `
      <div class="sec-title">${T('Prix')}</div>
      <p class="hint">${T('<b>Cardmarket</b> : prix tendance relevés chaque jour, gratuits et sans compte, pour estimer ta collection et tes decks.<br><b>CardTrader</b> : offres réelles des vendeurs, frais de port optimisés et remplissage de ton panier.')}</p>
      <div class="status" id="connStatus" data-ok="0"><span class="dot"></span><span id="connMsg"></span></div>
      <div class="field-in" id="boxToken"><label class="label" for="setToken">${T('Token CardTrader (facultatif)')}</label><input type="password" id="setToken" autocomplete="off" spellcheck="false" placeholder="${esc(T('Colle ton token API'))}" value="${esc(S.token)}">
        <span class="hint">${T('Pour les offres réelles des vendeurs, le port optimisé et le remplissage de ton panier. Ton token se trouve sur cardtrader.com, dans Paramètres › API. Gardé sur cet appareil, il passe par notre serveur seulement pour interroger CardTrader avec ton compte, sans jamais y être enregistré.')}</span></div>
      <div class="field-in" id="boxKey" ${CTX.needsKey ? '' : 'hidden'}><label class="label" for="setKey">${T('Clé du proxy')}</label><input type="password" id="setKey" autocomplete="off" value="${esc(S.appKey)}">${CTX.needsLogin ? `<span class="hint">${T('Facultative : ton compte suffit. À supprimer côté serveur une fois la connexion par compte validée.')}</span>` : ''}</div>
      <button class="btn ghost small" type="button" id="btnTest" style="align-self:flex-start">${T('Tester CardTrader')}</button>
      <div class="sec-title">${T('Affichage')}</div>
      <div class="field-in"><label class="label" for="setLang">${T('Langue')}</label><div class="sel"><select id="setLang">${Object.entries(I18N_LANGS).map(([c, n]) => `<option value="${c}" ${c === I18N.lang ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div></div>
      <div class="seg" id="segTheme" role="radiogroup" aria-label="${esc(T('Thème'))}"></div>
      <div class="switch-row"><span class="t"><b>${T('Vibrations')}</b><span class="hint">${typeof navigator !== 'undefined' && navigator.vibrate ? T('Un petit retour au toucher et à la fin des tâches.') : T('Indisponible sur cet appareil (iPhone et iPad ne les exposent pas).')}</span></span>
        <label class="switch"><input type="checkbox" id="setHaptic" ${S.haptic ? 'checked' : ''}><i></i></label></div>
      <button class="btn ghost small" type="button" id="btnCache" style="align-self:flex-start">${T('Vider le cache du catalogue')}</button>
      <div class="sec-title">${T('Notifications')}</div>
      <div class="installbox"><p class="hint">${T('Fin de recherche et alertes de prix.')}</p><button class="btn ghost small" type="button" id="btnNotif" style="align-self:flex-start">${T('Gérer les notifications')}</button></div>
      ${typeof isNativeApp === 'function' && isNativeApp() ? '' : `<div class="sec-title">${T('Application')}</div>
      <div id="appBox" class="installbox"></div>`}
      ${typeof isNativeApp === 'function' && isNativeApp() ? '<div id="widgetBox"></div>' : ''}
      <div id="helpBox"></div>
      <div class="sec-title">${T('Confidentialité')}</div>
      <div id="privBox" class="installbox"><p class="hint">${T('Sans compte, tout reste sur cet appareil. Aucune publicité ni mesure d\'audience.')}</p>
        <div class="cart-actions"><a class="btn ghost small" href="privacy" target="_blank" rel="noopener">${T('Politique de confidentialité')}</a><button class="btn ghost small" type="button" id="btnAbout">${T('Mentions et sources')}</button></div>
        <div id="wipeBox"></div></div>
      <div class="sec-title">${T('Panier CardTrader')}</div>
      <div id="cartBox" class="cartbox"></div>
      <p class="hint set-ver">${T('Version {v}', { v: esc(typeof DD_BUILD === 'string' ? DD_BUILD : 'dev') })}${typeof isNativeApp === 'function' && isNativeApp() ? ' · APK<span class="set-apkv"></span> : ' + NAT_PLUGINS.map(([n, l]) => (natPlugin(n) ? '✓' : '✗') + l).join(' ') + '<span class="set-fb"></span>' : ''}</p>
      <p class="hint fan">${FAN_CONTENT}</p>`;
    const b = api.body;
    // APK : sa version et Firebase (google-services.json), lus auprès de la coque ; APK sans plugin ManaOrbit ou info() refusé : la ligne reste telle quelle
    { const mo = typeof natPlugin === 'function' && natPlugin('ManaOrbit');
      if (mo) Promise.resolve().then(() => mo.info()).then(i => { const v = $('.set-apkv', b), f = $('.set-fb', b); if (!i || !v || !f) return; if (i.version) v.textContent = ' ' + i.version + (i.build ? ' (' + i.build + ')' : ''); f.textContent = ' ' + (i.firebase ? '✓' : '✗') + 'Firebase'; }).catch(() => {}); }
    // Installation de l'app : l'état change tout seul (installation acceptée, mode standalone…) tant que la feuille est ouverte
    const appBox = $('#appBox', b);      // absent dans l'appli Android : rien à installer
    const paintApp = () => {
      if (!appBox || !appBox.isConnected) { off(); return; }
      const st = PWA.state();
      const okRow = t => `<div class="status" data-ok="1"><span class="dot"></span><span>${t}</span></div>`;
      const hint = t => `<p class="hint">${t}</p>`;
      appBox.innerHTML = st === 'standalone' ? okRow(T('Mana Orbit est ouverte en application installée.'))
        : st === 'installed' ? okRow(T('Mana Orbit est installée. Ouvre-la depuis ton écran d\'accueil ou ton menu Démarrer.'))
        : st === 'ready' ? hint(T('Installe Mana Orbit comme une vraie application : icône sur ton appareil, plein écran, lancement direct.')) + `<button class="btn small" type="button" id="btnInstall">${T('Installer Mana Orbit')}</button>`
        : st === 'ios' ? hint(T('Sur iPhone et iPad, Apple ne permet pas l\'installation directe. Dans Safari : bouton Partager, puis « Sur l\'écran d\'accueil ».'))
        : st === 'insecure' ? hint(T('L\'installation demande une adresse en https.'))
        : hint(T('Ton navigateur ne propose pas encore l\'installation. Chrome ou Edge : icône d\'installation dans la barre d\'adresse, ou menu ⋮ puis « Installer Mana Orbit ». Android : menu ⋮ puis « Installer l\'application ».'));
      const bi = $('#btnInstall', appBox); if (bi) bi.onclick = doInstall;
    };
    const off = PWA.on(paintApp); paintApp();
    $('#btnAbout', b).onclick = openAbout;
    const wipe = $('#wipeBox', b), paintWipe = ask => {
      wipe.innerHTML = ask ? `<div class="status" data-ok="0"><span class="dot"></span><span>${T('Collection, decks, réglages et caches de cet appareil seront effacés.')}${typeof D !== 'undefined' && D.user ? ' ' + T('Ton compte et ses données en ligne restent intacts.') : ''}</span></div>
        <div class="cart-actions"><button class="btn ghost small" type="button" id="btnWipeNo">${T('Annuler')}</button><button class="btn ghost-danger small" type="button" id="btnWipeGo">${T('Tout effacer')}</button></div>`
        : `<button class="btn ghost-danger small" type="button" id="btnWipe" style="align-self:flex-start">${T('Effacer les données de cet appareil')}</button>`;
      if (ask) { $('#btnWipeNo', wipe).onclick = () => paintWipe(false); $('#btnWipeGo', wipe).onclick = async () => { if (typeof D !== 'undefined' && D.cloud && D.user) { try { await D.cloud.signOut(); } catch (e) { /* ignore */ } } wipeDevice(); }; }
      else $('#btnWipe', wipe).onclick = () => paintWipe(true);
    };
    paintWipe(false);
    $('#btnNotif', b).onclick = openNotifSettings;
    // rubriques fournies par d'autres modules (widget.js : réglages du widget dans l'appli ; help.js : aide, avis) — absentes tant que le module ne les définit pas
    if (typeof widgetSettings === 'function' && $('#widgetBox', b)) widgetSettings($('#widgetBox', b));
    if (typeof helpSettings === 'function') helpSettings($('#helpBox', b));
    const status = () => {
      const st = $('#connStatus', b), m = $('#connMsg', b), src = priceSrc(), mine = !!S.token;
      const say = (ok, t) => { st.dataset.ok = ok ? '1' : '0'; m.textContent = t; };      // le choix Cardmarket / CardTrader se fait sur « Nouveau panier » : ici, seulement ce qui est disponible
      if (src === 'demo') say(false, T('Serveur injoignable : prix simulés en attendant.'));
      else if (mine) say(true, T('CardTrader actif avec ton token : choisis « CardTrader » sur Nouveau panier pour les offres réelles et le panier.'));
      else if (ctReady()) say(true, T('CardTrader disponible avec le compte du serveur (ton compte Mana Orbit y est autorisé) : aucun token à saisir.'));
      else say(true, T('Sans token, les prix viennent de Cardmarket. Ajoute ton token CardTrader pour les offres réelles et le panier.'));
      $('#btnTest', b).hidden = !mine && !(CTX.proxy && CTX.hasToken);
      modeLabel();
    };
    status();
    $('#setToken', b).oninput = e => { S.token = e.target.value.trim(); if (S.token) S.src = 'auto'; syncCTX(); status(); saveStore(); };
    $('#setKey', b).oninput = e => { S.appKey = e.target.value.trim(); syncCTX(); saveStore(); };
    mountSeg($('#segTheme', b), [{ v: 'auto', label: T('Auto') }, { v: 'light', label: T('Clair') }, { v: 'dark', label: T('Sombre') }], S.theme, v => { S.theme = v; applyTheme(); saveStore(); });
    $('#setLang', b).onchange = e => { try { localStorage.setItem('deckdeal:lang', e.target.value); } catch (x) { /* ignore */ } location.reload(); };
    $('#setHaptic', b).onchange = e => { S.haptic = e.target.checked; saveStore(); haptic('ok'); };
    $('#btnCache', b).onclick = async () => { await Cache.clear(); toast(T('Cache vidé')); };
    // Vider le panier CardTrader : lecture, confirmation en deux temps (jamais de confirm() natif), suppression ligne par ligne, vérification.
    const box = $('#cartBox', b); // la suppression continue même si la feuille est fermée : on ne laisse pas un panier à moitié vidé
    const money = m => m && typeof m.cents === 'number' ? fmt(m.cents, m.currency) : null;
    const plural = cartPlural;
    const paintCart = (st, d = {}) => {
      if (!box.isConnected) return;
      if (st === 'idle') box.innerHTML = `<p class="hint">${T('Retire tous les articles du panier CardTrader, y compris ceux ajoutés hors de Mana Orbit. L\'app ne peut jamais acheter.')}${S.demo ? ' ' + T('Indisponible en mode démo.') : ''}</p><button class="btn ghost small" type="button" id="btnCartClear" style="align-self:flex-start" ${S.demo ? 'disabled' : ''}>${T('Vider le panier CardTrader')}</button>`;
      else if (st === 'reading') box.innerHTML = `<button class="btn ghost small" type="button" disabled style="align-self:flex-start">${T('Lecture du panier…')}</button>`;
      else if (st === 'empty') box.innerHTML = `<div class="status" data-ok="1"><span class="dot"></span><span>${T('Le panier CardTrader est déjà vide.')}</span></div>`;
      else if (st === 'confirm') {
        const qty = d.items.reduce((a, i) => a + i.quantity, 0), tot = money(d.subtotal);
        box.innerHTML = `<div class="status" data-ok="0"><span class="dot"></span><span>${T('{copies} ({lines}) seront retirés du panier CardTrader.', { copies: plural(qty, 'exemplaire'), lines: plural(d.items.length, 'ligne') + (tot ? ' · ' + tot : '') })}</span></div>
          <div class="cart-actions"><button class="btn ghost small" type="button" id="btnCartCancel">${T('Annuler')}</button><button class="btn ghost-danger small" type="button" id="btnCartConfirm">${T('Vider {copies}', { copies: plural(qty, 'exemplaire') })}</button></div>`;
        $('#btnCartCancel', box).onclick = () => paintCart('idle');
        $('#btnCartConfirm', box).onclick = () => doClear(d.items);
      }
      else if (st === 'clearing') box.innerHTML = `<div class="status" data-ok="0"><span class="dot"></span><span>${T('Suppression… {done} / {total}', { done: d.done, total: d.total })}</span></div>`;
      else if (st === 'done') box.innerHTML = `<div class="status" data-ok="${d.failed.length || d.left ? 0 : 1}"><span class="dot"></span><span>${d.left || d.failed.length ? TN(d.ok, '{n} ligne retirée', '{n} lignes retirées') + ', ' + TN(d.left || d.failed.length, '{n} ligne restante', '{n} lignes restantes') + '.' : T('Panier vidé ({lines}).', { lines: TN(d.ok, '{n} ligne retirée', '{n} lignes retirées') })}</span></div>`
        + (d.failed.length ? `<div class="fail">${d.failed.slice(0, 6).map(f => `<span>${esc(f.name)} : ${esc(f.reason)}</span>`).join('')}</div>` : '')
        + `<button class="btn ghost small" type="button" id="btnCartAgain" style="align-self:flex-start">${T('Revérifier')}</button>`;
      else if (st === 'error') box.innerHTML = `<div class="status" data-ok="0"><span class="dot"></span><span>${esc(d.msg)}</span></div><button class="btn ghost small" type="button" id="btnCartAgain" style="align-self:flex-start">${T('Réessayer')}</button>`;
      const go = $('#btnCartClear', box) || $('#btnCartAgain', box); if (go) go.onclick = readCart;
    };
    const cartErr = cartErrText;
    async function readCart() {
      paintCart('reading');
      try { const c = await cartRead(); c.items.length ? paintCart('confirm', c) : paintCart('empty'); }
      catch (e) { paintCart('error', { msg: T('Lecture impossible : {msg}', { msg: cartErr(e) }) }); }
    }
    async function doClear(items) {
      paintCart('clearing', { done: 0, total: items.length });
      const task = floatTask(T('Vidage du panier CardTrader'), { total: items.length, sub: T('{done} / {total} lignes', { done: 0, total: items.length }) }, () => !sheets.includes(api));
      const bye = (msg, kind, d) => { const shown = task.isShown(); task.finish(msg, kind, d); haptic(kind); if (!shown && (kind === 'ok' || !sheets.includes(api))) toast(msg); };
      try {
        const res = await cartClear(items, undefined, (d, t) => { paintCart('clearing', { done: d, total: t }); task.set(d, t, T('{done} / {total} lignes', { done: d, total: t })); });
        const left = (await cartRead()).items.length; // vérification : on relit le panier
        paintCart('done', { ok: res.ok, failed: res.failed, left });
        if (!left && !res.failed.length) bye(T('Panier CardTrader vidé'), 'ok', TN(res.ok, '{n} ligne retirée', '{n} lignes retirées'));
        else bye(T('Panier partiellement vidé'), 'warn', TN(left || res.failed.length, '{n} ligne restante', '{n} lignes restantes'));
      } catch (e) { paintCart('error', { msg: T('Suppression interrompue : {msg}', { msg: cartErr(e) }) }); bye(T('Suppression interrompue'), 'bad', cartErr(e)); }
    }
    paintCart('idle');
    $('#btnTest', b).onclick = async e => {
      const btn = e.target; btn.disabled = true; btn.textContent = T('Test…');
      const st = $('#connStatus', b), m = $('#connMsg', b);
      try { const j = await ct('info'); st.dataset.ok = '1'; m.textContent = j && j.name ? T('Connexion réussie (app « {name} »).', { name: j.name }) : T('Connexion réussie.'); }
      catch (err) { st.dataset.ok = '0'; m.textContent = err.code === 'notoken' ? T('Token manquant.') : err.code === 'auth' ? (S.token ? T('CardTrader refuse ce token : vérifie-le (Paramètres › API sur CardTrader).') : authHint(err).msg) : T('CardTrader est injoignable depuis ce navigateur.'); }
      btn.disabled = false; btn.textContent = T('Tester CardTrader');
    };
  });
}
/* ── Installation (bannière de la page d'accueil) ─────────────────────────────────────────────── */
const FAN_CONTENT = T('Mana Orbit est un contenu de fan non officiel autorisé par la Fan Content Policy. Il n\'est ni approuvé ni soutenu par Wizards of the Coast. Certains éléments utilisés sont la propriété de Wizards of the Coast. ©Wizards of the Coast LLC.');
/** Mentions et sources : contenu de fan (Wizards of the Coast), d'où viennent les données, bibliothèques. */
function openAbout() {
  const src = [
    ['Scryfall', 'https://scryfall.com', T('images et données des cartes, prix tendance Cardmarket')],
    ['Cardmarket', 'https://www.cardmarket.com', T('prix tendance (via Scryfall)')],
    ['CardTrader', 'https://www.cardtrader.com', T('offres des vendeurs et panier (avec ton token)')],
    ['EDHREC', 'https://edhrec.com', T('classement des commandants et decks moyens')],
    ['Archidekt', 'https://archidekt.com', T('decks Budget, Premium et cEDH')],
    ['EDHTop16', 'https://edhtop16.com', T('commandants joués en tournoi cEDH')],
    ['Mana', 'https://mana.andrewgioia.com', T('symboles de mana (Andrew Gioia, licences OFL et MIT)')],
    ['Tesseract.js', 'https://tesseract.projectnaptha.com', T('reconnaissance du texte au scan (Apache 2.0)')],
    ['Firebase', 'https://firebase.google.com', T('compte et synchronisation')],
    ['Google Fonts', 'https://fonts.google.com', T('polices Bricolage Grotesque, Instrument Sans et JetBrains Mono (licence OFL)')],
    ['Google ML Kit', 'https://developers.google.com/ml-kit', T('scan dans l\'appli Android (lecture du texte sur le téléphone)')],
    ['Google AdMob', 'https://admob.google.com', T('bandeau publicitaire de l\'appli Android')],
  ];
  openSheet(T('Mentions et sources'), null, api => {
    api.body.innerHTML = `<p class="hint">${FAN_CONTENT}</p>
      <p class="hint">${T('Mana Orbit n\'est affiliée à aucun des services ci-dessous. Merci à eux de rendre leurs données accessibles à la communauté.')}</p>
      <dl class="kv about">${src.map(([n, u, w]) => `<dt><a href="${u}" target="_blank" rel="noopener">${n}</a></dt><dd>${w}</dd>`).join('')}</dl>
      <a class="btn ghost small" href="privacy" target="_blank" rel="noopener" style="align-self:flex-start">${T('Politique de confidentialité')}</a>`;
  });
}
async function doInstall() { const r = await PWA.install(); if (r === 'dismissed') PWA.snooze(); }
function paintInstallBar() {
  const w = $('#installWrap'); if (!w) return;
  const show = PWA.wantsBanner(), st = PWA.state();
  w.classList.toggle('closed', !show); w.setAttribute('aria-hidden', show ? 'false' : 'true'); w.inert = !show;
  $('#installSub').textContent = st === 'ios' ? T('Safari : bouton Partager, puis « Sur l\'écran d\'accueil ».') : T('Lancement direct, plein écran, comme une vraie app.');
  $('#btnInstallBar').hidden = st === 'ios';
}
function initInstall() {
  $('#btnInstallBar').onclick = doInstall; $('#btnInstallX').onclick = PWA.snooze;
  PWA.on(paintInstallBar); paintInstallBar();
}
async function detectProxy() {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch('__ping', { signal: ctrl.signal }); clearTimeout(t);
    if (!r.ok) return; const j = await r.json();
    if (j && j.ok && j.app === 'deckdeal') { CTX.proxy = true; CTX.needsKey = !!j.needsKey; CTX.needsLogin = !!j.needsLogin; CTX.jobs = !!j.jobs; CTX.alerts = !!j.alerts; CTX.vapid = typeof j.push === 'string' ? j.push : ''; CTX.fcm = j.fcm === true; CTX.hasToken = j.hasToken !== false; CTX.prices = !!j.prices; S.proxy = true; if (S.demoPref == null) S.demo = false; checkServer(); }
  } catch (e) { /* pas de proxy */ }
  modeLabel();
}

/* ── Récap à copier ───────────────────────────────────────────────────────────────────────── */
function recapText() {
  const r = curRes(), lines = [`Mana Orbit · ${S.opts.mode === 'zero' ? 'CardTrader Zero' : 'Direct'} · ${fmt(totalOf(r))}`];
  const miss = [], own = [];
  for (const c of S.deck.cards) {
    if (c.need === 0) { own.push(c.name); continue; }
    const p = r.picks[c.key];
    if (!p || !p.parts.length) { miss.push(c.name); continue; }
    for (const x of p.parts) { const o = x.offer; lines.push(`${x.n} ${c.name} · ${fmt(o.price * x.n, o.cur)} · ${o.seller} (${o.country}) · ${(o.set || '').toUpperCase()}${o.num ? ' ' + o.num : ''} · ${COND_SHORT[o.cond] || o.cond} · ${(o.lang || '').toUpperCase()}`); }
  }
  if (miss.length) lines.push('', T('Sans offre : {list}', { list: miss.join(', ') }));
  if (own.length) lines.push('', T('Déjà possédées : {list}', { list: own.join(', ') }));
  return lines.join('\n');
}

/* ── Branchements ─────────────────────────────────────────────────────────────────────────── */
function init() {
  i18nDom(document.body);                                        // textes fixes de la page dans la langue choisie
  const saved = loadStore();
  if (saved.opts) Object.assign(S.opts, saved.opts);
  S.token = saved.token || ''; S.appKey = saved.appKey || ''; S.theme = saved.theme || 'auto';
  S.demoPref = null; S.src = saved.src === 'cm' ? 'cm' : 'auto';      // ancien interrupteur « Mode démo » retiré (choix enregistré ignoré) : démo seulement sans serveur joignable
  S.useColl = saved.useColl !== false; S.push = saved.push === true;
  S.haptic = saved.haptic !== false; S.sort = ['deck', 'price-desc', 'price-asc', 'name'].includes(saved.sort) ? saved.sort : 'deck';
  S.demo = S.demoPref == null ? !S.token : S.demoPref;
  syncCTX(); applyTheme();

  $('#optLang').value = S.opts.lang; $('#optCond').value = S.opts.cond; $('#optFallback').checked = !!S.opts.fallbackEn;
  $('#optShip').value = (S.opts.ship / 100).toFixed(2).replace('.', ',');
  mountSeg($('#segFoil'), [{ v: 'no', label: T('Sans foil') }, { v: 'any', label: T('Peu importe') }, { v: 'yes', label: 'Foil' }], S.opts.foil, () => { readOpts(); saveStore(); });
  mountSeg($('#segMode'), [{ v: 'zero', label: 'CardTrader Zero' }, { v: 'direct', label: T('Direct vendeurs') }], S.opts.mode, () => { readOpts(); syncShip(); modeHint(); saveStore(); });
  mountSeg($('#segTab'), [{ v: 'cards', label: T('Cartes') }, { v: 'sellers', label: T('Vendeurs') }], 'cards', v => {
    S.tab = v; $('#list').hidden = v !== 'cards'; $('#cardsPane').hidden = v !== 'cards'; $('#sellers').hidden = v !== 'sellers'; if (v === 'sellers') renderSellers(true); else applyView(true);
  });
  ['#optLang', '#optCond', '#optShip', '#optFallback'].forEach(s => $(s).addEventListener('change', () => { readOpts(); saveStore(); }));
  syncShip(); modeHint(); modeLabel();

  const ta = $('#deckText');
  ta.value = saved.draft || SAMPLE; S.isSample = !saved.draft;
  ta.addEventListener('input', () => { S.isSample = false; if (S.removed.length) { S.removed = []; paintUndo(); } refreshDeck(); });
  $('#btnSample').onclick = () => { ta.value = SAMPLE; S.isSample = true; S.deckId = null; refreshDeck(); };
  $('#btnClear').onclick = () => { ta.value = ''; S.isSample = false; S.deckId = null; refreshDeck(); ta.focus(); };
  $('#btnPaste').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); if (!t) throw new Error('vide'); ta.value = t; S.isSample = false; refreshDeck(); toast(T('Liste collée')); }
    catch (e) { ta.focus(); toast(T('Colle la liste dans le champ avec un appui long')); }
  };
  collInit();
  valInit();
  xsInit(); alInit(); trInit();
  initDecks();
  refreshDeck();
  homeInit();
  setTimeout(obMaybe, 400);      // premier lancement sur un appareil vierge
  $('#optColl').onchange = e => { S.useColl = e.target.checked; saveStore(); haptic('tap'); refreshDeck(); };
  $('#btnColl').onclick = () => openCollection();
  $('#btnQuick').onclick = () => { haptic('tap'); openScan(); scanPriceMode(true); };      // accueil : scan directement en « prix rapide »

  $('#btnRun').onclick = startRun;
  $('#btnBack').onclick = () => { if (S.run && S.run.status === 'running') S.run.ctrl.abort(); showView('input'); };
  $('#btnCancel').onclick = () => { if (S.run) S.run.ctrl.abort(); };
  $('#btnCopy').onclick = () => { if (S.run) copyText(recapText()); };
  $('#btnCart').onclick = () => isCm() ? cmCopyRun() : openCartSheet();
  $('#btnSettings').onclick = openSettings;
  { const bar = $('.bar'); let sy = -1; const sync = () => { sy = -1; bar.classList.toggle('scrolled', window.scrollY > 4); }; window.addEventListener('scroll', () => { if (sy < 0) sy = requestAnimationFrame(sync); }, { passive: true }); sync(); }      // filet sous la barre seulement quand le contenu passe dessous
  $('#list').addEventListener('click', e => {
    const x = e.target.closest('.rx'); if (x) return removeCard(x.dataset.key);
    const th = e.target.closest('.thumb'); if (th && th.querySelector('img.ok')) { const rw = th.closest('.rw'); if (rw) return openCardImage(rw.dataset.key); } // vignette → carte en grand
    const r = e.target.closest('.row'); if (r) { haptic('tap'); openCardSheet(r.dataset.key); }
  });
  $('#optSort').value = S.sort;
  $('#optSort').addEventListener('change', e => { S.sort = e.target.value; saveStore(); haptic('tap'); applyView(true); });
  $('#fchips').addEventListener('click', e => { const b = e.target.closest('.fchip'); if (!b) return; S.filter = b.dataset.f; haptic('tap'); applyView(true); });
  $('#listAll').onclick = () => { S.filter = 'all'; applyView(true); };
  $('#undoAll').onclick = () => undoRemove(true);
  $('#list').addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
  $('#list').addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  $('#alerts').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    if (b.dataset.act === 'settings') openSettings();
    else if (b.dataset.act === 'account') openAccount();
    else if (b.dataset.act === 'en-all') findEnglishAll();
    else if (b.dataset.act === 'refresh') startRun(true);
    else if (b.dataset.act === 'rerun') startRun();
    else if (b.dataset.act === 'direct') { S.opts.mode = 'direct'; $('#segMode').setValue('direct'); syncSegDeliv(); syncShip(); modeHint(); saveStore(); recompute(); }
    else if (b.dataset.act === 'goto') {
      if (S.tab !== 'cards') { $('#segTab').setValue('cards'); S.tab = 'cards'; $('#list').hidden = false; $('#cardsPane').hidden = false; $('#sellers').hidden = true; }
      if (S.filter !== 'all') { S.filter = 'all'; applyView(true); }
      const row = $('.row.is-missing', $('#list')); if (row) { row.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' }); try { row.animate([{ background: 'var(--warn-soft)' }, { background: 'transparent' }], { duration: 1400 }); } catch (err) { /* ignore */ } }
    }
  });
  initInstall();
  detectProxy().then(() => { pushInit(); handleLaunch(); alSoon(); });
  keepStorage();
}

/** Demande au navigateur de ne pas effacer les données du site (collection, relevés, images) quand l'espace manque. Sans effet visible. */
function keepStorage() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ } }

/* ── Ouverture par un partage ou une notification ─────────────────────────────────────────────── */
const PENDING_KEY = 'deckdeal:pending';
function pendingSave(info) { try { if (info) localStorage.setItem(PENDING_KEY, JSON.stringify(info)); else localStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ } }
function pendingRead() { try { const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); return p && typeof p.text === 'string' && Date.now() - p.at < 6 * 3600e3 ? p : null; } catch (e) { return null; } }
/** Notification touchée : si la recherche est encore là on y revient, sinon on la relance (le serveur la rend en quelques secondes grâce à son cache). */
function resumeRun() {
  if (S.run && S.run.status !== 'cancelled') { if (S.view !== 'results') showView('results'); return; }
  const p = pendingRead(); if (!p) { toast(T('Recherche terminée : relance-la pour voir les prix')); return; }
  $('#deckText').value = p.text; S.isSample = false; S.deckId = p.deckId && findDeck(p.deckId) ? p.deckId : null;
  if (p.opts) applyOpts({ ...S.opts, ...p.opts });
  refreshDeck(); toast(T('Prix prêts, chargement…')); startRun();
}
function handleLaunch() {
  let q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (![...q.keys()].length) return;
  const resume = q.has('resume'), alerts = q.has('alerts'), shared = q.has('text') || q.has('url') || q.has('title'), del = q.has('delete-account');
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  if (del) setTimeout(() => openAccount('delete'), 600);                                  // lien « supprimer mon compte » de la politique de confidentialité
  else if (resume) resumeRun();
  else if (alerts) setTimeout(alertsOpen, 900);
  else if (shared) onShared(extractShared({ title: q.get('title'), text: q.get('text'), url: q.get('url') }));
  else if (q.has('collection')) setTimeout(() => openCollection(), 600);                  // lien direct vers la collection (?collection)
}
/** Contenu reçu du menu « Partager » : une decklist en texte, ou un lien (EDHREC, Archidekt, Moxfield) lu par le serveur. */
/** Met une decklist dans la page de saisie (partage, import d'un lien, deck EDHREC de la collection). */
function putDeckText(text, name) {
  const ta = $('#deckText'); ta.value = text; S.isSample = false; S.deckId = null; S.removed = []; if (S.view !== 'input') showView('input'); refreshDeck();
  toast((name ? name + ' · ' : '') + T('{n} cartes reçues', { n: S.deck.cards.length })); window.scrollTo({ top: $('.field').offsetTop - 70, behavior: reduceMotion() ? 'auto' : 'smooth' });
}
async function onShared(sh) {
  const put = putDeckText;
  if (sh.text) return put(sh.text);
  if (!sh.urls.length) { toast(T('Rien à importer dans ce partage')); return; }
  if (!CTX.proxy) { toast(T('Le lien ne peut être lu que par le serveur Mana Orbit')); return; }
  toast(T('Lecture de la liste…'));
  try { const r = await ct('import', { params: { url: sh.urls[0] } }); if (r && r.text) put(r.text, r.name); else throw new Error('vide'); }
  catch (e) { toast(e && e.code === 'auth' ? authHint(e).msg : T('Lien non lu : ouvre la liste sur le site, copie-la, puis colle-la ici')); }
}
/** Interrupteur « Déduire ma collection » de la page de saisie. */
function paintCollSwitch() {
  const row = $('#collRow'); if (!row) return;
  const n = collCount(); row.hidden = !n; if (!n) return;
  $('#optColl').checked = S.useColl;
  const own = S.deck.cards.filter(c => c.own > 0).length, held = S.useColl ? engHeldBack(S.deck.cards) : { n: 0, names: [] };
  const decks = held.names.length > 2 ? T('{n} decks', { n: held.names.length }) : held.names.join(' ' + T('et') + ' ');
  const note = held.n ? ' ' + TN(held.n, '{n} exemplaire réservé par {decks} n\'est pas compté.', '{n} exemplaires réservés par {decks} ne sont pas comptés.', { decks }) : '';
  $('#collHint').textContent = !S.useColl ? T('Désactivé : toutes les cartes sont cherchées.')
    : (own ? TN(own, '{n} carte de cette liste est dans ta collection : non cherchée.', '{n} cartes de cette liste sont dans ta collection : non cherchées.') : T('Aucune carte de cette liste n\'est dans ta collection.')) + note;
}
