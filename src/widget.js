/* ── widget.js : widget d'écran d'accueil (appli Android) ──────────────────────────────────────────────────────────────
   La coque Android affiche la valeur de la collection sur l'écran d'accueil du téléphone (ValueWidget.java). Le site lui confie les chiffres
   de l'orbe de l'accueil par le plugin local ManaOrbit : setWidget({ data: JSON { v: centimes, d: variation (centimes) | null, dd: sa durée en jours,
   n: cartes, at: date, h: [[t, centimes], …] relevés des 30 derniers jours (courbe du grand widget), b: bouton 'scan' | 'quick', lang: langue de l'interface ('fr', 'en', 'de', 'es', 'it', 'pt' ; une coque plus ancienne lit tout sauf 'fr' en anglais), cur: 'EUR' },
   coll?: JSON { pa: date du fichier de prix, c: [[clé, exemplaires, prix du fichier en centimes], …] } }), gardé par la coque (SharedPreferences) pour quand l'appli est fermée.
   coll (coque récente avec un widget posé) : la coque relit chaque jour le fichier de prix du serveur et applique son évolution à v (valeur « estimée »).
   Envoyé en différé après les repeints de l'accueil : une fois au lancement, puis seulement quand un chiffre change. Widget touché : la coque envoie « open »
   → la collection ; son bouton → le scan ou le prix rapide (Réglages › Widget). Dans un navigateur, la PWA ou une APK sans ce plugin : rien.
   Deuxième widget « QR code d'échange » (TradeWidget.java, APK récente : info().tradeWidgets) : setTradeWidget({ data: JSON { u: lien public de la liste d'échange,
   n: côté du QR en modules, m: modules '0'/'1' ligne par ligne (qrMatrix, src/qr.js), by?: pseudo, lang } }) ; { u: '', lang } sans lien. Toucher → l'onglet Échange. */
const WGT = { t: 0, sig: '', on: false, bg: false, pxTry: 0, retry: 0, btn: '', qr: false, qn: 0, qsig: '' };      // qr : coque avec le widget « QR code d'échange » ; qn : combien en sont posés
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
  return { v, d: dl ? dl.d : null, dd: dl ? dl.dd : 7, n, h: n ? widgetPoints() : [], b: widgetBtn(), lang: I18N.lang, cur: 'EUR' };
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
/** QR code du lien d'échange pour le widget « QR code d'échange » ; { u: '', lang } sans lien (pas encore créé, arrêté, compte déconnecté).
 *  null tant que le compte n'est pas connu (lancement, Firebase injoignable) : la coque garde le code précédent plutôt que « Crée ton lien d'échange ». */
function widgetQr() {
  if (!D.authReady || D.state !== 'ready') return null;
  const id = D.user ? TR.share : '', lang = I18N.lang;
  if (id) {
    try { const u = shareUrl(id), { n, m } = qrMatrix(u); return { u, n, m: m.map(r => r.join('')).join(''), ...(PROF.name ? { by: PROF.name } : {}), lang }; }
    catch (e) { /* lien trop long pour un QR code : comme sans lien */ }
  }
  return { u: '', lang };
}
/** Envoyé quand le lien, le pseudo ou la langue changent ; APK sans ce widget : rien. Refusé : renvoyé au prochain repeint. */
async function widgetQrPush(pl) {
  const q = WGT.qr && typeof pl.setTradeWidget === 'function' ? widgetQr() : null; if (!q) return;
  const data = JSON.stringify(q); if (data === WGT.qsig) return;
  WGT.qsig = data;
  try { await pl.setTradeWidget({ data }); }
  catch (e) { if (WGT.qsig === data) WGT.qsig = ''; }
}
async function widgetPush() {
  WGT.t = 0;
  const pl = natPlugin('ManaOrbit'); if (!pl) return;
  widgetQrPush(pl);
  const o = widgetData(); if (!o) return;
  const coll = WGT.bg && o.n ? widgetColl() : null;
  const sig = JSON.stringify([o, coll]); if (sig === WGT.sig) return;              // la date (at) n'entre pas dans la comparaison : rien n'a changé
  WGT.sig = sig;
  const arg = { data: JSON.stringify({ v: o.v, d: o.d, dd: o.dd, n: o.n, at: Date.now(), h: o.h, b: o.b, lang: o.lang, cur: o.cur }) };
  if (coll) arg.coll = JSON.stringify(coll);                                          // absent : la coque arrête l'estimation jusqu'au prochain envoi complet
  try { await pl.setWidget(arg); }
  catch (e) { if (WGT.sig === sig) WGT.sig = ''; }                                  // refusé : renvoyé au prochain repeint
}
/** Coque récente (info().widgetRefresh) avec au moins un widget posé : la liste des cartes part avec les chiffres. Coque avec le widget « QR code d'échange »
 *  (info().tradeWidgets, nombre posé) : son code part aussi, posé ou non (prêt dès qu'il l'est, appli fermée). Relu au retour sur l'appli (widget posé entre-temps). */
