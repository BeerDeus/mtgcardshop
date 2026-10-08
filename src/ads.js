/* ── ads.js : bandeau de pub (appli Android) ──────────────────────────────────────────────────────
   Un petit bandeau Google AdMob en HAUT de l'écran paie l'hébergement. Seulement dans l'appli Android (plugin AdMob) : rien sur le web ni la PWA.
   Jamais pour un compte autorisé (CTX.serverOk : ALLOWED_UIDS du serveur) ; s'il était affiché, il est détruit dès que checkServer() le confirme.
   Règle « de temps en temps », simple et discrète :
   · rien au lancement : le bandeau n'arrive qu'après AD.delay (6 s) d'appli au calme, session revenue et compte vérifié (jamais montré au
     propriétaire le temps de la vérification), consentement réglé ;
   · il reste ensuite en place sur les écrans principaux (accueil, collection, decks, feuilles) : un bandeau qui clignote ferait sauter la page
     sous le doigt et provoquerait des clics accidentels (règles AdMob) ;
   · masqué pendant l'accueil du premier lancement, le scan (surtout l'aperçu natif, html.nat-cam) et la carte en grand ; il revient AD.back
     après leur fermeture, jamais pendant un toucher (AD.idle) ;
   · l'annonce se renouvelle au rythme réglé dans la console AdMob ; aucune annonce reçue : nouvel essai AD.retry plus tard.
   Consentement (UE) : formulaire UMP de Google avant le premier chargement ; le SDK applique la réponse (annonces personnalisées ou non) ;
   consentement impossible (canRequestAds faux) : aucune pub de la session.
   Rien n'est recouvert : la page descend de la hauteur du bandeau (bannerAdSizeChanged → html.ad-on + --ad-h, voir css/ads.css). */
const AD_TEST = 'ca-app-pub-3940256099942544/6300978111';      // bandeau de TEST de Google, tant que le serveur n'a pas d'ADMOB_BANNER_ID
/** st : 'off' (aucun bandeau) · 'on' (affiché ou en chargement) · 'hid' (masqué, prêt à revenir). Délais en ms (réduits par les tests). */
const AD = { on: false, st: 'off', ok: false, no: false, srv: null, priv: '', calm: 0, touch: 0, next: 0, timer: 0, pend: false, q: Promise.resolve(),
  delay: 6000, back: 800, idle: 1200, retry: 180000 };

/** Réévalue le bandeau (afficher, masquer, détruire). Appelée par checkServer() quand le compte change ; les appels sont groupés et passent un par un. */
function adsRefresh() {
  if (!AD.on || AD.pend) return; AD.pend = true;
  AD.q = AD.q.then(() => { AD.pend = false; return adsStep(); }).catch(() => {});
}
function adsLater(ms) { clearTimeout(AD.timer); AD.timer = setTimeout(adsRefresh, Math.max(50, ms)); }
function adsRetry() { AD.next = Date.now() + AD.retry; adsLater(AD.retry); }
/** Appel sans réponse attendue (masquer, rétablir, retirer) : jamais d'erreur, et 4 s au plus pour ne pas bloquer la file. */
const adsCall = (P, m) => Promise.race([Promise.resolve().then(() => P[m]({})).catch(() => null), new Promise(r => setTimeout(r, 4000))]);
/** Marge du haut de la page = hauteur du bandeau (px CSS) ; 0 : retirée. */
function adsPad(h) {
  const r = document.documentElement; r.classList.toggle('ad-on', h > 0);
  if (h > 0) r.style.setProperty('--ad-h', h + 'px'); else r.style.removeProperty('--ad-h');
}
/** Écran plein où la pub n'a pas sa place : accueil du premier lancement, scan (aperçu natif compris), carte en grand. */
const adsBusy = () => !!(OB.el || SC.el || imgView || document.documentElement.classList.contains('nat-cam'));

/** Réglages du serveur (/__ping) : bloc d'annonces (ADMOB_BANNER_ID, vide = test) et comptes autorisés à attendre. null : injoignable. */
async function adsServer() {
  try {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('__ping', { cache: 'no-store', signal: ctrl.signal }); clearTimeout(t);
    const j = r.ok ? await r.json() : null; if (!j || j.app !== 'deckdeal') return null;
    return { unit: typeof j.adUnit === 'string' ? j.adUnit.trim() : '', login: !!j.needsLogin && j.hasToken !== false };
  } catch (e) { return null; }
}

/** Consentement UMP (à chaque lancement, comme le demande Google), puis SDK initialisé une seule fois. true : des annonces peuvent être demandées. */
async function adsConsent(P) {
  let c = await P.requestConsentInfo({});
  if (c && c.isConsentFormAvailable && c.status === 'REQUIRED') c = await P.showConsentForm({});
  AD.priv = (c && c.privacyOptionsRequirementStatus) || '';
  if (!c || !c.canRequestAds) return false;
  await P.initialize({ maxAdContentRating: 'Teen' });      // appli « 13 ans et plus » : pas d'annonce pour adultes
  const on = (ev, fn) => { try { const h = P.addListener(ev, fn); if (h && h.catch) h.catch(() => {}); } catch (e) { /* ignore */ } };
  on('bannerAdSizeChanged', s => { const h = Math.max(0, Math.round((s && s.height) || 0)); if (!h || AD.st === 'on') adsPad(h); });      // masqué : la hauteur d'un chargement tardif n'ouvre pas la marge
  on('bannerAdFailedToLoad', () => { if (AD.st === 'off') return; AD.st = 'off'; adsPad(0); adsRetry(); });      // le plugin a déjà retiré le bandeau
  return true;
}

