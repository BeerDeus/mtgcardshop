/* ── share.js : liste d'échange (doublons, cartes recherchées) et liens publics en lecture seule (liste d'échange, deck) ──────────
   · Onglet « Échange » de la collection : cartes à échanger (possédé − decks − réserve, terrains de base exclus), « Garder » carte par carte,
     cartes recherchées (manquantes des decks + souhaits ajoutés à la main), valeur estimée (même prix que « Pour toi »), tri par prix, « ≥ X € », lien public.
     Réglages sur l'appareil (deckdeal:trade:v1) et dans le compte (users/{uid}/meta/trade : keep, kept, wish, share, dsh, updatedAt ; le plus récent l'emporte).
   · Partages : shares/{id} { o (empreinte SHA-256 de l'UID du propriétaire), kind ('trade' | 'deck'), v, updatedAt, d (JSON) }. Lisibles par quiconque a le lien, jamais listables, modifiables
     seulement par leur propriétaire (règles Firestore). Tenus à jour par les appareils du propriétaire : collection, decks, souhaits, réserve.
     Un deck enregistré partagé suit ses modifications ; un deck EDHREC ou une liste en cours est partagé tel quel (figé).
   · Visiteur : <site>/?p=<id>. Lecture par l'API REST Firestore (shareFetch : ni SDK, ni compte), écran en lecture seule ; rien n'est écrit, ni chez lui ni chez le propriétaire. */
const TR_KEY = 'deckdeal:trade:v1', TR_KEEPS = [0, 1, 2, 3, 4], TR_PAGE = 120, TR_MAX = 880000, TR_SHARE_MAX = 900000;      // TR_SHARE_MAX : champ d d'un partage (règles Firestore)
const TR_REPORT = 'martin.stuis11@gmail.com';      // « Signaler ce partage » : contact de la politique de confidentialité (pwa/privacy.html)
const TR = { who: '', creating: false, st: null, dmBusy: false, keep: 1, kept: new Set(), wish: {}, share: '', dsh: {}, u: 0, sig: {}, sub: 'have', shown: TR_PAGE, err: '', busy: false, again: false, syncT: 0,
  doc: { unsub: null, uid: '', pushT: 0 }, pub: null, sort: 'name', min: 0, pxTry: 0 };      // sort, min : tri et prix minimal de l'onglet (cet écran seulement) ; pxTry : fichier de prix déjà demandé (1 sans serveur, 2 avec)
const TR_MINS = [0, 100, 200, 500, 1000, 2000, 5000];      // filtre « ≥ X € » des doublons (centimes)

const trWishClean = w => {
  const out = {}; if (!w || typeof w !== 'object' || Array.isArray(w)) return out;
  for (const [k, v] of Object.entries(w).slice(0, 2000)) {
    if (!k || !v || typeof v.n !== 'string' || !v.n.trim()) continue;
    const e = { n: v.n.trim().slice(0, 160), q: Math.max(1, Math.min(99, Math.floor(Number(v.q) || 1))) };
    if (typeof v.i === 'string' && SHARE_IMG_RE.test(v.i)) { e.i = v.i; if (typeof v.w === 'string' && v.w.trim()) e.w = v.w.trim().slice(0, 90); if (SHARE_LANGS.includes(v.l)) e.l = v.l; }      // illustration retenue
    out[ownKey(v.n) || k] = e;
  }
  return out;
};
const trDshClean = o => { const out = {}; if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o).slice(0, 200)) if (typeof v === 'string' && SHARE_ID_RE.test(v)) out[k] = v; return out; };
function trApply(j) {
  TR.keep = TR_KEEPS.includes(j.keep) ? j.keep : 1;
  TR.kept = new Set(Array.isArray(j.kept) ? j.kept.filter(k => typeof k === 'string' && k).slice(0, 5000) : []);
  TR.wish = trWishClean(j.wish);
  TR.share = typeof j.share === 'string' && SHARE_ID_RE.test(j.share) ? j.share : '';
  TR.dsh = trDshClean(j.dsh);
  TR.u = Number(j.u || j.updatedAt) || 0;
}
const trDoc = () => ({ keep: TR.keep, kept: [...TR.kept], wish: TR.wish, share: TR.share, dsh: TR.dsh, updatedAt: TR.u || Date.now() });
function trRead() {
  try { const j = JSON.parse(localStorage.getItem(TR_KEY) || '{}') || {}; trApply(j); TR.sig = j.sig && typeof j.sig === 'object' ? j.sig : {}; TR.who = typeof j.who === 'string' ? j.who : ''; } catch (e) { /* neuf */ }
}
function trWrite() { try { localStorage.setItem(TR_KEY, JSON.stringify({ ...trDoc(), u: TR.u, sig: TR.sig, who: TR.who })); } catch (e) { /* stockage indisponible */ } }
const trOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
/** Les écritures Firestore attendent le serveur : hors ligne, on prévient au lieu de laisser le bouton sans réponse. */
function trNeedNet() { if (!trOffline()) return true; toast(T('Hors ligne : réessaie une fois connecté')); return false; }
/** Un réglage a changé ici : enregistre, envoie au compte, met à jour les partages et l'écran. */
function trChanged() { TR.u = Date.now(); trWrite(); trPushSoon(); trSoon(800); trRepaint(); }
function trRepaint() { if (COLL.el && COLL.tab === 'trade') collPaintBody(true); homeSoon(); pubSoon(); }

/* ── Réglages dans le compte ───────────────────────────────────────────────────────────────────────── */
function trUser(user) {
  pubSoon();      // liste d'un autre joueur ouverte : ses correspondances suivent la connexion
  const d = TR.doc; if (d.unsub) { try { d.unsub(); } catch (e) { /* ignore */ } d.unsub = null; } clearTimeout(d.pushT); d.uid = '';
  if (!user || !D.cloud || !D.cloud.watchMeta) return;
  if (TR.who && TR.who !== user.uid) { trApply({}); TR.sig = {}; }                // autre compte sur cet appareil : ses réglages et liens ne sont pas les nôtres
  TR.who = user.uid; trWrite();
  d.uid = user.uid;
  d.unsub = D.cloud.watchMeta(user.uid, 'trade', (data, pending, fromCache) => {
    if (pending || fromCache || D.uid !== user.uid) return;
    if (data) acctSaw('trade', user.uid); else if (acctLost('trade', user.uid)) return;      // vu ici puis disparu : compte supprimé ailleurs ? ni réglages ni liens renvoyés (decks.js vérifie)
    const ru = Number(data && data.updatedAt) || 0;
    if (data && ru > TR.u) { const sig = TR.sig; trApply(data); TR.sig = sig; trWrite(); trRepaint(); trSoon(); }
    else if (TR.u > ru) trPushSoon();
  }, err => { if (err && err.code === 'permission-denied') TR.err = 'rules'; trRepaint(); });
  trSoon(1500);
}
function trPushSoon() { const d = TR.doc; if (!d.uid) return; clearTimeout(d.pushT); d.pushT = setTimeout(trPush, 900); }
async function trPush() {
  const d = TR.doc; if (!d.uid || acctHeld(d.uid) || !cloudOn() || !D.cloud.saveMeta) return;      // autre compte, ou compte en cours de suppression
  try { await D.cloud.saveMeta(d.uid, 'trade', trDoc()); acctSaw('trade', d.uid); if (TR.err === 'rules') { TR.err = ''; trRepaint(); } }
  catch (err) { if (err && err.code === 'permission-denied') { TR.err = 'rules'; trRepaint(); } }
}