function widgetCaps(pl) {
  Promise.resolve().then(() => pl.info()).then(i => {
    const bg = !!(i && i.widgetRefresh && i.widgets > 0), qr = !!(i && typeof i.tradeWidgets === 'number');
    WGT.qn = qr ? i.tradeWidgets : 0;
    if (bg !== WGT.bg || qr !== WGT.qr) { WGT.bg = bg; WGT.qr = qr; widgetSoon(); }
  }).catch(() => { /* ancienne coque : sans info() */ });
}
/** Vues ouvertes par le widget : lui-même → la collection ; son bouton → le scan, ou le scan en « prix rapide » (comme la tuile de l'accueil) ; widget « QR code d'échange » → trade.
 *  Scan déjà ouvert (appli ramenée devant) : on change seulement de mode, sans perdre les cartes lues.
 *  Raccourcis de l'icône (appli Android : ShortcutActivity ; PWA : manifeste, ?open= lu par handleLaunch) : scan et quick comme le bouton du widget,
 *  trade → l'onglet Échange de la collection, paste → « Nouveau panier ». share : texte partagé vers l'appli Android ({ text, title } : decklist ou lien) → « Nouveau panier ». */
const WGT_OPEN = {
  collection: () => { if (!COLL.el) openCollection(); },
  scan: () => { if (SC.el) scanPriceMode(false); else openScan(); },
  quick: () => { if (!SC.el) openScan(); scanPriceMode(true); },
  trade: () => { wgtFront(); openCollection('trade'); },
  paste: () => wgtPaste(),
  share: e => wgtShare(e),
};
/** Premier contact avec le serveur au lancement (handleLaunch) : un lien partagé à froid l'attend, seul le serveur sait le lire. */
const WGT_LAUNCH = { done: false, q: [] };
function wgtLaunched() {
  WGT_LAUNCH.done = true;
  for (const go of WGT_LAUNCH.q.splice(0)) { try { go(); } catch (e) { /* une cible en échec n'empêche pas les autres */ } }
}
/** Raccourci de la PWA (?open=scan | quick | trade | paste, manifest.webmanifest) : mêmes vues que ceux de l'appli Android. */
function wgtOpen(view) { if (['scan', 'quick', 'trade', 'paste'].includes(view)) WGT_OPEN[view](); }
/** Ferme, comme Retour, ce qui couvre la page (visionneuse, feuilles, collection, decks…) pour montrer la cible ; s'arrête devant un écran
 *  qui perdrait du travail : scan avec des cartes lues, deck modifié dans l'éditeur. */
