/* ── collection.js : cartes possédées (stockage, compte, infos Scryfall, import, saisie, liste, stats) ─────────
   Source de vérité : « 3 Sol Ring » ligne par ligne (localStorage, et le compte Firestore users/{uid}/meta/collection).
   Les infos Scryfall (coût, type, couleurs, image, prix de référence) sont un cache à part : on peut le vider sans rien perdre. */
const COLL_KEY = 'deckdeal:coll:v1', COLL_SRC_KEY = 'deckdeal:coll:src', COLL_META_KEY = 'coll:meta', COLL_LI_KEY = 'coll:li', COLL_PAGE = 120;
const COLL_RETRY = { off: 15000, err: 20000, live: 12000 };       // délais (ms) : nouvel essai hors ligne / en erreur, attente du serveur au démarrage
const PX_KEY = 'deckdeal:px:v1', PX_TTL = 2 * DAY, PX_CHUNK = 40;
const COLL = { px: {}, pxRun: null, pxMsg: null, map: {}, meta: {}, li: {}, u: 0, s: '', base: null, ru: 0, live: false, pushing: 0, again: false, deferred: null, retryT: 0, liveT: 0, cloud: 'off', err: '', unsub: null, el: null, tab: 'list', src: 'cm', topN: 10, topBy: 'lot', f: newFilter(), sort: 'name', shown: COLL_PAGE, enrich: null, enrichErr: '', fb: null, cmdrSeen: '', freshAt: 0, names: null, namesP: null, pushT: 0, runId: 0 };
try { if (localStorage.getItem(COLL_SRC_KEY) === 'ct') COLL.src = 'ct'; } catch (e) { /* stockage indisponible */ }
const collCount = () => Object.keys(COLL.map).length;
const collCopies = () => { let n = 0; for (const k in COLL.map) n += COLL.map[k].q; return n; };
/** Exemplaires possédés d'une carte (k = ownKey du nom). */
const collQty = k => (COLL.map[k] && COLL.map[k].q) || 0;
const nf0 = n => Number(n || 0).toLocaleString('fr-FR');

/* ── Stockage local ───────────────────────────────────────────────────────────────────────────── */
function collRead() {
  try {
    const r = JSON.parse(localStorage.getItem(COLL_KEY) || 'null');
    if (r && typeof r.t === 'string') {
      COLL.map = collFromText(r.t); COLL.u = Number(r.u) || 0; COLL.s = typeof r.s === 'string' ? r.s : '';
      COLL.base = COLL.s && typeof r.b === 'string' ? collFromText(r.b) : null;                  // dernier état du compte connu de cet appareil (null : inconnu → fusion par union)
    }
  } catch (e) { /* illisible : on repart d'une collection vide */ }
}
function collWrite() {
  try { localStorage.setItem(COLL_KEY, JSON.stringify({ t: collToText(COLL.map, true), u: COLL.u, s: COLL.s, ...(COLL.base ? { b: collToText(COLL.base, true) } : {}) })); return true; }
  catch (e) { toast('Stockage plein : la collection n\'a pas pu être enregistrée sur cet appareil'); return false; }
}
async function collMetaLoad() {
  try { const m = await Cache.get(COLL_META_KEY, 60 * DAY); if (m && typeof m === 'object' && !Array.isArray(m)) { COLL.meta = { ...m, ...COLL.meta }; collPaint(); } } catch (e) { /* cache absent */ }
  try { const m = await Cache.get(COLL_LI_KEY, 60 * DAY); if (m && typeof m === 'object' && !Array.isArray(m)) { COLL.li = { ...m, ...COLL.li }; collPaint(); } } catch (e) { /* cache absent */ }
}
let metaT = 0;
function collMetaSave() { clearTimeout(metaT); metaT = setTimeout(() => { Cache.set(COLL_META_KEY, COLL.meta); Cache.set(COLL_LI_KEY, COLL.li); }, 800); }

/* ── Langue des cartes : une langue par carte (la dernière scannée l'emporte), image dans cette langue ───── */
const liKey = (l, k) => l + '|' + k;
/** Image à afficher : celle de la langue de la carte si Scryfall l'a, sinon l'anglaise. Retourne { src, lang } (lang : langue réellement montrée). */
function collImage(k, l, en) {
  if (l && l !== 'en') { const u = COLL.li[liKey(l, k)]; if (u) return { src: u, lang: l }; }
  return { src: en || '', lang: 'en' };
}
/** Langues à lire sur Scryfall : clés de cartes de langue ≠ anglais dont l'image n'a pas encore été cherchée. */
function collLangMissing() {
  const by = {};
  for (const [k, x] of Object.entries(COLL.map)) for (const [l] of collLines(x)) if (l && l !== 'en' && SCRY_LANG[l] && !(liKey(l, k) in COLL.li)) (by[l] = by[l] || []).push(k);
  return by;
}
const collLangMissingCount = () => Object.values(collLangMissing()).reduce((a, x) => a + x.length, 0);
/** Cherche l'image d'une carte dans une langue (carte du scan, pas encore dans la collection), puis repeint. */
async function langImgFor(k, name, l) {
  if (!l || l === 'en' || !SCRY_LANG[l] || (liKey(l, k) in COLL.li)) return;
  try { const got = await scryLangImages([name], l); COLL.li[liKey(l, k)] = got.get(k) || ''; collMetaSave(); scanPaintList(); if (COLL.el) collPaintBody(true); } catch (e) { /* pas d'image dans cette langue pour l'instant : on garde l'anglaise */ }
}
/** Change la langue d'une ligne de la collection ('' = non précisée). from : la ligne concernée (sans lui : la langue la plus fournie). Si la carte a déjà une ligne dans la nouvelle langue, les exemplaires s'y ajoutent. */
function collSetLang(k, l, from) {
  const cur = COLL.map[k]; if (!cur) return;
  const lines = collLines(cur).map(e => e.slice()), src = from === undefined ? collDomLang(lines) : from;
  if (src === l) return;
  const i = lines.findIndex(e => e[0] === src); if (i < 0) return;
  const q = lines[i][1]; lines.splice(i, 1);
  const to = lines.find(e => e[0] === l); if (to) to[1] += q; else lines.push([l, q]);
  COLL.map[k] = collFromLines(cur, lines); collChanged({ paint: false }); collEnrich();
}

/** Toute modification passe par ici : enregistre, envoie au compte, met à jour la page de saisie et la recherche en cours. */
function collChanged(o = {}) {
  COLL.u = Date.now(); collWrite();
  if (o.push !== false) collPushSoon();
  if (o.paint !== false) collPaint(); else collPaintHead();
  paintCollSection(); refreshDeck(); alSoon(); trSoon();
  if (S.run && S.view === 'results') scheduleRecompute(true);
}
function collAdd(items, mode) { COLL.map = mergeColl(COLL.map, items, mode); collChanged(); }
/** Confirmation avant de retirer un exemplaire (« − » de la liste Cartes ou du scan) : petite fiche, jamais de confirm() natif. where : 'coll' | 'scan'. */
function confirmMinus(name, q, where, onOk, line) {
  const last = q <= 1, scan = where === 'scan';
  openSheet(last ? (scan ? 'Retirer cette carte ?' : 'Retirer de la collection ?') : 'Retirer un exemplaire ?', '', api => {
    api.body.innerHTML = `<p class="cf-msg"><b>${esc(name)}</b>${last ? (scan ? 'Dernier exemplaire : la carte sort de la liste du scan.' : line ? `Dernier exemplaire ${line} : cette ligne sort de ta collection (la carte reste dans les autres langues).` : 'Dernier exemplaire : la carte sort de ta collection.') : `Il en restera ${nf0(q - 1)} sur ${nf0(q)}.`}</p>`;
    api.setFoot('<button class="btn ghost" type="button" data-close>Annuler</button><button class="btn danger" type="button" data-ok>Retirer</button>');
    api.foot.addEventListener('click', e => { if (e.target.closest('[data-ok]')) { api.close(); onOk(); } });
  });
}
/** +/− d'exemplaires d'une carte. o.lang : la ligne (langue) concernée ; sans lui, la langue la plus fournie de la carte (« non précisée » pour une carte neuve). À 0 la ligne disparaît, puis la carte. Retourne les exemplaires de la ligne (0 : retirée). */
function collBump(k, name, d, o) {
  const cur = COLL.map[k], lines = collLines(cur).map(e => e.slice()), lang = o && o.lang !== undefined ? o.lang : collDomLang(lines);
  const e = lines.find(x => x[0] === lang), q = Math.max(0, Math.min(9999, (e ? e[1] : 0) + d));
  if (e) e[1] = q; else if (q) lines.push([lang, q]);
  const next = collFromLines({ ...(cur || {}), n: (cur && cur.n) || name, ...(cur ? {} : { d: (o && o.date) || dateNowSec() }) }, lines);      // date d'ajout : à l'entrée de la carte (o.date : celle qu'elle avait avant un retrait annulé)
  if (next) COLL.map[k] = next; else delete COLL.map[k];
  collChanged(o); return q;
}

/* ── Compte (Firestore users/{uid}/meta/collection) : plusieurs appareils, une même collection ─────────────────────
   Pas d'horloge ni de « dernier qui écrit gagne » : chaque appareil garde BASE (le dernier état du compte qu'il a vu) et fusionne carte par carte
   (merge3 : base · appareil · compte). Envoi = transaction (lire le compte, fusionner, écrire) : deux appareils qui envoient en même temps ne s'écrasent pas.
   Réception = fusion avec ce qui n'est pas encore parti. Hors ligne : tout reste ici, et repart au retour du réseau. */