/* ── Listes ────────────────────────────────────────────────────────────────────────────────────── */
const trDeckTexts = () => allDecks().map(d => d.text || '');
function trState() {
  const use = deckUse(trDeckTexts()), { have, held } = tradeLists(COLL.map, use, TR.keep, TR.kept);
  return { use, have, held, want: tradeWant(COLL.map, use, TR.wish), decks: allDecks().length };
}
/** Doublons à échanger d'une collection (decks et réglages de cet appareil) : colonne « Tradelist Count » de l'export CSV (collToCsv, core.js ; déclaration hoistée, jamais en zone morte). */
function trSpare(map) { return tradeLists(map, deckUse(trDeckTexts()), TR.keep, TR.kept).have; }
/** Prix unitaire (centimes) des estimations d'échange, chez le propriétaire comme chez le visiteur : tendance Cardmarket du fichier de prix (impression la moins chère), sinon le prix Scryfall déjà connu de l'appareil. */
const trPrice = k => { const t = PXT && PXT.map && PXT.map.get(k); return (t && t.e) || (dmOf(k) || {}).eu || null; };
/** Carte d'un partage : nom, exemplaires, langue, nom français, image (dans la langue de l'exemplaire si Scryfall l'a), coût, type, couleurs, symboles. */
function trCard(k, n, q, l) {
  const m = dmOf(k) || {}, o = { n, q };
  if (l) o.l = l;
  const f = frOf(k); if (f) o.f = f;
  const im = (l && l !== 'en' && COLL.li[liKey(l, k)]) || m.im; if (im) o.i = im;
  if (m.cm != null) o.c = m.cm; if (m.tl) o.t = m.tl; if (typeof m.cl === 'string') o.o = m.cl; if (m.mc) o.m = m.mc;
  return o;
}
/** Contenu du partage de la liste d'échange (sans date : sert aussi d'empreinte). Trop gros : sans images ni symboles (le visiteur les lit sur Scryfall), puis tronqué.
 *  La limite tient compte du pseudo et de la photo que trPut ajoute (jusqu'à 40 000 caractères) : le document reste sous la règle des 900 000. */
function trPayload() {
  const max = TR_MAX - JSON.stringify(profShare()).length;
  const st = trState(), have = st.have.flatMap(x => x.lines.map(([l, q]) => trCard(x.k, x.n, q, l))), want = st.want.map(x => { const o = trCard(x.k, x.n, x.q, ''); if (x.p) { o.i = scrySmall(x.p.i); o.w = x.p.w || ''; if (x.p.l && x.p.l !== 'en') o.l = x.p.l; } return o; });      // souhait : l'illustration retenue
  for (const o of [...have, ...want]) if (o.i) { const sh = imgShort(o.i); if (sh) o.i = sh; else delete o.i; }      // adresses d'images raccourcies (≈ 2 fois moins de place)
  let body = { have, want };
  // trop gros : d'abord sans les images des doublons (le visiteur les relit sur Scryfall), puis sans les symboles ; jamais sans l'illustration d'une carte souhaitée
  if (JSON.stringify(body).length > max) body = { have: have.map(({ i, ...x }) => x), want };
  if (JSON.stringify(body).length > max) body = { have: body.have.map(({ m, ...x }) => x), want: want.map(({ m, ...x }) => ('w' in x ? x : (({ i, ...y }) => y)(x))) };      // « w » présent : illustration choisie
  while (JSON.stringify(body).length > max && body.have.length > 100) body = { ...body, have: body.have.slice(0, Math.floor(body.have.length * 0.8)), cut: 1 };
  return body;
}

/* ── Partages : écriture (propriétaire) ────────────────────────────────────────────────────────── */
function trSoon(ms = 4000) { pubSoon(); if (!TR.share && !Object.keys(TR.dsh).length) return; clearTimeout(TR.syncT); TR.syncT = setTimeout(trSync, ms); }
/** Empreinte du propriétaire (SHA-256 de l'UID, en hexadécimal) : le document est public, l'UID n'y est jamais écrit. Les règles Firestore la recalculent. */
const ownerTags = new Map();
async function ownerTag(uid) {
  if (!ownerTags.has(uid)) ownerTags.set(uid, crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid)).then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')));
  return ownerTags.get(uid);
}
async function trPut(id, kind, body) {
  body = { ...body, ...profShare() };      // pseudo et photo du profil : le lien change quand le profil change
  const s = kind + ':' + hash32(JSON.stringify(body));
  if (TR.sig[id] === s) return;
  const d = JSON.stringify({ ...body, at: Date.now() });
  if (d.length > TR_SHARE_MAX) throw Object.assign(new Error('partage trop gros'), { code: 'too-big' });      // refusé par les règles : on le dit, au lieu de « règles à publier »
  await D.cloud.saveShare(id, { o: await ownerTag(D.uid), kind, v: 1, updatedAt: Date.now(), d });
  TR.sig[id] = s; trWrite();
}
/** Avant d'écrire la liste : noms français (catalogue de l'appareil ou du site) et fiches Scryfall des cartes recherchées (images, types). */
async function trPrep() {
  const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), sleep(ms)]);      // Scryfall lent : le lien est mis à jour quand même (sans ces infos-là)
  collFrLoad(); if (FRN.p) await within(FRN.p, 8000);
  const need = trState().want.map(x => ({ key: x.k, name: x.n }));
  for (let i = 0; i < 4 && dmMissing(need).length; i++) if (!(await within(dmFetch(need), 10000))) break;
}
/** Met à jour les partages de ce compte (liste d'échange, decks enregistrés partagés). Les cartes recherchées sans fiche Scryfall sont lues d'abord (images). */
async function trSync() {
  clearTimeout(TR.syncT);
  if (!cloudOn() || !D.cloud.saveShare || trOffline() || acctHeld(D.uid)) return;      // compte en cours de suppression : les liens effacés ne sont pas recréés
  if (TR.busy) { TR.again = true; return; }
  TR.busy = true; TR.again = false;
  try {
    if (TR.share) { await trPrep(); await trPut(TR.share, 'trade', trPayload()); }
    for (const [key, id] of Object.entries(TR.dsh)) {
      if (key.startsWith('txt:')) continue;                       // deck figé (EDHREC, liste en cours) : rien à suivre
      const d = findDeck(key); if (!d) continue;
      await trPut(id, 'deck', { name: d.name, text: d.text });
    }
    if (TR.err) { TR.err = ''; trRepaint(); }
  } catch (err) {
    TR.err = err && err.code === 'permission-denied' ? 'rules' : err && err.code === 'too-big' ? 'big' : 'net'; trRepaint();
    if (TR.err === 'net') setTimeout(() => trSoon(0), 60000);
  } finally { TR.busy = false; if (TR.again) trSoon(500); }
}
const shareUrl = id => { try { return new URL('./?p=' + id, location.href).href.replace(/#.*$/, ''); } catch (e) { return '?p=' + id; } };
/** Crée le lien de la liste d'échange (identifiant aléatoire, document écrit tout de suite). */
async function trShareOn() {
  if (!cloudOn()) { openAccount(); return; }
  if (!trNeedNet() || TR.creating) return;
  const id = D.cloud.shareId(); TR.creating = true;
  try { await trPrep(); TR.share = id; TR.sig[id] = ''; await trPut(id, 'trade', trPayload()); trChanged(); toast(T('Lien créé'), { label: T('Copier'), fn: () => copyText(shareUrl(id)) }); haptic('ok'); }
  catch (err) { TR.share = ''; toast(err && err.code === 'too-big' ? T('Liste trop longue pour un lien : trop de cartes recherchées.') : err && err.code === 'permission-denied' ? T('Règles Firestore à publier pour le partage (voir README)') : T('Lien impossible à créer : réessaie en ligne')); trRepaint(); }
  finally { TR.creating = false; }
}
async function trShareOff(renew) {
  const old = TR.share; if (!old || !trNeedNet()) return;
  try { await D.cloud.dropShare(old); } catch (err) { toast(T('Arrêt impossible hors ligne : réessaie')); return; }
  delete TR.sig[old]; TR.share = ''; trChanged();
  if (renew) await trShareOn(); else toast(T('Partage arrêté : l\'ancien lien ne marche plus'));
}
async function sendLink(url, title) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  copyText(url);
}
/** Partage d'un deck : enregistré (suivi : chaque modification part sur le lien) ou figé (deck EDHREC, liste en cours). */
async function shareDeck({ id, text, name }) {
  if (!cloudOn()) { toast(T('Connecte-toi pour partager un deck'), { label: T('Compte'), fn: openAccount }); return; }
  const d = id ? findDeck(id) : null, key = d ? d.id : 'txt:' + hash32(String(text || '')), body = d ? { name: d.name, text: d.text } : { name: String(name || 'Deck').slice(0, 120), text: String(text || '') };
  if (!parseDeck(body.text).cards.length) { toast(T('Deck vide : rien à partager')); return; }
  if (!trNeedNet()) return;
  let sid = TR.dsh[key];
  try {
    if (!sid) { sid = D.cloud.shareId(); TR.dsh[key] = sid; }
    await trPut(sid, 'deck', body); trChanged();
  } catch (err) { if (!TR.sig[sid]) delete TR.dsh[key]; toast(err && err.code === 'too-big' ? T('Deck trop long pour un lien.') : err && err.code === 'permission-denied' ? T('Règles Firestore à publier pour le partage (voir README)') : T('Partage impossible : réessaie en ligne')); return; }
  openSheet(T('Partager le deck'), d ? T('Lecture seule · le lien suit les modifications du deck') : T('Lecture seule · le deck est partagé tel qu\'il est maintenant'), api => {
    api.body.innerHTML = `<div class="tr-link"><input type="text" readonly value="${esc(shareUrl(sid))}" aria-label="${T('Lien du deck')}"></div>
      <p class="hint">${T('Quiconque a ce lien voit le deck, ses images, sa courbe de mana et peut tirer une main de départ. Il ne peut rien modifier.')}</p>
      <button class="link-btn link-inline" type="button" data-act="dstop">${T('Arrêter ce partage')}</button>`;
    api.setFoot(`<button class="btn ghost" type="button" data-act="dcopy">${T('Copier')}</button><button class="btn" type="button" data-act="dsend">${T('Partager')}</button>`);
    $('input', api.body).onfocus = e => e.target.select();
    api.wrap.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'dcopy') copyText(shareUrl(sid));
      else if (b.dataset.act === 'dsend') sendLink(shareUrl(sid), body.name);
      else if (b.dataset.act === 'dstop') {
        if (!trNeedNet()) return;
        try { await D.cloud.dropShare(sid); } catch (err) { toast(T('Arrêt impossible hors ligne : réessaie')); return; }
        delete TR.dsh[key]; delete TR.sig[sid]; trChanged(); api.close(); toast(T('Partage arrêté : le lien ne marche plus'));
      }
    });
  });
}
/** Un deck enregistré supprimé : son lien aussi (appelé par removeDeck). */
function trDeckGone(id) {
  const sid = TR.dsh[id]; if (!sid) return;
  delete TR.dsh[id]; delete TR.sig[sid]; trChanged();
  if (cloudOn()) D.cloud.dropShare(sid).catch(() => {});
}

