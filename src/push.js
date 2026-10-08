/* ── push.js : notification « recherche terminée » (Web Push, ou FCM dans l'appli Android) ───────────────────────────────
   Le navigateur crée un abonnement (clé publique VAPID du serveur) ; il l'envoie avec la recherche, le serveur la poursuit
   en tâche de fond et, si l'app n'est plus ouverte à la fin, pousse la notification. Rien n'est stocké côté serveur.
   Android (Chrome, Edge, Firefox) : direct. iPhone/iPad : seulement l'app installée sur l'écran d'accueil (iOS 16.4 ou plus).
   Appli Android : sa WebView n'a pas Web Push. Le plugin natif PushNotifications donne un jeton Firebase Cloud Messaging, envoyé
   comme cible { fcm: jeton } partout où le navigateur envoie son abonnement ; le serveur passe alors par FCM. */
const b64u = s => { const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/'), p = '='.repeat((4 - t.length % 4) % 4), b = atob(t + p); return Uint8Array.from(b, c => c.charCodeAt(0)); };

async function pushReg() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try { return await Promise.race([navigator.serviceWorker.ready, sleep(2500).then(() => null)]); } catch (e) { return null; }
}

/* ── Appli Android : jeton FCM (plugin @capacitor/push-notifications, joint par le pont Capacitor) ──────────────────────── */
const PN_KEY = 'deckdeal:fcm';
const PN = { tok: null, wait: [], on: false };
/** Plugin natif des notifications : seulement dans l'appli Android (déclaration hoistée : alerts.js l'appelle aussi). */
function pushNat() { return natPlugin('PushNotifications'); }
/** Jeton FCM de cet appareil ('' tant que les notifications n'ont pas été activées dans l'appli). */
function pnTok() { if (PN.tok === null) { try { PN.tok = localStorage.getItem(PN_KEY) || ''; } catch (e) { PN.tok = ''; } } return PN.tok; }
function pnTokSet(t) { PN.tok = t || ''; try { if (t) localStorage.setItem(PN_KEY, t); else localStorage.removeItem(PN_KEY); } catch (e) { /* stockage indisponible */ } }
function pnDone(r) { for (const f of PN.wait.splice(0)) f(r); }
/** Destination d'une notification touchée : les mêmes liens que Web Push (./?resume=1 : la recherche, ./?alerts=1 : les alertes). */
function pushOpen(url) {
  const u = String(url || '');
  if (/[?&]alerts\b/.test(u)) setTimeout(alertsOpen, 500);
  else if (/[?&]resume\b/.test(u)) resumeRun();
}
/** Écoute le plugin, une fois : jeton (premier ou renouvelé par Firebase), échec d'enregistrement, notification reçue app ouverte, notification
    touchée. Le plugin garde ses évènements tant que personne n'écoute : un toucher qui a lancé l'appli arrive ici après le démarrage. */
async function pnListen(P) {
  if (PN.on) return; PN.on = true;
  const on = (ev, fn) => { try { return Promise.resolve(P.addListener(ev, fn)).catch(() => null); } catch (e) { return null; } };
  await Promise.all([
    on('registration', t => {
      const v = t && typeof t.value === 'string' ? t.value : ''; if (!v) return;
      const was = pnTok(); pnTokSet(v); pnDone({ token: v });
      if (was && was !== v && AC.on) { AC.sig = ''; alSoon(); }                 // jeton renouvelé : la liste des alertes repart avec le nouveau
    }),
    on('registrationError', e => pnDone({ error: String((e && e.error) || '') })),
    on('pushNotificationReceived', n => {                                       // app au premier plan : Android affiche aussi la notification
      const msg = [n && n.title, n && n.body].filter(Boolean).join(' · '), url = n && n.data && n.data.url;
      if (msg) toast(msg, /[?&](alerts|resume)\b/.test(String(url || '')) ? { label: T('Voir'), fn: () => pushOpen(url) } : undefined);
    }),
    on('pushNotificationActionPerformed', a => pushOpen(a && a.notification && a.notification.data && a.notification.data.url)),
  ]);
}
/** Demande le jeton FCM : { token } ou { error }. */
async function pnRegister(P) {
  await pnListen(P);
  const got = new Promise(res => { PN.wait.push(res); setTimeout(() => res({ error: T('Firebase ne répond pas') }), 15000); });
  try { await P.register(); } catch (e) { pnDone({ error: String((e && e.message) || '') }); }
  return got;
}
async function pnPerm(P, ask) { try { return ((await (ask ? P.requestPermissions() : P.checkPermissions())) || {}).receive || ''; } catch (e) { return ''; } }
/** Texte d'une autorisation refusée : réglages d'Android dans l'appli, du navigateur ailleurs. */
function pushDeniedMsg() {
  return pushNat() ? T('Notifications bloquées : autorise-les pour Mana Orbit dans les réglages d\'Android (Paramètres › Applications › Mana Orbit › Notifications).')
    : T('Notifications bloquées : autorise-les pour ce site dans les réglages du navigateur.');
}