const collClone = m => { const o = {}; for (const k in m) o[k] = { ...m[k] }; return o; };
/** Cet appareil a-t-il des changements pas encore dans le compte ? */
const collUnsynced = () => !COLL.base || !sameColl(COLL.map, COLL.base);
const collOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
function collPushSoon() {
  if (cloudOn() && D.cloud.txColl && COLL.cloud !== 'error') COLL.cloud = collOffline() ? 'offline' : 'sync';
  clearTimeout(COLL.pushT); COLL.pushT = setTimeout(collPush, 700);
}
function collRetry(ms) { clearTimeout(COLL.retryT); COLL.retryT = setTimeout(() => { if (collUnsynced()) collPush(); else collPull(); }, ms); }
async function collPush() {
  clearTimeout(COLL.pushT); clearTimeout(COLL.retryT); COLL.pushT = COLL.retryT = 0;
  if (!cloudOn() || !D.cloud.txColl) return;
  if (COLL.pushing) { COLL.again = true; return; }
  if (collOffline()) { COLL.cloud = 'offline'; collPaintHead(); return; }
  const uid = D.user.uid, id = ++COLL.runId;
  let used = null, merged = null, wrote = null;
  COLL.pushing = id; COLL.again = false; COLL.cloud = 'sync'; COLL.err = ''; collPaintHead();
  try {
    await D.cloud.txColl(uid, rdoc => {
      const remote = rdoc && typeof rdoc.text === 'string' ? collFromText(rdoc.text) : {};
      used = collClone(COLL.map);
      merged = merge3(rdoc && COLL.s === uid ? COLL.base : null, used, remote);
      if (rdoc ? sameColl(merged, remote) : !Object.keys(merged).length) { wrote = null; return null; }              // le compte a déjà tout
      wrote = { text: collToText(merged, true), count: Object.keys(merged).length, updatedAt: Math.max(Date.now(), (Number(rdoc && rdoc.updatedAt) || 0) + 1) };
      if (wrote.text.length > 900000) throw Object.assign(new Error('Collection trop grosse'), { code: 'too-big' });
      return wrote;
    });
    if (D.uid !== uid) return;
    if (wrote) COLL.ru = Math.max(COLL.ru, wrote.updatedAt);
    const before = COLL.map, next = merge3(used, before, merged);                                                       // + ce qui a été touché ici pendant l'envoi
    COLL.s = uid; COLL.base = merged; COLL.map = next; COLL.cloud = 'ok'; COLL.err = ''; COLL.live = true; collWrite();
    if (!sameColl(before, next)) collRemoteApplied(before, next);
    if (collUnsynced()) COLL.again = true;
  } catch (err) {
    if (D.uid !== uid) return;
    const c = err && err.code;
    if (c === 'permission-denied') { COLL.cloud = 'error'; COLL.err = 'Règles Firestore à publier pour la collection'; }
    else if (c === 'too-big') { COLL.cloud = 'error'; COLL.err = 'Collection trop grosse pour le compte'; }
    else if (c === 'unavailable' || collOffline()) { COLL.cloud = 'offline'; collRetry(COLL_RETRY.off); }
    else { COLL.cloud = 'error'; COLL.err = 'Synchronisation impossible'; collRetry(COLL_RETRY.err); }
  } finally {
    if (COLL.pushing === id) {
      COLL.pushing = 0;
      const d = COLL.deferred; COLL.deferred = null;
      if (d && D.uid === d[0]) collFromCloud(...d);
      if (COLL.again && COLL.cloud !== 'error' && COLL.cloud !== 'offline') collPushSoon();
      collPaintHead();
    }
  }
}
/** Lit le compte sur le serveur maintenant (retour au premier plan, bouton Réessayer). */
function collPull() {
  if (!cloudOn() || !D.cloud.pullColl || collOffline()) return;
  const uid = D.user.uid;
  D.cloud.pullColl(uid).then(r => { if (D.uid === uid) collFromCloud(uid, r.data, false, false, true); }).catch(() => { /* hors ligne : l'écoute reprendra seule */ });
}
const collSyncNow = () => { collPull(); if (collUnsynced() || COLL.cloud !== 'ok') collPush(); };
/** Appelée à chaque changement de compte (decks.js › onUser). */
function collUser(user) {
  if (COLL.unsub) { try { COLL.unsub(); } catch (e) { /* ignore */ } COLL.unsub = null; }
  clearTimeout(COLL.retryT); clearTimeout(COLL.liveT); clearTimeout(COLL.pushT); COLL.runId++; COLL.pushing = 0; COLL.deferred = null; COLL.again = false;
  COLL.cloud = 'off'; COLL.err = ''; COLL.live = false; COLL.ru = 0;
  if (!user || !D.cloud || !D.cloud.watchColl) { collPaintHead(); return; }
  COLL.cloud = 'sync';
  COLL.liveT = setTimeout(() => { if (!COLL.live && D.uid === user.uid && COLL.cloud === 'sync') { COLL.cloud = 'offline'; collPaintHead(); } }, COLL_RETRY.live);     // pas de réponse du serveur : hors ligne
  COLL.unsub = D.cloud.watchColl(user.uid, (data, pending, fromCache) => collFromCloud(user.uid, data, pending, fromCache), err => {
    COLL.cloud = 'error'; COLL.err = err && err.code === 'permission-denied' ? 'Règles Firestore à publier pour la collection' : 'Synchronisation impossible'; collPaintHead();
  });
}
/** Le compte a changé (ou premier état) : fusion avec cet appareil. fromCache : copie locale du SDK, jamais fiable pour fusionner ; pulled : lecture directe, peut arriver en retard. */
function collFromCloud(uid, data, pending, fromCache, pulled) {
  if (pending || D.uid !== uid) return;                                   // écho d'une écriture pas encore confirmée par le serveur
  if (COLL.pushing) { if (!pulled) COLL.deferred = [uid, data, pending, fromCache]; return; }                   // on fusionne d'abord ce qu'on envoie
  if (fromCache) { if (COLL.live && COLL.cloud === 'ok') { COLL.cloud = 'offline'; collPaintHead(); } return; }   // le serveur ne répond plus (ou pas encore) : on attend sa version
  const ru = Number(data && data.updatedAt) || 0;
  if (data && ru < COLL.ru) return;                                       // version plus ancienne que ce qu'on connaît (réponse arrivée en retard)
  COLL.live = true; COLL.cloud = 'ok'; COLL.err = '';
  if (data && typeof data.text === 'string') {
    const remote = collFromText(data.text), first = COLL.s !== uid, known = !first && !!COLL.base, before = COLL.map;
    const next = merge3(first ? null : COLL.base, before, remote);
    COLL.ru = Math.max(COLL.ru, ru); COLL.s = uid; COLL.base = remote; COLL.map = next; collWrite();
    if (!sameColl(before, next)) collRemoteApplied(before, next, { first: first || !known, had: Object.keys(before).length });
    if (!sameColl(next, remote)) collPushSoon();                          // il reste ici des changements pas encore dans le compte
  } else if (collCount()) { COLL.base = null; collPush(); }               // pas de document : on y envoie la collection de l'appareil
  else { COLL.s = uid; COLL.base = {}; collWrite(); }
  collPaintHead();
}
/** La collection de cet appareil vient de changer à cause du compte (autre appareil) : repeint, lit les infos des nouvelles cartes, prévient. */
function collRemoteApplied(before, after, o = {}) {
  collPaint(); paintCollSection(); refreshDeck(); trSoon(); if (S.run && S.view === 'results') scheduleRecompute(true);
  collEnrich();
  let add = 0, del = 0;
  for (const k in after) if (!before[k]) add++;
  for (const k in before) if (!after[k]) del++;
  const n0 = Object.keys(before).length, plural = n => n + ' carte' + (n > 1 ? 's' : '');
  if (del >= 10 && del * 2 >= n0) toast(`${plural(del)} retirée${del > 1 ? 's' : ''} depuis un autre appareil`, { label: 'Annuler', fn: () => { COLL.map = unionColl(COLL.map, before); collChanged(); } });
  else if (o.first && o.had) toast('Collection de l\'appareil et du compte fusionnées');
  else if (o.first) toast('Collection de ton compte chargée : ' + plural(add));
  else if (add || del) toast('Autre appareil : ' + [add && '+' + plural(add), del && '−' + plural(del)].filter(Boolean).join(' · '));
}
/** Retour au premier plan / réseau revenu : on envoie ce qui attend et on relit le compte (les navigateurs mobiles endorment la connexion en arrière-plan). */
function collWake() { if (cloudOn()) collSyncNow(); }
function collSleep() { if (cloudOn() && COLL.pushT) collPush(); }       // on part : envoyer sans attendre le délai

/* ── Prix réels : l'offre CardTrader la moins chère de chaque carte, lue avec le moteur de la recherche ───────────
   Stockés à part (localStorage, sur cet appareil) : { clé: { p: centimes | null (aucune offre), t: date, s: critères, c: devise } }. */
