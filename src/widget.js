/* ── widget.js : widget d'écran d'accueil (appli Android) ──────────────────────────────────────────────────────────────
   La coque Android affiche la valeur de la collection sur l'écran d'accueil du téléphone (ValueWidget.java). Le site lui confie les chiffres
   de l'orbe de l'accueil par le plugin local ManaOrbit : setWidget({ data: JSON { v: centimes, d: variation (centimes) | null, dd: sa durée en jours,
   n: cartes, at: date, h: [[t, centimes], …] relevés des 30 derniers jours (courbe du grand widget), b: bouton 'scan' | 'quick', lang: 'fr' | 'en', cur: 'EUR' },
   coll?: JSON { pa: date du fichier de prix, c: [[clé, exemplaires, prix du fichier en centimes], …] } }), gardé par la coque (SharedPreferences) pour quand l'appli est fermée.
   coll (coque récente avec un widget posé) : la coque relit chaque jour le fichier de prix du serveur et applique son évolution à v (valeur « estimée »).
   Envoyé en différé après les repeints de l'accueil : une fois au lancement, puis seulement quand un chiffre change. Widget touché : la coque envoie « open »
   → la collection ; son bouton → le scan ou le prix rapide (Réglages › Widget). Dans un navigateur, la PWA ou une APK sans ce plugin : rien. */
const WGT = { t: 0, sig: '', on: false, bg: false, pxTry: 0, retry: 0, btn: '' };
const WGT_BTN_KEY = 'deckdeal:widget:btn', WGT_COLL_MAX = 1500, WGT_DAYS = 30;
/** Appelé à chaque repeint de l'accueil (homePaint) : pendant la lecture des prix les repeints arrivent en rafale, on attend qu'ils se calment. */
function widgetSoon(ms = 1500) {
  const pl = natPlugin('ManaOrbit'); if (!pl) return;
  widgetListen(pl); clearTimeout(WGT.t); WGT.t = setTimeout(widgetPush, ms);
}
/** Bouton du widget choisi dans les réglages : 'scan' (par défaut) ou 'quick'. Gardé sur cet appareil seulement. */
function widgetBtn() {
  if (!WGT.btn) { try { WGT.btn = localStorage.getItem(WGT_BTN_KEY) === 'quick' ? 'quick' : 'scan'; } catch (e) { WGT.btn = 'scan'; } }
  return WGT.btn;
}
/** Variation affichée par le widget. Collection inchangée sur 7 jours : la variation des relevés (= l'orbe de l'accueil, prix seuls).
 *  Sinon les relevés comptent aussi les cartes ajoutées (un achat passerait pour une hausse) : variation du marché seul (valMovers, prix carte par carte
 *  depuis la référence, cartes ajoutées exclues), avec sa vraie durée ; à défaut celle des relevés. */
function widgetDelta() {
  const h = histDelta(VAL.hist, 7);
  if (h && h.from.n === h.to.n && h.from.q === h.to.q) return { d: Math.round(h.d), dd: 7 };
  const mv = valMovers();
  if (mv && mv.ready) return { d: Math.round(mv.total), dd: Math.max(1, Math.round((VAL.at - mv.since) / DAY)) };
  return h ? { d: Math.round(h.d), dd: 7 } : null;
}
/** Relevés des 30 derniers jours (un par jour) pour la courbe du grand widget : [[t, centimes], …]. */
function widgetPoints() {
  const h = VAL.hist, end = h.length ? h[h.length - 1].t : 0;
  return h.filter(x => x.t >= end - WGT_DAYS * DAY).slice(-(WGT_DAYS + 1)).map(x => [x.t, Math.round(x.v)]);
}
/** Chiffres du widget, calculés comme ceux de l'orbe (homeValue) ; null tant que la valeur n'est pas connue
 *  (cartes sans prix ni relevé : le widget garde les chiffres précédents plutôt que d'afficher 0 €). Collection vide : n = 0 → le widget invite à ouvrir l'appli. */
function widgetData() {
  const n = collCount(), v = n ? Math.round(homeValue()) : 0;
  if (n && !(v > 0)) return null;
  const dl = n ? widgetDelta() : null;
  return { v, d: dl ? dl.d : null, dd: dl ? dl.dd : 7, n, h: n ? widgetPoints() : [], b: widgetBtn(), lang: I18N.lang === 'fr' ? 'fr' : 'en', cur: 'EUR' };
}
/** Cartes pour l'estimation appli fermée : [clé, exemplaires, prix du fichier de prix], les plus grosses valeurs d'abord, WGT_COLL_MAX au plus (≈ 50 Ko,
 *  le reste pèse peu dans le total). Prix du fichier, pas ceux de l'appli : la coque relira ce même fichier et n'en gardera que l'évolution.
 *  null sans fichier de prix en mémoire : il est demandé (au plus toutes les 30 min), l'envoi suivant l'aura ; serveur pas encore joint : un nouvel essai 10 s après. */
