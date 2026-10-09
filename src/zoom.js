/* ── zoom.js : toute vignette de carte s'ouvre en grand (toucher, Entrée, Espace), précédente / suivante dans la liste affichée ──────────────
   Une vignette porte data-zoom="<liste>" (zoomAt dans le gabarit de la ligne) ; un seul écouteur, en capture sur le document, construit la liste
   et ouvre openCardViewer. Le reste de la ligne garde son action (fiche des offres, quantités…). Vignette sans image : la carte est chargée par son nom. */

/** Attributs d'une vignette agrandissable : kind = liste à parcourir (ZOOM_LISTS), name = nom affiché (lu par le lecteur d'écran). Déclaration hissée : utilisable par les gabarits des fichiers chargés avant. */
function zoomAt(kind, name) { return ` data-zoom="${kind}" role="button" tabindex="0" aria-label="${T('Agrandir {name}', { name: esc(name) })}"`; }
function zoomUrl(n, v) { return 'https://api.scryfall.com/cards/named?exact=' + encodeURIComponent(n) + '&format=image&version=' + v; }
/** Carte sans image connue (fiche pas encore lue, prix Cardmarket, image en échec) : image anglaise par le nom ; wl : langue voulue, cherchée par le viewer. */
function zoomNamed(key, name, en, wl, extra) {
  const im = (dmOf(ownKey(en)) || {}).im || '';
  return { key, name, ln: en, wl: wl && wl !== 'en' ? wl : '', small: im || zoomUrl(en, 'small'), big: im ? '' : zoomUrl(en, 'large'), lang: 'en', plain: true, extra: extra || '' };
}
/** Liste du viewer depuis des rangées affichées : make(r) → carte, ou null (rangée sautée) ; at : la rangée touchée. */
function zoomFrom(rows, row, make) {
  const items = []; let at = -1;
  for (const r of rows) { const it = make(r); if (!it) continue; if (r === row) at = items.length; items.push(it); }
  return { items, at };
}
const zoomImg = r => { const im = $('.thumb img', r); return im && im.classList.contains('ok') ? im.getAttribute('src') : ''; };      // image chargée de la vignette ('' : lettre seule)
const zoomName = r => { const n = $('.row-name', r); return n ? n.textContent.trim() : ''; };

const ZOOM_LISTS = {
  /* Résultats d'une recherche (CardTrader ou Cardmarket) : impression de l'offre retenue (cardImageItem), sinon la carte par son nom ; lignes masquées par un filtre sautées. */
  res: th => {
    const row = th.closest('.rw'); if (!row || !S.run) return null;
    return zoomFrom($$('#list .rw').filter(r => !r.hidden), row, r => {
      const k = r.dataset.key, c = S.deck.cards.find(x => x.key === k), st = S.run.cards[k] || {}; if (!c || st.notFound) return null;
      return cardImageItem(k) || zoomNamed(k, c.name, c.name, viewLang(k, c.own > 0));
    });
  },
  /* Collection : liste (une ligne par carte et par langue), « Les plus chères » et « Variations des prix » (Stats). */
  coll: th => {
    const row = th.closest('.crow'); if (!row) return null;
    return zoomFrom($$(':scope > .crow', row.parentNode), row, r => {
      const k = r.dataset.k, ln = r.dataset.ln || '', x = COLL.map[k];
      return collViewItem(k, ln) || (x ? zoomNamed(k, zoomName(r) || x.n, x.n, ln || x.l) : null);
    });
  },
  /* Liste d'échange : doublons (langue de l'exemplaire) et cartes recherchées (illustration souhaitée montrée telle quelle). */
  tr: th => {
    const row = th.closest('.tr-row'); if (!row) return null;
    return zoomFrom($$(':scope > .tr-row', row.parentNode), row, r => {
      const k = r.dataset.k, name = zoomName(r), en = (COLL.map[k] || {}).n || name, ln = r.dataset.ln || '', big = r.dataset.big, src = zoomImg(r);
      if (!src) return zoomNamed(k, name, en, ln);
      return { key: k, name, ln: en, wl: big ? '' : ln && ln !== 'en' ? ln : '', small: src, ...(big ? { big } : {}), lang: ln || 'en', plain: true, extra: '' };
    });
  },
  /* Page publique d'une liste d'échange (la ligne entière est la vignette) : toutes les cartes affichées, blocs « Pour toi » compris. */
  pub: row => {
    const wrap = row.closest('.pubv'), P = TR.pub; if (!wrap || !P) return null;
    const ens = new Map([...P.sh.have, ...P.sh.want].map(x => [x.k, x.n]));
    return zoomFrom($$('.pub-row', wrap), row, r => {
      const k = r.dataset.k, name = zoomName(r), en = ens.get(k) || name, ln = r.dataset.ln || '', im = $('.thumb img', r);      // illustration recherchée (data-pw) : telle quelle, sans version française
      if (!im) return zoomNamed(k, name, en, ln, r.dataset.x);
      return { key: k, name, ln: en, wl: !r.dataset.pw && ln && ln !== 'en' ? ln : '', small: im.getAttribute('src'), lang: ln || 'en', plain: true, extra: r.dataset.x || '' };
    });
  },
  /* Scan : cartes reconnues ou liste du prix rapide, dans l'ordre affiché ; la photo prise reste sous une carte « à vérifier ». */
  scan: th => {
    const row = th.closest('.sc-item'); if (!row || !SC.el) return null;
    const items = SC.pm ? SC.pq.map(x => scanViewItem({ key: x.key, name: x.name, q: x.n || 1, l: x.l, maybe: false, score: 1 })) : [...SC.items.values()].reverse().map(scanViewItem);
    return { items, at: items.findIndex(x => x.lid === (row.dataset.id || row.dataset.k)) };
  },
  /* Fiche « Ajouter » du scan : les plus chères. */
  rc: th => {
    const row = th.closest('.crow'); if (!row) return null;
    return zoomFrom($$(':scope > .crow', row.parentNode), row, r => scanViewItem({ key: r.dataset.k, name: r.dataset.n, q: Number(r.dataset.q) || 1, l: r.dataset.ln || '', maybe: false, score: 1 }));
  },
  /* Éditeur de deck : cartes du deck et résultats de la recherche, dans l'ordre affiché. */
  bd: th => {
    const row = th.closest('.bd-row'); if (!row || !BD.el) return null;
    return zoomFrom($$('.bd-row', BD.el), row, r => bdViewItem(r) || zoomNamed(r.dataset.k, bdLabel(r.dataset.k, r.dataset.n), r.dataset.n, viewLang(r.dataset.k, true)));
  },
};
/** Ouvre la carte de cette vignette en grand ; false si rien à montrer (la ligne garde alors son action). */
function zoomOpen(el) {
  const f = ZOOM_LISTS[el.dataset.zoom], r = f && f(el);
  if (!r || r.at < 0) return false;
  openCardViewer(r.items, r.at); return true;
}
if (typeof document !== 'undefined') {
  // En capture : la vignette passe avant le gestionnaire de sa ligne (fiche des offres, édition…), qui ne reçoit pas ce toucher.
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest && e.target.closest('[data-zoom]'); if (!el || !zoomOpen(el)) return;
    e.stopPropagation(); e.preventDefault();
  }, true);
  document.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target || !e.target.matches || !e.target.matches('[data-zoom]')) return;
    e.preventDefault(); e.stopPropagation(); if (!e.repeat) zoomOpen(e.target);      // Espace ne fait pas défiler la page
  }, true);
}