/** 'on' · 'off' · 'denied' · 'ios' (app à installer d'abord) · 'unsupported' · 'novapid' (serveur sans clés) · 'noproxy' · 'nosw'
    · appli Android : 'nofcm' (serveur sans compte de service Firebase) · 'oldapp' (appli sans le plugin de notifications) */
async function pushState() {
  if (!CTX.proxy) return 'noproxy';
  const P = pushNat();
  if (P) {
    if (!CTX.fcm) return 'nofcm';
    const perm = await pnPerm(P, false);
    if (perm === 'denied') return 'denied';
    return perm === 'granted' && pnTok() ? 'on' : 'off';
  }
  if (isNativeApp()) return 'oldapp';                                           // la WebView d'Android n'a pas Web Push
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
  const P = pushNat();
  if (P) {
    const perm = await pnPerm(P, true);
    if (perm !== 'granted') return { ok: false, why: perm === 'denied' ? 'denied' : 'dismissed' };
    const r = await pnRegister(P);
    return r.token ? { ok: true } : { ok: false, why: 'error', msg: r.error || T('Firebase ne répond pas') };
  }
  let perm; try { perm = await Notification.requestPermission(); } catch (e) { perm = 'default'; }
  if (perm !== 'granted') return { ok: false, why: perm === 'denied' ? 'denied' : 'dismissed' };
  try { const reg = await pushReg(); await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(CTX.vapid) }); }
  catch (e) { return { ok: false, why: 'error', msg: (e && e.message) || '' }; }
  return { ok: true };
}
async function pushDisable() {
  const P = pushNat();
  if (P) { pnTokSet(''); try { await P.unregister(); } catch (e) { /* ignore */ } return; }      // jeton supprimé chez Firebase : plus rien n'arrive
  try { const reg = await pushReg(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* ignore */ }
}
/** Cible des notifications de cet appareil, telle que le serveur la reçoit : { fcm: jeton } dans l'appli Android, l'abonnement Web Push ailleurs ;
    null si les notifications ne sont pas actives. */
async function pushTarget() {
  if (await pushState() !== 'on') return null;
  if (pushNat()) return pnTok() ? { fcm: pnTok() } : null;
  const reg = await pushReg(); let sub = null;
  try { sub = reg && await reg.pushManager.getSubscription(); } catch (e) { /* ignore */ }
  const j = sub && sub.toJSON();
  return j && j.endpoint && j.keys ? { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } } : null;
}
/** Charge utile envoyée avec la recherche (null si les notifications sont coupées ou indisponibles). */
async function pushPayload(label) {
  if (!S.push || S.demo || !CTX.proxy || !(pushNat() ? CTX.fcm : CTX.vapid) || !CTX.jobs) return null;
  try {
    const sub = await pushTarget(); if (!sub) return null;
    return { sub, title: T('Recherche terminée'), body: T('Les offres de « {name} » sont prêtes.', { name: String(label || T('ta liste')).slice(0, 60) }), url: './?resume=1' };
  } catch (e) { return null; }
}
function pushInit() {
  try { navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'resume') resumeRun(); else if (e.data && e.data.type === 'alerts') alertsOpen(); }); } catch (e) { /* pas de service worker */ }
  const P = pushNat(); if (P) pnListen(P);                                      // touchers et notifications reçues, même sans notifications activées ici
  if (S.push || AC.on) pushState().then(st => {
    if (st === 'denied') { S.push = false; saveStore(); if (AC.on) { AC.on = false; alWrite(); } }
    else if (P && st === 'on') pnRegister(P);                                   // jeton à jour à chaque lancement (Firebase peut le renouveler)
  });
}
/** Réglages › Notifications. */
async function paintPushBox(box) {
  if (!box) return;
  const st = await pushState(); if (!box.isConnected) return;
  const note = (ok, t) => `<div class="status" data-ok="${ok ? 1 : 0}"><span class="dot"></span><span>${t}</span></div>`;
  if (st === 'on' || st === 'off') {
    box.innerHTML = `<label class="switch-row" for="setPush"><span class="t"><b>${T('Prévenir quand la recherche est finie')}</b><span class="hint">${T('Si tu quittes l\'app pendant la lecture des offres, une notification arrive à la fin (le serveur continue sans toi).')}</span></span><span class="switch"><input type="checkbox" id="setPush" ${S.push && st === 'on' ? 'checked' : ''}><i></i></span></label><p class="hint" id="pushMsg" hidden></p>`;
    const cb = $('#setPush', box), msg = $('#pushMsg', box);
    cb.onchange = async () => {
      msg.hidden = true;
      if (cb.checked) {
        cb.disabled = true; const r = await pushEnable(); cb.disabled = false;
        if (r.ok) { S.push = true; saveStore(); haptic('ok'); toast(T('Notifications activées')); }
        else { cb.checked = false; S.push = false; saveStore(); msg.hidden = false; msg.textContent = r.why === 'denied' ? pushDeniedMsg() : r.why === 'dismissed' ? T('Autorisation non accordée.') : r.msg ? T('Activation impossible : {msg}.', { msg: r.msg }) : T('Activation impossible.'); }
      } else { S.push = false; saveStore(); if (!(typeof AC !== 'undefined' && AC.on)) await pushDisable(); }   // l'abonnement reste tant que les alertes de prix s'en servent
    };
    return;
  }
  const nat = !!pushNat();
  box.innerHTML = {
    noproxy: '<p class="hint">' + T('Les notifications demandent le serveur Mana Orbit (la recherche y continue quand tu quittes l\'app).') + '</p>',
    novapid: note(0, T('Le serveur n\'a pas de clés de notification. Ajoute VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY et VAPID_SUBJECT dans les variables d\'environnement (voir README).')),
    nofcm: note(0, T('Le serveur n\'a pas de compte de service Firebase pour les notifications de l\'appli. Ajoute FCM_SERVICE_ACCOUNT dans les variables d\'environnement (voir README).')),
    denied: note(0, nat ? T('Notifications bloquées pour Mana Orbit : autorise-les dans les réglages d\'Android (Paramètres › Applications › Mana Orbit › Notifications), puis reviens ici.') : T('Notifications bloquées pour ce site : autorise-les dans les réglages du navigateur, puis reviens ici.')),
    oldapp: '<p class="hint">' + T('Mets à jour l\'appli Mana Orbit pour recevoir les notifications.') + '</p>',
    ios: '<p class="hint">' + T('Sur iPhone et iPad, les notifications ne marchent que si Mana Orbit est installée sur l\'écran d\'accueil (iOS 16.4 ou plus) : bouton Partager, « Sur l\'écran d\'accueil », puis ouvre l\'app depuis son icône.') + '</p>',
    unsupported: '<p class="hint">' + T('Ce navigateur ne gère pas les notifications push.') + '</p>',
    nosw: '<p class="hint">' + T('Le service worker n\'est pas actif (ouvre l\'app en https, puis recharge).') + '</p>',
  }[st] || '';
}