function pxRead() { try { const r = JSON.parse(localStorage.getItem(PX_KEY) || 'null'); if (r && typeof r === 'object' && !Array.isArray(r)) COLL.px = r; } catch (e) { /* illisible : on repart de zéro */ } }
let pxT = 0;
function pxSave() {
  clearTimeout(pxT);
  pxT = setTimeout(() => { try { const keep = {}; for (const k in COLL.px) if (COLL.map[k]) keep[k] = COLL.px[k]; COLL.px = keep; localStorage.setItem(PX_KEY, JSON.stringify(keep)); } catch (e) { /* stockage plein : les prix restent en mémoire */ } }, 600);
}
const pxLangOf = x => x.l || S.opts.lang;
/** Cartes à lire (hors terrains de base) : f = { lang: '' toutes · 'none' sans langue · code, scope: 'old' à actualiser · 'all' }. Chaque carte est cherchée dans SA langue (sans langue : celle de la recherche). */
function pxTargets(f) {
  const out = [], now = Date.now();
  for (const [k, x] of Object.entries(COLL.map)) {
    if (BASIC_NAMES.has(k)) continue;
    if (f.lang === 'none' ? x.l : f.lang && x.l !== f.lang) continue;
    const lang = pxLangOf(x);
    if (f.scope === 'old' && !pxStale(COLL.px[k], pxSig(lang, S.opts), now, PX_TTL)) continue;
    out.push({ key: k, name: x.n, lang });
  }
  return out;
}
function pxError(e) {
  if (e.code === 'notoken') return 'Token CardTrader manquant.';
  if (e.code === 'auth') return authHint(e, 'CardTrader').msg;
  if (e.code === 'rate') return (/scryfall/.test(e.host || '') ? 'Scryfall' : 'CardTrader') + ' limite les requêtes : réessaie dans une minute.';
  if (e.code === 'network') return e.offline ? 'Tu es hors ligne : reconnecte-toi puis relance (les cartes déjà lues sont gardées).' : 'Impossible de joindre ' + (e.host || 'CardTrader ou Scryfall') + '. Relance : les cartes déjà lues sont gardées.';
  return 'Lecture des prix impossible : ' + (e.message || 'erreur inconnue') + '.';
}
const PX_STEPS = { prints: 'impressions', catalog: 'extensions', offers: 'offres', fallback: 'offres' };
/** Lit les prix réels de ces cartes (targets : [{ key, name, lang }]) par lots, une langue après l'autre (o.fresh : sans le cache du serveur). Progression dans la barre de la collection et en pastille flottante. */
async function pxRun(targets, o = {}) {
  if (COLL.pxRun || !targets.length) return;
  if (S.demo) { toast('Mode démo : les prix réels viennent de CardTrader, désactive la démo'); return; }
  if (S.run && S.run.status === 'running') { toast('Une recherche est en cours : attends sa fin'); return; }
  readOpts();
  if (!CTX.proxy && !CTX.token) { toast('Ajoute ton token CardTrader dans les réglages'); openSettings(); return; }
  if (CTX.proxy && CTX.needsLogin && !(CTX.needsKey && CTX.appKey) && CTX.idToken && !(await CTX.idToken())) { toast('Connecte-toi pour lire les prix'); openAccount(); return; }
  const st = COLL.pxRun = { total: targets.length, done: 0, frac: 0, step: '', ctrl: new AbortController(), real: 0, none: 0, task: null };
  COLL.pxMsg = null;
  st.task = floatTask('Prix réels de la collection', { total: st.total, sub: 'Démarrage…' }, () => !COLL.el || sheets.length > 0);
  const upd = () => { st.task.set(st.done, st.total, `${nf0(Math.floor(st.done))} / ${nf0(st.total)}${st.step ? ' · ' + st.step : ''}`); collPaintHead(); };
  const byLang = new Map(); for (const t of targets) { if (!byLang.has(t.lang)) byLang.set(t.lang, []); byLang.get(t.lang).push(t); }
  collPaintHead();
  try {
    for (const [lang, list] of byLang) for (let i = 0; i < list.length; i += PX_CHUNK) {
      const chunk = list.slice(i, i + PX_CHUNK), base = st.done, opts = { ...S.opts, lang, fallbackEn: false, skip: new Set(), fresh: !!o.fresh, push: null }, sig = pxSig(lang, opts);
      const hooks = {
        step: (id, state, d) => { if (state === 'run') { st.step = (PX_STEPS[id] || id) + (d ? ' ' + d : ''); upd(); } },
        progress: f => { st.done = Math.min(st.total, base + f * chunk.length); upd(); },
        rate() {}, hint() {}, cacheAge() {}, needsEn: () => false,
        card: (key, p) => {
          const o = p.notFound ? null : cheapestOffer(p.offers, opts);
          COLL.px[key] = { p: o ? o.price : null, t: Date.now(), s: sig, c: o ? o.cur : '' };
          if (o) st.real++; else st.none++;
          pxSave(); if (COLL.el) collPaintBody(true); collPaintHead();
        },
      };
      await runLive(chunk.map(t => ({ key: t.key, name: t.name, qty: 1 })), opts, hooks, st.ctrl.signal);
      st.done = base + chunk.length; upd();
    }
    COLL.pxMsg = { t: `Prix réels à jour : ${nf0(st.real)} carte${st.real > 1 ? 's' : ''}${st.none ? ` · ${nf0(st.none)} sans offre` : ''}`, bad: false };
    st.task.finish('Prix réels à jour', 'ok', `${nf0(st.real)} carte${st.real > 1 ? 's' : ''}${st.none ? ` · ${nf0(st.none)} sans offre` : ''}`);
  } catch (e) {
    const n = st.real + st.none;
    if (e.name === 'AbortError') { COLL.pxMsg = { t: `Lecture interrompue : ${nf0(n)} carte${n > 1 ? 's' : ''} lue${n > 1 ? 's' : ''}`, bad: false }; st.task.finish('Prix réels interrompus', 'warn', `${nf0(n)} cartes lues`); }
    else { const m = pxError(e); COLL.pxMsg = { t: m + (n ? ` (${nf0(n)} carte${n > 1 ? 's' : ''} déjà lue${n > 1 ? 's' : ''})` : ''), bad: true }; st.task.finish('Prix réels : échec', 'bad', m); }
  } finally {
    COLL.pxRun = null; pxSave(); collPaintHead(); if (COLL.el) collPaintBody(true); paintCollSection();
  }
}
/** Feuille « Prix réels » : choix de la langue des cartes et de la portée, puis lancement. */
function openCollPrices() {
  if (COLL.pxRun) { toast('Lecture des prix déjà en cours'); return; }
  if (!collCount()) { toast('Ta collection est vide'); return; }
  readOpts();
  openSheet('Prix réels', 'L\'offre CardTrader la moins chère, comme pour acheter', api => {
    const counts = {}; let none = 0, all = 0;
    for (const [k, x] of Object.entries(COLL.map)) { if (BASIC_NAMES.has(k)) continue; all++; if (x.l) counts[x.l] = (counts[x.l] || 0) + 1; else none++; }
    const opt = (v, t) => `<option value="${v}">${esc(t)}</option>`, LN = l => LANGS[l][0].toUpperCase() + LANGS[l].slice(1);
    const crit = [LANGS[S.opts.lang], 'état ≥ ' + (COND_SHORT[S.opts.cond] || S.opts.cond), S.opts.foil === 'no' ? 'non foil' : S.opts.foil === 'yes' ? 'foil' : 'foil ou non', S.opts.mode === 'zero' ? 'CardTrader Zero' : 'Direct'];
    api.body.innerHTML = `<p class="hint">Pour chaque carte, Deck Deal lit l'offre la moins chère aujourd'hui (même moteur que la recherche) et garde ce prix dans ta collection : il remplace l'estimation Cardmarket pour la valeur, le tri par prix et « les plus chères ». Les terrains de base sont ignorés.</p>
      <div class="ctl"><label class="label" for="pxLang">Langue des cartes</label><div class="sel"><select id="pxLang">${opt('', `Toutes (${all})`)}${CARD_LANG_LIST.filter(l => counts[l]).map(l => opt(l, `${LN(l)} (${counts[l]})`)).join('')}${none ? opt('none', `Sans langue (${none}) · cherchées en ${LANGS[S.opts.lang]}`) : ''}</select></div></div>
      <div class="seg" id="pxScope" role="radiogroup" aria-label="Portée"></div>
      <div class="ci-sum" id="pxSum"></div>
      <p class="hint">Chaque carte est cherchée dans sa langue. Critères repris de la recherche : <b>${esc(crit.join(' · '))}</b>. La lecture se fait carte par carte (comme une recherche) : compte quelques secondes par dizaine de cartes.</p>`;
    api.setFoot('<button class="btn ghost" type="button" data-close>Annuler</button><button class="btn" type="button" id="pxGo">Lire les prix</button>');
    mountSeg($('#pxScope', api.body), [{ v: 'old', label: 'À actualiser' }, { v: 'all', label: 'Toutes' }], 'old', () => paint());
    const sel = $('#pxLang', api.body), sum = $('#pxSum', api.body), go = $('#pxGo', api.foot);
    let targets = [];
    const paint = () => {
      const f = { lang: sel.value, scope: $('#pxScope', api.body)._v || 'old' }; targets = pxTargets(f);
      const pool = pxTargets({ lang: f.lang, scope: 'all' }), have = pool.filter(t => COLL.px[t.key] && COLL.px[t.key].t), last = have.reduce((a, t) => Math.max(a, COLL.px[t.key].t), 0);
      sum.className = 'ci-sum'; sum.innerHTML = `<div><b>${nf0(targets.length)}</b> carte${targets.length > 1 ? 's' : ''} à lire sur ${nf0(pool.length)}</div><span>${have.length ? `${nf0(have.length)} déjà lue${have.length > 1 ? 's' : ''} · dernière lecture ${pxAgo(last)}` : 'Aucun prix lu pour l\'instant'}</span>`;
      go.disabled = !targets.length; go.textContent = targets.length ? `Lire ${nf0(targets.length)} prix` : 'Rien à lire';
    };
    sel.onchange = paint; paint();
    go.onclick = () => { if (!targets.length) return; const all = $('#pxScope', api.body)._v === 'all'; api.close(); haptic('ok'); pxRun(targets, { fresh: all }); };      // « Toutes » : relecture voulue, on ignore le cache de 10 min du serveur
  });
}
function pxAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 2 ? 'à l\'instant' : m < 90 ? `il y a ${m} min` : m < 36 * 60 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
}