/* ── Export Cardmarket (Wants › « Ajouter une liste », puis Shopping Wizard) ── */
const cmWantsUrl = () => 'https://www.cardmarket.com/' + cmSite(userLang()) + '/Magic/Wants';      // Cardmarket dans la langue de l'utilisateur (fr de es it, sinon en)
/** Presse-papiers ; refusé ou absent : copyText (repli, son propre message). done() seulement quand l'API a copié. */
function cmClip(text, done) { try { navigator.clipboard.writeText(text).then(done, () => { copyText(text); }); } catch (e) { copyText(text); } }
function cmCopy(items, what) {
  const text = cmText(items), n = text ? text.split('\n').length : 0;
  if (!n) { toast(T('Rien à copier : {what}', { what: what || T('aucune carte manquante') })); return; }
  if (n > CM_MAX) { cmPartsOpen(cmParts(text), n); return; }      // au-delà de 150 lignes, Cardmarket refuse la liste : une Wants list par partie
  haptic('ok');
  const done = () => toast(TN(n, '{n} carte copiée : colle-la dans une Wants list Cardmarket', '{n} cartes copiées : colle-les dans une Wants list Cardmarket'), { label: T('Ouvrir'), fn: () => window.open(cmWantsUrl(), '_blank', 'noopener') });
  cmClip(text, done);
}
/** Feuille des parties : « Partie 1/3 · Copier », puis « Copier la suite » ; chaque partie a aussi son bouton (recopier, sauter). Un copier par geste : le navigateur l'exige. */
function cmPartsOpen(parts, n) {
  const N = parts.length, done = new Set(), nm = l => String(l).replace(/^\d+\s+/, '');
  let next = 0;
  openSheet(T('Copier pour Cardmarket'), TN(n, '{n} carte · {p} parties', '{n} cartes · {p} parties', { p: N }), api => {
    api.body.innerHTML = `<p class="hint cm-why">${T('Cardmarket accepte {max} cartes par Wants list : crée une liste par partie (Wants › Ajouter une liste) et colles-y la partie copiée.', { max: CM_MAX })}</p>
      <div class="cm-parts">${parts.map((p, i) => { const ls = p.split('\n'); return `<div class="cm-part" data-i="${i}"><span class="cm-main"><b>${T('Partie {i}/{n}', { i: i + 1, n: N })}</b><small>${TN(ls.length, '{n} carte', '{n} cartes')} · ${esc(nm(ls[0]))} → ${esc(nm(ls[ls.length - 1]))}</small></span><button class="btn ghost" type="button" data-act="cmpart" data-i="${i}">${T('Copier')}</button></div>`; }).join('')}</div>
      <div class="status cm-said" data-ok="1" role="status" hidden><span class="dot"></span><span></span></div>`;
    const paint = () => {
      api.setFoot(`<button class="btn ghost" type="button" data-act="cmopen">${T('Ouvrir Cardmarket')}</button><button class="btn" type="button" data-act="cmnext"${next >= N ? ' disabled' : ''}>${next >= N ? T('Toutes les parties sont copiées') : done.size ? T('Copier la suite · {i}/{n}', { i: next + 1, n: N }) : T('Partie {i}/{n} · Copier', { i: next + 1, n: N })}</button>`);
      for (const r of $$('.cm-part', api.body)) { const on = done.has(Number(r.dataset.i)); r.classList.toggle('done', on); $('button', r).innerHTML = on ? `<svg class="i"><use href="#i-check"/></svg>${T('Copiée')}` : T('Copier'); }
    };
    const copy = i => cmClip(parts[i], () => {
      done.add(i); haptic('ok');
      next = N; for (let j = 1; j <= N; j++) { const k = (i + j) % N; if (!done.has(k)) { next = k; break; } }      // la suivante pas encore copiée (après celle-ci, puis depuis le début)
      const said = $('.cm-said', api.body); said.hidden = false;
      $('span:last-child', said).textContent = T('Partie {i}/{n} copiée : colle-la dans une nouvelle Wants list Cardmarket.', { i: i + 1, n: N });
      paint();
    });
    paint();
    api.wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'cmpart') copy(Number(b.dataset.i));
      else if (b.dataset.act === 'cmnext' && next < N) copy(next);
      else if (b.dataset.act === 'cmopen') window.open(cmWantsUrl(), '_blank', 'noopener');
    });
  });
}

