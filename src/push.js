/* ── push.js : notification « recherche terminée » (Web Push) ───────────────────────────────────
   Le navigateur crée un abonnement (clé publique VAPID du serveur) ; il l'envoie avec la recherche, le serveur la poursuit
   en tâche de fond et, si l'app n'est plus ouverte à la fin, pousse la notification. Rien n'est stocké côté serveur.
   Android (Chrome, Edge, Firefox) : direct. iPhone/iPad : seulement l'app installée sur l'écran d'accueil (iOS 16.4 ou plus). */
const b64u = s => { const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/'), p = '='.repeat((4 - t.length % 4) % 4), b = atob(t + p); return Uint8Array.from(b, c => c.charCodeAt(0)); };

async function pushReg() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try { return await Promise.race([navigator.serviceWorker.ready, sleep(2500).then(() => null)]); } catch (e) { return null; }
}
/** 'on' · 'off' · 'denied' · 'ios' (app à installer d'abord) · 'unsupported' · 'novapid' (serveur sans clés) · 'noproxy' · 'nosw' */
async function pushState() {
  if (!CTX.proxy) return 'noproxy';
  if (!CTX.vapid) return 'novapid';
  const api = typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window;
  if (!api) return PWA.ios() && !PWA.standalone() ? 'ios' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await pushReg(); if (!reg) return 'nosw';
  let sub = null; try { sub = await reg.pushManager.getSubscription(); } catch (e) { /* ignore */ }
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}
async function pushEnable() {
  const st = await pushState();
  if (st === 'on') return { ok: true };
  if (st !== 'off') return { ok: false, why: st };
  let perm; try { perm = await Notification.requestPermission(); } catch (e) { perm = 'default'; }
  if (perm !== 'granted') return { ok: false, why: perm === 'denied' ? 'denied' : 'dismissed' };
  try { const reg = await pushReg(); await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(CTX.vapid) }); }
  catch (e) { return { ok: false, why: 'error', msg: (e && e.message) || '' }; }
  return { ok: true };
}
async function pushDisable() {
  try { const reg = await pushReg(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* ignore */ }
}
/** Charge utile envoyée avec la recherche (null si les notifications sont coupées ou indisponibles). */
async function pushPayload(label) {
  if (!S.push || S.demo || !CTX.proxy || !CTX.vapid || !CTX.jobs) return null;
  try {
    if (await pushState() !== 'on') return null;
    const sub = (await (await pushReg()).pushManager.getSubscription()).toJSON();
    if (!sub || !sub.endpoint || !sub.keys) return null;
    return { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, title: 'Recherche terminée', body: `Les offres de « ${String(label || 'ta liste').slice(0, 60)} » sont prêtes.`, url: './?resume=1' };
  } catch (e) { return null; }
}
function pushInit() {
  try { navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'resume') resumeRun(); else if (e.data && e.data.type === 'alerts') alertsOpen(); }); } catch (e) { /* pas de service worker */ }
  if (S.push || AC.on) pushState().then(st => { if (st === 'denied') { S.push = false; saveStore(); if (AC.on) { AC.on = false; alWrite(); } } });
}
/** Réglages › Notifications. */
async function paintPushBox(box) {
  if (!box) return;
  const st = await pushState(); if (!box.isConnected) return;
  const note = (ok, t) => `<div class="status" data-ok="${ok ? 1 : 0}"><span class="dot"></span><span>${t}</span></div>`;
  if (st === 'on' || st === 'off') {
    box.innerHTML = `<label class="switch-row" for="setPush"><span class="t"><b>Prévenir quand la recherche est finie</b><span class="hint">Si tu quittes l'app pendant la lecture des offres, une notification arrive à la fin (le serveur continue sans toi).</span></span><span class="switch"><input type="checkbox" id="setPush" ${S.push && st === 'on' ? 'checked' : ''}><i></i></span></label><p class="hint" id="pushMsg" hidden></p>`;
    const cb = $('#setPush', box), msg = $('#pushMsg', box);
    cb.onchange = async () => {
      msg.hidden = true;
      if (cb.checked) {
        cb.disabled = true; const r = await pushEnable(); cb.disabled = false;
        if (r.ok) { S.push = true; saveStore(); haptic('ok'); toast('Notifications activées'); }
        else { cb.checked = false; S.push = false; saveStore(); msg.hidden = false; msg.textContent = r.why === 'denied' ? 'Notifications bloquées : autorise-les pour ce site dans les réglages du navigateur.' : r.why === 'dismissed' ? 'Autorisation non accordée.' : 'Activation impossible' + (r.msg ? ' : ' + r.msg : '') + '.'; }
      } else { S.push = false; saveStore(); if (!(typeof AC !== 'undefined' && AC.on)) await pushDisable(); }   // l'abonnement reste tant que les alertes de prix s'en servent
    };
    return;
  }
  box.innerHTML = {
    noproxy: '<p class="hint">Les notifications demandent le serveur Deck Deal (la recherche y continue quand tu quittes l\'app).</p>',
    novapid: note(0, 'Le serveur n\'a pas de clés de notification. Ajoute VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY et VAPID_SUBJECT dans les variables d\'environnement (voir README).'),
    denied: note(0, 'Notifications bloquées pour ce site : autorise-les dans les réglages du navigateur, puis reviens ici.'),
    ios: '<p class="hint">Sur iPhone et iPad, les notifications ne marchent que si Deck Deal est installée sur l\'écran d\'accueil (iOS 16.4 ou plus) : bouton Partager, « Sur l\'écran d\'accueil », puis ouvre l\'app depuis son icône.</p>',
    unsupported: '<p class="hint">Ce navigateur ne gère pas les notifications push.</p>',
    nosw: '<p class="hint">Le service worker n\'est pas actif (ouvre l\'app en https, puis recharge).</p>',
  }[st] || '';
}