/* ── Infos Scryfall ───────────────────────────────────────────────────────────────────────────── */
/** Cartes dont les infos manquent, ou datent d'avant l'identité de couleur / « peut être commandant » (relues une fois). */
const collMissing = () => Object.keys(COLL.map).filter(k => !(k in COLL.meta) || (COLL.meta[k] && COLL.meta[k].ci === undefined));
/** Lit sur Scryfall le coût, le type, les couleurs, l'image et le prix de référence des cartes qui n'ont pas encore ces infos (75 par requête),
 *  puis les images des cartes qui ne sont pas en anglais, dans leur langue (12 par requête). */
async function collEnrich() {
  if (COLL.enrich) return COLL.enrich.p;
  const miss = collMissing(), lm = collLangMissing(), lmN = Object.values(lm).reduce((a, x) => a + x.length, 0); if (!miss.length && !lmN) return;
  if (scryLeft() > 0) { COLL.enrichErr = 'Scryfall demande une pause : réessaie dans ' + Math.ceil(scryLeft() / 1000) + ' s'; collPaintHead(); return; }
  const full = miss.length > 0 && miss.length >= collCount();      // toute la collection relue : les prix Cardmarket sont à jour
  const st = COLL.enrich = { done: 0, total: miss.length + lmN, ctrl: new AbortController(), ph: miss.length ? 'info' : 'img' };
  COLL.enrichErr = '';
  st.p = (async () => {
    try {
      for (let i = 0; i < miss.length; i += 75) {
        const chunk = miss.slice(i, i + 75), got = await scryCollection(chunk.map(k => COLL.map[k] ? COLL.map[k].n : k), st.ctrl.signal);
        for (const k of chunk) { const g = got.get(k), old = COLL.meta[k]; COLL.meta[k] = g || (old ? { ...old, ci: old.ci ?? '' } : null); }
        st.done = Math.min(miss.length, i + 75); collMetaSave(); collPaintHead(); if (COLL.el) collPaintBody(true);
      }
      if (full) COLL.freshAt = Date.now();
      st.ph = 'img';
      for (const [l, keys] of Object.entries(lm)) {
        const base = st.done;
        const got = await scryLangImages(keys.map(k => COLL.map[k] ? COLL.map[k].n : k), l, st.ctrl.signal, n => { st.done = base + n; collPaintHead(); });
        for (const k of keys) COLL.li[liKey(l, k)] = got.get(k) || '';
        st.done = base + keys.length; collMetaSave(); collPaintHead(); if (COLL.el) collPaintBody(true); scanPaintList();
      }
    } catch (e) { if (e.name !== 'AbortError') COLL.enrichErr = e.code === 'rate' ? 'Scryfall limite les requêtes : réessaie dans une minute' : 'Scryfall injoignable : réessaie plus tard'; }
    finally {
      COLL.enrich = null; VAL.memo = null; collMetaSave(); collPaintHead(); if (COLL.el) collPaintBody(true);
      if (!COLL.enrichErr && !st.ctrl.signal.aborted && (collMissing().length || collLangMissingCount())) setTimeout(collEnrich, 50);      // cartes ajoutées ou langues changées pendant la lecture : on enchaîne
      else if (!COLL.enrichErr && !st.ctrl.signal.aborted) valMaybe();
    }
  })();
  collPaintHead();
  return st.p;
}

/** Catalogue des noms de cartes (Scryfall) : saisie assistée et reconnaissance OCR. Chargé une fois, gardé 14 jours. */
function collCatalog() {
  if (COLL.names) return Promise.resolve(COLL.names);
  if (!COLL.namesP) COLL.namesP = scryCatalogNames().then(list => { COLL.names = { list, idx: nameIndex(list), norm: list.map(n => normPart(n)) }; return COLL.names; }).catch(e => { COLL.namesP = null; throw e; });
  return COLL.namesP;
}
/** Suggestions de noms pour un texte saisi : commence par · contient tous les mots. */
function collSuggest(cat, text, n = 12) {
  const q = normPart(text); if (q.length < 2) return [];
  const words = q.split(' ').filter(Boolean), a = [], b = [];
  for (let i = 0; i < cat.norm.length && a.length < n; i++) {
    const s = cat.norm[i];
    if (s.startsWith(q)) a.push(cat.list[i]); else if (b.length < n && words.every(w => s.includes(w))) b.push(cat.list[i]);
  }
  return a.concat(b).slice(0, n);
}

/* ── Section de la page de saisie ─────────────────────────────────────────────────────────────── */
function paintCollSection() {
  const sub = $('#collSub'); if (!sub) return;
  const n = collCount();
  const al = n ? valAlertN() : 0;
  sub.textContent = n ? `${nf0(n)} carte${n > 1 ? 's' : ''} · ${nf0(collCopies())} exemplaire${collCopies() > 1 ? 's' : ''}${al ? ` · ${nf0(al)} prix ${al > 1 ? 'ont' : 'a'} bougé` : ''}` : 'Ajoute tes cartes (import, photo, saisie) : elles seront déduites du panier.';
  $('#btnColl').dataset.empty = n ? '0' : '1';
  homeSoon();
}
function collInit() {
  collRead(); pxRead(); paintCollSection(); collMetaLoad();
  document.addEventListener('visibilitychange', () => { if (document.hidden) collSleep(); else collWake(); });
  window.addEventListener('online', collWake);
  window.addEventListener('offline', () => { if (cloudOn() && COLL.cloud !== 'error') { COLL.cloud = 'offline'; collPaintHead(); } });
  window.addEventListener('pagehide', collSleep);
  const sec = $('#collSec'); if (sec) sec.hidden = false;
}

