/* ── scan.js : reconnaître les noms de cartes par OCR ──────────────────────────────────────────────────────────
   Deux façons de scanner, même file d'attente (lecture en arrière-plan, une carte après l'autre) :
   · aperçu de l'appareil photo dans l'app : AUCUN calcul pendant l'aperçu ; le cercle prend la photo de la bande « nom · mana » ; on enchaîne ;
   · « Appareil » (appareil photo du téléphone, <input capture>) ou « Photos » (galerie) : photo de la carte entière en portrait, seul le tiers haut est lu.
   Seul le NOM est lu, puis comparé au catalogue Scryfall : on n'ajoute jamais le texte brut, toujours la carte officielle. Français d'abord (catalogue des noms imprimés Scryfall, local), puis anglais,
   puis, si rien n'est sûr, les autres langues (catalogues du serveur) ; la langue de la carte est enregistrée.
   ≥ 84 % de ressemblance = ajoutée (miniature Scryfall pour vérifier) · 72–84 % = à confirmer avec la miniature · en dessous = rien.
   Les photos ne sont jamais enregistrées : décodées au moment de la lecture, puis vidées (il ne reste, en mémoire le temps du scan, qu'une vignette de ~3 Ko de la zone lue et, pour les cartes à vérifier ou non reconnues, une photo lisible de la bande du nom).
   Tesseract.js est chargé à la demande depuis un CDN (modèle français d'abord, ≈ 3 Mo, gardé ensuite par le navigateur ; l'anglais seulement si le français ne trouve rien). */
const TESS_V = '5.1.1', CDN = 'https://cdn.jsdelivr.net/npm/';
const TESS = {
  js: `${CDN}tesseract.js@${TESS_V}/dist/tesseract.min.js`, worker: `${CDN}tesseract.js@${TESS_V}/dist/worker.min.js`, core: `${CDN}tesseract.js-core@${TESS_V}`,
  langs: { eng: `${CDN}@tesseract.js-data/eng/4.0.0_best_int`, fra: `${CDN}@tesseract.js-data/fra/4.0.0_best_int`, deu: `${CDN}@tesseract.js-data/deu/4.0.0_best_int`,
    spa: `${CDN}@tesseract.js-data/spa/4.0.0_best_int`, ita: `${CDN}@tesseract.js-data/ita/4.0.0_best_int`, por: `${CDN}@tesseract.js-data/por/4.0.0_best_int` },
};
/** Moteur OCR de la langue des noms reconnus (collection.js › namesLang) ; lu d'abord, puis l'anglais. Cartes anglaises (aucun catalogue) : l'anglais seul. */
const TESS_OF = { fr: 'fra', de: 'deu', es: 'spa', it: 'ita', pt: 'por' };
const ocrLangs = () => { const t = TESS_OF[namesLang()]; return t ? [t, 'eng'] : ['eng']; };
const OCR = { lib: null, workers: {}, onProg: null };
/** Lettres admises dans un nom de carte : écarte les symboles de mana, filets et bruits que Tesseract prendrait pour du texte. */
const LETTERS = { eng: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ,'’-:!", fra: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆàâäçéèêëîïôöùûüÿœæ ,'’-:!",
  deu: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÄÖÜäöüß ,'’-:!", spa: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÑÓÚÜáéíñóúü¡¿ ,'’-:!",
  ita: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÈÉÌÍÒÓÙÚàèéìíòóùú ,'’-:!", por: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü ,'’-:!" };
function ocrLib() {
  if (typeof Tesseract !== 'undefined') return Promise.resolve(Tesseract);
  if (!OCR.lib) OCR.lib = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = TESS.js; s.async = true;
    s.onload = () => (typeof Tesseract !== 'undefined' ? res(Tesseract) : rej(Object.assign(new Error('OCR indisponible'), { code: 'cdn' })));
    s.onerror = () => { OCR.lib = null; rej(Object.assign(new Error('OCR indisponible'), { code: 'cdn' })); };
    document.head.appendChild(s);
  });
  return OCR.lib;
}
/** Un moteur OCR par langue (eng, fra), créé une fois : le modèle se télécharge à la première utilisation. */
function ocrWorker(lang) {
  if (!OCR.workers[lang]) OCR.workers[lang] = (async () => {
    const T = await ocrLib();
    const w = await T.createWorker(lang, 1, { workerPath: TESS.worker, corePath: TESS.core, langPath: TESS.langs[lang], logger: m => { if (OCR.onProg) OCR.onProg(m); } });
    return w;
  })().catch(e => { delete OCR.workers[lang]; throw e; });
  return OCR.workers[lang];
}
/** Lit une image (canvas) : lignes de texte [{ text }]. psm : '6' bloc (bande du nom) · '11' texte épars (carte entière). Seul le texte est demandé (pas de hocr/tsv/blocs). */
async function ocrLines(canvas, lang, psm) {
  if (natOcr()) { if (!canvas.__ml) canvas.__ml = natLines(canvas); try { return await canvas.__ml; } catch (e) { delete canvas.__ml; } }      // appli Android : ML Kit (repli Tesseract en cas d'erreur)
  const w = await ocrWorker(lang), mode = psm || '6';
  if (w.__psm !== mode) { await w.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: LETTERS[lang] || '' }); w.__psm = mode; }
  const r = await w.recognize(canvas, {}, { text: true }), d = (r && r.data) || {};
  if ((w.__cnt = (w.__cnt || 0) + 1) >= 300 && OCR.workers[lang]) { delete OCR.workers[lang]; Promise.resolve(w.terminate()).catch(() => {}); }   // moteur recréé de temps en temps : la mémoire de WebAssembly ne fait que grossir
  return String(d.text || '').split(/\r?\n/).map(t => ({ text: t.trim() })).filter(l => l.text);
}
async function ocrStop() { const ws = Object.values(OCR.workers); OCR.workers = {}; for (const p of ws) { try { (await p).terminate(); } catch (e) { /* ignore */ } } }

/** Découpe une zone d'une source (vidéo, image, canvas), la met à largeur utile et la convertit en niveaux de gris contrastés
    (inversée si le fond est sombre ; pol : 1 = forcer l'inversion, 0 = ne pas inverser, absent = automatique). Le résultat porte .inv (choix fait). */
function prepCanvas(src, r, outW, pol) {
  const scale = Math.min(2.5, Math.max(outW / r.w, 0.4)), c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(r.w * scale)); c.height = Math.max(8, Math.round(r.h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height), a = d.data, n = c.width * c.height, g = new Uint8Array(n), hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (a[j] * 77 + a[j + 1] * 150 + a[j + 2] * 29) >> 8; g[i] = v; hist[v]++; sum += v; }
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  const span = Math.max(48, hi - lo), inv = pol === undefined || pol === null ? sum / n < 105 : !!pol;
  for (let i = 0, j = 0; i < n; i++, j += 4) { let v = (g[i] - lo) * 255 / span; v = v < 0 ? 0 : v > 255 ? 255 : v; if (inv) v = 255 - v; a[j] = a[j + 1] = a[j + 2] = v; a[j + 3] = 255; }
  ctx.putImageData(d, 0, 0);
  const m = 18, o = document.createElement('canvas'); o.width = c.width + 2 * m; o.height = c.height + 2 * m;     // marge blanche : Tesseract lit mal un texte collé au bord de l'image
  const ox = o.getContext('2d'); ox.fillStyle = '#fff'; ox.fillRect(0, 0, o.width, o.height); ox.drawImage(c, m, m); o.inv = inv;
  return o;
}

/* ── Écran de scan ────────────────────────────────────────────────────────────────────────────── */
const scNoteOff = () => { try { return localStorage.getItem('deckdeal:scnote') === 'off'; } catch (e) { return false; } };      // aide fermée : retenu d'un scan à l'autre
const scNoteSet = off => { try { if (off) localStorage.setItem('deckdeal:scnote', 'off'); else localStorage.removeItem('deckdeal:scnote'); } catch (e) { /* ignore */ } };
function scNoteShow(on) { const n = $('.sc-note', SC.el), h = $('.sc-help', SC.el); if (n) n.hidden = !on; if (h) h.setAttribute('aria-pressed', String(on)); scNoteSet(!on); }
const SC = { warm: false, el: null, stream: null, items: new Map(), miss: [], mid: 0, pend: [], queue: [], working: false, cap: 0, session: 0, alive: false, hintT: 0, watch: null, fpsMin: 10, fps: 0, fixed: false, gen: 0, rbusy: false, rf: { n: 0, at: 0 }, restarts: 0, workEnd: 0, slowN: 0, ms: 0, diagT: 0, lt: [] };
const camSlow = () => { try { return localStorage.getItem('deckdeal:cam2') === 'slow'; } catch (e) { return false; } };      // 'cam2' : l'ancien indicateur (posé quand la lecture tournait pendant l'aperçu) est abandonné
const camSetSlow = on => { try { localStorage.removeItem('deckdeal:cam'); if (on) localStorage.setItem('deckdeal:cam2', 'slow'); else localStorage.removeItem('deckdeal:cam2'); } catch (e) { /* ignore */ } };

