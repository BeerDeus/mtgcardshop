/* ── splash.js : écran de lancement ─────────────────────────────────────────────────────────────────────────────
   Script à part, posé par build.mjs juste après #splash en haut du <body> : il tourne avant le gros script, donc avant la première image
   (thème enregistré appliqué tout de suite, choix du mode). Visuels interchangeables : #splash (body.html) + src/css/splash.css.
   Contrat · #splash : .sp-in (dans le balisage : la chorégraphie part au premier rendu), .sp-short / .sp-rm (dès le départ), .sp-idle (plafond atteint, appli pas prête),
     .sp-out (sortie) + .sp-morph (passage à l'accueil) ; --sp-out : durée de la sortie. <html>.sp-on : appli inerte, ses animations en pause.
   · [data-sp-to="sélecteur"] : vole sur cet élément de #app au passage (échelle fixe permise) ; [data-sp-sync="sélecteur"] : les boucles CSS de cet élément
     reprennent l'horloge du splash (même nom d'animation : aucun saut). · window.splashHandoffX(el, morph, done) : sortie propre à un autre concept (true = prise en charge). */
const SPLASH_T = { min: 1600, cap: 2500, max: 8000, short: 600, rm: 1000, out: 600, outShort: 240, fast: 220, fade: 300 };
const SPLASH_KEEP = /^(splash|lang|onboarding|source|ref|utm_\w+)$/;      // paramètres qui n'ouvrent aucun écran : ouverture normale
/** 'full' : ouverture à froid · 'short' : lien profond (?p=, ?open=, partage, ?delete-account…), rechargement (« Recharger », langue), retour arrière sans bfcache
 *  · 'none' : navigateur piloté par les tests (sauf ?splash=1 ou ?splash=short), page ouverte cachée, ?splash=0. o : { search, webdriver, hidden, nav }. */
function splashMode(o) {
  const q = new URLSearchParams(o.search || ''), f = q.get('splash');
  if (f === '0' || o.hidden || (o.webdriver && !f)) return 'none';
  return f === 'short' || o.nav === 'reload' || o.nav === 'back_forward' || [...q.keys()].some(k => !SPLASH_KEEP.test(k)) ? 'short' : 'full';
}
const SPL = { el: null, short: false, rm: false, ready: false, min: false, near: false, skip: false, end: false, prep: undefined, held: [], mo: null, tm: [] };
function splashEnv() {
  let nav = ''; try { nav = performance.getEntriesByType('navigation')[0].type; } catch (e) { /* navigateur ancien */ }
  return { search: location.search, webdriver: navigator.webdriver === true, hidden: document.visibilityState === 'hidden', nav };
}
const splashMark = n => { try { performance.mark('splash:' + n); } catch (e) { /* ignore */ } };
/** Sous le splash, rien n'est atteignable au clavier : chaque enfant du <body> (appli, feuilles, toasts, accueil du premier lancement) est inerte. */
function splashHold(n) { if (n.nodeType === 1 && n !== SPL.el && !/^(script|style|svg)$/i.test(n.nodeName) && !n.inert) { n.inert = true; SPL.held.push(n); } }
function splashRelease() {
  if (SPL.mo) { SPL.mo.disconnect(); SPL.mo = null; }
  const busy = (typeof sheets !== 'undefined' && sheets.length) || (typeof appHolds !== 'undefined' && appHolds);      // feuille ouverte dessous : reste inerte
  for (const n of SPL.held) if (!(busy && n.id === 'app')) n.inert = false;
  SPL.held = [];
}
/** Les animations de l'appli repartent (entrée de l'accueil) ; les boucles [data-sp-sync] reprennent d'abord l'horloge du splash. */
function splashPlay() {
  const el = SPL.el; if (el && Element.prototype.getAnimations) for (const s of el.querySelectorAll('[data-sp-sync]')) {
    const t = {}; for (const a of s.getAnimations({ subtree: true })) if (a.animationName && !(a.animationName in t)) t[a.animationName] = a.currentTime;
    for (const d of document.querySelectorAll('#app ' + s.dataset.spSync)) for (const a of d.getAnimations({ subtree: true })) if (a.animationName in t) a.currentTime = t[a.animationName];
  }
  document.documentElement.classList.remove('sp-on');
}
function splashRemove() {
  const el = SPL.el; if (!el) return;
  SPL.end = true; SPL.tm.forEach(clearTimeout); splashRelease(); document.documentElement.classList.remove('sp-on'); SPL.el = null; el.remove(); splashMark('end');
  if (document.activeElement === document.body) { const c = document.querySelector('.sheet-wrap.open [data-close].icon-btn'); if (c) c.focus({ preventScroll: true }); }      // focus refusé sous le splash
  document.dispatchEvent(new Event('splashend'));
}
/** Vol vers l'accueil préparé d'avance, avant le temps minimal (aucune mise en page forcée au départ du vol) : entrées de chaque cible et de ses parents finies
 *  (orbe qui grossit, écran qui glisse), puis [élément, cible, départ, arrivée]. null : une cible manque ou sort de l'écran (fondu). */