/* ── Onglet « Échange » de la collection (propriétaire) ────────────────────────────────────────── */
/** Item d'affichage (filtres, vignette) d'une carte de la collection ou recherchée. */
function trItem(k, n, q, l) {
  const m = dmOf(k) || {}, dn = frName(k, l), fn = frOf(k), it = { k, n, q, l: l || '', ...m };
  if (dn) it.dn = dn; if (fn && fn !== dn) it.fn = fn;
  return it;
}
function trShareBoxHtml(st) {
  const rules = TR.err === 'rules' ? '<p class="hint warn">' + T('Règles Firestore à publier pour le partage (voir README) : le lien ne peut pas être mis à jour.') + '</p>'
    : TR.err === 'big' ? '<p class="hint warn">' + T('Liste trop longue : le lien ne peut plus être mis à jour (trop de cartes recherchées).') + '</p>' : '';
  if (!D.user) return `<div class="tr-box"><b>${T('Partager ta liste')}</b><p class="hint">${T('Connecte-toi pour créer un lien public : tes amis voient tes doublons et ce que tu cherches, sans rien pouvoir modifier.')}</p><button class="btn ghost" type="button" data-act="login">${T('Se connecter')}</button></div>`;
  if (!TR.share) return `<div class="tr-box"><b>${T('Partager ta liste')}</b><p class="hint">${T('Un lien public, en lecture seule, toujours à jour : tes {have} doublons et les {want} cartes que tu cherches, avec recherche par nom.', { have: nf0(st.have.length), want: nf0(st.want.length) })}</p>${rules}<button class="btn" type="button" data-act="tron">${T('Créer le lien')}</button></div>`;
  return `<div class="tr-box on"><b>${T('Lien public actif')}</b><div class="tr-link"><input type="text" readonly value="${esc(shareUrl(TR.share))}" aria-label="${T('Lien de ta liste d\'échange')}"></div>
    ${rules}${TR.err === 'net' ? '<p class="hint warn">' + T('Mise à jour du lien en attente (hors ligne).') + '</p>' : '<p class="hint">' + T('Mis à jour tout seul quand ta collection, tes decks ou ta liste changent. Lecture seule.') + '</p>'}
    <div class="tr-acts"><button class="btn ghost" type="button" data-act="trcopy">${T('Copier')}</button><button class="btn ghost" type="button" data-act="trsend">${T('Partager')}</button><button class="btn ghost" type="button" data-act="trview">${T('Aperçu')}</button></div>
    <button class="btn ghost block tr-qr" type="button" data-act="trqr">${QR_ICON}${T('QR code')}</button>
    <div class="tr-acts small"><button class="link-btn link-inline" type="button" data-act="trnew">${T('Nouveau lien')}</button><button class="link-btn link-inline" type="button" data-act="troff">${T('Arrêter le partage')}</button></div></div>`;
}
/** Prix unitaire d'une ligne chiffrée (tradeView) : « ≈ 1,50 € » devant « × 3 » (lu « 1,50 € × 3 », la ligne garde sa hauteur). */
const trPxHtml = x => (x.u != null ? `<small class="tr-px" title="${esc(T('{v} pièce', { v: fmt(x.u, 'EUR') }))}">≈ ${esc(fmt(x.u, 'EUR'))}</small>` : '');
const trQxHtml = x => `<span class="tr-qx">${trPxHtml(x)}<b>× ${x.q}</b></span>`;
/** « 5 € » sans centimes (filtre « ≥ 5 € »). */
const trEur = c => new Intl.NumberFormat(LOC(), { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(c / 100);
function trHaveRow(x) {
  const it = trItem(x.k, x.n, x.q, x.lines[0] ? x.lines[0][0] : ''), nm = it.dn || it.n, img = collImage(x.k, it.l, it.im).src;
  const langs = x.lines.map(([l, q]) => `<span class="tag">${l ? flag(l) : T('sans langue')}${x.lines.length > 1 ? ' × ' + q : ''}</span>`).join('');
  return `<div class="crow tr-row" data-k="${esc(x.k)}" data-ln="${esc(it.l)}"><span class="thumb" style="--h:${hash32(x.k) % 360}">${esc((nm.trim()[0] || '?').toUpperCase())}${img ? `<img alt="" loading="lazy" decoding="async" src="${esc(img)}">` : ''}</span>
    <span class="row-main"><span class="row-name">${esc(nm)}</span><span class="row-meta">${langs}${it.dn ? `<span class="tag">${esc(x.n)}</span>` : ''}</span></span>
    <span class="tr-q">${trQxHtml(x)}<button class="link-btn" type="button" data-act="tkeep" aria-label="${T('Garder {name} (ne plus la proposer)', { name: esc(nm) })}">${T('Garder')}</button></span></div>`;
}
function trWantRow(x, mine) {
  const it = trItem(x.k, x.n, x.q, ''), nm = it.n, img = x.p ? scrySmall(x.p.i) : it.im || '';
  const tags = (x.p && x.p.w ? `<span class="tag accent" title="${T('Illustration recherchée')}">${x.p.l && x.p.l !== 'en' ? flag(x.p.l) + ' ' : ''}${esc(x.p.w)}</span>` : '') + (x.d ? `<span class="tag warn">${T('manque à tes decks')}${x.d > 1 ? ' × ' + x.d : ''}</span>` : '') + (x.w ? `<span class="tag accent">${T('souhait')}${x.w > 1 ? ' × ' + x.w : ''}</span>` : '') + (it.fn ? `<span class="tag">${esc(it.fn)}</span>` : '');
  const ctl = `<span class="tr-q">${mine && x.w ? `<span class="qstep tr-wq"><button type="button" data-act="wminus" aria-label="${T('Un de moins')}">−</button><b>${x.w}</b><button type="button" data-act="wplus" aria-label="${T('Un de plus')}">+</button></span>${trPxHtml(x)}` : trQxHtml(x)}</span>`;
  return `<div class="crow tr-row" data-k="${esc(x.k)}" data-ln="${esc(x.p && x.p.l || '')}"${x.p ? ` data-big="${esc(x.p.i)}"` : ''}><span class="thumb" style="--h:${hash32(x.k) % 360}">${esc((nm.trim()[0] || '?').toUpperCase())}${img ? `<img alt="" loading="lazy" decoding="async" src="${esc(img)}">` : ''}</span>
    <span class="row-main"><span class="row-name">${esc(nm)}</span><span class="row-meta">${tags}</span></span>${ctl}</div>`;
}
/** Corps de l'onglet : lien, réserve, sous-onglets « À échanger » / « Je recherche », total estimé, tri et prix minimal, listes filtrées (barre de recherche et filtres de la collection). */
function trPanelHtml() {
  const st = TR.st = trState(), f = COLL.f, sub = TR.sub, want = sub === 'want', held = st.held;
  const all = want ? st.want : st.have, min = want ? 0 : TR.min, act = filterActive(f) || min > 0;
  const fil = filterItems(all.map(x => Object.assign(trItem(x.k, x.n, x.q, x.lines && x.lines[0] ? x.lines[0][0] : ''), { src: x })), f).map(i => i.src);
  const { rows: list, sum } = tradeView(fil, { price: trPrice, sort: TR.sort, min }), shown = list.slice(0, TR.shown);
  return `${trShareBoxHtml(st)}
    <div class="tr-keep"><span class="label">${T('Garder en plus de mes decks : 0–4 exemplaires')}</span><div class="seg" id="trKeep" role="radiogroup" aria-label="${T('Garder en plus de mes decks')}"></div><p class="hint">${T('Tu proposes seulement ce que tu as en trop.')}</p></div>
    <div class="seg tr-sub" id="trSub" role="radiogroup" aria-label="${T('Liste')}"></div>
    ${want ? `<div class="tr-acts tr-wacts"><button class="btn ghost tr-addw" type="button" data-act="wadd"><svg class="i"><use href="#i-plus"/></svg>${T('Ajouter une carte')}</button>${st.want.length ? '<button class="btn ghost" type="button" data-act="wcm" title="' + T('Une ligne « 1 Sol Ring » par carte, à coller dans une Wants list Cardmarket (Shopping Wizard)') + '"><svg class="i"><use href="#i-copy"/></svg>' + T('Copier pour Cardmarket') + '</button>' : ''}</div>` : ''}
    ${all.length ? trSumHtml(list, all, sum, act, want) : ''}
    ${shown.length ? `<div class="coll-list tr-list">${shown.map(x => (want ? trWantRow(x, true) : trHaveRow(x))).join('')}</div>`
      : `<p class="hint listempty">${T(act ? 'Aucune carte ne correspond.' : want ? 'Rien à chercher : tes decks sont complets. Ajoute des cartes à ta liste de souhaits.' : 'Aucun doublon pour l\'instant.')}</p>`}
    ${list.length > shown.length ? `<button class="btn ghost block coll-more" type="button" data-act="trmore">${T('Afficher {n} de plus · {left} restantes', { n: nf0(Math.min(TR_PAGE, list.length - shown.length)), left: nf0(list.length - shown.length) })}</button>` : ''}
    ${!want && held.length ? `<details class="tr-held"><summary>${T('Gardées à la main ({n})', { n: nf0(held.length) })}</summary><div class="coll-list">${held.map(x => `<div class="crow tr-row" data-k="${esc(x.k)}"><span class="row-main"><span class="row-name">${esc(x.n)}</span><span class="row-meta"><span class="tag">${T('{n} en trop', { n: x.q })}</span></span></span><span class="tr-q"><button class="link-btn" type="button" data-act="tunkeep">${T('Remettre')}</button></span></div>`).join('')}</div></details>` : ''}`;
}
/** En-tête de la liste : cartes et exemplaires (affichés / au total), valeur estimée et sa base (prix à l'unité, tendance Cardmarket, date du fichier), tri et « ≥ X € » (doublons). */
function trSumHtml(list, all, sum, act, want) {
  const at = PXT && Date.parse(PXT.at), priced = sum.n > sum.nv;
  const count = (act ? TN(list.length, '{n} carte sur {total}', '{n} cartes sur {total}', { total: nf0(all.length) }) : TN(list.length, '{n} carte', '{n} cartes')) + ' · ' + TN(sum.q, '{n} exemplaire', '{n} exemplaires');
  const basis = priced ? (at ? T('Prix à l\'unité : tendance Cardmarket ({when})', { when: relTime(at) }) : T('Prix à l\'unité : tendance Cardmarket')) + (sum.nv ? ' · ' + TN(sum.nv, '{n} carte sans prix', '{n} cartes sans prix') : '') : '';
  const opt = (v, l, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
  return `<div class="tr-sum"><b>${esc(count)}</b>${priced ? `<em title="${T('Valeur estimée')}">≈ ${esc(fmt(sum.v, 'EUR'))}</em>` : ''}${basis ? `<span>${esc(basis)}</span>` : ''}</div>
    <div class="tr-tools"><label class="sortsel"><span>${T('Trier')}</span><select id="trSort" aria-label="${T('Trier la liste')}">${opt('name', T('Nom'), TR.sort)}${opt('price', T('Prix'), TR.sort)}</select></label>
      ${want ? '' : `<label class="sortsel tr-min${TR.min ? ' on' : ''}"><select id="trMin" aria-label="${T('Prix minimal à l\'unité')}">${TR_MINS.map(v => opt(v, v ? '≥ ' + trEur(v) : T('Tous les prix'), TR.min)).join('')}</select></label>`}</div>`;
}
/** Fichier de prix (celui de « Pour toi » et de la recherche Cardmarket) : lu une fois (cache de l'appareil, puis le serveur quand il répond), puis l'onglet se repeint avec les valeurs. */
function trPx() {
  const lvl = CTX.proxy ? 2 : 1; if (PXT || TR.pxTry >= lvl) return;
  TR.pxTry = lvl; pxTable().then(t => { if (t) trRepaint(); }, () => {});
}
/** Après chaque peinture de l'onglet : les deux sélecteurs. */
function trMount(host) {
  const st = TR.st || trState();
  mountSeg($('#trKeep', host), TR_KEEPS.map(v => ({ v: String(v), label: String(v) })), String(TR.keep), v => { TR.keep = Number(v); trChanged(); });
  mountSeg($('#trSub', host), [{ v: 'have', label: T('À échanger'), sub: nf0(st.have.length) }, { v: 'want', label: T('Je recherche'), sub: nf0(st.want.length) }], TR.sub, v => { TR.sub = v; TR.shown = TR_PAGE; collPaintBody(true); });
  const inp = $('.tr-link input', host); if (inp) inp.onfocus = e => e.target.select();
  const so = $('#trSort', host); if (so) so.onchange = e => { TR.sort = e.target.value === 'price' ? 'price' : 'name'; TR.shown = TR_PAGE; haptic('tap'); collPaintBody(true); };
  const mi = $('#trMin', host); if (mi) mi.onchange = e => { TR.min = TR_MINS.includes(Number(e.target.value)) ? Number(e.target.value) : 0; TR.shown = TR_PAGE; haptic('tap'); collPaintBody(true); };
  trPx();
  // cartes recherchées sans fiche (image, type) : lues sur Scryfall, puis l'onglet se repeint
  const need = st.want.map(x => ({ key: x.k, name: x.n }));
  if (dmMissing(need).length && !TR.dmBusy) { TR.dmBusy = true; dmFetch(need).then(got => { TR.dmBusy = false; if (got) trRepaint(); }, () => { TR.dmBusy = false; }); }
}
/** Clics de l'onglet (appelé depuis l'écran de la collection). Retourne true si le clic était pour lui. */
function trClick(e) {
  if (COLL.tab !== 'trade') return false;
  const b = e.target.closest('[data-act]'); if (!b) { const th = e.target.closest('.tr-row .thumb'); if (th && th.querySelector('img.ok')) { trOpenImg(th.closest('.tr-row')); return true; } return false; }
  const act = b.dataset.act, row = b.closest('.tr-row'), k = row && row.dataset.k;
  if (act === 'tron') trShareOn();
  else if (act === 'troff') trShareOff(false);
  else if (act === 'trnew') trShareOff(true);
  else if (act === 'trcopy') copyText(shareUrl(TR.share));
  else if (act === 'trsend') sendLink(shareUrl(TR.share), T('Ma liste d\'échange Magic'));
  else if (act === 'trqr') trQrOpen();
  else if (act === 'trview') { const p = trPayload(); openPublicTrade(readShare('trade', { ...p, ...profShare(), at: Date.now() }), true); }
  else if (act === 'trmore') { TR.shown += TR_PAGE; collPaintBody(true); }
  else if (act === 'tkeep' && k) { TR.kept.add(k); haptic('tap'); trChanged(); toast(T('Gardée : elle n\'est plus proposée'), { label: T('Annuler'), fn: () => { TR.kept.delete(k); trChanged(); } }); }
  else if (act === 'tunkeep' && k) { TR.kept.delete(k); haptic('tap'); trChanged(); }
  else if ((act === 'wplus' || act === 'wminus') && k && TR.wish[k]) {
    const q = TR.wish[k].q + (act === 'wplus' ? 1 : -1); haptic('tap');
    if (q <= 0) { const was = TR.wish[k]; delete TR.wish[k]; trChanged(); toast(T('{name} retirée de ta liste', { name: was.n }), { label: T('Annuler'), fn: () => { TR.wish[k] = was; trChanged(); } }); }
    else { TR.wish[k] = { ...TR.wish[k], q: Math.min(99, q) }; trChanged(); }
  }
  else if (act === 'wadd') openWishAdd();
  else if (act === 'wcm') cmCopy(TR.st ? TR.st.want : trState().want, T('aucune carte recherchée'));
  else return false;
  return true;
}
function trOpenImg(row) {
  const rows = $$('.tr-row', row.parentNode), list = [];
  let at = 0;
  for (const r of rows) { const im = $('img.ok', r); if (!im) continue; if (r === row) at = list.length; list.push({ key: r.dataset.k, name: $('.row-name', r).textContent, wl: r.dataset.big ? '' : r.dataset.ln && r.dataset.ln !== 'en' ? r.dataset.ln : '', small: im.getAttribute('src'), ...(r.dataset.big ? { big: r.dataset.big } : {}), lang: r.dataset.ln || 'en', plain: true, extra: '' }); }
  if (list.length) openCardViewer(list, at);
}
function openWishAdd() {
  openSheet(T('Ajouter une carte recherchée'), T('Nom anglais ou français déjà connu de Scryfall'), api => {
    api.body.innerHTML = `<div class="field-in"><label class="label" for="waName">${T('Nom de la carte')}</label><input type="text" id="waName" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Mana Crypt" enterkeyhint="search"></div>
      <div class="status" id="waStatus" data-ok="0" hidden><span class="dot"></span><span></span></div><div class="ca-list" id="waList" role="listbox" aria-label="${T('Suggestions')}"></div>`;
    const inp = $('#waName', api.body), list = $('#waList', api.body), stt = $('#waStatus', api.body); let cat = null;
    const say = (t, ok) => { stt.hidden = !t; if (t) { $('span:last-child', stt).textContent = t; stt.dataset.ok = ok ? '1' : '0'; } };
    const paint = () => {
      if (!cat) { list.innerHTML = ''; return; }
      const q = inp.value.trim(), sug = collSuggest(cat, q);
      list.innerHTML = sug.map(n => { const k = ownKey(n), w = TR.wish[k]; return `<button type="button" class="ca-opt" role="option" data-n="${esc(n)}"><span>${sugHtml(n, q)}</span><i>${w ? '× ' + w.q : '+'}</i></button>`; }).join('')
        || (q.length >= 2 ? '<p class="hint">' + T('Aucune carte de ce nom. Vérifie l\'orthographe (nom anglais).') + '</p>' : '');
    };
    list.onclick = e => {
      const b = e.target.closest('.ca-opt'); if (!b) return;
      const n = b.dataset.n, k = ownKey(n); if (BASIC_NAMES.has(k)) { toast(T('Les terrains de base ne sont pas listés')); return; }
      TR.wish[k] = { n, q: Math.min(99, ((TR.wish[k] || {}).q || 0) + 1) }; trChanged(); haptic('ok');
      $('i', b).textContent = '× ' + TR.wish[k].q; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); say(TN(TR.wish[k].q, '{name} · {n} recherchée', '{name} · {n} recherchées', { name: n }), true);
    };
    inp.oninput = paint;
    say(T('Chargement du catalogue (une seule fois)…'), false);
    collCatalog().then(c => { cat = c; say(''); paint(); }).catch(e => say(e && e.code === 'rate' ? T('Scryfall demande une pause, réessaie dans une minute.') : T('Catalogue Scryfall injoignable : réessaie plus tard.'), false));
    setTimeout(() => inp.focus(), 380);
  });
}

/* ── QR code du lien (échange en vrai : l'autre joueur le scanne avec l'appareil photo de son téléphone) ── */
const QR_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 20h2M18 18v2h2"/></svg>';
/** Feuille du QR code : grand, net (modules calés sur les pixels de l'écran), pseudo ou photo du profil, adresse en clair ; l'écran reste allumé tant qu'elle est ouverte (Wake Lock, si le navigateur l'a). */
function trQrOpen() {
  if (!TR.share) return;
  const url = shareUrl(TR.share); let q;
  try { q = qrSvg(url); } catch (e) { toast(T('Lien trop long pour un QR code')); return; }
  const { by, bp } = profShare();
  openSheet(T('QR code de ta liste'), T('Lien public · lecture seule'), api => {
    api.body.innerHTML = `<div class="qr-card">
        <div class="qr-who">${bp ? `<img class="pub-av" src="${bp}" alt="">` : ''}<b>${by ? T('Liste d\'échange de {name}', { name: esc(by) }) : T('Ma liste d\'échange')}</b></div>
        <div class="qr-img" role="img" aria-label="${T('QR code du lien de ta liste d\'échange')}">${q.svg}</div>
        <p class="qr-url">${esc(url)}</p></div>
      <p class="qr-hint">${T('Fais-le scanner par l\'autre joueur')}</p><p class="hint qr-lock" hidden>${T('L\'écran reste allumé tant que le QR code est affiché.')}</p>`;
    const box = $('.qr-img', api.body), svg = $('svg', box);
    // taille : un nombre entier de pixels physiques par module (aucun module flou ou plus large que ses voisins)
    const fit = () => { const w = Math.min(box.clientWidth || 300, 380), r = window.devicePixelRatio || 1, px = Math.max(2, Math.floor(w * r / q.n)) * q.n / r; svg.style.width = svg.style.height = px + 'px'; };
    fit(); requestAnimationFrame(fit);
    let wl = null, on = true;
    const lock = async () => {
      if (!on || wl || !navigator.wakeLock || document.visibilityState !== 'visible') return;
      try { const l = await navigator.wakeLock.request('screen'); if (!on) { l.release(); return; } wl = l; if (l.addEventListener) l.addEventListener('release', () => { if (wl === l) wl = null; }); } catch (e) { wl = null; }      // refusé (économie d'énergie) : l'écran s'éteindra comme d'habitude
      const h = $('.qr-lock', api.body); if (h) h.hidden = !wl;
    };
    const vis = () => { if (document.visibilityState === 'visible') lock(); };      // le verrou tombe quand on quitte l'appli : repris au retour
    document.addEventListener('visibilitychange', vis); lock();
    const close = api.close;
    api.close = () => { on = false; document.removeEventListener('visibilitychange', vis); try { if (wl) wl.release(); } catch (e) { /* déjà relâché */ } wl = null; close(); };
  });
}

/* ── Écran public (visiteur, ou aperçu du propriétaire) ─────────────────────────────────────────── */
/** Ouverture par un lien ?p=<id> : lit le partage puis ouvre la liste d'échange ou le deck, en lecture seule. */
async function openPublicLink(id) {
  const t = Tasks.start(T('Lecture du partage'));
  let sh;
  try { sh = await shareFetch(id); t.remove(); }
  catch (e) {
    t.remove();
    const msg = T(e.code === 'gone' ? 'Ce lien ne marche plus : le partage a été arrêté.' : e.code === 'denied' ? 'Ce partage n\'est pas lisible (lien arrêté, ou partage pas encore activé sur ce site).' : e.code === 'bad' ? 'Lien de partage invalide.' : 'Partage injoignable : vérifie ta connexion puis recharge la page.');
    openSheet(T('Partage'), '', api => { api.body.innerHTML = `<p>${esc(msg)}</p>`; api.setFoot('<button class="btn" type="button" data-close>' + T('Fermer') + '</button>'); });
    return;
  }
  try { if (sh.kind === 'deck') openDeckViewer({ text: sh.text, name: sh.name, pub: true, at: sh.at, by: sh.by, sid: id }); else openPublicTrade(sh, false, id); }      // sid : identifiant du partage (« Signaler ce partage », trReportHref)
  catch (e) {      // jamais l'accueil sans explication : le message aide à comprendre ce qui coince
    console.error(e);
    openSheet(T('Partage'), '', api => { api.body.innerHTML = `<p>${T('Ce partage n\'a pas pu s\'afficher. Recharge la page ; si ça recommence, signale ce message :')}</p><p class="hint">${esc(String(e && e.message || e))}</p>`; api.setFoot('<button class="btn" type="button" data-close>' + T('Fermer') + '</button>'); });
  }
}
/** « Signaler ce partage » (contenu choisi par un autre compte : pseudo, photo) : courriel prérempli avec le lien. Objet fixe, pour le tri. */
const trReportHref = id => 'mailto:' + TR_REPORT + '?subject=' + encodeURIComponent('Mana Orbit · signalement') + '&body=' + encodeURIComponent(T('Partage signalé : {url}', { url: shareUrl(id) }) + '\n' + T('Raison :') + ' ');
/**
 * Liste d'échange en lecture seule : « Pour toi » (visiteur : ce que vous pouvez échanger), « À échanger » / « Recherchées », recherche par nom (français ou anglais) et filtres, carte en grand.
 * preview : aperçu du propriétaire (ni « Pour toi », ni étiquettes du visiteur, ni signalement). id : identifiant du partage (signalement).
 */
function openPublicTrade(sh, preview, id) {
  if (TR.pub && TR.pub.el) TR.pub.el.__close();
  const P = TR.pub = { sh, preview: !!preview, sub: preview ? (sh.have.length || !sh.want.length ? 'have' : 'want') : 'match', f: newFilter(), shown: TR_PAGE, el: null, mine: null, key: '', refs: [], t: 0, tick: 0, px: 0, paint: null };
  if (!preview) P.mine = pubMine(P);
  const wrap = document.createElement('div'); wrap.className = 'dv coll pubv'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', T('Liste d\'échange'));
  wrap.innerHTML = `<header class="dv-head"><button class="icon-btn dv-back" type="button" data-act="close" aria-label="${T('Fermer')}"><svg class="i"><use href="#i-back"/></svg></button>
      ${sh.bp ? `<img class="pub-av" src="${sh.bp}" alt="">` : ''}<div class="dv-title"><b>${preview ? T('Aperçu de ta liste') : sh.by ? T('Liste d\'échange de {name}', { name: esc(sh.by) }) : T('Liste d\'échange')}</b><span>${sh.at ? T('Mise à jour {when}', { when: esc(relTime(sh.at)) }) : ''}</span></div></header>
    <div class="dv-scroll"><div class="dv-body coll-body">
      <p class="hint pub-note">${T(preview ? 'Ce que voient les personnes qui ont ton lien.' : 'Lecture seule. Touche une carte pour la voir en grand.')}${sh.cut ? ' ' + T('Liste trop longue : seule une partie est affichée.') : ''}</p>
      <div class="seg" id="pubSub" role="radiogroup" aria-label="${T('Liste')}"></div><div id="pubF"></div><div class="pub-main"></div>
      ${!preview && id ? `<p class="pub-report"><a href="${esc(trReportHref(id))}" rel="noopener">${T('Signaler ce partage')}</a></p>` : ''}</div></div>`;
  P.el = wrap;
  const paint = keep => {
    const sc = $('.dv-scroll', wrap), pos = keep && sc ? sc.scrollTop : 0;
    $('#pubF', wrap).hidden = P.sub === 'match';
    if (P.sub === 'match') $('.pub-main', wrap).innerHTML = pubMatchHtml(P);
    else {
      const all = (P.sub === 'want' ? sh.want : sh.have).map(pubItem), list = filterItems(all, P.f), shown = list.slice(0, P.shown);
      $('.pub-main', wrap).innerHTML = `${filterActive(P.f) ? `<p class="hint coll-count">${TN(list.length, '{n} carte sur {total}', '{n} cartes sur {total}', { total: nf0(all.length) })}</p>` : ''}
        ${shown.length ? `<div class="coll-list">${shown.map(pubRow).join('')}</div>` : `<p class="hint listempty">${T(all.length ? 'Aucune carte ne correspond.' : P.sub === 'want' ? 'Aucune carte recherchée pour l\'instant.' : 'Aucune carte à échanger pour l\'instant.')}</p>`}
        ${list.length > shown.length ? `<button class="btn ghost block coll-more" type="button" data-act="more">${T('Afficher {n} de plus · {left} restantes', { n: nf0(Math.min(TR_PAGE, list.length - shown.length)), left: nf0(list.length - shown.length) })}</button>` : ''}
        ${shown.some(it => trPrice(it.k)) ? pubNote() : ''}`;
    }
    if (sc) sc.scrollTop = pos;
    if (!keep) stagger($$('.pub-main .coll-list', wrap));
  };
  P.paint = paint;
  mountSeg($('#pubSub', wrap), [...(preview ? [] : [{ v: 'match', label: T('Pour toi'), sub: pubMatchSub(P) }]), { v: 'have', label: T('À échanger'), sub: nf0(sh.have.length) }, { v: 'want', label: T('Recherchées'), sub: nf0(sh.want.length) }], P.sub, v => { P.sub = v; P.shown = TR_PAGE; paint(false); });
  mountFilters($('#pubF', wrap), P.f, () => { P.shown = TR_PAGE; paint(true); }, { placeholder: T('Nom français ou anglais') });
  const onKey = e => { if (e.key === 'Escape' && !imgView && !sheets.length) { e.stopPropagation(); wrap.__close(); } };
  wrap.__close = () => {
    if (P.el !== wrap) return; P.el = null; document.removeEventListener('keydown', onKey, true); clearTimeout(P.t); clearInterval(P.tick);
    wrap.classList.remove('on'); setTimeout(() => wrap.remove(), reduceMotion() ? 0 : 240); releaseApp();
    if (!preview) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
  wrap.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  wrap.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && b.dataset.act === 'close') return wrap.__close();
    if (b && b.dataset.act === 'more') { P.shown += TR_PAGE; paint(true); return; }
    if (b && b.dataset.act === 'login') { haptic('tap'); openAccount(); return; }      // feuille du compte par-dessus (z-index 85 > 80) ; les correspondances suivent la synchro
    if (b && b.dataset.act === 'import') { openCollImport(); return; }
    const row = e.target.closest('.pub-row'); if (!row) return;
    const rows = $$('.pub-row', wrap), list = [], at = { i: 0 };      // illustration recherchée (data-pw) : montrée telle quelle, sans version française
    for (const r of rows) { const im = $('img', r); if (!im) continue; if (r === row) at.i = list.length; list.push({ key: r.dataset.k, name: $('.row-name', r).textContent, wl: !r.dataset.pw && r.dataset.ln && r.dataset.ln !== 'en' ? r.dataset.ln : '', small: im.getAttribute('src'), lang: r.dataset.ln || 'en', plain: true, extra: r.dataset.x || '' }); }
    if (list.length) { haptic('tap'); openCardViewer(list, at.i); } else toast(T('Pas d\'aperçu pour cette carte'));
  });
  document.body.appendChild(wrap); holdApp(); paint(false);
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('on'); $('.dv-back', wrap).focus({ preventScroll: true }); }));
  if (!preview) { P.key = pubKey(); P.refs = pubRefs(); P.tick = setInterval(() => { if (P.el === wrap && (pubKey() !== P.key || pubRefs().some((r, i) => r !== P.refs[i]))) pubRefresh(); }, 1500); pubPx(P); }      // filet : un changement que les crochets n'auraient pas signalé
  // cartes sans image ni type (partage trop gros, ou fiche pas encore lue chez le propriétaire) : lues sur Scryfall par lots, puis repeintes
  (async () => {
    const need = [...sh.have, ...sh.want].filter(x => !x.im || x.tl == null).map(x => ({ key: x.k, name: x.n }));
    for (let i = 0; i < 40 && P.el === wrap && dmMissing(need).length; i++) { if (!(await dmFetch(need))) break; if (P.el === wrap) paint(true); }
  })();
}

