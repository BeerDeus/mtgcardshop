/* ── motion.js : mouvement et retours au toucher ────────────────────────────────────────────────────────────────
   · Carte en grand : elle part de la vignette touchée et y revient en se fermant (FLIP, Web Animations).
   · Cartes « foil » (.tilt : carte en grand, commandant, couvertures de decks) : inclinaison 3D et reflet qui suivent le doigt ou la souris.
   · Entrées en cascade (.stg) : listes et grilles arrivent ligne après ligne quand un écran ou un onglet s'ouvre (14 premières seulement).
   · En-têtes des écrans plein format : filet et ombre seulement quand le contenu passe dessous.
   Tout passe par transform / opacity (compositeur, jamais de mise en page) ; « réduire les animations » coupe tout. */
const MO = { press: null, at: 0, tilt: null, raf: 0, pt: null };
const motionOff = () => reduceMotion() || typeof Element === 'undefined' || !Element.prototype.animate;

/* ── Vignette touchée : point de départ de la carte en grand ── */
const PRESS_SEL = '.thumb, .dvc-art, .imgv-v img, .ca-opt';
document.addEventListener('pointerdown', e => {
  const el = e.target && e.target.closest && e.target.closest(PRESS_SEL);
  if (el) { MO.press = el; MO.at = performance.now(); }
}, { capture: true, passive: true });
/** Élément touché il y a moins de 900 ms, encore affiché : origine du FLIP (null sinon). */
function pressOrigin() {
  const el = MO.press; if (!el || !el.isConnected || performance.now() - MO.at > 900) return null;
  const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 ? r : null;
}
/** Anime `el` depuis le rectangle `from` jusqu'à sa place (agrandissement depuis la vignette). */
function flipFrom(el, from, ms = 460) {
  if (!from || motionOff()) return false;
  const was = el.style.transition; el.style.transition = 'none'; el.style.transform = 'none';
  const to = el.getBoundingClientRect(); el.style.transform = ''; void el.offsetWidth; el.style.transition = was;
  if (!to.width) return false;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2), s = from.width / to.width;
  el.animate([{ transform: `translate(${dx}px,${dy}px) scale(${s})`, opacity: 0.5 }, { transform: 'none', opacity: 1 }], { duration: ms, easing: 'cubic-bezier(.22,1.12,.36,1)' });      // léger dépassement : la carte « se pose »
  return true;
}
/** Retour vers le rectangle `to` (fermeture). */
function flipTo(el, to, ms = 300) {
  if (!to || motionOff()) return false;
  const r = el.getBoundingClientRect(); if (!r.width) return false;
  const dx = to.left + to.width / 2 - (r.left + r.width / 2), dy = to.top + to.height / 2 - (r.top + r.height / 2), s = to.width / r.width;
  el.animate([{ transform: getComputedStyle(el).transform === 'none' ? 'none' : getComputedStyle(el).transform, opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(${s})`, opacity: 0.4 }], { duration: ms, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  return true;
}

/* ── Inclinaison foil ── */
function tiltReset(el) { if (!el) return; el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.classList.remove('tilting'); }
function tiltPaint() {
  MO.raf = 0; const el = MO.tilt, p = MO.pt; if (!el || !p) return;
  const r = el.getBoundingClientRect(); if (!r.width) return;
  const x = Math.min(1, Math.max(0, (p.x - r.left) / r.width)), y = Math.min(1, Math.max(0, (p.y - r.top) / r.height)), max = el.classList.contains('imgv-card') ? 9 : 7;
  el.style.setProperty('--rx', ((0.5 - y) * max).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((x - 0.5) * max).toFixed(2) + 'deg');
  el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
  el.classList.add('tilting');
}
function tiltMove(e) {
  if (motionOff()) return;
  const el = e.target && e.target.closest && e.target.closest('.tilt');
  if (el !== MO.tilt) { tiltReset(MO.tilt); MO.tilt = el; }
  if (!el) return;
  MO.pt = { x: e.clientX, y: e.clientY };
  if (!MO.raf) MO.raf = requestAnimationFrame(tiltPaint);
}
document.addEventListener('pointermove', tiltMove, { passive: true });
document.addEventListener('pointerdown', tiltMove, { passive: true });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'scroll']) document.addEventListener(ev, e => { if (ev !== 'pointerup' || e.pointerType !== 'mouse') { tiltReset(MO.tilt); MO.tilt = null; } }, { passive: true, capture: ev === 'scroll' });

/* ── Entrées en cascade ── */
/** Rejoue l'arrivée en cascade des enfants de chaque conteneur (listes, grilles) : seulement à l'ouverture d'un écran, d'un onglet, d'un tri. */
function stagger(...els) {
  if (motionOff()) return;
  for (const el of els.flat()) { if (!el) continue; el.classList.remove('stg'); void el.offsetWidth; el.classList.add('stg'); }
}

/* ── En-têtes des écrans plein format ── */
document.addEventListener('scroll', e => {
  const sc = e.target; if (!sc || !sc.classList || !sc.classList.contains('dv-scroll')) return;
  const dv = sc.closest('.dv'); if (dv) dv.classList.toggle('scrolled', sc.scrollTop > 4);
}, { capture: true, passive: true });