/** Miniature officielle de Scryfall (vérification visuelle : on voit tout de suite si c'est la bonne carte). */
const scImg = n => 'https://api.scryfall.com/cards/named?exact=' + encodeURIComponent(n) + '&format=image&version=small';
/** Identifiant d'une ligne du scan : carte + langue. */
const scanId = (key, l) => key + '|' + (l || '');
/** Change la langue d'une ligne du scan ; si la carte existe déjà dans cette langue, les exemplaires s'y ajoutent. L'ordre de la liste est gardé. */
function scanSetLang(it, l) {
  if ((it.l || '') === l) return;
  const nid = scanId(it.key, l), other = SC.items.get(nid);
  if (other) { other.q = Math.min(999, other.q + it.q); if (!it.maybe) { other.maybe = false; other.shot = ''; } SC.items.delete(it.id); return; }
  it.l = l; const old = it.id; it.id = nid; SC.items = new Map([...SC.items].map(([i, v]) => (i === old ? [nid, v] : [i, v])));
}
function scanTotals() { let n = 0, maybe = 0; for (const e of SC.items.values()) { if (e.maybe) maybe++; else n += e.q; } return { n, maybe }; }
function scanAdd(m, d, maybe, shot) {
  const l = m.card || 'en', id = scanId(m.key, l), cur = SC.items.get(id);      // une ligne par carte ET par langue : la même carte lue en français puis en anglais fait deux lignes
  if (m.img && l !== 'en') { COLL.li[liKey(l, m.key)] = m.img; collMetaSave(); }       // image de la carte dans sa langue, vue pendant la lecture : gardée pour la collection
  if (cur) { cur.q = Math.max(1, cur.q + d); if (!maybe) { cur.maybe = false; cur.shot = ''; } else if (cur.maybe && shot) cur.shot = shot; if (m.score > cur.score) { cur.score = m.score; cur.raw = m.raw; } if (m.via) cur.via = m.via; }
  else SC.items.set(id, { id, key: m.key, name: m.name, q: Math.max(1, d), score: m.score, raw: m.raw, maybe: !!maybe, l, shot: maybe ? shot || '' : '', via: m.via || '' });      // via : langue trouvée par la recherche des autres langues
  scanPaintList();
}
/** Carte du scan pour la visionneuse (appui sur sa miniature) : image dans sa langue si Scryfall l'a donnée, sinon anglaise ; photo prise au scan si la carte est « à vérifier ». */
function scanViewItem(e) {
  const l = e.l || 'en', u = scanThumb(e), lang = l !== 'en' && COLL.li[liKey(l, e.key)] ? l : 'en', rn = scanReadNote(e, !!(e.raw && e.score < 0.97));
  return { key: e.key, lid: e.id || e.key, name: scanShown(e), ln: e.name, wl: l !== 'en' && lang === 'en' ? l : '', small: u, big: lang === 'en' ? 'https://api.scryfall.com/cards/named?exact=' + encodeURIComponent(e.name) + '&format=image&version=large' : '', lang, plain: true, shot: e.maybe ? e.shot || '' : '',
    extra: TN(e.q, '{n} exemplaire', '{n} exemplaires') + (e.maybe ? ' · ' + T('à vérifier') : '') + (l !== 'en' && lang === 'en' ? ' · ' + T('image anglaise (pas encore d\'image {lang})', { lang: LANGS[l] || l }) : '') + (rn ? ' · ' + rn : '') };
}
/** Texte lu d'une ligne du scan (« lu « … » ») ; carte trouvée dans une autre langue que celle de l'appli, tant qu'elle garde cette langue : « lu en italien ». h : échappement HTML. */
function scanReadNote(e, raw, h = x => x) {
  const v = e.via && e.via === e.l ? LANGS[e.via] || e.via : '';
  if (!v) return raw ? T('lu « {raw} »', { raw: h(e.raw || '') }) : '';
  return raw ? T('lu en {lang} : « {raw} »', { lang: v, raw: h(e.raw || '') }) : T('lu en {lang}', { lang: v });
}
/** Miniature d'une carte du scan : dans sa langue si Scryfall l'a donnée, sinon l'image anglaise. */
function scanThumb(e) { const u = e.l && e.l !== 'en' ? COLL.li[liKey(e.l, e.key)] : ''; return u || scImg(e.name); }
function scanPaintList() {
  const el = SC.el; if (!el) return;
  const list = $('.sc-list', el), arr = [...SC.items.values()].reverse(), t = scanTotals();
  if (document.activeElement && document.activeElement.matches && document.activeElement.matches('.lchip select') && list.contains(document.activeElement)) { SC.dirty = true; return; }      // un choix de langue est ouvert : on ne le ferme pas, la liste se met à jour après
  const th = u => (u ? `<img class="sc-th" alt="" src="${esc(u)}">` : '<span class="sc-th"></span>');
  const pend = SC.pend.map((p, k) => `<div class="sc-item pend" data-p="${p.id}">${th(p.thumb)}<span class="sc-n"><b>${T('Lecture…')}</b><small>${esc(p.label)}${k ? ' · ' + T('{n} avant', { n: k }) : ''}</small></span><span class="sc-spin" aria-hidden="true"></span></div>`).join('');
  const pic = u => (u ? `<span class="sc-pic"><img alt="${T('Ta photo')}" src="${esc(u)}"><i>${T('Ta photo')}</i></span>` : '');
  const miss = SC.miss.map(m => `<div class="sc-item miss" data-m="${m.id}">${pic(m.shot)}${th(m.thumb)}<span class="sc-n"><b>${esc(m.label)}</b><small>${T('Nom non reconnu')}${m.raw ? ' · ' + T('lu « {raw} »', { raw: esc(m.raw) }) : ''}</small></span><button type="button" class="btn ghost small" data-a="type">${T('Saisir')}</button><button type="button" class="sc-x" data-a="rm" aria-label="${T('Ignorer {name}', { name: esc(m.label) })}"><svg class="i"><use href="#i-close"/></svg></button></div>`).join('');
  if (SC.pm) {      // prix rapide : la liste montre des prix, rien à ajouter
    list.innerHTML = pend + miss + (SC.pq.length ? SC.pq.map(scanPriceRow).join('') : pend || miss ? '' : '<p class="hint sc-empty">' + T('Prix rapide : cadre une carte et appuie sur le cercle. Tu vois sa tendance Cardmarket et l\'offre CardTrader la moins chère ; rien n\'est ajouté à ta collection (le bouton + le fait si tu la gardes).') + '</p>');
    const go = $('.dv-foot [data-act="done"]', el); go.hidden = true; $('.dv-foot [data-act="close"]', el).textContent = T('Fermer');
    $('.sc-sub', el).textContent = SC.pq.length ? TN(SC.pq.length, 'Prix rapide · {n} carte lue', 'Prix rapide · {n} cartes lues') : T('Prix rapide · rien n\'est ajouté');
    const tot = $('.sc-total', el); tot.hidden = !SC.pq.length; if (SC.pq.length) tot.innerHTML = scanLotHtml(scanLot());
    const prog = $('.sc-prog', el); prog.hidden = !SC.pend.length; prog.textContent = T('Lecture : {n} en attente', { n: SC.pend.length });
    return;
  }
  { const go = $('.dv-foot [data-act="done"]', el); go.hidden = false; $('.dv-foot [data-act="close"]', el).textContent = T('Annuler'); $('.sc-total', el).hidden = true; }
  list.innerHTML = pend + miss + (arr.length ? arr.map(e => `<div class="sc-item${e.maybe ? ' maybe' : ''}" data-k="${esc(e.key)}" data-id="${esc(e.id)}">${e.maybe ? pic(e.shot) : ''}<img class="sc-th" alt="" loading="lazy" decoding="async" src="${esc(scanThumb(e))}"${zoomAt('scan', scanShown(e))}><span class="sc-n"><span class="sc-top"><b>${esc(scanShown(e))}</b>${langChip(e.key, e.l || '', e.name)}</span>${e.maybe ? `<small>${T(e.shot ? 'À vérifier : ta photo ci-dessus est-elle bien celle-ci ?' : 'À vérifier : ta carte est-elle bien celle-ci ?')} · ${scanReadNote(e, true, esc)}</small>` : (n => (n ? `<small>${n}</small>` : ''))(scanReadNote(e, !!(e.score < 0.97 && e.raw), esc))}</span>
      ${e.maybe ? `<button type="button" class="sc-ok" data-a="ok" aria-label="${T('Confirmer {name}', { name: esc(e.name) })}"><svg class="i"><use href="#i-check"/></svg></button>` : `<span class="qstep"><button type="button" data-a="dec" aria-label="${T('Retirer un exemplaire')}">−</button><b>${e.q}</b><button type="button" data-a="inc" aria-label="${T('Ajouter un exemplaire')}">+</button></span>`}
      <button type="button" class="sc-x" data-a="del" aria-label="${T('Retirer {name}', { name: esc(e.name) })}"><svg class="i"><use href="#i-close"/></svg></button></div>`).join('')
    : pend || miss ? '' : '<p class="hint sc-empty">' + T('Les cartes reconnues apparaîtront ici avec leur miniature Scryfall. Tu peux corriger les quantités avant d\'ajouter.') + '</p>');
  const go = $('.dv-foot [data-act="done"]', el);
  go.disabled = !t.n; go.textContent = t.n ? TN(t.n, 'Ajouter {n} carte', 'Ajouter {n} cartes') : T('Ajouter');
  $('.sc-sub', el).textContent = SC.items.size ? TN(t.n, '{n} reconnue', '{n} reconnues') + (t.maybe ? ' · ' + T('{n} à vérifier', { n: t.maybe }) : '') : T('Nom et mana dans la bande');
  const prog = $('.sc-prog', el); prog.hidden = !SC.pend.length; prog.textContent = T('Lecture : {n} en attente', { n: SC.pend.length });
  if (SC.recap) SC.recap();
}
/** Fiche récap au tap sur « Ajouter » : exemplaires, valeur estimée Cardmarket, les plus chères, nouvelles / déjà possédées, langues. Suit la liste du scan en direct ; « Ajouter » dans la fiche fait l'ajout. Les prix des cartes pas encore lues par Scryfall sont lus ici (un lot). */
function scanRecap() {
  const live = () => [...SC.items.values()].filter(x => !x.maybe).map(x => ({ k: x.key, n: x.name, q: x.q, l: x.l || '' }));
  if (!live().length || sheets.some(x => x.wrap.classList.contains('rc-sheet'))) return;
  const asked = new Set(), got = new Map(); let err = '', busy = false;
  const info = k => (got.has(k) ? got.get(k) : COLL.meta[k]);      // undefined : pas encore lu · null : inconnue de Scryfall · objet { eu, … }
  const api = openSheet(T('Ajouter'), '', a => { a.wrap.classList.add('rc-sheet'); a.body.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true); });      // les miniatures n'apparaissent qu'une fois chargées (classe ok)
  const paint = () => {
    if (!sheets.includes(api)) { if (SC.recap === hook) SC.recap = null; return; }
    const items = live(); if (!items.length) { api.close(); return; }
    const n = items.reduce((a, x) => a + x.q, 0);
    let val = 0, priced = 0, nopx = 0, wait = 0; const rows = [];
    for (const x of items) {
      const m = info(x.k);
      if (m === undefined) { if (!err) wait += x.q; else nopx += x.q; }
      else if (m && m.eu > 0) { val += m.eu * x.q; priced += x.q; rows.push({ x, eu: m.eu }); }
      else nopx += x.q;
    }
    const uniq = new Set(items.map(x => x.k)), haveK = new Set([...uniq].filter(k => collQty(k) > 0)), have = items.filter(x => haveK.has(x.k)), haveN = have.reduce((a, x) => a + x.q, 0), langs = new Map();
    for (const x of items) langs.set(x.l, (langs.get(x.l) || 0) + x.q);
    rows.sort((a, b) => b.eu - a.eu || byName(a.x, b.x));
    $('h2', api.wrap).textContent = TN(n, 'Ajouter {n} carte', 'Ajouter {n} cartes'); let sub = $('.sheet-head p', api.wrap);
    if (!sub) { sub = document.createElement('p'); $('.sheet-head > div', api.wrap).appendChild(sub); } sub.textContent = TN(uniq.size, '{n} carte différente', '{n} cartes différentes');
    const note = wait ? T('Lecture des prix…') : !nopx ? '' : err ? T(priced ? 'Valeur partielle : {err}.' : 'Prix indisponibles : {err}.', { err }) : TN(nopx, '{n} exemplaire sans prix Cardmarket, non comptés.', '{n} exemplaires sans prix Cardmarket, non comptés.');
    api.body.innerHTML = `<div class="rc"><div class="cs-tiles"><div><b>${nf0(uniq.size)}</b><span>${TN(uniq.size, 'carte différente', 'cartes différentes')}</span></div><div><b>${nf0(n)}</b><span>${TN(n, 'exemplaire', 'exemplaires')}</span></div><div class="rc-val"><b>${wait || (!priced && err) ? (wait ? '…' : '—') : priced ? esc(fmt(val, 'EUR')) : '—'}</b><span>${T('valeur estimée · tendance Cardmarket')}</span></div></div>
      ${note ? `<p class="hint rc-note">${esc(note)}</p>` : ''}
      ${rows.length && !wait ? `<h3 class="cs-h">${T('Les plus chères')}</h3><div class="cs-top">${rows.slice(0, 3).map(({ x, eu }) => `<div class="crow ro" data-k="${esc(x.k)}" data-n="${esc(x.n)}" data-q="${x.q}" data-ln="${esc(x.l)}"><span class="thumb" style="--h:${hash32(x.k) % 360}"${zoomAt('rc', x.n)}>${esc((x.n.trim()[0] || '?').toUpperCase())}<img alt="" loading="lazy" decoding="async" src="${esc(scanThumb({ key: x.k, name: x.n, l: x.l }))}"></span><span class="row-main"><span class="row-name">${esc(x.n)}</span><span class="row-meta">${x.q > 1 ? `<span class="tag accent">× ${nf0(x.q)}</span>` : ''}</span></span><span class="row-price"><b>${esc(fmt(eu, 'EUR'))}</b>${x.q > 1 ? `<small>${T('{p} le lot', { p: esc(fmt(eu * x.q, 'EUR')) })}</small>` : ''}</span></div>`).join('')}</div>` : ''}
      <dl class="rc-facts"><div><dt>${T('Nouvelles dans ta collection')}</dt><dd>${TN(uniq.size - haveK.size, '{n} carte', '{n} cartes')}</dd></div>
        <div><dt>${T('Déjà possédées')}</dt><dd>${haveK.size ? TN(haveK.size, '{n} carte', '{n} cartes') + ' · ' + T('+{n} ex.', { n: nf0(haveN) }) : T('aucune')}</dd></div>
        <div><dt>${T('Langues')}</dt><dd>${[...langs].sort((a, b) => b[1] - a[1]).map(([l, c]) => `${l ? esc(langCode(l)) : T('Langue ?')} × ${nf0(c)}`).join(' · ')}</dd></div></dl></div>`;
    api.setFoot(`<button class="btn ghost" type="button" data-close>${T('Retour')}</button><button class="btn" type="button" data-rc="go">${TN(n, 'Ajouter {n} carte', 'Ajouter {n} cartes')}</button>`);
  };
  const ask = async () => {
    if (busy || !sheets.includes(api)) return;
    const seen = new Set(), todo = live().filter(x => info(x.k) === undefined && !asked.has(x.k) && !seen.has(x.k) && seen.add(x.k)); if (!todo.length) return;
    todo.forEach(x => asked.add(x.k));
    if (scryLeft() > 0) { err = T('Scryfall demande une pause'); paint(); return; }
    busy = true;
    try { const r = await scryCollection(todo.map(x => x.n)); for (const x of todo) got.set(x.k, r.get(x.k) || null); err = ''; }
    catch (e) { err = T('Scryfall injoignable'); }
    busy = false; paint(); ask();
  };
  const hook = () => { paint(); ask(); };
  api.foot.addEventListener('click', e => {
    if (!e.target.closest('[data-rc="go"]')) return;
    const items = live(); if (!items.length) return;
    const before = COLL.map, n = items.reduce((a, x) => a + x.q, 0);
    collAdd(items, 'add'); api.close(); SC.recap = null; if (SC.el) SC.el.__close(); haptic('ok');
    toast(TN(n, '{n} carte ajoutée à ta collection', '{n} cartes ajoutées à ta collection'), { label: T('Annuler'), fn: () => { COLL.map = before; collChanged(); } });
    collEnrich();
  });
  SC.recap = hook; hook();
}
/* ── Prix rapide : lire une carte sans l'ajouter (bourse, échange, vide-grenier) ───────────────────────────────────────────
   Même lecture que l'ajout, mais la carte va dans une liste de prix : tendance Cardmarket (Scryfall) tout de suite, offre CardTrader la moins chère
   ensuite (une carte à la fois, dans sa langue), quantité déjà possédée. Un bouton ajoute la carte à la collection si on la garde. */