/* ── Écran « Ma collection » ──────────────────────────────────────────────────────────────────── */
/* ── Noms français : une carte marquée FR s'affiche sous son nom imprimé (« Anneau solaire »), les autres sous leur nom anglais ───── */
const FRN = { map: null, p: null, fail: 0 };
/** Nom imprimé français d'une carte, quelle que soit la langue de l'exemplaire ('' si le catalogue ne la connaît pas) : sert à la recherche (« anneau solaire » trouve aussi une Sol Ring anglaise). */
function frOf(k) {
  const m = FRN.map || (typeof FRC !== 'undefined' && FRC.cat && FRC.cat.fr) || null;
  return (m && m.get(k)) || '';
}
/** Nom affiché d'une ligne de la collection : l'imprimé français pour un exemplaire FR ('' si la carte n'est pas FR ou si le catalogue ne la connaît pas). */
const frName = (k, l) => (l === 'fr' ? frOf(k) : '');
/** Charge les noms imprimés dès que la collection a des cartes (affichage des cartes FR et recherche en français) : catalogue déjà sur l'appareil, sinon fichier du site (1 requête, gardé ensuite). Jamais les pages Scryfall ici : c'est le scan qui s'en charge. */
function collFrLoad() {
  if (FRN.map || FRN.p || Date.now() - FRN.fail < 60000) return;
  if (!collCount()) return;
  FRN.p = (async () => {
    const rec = (await scryFrCached().catch(() => null)) || (await scryFrStatic().catch(() => null));
    if (rec) { FRN.map = frNames(rec.rows); collPaint(); } else FRN.fail = Date.now();
  })().catch(() => { FRN.fail = Date.now(); }).finally(() => { FRN.p = null; });
}
const SORT_OPTS = [['name', 'Nom'], ['qty', 'Quantité'], ['price', 'Prix'], ['cmc', 'Coût'], ['decks', 'Decks EDHREC'], ['new', 'Ajout : récentes en haut'], ['old', 'Ajout : anciennes en haut']];
const isDateSort = () => COLL.sort === 'new' || COLL.sort === 'old';
function collItems() {
  return Object.entries(COLL.map).map(([k, x]) => {
    const px = COLL.px[k], dn = frName(k, x.l), fn = frOf(k), it = { k, n: x.n, ...(dn ? { dn } : {}), ...(fn && fn !== dn ? { fn } : {}), q: x.q, l: x.l || '', d: x.d || 0, ...(COLL.meta[k] || {}), ...(px ? { rp: px.p, rt: px.t, rc: px.c || 'EUR' } : {}) };
    return Object.assign(it, cmdrClass(it, EDH.data));      // cx : 0 · 1 peut être commandant · 2 joué comme commandant (EDHREC), ed : nombre de decks
  });
}
/** Lignes d'affichage d'une carte : une par langue possédée (fr, en…), chacune avec sa quantité, son nom imprimé et son image. Les infos de la carte (type, coût, étiquettes) ne sont montrées que sur la première ; l'offre CardTrader seulement sur la ligne de la langue lue (la plus fournie). */
function collRowItems(it) {
  const ls = collLines(COLL.map[it.k]); if (ls.length < 2) return [{ ...it, nl: 1, li: 0 }];
  const dom = collDomLang(ls);
  return ls.map(([l, q], i) => { const r = { ...it, l, q, nl: ls.length, li: i }; const dn = frName(it.k, l); if (dn) r.dn = dn; else delete r.dn; if (l !== dom) { delete r.rp; delete r.rt; delete r.rc; } return r; });
}
function collSorted(items) {
  const by = { name: byName, qty: (a, b) => (b.q - a.q) || byName(a, b), price: (a, b) => (((srcPrice(b, COLL.src) || {}).u || 0) - ((srcPrice(a, COLL.src) || {}).u || 0)) || byName(a, b), cmc: (a, b) => ((a.cm ?? 99) - (b.cm ?? 99)) || byName(a, b), decks: (a, b) => ((b.ed || 0) - (a.ed || 0)) || ((b.cx || 0) - (a.cx || 0)) || byName(a, b), new: (a, b) => ((b.d || 0) - (a.d || 0)) || byName(a, b), old: (a, b) => ((a.d || 0) - (b.d || 0)) || byName(a, b) }[COLL.sort] || byName;
  return items.slice().sort(by);
}
const CARD_LANG_LIST = ['fr', 'en', 'de', 'es', 'it', 'pt', 'jp', 'zh-CN'];
/** Puce langue d'une carte : drapeau (ou « Langue ? »), et un <select> invisible par-dessus : un appui ouvre le choix natif de la langue. */
function langChip(k, l, name, cls) {
  return `<label class="lchip${l ? '' : ' none'}${cls ? ' ' + cls : ''}" data-l="${esc(l)}">${l ? flag(l) : '<span>Langue ?</span>'}<select data-lk="${esc(k)}" aria-label="Langue de ${esc(name)}"><option value=""${l ? '' : ' selected'}>Non précisée</option>${CARD_LANG_LIST.map(x => `<option value="${x}"${x === l ? ' selected' : ''}>${esc(LANGS[x][0].toUpperCase() + LANGS[x].slice(1))}</option>`).join('')}</select></label>`;
}
function crowHtml(it) {
  const nm = it.dn || it.n, hue = hash32(it.k) % 360, letter = esc((nm.trim()[0] || '?').toUpperCase()), img = collImage(it.k, it.l, it.im).src, sub = it.li > 0;      // sub : 2e ligne de langue de la même carte
  const tags = [];      // le drapeau suit le nom (à droite, loin de la vignette qu'on touche pour agrandir) ; « Langue ? » finit la rangée de tags
  if (!sub && it.tl) tags.push(`<span class="tag">${esc(typeBucket(it.tl))}</span>`);
  if (!sub && it.cm != null && it.tl && typeBucket(it.tl) !== 'Terrains') tags.push(`<span class="tag">Coût ${it.cm}</span>`);
  if (!sub && COLL.f.cmdr && it.cx) tags.push(it.cx === 2 ? `<span class="tag accent" title="Commandant dans des decks EDHREC">Commander${it.ed ? ' · ' + nf0(it.ed) + ' decks' : ''}</span>` : '<span class="tag accent">Commander</span>');
  if (!sub && isDateSort() && it.d) tags.push(`<span class="tag" title="Date d'ajout à la collection">${esc(new Date(it.d * 1000).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>`);
  const mvv = !sub && valMove(it.k); if (mvv) tags.push(valTag(mvv));
  const mnt = !sub && engTag(it.k); if (mnt) tags.push(mnt);
  if (!it.l) tags.push(langChip(it.k, '', it.n));
  const px = [];      // prix : CM (tendance Cardmarket, estimation) au-dessus, CT (offre CardTrader la plus basse, lue à la demande) en dessous
  if (Number.isFinite(it.eu)) px.push(`<span class="px cm" title="Cardmarket : prix tendance"><i>CM</i> <b>${esc(fmt(it.eu, 'EUR'))}</b></span>`);
  if (Number.isFinite(it.rp)) px.push(`<span class="px ct" title="CardTrader : offre la plus basse"><i>CT</i> <b>${esc(fmt(it.rp, it.rc || 'EUR'))}</b></span>`);
  else if (it.rp === null && it.rt) px.push('<span class="px ct none" title="CardTrader : aucune offre"><i>CT</i> <b>aucune offre</b></span>');
  return `<div class="crow${px.length ? ' has-px' : ''}${sub ? ' sub' : ''}${it.nl > 1 ? ' ml' : ''}" data-k="${esc(it.k)}" data-ln="${esc(it.l)}"><span class="thumb" style="--h:${hue}">${letter}${img ? `<img alt="" loading="lazy" decoding="async" src="${esc(img)}">` : ''}</span>
    <span class="row-main"><span class="row-top"><span class="row-name">${esc(nm)}</span>${it.l ? langChip(it.k, it.l, it.n) : ''}</span>${tags.length ? `<span class="row-meta">${tags.join('')}</span>` : ''}</span>
    ${px.length ? `<span class="row-px">${px.join('')}</span>` : ''}
    <span class="qstep"><button type="button" data-d="-1" aria-label="Retirer un exemplaire de ${esc(nm)}">−</button><b>${it.q}</b><button type="button" data-d="1" aria-label="Ajouter un exemplaire de ${esc(nm)}">+</button></span></div>`;
}
/** État de la sauvegarde, en toutes lettres (le sous-titre du header est tronqué sur téléphone) : { k: 'ok'|'warn'|'bad', t, acts:[[act, label]] } ou null. */
function collSyncInfo() {
  if (!collCount()) return null;
  const exp = ['export', 'Exporter'];
  if (D.user) {
    if (COLL.cloud === 'ok') return { k: 'ok', t: 'Sauvegardée dans ton compte', acts: [exp] };
    if (COLL.cloud === 'offline') return { k: 'warn', t: 'Hors ligne : tes changements restent sur cet appareil et partiront au retour du réseau.', acts: [['resync', 'Réessayer'], exp] };
    if (COLL.cloud === 'error') return { k: 'bad', t: 'Pas sauvegardée dans ton compte : ' + (COLL.err || 'synchronisation impossible') + '. Tes cartes ne sont que sur cet appareil.', acts: [['resync', 'Réessayer'], exp] };
    return { k: 'warn', t: 'Synchronisation avec ton compte…', acts: [] };
  }
  if (D.state === 'unavailable') return { k: 'bad', t: 'Compte indisponible ici (Firebase bloqué ou hors ligne) : tes cartes ne sont que sur cet appareil.', acts: [exp] };
  if (!D.authReady) return null;
  return { k: 'warn', t: 'Pas sauvegardée dans un compte : tes cartes ne sont que sur cet appareil (perdues si les données du navigateur sont effacées).', acts: [['login', 'Se connecter'], exp] };
}
/** Télécharge la collection en texte (« 3 Sol Ring *FR* », réimportable). */
function collExport() {
  try {
    const url = URL.createObjectURL(new Blob([collToText(COLL.map) + '\n'], { type: 'text/plain;charset=utf-8' })), a = document.createElement('a');
    a.href = url; a.download = 'ma-collection-' + new Date().toISOString().slice(0, 10) + '.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Collection exportée (' + nf0(collCount()) + ' cartes)');
  } catch (e) { toast('Export impossible sur ce navigateur'); }
}
function collHeadText() {
  const n = collCount(), c = collCopies();
  const sync = D.user ? (COLL.cloud === 'ok' ? 'synchronisée' : COLL.cloud === 'sync' ? 'synchronisation…' : COLL.cloud === 'offline' ? 'hors ligne' : COLL.cloud === 'error' ? COLL.err : '') : 'sur cet appareil';
  return n ? `${nf0(n)} carte${n > 1 ? 's' : ''} · ${nf0(c)} exemplaire${c > 1 ? 's' : ''}${sync ? ' · ' + sync : ''}` : 'Vide pour le moment';
}
function collPaintHead() {
  paintCollSection();
  if (typeof BD !== 'undefined' && BD.el && BD.tab === 'coll') { BD.idx = null; bdList(); }      // l'éditeur de deck liste la collection : il suit la lecture des cartes (commandants possibles…)
  const el = COLL.el; if (!el) return;
  $('.dv-title span', el).textContent = collHeadText();
  const sy = $('.coll-sync', el), si = collSyncInfo();
  if (!si) sy.hidden = true;
  else { sy.hidden = false; sy.dataset.k = si.k; sy.innerHTML = `<span class="sy-d" aria-hidden="true"></span><span class="sy-t">${esc(si.t)}</span>${si.acts.map(([a, l]) => `<button class="link-btn" type="button" data-act="${a}">${esc(l)}</button>`).join('')}`; }
  const stt = $('.coll-status', el), e = COLL.enrich, miss = collMissing().length, lmiss = collLangMissingCount();
  const px = COLL.pxRun;
  if (px) { stt.hidden = false; stt.dataset.k = 'run'; stt.innerHTML = `<span>Prix réels · ${nf0(Math.floor(px.done))} / ${nf0(px.total)}${px.step ? ' · ' + esc(px.step) : ''}</span><span class="track"><span class="fill" style="width:${Math.round(100 * px.done / Math.max(1, px.total))}%"></span></span><button class="link-btn" type="button" data-act="pxstop">Arrêter</button>`; }
  else if (COLL.pxMsg) { stt.hidden = false; stt.dataset.k = COLL.pxMsg.bad ? 'err' : 'idle'; stt.innerHTML = `<span>${esc(COLL.pxMsg.t)}</span><button class="link-btn" type="button" data-act="pxok">OK</button>`; }
  else if (e) { stt.hidden = false; stt.dataset.k = 'run'; stt.innerHTML = `<span>${e.ph === 'img' ? 'Images dans la langue des cartes' : 'Lecture des cartes sur Scryfall'} · ${nf0(e.done)} / ${nf0(e.total)}</span><span class="track"><span class="fill" style="width:${Math.round(100 * e.done / Math.max(1, e.total))}%"></span></span>`; }
  else if (VAL.run) { stt.hidden = false; stt.dataset.k = 'run'; stt.innerHTML = `<span>Prix Cardmarket · ${nf0(VAL.run.done)} / ${nf0(VAL.run.total)}</span><span class="track"><span class="fill" style="width:${Math.round(100 * VAL.run.done / Math.max(1, VAL.run.total))}%"></span></span>`; }
  else if (COLL.enrichErr) { stt.hidden = false; stt.dataset.k = 'err'; stt.innerHTML = `<span>${esc(COLL.enrichErr)}</span><button class="link-btn" type="button" data-act="enrich">Réessayer</button>`; }
  else if (miss && collCount()) { stt.hidden = false; stt.dataset.k = 'idle'; stt.innerHTML = `<span>${nf0(miss)} carte${miss > 1 ? 's' : ''} sans infos (coût, type, image)</span><button class="link-btn" type="button" data-act="enrich">Compléter</button>`; }
  else if (lmiss && collCount()) { stt.hidden = false; stt.dataset.k = 'idle'; stt.innerHTML = `<span>${nf0(lmiss)} carte${lmiss > 1 ? 's' : ''} sans image dans sa langue</span><button class="link-btn" type="button" data-act="enrich">Charger</button>`; }
  else stt.hidden = true;
  valPaintAlert();
}
function collPaint() { collPaintHead(); if (COLL.el) collPaintBody(true); }

