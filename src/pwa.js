/* ── pwa.js : installation de l'app (vraie installation, pas seulement un raccourci) ─────────────
   Chrome/Edge/Android/Samsung : l'événement « beforeinstallprompt » ouvre la fenêtre d'installation du navigateur.
   iPhone/iPad : Apple n'autorise que « Sur l'écran d'accueil » (pas d'installation déclenchable) → on explique le geste.
   Le service worker (sw.js) est ce qui rend l'app installable et la fait s'ouvrir hors ligne, sans attendre le réseau ; il signale une nouvelle version (toast « Recharger »). */
const PWA = (() => {
  let deferred = null, installed = false;
  const subs = new Set(), KEY = 'deckdeal:install-x', QUIET = 30 * 864e5;
  const mq = q => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  const standalone = () => mq('(display-mode: standalone)') || mq('(display-mode: minimal-ui)') || mq('(display-mode: window-controls-overlay)') || (typeof navigator !== 'undefined' && navigator.standalone === true);
  const ios = () => typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const secure = () => typeof location !== 'undefined' && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname));
  const emit = () => subs.forEach(f => { try { f(); } catch (e) { /* ignore */ } });
  /** standalone : déjà ouverte comme une app · installed : installée à l'instant · ready : on peut déclencher l'installation · ios · manual : menu du navigateur · insecure : pas en https */
  function state() {
    if (standalone()) return 'standalone';
    if (installed) return 'installed';
    if (deferred) return 'ready';
    if (ios()) return 'ios';
    return secure() ? 'manual' : 'insecure';
  }
  async function install() {
    if (!deferred) return 'none';
    const d = deferred; deferred = null; emit();             // l'événement n'est utilisable qu'une fois
    try { await d.prompt(); const r = await d.userChoice; return (r && r.outcome) || 'dismissed'; } catch (e) { return 'error'; }
  }
  const quiet = () => { try { const t = Number(localStorage.getItem(KEY)); return !!t && Date.now() - t < QUIET; } catch (e) { return false; } };
  const snooze = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* ignore */ } emit(); };
  /** La bannière n'apparaît que si l'installation est réellement possible (ou expliquable sur iOS) et pas refusée récemment. */
  const wantsBanner = () => { const s = state(); return (s === 'ready' || s === 'ios') && !quiet(); };
  const on = f => { subs.add(f); return () => subs.delete(f); };

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; emit(); });
    window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); try { toast(T('Mana Orbit est installée')); } catch (e) { /* ignore */ } });
    try { matchMedia('(display-mode: standalone)').addEventListener('change', emit); } catch (e) { /* ignore */ }
    // Service worker : seulement en http(s) (pas depuis un fichier local ni un aperçu) ; une erreur ici ne doit jamais gêner l'app.
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      // On vérifie d'abord que sw.js existe vraiment (hébergement statique sans le fichier, aperçu, artifact…) : pas de SW, pas de bruit, l'app marche quand même.
      const reg = async () => {
        try {
          const r = await fetch('sw.js', { method: 'HEAD', cache: 'no-store' });
          if (!r.ok || !/javascript|ecmascript/i.test(r.headers.get('content-type') || '')) return;
          await navigator.serviceWorker.register('sw.js', { scope: './' });
        } catch (e) { /* ignore */ }
      };
      // Nouvelle version : la page a pu venir de la copie locale (ouverture immédiate) ; le service worker dit quelle version il garde
      // une fois sa mise à jour faite. Différente de celle qui tourne → toast « Recharger » (sinon elle servira à la prochaine ouverture).
      navigator.serviceWorker.addEventListener('message', e => {
        const b = e.data && e.data.type === 'dd-shell' && e.data.build;
        // copie gardée différente de la page : c'est la nouvelle version si le serveur l'annonce aussi (rechargement si rien n'est en cours) ;
        // serveur pas encore joint (ou sans version) : « Recharger » seulement ; serveur qui annonce une autre version : copie périmée, ignorée (updCheck s'en charge)
        if (b && (!CTX.build || b === CTX.build)) updCheck(b, true, !!CTX.build);
      });
      const ask = () => { try { const c = navigator.serviceWorker.controller; if (c) c.postMessage({ type: 'dd-shell?' }); } catch (e) { /* ignore */ } };
      const go = () => { reg(); ask(); };
      if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    }
  }
  return { state, install, snooze, wantsBanner, on, standalone, ios };
})();