function widgetColl() {
  const tab = PXT && Date.now() - PXT.t < TAB_TTL ? PXT : null;
  if (!tab) {
    if (Date.now() - WGT.pxTry > 30 * 60e3) {
      WGT.pxTry = Date.now();
      pxTable().then(t => { if (t) widgetSoon(0); else if (!CTX.proxy && !WGT.retry) { WGT.pxTry = 0; WGT.retry = setTimeout(() => widgetSoon(0), 10000); } }).catch(() => {});
    }
    return null;
  }
  const c = [];
  for (const [k, x] of Object.entries(COLL.map)) { const p = tab.map.get(k); if (p && p.e > 0 && x.q > 0) c.push([k, x.q, p.e]); }
  if (!c.length) return null;
  c.sort((a, b) => b[1] * b[2] - a[1] * a[2] || (a[0] < b[0] ? -1 : 1));
  return { pa: tab.at, c: c.slice(0, WGT_COLL_MAX) };
}
async function widgetPush() {
  WGT.t = 0;
  const pl = natPlugin('ManaOrbit'), o = pl && widgetData(); if (!o) return;
  const coll = WGT.bg && o.n ? widgetColl() : null;
  const sig = JSON.stringify([o, coll]); if (sig === WGT.sig) return;              // la date (at) n'entre pas dans la comparaison : rien n'a changé
  WGT.sig = sig;
  const arg = { data: JSON.stringify({ v: o.v, d: o.d, dd: o.dd, n: o.n, at: Date.now(), h: o.h, b: o.b, lang: o.lang, cur: o.cur }) };
  if (coll) arg.coll = JSON.stringify(coll);                                          // absent : la coque arrête l'estimation jusqu'au prochain envoi complet
  try { await pl.setWidget(arg); }
  catch (e) { if (WGT.sig === sig) WGT.sig = ''; }                                  // refusé : renvoyé au prochain repeint
}
/** Coque récente (info().widgetRefresh) avec au moins un widget posé : la liste des cartes part avec les chiffres. Relu au retour sur l'appli (widget posé entre-temps). */
function widgetCaps(pl) {
  Promise.resolve().then(() => pl.info()).then(i => { const bg = !!(i && i.widgetRefresh && i.widgets > 0); if (bg !== WGT.bg) { WGT.bg = bg; widgetSoon(); } }).catch(() => { /* ancienne coque : sans info() */ });
}
/** Vues ouvertes par le widget : lui-même → la collection ; son bouton → le scan, ou le scan en « prix rapide » (comme la tuile de l'accueil).
 *  Scan déjà ouvert (appli ramenée devant) : on change seulement de mode, sans perdre les cartes lues. */
const WGT_OPEN = {
  collection: () => { if (!COLL.el) openCollection(); },
  scan: () => { if (SC.el) scanPriceMode(false); else openScan(); },
  quick: () => { if (!SC.el) openScan(); scanPriceMode(true); },
};
/** Une seule fois : widget touché → événement « open » ({ view }), que la coque garde tant que la page ne l'écoute pas (lancement à froid) ;
 *  appli mise en arrière-plan → ce qui attendait part tout de suite (la page peut être suspendue avant la fin du délai). */
function widgetListen(pl) {
  if (WGT.on) return; WGT.on = true;
  try { if (typeof pl.addListener === 'function') pl.addListener('open', e => { const go = e && Object.prototype.hasOwnProperty.call(WGT_OPEN, e.view) ? WGT_OPEN[e.view] : null; if (go) setTimeout(go, 500); }); } catch (e) { /* ancienne coque */ }
  widgetCaps(pl);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (WGT.t) { clearTimeout(WGT.t); widgetPush(); } }
    else if (!WGT.bg) widgetCaps(pl);
  });
}
/** Réglages › Widget (appli Android, emplacement #widgetBox) : le bouton du widget ouvre le scan ou le prix rapide. Choix gardé sur l'appareil, envoyé aussitôt à la coque. */
function widgetSettings(el) {
  const pl = natPlugin('ManaOrbit'); if (!el || !pl) return;                        // APK sans le plugin du widget : rien à régler
  el.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  el.innerHTML = `<div class="sec-title">${T('Widget')}</div>
    <p class="hint">${T('Le bouton du widget d\'écran d\'accueil ouvre :')}</p>
    <div class="seg" id="segWidgetBtn" role="radiogroup" aria-label="${esc(T('Bouton du widget'))}"></div>
    <p class="hint" id="widgetBgHint"${WGT.bg ? '' : ' hidden'}>${T('Appli fermée, le widget estime la valeur chaque jour d\'après les prix Cardmarket (Wi-Fi de préférence) : « ≈ » et « estimée » jusqu\'à ta prochaine visite.')}</p>`;
  mountSeg($('#segWidgetBtn', el), [{ v: 'scan', label: T('Scanner'), sub: T('ajouter des cartes') }, { v: 'quick', label: T('Prix rapide'), sub: T('sans les ajouter') }], widgetBtn(), v => {
    WGT.btn = v === 'quick' ? 'quick' : 'scan';
    try { localStorage.setItem(WGT_BTN_KEY, WGT.btn); } catch (e) { /* stockage indisponible : choix gardé pour cette session */ }
    widgetSoon(0);
  });
}