async function adsStep() {
  const P = natPlugin('AdMob'); if (!P) return;
  const now = Date.now(), busy = adsBusy();
  if (busy) AD.calm = 0; else if (!AD.calm) AD.calm = now;
  if (CTX.serverOk === true || AD.no) {                                                    // compte autorisé, ou pub refusée : bandeau détruit
    if (AD.st !== 'off') { AD.st = 'off'; adsPad(0); await adsCall(P, 'removeBanner'); }
    return;
  }
  if (busy) {
    if (AD.st === 'off') return;
    adsPad(0);                                                                             // la marge part avant tout (l'aperçu de la caméra se place d'après la page)
    // Scan : la caméra native remet la page au premier plan et y reste ; un bandeau seulement masqué reviendrait DESSOUS (invisible mais rafraîchi). On le détruit : le prochain showBanner le recrée au-dessus.
    if (typeof SC !== 'undefined' && SC.el) { AD.st = 'off'; await adsCall(P, 'removeBanner'); }
    else if (AD.st === 'on') { AD.st = 'hid'; await adsCall(P, 'hideBanner'); }
    return;
  }
  if (AD.st === 'on' || document.hidden) return;
  const wait = Math.max(AD.touch + AD.idle, AD.st === 'hid' ? AD.calm + AD.back : Math.max(AD.calm + AD.delay, AD.next)) - now;
  if (wait > 0) return adsLater(wait);
  if (AD.st === 'hid') { AD.st = 'on'; await adsCall(P, 'resumeBanner'); return; }       // la marge revient avec bannerAdSizeChanged
  if (!AD.srv && !(AD.srv = await adsServer())) return adsRetry();
  if (AD.srv.login && !(CTX.serverOk === false && D.authReady)) return adsLater(1500);    // session ou compte en cours de vérification (checkServer() rappelle aussi adsRefresh())
  if (!AD.ok) {
    try { AD.ok = await adsConsent(P); } catch (e) { return adsRetry(); }                  // hors ligne… : on redemandera
    if (!AD.ok) AD.no = true;
    return adsRefresh();                                                                   // le formulaire a pu durer : tout est réévalué avant d'afficher
  }
  AD.st = 'on';
  try { await P.showBanner({ adId: AD.srv.unit || AD_TEST, isTesting: !AD.srv.unit, adSize: 'ADAPTIVE_BANNER', position: 'TOP_CENTER', margin: 0 }); }
  catch (e) { AD.st = 'off'; adsRetry(); }
}

/** Réglages › Confidentialité dans l'appli : « aucune publicité » n'y est plus vrai ; « Choix publicitaires » quand Google l'exige (UE). */
function adsPriv(box) {
  if (!box || box.dataset.ads || CTX.serverOk === true || AD.no) return; box.dataset.ads = '1';
  const p = $('.hint', box); if (p) p.textContent = T('Sans compte, tout reste sur cet appareil. L\'appli Android affiche un petit bandeau publicitaire Google AdMob, qui paie l\'hébergement. Aucune mesure d\'audience.');
  const acts = $('.cart-actions', box); if (!acts || AD.priv !== 'REQUIRED') return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost small'; b.id = 'btnAdChoices'; b.textContent = T('Choix publicitaires');
  b.onclick = adsPrivacy; acts.appendChild(b);
}
async function adsPrivacy() {
  const P = natPlugin('AdMob'); if (!P) return; haptic('tap');
  try { await P.showPrivacyOptionsForm({}); const c = await P.requestConsentInfo({}); if (c && !c.canRequestAds) AD.no = true; }
  catch (e) { toast(T('Choix publicitaires indisponibles pour le moment')); }
  adsRefresh();
}

function adsInit() {
  const P = natPlugin('AdMob'); if (AD.on || !P) return;                                  // navigateur, PWA, ou appli sans le plugin : rien du tout
  AD.on = true; AD.calm = Date.now();
  AD.q = adsCall(P, 'removeBanner');                                                       // page rechargée (langue…) : le bandeau natif d'avant ne reste pas sans sa marge
  const mo = new MutationObserver(adsRefresh);
  mo.observe(document.body, { childList: true });                                         // accueil, scan, carte en grand : ajoutés et retirés à la racine
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });  // html.nat-cam
  const sr = $('#sheetRoot'); if (sr) new MutationObserver(() => adsPriv($('#privBox', sr))).observe(sr, { childList: true });
  document.addEventListener('pointerdown', () => { AD.touch = Date.now(); }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', adsRefresh);
  adsLater(AD.delay);
}
if (typeof document !== 'undefined') setTimeout(adsInit, 0);
