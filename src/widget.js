/* ── widget.js : widget d'écran d'accueil (appli Android) ──────────────────────────────────────────────────────────────
   La coque Android affiche la valeur de la collection sur l'écran d'accueil du téléphone (ValueWidget.java). Le site lui confie les chiffres
   de l'orbe de l'accueil par le plugin local ManaOrbit : setWidget({ data: JSON { v: centimes, d: variation 7 j (centimes) | null, n: cartes,
   at: date, lang: 'fr' | 'en', cur: 'EUR' } }), gardé par la coque (SharedPreferences) pour quand l'appli est fermée.
   Envoyé en différé après les repeints de l'accueil : une fois au lancement, puis seulement quand un chiffre change. Widget touché : la coque envoie « open » → la collection.
   Dans un navigateur, la PWA ou une APK sans ce plugin : rien. */
const WGT = { t: 0, sig: '', on: false };
/** Appelé à chaque repeint de l'accueil (homePaint) : pendant la lecture des prix les repeints arrivent en rafale, on attend qu'ils se calment. */
function widgetSoon(ms = 1500) {
  const pl = natPlugin('ManaOrbit'); if (!pl) return;
  widgetListen(pl); clearTimeout(WGT.t); WGT.t = setTimeout(widgetPush, ms);
}
/** Chiffres du widget, calculés comme ceux de l'orbe (homeValue, histDelta) ; null tant que la valeur n'est pas connue
 *  (cartes sans prix ni relevé : le widget garde les chiffres précédents plutôt que d'afficher 0 €). Collection vide : n = 0 → le widget invite à ouvrir l'appli. */
function widgetData() {
  const n = collCount(), v = n ? Math.round(homeValue()) : 0;
  if (n && !(v > 0)) return null;
  const h = n ? histDelta(VAL.hist, 7) : null;
  return { v, d: h ? Math.round(h.d) : null, n, lang: I18N.lang === 'fr' ? 'fr' : 'en', cur: 'EUR' };
}
async function widgetPush() {
  WGT.t = 0;
  const pl = natPlugin('ManaOrbit'), o = pl && widgetData(); if (!o) return;
  const sig = JSON.stringify(o); if (sig === WGT.sig) return;                      // la date (at) n'entre pas dans la comparaison : rien n'a changé
  WGT.sig = sig;
  try { await pl.setWidget({ data: JSON.stringify({ v: o.v, d: o.d, n: o.n, at: Date.now(), lang: o.lang, cur: o.cur }) }); }
  catch (e) { if (WGT.sig === sig) WGT.sig = ''; }                                  // refusé : renvoyé au prochain repeint
}
/** Une seule fois : widget touché → événement « open » ({ view: 'collection' }), que la coque garde tant que la page ne l'écoute pas (lancement à froid) ;
 *  appli mise en arrière-plan → ce qui attendait part tout de suite (la page peut être suspendue avant la fin du délai). */
function widgetListen(pl) {
  if (WGT.on) return; WGT.on = true;
  try { if (typeof pl.addListener === 'function') pl.addListener('open', e => { if (e && e.view === 'collection') setTimeout(() => { if (!COLL.el) openCollection(); }, 500); }); } catch (e) { /* ancienne coque */ }
  document.addEventListener('visibilitychange', () => { if (document.hidden && WGT.t) { clearTimeout(WGT.t); widgetPush(); } });
}
