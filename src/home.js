/* ── home.js : page d'accueil ──────────────────────────────────────────────────────────────────────
   · Orbe « Ma collection » : valeur (prix tendance Cardmarket), cartes, variation sur 7 jours ; les 5 terrains de base tournent autour
     (illustration de ceux de la collection s'ils y sont, sinon la fiche Scryfall, lue une fois).
   · « Mes decks » : les cartes de présentation des 3 derniers decks en éventail.
   · Prix rapide · Deck à monter (le deck EDHREC le plus intéressant à finir : part possédée et coût pour finir, voir homePick) · Échange (doublons, cartes recherchées, lien en direct).
   · « Nouveau panier » : ouvre la saisie (coller une liste, exemple, ou reprendre la liste en cours).
   · « Prochaines extensions » (sets.js, cachée tant qu'elle n'a rien à montrer) et « Comment ça marche ? » (aide, help.js) en bas.
   Tout est repeint en différé (homeSoon) quand la collection, les decks, les prix ou la liste d'échange changent. */
const HM = { t: 0, v: null, raf: 0, best: null, bestSig: '', edhAsk: 0, covers: '', lands: false };
const HM_LANDS = [['W', 'plains', 'Plains'], ['U', 'island', 'Island'], ['B', 'swamp', 'Swamp'], ['R', 'mountain', 'Mountain'], ['G', 'forest', 'Forest']];
const hmEur = c => I18N.lang === 'fr' ? Math.round(c / 100).toLocaleString('fr-FR') + ' €' : new Intl.NumberFormat(LOC(), { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round(c / 100));
/** Petite image Scryfall → recadrage de l'illustration (même chemin, autre taille). */
const hmArt = u => String(u || '').replace('/small/', '/art_crop/').replace('/normal/', '/art_crop/');

function homeSoon(ms = 120) { if (typeof document === 'undefined') return; clearTimeout(HM.t); HM.t = setTimeout(homePaint, ms); }

/** Valeur de la collection : somme des prix tendance (centimes) ; à défaut le dernier relevé de l'historique. */
function homeValue() {
  let v = 0; for (const [k, x] of Object.entries(COLL.map)) { const m = COLL.meta[k]; if (m && m.eu > 0) v += m.eu * x.q; }
  if (!v && VAL.hist.length) v = VAL.hist[VAL.hist.length - 1].v;
  return v;
}
/** Le chiffre défile jusqu'à sa valeur (euros entiers). */
function homeCount(el, to) {
  const from = HM.v == null ? 0 : HM.v; HM.v = to; cancelAnimationFrame(HM.raf);
  if (reduceMotion() || from === to) { el.textContent = hmEur(to); return; }
  const t0 = performance.now(), d = from ? 600 : 1400;
  const step = now => { const p = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - p, 3); el.textContent = hmEur(Math.round(from + (to - from) * e)); if (p < 1) HM.raf = requestAnimationFrame(step); };
  HM.raf = requestAnimationFrame(step);
}