/** Barres horizontales (couleurs, familles) : rows = [[libellé html, valeur, classe]]. */
function barsHtml(rows) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<div class="cs-bars">${rows.filter(r => r[1] > 0).map(([l, v, c]) => `<div class="cs-b"><span class="cs-l">${l}</span><span class="cs-t"><i class="${c || ''}" style="width:${Math.max(3, Math.round(v / max * 100))}%"></i></span><span class="cs-n">${nf0(v)}</span></div>`).join('')}</div>`;
}
/** Tuile de valeur (Stats) : bascule entre les prix réels CardTrader (CT) et l'estimation Cardmarket (CM). Choix retenu sur l'appareil. */
function collToggleSrc() {
  COLL.src = COLL.src === 'cm' ? 'ct' : 'cm'; haptic('tap');
  try { localStorage.setItem(COLL_SRC_KEY, COLL.src); } catch (e) { /* stockage indisponible */ }
  collPaintBody(true);
  const t = $('.cs-val', COLL.el); if (t) t.focus({ preventScroll: true });
}
function collStatsHtml(items) {
  const st = collStats(items, COLL.src), miss = st.unknown, cm = st.src === 'cm';
  const colorRows = [['W', 'Blanc'], ['U', 'Bleu'], ['B', 'Noir'], ['R', 'Rouge'], ['G', 'Vert']].map(([c, n]) => [`<i class="mc mc-${c.toLowerCase()}">${c}</i>${n}`, st.colors[c], 'k-' + c.toLowerCase()])
    .concat([['<i class="mc mc-m">M</i>Multicolore', st.colors.M, 'k-m'], ['<i class="mc mc-n">C</i>Incolore', st.colors.C, 'k-n']]);
  const typeRows = TYPE_ORDER.map(t => [esc(t), st.types[t], 'k-t']);
  const nums = `<div class="cs-tiles"><div><b>${nf0(st.unique)}</b><span>carte${st.unique > 1 ? 's' : ''} différente${st.unique > 1 ? 's' : ''}</span></div><div><b>${nf0(st.copies)}</b><span>exemplaire${st.copies > 1 ? 's' : ''}</span></div><div class="cs-val" role="button" tabindex="0" data-act="pxsrc" aria-label="Valeur de la collection, source ${cm ? 'Cardmarket' : 'CardTrader'} : touche pour passer à ${cm ? 'CardTrader' : 'Cardmarket'}"><b>${st.valued ? esc(fmt(st.value, 'EUR')) : '—'}</b><span>${cm ? `valeur · tendance Cardmarket${st.valued < st.known ? ` (${nf0(st.valued)} cartes)` : ''}` : st.real ? `valeur · ${nf0(st.real)} au prix réel CardTrader${st.valued > st.real ? `, ${nf0(st.valued - st.real)} estimées Cardmarket` : ''}` : `valeur ≈ tendance Cardmarket${st.valued && st.valued < st.known ? ` (${nf0(st.valued)} cartes)` : ''}`}</span><div class="cs-src"><div class="cs-sw" aria-hidden="true"><i${cm ? '' : ' class="on"'}>CT</i><i${cm ? ' class="on"' : ''}>CM</i></div><small>${st.alt.valued ? `${cm ? 'CT' : 'CM'} : ${esc(fmt(st.alt.value, 'EUR'))} · ` : ''}touche pour changer</small></div></div></div>`;
  const note = miss ? `<p class="hint">Stats sur ${nf0(st.known)} cartes lues ; ${nf0(miss)} sans infos pour l'instant.</p>` : '';
  const byLot = COLL.topBy !== 'one', list = byLot ? st.top : st.topUnit, shown = list.slice(0, COLL.topN), cur = i => (i.rl ? i.rc || 'EUR' : 'EUR');
  const top = list.length ? `<h3 class="cs-h">Les plus chères <span class="cs-sw" role="group" aria-label="Classer par"><button type="button" data-act="topby" data-v="lot" aria-pressed="${byLot}" class="${byLot ? 'on' : ''}">Par lot</button><button type="button" data-act="topby" data-v="one" aria-pressed="${!byLot}" class="${byLot ? '' : 'on'}">Par carte</button></span></h3><p class="hint cs-topnote">${byLot ? 'Classées par valeur du lot : prix × exemplaires.' : 'Classées par prix d\'un exemplaire.'}</p><div class="cs-top">${shown.map(i => `<div class="crow ro" data-k="${esc(i.k)}"><span class="thumb" style="--h:${hash32(i.k) % 360}">${esc((i.n.trim()[0] || '?').toUpperCase())}${i.im ? `<img alt="" loading="lazy" decoding="async" src="${esc(i.im)}">` : ''}</span><span class="row-main"><span class="row-name">${esc(i.dn || i.n)}</span><span class="row-meta">${i.q > 1 ? `<span class="tag accent">× ${nf0(i.q)}</span>` : ''}${i.rl ? '<span class="tag real">prix réel</span>' : ''}</span></span><span class="row-price"><b>${esc(fmt(byLot ? i.lot : i.up, cur(i)))}</b>${i.q > 1 ? `<small>${byLot ? `${esc(fmt(i.up, cur(i)))} × ${nf0(i.q)}` : `× ${nf0(i.q)} = ${esc(fmt(i.lot, cur(i)))}`}</small>` : ''}</span></div>`).join('')}</div>${list.length > shown.length ? `<button class="btn ghost block coll-more" type="button" data-act="topmore">Afficher ${nf0(Math.min(10, list.length - shown.length))} de plus · ${nf0(list.length - shown.length)} restantes</button>` : ''}` : '';
  return `${nums}${note}${valStatsHtml()}
    <h3 class="cs-h">Courbe de mana <small>${nf0(st.spells)} sorts</small></h3>${curveBars(st.curve, false)}
    <h3 class="cs-h">Couleurs <small>sorts</small></h3>${barsHtml(colorRows)}
    <h3 class="cs-h">Familles <small>exemplaires</small></h3>${barsHtml(typeRows)}${top}`;
}
function collEmptyHtml() {
  return `<div class="dv-empty"><div class="empty-art" aria-hidden="true"><i></i><i></i><i></i></div><b>Ta collection est vide</b><p>Ajoute les cartes que tu possèdes : elles ne seront plus cherchées ni comptées dans tes paniers.</p>
    <div class="coll-cta"><button class="btn" type="button" data-act="import">Importer un fichier</button><button class="btn ghost" type="button" data-act="scan">Scanner des cartes</button><button class="btn ghost" type="button" data-act="add">Ajouter à la main</button></div>
    <p class="hint">Pour 1 000 cartes ou plus : exporte-les en CSV depuis ManaBox, Moxfield, Archidekt, Deckbox ou Dragon Shield, puis importe le fichier.</p></div>`;
}
/** Remplit la liste ou les stats selon l'onglet. keep : garder la position de défilement. */
function collPaintBody(keep) {
  const el = COLL.el; if (!el) return;
  const sc = $('.dv-scroll', el), pos = keep && sc ? sc.scrollTop : 0, host = $('.coll-main', el), all = collItems();
  if (keep && document.activeElement && document.activeElement.matches && document.activeElement.matches('.lchip select') && host.contains(document.activeElement)) { COLL.dirty = true; return; }      // un choix de langue est ouvert : on ne le ferme pas
  $('.coll-controls', el).hidden = !all.length;
  if (!all.length) { host.innerHTML = collEmptyHtml(); return; }
  $('.coll-fwrap', el).hidden = COLL.tab !== 'list' && COLL.tab !== 'trade'; $('#collSort', el).closest('.coll-sort').hidden = COLL.tab === 'trade'; valPaintAlert();
  if (COLL.tab === 'stats') { host.innerHTML = collStatsHtml(all); }
  else if (COLL.tab === 'trade') { host.innerHTML = trPanelHtml(); trMount(host); }
  else if (COLL.tab === 'decks') { const res = keep && EDH.data && document.activeElement && document.activeElement.id === 'dkQ' ? $('.dk-res', host) : null; if (res) { res.innerHTML = edhResHtml(); edhThemesSync(); } else { host.innerHTML = edhPanelHtml(); edhEnsure(); } }      // en pleine frappe : seuls les résultats se repeignent, le champ garde le focus
  else if (COLL.f.cmdr === 'played' && !EDH.data) { host.innerHTML = edhWaitHtml(); edhEnsure(); }
  else {
    const filtered = filterItems(all, COLL.f), sorted = collSorted(filtered), shown = sorted.slice(0, COLL.shown), act = filterActive(COLL.f);
    const known = all.filter(i => i.tl != null || i.cm != null).length, hid = (COLL.f.colors.size || COLL.f.type || COLL.f.cmc !== '' || COLL.f.cmdr) && known < all.length;
    const undated = isDateSort() ? all.filter(i => !i.d).length : 0;
    host.innerHTML = `${undated ? `<p class="hint coll-count">${nf0(undated)} carte${undated > 1 ? 's' : ''} sans date d'ajout (déjà là avant le suivi des dates) : ${COLL.sort === 'new' ? 'en bas' : 'en haut'}, par nom.</p>` : ''}${act ? `<p class="hint coll-count">${nf0(filtered.length)} carte${filtered.length > 1 ? 's' : ''} sur ${nf0(all.length)}${hid ? ' · les cartes sans infos sont masquées par ces filtres' : ''}</p>` : ''}
      ${shown.length ? `<div class="coll-list">${shown.flatMap(collRowItems).map(crowHtml).join('')}</div>` : '<p class="hint listempty">Aucune carte ne correspond.</p>'}
      ${sorted.length > shown.length ? `<button class="btn ghost block coll-more" type="button" data-act="more">Afficher ${nf0(Math.min(COLL_PAGE, sorted.length - shown.length))} de plus · ${nf0(sorted.length - shown.length)} restantes</button>` : ''}`;
  }
  if (sc) sc.scrollTop = pos;
  if (!keep) stagger($$('.coll-list, .cs-tiles, .dk-res', host));
}

function closeCollection() { if (COLL.el) COLL.el.__close(); }
/** Ouvre l'écran de la collection (tab : 'list' | 'stats'). */
function openCollection(tab) {
  closeCollection();
  if (tab) COLL.tab = tab;
  COLL.shown = COLL_PAGE; collFrLoad();
  const wrap = document.createElement('div'); wrap.className = 'dv coll'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Ma collection');
  wrap.innerHTML = `<header class="dv-head"><button class="icon-btn dv-back" type="button" data-act="close" aria-label="Fermer la collection"><svg class="i"><use href="#i-back"/></svg></button>
      <div class="dv-title"><b>Ma collection</b><span></span></div>
      <div class="coll-tools"><button class="icon-btn" type="button" data-act="add" aria-label="Ajouter une carte" title="Ajouter une carte"><svg class="i"><use href="#i-plus"/></svg></button>
        <button class="icon-btn" type="button" data-act="scan" aria-label="Scanner des cartes" title="Scanner des cartes"><svg class="i"><use href="#i-camera"/></svg></button>
        <button class="icon-btn" type="button" data-act="import" aria-label="Importer un fichier ou du texte" title="Importer"><svg class="i"><use href="#i-upload"/></svg></button></div></header>
    <div class="dv-scroll"><div class="dv-body coll-body">
      <div class="coll-sync" hidden></div>
      <div class="coll-status" hidden></div>
      <div class="coll-alert" hidden></div>
      <div class="coll-controls"><div class="coll-top"><div class="seg" id="collSeg" role="radiogroup" aria-label="Affichage"></div><button class="icon-btn coll-px" type="button" data-act="prices" aria-label="Lire les prix réels des cartes (CardTrader)" title="Prix réels"><b>€</b></button></div>
        <div class="coll-fwrap"><div id="collF"></div><label class="sortsel coll-sort"><span>Trier</span><select id="collSort" aria-label="Trier la collection">${SORT_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label></div></div>
      <div class="coll-main"></div></div></div>`;
  COLL.el = wrap; const prevFocus = document.activeElement;
  const onKey = e => { if (e.key === 'Escape' && !imgView && !sheets.length) { e.stopPropagation(); wrap.__close(); } };
  wrap.__close = () => {
    if (COLL.el !== wrap) return; COLL.el = null; document.removeEventListener('keydown', onKey, true);
    wrap.classList.remove('on'); setTimeout(() => wrap.remove(), reduceMotion() ? 0 : 240); releaseApp();
    try { if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
  wrap.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  mountSeg($('#collSeg', wrap), [{ v: 'list', label: 'Cartes' }, { v: 'stats', label: 'Stats' }, { v: 'decks', label: 'Decks' }, { v: 'trade', label: 'Échange' }], COLL.tab, v => { const ord = ['list', 'stats', 'decks', 'trade'], dir = ord.indexOf(v) > ord.indexOf(COLL.tab) ? 'l' : 'r'; { const h = $('.coll-main', wrap); if (h) h.dataset.dir = dir; } COLL.tab = v; COLL.shown = COLL_PAGE; TR.shown = TR_PAGE; collPaintBody(false); const sc = $('.dv-scroll', wrap); if (sc) sc.scrollTop = 0; const h = $('.coll-main', wrap); if (h) { h.classList.remove('tabin'); void h.offsetWidth; h.classList.add('tabin'); } });
  COLL.fb = mountFilters($('#collF', wrap), COLL.f, () => {
    if (COLL.f.cmdr === 'played' && COLL.cmdrSeen !== 'played' && COLL.sort === 'name') { COLL.sort = 'decks'; $('#collSort', wrap).value = 'decks'; }      // les plus joués d'abord
    COLL.cmdrSeen = COLL.f.cmdr; COLL.shown = COLL_PAGE; TR.shown = TR_PAGE; collPaintBody(true);
  }, { placeholder: 'Rechercher dans ma collection', commander: true });
  COLL.cmdrSeen = COLL.f.cmdr;
  $('#collSort', wrap).value = COLL.sort;
  $('#collSort', wrap).onchange = e => { COLL.sort = e.target.value; COLL.shown = COLL_PAGE; haptic('tap'); collPaintBody(false); };
  wrap.addEventListener('input', edhInput);
  wrap.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'dkQ') e.target.blur(); });
  wrap.addEventListener('change', e => {
    const bud = e.target.closest && e.target.closest('select[data-act="dbudget"]');
    if (bud) { EDH.budget = Number(bud.value) || 0; EDH.shown = 30; haptic('tap'); collPaintBody(true); return; }
    const sel = e.target.closest && e.target.closest('.lchip select'); if (!sel) return;
    const k = sel.dataset.lk, l = sel.value, from = sel.closest('.lchip').dataset.l || ''; haptic('tap'); sel.blur(); COLL.dirty = false;
    collSetLang(k, l, from); collPaintBody(true);      // la ligne change de langue : son nom, son image, et elle peut rejoindre la ligne de l'autre langue
  });
  wrap.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest && e.target.closest('.cs-val')) { e.preventDefault(); collToggleSrc(); }
    else if (e.target.matches && e.target.matches('.crow.dk')) { e.preventDefault(); edhClick(e); }
  });
  wrap.addEventListener('focusout', e => { if (COLL.dirty && e.target.matches && e.target.matches('.lchip select')) setTimeout(() => { COLL.dirty = false; collPaintBody(true); }, 0); });
  wrap.addEventListener('click', e => {
    if (e.target.closest('.lchip')) return;
    if (e.target.closest('.cs-val')) { collToggleSrc(); return; }
    if (edhClick(e) || valClick(e) || trClick(e)) return;
    const b = e.target.closest('button[data-act]');
    if (b) {
      const act = b.dataset.act;
      if (act === 'close') wrap.__close();
      else if (act === 'add') openCollAdd();
      else if (act === 'scan') openScan();
      else if (act === 'import') openCollImport();
      else if (act === 'enrich') { COLL.enrichErr = ''; collEnrich(); }
      else if (act === 'prices') openCollPrices();
      else if (act === 'login') openAccount();
      else if (act === 'export') collExport();
      else if (act === 'resync') collSyncNow();
      else if (act === 'pxstop') { if (COLL.pxRun) COLL.pxRun.ctrl.abort(); }
      else if (act === 'pxok') { COLL.pxMsg = null; collPaintHead(); }
      else if (act === 'more') { COLL.shown += COLL_PAGE; collPaintBody(true); }
      else if (act === 'dcan') { COLL.f.cmdr = 'can'; COLL.cmdrSeen = 'can'; if (COLL.fb) COLL.fb.paint(); collPaintBody(true); }
      else if (act === 'topmore') { COLL.topN += 10; collPaintBody(true); }
      else if (act === 'topby') { if (COLL.topBy !== b.dataset.v) { COLL.topBy = b.dataset.v === 'one' ? 'one' : 'lot'; COLL.topN = 10; haptic('tap'); collPaintBody(true); } }
      return;
    }
    const st = e.target.closest('.qstep button');
    if (st) {
      const rowEl = st.closest('.crow'), k = rowEl.dataset.k, ln = rowEl.dataset.ln || '', cur = COLL.map[k]; if (!cur) return;
      const lines = collLines(cur), line = lines.find(x => x[0] === ln); if (!line) return;
      const d = Number(st.dataset.d), tag = lines.length > 1 ? (ln ? langCode(ln) : 'sans langue') : '', same = r => r.dataset.k === k && (r.dataset.ln || '') === ln; haptic('tap');
      const step = () => {                                  // le « − » passe par une confirmation ; la ligne est retrouvée à ce moment-là (la liste a pu être repeinte)
        const c = COLL.map[k]; if (!c) return;
        const was = (collLines(c).find(x => x[0] === ln) || [ln, 0])[1], multi = collLines(c).length > 1, name = c.n, date = c.d, q = collBump(k, name, d, { paint: false, lang: ln }), row = $$('.crow', wrap).find(same);
        if (q) { if (row) $('.qstep b', row).textContent = q; }
        else {
          if (multi) collPaintBody(true); else if (row) row.remove();      // une langue de moins : les autres lignes de la carte se réorganisent
          toast(`${name}${multi ? ' (' + (ln ? langCode(ln) : 'sans langue') + ')' : ''} retirée de la collection`, { label: 'Annuler', fn: () => { collBump(k, name, was, { date, lang: ln }); } });
        }
      };
      if (d < 0) confirmMinus(cur.n, line[1], 'coll', step, tag); else step();
      return;
    }
    const th = e.target.closest('.thumb');
    if (th && th.querySelector('img.ok')) {
      const row = th.closest('.crow'); if (!row) return;
      const rows = $$('.crow', row.parentNode), list = rows.map(r => collViewItem(r.dataset.k, r.dataset.ln || '')).filter(Boolean);
      const i = list.findIndex(x => x.lid === row.dataset.k + '|' + (row.dataset.ln || '')); if (i >= 0) openCardViewer(list, i);
    }
  });
  document.body.appendChild(wrap); holdApp(); collPaintHead(); collPaintBody(false);
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('on'); $('.dv-back', wrap).focus({ preventScroll: true }); }));
  haptic('tap');
  if ((collMissing().length || collLangMissingCount()) && !COLL.enrichErr) collEnrich(); else valMaybe();
}
function collViewItem(k, ln) {
  const x = COLL.map[k], m = COLL.meta[k]; if (!x || !m || !m.im) return null;
  const ls = collLines(x), line = ls.find(e => e[0] === (ln || '')) || ls[0] || [x.l || '', x.q], l = line[0], n = line[1];
  const im = collImage(k, l, m.im), fr = l && l !== 'en' && im.lang === 'en' ? ' · image anglaise (pas d\'image ' + (LANGS[l] || l) + ' sur Scryfall)' : '';
  const own = ls.length > 1 ? `${n} exemplaire${n > 1 ? 's' : ''} ${l ? langCode(l) : 'sans langue'} · ${x.q} au total` : `${x.q} exemplaire${x.q > 1 ? 's' : ''} dans ta collection`;
  return { key: k, lid: k + '|' + l, name: frName(k, l) || x.n, ln: x.n, wl: l && l !== 'en' ? l : '', small: im.src, lang: im.lang, plain: true, extra: `${own}${Number.isFinite(m.eu) ? ' · réf. Cardmarket ' + fmt(m.eu, 'EUR') : ''}${COLL.px[k] && Number.isFinite(COLL.px[k].p) ? ' · offre CardTrader ' + fmt(COLL.px[k].p, COLL.px[k].c || 'EUR') : ''}${fr}` };
}

/* ── Ajouter à la main ────────────────────────────────────────────────────────────────────────── */
function openCollAdd() {
  openSheet('Ajouter une carte', 'Nom anglais ou français déjà connu de Scryfall', api => {
    api.body.innerHTML = `<div class="field-in"><label class="label" for="caName">Nom de la carte</label><input type="text" id="caName" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Sol Ring" enterkeyhint="search"></div>
      <div class="field-in"><label class="label" for="caLang">Langue des exemplaires ajoutés</label><div class="sel"><select id="caLang"><option value="">Celle de la carte (sinon non précisée)</option>${CARD_LANG_LIST.map(x => `<option value="${x}">${esc(LANGS[x][0].toUpperCase() + LANGS[x].slice(1))}</option>`).join('')}</select></div></div>
      <div class="status" id="caStatus" data-ok="0" hidden><span class="dot"></span><span></span></div>
      <div class="ca-list" id="caList" role="listbox" aria-label="Suggestions"></div>`;
    const inp = $('#caName', api.body), list = $('#caList', api.body), stt = $('#caStatus', api.body), lang = $('#caLang', api.body);
    let cat = null, added = new Map();
    const say = (t, ok) => { stt.hidden = !t; if (t) { $('span:last-child', stt).textContent = t; stt.dataset.ok = ok ? '1' : '0'; } };
    const paint = () => {
      const q = inp.value.trim();
      if (!cat) { list.innerHTML = ''; return; }
      const sug = collSuggest(cat, q);
      list.innerHTML = sug.map(n => { const k = ownKey(n), have = collQty(k); return `<button type="button" class="ca-opt" role="option" data-n="${esc(n)}"><span>${esc(n)}</span><i>${have ? `× ${have}` : '+'}</i></button>`; }).join('')
        || (q.length >= 2 ? '<p class="hint">Aucune carte de ce nom. Vérifie l\'orthographe (nom anglais).</p>' : '');
    };
    list.onclick = e => {
      const b = e.target.closest('.ca-opt'); if (!b) return;
      const n = b.dataset.n, k = ownKey(n); collBump(k, n, 1, lang.value ? { lang: lang.value } : undefined); const q = collQty(k); haptic('ok'); added.set(k, q);
      const i = $('i', b); i.textContent = '× ' + q; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      say(`${n} · ${q} dans ta collection`, true); collEnrich();
    };
    inp.oninput = paint;
    say('Chargement du catalogue (une seule fois)…', false);
    collCatalog().then(c => { cat = c; say(''); paint(); }).catch(e => say(e && e.code === 'rate' ? 'Scryfall demande une pause, réessaie dans une minute.' : 'Catalogue Scryfall injoignable : réessaie plus tard.', false));
    setTimeout(() => inp.focus(), 380);
  });
}

/* ── Importer (fichier CSV, texte collé, texte partagé) ───────────────────────────────────────── */
function openCollImport(initial) {
  openSheet('Importer ma collection', 'ManaBox, Moxfield, Archidekt, Deckbox, Dragon Shield… ou une liste « 3 Sol Ring »', api => {
    api.body.innerHTML = `<p class="hint">Le plus simple pour beaucoup de cartes : exporte ta collection en CSV depuis l'appli que tu utilises, puis choisis le fichier. Les quantités d'une même carte (éditions différentes) s'additionnent ; une ligne par langue si le fichier la donne.</p>
      <label class="btn ghost small ci-file"><svg class="i"><use href="#i-upload"/></svg>Choisir un fichier<input type="file" id="ciFile" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"></label>
      <div class="field-in"><label class="label" for="ciText">ou colle le texte</label><textarea id="ciText" class="ci-text" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="3 Sol Ring&#10;1 Swords to Plowshares"></textarea></div>
      <div class="ci-sum" id="ciSum" hidden></div>
      <div class="seg" id="ciMode" role="radiogroup" aria-label="Mode d'import"></div>`;
    mountSeg($('#ciMode', api.body), [{ v: 'add', label: 'Ajouter' }, { v: 'replace', label: 'Remplacer ma collection' }], collCount() ? 'add' : 'replace', () => paint());
    api.setFoot('<button class="btn ghost" type="button" data-close>Annuler</button><button class="btn" type="button" id="ciGo" disabled>Importer</button>');
    const ta = $('#ciText', api.body), sum = $('#ciSum', api.body), go = $('#ciGo', api.foot), mode = () => $('#ciMode', api.body)._v || 'add';
    let parsed = null;
    const paint = () => {
      const t = ta.value; parsed = t.trim() ? parseCollection(t) : null;
      sum.hidden = !parsed;
      go.disabled = !parsed || !parsed.items.length;
      if (!parsed) { go.textContent = 'Importer'; return; }
      if (!parsed.items.length) { sum.className = 'ci-sum bad'; sum.textContent = parsed.format === 'csv' ? 'Aucune carte lue dans ce CSV : il faut une colonne « Name » (ou « Nom »).' : 'Aucune ligne reconnue. Une carte par ligne : « 3 Sol Ring ».'; return; }
      const rep = mode() === 'replace' && collCount();
      sum.className = 'ci-sum'; sum.innerHTML = `<b>${nf0(parsed.items.length)}</b> carte${parsed.items.length > 1 ? 's' : ''} différente${parsed.items.length > 1 ? 's' : ''} · <b>${nf0(parsed.copies)}</b> exemplaire${parsed.copies > 1 ? 's' : ''}<span>${parsed.format === 'csv' ? 'Fichier CSV' : 'Liste texte'}${parsed.skipped ? ` · ${nf0(parsed.skipped)} ligne${parsed.skipped > 1 ? 's' : ''} ignorée${parsed.skipped > 1 ? 's' : ''}` : ''}${rep ? ` · remplace les ${nf0(collCount())} cartes actuelles` : ''}</span>`;
      go.textContent = `Importer ${nf0(parsed.items.length)} carte${parsed.items.length > 1 ? 's' : ''}`;
    };
    ta.oninput = paint;
    $('#ciFile', api.body).onchange = async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      if (f.size > 8 * 1024 * 1024) { toast('Fichier trop gros (8 Mo maximum)'); return; }
      try { ta.value = await f.text(); paint(); haptic('tap'); } catch (err) { toast('Fichier illisible'); }
    };
    go.onclick = () => {
      if (!parsed || !parsed.items.length) return;
      const before = COLL.map, m = mode(), n = parsed.items.length;
      collAdd(parsed.items, m); api.close(); haptic('ok');
      toast(`${nf0(n)} carte${n > 1 ? 's' : ''} ${m === 'replace' ? 'dans ta collection' : 'ajoutée' + (n > 1 ? 's' : '')}`, { label: 'Annuler', fn: () => { COLL.map = before; collChanged(); } });
      collEnrich();
    };
    if (initial) { ta.value = initial; paint(); }
  });
}