function wgtFront() {
  for (let i = 0; i < 12; i++) {
    if (typeof imgView !== 'undefined' && imgView) { imgView.close(); continue; }
    if (sheets.length) { sheets[sheets.length - 1].close(); continue; }
    const dvs = $$('body > .dv.on'), top = dvs[dvs.length - 1];
    if (!top || !top.__close || (top === SC.el && SC.items && SC.items.size) || (top === BD.el && BD.dirty)) return;
    if (top === BD.el) bdClose(); else top.__close();
  }
}
/** « Nouveau panier » (raccourci) : la saisie, curseur dans le champ. Liste en cours gardée (comme « Reprendre ma liste »), sinon champ vidé (pas l'exemple).
 *  Pas de lecture du presse-papiers : sans geste de l'utilisateur elle est refusée (WebView) ou demande une autorisation (navigateur). */
function wgtPaste() {
  wgtFront(); showView('input');
  if (!S.isSample && S.deck && S.deck.cards.length) { try { $('#deckText').focus(); } catch (e) { /* ignore */ } return; }
  $('#btnClear').click(); toast(T('Colle la liste dans le champ avec un appui long'));
}
/** Texte partagé vers l'appli Android : même traitement que le partage de la PWA (onShared : decklist collée, ou lien lu par le serveur). */
function wgtShare(e) {
  const sh = extractShared({ title: e && e.title, text: e && e.text });
  const go = () => { wgtFront(); onShared(sh); };
  if (sh.text || !sh.urls.length || WGT_LAUNCH.done) return go();
  WGT_LAUNCH.q.push(go); setTimeout(wgtLaunched, 8000);                             // filet : le contact avec le serveur abandonne au bout de 5 s
}
/** Une seule fois : widget ou raccourci touché, texte partagé → événement « open » ({ view, text?, title? }), que la coque garde tant que la page
 *  ne l'écoute pas (lancement à froid) ; appli mise en arrière-plan → ce qui attendait part tout de suite (la page peut être suspendue avant la fin du délai). */
function widgetListen(pl) {
  if (WGT.on) return; WGT.on = true;
  try { if (typeof pl.addListener === 'function') pl.addListener('open', e => { const go = e && Object.prototype.hasOwnProperty.call(WGT_OPEN, e.view) ? WGT_OPEN[e.view] : null; if (go) { UPD.launchAt = Date.now(); setTimeout(() => go(e), 500); } }); } catch (e) { /* ancienne coque */ }
  widgetCaps(pl);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (WGT.t) { clearTimeout(WGT.t); widgetPush(); } }
    else widgetCaps(pl);
  });
}
/** Réglages › Widget (appli Android, emplacement #widgetBox) : le bouton du widget ouvre le scan ou le prix rapide. Choix gardé sur l'appareil, envoyé aussitôt à la coque. */
function widgetSettings(el) {
  const pl = natPlugin('ManaOrbit'); if (!el || !pl) return;                        // APK sans le plugin du widget : rien à régler
  el.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  el.innerHTML = `<div class="sec-title">${T('Widget')}</div>
    <p class="hint">${T('Le bouton du widget d\'écran d\'accueil ouvre :')}</p>
    <div class="seg" id="segWidgetBtn" role="radiogroup" aria-label="${esc(T('Bouton du widget'))}"></div>
    <p class="hint" id="widgetBgHint"${WGT.bg ? '' : ' hidden'}>${T('Appli fermée, le widget estime la valeur chaque jour d\'après les prix Cardmarket (Wi-Fi de préférence) : « ≈ » et « estimée » jusqu\'à ta prochaine visite.')}</p>
    ${WGT.qr ? `<p class="hint" id="widgetQrHint">${T('Autre widget, « QR code d\'échange » : le QR code de ton lien d\'échange, à faire scanner depuis l\'écran d\'accueil.')}</p>` : ''}`;
  mountSeg($('#segWidgetBtn', el), [{ v: 'scan', label: T('Scanner'), sub: T('ajouter des cartes') }, { v: 'quick', label: T('Prix rapide'), sub: T('sans les ajouter') }], widgetBtn(), v => {
    WGT.btn = v === 'quick' ? 'quick' : 'scan';
    try { localStorage.setItem(WGT_BTN_KEY, WGT.btn); } catch (e) { /* stockage indisponible : choix gardé pour cette session */ }
    widgetSoon(0);
  });
}