function splashPrep() {
  const el = SPL.el; if (!el || SPL.prep !== undefined || SPL.short || SPL.rm || !Element.prototype.animate || !Element.prototype.getAnimations) return;
  const out = [], fin = a => { if (a.animationName && a.effect.getTiming().iterations !== Infinity) a.finish(); };
  for (const s of el.querySelectorAll('[data-sp-to]')) {
    const d = document.querySelector('#app ' + s.dataset.spTo); if (!d) return (SPL.prep = null);
    d.getAnimations({ subtree: true }).forEach(fin); for (let n = d.parentElement; n && n.id !== 'app'; n = n.parentElement) n.getAnimations().forEach(fin);
    const a = s.getBoundingClientRect(), b = d.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(s).transform);
    if (b.width < 8 || b.top < 0 || b.bottom > innerHeight) return (SPL.prep = null);
    out.push([s, d, m.toString(), `translate(${b.left + b.width / 2 - a.left - a.width / 2}px,${b.top + b.height / 2 - a.top - a.height / 2}px) scale(${m.a * b.width / a.width})`]);
  }
  SPL.prep = out.length ? out : null;
}
/** Accueil couvert (premier lancement, feuille, écran plein format, autre vue) : un enfant du <body> visible en plus de l'appli. */
const splashCovered = () => (typeof S !== 'undefined' && S.view !== 'home') || [...document.body.children].some(n => n !== SPL.el && !/^(script|style|svg)$/i.test(n.nodeName) && !/^(app|toast|tasks)$/.test(n.id) && (n.id !== 'sheetRoot' || n.children.length) && n.getClientRects().length);
function splashMorph(pairs, D) {
  for (const [s, d, from, to] of pairs) {
    s.animate([{ transform: from, easing: 'cubic-bezier(.45,.05,.2,1)' }, { transform: to, offset: 0.8 }, { transform: to }], { duration: D, fill: 'forwards' });
    s.animate([{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: D, fill: 'forwards' });
    d.animate([{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1, offset: 0.801 }, { opacity: 1 }], { duration: D });      // posée : la cible paraît sous le splash identique, qui s'efface
  }
}
/** Sortie : vol vers l'accueil si tout est en place, sinon fondu (agrandi). fast : toucher, plafond absolu. */
function splashHandoff(fast) {
  const el = SPL.el; if (!el || SPL.end) return;
  SPL.end = true; SPL.tm.forEach(clearTimeout); splashMark('out');
  const quick = fast || SPL.rm, D = SPL.rm ? SPLASH_T.fade : fast ? SPLASH_T.fast : SPL.short ? SPLASH_T.outShort : SPLASH_T.out;
  el.style.setProperty('--sp-out', D + 'ms');
  if (typeof window.splashHandoffX === 'function') { try { if (window.splashHandoffX(el, !quick, splashRemove)) { splashRelease(); splashPlay(); return; } } catch (e) { /* sortie par défaut */ } }
  if (!quick && !SPL.short) splashPrep();
  const pairs = quick || SPL.short || splashCovered() ? null : SPL.prep;      // lien profond : un autre écran, fondu
  el.classList.add('sp-out'); if (pairs) { el.classList.add('sp-morph'); splashMorph(pairs, D); } else splashRelease();
  SPL.tm = [setTimeout(() => { splashRelease(); splashPlay(); }, pairs ? D * 0.3 : 0), setTimeout(splashRemove, D + 40)];      // vol : l'appli (inerte, en pause) n'est recalculée qu'une fois l'orbe partie du centre
}
function splashCheck() { if (SPL.ready && (SPL.min || SPL.skip)) splashHandoff(SPL.skip); else if (SPL.ready && SPL.near) splashPrep(); }
/** Départ synchrone, sans attendre une image : .sp-in est déjà dans le balisage, les animations CSS partent au premier rendu et tournent sur le compositeur. */
function splashStart() {
  const el = SPL.el; splashMark('in');
  if (SPL.short && !SPL.rm) for (const a of el.getAnimations({ subtree: true })) if (a.effect.target !== el) { a.currentTime = 340; a.playbackRate = 2.2; }      // version courte : allumage immédiat
  const T = SPLASH_T, min = SPL.rm ? T.rm : SPL.short ? T.short : T.min;
  SPL.tm.push(setTimeout(() => { SPL.min = true; splashCheck(); }, min),
    setTimeout(() => { SPL.near = true; splashCheck(); }, min - 350),      // vol mesuré d'avance
    setTimeout(() => { if (!SPL.end) el.classList.add('sp-idle'); }, SPL.short || SPL.rm ? min : T.cap),
    setTimeout(() => splashHandoff(true), T.max));
}
/** Appli prête : page lue et exécutée (DOMContentLoaded : init() et l'accueil sont peints), polices chargées (0,7 s au plus), deux images. */
function splashReady() {
  const go = () => requestAnimationFrame(() => requestAnimationFrame(() => { SPL.ready = true; splashCheck(); }));
  try { void document.body.offsetHeight; Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 700))]).then(go, go); } catch (e) { go(); }
}
/** fn après la sortie d'un splash complet (travail lourd du démarrage : SDK Firebase…) ; tout de suite sinon (lien profond, pas de splash). */
function splashAfter(fn) { if (SPL.el && !SPL.short) document.addEventListener('splashend', () => setTimeout(fn, 0), { once: true }); else setTimeout(fn, 0); }
(function splashBoot() {
  if (typeof document === 'undefined') return;
  const de = document.documentElement;
  try { const t = JSON.parse(localStorage.getItem('deckdeal:v1') || '{}').theme; if (t === 'light' || t === 'dark') de.setAttribute('data-theme', t); } catch (e) { /* stockage absent */ }      // thème dès la 1re image
  const el = document.getElementById('splash'); if (!el) return;
  let m = 'none'; try { m = splashMode(splashEnv()); } catch (e) { /* ignore */ }
  if (m === 'none') { el.remove(); return; }
  SPL.el = el; SPL.short = m === 'short'; try { SPL.rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }
  if (SPL.short) el.classList.add('sp-short'); if (SPL.rm) el.classList.add('sp-rm');
  de.classList.add('sp-on');
  try { SPL.mo = new MutationObserver(ms => ms.forEach(r => r.addedNodes.forEach(splashHold))); SPL.mo.observe(document.body, { childList: true }); } catch (e) { /* ignore */ }
  const skip = () => { if (SPL.el && !SPL.end) { SPL.skip = true; splashCheck(); } }, kill = () => { if (SPL.el) splashRemove(); };
  el.addEventListener('pointerdown', skip); addEventListener('keydown', e => { if (SPL.el && !SPL.end) { e.preventDefault(); skip(); } }, true);      // sans agir dessous
  el.addEventListener('wheel', e => e.preventDefault(), { passive: false });
  document.addEventListener('visibilitychange', () => { if (document.hidden) kill(); });      // arrière-plan, bfcache
  addEventListener('pagehide', kill);
  splashStart();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', splashReady); else splashReady();
})();
if (typeof module !== 'undefined' && module.exports) module.exports = { splashMode, SPLASH_T, SPLASH_KEEP };