const SCP = { chain: Promise.resolve() };
function scanPriceMode(on) {
  SC.pm = !!on; const el = SC.el; if (!el) return;
  el.classList.toggle('pm', SC.pm); const b = $('.sc-pmode', el); if (b) b.setAttribute('aria-pressed', String(SC.pm));
  scanHint('', ''); scanPaintList();
}
/** Total estimé du lot lu en « prix rapide » : tendance Cardmarket (CM) et offres CardTrader les plus basses (CT, en euros), exemplaires compris. */
function scanLot() {
  const t = { n: 0, cm: 0, ct: 0, cmN: 0, ctN: 0, noCm: 0, noCt: 0, wait: false, ctOn: false };
  for (const e of SC.pq) {
    const k = e.n || 1; t.n += k;
    if (e.cm === undefined || e.cm === 'wait') t.wait = true; else if (Number.isFinite(e.cm)) { t.cm += e.cm * k; t.cmN++; } else t.noCm++;
    if (e.ct === 'off') continue;
    t.ctOn = true;
    if (e.ct === undefined || e.ct === 'wait' || e.ct === 'busy') t.wait = true; else if (e.ct && Number.isFinite(e.ct.p) && (!e.ct.c || e.ct.c === 'EUR')) { t.ct += e.ct.p * k; t.ctN++; } else t.noCt++;
  }
  return t;
}
function scanLotHtml(t) {
  const note = [TN(t.n, '{n} carte', '{n} cartes'), t.wait ? T('calcul…') : '', !t.wait && t.noCm ? T('{n} sans prix CM', { n: t.noCm }) : '', !t.wait && t.ctOn && t.noCt ? T('{n} sans offre CT', { n: t.noCt }) : ''].filter(Boolean).join(' · ');
  const part = (l, v, n) => `<span class="px ${l.toLowerCase()}"><i>${l}</i> <b>${n ? esc(fmt(v, 'EUR')) : '—'}</b></span>`;
  return `<small>${T('Lot : {note}', { note: esc(note) })}</small><span class="lot-v">${part('CM', t.cm, t.cmN)}${t.ctOn ? part('CT', t.ct, t.ctN) : ''}</span>`;
}
function scanPriceAdd(m) {
  const l = m.card || 'en'; let e = SC.pq.find(x => x.key === m.key);
  if (e) { SC.pq = [e, ...SC.pq.filter(x => x !== e)]; e.n = (e.n || 1) + 1; e.maybe = m.score < 0.84; e.raw = m.raw; e.l = l; if (e.cm === 'err') e.cm = undefined; }
  else { e = { key: m.key, name: m.name, l, maybe: m.score < 0.84, raw: m.raw, cm: undefined, ct: undefined, t: Date.now() }; SC.pq.unshift(e); if (SC.pq.length > 40) SC.pq.length = 40; }
  if (m.img && l !== 'en') { COLL.li[liKey(l, m.key)] = m.img; collMetaSave(); }
  scanPaintList(); scanPriceFetch(e);
}
async function scanPriceFetch(e) {
  if (e.cm === undefined) {
    e.cm = 'wait';
    try { const r = await scryCollection([e.name]), g = r.get(e.key); e.cm = g && g.eu > 0 ? g.eu : null; if (g && g.im) e.im = g.im; }
    catch (x) { e.cm = 'err'; }
    scanPaintList();
  }
  scanCtPrice(e);
}
/** Offre CardTrader la moins chère de la carte (dans sa langue), une lecture à la fois ; ne bouscule pas une recherche en cours. */
function scanCtPrice(e) {
  const cur = COLL.px[e.key], lang = e.l || S.opts.lang;
  if (S.demo || (!CTX.proxy && !CTX.token)) { e.ct = 'off'; scanPaintList(); return; }
  if (cur && Number.isFinite(cur.p) && Date.now() - cur.t < 6 * 3600e3 && !e.l) { e.ct = { p: cur.p, c: cur.c || 'EUR' }; scanPaintList(); return; }
  if (e.ct && e.ct !== 'err' && e.ct !== 'busy') return;
  e.ct = 'wait';
  SCP.chain = SCP.chain.then(async () => {
    if (!SC.el || !SC.pq.includes(e)) return;
    if (S.run && S.run.status === 'running') { e.ct = 'busy'; scanPaintList(); return; }
    try {
      readOpts(); const opts = { ...S.opts, lang, fallbackEn: false, skip: new Set(), fresh: false, push: null }; let off = null;
      await runLive([{ key: e.key, name: e.name, qty: 1 }], opts, { step() {}, progress() {}, rate() {}, hint() {}, cacheAge() {}, needsEn: () => false, card: (key, p) => { off = p.notFound ? null : cheapestOffer(p.offers, opts); } }, new AbortController().signal);
      e.ct = off ? { p: off.price, c: off.cur } : null;
    } catch (x) { e.ct = x && x.code === 'auth' ? 'auth' : 'err'; }
    scanPaintList();
  }).catch(() => { /* la file continue */ });
}
/** Nom affiché d'une ligne du scan : nom imprimé français si la carte est lue en FR et que le catalogue la connaît, sinon le nom anglais. */
const scanShown = e => frName(e.key, e.l) || e.name;
function scanPriceRow(e) {
  const th = scanThumb({ key: e.key, name: e.name, l: e.l }), own = collQty(e.key);
  const cm = e.cm === 'wait' || e.cm === undefined ? '<span class="px cm wait"><i>CM</i> <b>…</b></span>' : Number.isFinite(e.cm) ? `<span class="px cm"><i>CM</i> <b>${esc(fmt(e.cm, 'EUR'))}</b></span>` : e.cm === 'err' ? '<span class="px cm none"><i>CM</i> <b>' + T('indisponible') + '</b></span>' : '<span class="px cm none"><i>CM</i> <b>' + T('sans prix') + '</b></span>';
  const ct = e.ct === 'wait' || e.ct === undefined ? '<span class="px ct wait"><i>CT</i> <b>…</b></span>' : e.ct && e.ct.p != null ? `<span class="px ct"><i>CT</i> <b>${esc(fmt(e.ct.p, e.ct.c || 'EUR'))}</b></span>`
    : e.ct === 'off' ? '' : e.ct === 'busy' ? '<span class="px ct none"><i>CT</i> <b>' + T('recherche en cours') + '</b></span>' : e.ct === 'auth' ? '<span class="px ct none"><i>CT</i> <b>' + T('connexion requise') + '</b></span>' : e.ct === 'err' ? '<span class="px ct none"><i>CT</i> <b>' + T('indisponible') + '</b></span>' : '<span class="px ct none"><i>CT</i> <b>' + T('aucune offre') + '</b></span>';
  return `<div class="sc-item pr${e.maybe ? ' maybe' : ''}" data-k="${esc(e.key)}"><img class="sc-th" alt="" loading="lazy" decoding="async" src="${esc(th)}"${zoomAt('scan', scanShown(e))}><span class="sc-n"><span class="sc-top"><b>${esc(scanShown(e))}</b>${e.l ? flag(e.l) : ''}</span>${own || e.n > 1 ? `<span class="sc-meta">${e.n > 1 ? `<button type="button" class="tag accent sc-cnt" data-a="pdec" aria-label="${T('Ce lot compte {n} exemplaires de {name} : en retirer un', { n: e.n, name: esc(e.name) })}">× ${e.n} <span aria-hidden="true">−</span></button>` : ''}${own ? `<span class="tag good">${own > 1 ? T('× {n} possédée', { n: nf0(own) }) : T('possédée')}</span>` : ''}</span>` : ''}${e.maybe ? `<small>${T('À vérifier')} · ${T('lu « {raw} »', { raw: esc(e.raw || '') })}</small>` : ''}</span>
    <span class="row-px">${cm}${ct}</span>
    <button type="button" class="btn ghost small sc-keep" data-a="padd" aria-label="${T('Ajouter {name} à ma collection', { name: esc(e.name) })}">+</button><button type="button" class="sc-x" data-a="prm" aria-label="${T('Retirer {name} de la liste', { name: esc(e.name) })}"><svg class="i"><use href="#i-close"/></svg></button></div>`;
}
function scanHint(t, kind) {
  const h = $('.sc-hint', SC.el); if (!h) return; clearTimeout(SC.hintT);
  h.textContent = t || ''; h.dataset.k = kind || ''; h.hidden = !t;
  if (t && kind === 'ok') SC.hintT = setTimeout(() => { if (SC.el && h.textContent === t) { h.hidden = true; h.textContent = ''; } }, 2500);
}
function scanFlash() { const f = $('.sc-flash', SC.el); if (!f) return; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

/* ── Catalogue des noms français (data.js › scryFrCatalog) : chargé depuis l'appareil dès l'ouverture du scan, téléchargé une fois s'il manque ─── */
const FRC = { cat: null, at: 0, p: null, state: 'idle', done: 0, total: 0, err: '' };      // state : idle · run · ready · ask (réseau mobile : on demande) · err
const frcMetered = () => { try { const c = navigator.connection; return !!c && (c.saveData === true || c.type === 'cellular'); } catch (e) { return false; } };
async function frcWarm() {
  const l = namesLang(); if (!l) { FRC.state = 'idle'; frcPaint(); return; }      // cartes anglaises : aucun catalogue de noms imprimés
  namesSwitch(l);
  if (!FRC.cat) { const c = await scryFrCached(l).catch(() => null); if (c && !FRC.cat && FRX.l === l) { FRC.cat = frCatalog(c.rows, l); FRC.at = c.at; } }
  if (FRC.cat && Date.now() - FRC.at < FR_FRESH) { FRC.state = 'ready'; frcPaint(); frcNames(); return; }
  frcStart(false);
}
/** Charge (ou reprend, ou met à jour) le catalogue en arrière-plan : fichier du site (fr-names.tsv) d'abord, sinon pages Scryfall ; le scan sert déjà pendant ce temps (recherche réseau mot par mot). force : malgré le réseau mobile. */
/** Le catalogue vient d'arriver : les lignes FR déjà scannées passent sous leur nom imprimé. */
function frcNames() { if (SC.el && FRC.cat && FRC.cat.fr && FRC.cat.fr.size) scanPaintList(); }
function frcStart(force) {
  const l = namesLang(); if (!l) return null;
  namesSwitch(l);
  if (FRC.p) return FRC.p;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { FRC.state = FRC.cat ? 'ready' : 'err'; FRC.err = T('Hors ligne'); frcPaint(); return null; }
  FRC.state = 'run'; FRC.err = ''; FRC.done = 0; FRC.total = 0; frcPaint();
  const p = FRC.p = (async () => {
    if (!FRC.cat) { const st = await scryFrStatic(undefined, l).catch(() => null); if (FRX.l !== l) return; if (st) { FRC.cat = frCatalog(st.rows, l); FRC.at = st.at; FRC.state = 'ready'; return; } }      // fichier du site : petit, pas de question même en 4G
    if (!force && !FRC.cat && frcMetered()) { FRC.state = 'ask'; return; }
    const rec = await scryFrCatalog(null, (d, t) => { FRC.done = d; FRC.total = t; frcPaint(); }, l);
    if (FRX.l !== l) return;                                                           // langue changée pendant le téléchargement
    FRC.cat = frCatalog(rec.rows, l); FRC.at = rec.at; FRC.state = 'ready';
  })().catch(e => { if (FRX.l !== l) return; FRC.state = FRC.cat ? 'ready' : 'err'; FRC.err = e && e.code === 'rate' ? T('Scryfall demande une pause') : T('Téléchargement interrompu'); })
    .finally(() => { if (FRC.p === p) FRC.p = null; frcPaint(); frcNames(); });
  return p;
}
function frcPaint() {
  const el = SC.el && $('.sc-cat', SC.el); if (!el) return;
  const s = FRC.state, pct = FRC.total ? Math.min(99, Math.round(100 * FRC.done / FRC.total)) : 0;
  if (s === 'run' && !FRC.cat) { el.hidden = false; el.dataset.k = 'run'; el.innerHTML = `<span>${nmT('Catalogue des noms français : {pct} % · la lecture marche déjà, elle sera plus sûre ensuite', 'Catalogue des noms en {lang} : {pct} % · la lecture marche déjà, elle sera plus sûre ensuite', null, { pct })}</span><span class="track"><span class="fill" style="width:${pct}%"></span></span>`; }
  else if (s === 'ask' && !FRC.cat) { el.hidden = false; el.dataset.k = 'idle'; el.innerHTML = '<span>' + nmT('Pour lire les cartes françaises avec précision : catalogue des noms (≈ 15 à 20 Mo, une seule fois).', 'Pour lire les cartes en {lang} avec précision : catalogue des noms (≈ 15 à 20 Mo, une seule fois).') + '</span><button class="link-btn" type="button" data-act="frc">' + T('Télécharger') + '</button>'; }
  else if (s === 'err' && !FRC.cat) { el.hidden = false; el.dataset.k = 'err'; el.innerHTML = `<span>${nmT('{err}. Les cartes françaises restent lues, moins sûrement.', '{err}. Les cartes en {lang} restent lues, moins sûrement.', null, { err: esc(FRC.err || T('Catalogue indisponible')) })}</span><button class="link-btn" type="button" data-act="frc">${T('Réessayer')}</button>`; }
  else el.hidden = true;
}

/** Recherches Scryfall de noms français déjà faites (mots → résultats) : une carte qui reste dans le cadre ne relance pas de requête. */
const FR_CACHE = new Map();
async function frSearch(words, signal) {
  const k = words.map(w => w.toLowerCase()).join(' ');
  if (FR_CACHE.has(k)) return FR_CACHE.get(k);
  let res = []; try { res = await scryForeign(words, SCRY_LANG[FRX.l] || 'fr', signal); } catch (e) { if (e.name === 'AbortError') throw e; return []; }   // erreur réseau : pas mise en cache
  if (FR_CACHE.size > 400) FR_CACHE.clear(); FR_CACHE.set(k, res); return res;
}
/** Un texte lu (nom français probable) → { name (anglais), key, score, raw } ou null : mots longs cherchés chez Scryfall, puis nom imprimé comparé. */
async function frenchName(text, signal, quick) {
  const words = frWords(text);
  if (!words.length) return null;
  let res = await frSearch(words.slice(0, 2), signal);
  for (let i = 0; !quick && !res.length && words.length > 1 && i < Math.min(3, words.length); i++) res = await frSearch([words[i]], signal);   // un mot mal lu fait échouer la recherche à deux mots : on essaie chaque mot seul
  if (!res.length) return null;
  const fm = matchName(text, nameIndex(res.map(r => r.printed)), 0.72); if (!fm) return null;
  const hit = res.find(r => frontName(r.printed) === frontName(fm.name));
  return hit ? { name: hit.name, key: ownKey(hit.name), score: fm.score, raw: text, card: FRX.l, img: hit.img || '' } : null;
}
/** Texte lu → carte reconnue. Deux catalogues locaux comparés sur les mêmes lignes : noms français imprimés (catalogue Scryfall téléchargé) et noms anglais ;
 *  la lecture la plus sûre gagne, à égalité (nom identique dans les deux langues) le français. Catalogue français absent ou rien de sûr : repli sur la recherche Scryfall des noms imprimés. */
async function scanMatch(lines, cat, lang) {
  const en = bestMatch(lines, cat.idx); if (en) en.card = 'en';
  let m = bestOf(matchFr(lines, FRC.cat), en);
  if (lang !== 'eng' && (!m || m.score < 0.84) && (!FRC.cat || !m)) {      // moteur de la langue des noms (fra, deu…) : repli sur la recherche Scryfall des noms imprimés
    for (const l of lines.slice(0, FRC.cat ? 2 : 3)) {
      const fm = await frenchName(l.text, undefined, !!FRC.cat);
      if (fm && (!m || fm.score > m.score)) m = fm;
      if (m && m.score >= 0.84) break;
    }
  }
  return m;
}
/* ── Autres langues : nom ni dans le catalogue de la langue des noms ni en anglais (carte italienne lue avec l'appli en français) ──────────────
   Les lignes lues partent au serveur, qui les cherche dans les catalogues des autres langues (proxy.mjs › /api/names/find, une requête) : la carte trouvée
   garde sa langue (drapeau, image, exemplaire de la collection). Seulement quand rien n'est sûr : une carte de la langue de l'appli ou anglaise n'en déclenche pas. */
const OTH = { off: 0, memo: new Map() };      // off : heure jusqu'à laquelle le serveur n'est plus redemandé (route absente : serveur pas encore redémarré après une mise en ligne)
/** Petits mots de liaison des langues latines (di, del, de, der, el, do…). */
const LINK_WORDS = new Set(['di', 'del', 'della', 'delle', 'dello', 'dei', 'degli', 'dal', 'dalla', 'il', 'lo', 'gli', 'nel', 'nella', 'da', 'de', 'des', 'du', 'la', 'le', 'les', 'el', 'los', 'las', 'do', 'dos', 'das', 'der', 'die', 'den', 'dem', 'und', 'von', 'zu', 'zum', 'zur', 'al', 'en', 'em', 'com', 'con', 'per', 'sur', 'aux', 'au', 'ein', 'eine']);
/** Texte lu qui n'a pas l'air écrit dans la langue du nom reconnu (ref) : accents ou élision (l', dell'…) que ref n'a pas, ou un mot absent de ref qui est un mot de liaison
 *  ou finit par une voyelle (cognats : Foresta / Forest, Archivista / Archiviste, Erosione / Erosion). Mesuré sur les catalogues : 1,9 % des noms imprimés étrangers passent pour
 *  anglais à 0,84 ou plus, 79 % d'entre eux sous 0,92, dont 71 % repérés ici ; un nom anglais abîmé par la lecture (une lettre) n'est redemandé que 4 fois sur 100. */
function looksForeign(raw, ref) {
  const r = String(raw || ''), f = String(ref || ''), known = new Set(normPart(f).split(' ')), acc = /[À-ÖØ-öø-ÿ]/;
  return (acc.test(r) && !acc.test(f)) || (/(^|[\s-])(l|d|dell|all|nell|dall|sull|un)['’]\s*\p{L}/iu.test(r) && !/['’]/.test(f)) || normPart(r).split(' ').some(w => !known.has(w) && (LINK_WORDS.has(w) || (w.length >= 4 && /[aeio]$/.test(w))));
}
/** Lecture douteuse : reconnue de justesse (< 0,92) dans la langue des noms ou en anglais, sur un texte qui n'a pas l'air de cette langue : les autres langues d'abord (gardée si elles ne font pas mieux). */
const scanDoubt = m => !!m && m.score < 0.92 && looksForeign(m.raw, m.card === 'en' ? m.name : frName(m.key, m.card) || m.name);
/** Lignes lues → carte trouvée dans une autre langue (serveur) : { name, key, score, raw, card, img, via } ou null. st : budget de la carte (2 requêtes au plus). */
async function scanOther(lines, st) {
  if (Date.now() < OTH.off || !CTX.proxy || !(st.n < 2)) return null;
  const qs = [...new Set(lines.map(l => String(l.text || '').trim()).filter(t => t.length >= 3 && t.length <= 60 && (t.match(/[A-Za-zÀ-ÿ]/g) || []).length >= t.length * 0.6))].slice(0, 4);      // mêmes lignes que core.js › ocrMatches
  if (!qs.length) return null;
  const skip = FRC.cat ? FRC.cat.l || FRX.l : '', k = skip + '\n' + qs.join('\n');      // langue des noms déjà comparée sur l'appareil ; catalogue pas encore là : le serveur la cherche aussi
  if (OTH.memo.has(k)) return OTH.memo.get(k);
  st.n++; let hit = null;
  try {
    const r = await fetch('api/names/find?' + new URLSearchParams([...qs.map(q => ['q', q]), ['skip', skip]]), { headers: { Accept: 'application/json' } });
    if (!r.ok && !r.headers.get('retry-after') && r.status !== 400) { OTH.off = Date.now() + 5 * 60e3; return null; }      // serveur sans cette recherche (ancienne version, coupée) : redemandé 5 min plus tard ; 429 / occupé : la carte suivante redemande
    if (!r.ok) return null;
    const h = (await r.json()).hit;
    if (h && typeof h.name === 'string' && h.name && NAMES_LANGS.includes(h.lang) && h.score >= 0.72 && h.score <= 1) {
      const img = typeof h.img === 'string' && /^https:\/\/cards\.scryfall\.io\/[\w/.-]+$/.test(h.img) ? h.img : '';
      hit = { name: h.name, key: ownKey(h.name), score: h.score, raw: qs.includes(h.raw) ? h.raw : qs[0], card: h.lang, img, via: h.lang, ...(h.amb ? { amb: true } : {}) };
    }
  } catch (e) { return null; }      // hors ligne : rien de retenu
  if (OTH.memo.size > 200) OTH.memo.clear(); OTH.memo.set(k, hit);
  return hit;
}
/** Lit une zone « nom » : français d'abord (la plupart des cartes), puis anglais ; le texte lu est comparé aux noms français ET anglais (une carte anglaise lue par le moteur français est reconnue aussi).
 *  Rien de sûr (ou anglais douteux) : les mêmes lignes sont cherchées dans les autres langues (serveur). Polarité automatique puis inversée (texte clair sur fond sombre). S'arrête dès qu'un nom est sûr.
 *  st : { n } requêtes « autres langues » déjà faites pour cette carte. */
async function readNameAuto(src, box, outW, psm, cat, retry, st) {
  const langs = ocrLangs();
  let best = null, inv;
  for (let pass = 0; pass < (retry ? 2 : 1); pass++) {
    const c = prepCanvas(src, box, outW, pass ? (inv ? 0 : 1) : undefined); if (!pass) inv = c.inv;
    try {
      const read = [];
      for (const lang of langs) {
        if (!SC.el) return best;
        const lines = await ocrLines(c, lang, psm); read.push(...lines);
        if (!SC.raw) { const l = lines.find(x => String(x.text || '').replace(/[^\p{L}]/gu, '').length >= 3); if (l) SC.raw = String(l.text).trim().slice(0, 60); }      // premier texte lu de la carte : montré si le nom n'est pas reconnu
        const m = await scanMatch(lines, cat, lang);
        if (m && (!best || m.score > best.score)) { best = m; best.lang = lang; }
        if (best && best.score >= 0.84 && !scanDoubt(best)) return best;
      }
      if (st && SC.el) { const o = await scanOther(read, st); if (o && (!best || o.score > best.score)) { o.lang = langs[langs.length - 1]; best = o; } }
      if (best && best.score >= 0.84) return best;
    } finally { c.width = c.height = 0; }
  }
  return best;
}
/** Zone lue d'une photo de carte (portrait) : le tiers haut, là où se trouvent le nom et le mana. Le reste de l'image n'est jamais lu. */
const thirdBox = src => ({ x: 0, y: 0, w: src.naturalWidth || src.width, h: Math.round((src.naturalHeight || src.height) / 3) });
/** Une capture → meilleure lecture. Aperçu de l'app : la capture EST la bande « nom + mana » (lue entière, les symboles de mana sont ignorés), puis en texte épars si rien de sûr.
 *  Photo d'une carte entière (« Appareil », galerie) : bande du titre en haut, puis le tiers haut si rien de sûr ; le reste de l'image n'est jamais lu. */
async function readCard(src, cat, strip) {
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height, st = { n: 0 }; SC.raw = '';      // st : requêtes « autres langues » de cette carte (2 au plus)
  if (strip) {
    let m = await readNameAuto(src, { x: 0, y: 0, w: W, h: H }, 1400, '6', cat, true, st);
    if ((!m || m.score < 0.84) && SC.el) { const all = await readNameAuto(src, { x: 0, y: 0, w: W, h: H }, 1600, '11', cat, false, st); if (all && (!m || all.score > m.score)) m = all; }
    return m;
  }
  let m = await readNameAuto(src, { x: Math.round(W * 0.04), y: Math.round(H * 0.01), w: Math.round(W * 0.92), h: Math.round(H * 0.17) }, 1100, '6', cat, true, st);
  for (const [psm, retry] of [['6', true], ['11', false]]) {      // tiers haut : un bloc de texte d'abord, texte épars en dernier recours
    if ((m && m.score >= 0.84) || !SC.el) break;
    const t = await readNameAuto(src, thirdBox(src), 1600, psm, cat, retry, st); if (t && (!m || t.score > m.score)) m = t;
  }
  return m;
}

/* — File d'attente : les photos sont lues une par une en arrière-plan — */
/** Vignette minuscule (≈ 3 Ko) de la zone lue (box : tiers haut d'une photo), pour reconnaître une photo dans la liste. */
function thumbOf(src, box) {
  try {
    const W = box ? box.w : src.naturalWidth || src.width, H = box ? box.h : src.naturalHeight || src.height, k = Math.min(100 / H, 140 / W), c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(W * k)); c.height = Math.max(8, Math.round(H * k));
    if (box) c.getContext('2d').drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height); else c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const u = c.toDataURL('image/jpeg', 0.55); c.width = c.height = 0; return u;
  } catch (e) { return ''; }
}
/** Zone du titre d'une photo de carte entière (portrait) : la même que celle lue en premier. */
const titleBox = src => { const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height; return { x: Math.round(W * 0.04), y: Math.round(H * 0.01), w: Math.round(W * 0.92), h: Math.round(H * 0.17) }; };
/** Photo de la zone lue en bonne qualité (≈ 720 px de large, JPEG) : montrée au-dessus des cartes « à vérifier » ou non reconnues pour savoir de quelle carte il s'agit. Reste en mémoire le temps du scan, jamais enregistrée. */
function shotOf(src, box) {
  try {
    const W = box ? box.w : src.naturalWidth || src.width, H = box ? box.h : src.naturalHeight || src.height, k = Math.min(1, 720 / W), c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(W * k)); c.height = Math.max(8, Math.round(H * k));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    if (box) x.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height); else x.drawImage(src, 0, 0, c.width, c.height);
    const u = c.toDataURL('image/jpeg', 0.82); c.width = c.height = 0; return u;
  } catch (e) { return ''; }
}
/** Libère la mémoire d'une photo lue (canvas vidé, image détachée) : rien n'est gardé. */
function scanFree(src) {
  try { if (!src) return; if (src.getContext) src.width = src.height = 0; else if (src.removeAttribute) src.removeAttribute('src'); } catch (e) { /* ignore */ }
}
/** job : { label, src | file, thumb } (src : canvas déjà prêt ; file : image à décoder au moment de la lire, pour ne pas garder 20 photos en mémoire). */
function scanEnqueue(job) {
  job.id = ++SC.mid; job.s = SC.session;
  SC.pend.push({ id: job.id, label: job.label, thumb: job.thumb || '' }); SC.queue.push(job); scanPaintList(); scanWork();
}
async function scanWork() {
  if (SC.working) return; SC.working = true;
  try {
    while (SC.queue.length && SC.el) {
      const job = SC.queue.shift(), t0 = performance.now(); let m = null, fail = '';
      try {
        if (!job.src && job.file) { const img = await loadImage(job.file); job.src = img; job.thumb = thumbOf(img, thirdBox(img)); }
        m = await readCard(job.src, await collCatalog(), job.strip);
        if (!m || m.score < 0.84) job.shot = shotOf(job.src, job.strip ? null : titleBox(job.src));      // lecture douteuse : on garde une photo lisible de la zone pour comparer
      } catch (e) { fail = e && e.code === 'cdn' ? T('Le module de lecture (OCR) n\'a pas pu être téléchargé. Vérifie ta connexion.') : e && e.code === 'rate' ? T('Scryfall demande une pause…') : ''; }
      scanFree(job.src); job.src = null; job.file = null;
      if (!SC.el || job.s !== SC.session) continue;
      SC.ms = performance.now() - t0; SC.pend = SC.pend.filter(p => p.id !== job.id);
      if (m && m.score >= 0.72) { if (SC.pm) scanPriceAdd(m); else scanAdd(m, 1, m.score < 0.84, job.shot); haptic('ok'); scanHint(m.score >= 0.84 ? '✓ ' + m.name : T('À vérifier : {name}', { name: m.name }), m.score >= 0.84 ? 'ok' : 'busy'); }
      else { SC.miss.push({ id: job.id, label: job.label, thumb: job.thumb || '', shot: job.shot || '', raw: (m && m.raw) || SC.raw || '' }); if (fail) scanHint(fail, 'bad'); scanPaintList(); }
    }
  } finally { SC.working = false; SC.workEnd = performance.now(); }
}

