/* ── splash.js : écran de lancement ─────────────────────────────────────────────────────────────────────────────
   Script à part, posé par build.mjs juste après #splash en haut du <body> : il tourne avant le gros script, donc avant la première image
   (thème enregistré appliqué tout de suite, choix du mode). Visuels interchangeables : #splash (body.html) + src/css/splash.css.
   Contrat · #splash : .sp-short / .sp-rm (dès le départ), .sp-in (première image : la chorégraphie part), .sp-idle (plafond atteint, appli pas prête),
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
const SPL = { el: null, short: false, rm: false, ready: false, min: false, skip: false, end: false, held: [], mo: null, tm: [] };
function splashEnv() {
  let nav = ''; try { nav = performance.getEntriesByType('navigation')[0].type; } catch (e) { /* navigateur ancien */ }
  return { search: location.search, webdriver: navigator.webdriver === true, hidden: document.visibilityState === 'hidden', nav };
}
const splashMark = n => { try { performance.mark('splash:' + n); } catch (e) { /* ignore */ } };
/** Sous le splash, rien n'est atteignable au clavier : chaque enfant du <body> (appli, feuilles, toasts, accueil du premier lancement) est inerte. */
function splashHold(n) { if (n.nodeType === 1 && n !== SPL.el && !/^(script|style|svg)$/i.test(n.nodeName) && !n.inert) { n.inert = true; SPL.held.push(n); } }
function splashRelease() {
  if (SPL.mo) { SPL.mo.disconnect(); SPL.mo = null; }
  const busy = (typeof sheets !== 'undefined' && sheets.length) || (typeof appHolds !== 'undefined' && appHolds);      // feuille ouverte par un lien profond : l'appli reste inerte dessous
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
  if (document.activeElement === document.body) { const c = document.querySelector('.sheet-wrap.open [data-close].icon-btn'); if (c) c.focus({ preventScroll: true }); }      // la feuille n'a pas pu se donner le focus sous le splash
  document.dispatchEvent(new Event('splashend'));
}
/** Paires [élément du splash, cible] du passage à l'accueil ; null si une cible manque, sort de l'écran ou est couverte (accueil du premier lancement, feuille, autre écran). */
function splashPairs(el) {
  if (!Element.prototype.animate) return null;
  const out = []; el.style.pointerEvents = 'none';
  for (const s of el.querySelectorAll('[data-sp-to]')) {
    const d = document.querySelector('#app ' + s.dataset.spTo), r = d && d.getBoundingClientRect();
    if (!r || r.width < 8 || r.top < 0 || r.bottom > innerHeight) return null;
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!h || !(d.contains(h) || h.contains(d))) return null;
    out.push([s, d]);
  }
  return out.length ? out : null;
}
function splashMorph(el, pairs, D) {
  for (const [s, d] of pairs) {
    for (const a of d.getAnimations({ subtree: true })) if (a.animationName && a.effect.getTiming().iterations !== Infinity) a.finish();      // entrée de la cible (l'orbe qui grossit) : déjà en place
    const a = s.getBoundingClientRect(), b = d.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(s).transform);
    s.animate([{ transform: m.toString() }, { transform: `translate(${b.left + b.width / 2 - a.left - a.width / 2}px,${b.top + b.height / 2 - a.top - a.height / 2}px) scale(${m.a * b.width / a.width})` }], { duration: D, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'forwards' });
    s.animate([{ opacity: 1 }, { opacity: 1, offset: 0.74 }, { opacity: 0 }], { duration: D, fill: 'forwards' });
    d.animate([{ opacity: 0 }, { opacity: 0, offset: 0.74 }, { opacity: 1, offset: 0.741 }, { opacity: 1 }], { duration: D });      // posé : la cible apparaît d'un coup sous le splash identique, qui s'efface dessus (pas de creux de fondu croisé)
  }
}
/** Sortie : vol vers l'accueil si tout est en place, sinon fondu (agrandi). fast : toucher, plafond absolu. */
function splashHandoff(fast) {
  const el = SPL.el; if (!el || SPL.end) return;
  SPL.end = true; SPL.tm.forEach(clearTimeout); splashMark('out'); splashRelease();
  const quick = fast || SPL.rm, D = SPL.rm ? SPLASH_T.fade : fast ? SPLASH_T.fast : SPL.short ? SPLASH_T.outShort : SPLASH_T.out;
  el.style.setProperty('--sp-out', D + 'ms');
  if (typeof window.splashHandoffX === 'function') { try { if (window.splashHandoffX(el, !quick, splashRemove)) { splashPlay(); return; } } catch (e) { /* sortie par défaut */ } }
  const pairs = quick || SPL.short ? null : splashPairs(el);      // lien profond : il mène ailleurs que l'accueil (l'écran s'ouvre pendant la sortie), simple fondu
  el.classList.add('sp-out'); if (pairs) { el.classList.add('sp-morph'); splashMorph(el, pairs, D); }
  SPL.tm = [setTimeout(splashPlay, pairs ? D * 0.3 : 0), setTimeout(splashRemove, D + 40)];      // vol : l'accueil entre quand l'orbe a quitté le centre (les tuiles ne passent pas dessous)
}
/** Décor généré (moins d'octets que du balisage) : 22 étoiles, 18 étincelles de l'allumage, lettres du nom (montée et reflet lettre à lettre). */
function splashBuild(el) {
  let z = 7, h = ''; const R = () => (z = z * 16807 % 2147483647) / 2147483647, F = n => +n.toFixed(2), K = ['#fff', '#ffd479', '#ff8fc3', '#7be8c8', '#7fb0ff', '#c79bff'], q = c => el.querySelector(c);
  for (let i = 0; i < 18; i++) h += `<i style="--a:${i * 20 + R() * 14 | 0}deg;--d:${90 + R() * 120 | 0}px;--f:${70 + R() * 80 | 0}px;--u:${F(0.5 + R() * 0.4)}s;--k:${K[i % 6]}"></i>`;
  q('.sp-p').innerHTML = h; h = '';
  for (let i = 0; i < 22; i++) h += `<b style="left:${F(R() * 100)}%;top:${F(R() * 100)}%;--z:${F(1 + R() * 1.8)}px;--o:${F(0.35 + R() * 0.6)};--w:${F(0.55 + R() * 0.7)}s"></b>`;
  q('.sp-sky').innerHTML = h;
  const w = q('.sp-word'); if (w) w.innerHTML = [...w.textContent].map((l, i) => l === ' ' ? ' ' : `<span style="--i:${i};--k:${K[i % 5 + 1]}" data-l="${l}">${l}</span>`).join('');
}
function splashCheck() { if (SPL.ready && (SPL.min || SPL.skip)) splashHandoff(SPL.skip); }
function splashStart() {
  const el = SPL.el; if (!el || SPL.end) return;
  el.classList.add('sp-in'); splashMark('in');
  if (SPL.short && !SPL.rm) for (const a of el.getAnimations({ subtree: true })) if (a.effect.target !== el) { a.currentTime = 340; a.playbackRate = 2.2; }      // version courte : l'allumage tout de suite, comètes en place vers 0,4 s
  const T = SPLASH_T, min = SPL.rm ? T.rm : SPL.short ? T.short : T.min;
  SPL.tm.push(setTimeout(() => { SPL.min = true; splashCheck(); }, min),
    setTimeout(() => { if (!SPL.end) el.classList.add('sp-idle'); }, SPL.short || SPL.rm ? min : T.cap),      // appli pas prête : boucle d'attente calme
    setTimeout(() => splashHandoff(true), T.max));
}
/** Appli prête : page lue et exécutée (DOMContentLoaded : init() et l'accueil sont peints), polices chargées (0,7 s au plus), deux images. */
function splashReady() {
  const go = () => requestAnimationFrame(() => requestAnimationFrame(() => { SPL.ready = true; splashCheck(); }));
  try { void document.body.offsetHeight; Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 700))]).then(go, go); } catch (e) { go(); }
}
(function splashBoot() {
  if (typeof document === 'undefined') return;
  const de = document.documentElement;
  try { const t = JSON.parse(localStorage.getItem('deckdeal:v1') || '{}').theme; if (t === 'light' || t === 'dark') de.setAttribute('data-theme', t); } catch (e) { /* stockage absent */ }      // thème choisi dès la première image
  const el = document.getElementById('splash'); if (!el) return;
  let m = 'none'; try { m = splashMode(splashEnv()); } catch (e) { /* ignore */ }
  if (m === 'none') { el.remove(); return; }
  SPL.el = el; SPL.short = m === 'short'; try { SPL.rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }
  if (SPL.short) el.classList.add('sp-short'); if (SPL.rm) el.classList.add('sp-rm');
  try { splashBuild(el); } catch (e) { /* décor seulement */ }
  de.classList.add('sp-on');
  try { SPL.mo = new MutationObserver(ms => ms.forEach(r => r.addedNodes.forEach(splashHold))); SPL.mo.observe(document.body, { childList: true }); } catch (e) { /* ignore */ }
  const skip = () => { if (SPL.el && !SPL.end) { SPL.skip = true; splashCheck(); } }, kill = () => { if (SPL.el) splashRemove(); };
  el.addEventListener('pointerdown', skip); addEventListener('keydown', e => { if (SPL.el && !SPL.end) { e.preventDefault(); skip(); } }, true);      // la touche passe le splash, sans agir sur l'appli dessous
  el.addEventListener('wheel', e => e.preventDefault(), { passive: false });
  document.addEventListener('visibilitychange', () => { if (document.hidden) kill(); });      // arrière-plan, bfcache : jamais au retour
  addEventListener('pagehide', kill);
  requestAnimationFrame(splashStart);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', splashReady); else splashReady();
})();
if (typeof module !== 'undefined' && module.exports) module.exports = { splashMode, SPLASH_T, SPLASH_KEEP };