function homePaint() {
  const home = $('#viewHome'); if (!home) return;
  // Orbe
  const n = collCount(), orb = $('#btnColl'), val = $('#hmValue'), cnt = $('#hmCount'), dl = $('#hmDelta');
  orb.dataset.empty = n ? '0' : '1';
  if (n) {
    const v = homeValue();
    if (v > 0) homeCount(val, v); else { HM.v = null; val.textContent = nf0(n); }
    cnt.textContent = v > 0 ? TN(n, '{n} carte', '{n} cartes') : TN(n, 'carte', 'cartes');
    const h = histDelta(VAL.hist, 7);
    if (h && Math.abs(h.d) >= 100) { dl.hidden = false; dl.className = h.d < 0 ? 'down' : ''; dl.textContent = T('{d} · 7 j', { d: (h.d < 0 ? '▼ −' : '▲ +') + hmEur(Math.abs(h.d)) }); } else dl.hidden = true;
  } else { HM.v = null; val.textContent = T('Commencer'); cnt.textContent = T('Ajoute tes cartes'); dl.hidden = true; }
  orb.setAttribute('aria-label', n ? T('Ma collection : {v}, {n} cartes', { v: val.textContent, n: nf0(n) }) : T('Ma collection : ajoute tes cartes'));
  widgetSoon();                                                                          // widget Android : mêmes chiffres (widget.js)
  homeLands();
  // Mes decks
  const list = allDecks().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), top = list.slice(0, 3);
  $('#hmDecksN').textContent = list.length ? nf0(list.length) : '';
  { const ds = $('#decksSub'); ds.hidden = !!list.length && !/Chargement| · |…/.test(ds.textContent); }      // « 7 decks » répète le nombre du titre : seulement « · 2 montés » (« · » et « … » : mêmes cas dans toutes les langues)
  $('#hmDeckNames').textContent = top.length ? top.map(d => d.name).join(', ') + (list.length > 3 ? '…' : '') : '';
  const fan = $$('#hmFan i'), need = [];
  fan.forEach((el, i) => {
    const d = top[i], cv = d && dkCoverCard(d.text, dmOf), src = cv ? coverImg(cv) : '', img = el.querySelector('img');
    if (cv && !src) need.push(d);
    if (!src) { if (img) img.remove(); return; }
    if (img && img.getAttribute('src') === src) return;
    const im = img || document.createElement('img'); im.alt = ''; im.decoding = 'async'; im.onerror = () => im.remove(); im.src = src; if (!img) el.appendChild(im);
  });
  if (need.length) homeCovers(need);
  // Échange
  try {
    const st = trState(), ts = $('#hmTradeSub');
    ts.textContent = n || st.want.length ? TN(st.have.length, '{n} doublon', '{n} doublons') + ' · ' + TN(st.want.length, '{n} recherchée', '{n} recherchées') : T('Doublons et cartes recherchées');
    $('#hmLive').hidden = !TR.share;
  } catch (e) { /* liste d'échange pas encore prête */ }
  // Deck à monter
  homeBuild();
  // Nouveau panier
  const draft = !S.isSample && S.deck && S.deck.cards.length;
  $('#btnNewLabel').textContent = draft ? T('Reprendre ma liste · {cards}', { cards: TN(S.deck.cards.length, '{n} carte', '{n} cartes') }) : T('Coller une liste');
  $('#btnNew2Label').textContent = draft ? T('Coller') : T('Exemple');
  if (typeof setsSoon === 'function') setsSoon();                                        // prochaines extensions (sets.js)
  if (typeof rateTick === 'function') rateTick();                                        // demande de note : decks devenus complets (help.js)
}
/** Illustrations des terrains de base : celles de la collection si elle les a, sinon la fiche Scryfall lue une fois par la file de l'appli
 *  (cache de l'appareil, pause Scryfall respectée) ; en attendant, un dégradé aux couleurs du terrain. */
function homeLands() {
  let miss = false;
  for (const [c, k] of HM_LANDS) {
    const img = $(`.hm-land[data-c="${c}"] img`); if (!img) continue;
    const m = dmOf(k), src = m && m.im ? hmArt(m.im) : '';
    if (!src) { miss = true; continue; }
    img.title = m.ar ? T('Illustration : {artist}', { artist: m.ar }) : '';      // crédit de l'artiste, demandé par Scryfall pour les recadrages art_crop (lu avec la fiche, sans requête de plus)
    if (img.getAttribute('src') === src) continue;
    img.onload = () => img.classList.add('ok'); img.onerror = () => img.classList.remove('ok'); img.src = src;
  }
  if (miss && !HM.lands) {
    HM.lands = true;
    setTimeout(async () => { if (S.view !== 'home' || document.querySelector('body > .dv.on, .sheet-wrap.open')) { HM.lands = false; return; }      // seulement quand l'accueil est vraiment à l'écran : jamais pendant la collection, un scan ou une feuille
      try { await dmLoad(); if (await dmFetch(HM_LANDS.map(([, key, name]) => ({ key, name })), true)) homeSoon(); else if (HM_LANDS.some(([, k]) => !(dmOf(k) || {}).im)) HM.lands = false; } catch (e) { HM.lands = false; } }, 3000);
  }
}
/** Cartes de présentation pas encore lues : lues en arrière-plan, puis l'éventail est repeint. */
function homeCovers(decks) {
  const sig = decks.map(d => d.id).join(','); if (HM.covers === sig) return; HM.covers = sig;
  setTimeout(async () => {
    try { await dmLoad(); const cv = decks.map(d => dkCoverCard(d.text, dmOf)).filter(c => c && !dmOf(c.key)); if (cv.length && await dmFetch(cv)) homeSoon(); } catch (e) { /* hors ligne : dégradés */ }
  }, 1200);
}
/** Deck à monter : le deck EDHREC le plus intéressant à finir, parmi ceux dont tu as au moins 10 % des cartes (listes d'au moins 60 cartes).
 *  Score = % possédé − 10 points chaque fois que le coût pour finir double au-delà de 10 € (≤ 10 € : 0 · 20 € : −10 · 40 € : −20 · 80 € : −30 · 160 € : −40 · 320 € : −50…) :
 *  62 % à 84 € (31) passe devant 40 % à 20 € (30) et devant 80 % à 900 € (15) ; un deck déjà complet (100 %, 0 €) l'emporte.
 *  Coût = prix Cardmarket du fichier EDHREC, déjà sur l'appareil (le chiffre de la liste et de la feuille du deck) ; une carte sans prix compte 1 €.
 *  Égalité : le moins cher à finir, puis le commandant le plus joué. rows : résultat d'edhRank → { r, p, s } ou null. */