/* — Appareil photo : aperçu simple, le cercle prend la photo — */
/** Bande « nom + mana » (le guide à l'écran) en pixels de la vidéo. */
function scanGuideBox() {
  const v = $('.sc-video', SC.el), stage = $('.sc-stage', SC.el), g = $('.sc-guide', SC.el);
  if (!v || !v.videoWidth) return null;
  const s = stage.getBoundingClientRect(), r = g.getBoundingClientRect();
  return coverMap(s.width, s.height, v.videoWidth, v.videoHeight, { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height });
}
function scanCapture() {
  if (!SC.el) return;
  if (NAT.on) {
    if (SC.queue.length >= 12) { toast(T('Patiente un instant : 12 cartes sont déjà en attente de lecture')); return; }
    haptic('tap'); scanFlash(); scanHint('', '');
    natCapture().then(c => { if (SC.el) scanEnqueue({ label: T('Carte {n}', { n: ++SC.cap }), src: c, strip: true, thumb: thumbOf(c) }); }, () => scanHint(T('L\'appareil photo n\'est pas prêt : utilise « Photos » ou « Appareil »'), 'bad'));
    return;
  }
  const box = scanGuideBox(); if (!box) { toast(T('L\'appareil photo n\'est pas prêt : utilise « Photos » ou « Appareil »')); return; }
  if (SC.rbusy) { toast(T('La caméra redémarre, une seconde…')); return; }
  if (SC.queue.length >= 12) { toast(T('Patiente un instant : 12 cartes sont déjà en attente de lecture')); return; }
  const c = document.createElement('canvas'); c.width = box.w; c.height = box.h;
  c.getContext('2d').drawImage($('.sc-video', SC.el), box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  haptic('tap'); scanFlash(); scanHint('', '');
  scanEnqueue({ label: T('Carte {n}', { n: ++SC.cap }), src: c, strip: true, thumb: thumbOf(c) });
}
function scanFail(msg) { scanHint(msg, 'bad'); }
/** Pas d'aperçu : la vraie cause remplace le message générique au centre de la zone, et rien dans la bande d'aide (deux messages qui se contredisaient). */
function scanNoCam(stage, msg) { stage.dataset.cam = 'no'; const p = $('.sc-nocam', stage); if (p) p.textContent = msg; scanHint('', ''); }
/** Aperçu qui rame (caméra du navigateur qui s'essouffle) : on la redémarre (2 fois), puis 2 fois en qualité réduite (720p), puis conseil « Appareil » (l'appareil photo du téléphone). Le compteur repart à zéro après 20 s d'aperçu fluide.
 *  Pendant une lecture (OCR) et 3,5 s après, le téléphone est occupé : ça ne compte pas, la caméra n'y est pour rien. */
function scanWatch(v) {
  if (window.__noFpsWatch || !v.requestVideoFrameCallback) return;
  const el = SC.el, gen = SC.gen, t0 = performance.now(), w = SC.watch = makeFpsWatch(SC.fpsMin, 3000, 2000), wd = makeFpsWatch(0, 1e9, 2000); SC.fps = 0;      // w décide, wd ne fait qu'afficher les i/s
  const tick = now => {
    if (SC.el !== el || SC.gen !== gen || !SC.stream) return;
    SC.fps = wd.feed(now).fps;
    if (SC.working || SC.warm || now - SC.workEnd < 3500 || now - t0 < 2500) w.reset();      // + 2,5 s de mise en route de la caméra (toujours saccadée au démarrage)
    else if (w.feed(now).low) scanSlow();
    v.requestVideoFrameCallback(tick);
  };
  v.requestVideoFrameCallback(tick);
}
async function scanSlow() {
  if (!SC.el || SC.rbusy) return;
  const rf = SC.rf, now = performance.now(); if (now - rf.at > 20000) rf.n = 0;      // l'aperçu est resté fluide un moment : on repart de zéro
  rf.n++; rf.at = now; SC.slowN++;
  if (rf.n <= 4) { if (rf.n === 3) camSetSlow(true); scanHint(rf.n === 3 ? T('Caméra lente : redémarrage en qualité réduite…') : T('Aperçu qui rame : la caméra redémarre…'), 'busy'); await camRefresh(); }      // 2 redémarrages normaux, puis 2 en 720p
  else {
    const n = $('.sc-native', SC.el); if (n) n.classList.add('hot');
    scanHint(T('La caméra du navigateur est lente sur cet appareil : utilise « Appareil » (appareil photo du téléphone)'), 'bad');
  }
}
/** Redémarre la caméra (arrêt complet puis réouverture, résolution lue dans l'indicateur « lent ») : remet à zéro un flux qui s'est dégradé. */
async function camRefresh() {
  if (!SC.el || SC.rbusy) return; SC.rbusy = true;
  const el = SC.el, v = $('.sc-video', el), stage = $('.sc-stage', el);
  try {
    SC.gen++; if (SC.stream) SC.stream.getTracks().forEach(t => t.stop());      // une seule session par caméra : on libère avant de rouvrir (l'image reste figée à l'écran)
    let s = null;
    for (let i = 0; i < 3 && !s; i++) { await new Promise(r => setTimeout(r, i ? 500 : 200)); if (SC.el !== el) return; try { s = await camOpen(camSlow()); } catch (e) { if (i === 2) throw e; } }
    if (SC.el !== el) { s.getTracks().forEach(t => t.stop()); return; }
    SC.stream = s; SC.restarts++; v.srcObject = s; await v.play().catch(() => {});
    scanHint(CAM_HINT, ''); scanWatch(v);
  } catch (e) {
    if (SC.el === el) scanNoCam(stage, T('La caméra n\'a pas pu redémarrer. Utilise « Appareil » ou « Photos ».'));
  } finally { SC.rbusy = false; }
}
/** Écran de diagnostic (5 appuis sur le titre) : fluidité de l'aperçu, résolution réelle, durée de la dernière lecture, tâches longues du navigateur. */
function scanDiag(on) {
  const box = $('.sc-diag', SC.el); if (!box) return; clearInterval(SC.diagT); box.hidden = !on; if (!on) return;
  if (!SC.ltObs && typeof PerformanceObserver !== 'undefined') { try { SC.ltObs = new PerformanceObserver(l => { for (const e of l.getEntries()) SC.lt.push(performance.now()); }); SC.ltObs.observe({ type: 'longtask', buffered: false }); } catch (e) { SC.ltObs = null; } }
  const paint = () => {
    const tr = SC.stream && SC.stream.getVideoTracks()[0], st = (tr && tr.getSettings && tr.getSettings()) || {}, now = performance.now(); SC.lt = SC.lt.filter(t => now - t < 10000);
    box.textContent = [T('aperçu {n} i/s', { n: SC.fps ? SC.fps.toFixed(0) : '–' }), `${st.width || '?'}×${st.height || '?'}${st.frameRate ? ' @' + Math.round(st.frameRate) : ''}`, SC.fixed ? T('plancher 24 i/s') : T('i/s libre'), T('redémarrages {n}', { n: SC.restarts }), T('dernière lecture {n} ms', { n: SC.ms ? Math.round(SC.ms) : '–' }), T('tâches longues {n}/10 s', { n: SC.lt.length }), camSlow() ? T('mode lent (toucher ici : retour au mode normal)') : '', tr && tr.label ? tr.label : ''].filter(Boolean).join(' · ');
  };
  box.onclick = () => { camSetSlow(false); paint(); };
  paint(); SC.diagT = setInterval(paint, 500);
}
/** Ouvre la caméra avec un plancher de 24 i/s : en lumière faible, l'exposition automatique ralentit sinon l'image (15 i/s ou moins sur certains téléphones). Si l'appareil refuse ce plancher, simple préférence de 30 i/s. */
async function camOpen(slow) {
  const base = { facingMode: { ideal: 'environment' }, width: { ideal: slow ? 1280 : 1920 }, height: { ideal: slow ? 720 : 1080 } };
  let err;
  for (const fr of [{ min: 24, ideal: 30 }, { ideal: 30 }]) {
    try { const s = await navigator.mediaDevices.getUserMedia({ video: { ...base, frameRate: fr }, audio: false }); SC.fixed = !!fr.min; return s; }
    catch (e) { err = e; if (e && /^(NotAllowed|NotFound|Security|Abort|NotReadable)/.test(e.name)) throw e; }
  }
  throw err;
}
/** Prépare la lecture pendant que tu cadres la première carte : catalogue des noms, moteur OCR (puis le français si c'était la dernière langue lue).
 *  Sans ça, le premier appui attend le téléchargement et le démarrage du moteur (1 à plusieurs secondes). Compte comme « occupé » pour la surveillance de l'aperçu. */
async function scanWarm() {
  const s = SC.session; if (!SC.el || SC.warm) return; SC.warm = true;
  try {
    await Promise.all([collCatalog(), frcWarm()]);
    if (!SC.el || SC.session !== s || natOcr()) return; await ocrWorker(ocrLangs()[0]);      // appli Android : ML Kit, pas de moteur à télécharger      // français d'abord : l'anglais ne se charge que si le français ne trouve rien
  } catch (e) { /* hors ligne ou CDN bloqué : le premier appui retentera et dira pourquoi */ }
  finally { SC.warm = false; SC.workEnd = performance.now(); }
}
const CAM_HINT = T('Cadre le haut de la carte : le nom et le mana dans la bande, puis appuie sur le cercle. Tu peux enchaîner');
/* — Appli Android (Capacitor) : appareil photo natif, comme les applis photo (aperçu Camera1 du plugin camera-preview placé derrière la page, sous la bande du guide),
   et lecture du texte par ML Kit sur le téléphone. Dans un navigateur ou la PWA : getUserMedia + Tesseract, inchangés. — */
const NAT = { on: false };
function capPlugin(n) {
  try { const C = typeof window !== 'undefined' && window.Capacitor; return C && C.isNativePlatform && C.isNativePlatform() && C.isPluginAvailable && C.isPluginAvailable(n) && C.Plugins && C.Plugins[n] || null; } catch (e) { return null; }
}
const natCam = () => capPlugin('CameraPreview'), natOcr = () => capPlugin('CapacitorPluginMlKitTextRecognition');
async function natStart() {
  const cam = natCam(), el = SC.el, stage = el && $('.sc-stage', el); if (!cam || !stage) return false;
  if (NAT.p) { try { await NAT.p; } catch (e) { /* ignore */ } }      // un démarrage précédent encore en cours : on l'attend (« caméra déjà démarrée » sinon)
  // L'aperçu natif ne se déplace plus une fois posé : on mesure la zone écran ouvert (transition de 0,3 s finie) et bandeau de pub retiré.
  for (let i = 0; i < 20 && SC.el === el && (!el.classList.contains('on') || document.documentElement.classList.contains('ad-on')); i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, reduceMotion() ? 0 : 320));
  if (SC.el !== el) return true;
  const r = stage.getBoundingClientRect();
  document.documentElement.classList.add('nat-cam');      // page transparente au-dessus de l'aperçu natif
  try {
    NAT.p = cam.start({ position: 'rear', toBack: true, x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), disableAudio: true, enableZoom: true, lockAndroidOrientation: true });
    await NAT.p;
    if (SC.el !== el) { await natHalt(); return true; }      // scan fermé pendant le démarrage : la caméra ne doit pas rester allumée
    NAT.on = true; stage.dataset.cam = 'on'; stage.dataset.native = '1'; return true;
  } catch (e) { await natHalt(); return false; }      // démarrage raté : aperçu, page transparente et orientation verrouillée défaits, sinon le repli web et le prochain start (« caméra déjà démarrée ») échouent
  finally { NAT.p = null; }
}
/** Arrêt de la caméra native, que l'aperçu soit déjà affiché ou encore en train de démarrer. */
async function natHalt() { NAT.on = false; document.documentElement.classList.remove('nat-cam'); try { await natCam().stop(); } catch (e) { /* déjà arrêtée */ } }
function natStop() {
  document.documentElement.classList.remove('nat-cam');
  if (NAT.p) { const p = NAT.p; p.then(() => natHalt(), () => {}); return; }      // en cours de démarrage : arrêt dès qu'elle a démarré
  if (!NAT.on) return; natHalt();
}
/** Image de l'aperçu natif → bande du guide (même recadrage que l'aperçu : remplissage centré), en canvas. */
async function natCapture() {
  const res = await natCam().captureSample({ quality: 90 });
  const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible')); i.src = 'data:image/jpeg;base64,' + res.value; });
  const stage = $('.sc-stage', SC.el), s = stage.getBoundingClientRect(), g = $('.sc-guide', SC.el).getBoundingClientRect();
  let src = img, W = img.naturalWidth, H = img.naturalHeight;
  // Le plugin rend l'image déjà tournée comme l'écran (portrait en portrait). Seulement si elle arrivait encore couchée par rapport à l'ÉCRAN (ni à la bande, toujours plus large que haute, ni à la fenêtre, plus large que haute en écran partagé haut/bas), on la redresse.
  const so = screen.orientation && screen.orientation.type, land = so ? so.startsWith('landscape') : screen.width > screen.height;
  if ((W > H) !== land) {
    const c = document.createElement('canvas'); c.width = H; c.height = W; const x = c.getContext('2d'); x.translate(H, 0); x.rotate(Math.PI / 2); x.drawImage(img, 0, 0); src = c; W = c.width; H = c.height;
  }
  const box = coverMap(s.width, s.height, W, H, { x: g.left - s.left, y: g.top - s.top, w: g.width, h: g.height });
  const c = document.createElement('canvas'); c.width = box.w; c.height = box.h;
  c.getContext('2d').drawImage(src, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  scanFree(src); return c;
}
/** ML Kit : toutes les lignes lues, en une passe (l'alphabet latin couvre le français et l'anglais). */
async function natLines(canvas) {
  const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  const r = await natOcr().detectText({ base64Image: b64, rotation: 0 });
  return ((r && r.blocks) || []).flatMap(b => (b.lines || []).map(l => ({ text: String(l.text || '').trim() }))).filter(l => l.text);
}

async function scanCamera() {
  const stage = $('.sc-stage', SC.el);
  if (natCam() && await natStart()) { if (SC.el) scanHint(CAM_HINT, ''); return; }      // appli Android : caméra native
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || (typeof isSecureContext !== 'undefined' && !isSecureContext)) { scanNoCam(stage, T('Appareil photo indisponible ici (il demande https). Utilise « Photos » ou « Appareil ».')); return; }
  try {
    SC.stream = await camOpen(camSlow());      // appareil déjà repéré comme lent : on repart en 720p
    if (!SC.el) { SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; return; }
    const v = $('.sc-video', SC.el); v.srcObject = SC.stream; await v.play().catch(() => {});
    stage.dataset.cam = 'on'; scanHint(CAM_HINT, ''); scanWatch(v);      // aucun calcul pendant l'aperçu : le moteur de lecture ne démarre qu'au premier appui
  } catch (e) {
    scanNoCam(stage, e && e.name === 'NotAllowedError' ? T('Accès à l\'appareil photo refusé : autorise-le dans les réglages du navigateur, ou utilise « Photos ».') : e && e.name === 'NotFoundError' ? T('Aucun appareil photo trouvé. Utilise « Photos ».') : T('Appareil photo indisponible. Utilise « Photos ».'));
  }
}