/* ── « Pour toi » : ce que le visiteur et le propriétaire du lien peuvent échanger ───────────────── */
/** Ce que le visiteur a en trop (tradeLists : ses decks et sa réserve gardent leurs cartes) et ce qu'il cherche, comparés au partage. */
function pubMine(P) {
  const st = trState();
  return { st, spare: new Map(st.have.map(x => [x.k, x])), want: new Map(st.want.map(x => [x.k, x])), m: tradeMatch(P.sh, st.want, st.have, trPrice) };
}
/** Ce qui change les correspondances : compte, synchro, collection, decks, réglages d'échange, fichier de prix. */
const pubKey = () => [D.uid || '', D.authReady ? 1 : 0, COLL.live ? 1 : 0, COLL.cloud, COLL.u, collCount(), allDecks().length, TR.u, CTX.proxy ? 1 : 0, PXT ? PXT.t : 0].join('|');
const pubRefs = () => [COLL.map, allDecks(), TR.wish];
/** Rien à comparer : ni collection, ni carte recherchée (deck, souhait). */
const pubEmpty = P => !collCount() && !P.mine.st.want.length;
const pubMatchSub = P => (!D.user && pubEmpty(P) ? '–' : nf0(P.mine.m.n));
/** Fichier de prix (un seul, gardé 12 h, déjà utilisé par la recherche Cardmarket) : lu une fois, puis les valeurs se repeignent. */
function pubPx(P) {
  if (PXT || P.px || !CTX.proxy) return;
  P.px = 1; pxTable().then(t => { if (t && TR.pub === P && P.el) pubRefresh(); }, () => {});
}
/** Recalcule (connexion, collection du compte arrivée, deck, souhait…) et repeint sans perdre la position. Appelée par les crochets (trSoon, trRepaint, trUser) et le filet. */
function pubRefresh() {
  const P = TR.pub; if (!P || !P.el || P.preview) return;
  clearTimeout(P.t); P.key = pubKey(); P.refs = pubRefs(); P.mine = pubMine(P); pubPx(P);
  const seg = $('#pubSub', P.el); if (seg && seg.setSub) seg.setSub('match', pubMatchSub(P));
  if (P.paint) P.paint(true);
}
function pubSoon() { const P = TR.pub; if (!P || !P.el || P.preview) return; clearTimeout(P.t); P.t = setTimeout(pubRefresh, 250); }
/** Onglet « Pour toi » : connexion ou import si rien à comparer, sinon les deux blocs avec leur valeur. */
function pubMatchHtml(P) {
  const M = P.mine, m = M.m, empty = pubEmpty(P), who = P.sh.by ? esc(P.sh.by) : '';
  if (!D.user && !D.authReady && D.hint) return `<div class="status" data-ok="0"><span class="dot"></span><span>${T('Connexion à ton compte…')}</span></div>`;
  if (D.user && !collCount() && !COLL.live && COLL.cloud === 'sync') return `<div class="status" data-ok="0"><span class="dot"></span><span>${T('Lecture de ta collection…')}</span></div>`;
  let top = '';
  if (!D.user) top = `<div class="tr-box pub-cta"><b>${T('Ce que vous pouvez échanger')}</b>
      <p class="hint">${empty ? T('Ajoute ta collection pour voir ce que vous pouvez échanger : tes doublons et les cartes que tu cherches sont comparés à cette liste.') : T('Calculé avec la collection de cet appareil. Connecte-toi pour utiliser celle de ton compte.')}</p>
      <button class="btn block" type="button" data-act="login">${T('Se connecter pour voir vos correspondances')}</button>${empty ? `<button class="btn ghost block" type="button" data-act="import">${T('Importer ma collection')}</button>` : ''}</div>`;
  else if (empty) top = `<div class="tr-box pub-cta"><b>${T('Ce que vous pouvez échanger')}</b><p class="hint">${T('Ajoute ta collection pour voir ce que vous pouvez échanger.')}</p><button class="btn block" type="button" data-act="import">${T('Importer ma collection')}</button></div>`;
  if (empty) return top;
  const block = side => {
    const list = m[side], s = m.sum[side];
    const title = side === 'get' ? (who ? T('{name} a ce que tu cherches', { name: who }) : T('Il a ce que tu cherches')) : (who ? T('Tu as ce que {name} cherche', { name: who }) : T('Tu as ce qu\'il cherche'));
    const none = side === 'get' ? T(M.st.want.length ? 'Aucune des cartes que tu cherches n\'est dans sa liste.' : 'Tu ne cherches aucune carte pour l\'instant : tes decks sont complets et ta liste de souhaits est vide.')
      : T(M.st.have.length ? 'Il ne cherche aucun de tes doublons.' : 'Aucune carte en trop dans ta collection pour l\'instant (tes decks et ta réserve gardent les leurs).');
    return `<section class="pm-block" data-side="${side}"><div class="pm-head"><b>${title}</b>${s.n ? `<span>${TN(s.n, '{n} carte', '{n} cartes')}${s.v ? ` · <em>≈ ${esc(fmt(s.v, 'EUR'))}</em>` : ''}</span>` : ''}</div>
      ${list.length ? `<div class="coll-list">${list.map(x => pubMatchRow(x, side)).join('')}</div>` : `<p class="hint pm-none">${none}</p>`}</section>`;
  };
  return `${top}${block('get')}${block('give')}${m.sum.get.v || m.sum.give.v ? pubNote() : ''}`;
}
/** Base des valeurs affichées chez le visiteur (calculées sur son appareil, jamais écrites dans le partage). */
function pubNote() {
  const at = PXT && Date.parse(PXT.at);
  return `<p class="hint pm-note">${at ? T('≈ valeur indicative : tendance Cardmarket ({when}), sans l\'état ni l\'édition des cartes.', { when: esc(relTime(at)) }) : T('≈ valeur indicative : tendance Cardmarket, sans l\'état ni l\'édition des cartes.')}</p>`;
}
/** Ligne d'un bloc : sa carte (image, nom français), ce qui la rend intéressante, exemplaires échangeables et valeur. */
function pubMatchRow(x, side) {
  const it = pubFill(x.it), nm = it.dn || it.n, img = it.im || '', alt = it.dn && it.dn !== it.n ? it.n : it.fn || '';
  const ls = side === 'get' ? x.ls : x.s.lines.map(l => l[0]).filter(Boolean);      // ses langues / celles de mes doublons
  const tags = side === 'get'
    ? `<span class="tag accent">${T('tu la cherches × {n}', { n: x.w.q })}</span>${x.w.p && x.w.p.w ? `<span class="tag" title="${T('Illustration recherchée')}">${T('illustration souhaitée : {name}', { name: esc(x.w.p.w) })}</span>` : ''}`
    : `<span class="tag good">${T('tu peux l\'échanger × {n}', { n: x.s.q })}</span>${it.pw ? `<span class="tag accent" title="${T('Illustration recherchée')}">${esc(it.pw)}</span>` : ''}`;
  const val = x.v != null ? '≈ ' + fmt(x.v, 'EUR') : '', cap = TN(x.q, '{n} exemplaire', '{n} exemplaires') + (val ? ' · ' + val : '');
  return `<div class="crow pub-row pm-row" role="button" tabindex="0" data-k="${esc(x.k)}" data-ln="${esc(side === 'get' ? it.l || '' : '')}"${it.pw ? ' data-pw="1"' : ''} data-x="${esc(cap)}"><span class="thumb" style="--h:${hash32(x.k) % 360}">${esc((nm.trim()[0] || '?').toUpperCase())}${img ? `<img alt="" loading="lazy" decoding="async" src="${esc(img)}">` : ''}</span>
    <span class="row-main"><span class="row-top"><span class="row-name">${esc(nm)}</span>${ls.map(flag).join('')}</span><span class="row-meta">${tags}${alt ? `<span class="tag">${esc(alt)}</span>` : ''}</span></span>
    <span class="tr-q"><b>× ${x.q}</b>${val ? `<small>${esc(val)}</small>` : ''}</span></div>`;
}
/** Carte du partage complétée par le cache Scryfall de cet appareil (image, coût, type, couleurs, symboles). */
function pubFill(x) {
  const m = dmOf(x.k) || {}, it = { ...x };
  for (const f of ['im', 'cm', 'tl', 'cl', 'mc']) if (it[f] == null && m[f] != null) it[f] = m[f];
  return it;
}
/** Item public (onglets complets) : ce que le visiteur peut en faire, d'après ses doublons échangeables (pas le brut possédé : ses decks gardent leurs cartes). */
function pubItem(x) {
  const it = pubFill(x), M = TR.pub && TR.pub.mine;
  if (M) { it.own = collQty(x.k); it.spare = (M.spare.get(x.k) || {}).q || 0; it.used = !!M.st.use.get(x.k); it.wq = (M.want.get(x.k) || {}).q || 0; }
  return it;
}
function pubRow(it) {
  const nm = it.dn || it.n, img = it.im || '', sub = it.dn && it.dn !== it.n ? `<span class="tag">${esc(it.n)}</span>` : it.fn ? `<span class="tag">${esc(it.fn)}</span>` : '';
  const pw = it.pw ? `<span class="tag accent" title="${T('Illustration recherchée')}">${esc(it.pw)}</span>` : '';
  const mine = TR.pub && TR.pub.sub === 'want'      // ce qu'il cherche : échangeable seulement si j'en ai en trop
    ? (it.spare ? `<span class="tag good">${T('tu peux l\'échanger × {n}', { n: it.spare })}</span>` : it.own ? `<span class="tag">${T(it.used ? 'tu l\'as · dans tes decks' : 'tu l\'as · gardée')}</span>` : '')
    : (it.wq ? `<span class="tag accent">${T('tu la cherches × {n}', { n: it.wq })}</span>` : it.own ? `<span class="tag good">${T('déjà à toi × {n}', { n: it.own })}</span>` : '');
  const x = TN(it.q, '{n} exemplaire', '{n} exemplaires') + (it.l ? ' · ' + (LANGS[it.l] || it.l) : '') + (it.pw ? ' · ' + T('illustration {name}', { name: it.pw }) : '');
  return `<div class="crow pub-row" role="button" tabindex="0" data-k="${esc(it.k)}" data-ln="${esc(it.l || '')}"${it.pw ? ' data-pw="1"' : ''} data-x="${esc(x)}"><span class="thumb" style="--h:${hash32(it.k) % 360}">${esc((nm.trim()[0] || '?').toUpperCase())}${img ? `<img alt="" loading="lazy" decoding="async" src="${esc(img)}">` : ''}</span>
    <span class="row-main"><span class="row-top"><span class="row-name">${esc(nm)}</span>${it.l ? flag(it.l) : ''}</span><span class="row-meta">${pw}${it.tl ? `<span class="tag">${esc(typeBucket(it.tl))}</span>` : ''}${sub}${mine}</span></span>
    <span class="tr-q">${trQxHtml({ q: it.q, u: trPrice(it.k) })}</span></div>`;      // prix à l'unité de l'appareil du visiteur, comme sur l'onglet du propriétaire
}

function trInit() {
  trRead();
  let id = ''; try { id = new URLSearchParams(location.search).get('p') || ''; } catch (e) { /* ignore */ }
  if (id) setTimeout(() => openPublicLink(id), 0);
}
