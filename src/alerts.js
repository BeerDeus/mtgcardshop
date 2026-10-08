/* ── alerts.js : alertes de prix (notifications push) ─────────────────────────────────────────────────────────────────
   Le serveur (proxy.mjs, « Alertes de prix ») relit toutes les 6 h le prix tendance Cardmarket des cartes surveillées et pousse une
   notification quand l'une chute d'au moins N % (et 0,50 €) ou passe sous un prix cible. Cette page fournit la liste à surveiller :
   · automatiquement : cartes qu'il manque pour chaque deck enregistré (liste du deck − collection libre) ;
   · à la main : n'importe quelle carte, avec ou sans prix cible (fiche d'une carte, ou saisie dans la feuille « Alertes de prix »).
   La liste part avec l'abonnement push de CET appareil (PUT /api/alerts) à chaque changement (différé de 3 s) et au plus toutes les 12 h ;
   dans l'appli Android, avec son jeton FCM ({ fcm }) à la place de l'abonnement (voir push.js).
   Les cartes suivies à la main et les réglages restent sur l'appareil (deckdeal:alert:v1). */
const AL_KEY = 'deckdeal:alert:v1', AL_THRS = [20, 30, 40, 50], AL_RESYNC = 12 * 3600e3, AL_ROWS = 150;
const AC = { on: false, thr: 30, deck: true, watch: {}, mute: {}, id: '', at: 0, sig: '', t: 0, busy: false, err: '', info: null };