const HM_MIN = 0.1, HM_FREE = 1000;
const homeScore = r => 100 * r.have / r.total - 10 * Math.log2(Math.max(1, (r.cost + 100 * r.unpriced) / HM_FREE));
function homePick(rows) {
  let best = null;
  for (const r of rows) {
    if (r.total < 60) continue; const p = r.have / r.total; if (p < HM_MIN) continue;
    const s = homeScore(r);
    if (!best || s > best.s + 1e-9 || (Math.abs(s - best.s) <= 1e-9 && (r.cost - best.r.cost || r.cmd.rank - best.r.cmd.rank) < 0)) best = { r, p, s };
  }
  return best;
}
/** Ce qu'il reste à payer, pour la tuile : « ≈ 84 € pour finir », « Rien à acheter », ou le nombre de cartes s'il n'y a aucun prix. */
function homeCostText(r) {
  if (!r.miss) return T('Rien à acheter');
  if (!r.cost) return TN(r.miss, '{n} carte à trouver', '{n} cartes à trouver');
  return T('≈ {eur} pour finir', { eur: r.cost < 1000 ? fmt(r.cost, 'EUR') : hmEur(r.cost) });      // moins de 10 € : au centime (« ≈ 0 € » serait faux)
}
/** Tuile « Deck à monter » (fichier EDHREC chargé en différé, seulement s'il y a une collection) : pourcentage en haut, commandant puis coût pour finir. */
function homeBuild() {
  const pct = $('#hmBuildPct'), sub = $('#hmBuildSub'), btn = $('#btnBuild'), n = collCount();
  const idle = () => { pct.textContent = ''; sub.textContent = T('Decks EDHREC comparés à ta collection'); btn.removeAttribute('aria-label'); };
  if (!n) { idle(); HM.best = null; return; }
  if (!EDH.data) {
    if (!EDH.p && !EDH.err && !HM.edhAsk) HM.edhAsk = setTimeout(() => { edhLoad().then(homeSoon, () => {}); }, 2500);
    idle(); return;
  }
  const sig = [COLL.u, n, EDH.at, engSig()].join('|');
  if (sig !== HM.bestSig) { HM.bestSig = sig; HM.best = homePick(edhRank(EDH.data, collQty, { held: k => engTotal(XS.eng, k), sort: 'have' })); }
  const b = HM.best;
  if (!b) { idle(); return; }
  const p = Math.floor(b.p * 100), name = b.r.cmd.names.join(' + '), cost = homeCostText(b.r);
  pct.textContent = T('{n} %', { n: p });
  sub.innerHTML = `<span class="hm-bn">${esc(name)}</span><span class="hm-bc">${esc(cost)}</span>`;
  btn.setAttribute('aria-label', T('Deck à monter : {name}, {p} % des cartes déjà possédées, {cost}', { name, p, cost }));
}

function homeInit() {
  $('#btnBuild').onclick = () => {
    haptic('tap'); openCollection('decks');
    const b = HM.best; if (b) setTimeout(() => openEdhDeck(b.r), 260);
  };
  $('#btnTrade').onclick = () => { haptic('tap'); openCollection('trade'); };
  const draft = () => !S.isSample && S.deck && S.deck.cards.length;
  // « Coller une liste » sans liste en cours : le champ est vidé d'abord (sinon l'exemple de 100 cartes restait, presse-papiers refusé dans la WebView) ;
  // presse-papiers vide ou refusé : champ vide, curseur dedans (le collage le remplit)
  $('#btnNew').onclick = () => { haptic('tap'); showView('input'); if (!draft()) { $('#btnClear').click(); $('#btnPaste').click(); } };
  $('#btnNew2').onclick = () => { haptic('tap'); const dr = draft(); showView('input'); if (dr) $('#btnPaste').click(); else $('#btnSample').click(); };
  $('#btnHome').onclick = () => { haptic('tap'); showView('home'); };
  $('#btnHelp').onclick = () => { haptic('tap'); openHelp(); };
  homePaint();
}