/* ── Mise à jour de la page ──────────────────────────────────────────────────────────────────────────────────────────
   L'appli Android reste ouverte des jours en arrière-plan : la page n'y est presque jamais rechargée, et le service worker sert d'abord sa copie.
   Au lancement (detectProxy) et à chaque retour sur l'appli après plus d'une minute ailleurs (/__ping, au plus toutes les 5 min), le serveur dit quelle
   version il sert (build). Plus récente que DD_BUILD : la copie du service worker est d'abord relue (« dd-update »), puis la page se recharge d'elle-même
   si rien n'est en cours (accueil, aucun écran, feuille ni carte en grand, aucune recherche ni saisie, aucun toucher depuis 2 s, aucune ouverture par un
   widget, un raccourci, un partage ou un lien depuis 15 s : sa cible serait perdue) ; sinon le toast
   « Nouvelle version · Recharger », et le rechargement se fait au prochain retour sur l'appli. Une seule tentative automatique par version (sessionStorage) :
   jamais de boucle, même si le rechargement retombe sur l'ancienne copie. */
const UPD = { busy: false, at: 0, hid: 0, touch: 0, launchAt: 0, want: '', told: '' };      // launchAt : widget, raccourci, partage ou lien reçu (handleLaunch, widget.js)
const UPD_KEY = 'dd-upd';
function updSafe() {
  const a = document.activeElement;
  return !document.hidden && S.view === 'home' && !document.querySelector('body > .dv, .sheet-wrap, .imgv, .ob') && !(S.run && S.run.status === 'running')
    && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && Date.now() - UPD.touch > 2000 && Date.now() - UPD.launchAt > 15000;
}
/** Copie de la page du service worker relue sur le réseau ; résolue avec la version gardée ('' sans service worker, null si pas de réponse en 10 s). */
function updShell() {
  const c = typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller; if (!c) return Promise.resolve('');
  return new Promise(res => {
    const ch = new MessageChannel(), t = setTimeout(() => res(null), 10000);
    ch.port1.onmessage = e => { clearTimeout(t); res((e.data && e.data.build) || ''); };
    try { c.postMessage({ type: 'dd-update' }, [ch.port2]); } catch (e) { clearTimeout(t); res(null); }
  });
}
/** build : version annoncée (serveur, ou copie du service worker si fresh). Différente de celle qui tourne → rechargement (auto) ou « Recharger ». */
async function updCheck(build, fresh, auto = true) {
  if (!build || typeof DD_BUILD !== 'string' || build === DD_BUILD || UPD.busy) return;
  UPD.busy = true;
  try {
    const kept = fresh ? build : await updShell();
    if (kept !== '' && kept !== build) return;               // la copie n'a pas pu être relue (hors ligne, ancien service worker) : recharger rouvrirait l'ancienne
    UPD.want = build;
    let tried = ''; try { tried = sessionStorage.getItem(UPD_KEY) || ''; } catch (e) { /* stockage indisponible */ }
    if (auto && tried !== build && updSafe()) { try { sessionStorage.setItem(UPD_KEY, build); } catch (e) { /* ignore */ } location.reload(); return; }
    if (UPD.told === build) return; UPD.told = build;
    const show = () => { try { toast(T('Nouvelle version disponible'), { label: T('Recharger'), fn: () => location.reload() }); } catch (x) { /* ignore */ } };
    if (!document.hidden) show();
    else document.addEventListener('visibilitychange', function vis() { if (!document.hidden) { document.removeEventListener('visibilitychange', vis); show(); } });
  } finally { UPD.busy = false; }
}
/** Retour sur l'appli : version demandée au serveur (au plus toutes les 5 min) ; une nouvelle version déjà gardée attend seulement un moment calme. */
async function updResume() {
  if (UPD.want && UPD.want !== DD_BUILD) { UPD.told = ''; setTimeout(() => updCheck(UPD.want, true), 1500); return; }
  if (!CTX.proxy || Date.now() - UPD.at < 5 * 60e3) return;
  UPD.at = Date.now();
  try { const r = await fetch('__ping', { cache: 'no-store' }), j = r.ok ? await r.json() : null; if (j && typeof j.build === 'string') updCheck(j.build); } catch (e) { /* hors ligne */ }
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => { UPD.touch = Date.now(); }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { UPD.hid = Date.now(); return; }
    if (UPD.hid && Date.now() - UPD.hid > 60e3) updResume();
  });
}
