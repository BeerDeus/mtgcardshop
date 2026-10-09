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
      let told = false;
      navigator.serviceWorker.addEventListener('message', e => {
        const b = e.data && e.data.type === 'dd-shell' && e.data.build;
        if (!b || told || typeof DD_BUILD !== 'string' || b === DD_BUILD) return;
        told = true;
        const show = () => { try { toast(T('Nouvelle version disponible'), { label: T('Recharger'), fn: () => location.reload() }); } catch (x) { /* ignore */ } };
        if (!document.hidden) return show();
        document.addEventListener('visibilitychange', function vis() { if (!document.hidden) { document.removeEventListener('visibilitychange', vis); show(); } });
      });
      const ask = () => { try { const c = navigator.serviceWorker.controller; if (c) c.postMessage({ type: 'dd-shell?' }); } catch (e) { /* ignore */ } };
      const go = () => { reg(); ask(); };
      if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    }
  }
  return { state, install, snooze, wantsBanner, on, standalone, ios };
})();