function alRead() {
  try {
    const j = JSON.parse(localStorage.getItem(AL_KEY) || '{}') || {};
    AC.on = !!j.on; AC.thr = AL_THRS.includes(j.thr) ? j.thr : 30; AC.deck = j.deck !== false;
    AC.watch = j.watch && typeof j.watch === 'object' ? j.watch : {}; AC.mute = j.mute && typeof j.mute === 'object' ? j.mute : {};
    AC.id = typeof j.id === 'string' ? j.id : ''; AC.at = Number(j.at) || 0; AC.sig = typeof j.sig === 'string' ? j.sig : '';
  } catch (e) { /* neuf */ }
}
function alWrite() {
  try { localStorage.setItem(AL_KEY, JSON.stringify({ on: AC.on, thr: AC.thr, deck: AC.deck, watch: AC.watch, mute: AC.mute, id: AC.id, at: AC.at, sig: AC.sig })); } catch (e) { /* stockage indisponible */ }
}
const alAvail = () => !!(CTX.proxy && CTX.alerts && (pushNat() ? CTX.fcm : CTX.vapid) && !S.demo);
/** Prix cible saisi (« 2,5 », « 2.50 € ») → centimes, 0 si vide ou illisible. */
function alParseEuros(s) {
  const n = parseFloat(String(s || '').replace(/[\s€]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 10000 ? Math.round(n * 100) : 0;
}

const AL_BODY_MAX = 56000;                                                                    // marge sous la limite de 64 Ko du serveur (abonnement et seuil en plus)
/** Cartes à surveiller : suivies à la main (avec prix cible éventuel) puis manquantes des decks enregistrés ; [{ k, n, t?, d? }]. */
function alItems() {
  const out = new Map();
  const put = (k, n, t, deck) => {
    let x = out.get(k); if (!x) { x = { k, n, d: [], hand: false }; out.set(k, x); }
    if (t) x.t = t; if (!deck) x.hand = true;
    if (deck && x.d.length < 3 && !x.d.includes(deck)) x.d.push(deck);
    return x;
  };
  for (const [k, w] of Object.entries(AC.watch)) put(k, w.n, w.t || 0, '');
  if (AC.deck) {
    for (const d of allDecks()) {
      for (const c of parseDeck(d.text).cards) {
        const k = ownKey(c.key); if (AC.mute[k] && !AC.watch[k]) continue;
        if (c.qty - engFree(collQty(k), XS.eng, k, d.id) <= 0) continue;
        put(k, c.name, 0, d.name);
      }
    }
  }
  // Tailles alignées sur le serveur (nom 150, deck 40, envoi ≤ 64 Ko) : trop de decks aux noms longs → un seul deck par carte, puis moins de cartes.
  const items = [...out.values()].slice(0, 400).map(x => { const o = { k: x.k, n: String(x.n).slice(0, 150) }; if (x.t) o.t = x.t; if (x.d.length) o.d = x.d.map(d => String(d).slice(0, 40)); if (x.hand) o.h = 1; return o; });
  const size = () => new TextEncoder().encode(JSON.stringify(items)).length;
  if (size() > AL_BODY_MAX) items.forEach(o => { if (o.d) o.d = o.d.slice(0, 1); });
  while (items.length && size() > AL_BODY_MAX) items.splice(-Math.max(1, items.length >> 4));
  return items;
}

/** Abonnement push de cet appareil, ou { fcm: jeton } dans l'appli Android (null si les notifications ne sont pas actives). */
const alSubJson = () => pushTarget();
/** Envoie la liste au serveur (rien si inchangée depuis moins de 12 h). */
async function alSync(force) {
  if (!AC.on || AC.busy || !alAvail()) return;
  const items = alItems(), sig = AC.thr + '|' + JSON.stringify(items);
  if (!force && sig === AC.sig && Date.now() - AC.at < AL_RESYNC) return;
  if (!items.length && !AC.id) { AC.sig = sig; return; }
  AC.busy = true;
  try {
    const sub = await alSubJson(); if (!sub) { AC.err = 'push'; return; }
    const j = await ct('alerts', { method: 'PUT', body: { sub, thr: AC.thr, items: items.map(({ h, ...x }) => x) } }), prev = AC.id;
    if (prev && j.id && j.id !== prev) ct('alerts', { method: 'DELETE', params: { id: prev } }).catch(() => {});   // nouvel abonnement ou jeton FCM renouvelé : l'ancien ne doit plus notifier
    AC.id = items.length ? (j.id || AC.id) : ''; AC.sig = sig; AC.at = Date.now(); AC.err = ''; AC.info = { watching: j.watching | 0 }; alWrite();
  } catch (e) { AC.err = e && e.code === 'auth' ? 'auth' : 'net'; }
  finally { AC.busy = false; alPaintBox(); }
}
function alSoon() { if (!AC.on) return; clearTimeout(AC.t); AC.t = setTimeout(() => alSync(), 3000); }

async function alEnable() {
  if (!alAvail()) return { ok: false, why: S.demo ? 'demo' : 'unavailable' };
  const r = await pushEnable(); if (!r.ok) return r;
  AC.on = true; AC.mute = AC.mute || {}; alWrite(); await alSync(true);
  return AC.err === 'net' || AC.err === 'auth' ? { ok: true, warn: AC.err } : { ok: true };
}
async function alDisable() {
  AC.on = false; clearTimeout(AC.t);
  try { if (AC.id && CTX.proxy) await ct('alerts', { method: 'DELETE', params: { id: AC.id } }); } catch (e) { /* le serveur nettoiera l'abonnement à son prochain refus */ }
  AC.id = ''; AC.sig = ''; AC.err = ''; AC.info = null; alWrite();
  if (!S.push) await pushDisable();
}
/** Texte d'un refus d'activation (permission, appareil…). */
function alWhy(r) {
  return r.why === 'denied' ? pushDeniedMsg()
    : r.why === 'dismissed' ? T('Autorisation non accordée.')
    : r.why === 'demo' ? T('Indisponible en mode démo.')
    : r.why === 'ios' ? T('Sur iPhone et iPad, installe d\'abord Mana Orbit sur l\'écran d\'accueil (Réglages › Application).')
    : r.why === 'oldapp' ? T('Mets à jour l\'appli Mana Orbit pour recevoir les notifications.')
    : r.msg ? T('Activation impossible : {msg}.', { msg: r.msg }) : T('Activation impossible.');
}

/* ── Suivi à la main ─────────────────────────────────────────────────────────────────────────── */
function alWatch(name, target) {
  const k = ownKey(name); if (!k) return;
  AC.watch = { ...AC.watch, [k]: { n: String(name).trim().slice(0, 150), ...(target ? { t: target } : {}) } };
  const m = { ...AC.mute }; delete m[k]; AC.mute = m; alWrite(); alSoon();
}
function alUnwatch(k) { const w = { ...AC.watch }; delete w[k]; AC.watch = w; alWrite(); alSoon(); }
/** Bouton « Prévenir si le prix baisse » de la fiche d'une carte. */
function alWatchBtn(api, name) {
  if (!alAvail()) return;
  const k = ownKey(name), b = document.createElement('button'); b.type = 'button'; b.className = 'link-btn link-inline watchbtn';
  const paint = () => { b.textContent = AC.watch[k] ? T('Ne plus surveiller le prix') : T('Prévenir si le prix baisse'); };
  paint();
  b.onclick = async () => {
    if (AC.watch[k]) { alUnwatch(k); paint(); toast(T('Carte retirée de la surveillance')); return; }
    if (!AC.on) { b.disabled = true; const r = await alEnable(); b.disabled = false; if (!r.ok) { toast(alWhy(r)); return; } }
    alWatch(name, 0); paint(); haptic('ok'); toast(T('{name} : tu seras prévenu en cas de forte baisse', { name }), { label: T('Régler'), fn: () => openAlertSheet() });
  };
  api.body.appendChild(b);
}

/* ── Réglages › Alertes de prix ──────────────────────────────────────────────────────────────── */
async function alPaintBox(box) {
  box = box && box.isConnected ? box : $('#alertBox'); if (!box || !box.isConnected) return;
  const note = t => `<p class="hint">${t}</p>`;
  if (!CTX.proxy) { box.innerHTML = note(T('Les alertes demandent le serveur Mana Orbit (il surveille les prix quand l\'app est fermée).')); return; }
  const nat = !!pushNat();                                                      // appli Android : FCM à la place de Web Push
  if (nat ? !CTX.fcm : !CTX.vapid) { box.innerHTML = note(nat ? T('Le serveur n\'a pas de compte de service Firebase pour les notifications de l\'appli : ajoute FCM_SERVICE_ACCOUNT (voir README).') : T('Le serveur n\'a pas de clés de notification : ajoute VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY et VAPID_SUBJECT (voir README).')); return; }
  if (!CTX.alerts) { box.innerHTML = note(T('Les alertes de prix sont désactivées sur le serveur.')); return; }
  if (S.demo) { box.innerHTML = note(T('Indisponible en mode démo.')); return; }
  const st = await pushState(); if (!box.isConnected) return;
  const n = AC.info ? AC.info.watching : (AC.on ? alItems().length : 0);
  const sub = !AC.on ? T('Une notification quand une carte qui te manque, ou une carte suivie, chute de prix.')
    : AC.err === 'net' ? T('Liste pas encore envoyée au serveur : nouvel essai à la prochaine modification.')
    : AC.err === 'auth' ? T('Connecte-toi (icône en haut) pour que le serveur surveille tes cartes.')
    : AC.err === 'push' || st !== 'on' ? T('Notifications coupées pour cet appareil : réactive l\'alerte.')
    : TN(n, '{n} carte surveillée · baisse d\'au moins {thr} %.', '{n} cartes surveillées · baisse d\'au moins {thr} %.', { thr: AC.thr });
  box.innerHTML = `<label class="switch-row" for="setAlert"><span class="t"><b>${T('Prévenir en cas de forte baisse')}</b><span class="hint">${esc(sub)}</span></span><span class="switch"><input type="checkbox" id="setAlert" ${AC.on ? 'checked' : ''}><i></i></span></label>
    <p class="hint" id="alertMsg" hidden></p>${AC.on ? `<button class="btn ghost small" type="button" id="btnAlertOpen" style="align-self:flex-start">${T('Cartes surveillées et réglages')}</button>` : ''}`;
  const cb = $('#setAlert', box), msg = $('#alertMsg', box);
  cb.onchange = async () => {
    msg.hidden = true; cb.disabled = true;
    if (cb.checked) {
      const r = await alEnable(); cb.disabled = false;
      if (r.ok) { haptic('ok'); toast(T('Alertes de prix activées')); } else { cb.checked = false; msg.hidden = false; msg.textContent = alWhy(r); return; }
    } else { await alDisable(); cb.disabled = false; toast(T('Alertes de prix coupées')); }
    alPaintBox(box);
  };
  const bo = $('#btnAlertOpen', box); if (bo) bo.onclick = () => openAlertSheet();
}

/* ── Feuille « Alertes de prix » ─────────────────────────────────────────────────────────────── */
const alPct = (c, b) => (b > 0 && c > 0 ? Math.round((c - b) / b * 100) : 0);
async function openAlertSheet() {
  if (!alAvail()) { toast(S.demo ? T('Alertes indisponibles en mode démo') : T('Alertes indisponibles : serveur Mana Orbit requis')); return; }
  openSheet(T('Alertes de prix'), T('Prix Cardmarket, relevés toutes les 6 h'), api => {
    let data = null, busy = false;
    const sig = () => api.wrap.isConnected;
    const load = async () => {
      if (!AC.id) { data = null; return; }
      try { data = await ct('alerts', { params: { id: AC.id } }); }
      catch (e) { if (e && (e.code === '404' || e.code === 'not_registered')) { AC.sig = ''; await alSync(true); try { data = AC.id ? await ct('alerts', { params: { id: AC.id } }) : null; } catch (x) { data = null; } } else data = null; }
    };
    const paint = () => {
      if (!sig()) return;
      if (!AC.on) {
        api.body.innerHTML = `<p class="hint">${T('Les alertes surveillent les cartes qu\'il te manque pour tes decks enregistrés, et celles que tu suis à la main. Une notification arrive quand l\'une chute de prix, même app fermée.')}</p>`;
        api.setFoot(`<button class="btn" type="button" id="alOn">${T('Activer les alertes')}</button>`);
        $('#alOn', api.foot).onclick = async e => { e.target.disabled = true; const r = await alEnable(); if (!r.ok) { e.target.disabled = false; toast(alWhy(r)); return; } haptic('ok'); await load(); paint(); };
        return;
      }
      const items = alItems(), px = (data && data.prices) || {};
      const rows = items.map(i => { const p = px[i.k]; return { ...i, c: p ? p.c : 0, b: p ? p.b : 0, pct: p ? alPct(p.c, p.b) : 0 }; })
        .sort((x, y) => x.pct - y.pct || (x.n < y.n ? -1 : 1));
      const hits = (data && data.hits || []).slice(0, 5), muted = Object.keys(AC.mute).filter(k => !AC.watch[k]).length;
      const last = data && data.last && data.last.at ? T('Dernier contrôle {when}', { when: relTime(data.last.at) }) + (data.last.miss ? ' · ' + T('{n} sans prix', { n: nf0(data.last.miss) }) : '') : T('Premier contrôle dans quelques minutes.');
      const rowHtml = r => {
        const tags = [...(r.d || []).map(d => T('Manque à {deck}', { deck: esc(d) })), r.h ? (r.t ? T('Cible {p}', { p: esc(fmt(r.t)) }) : T('Suivie à la main')) : ''].filter(Boolean).join(' · ');
        return `<div class="al-row" data-k="${esc(r.k)}"><span class="al-n"><b>${esc(r.n)}</b><small>${tags}</small></span>
          <span class="al-px">${r.c ? `<b>${esc(fmt(r.c))}</b>${r.b && r.pct ? `<small class="${r.pct < 0 ? 'dn' : 'up'}">${r.pct > 0 ? '+' : '−'}${Math.abs(r.pct)} %</small>` : ''}` : `<small>${T('pas encore de prix')}</small>`}</span>
          <button class="ib-x" type="button" data-rm="${esc(r.k)}" aria-label="${T(r.h ? 'Ne plus suivre {name}' : 'Exclure de la surveillance {name}', { name: esc(r.n) })}"><svg class="i"><use href="#i-close"/></svg></button></div>`;
      };
      api.body.innerHTML = `
        ${hits.length ? `<div class="sec-title">${T('Dernières alertes')}</div><div class="al-list hits">${hits.map(h => `<div class="al-row"><span class="al-n"><b>${esc(h.n)}</b><small>${esc(relTime(h.at))}${h.d && h.d.length ? ' · ' + T('manque à {deck}', { deck: esc(h.d[0]) }) : ''}</small></span><span class="al-px"><b>${esc(fmt(h.to))}</b><small class="dn">${h.why === 'target' ? T('sous ta cible') : '−' + h.pct + ' %'}</small></span></div>`).join('')}</div>` : ''}
        <div class="switch-row"><span class="t"><b>${T('Cartes manquantes de mes decks')}</b><span class="hint">${T('Toutes les cartes qu\'il te reste à acheter pour tes decks enregistrés.')}</span></span><label class="switch"><input type="checkbox" id="alDeck" ${AC.deck ? 'checked' : ''}><i></i></label></div>
        <div class="field-in"><span class="label">${T('Alerter à partir d\'une baisse de')}</span><div class="seg" id="alThr" role="radiogroup" aria-label="${T('Seuil de baisse')}"></div><span class="hint">${T('Et d\'au moins 0,50 €, comparé au prix des derniers jours.')}</span></div>
        <div class="sec-title">${T('Suivre une carte')}</div>
        <form class="al-add" id="alAdd" autocomplete="off"><input type="text" id="alName" placeholder="${T('Nom de la carte')}" aria-label="${T('Nom de la carte')}" autocapitalize="words" spellcheck="false"><input type="text" id="alTarget" inputmode="decimal" placeholder="${T('Cible €')}" aria-label="${T('Prix cible en euros (facultatif)')}"><button class="btn small" type="submit">${T('Suivre')}</button></form>
        <p class="hint" id="alAddMsg" hidden></p>
        <div class="sec-title">${TN(rows.length, '{n} carte surveillée', '{n} cartes surveillées')}</div>
        ${rows.length ? `<div class="al-list">${rows.slice(0, AL_ROWS).map(rowHtml).join('')}</div>${rows.length > AL_ROWS ? `<p class="hint">${T('{n} autres cartes surveillées, non listées ici.', { n: nf0(rows.length - AL_ROWS) })}</p>` : ''}` : `<p class="hint">${T('Rien à surveiller pour l\'instant : enregistre un deck auquel il manque des cartes, ou suis une carte à la main.')}</p>`}
        ${muted ? `<p class="hint">${TN(muted, '{n} carte exclue de la surveillance', '{n} cartes exclues de la surveillance')} · <button class="link-btn link-inline" type="button" id="alUnmute">${T('Rétablir')}</button></p>` : ''}
        <p class="hint">${esc(last)}</p>`;
      api.setFoot(`<button class="btn ghost" type="button" id="alOff">${T('Couper')}</button><button class="btn" type="button" id="alCheck">${T('Vérifier les prix')}</button>`);
      mountSeg($('#alThr', api.body), AL_THRS.map(v => ({ v: String(v), label: v + ' %' })), String(AC.thr), v => { AC.thr = Number(v); alWrite(); alSoon(); });
      $('#alDeck', api.body).onchange = e => { AC.deck = e.target.checked; alWrite(); alSoon(); setTimeout(() => { alSync(true).then(load).then(paint); }, 50); };
      const um = $('#alUnmute', api.body); if (um) um.onclick = () => { AC.mute = {}; alWrite(); alSoon(); paint(); };
      const add = $('#alAdd', api.body), msg = $('#alAddMsg', api.body);
      add.onsubmit = async e => {
        e.preventDefault(); const name = $('#alName', add).value.trim(), t = alParseEuros($('#alTarget', add).value); msg.hidden = true; if (!name) return;
        const btn = $('button', add); btn.disabled = true;
        let known = true; try { const r = await scryCollection([name]); known = !!r.get(ownKey(name)); } catch (x) { /* Scryfall injoignable : on suit quand même */ }
        btn.disabled = false;
        if (!known) { msg.hidden = false; msg.textContent = T('Carte introuvable chez Scryfall : écris son nom anglais complet.'); return; }
        alWatch(name, t); haptic('ok'); toast(t ? T('{name} : alerte sous {p}', { name, p: fmt(t) }) : T('{name} : alerte en cas de forte baisse', { name }));
        await alSync(true); await load(); paint();
      };
      api.body.onclick = async e => {
        const rm = e.target.closest('[data-rm]'); if (!rm) return;
        const k = rm.dataset.rm;
        if (AC.watch[k]) alUnwatch(k); else { AC.mute = { ...AC.mute, [k]: 1 }; alWrite(); alSoon(); }
        haptic('tap'); const sc = api.body.scrollTop; paint(); api.body.scrollTop = sc;
      };
      $('#alOff', api.foot).onclick = async () => { await alDisable(); api.close(); toast(T('Alertes de prix coupées')); alPaintBox(); };
      $('#alCheck', api.foot).onclick = async e => {
        if (busy) return; busy = true; e.target.disabled = true; e.target.textContent = T('Contrôle…');
        try {
          await alSync(true);
          const j = AC.id ? await ct('alerts/check', { method: 'POST', params: { id: AC.id }, body: {} }) : null;
          if (j && j.skipped) toast(T('Prix déjà relevés à l\'instant'));
          else if (j && j.ok === false) toast(T('Relevé impossible : {err}', { err: j.error || T('serveur') }));
          else if (j && j.last && j.last.hits) toast(TN(j.last.hits, '{n} alerte envoyée', '{n} alertes envoyées'));
          else toast(T('Prix relevés : rien à signaler'));
        } catch (x) { toast(T('Contrôle impossible : {err}', { err: (x && x.message) || T('erreur') })); }
        busy = false; await load(); paint();
      };
    };
    paint(); load().then(paint);
  });
}

/** Touché sur une notification d'alerte ou lien ./?alerts=1. */
function alertsOpen() { if (alAvail()) openAlertSheet(); else toast(T('Alerte de prix reçue : ouvre Mana Orbit connectée au serveur pour la voir')); }

function alInit() {
  alRead();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) alSoon(); });
  if (AC.on) setTimeout(alSoon, 4000);
}