/* — Photos — */
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Image illisible')); };
    img.src = url;
  });
}
/** Photos prises avec « Appareil » (cam : appareil photo du téléphone) ou choisies dans la galerie : une carte par photo, lues l'une après l'autre en arrière-plan. */
function scanPhotos(files, cam) {
  const list = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  if (cam && SC.queue.length + list.length > 12) { toast(T('Patiente un instant : 12 cartes sont déjà en attente de lecture')); return; }
  list.forEach((f, i) => scanEnqueue({ label: cam ? T('Carte {n}', { n: ++SC.cap }) : T('Photo {n}', { n: i + 1 }) + (f.name && f.name.length <= 24 ? ' · ' + f.name : ''), file: f }));
}

function closeScan() { if (SC.el) SC.el.__close(); }
function openScan() {
  closeScan();
  const wrap = document.createElement('div'); wrap.className = 'dv scan'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', T('Scanner des cartes'));
  wrap.innerHTML = `<header class="dv-head"><button class="icon-btn dv-back" type="button" data-act="close" aria-label="${T('Fermer le scan')}"><svg class="i"><use href="#i-back"/></svg></button>
      <div class="dv-title"><b>${T('Scanner des cartes')}</b><span class="sc-sub">${T('Nom et mana dans la bande')}</span></div><button class="icon-btn sc-pmode" type="button" data-act="pmode" aria-label="${T('Prix rapide : lire une carte sans l\'ajouter')}" aria-pressed="false">€</button><button class="icon-btn sc-help" type="button" data-act="note" aria-label="${T('Afficher l\'aide')}" aria-pressed="false">?</button></header>
    <div class="sc-stage" data-cam="wait"><video class="sc-video" playsinline muted autoplay></video>
      <div class="sc-guide" aria-hidden="true"><span class="sc-cap">${T('Nom · mana')}</span></div>
      <div class="sc-flash"></div>
      <p class="sc-hint" hidden></p><p class="sc-prog" hidden></p><p class="sc-diag" hidden></p>
      <p class="sc-nocam">${T('Pas d\'appareil photo : utilise « Photos » ou « Appareil » ci-dessous.')}</p></div>
    <footer class="dv-foot"><button class="btn ghost" type="button" data-act="close">${T('Annuler')}</button><div class="sc-total" aria-live="polite" hidden></div><button class="btn" type="button" data-act="done" disabled>${T('Ajouter')}</button></footer>
    <div class="sc-cat coll-status" hidden></div>
    <div class="sc-note"><p class="hint">${nmT('Cadre le haut de chaque carte (nom + mana) et appuie sur le cercle : la lecture se fait en arrière-plan, enchaîne sans attendre. Seul le nom est lu, le mana est ignoré (français d\'abord, puis anglais) puis retrouvé dans Scryfall : vérifie la miniature (appuie dessus pour la voir en grand). Les photos ne sont jamais enregistrées. « Appareil » ouvre l\'appareil photo du téléphone (si l\'aperçu saccade) : photo de la <b>carte entière en portrait</b>, nom et mana dans le <b>tiers haut</b> de l\'image (le reste n\'est pas lu) ; « Photos » : ta galerie.',
      'Cadre le haut de chaque carte (nom + mana) et appuie sur le cercle : la lecture se fait en arrière-plan, enchaîne sans attendre. Seul le nom est lu, le mana est ignoré ({lang} d\'abord, puis anglais) puis retrouvé dans Scryfall : vérifie la miniature (appuie dessus pour la voir en grand). Les photos ne sont jamais enregistrées. « Appareil » ouvre l\'appareil photo du téléphone (si l\'aperçu saccade) : photo de la <b>carte entière en portrait</b>, nom et mana dans le <b>tiers haut</b> de l\'image (le reste n\'est pas lu) ; « Photos » : ta galerie.',
      'Cadre le haut de chaque carte (nom + mana) et appuie sur le cercle : la lecture se fait en arrière-plan, enchaîne sans attendre. Seul le nom est lu, le mana est ignoré (en anglais) puis retrouvé dans Scryfall : vérifie la miniature (appuie dessus pour la voir en grand). Les photos ne sont jamais enregistrées. « Appareil » ouvre l\'appareil photo du téléphone (si l\'aperçu saccade) : photo de la <b>carte entière en portrait</b>, nom et mana dans le <b>tiers haut</b> de l\'image (le reste n\'est pas lu) ; « Photos » : ta galerie.')}</p><button class="sc-x" type="button" data-act="note" aria-label="${T('Fermer l\'aide')}"><svg class="i"><use href="#i-close"/></svg></button></div>
    <div class="dv-scroll sc-list"></div>
    <div class="sc-bar">
      <label class="btn ghost small sc-photo"><svg class="i"><use href="#i-image"/></svg>${T('Photos')}<input type="file" id="scFile" accept="image/*" multiple></label>
      <button class="sc-shot" type="button" data-act="shot" aria-label="${T('Prendre la photo de la carte')}"><i></i></button>
      <label class="btn ghost small sc-native"><svg class="i"><use href="#i-camera"/></svg>${T('Appareil')}<input type="file" id="scCam" accept="image/*" capture="environment"></label></div>`;
  SC.recap = null; SC.el = wrap; SC.pm = false; SC.pq = []; SC.items = new Map(); SC.miss = []; SC.pend = []; SC.queue = []; SC.cap = 0; SC.session++; SC.slowN = 0; SC.restarts = 0; SC.rf = { n: 0, at: 0 }; SC.alive = true; SC.warm = false; try { localStorage.removeItem('deckdeal:scpref'); } catch (e) { /* ignore */ } const prevFocus = document.activeElement;
  const stop = () => { SC.alive = false; SC.warm = false; clearInterval(SC.diagT); clearTimeout(SC.hintT); SC.queue.forEach(j => scanFree(j.src)); SC.queue = []; SC.pend = []; if (SC.stream) { SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; } natStop(); };
  const onKey = e => { if (e.key === 'Escape' && !imgView && !sheets.length) { e.stopPropagation(); wrap.__close(); } };
  wrap.__close = () => {
    if (SC.el !== wrap) return; SC.el = null; stop(); document.removeEventListener('keydown', onKey, true);
    wrap.classList.remove('on'); setTimeout(() => wrap.remove(), reduceMotion() ? 0 : 240); releaseApp();
    try { if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('error', e => { if (e.target && e.target.classList && e.target.classList.contains('sc-th')) e.target.classList.add('bad'); }, true);
  $('#scFile', wrap).onchange = e => { scanPhotos(e.target.files); e.target.value = ''; };
  $('#scCam', wrap).onchange = e => { scanPhotos(e.target.files, true); e.target.value = ''; };
  { let taps = 0, t0 = 0; $('.dv-title', wrap).onclick = () => { const n = performance.now(); taps = n - t0 < 2500 ? taps + 1 : 1; t0 = n; if (taps >= 5) { taps = 0; scanDiag($('.sc-diag', wrap).hidden); } }; }
  wrap.addEventListener('change', e => {
    const sel = e.target.closest && e.target.closest('.lchip select'); if (!sel) return;
    const it = SC.items.get(scanId(sel.dataset.lk, sel.closest('.lchip').dataset.l)); if (!it) return;
    const l = sel.value; haptic('tap'); sel.blur(); SC.dirty = false; scanSetLang(it, l); scanPaintList(); langImgFor(it.key, it.name, l);
  });
  wrap.addEventListener('focusout', e => { if (SC.dirty && e.target.matches && e.target.matches('.lchip select')) setTimeout(() => { SC.dirty = false; scanPaintList(); }, 0); });
  wrap.addEventListener('click', e => {
    if (e.target.closest('.lchip')) return;
    const b = e.target.closest('[data-act]');
    if (b) {
      const act = b.dataset.act;
      if (act === 'close') wrap.__close();
      else if (act === 'shot') scanCapture();
      else if (act === 'frc') frcStart(true);
      else if (act === 'note') scNoteShow($('.sc-note', wrap).hidden);
      else if (act === 'pmode') { haptic('tap'); scanPriceMode(!SC.pm); }
      else if (act === 'done') scanRecap();
      return;
    }
    if (SC.pm && e.target.closest('.sc-item.pr [data-a]')) {                      // liste de prix : garder la carte (+) ou la retirer de la liste
      const a = e.target.closest('[data-a]'), k = a.closest('.sc-item').dataset.k, it = SC.pq.find(x => x.key === k); if (!it) return;
      haptic('tap');
      if (a.dataset.a === 'pdec') { it.n = Math.max(1, (it.n || 1) - 1); scanPaintList(); }
      else if (a.dataset.a === 'padd') { const nn = it.n || 1, lang = it.l || ''; collBump(k, it.name, nn, { lang }); collEnrich(); toast(nn > 1 ? T('{n} × {name} ajoutées à ta collection', { n: nn, name: it.name }) : T('{name} ajoutée à ta collection', { name: it.name }), { label: T('Annuler'), fn: () => collBump(k, it.name, -nn, { lang }) }); scanPaintList(); }
      else { SC.pq = SC.pq.filter(x => x !== it); scanPaintList(); }
      return;
    }
    const a = e.target.closest('[data-a]'); if (!a) return;
    const row = a.closest('.sc-item'); if (!row) return;
    if (row.dataset.m) {
      haptic('tap');
      if (a.dataset.a === 'type') openCollAdd();
      else { SC.miss = SC.miss.filter(m => String(m.id) !== row.dataset.m); scanPaintList(); }
      return;
    }
    const it = SC.items.get(row.dataset.id); if (!it) return;
    haptic('tap');
    if (a.dataset.a === 'inc') it.q = Math.min(999, it.q + 1);
    else if (a.dataset.a === 'dec') {                       // « − » : confirmation d'abord
      confirmMinus(it.name, it.q, 'scan', () => { const c = SC.items.get(it.id); if (!c) return; if (c.q > 1) c.q--; else SC.items.delete(c.id); scanPaintList(); });
      return;
    }
    else if (a.dataset.a === 'ok') { it.maybe = false; it.shot = ''; }
    else if (a.dataset.a === 'del') SC.items.delete(it.id);
    scanPaintList();
  });
  scNoteShow(!scNoteOff());      // aide affichée sauf si elle a été fermée (état retenu)
  document.body.appendChild(wrap); holdApp(); scanPaintList();
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('on'); $('.dv-back', wrap).focus({ preventScroll: true }); }));
  haptic('tap'); scanCamera().finally(scanWarm);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && SC.el && SC.watch) SC.watch.reset(); });
