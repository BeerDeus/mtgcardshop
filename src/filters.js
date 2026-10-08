/* ── filters.js : recherche + filtres couleur / famille / coût (deck viewer et collection) ───────────────────── */
const COLOR_DEF = [['W', T('Blanc')], ['U', T('Bleu')], ['B', T('Noir')], ['R', T('Rouge')], ['G', T('Vert')], ['C', T('Incolore')]];      // noms traduits (affichage seulement : la lettre sert de valeur)
const newFilter = () => ({ q: '', colors: new Set(), type: '', cmc: '', cmdr: '' });
const filterCount = f => (f.colors.size ? 1 : 0) + (f.type ? 1 : 0) + (f.cmc !== '' && f.cmc != null ? 1 : 0) + (f.cmdr ? 1 : 0);

/** Symboles de mana « {2}{W}{U} » → pastilles colorées (hybride : première couleur, Phyrexian et X : lettre). */
function manaHtml(mc) {
  const out = [];
  for (const m of String(mc || '').matchAll(/\{([^}]+)\}/g)) {
    const t = m[1].toUpperCase(), c = (t.match(/[WUBRG]/) || [])[0];
    out.push(`<i class="mc mc-${t === 'C' ? 'c' : /^\d+$/.test(t) || t === 'X' || t === 'S' ? 'n' : (c || 'n').toLowerCase()}">${esc(/^\d+$/.test(t) || t === 'X' ? t : (c || t[0] || ''))}</i>`);
  }
  return out.join('');
}

/**
 * Monte la barre dans root : champ de recherche, bouton « Filtres » (pastille = nombre de filtres actifs) et panneau
 * (couleurs, familles, coût ; opts.commander : « Commander »). f est modifié en place ; onChange() suit chaque changement (la saisie est lissée à 120 ms).
 * Retourne { paint, reset }.
 */
function mountFilters(root, f, onChange, opts = {}) {
  root.className = 'fbar';
  root.innerHTML = `<div class="fbar-row">
      <label class="fsearch"><svg class="i" aria-hidden="true"><use href="#i-search"/></svg><input type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(opts.placeholder || T('Rechercher une carte'))}" aria-label="${T('Rechercher une carte')}"><button type="button" class="fclear" aria-label="${T('Effacer la recherche')}" hidden><svg class="i"><use href="#i-close"/></svg></button></label>
      <button class="fbtn" type="button" aria-expanded="false"><svg class="i" aria-hidden="true"><use href="#i-sliders"/></svg><span>${T('Filtres')}</span><b hidden></b></button></div>
    <div class="fpanel" hidden>
      ${opts.commander ? `<div class="fgrp"><span class="fgl">Commander</span><div class="fopts" role="group" aria-label="Commander"><button type="button" class="fopt" data-x="can" aria-pressed="false">${T('Peuvent l\'être')}</button><button type="button" class="fopt" data-x="played" aria-pressed="false">${T('Joués en commandant')}</button></div></div>` : ''}
      <div class="fgrp"><span class="fgl">${T('Couleur')}</span><div class="fcols" role="group" aria-label="${T('Couleurs')}">${COLOR_DEF.map(([c, n]) => `<button type="button" class="fcol mc-${c.toLowerCase()}" data-c="${c}" aria-pressed="false" aria-label="${n}" title="${n}">${c}</button>`).join('')}</div></div>
      <div class="fgrp"><span class="fgl">${T('Famille')}</span><div class="fopts" role="group" aria-label="${T('Familles')}">${TYPE_ORDER.map(t => `<button type="button" class="fopt" data-t="${esc(t)}" aria-pressed="false">${esc(T(t))}</button>`).join('')}</div></div>
      <div class="fgrp"><span class="fgl">${T('Coût de mana')}</span><div class="fopts cmcs" role="group" aria-label="${T('Coût converti')}">${[0, 1, 2, 3, 4, 5, 6, 7].map(m => `<button type="button" class="fopt" data-m="${m}" aria-pressed="false">${m === 7 ? '7+' : m}</button>`).join('')}</div></div>
      <button class="link-btn link-inline freset" type="button">${T('Effacer les filtres')}</button></div>`;
  const inp = root.querySelector('input'), clr = root.querySelector('.fclear'), btn = root.querySelector('.fbtn'), panel = root.querySelector('.fpanel'), badge = btn.querySelector('b');
  let t = 0;
  const paint = () => {
    const n = filterCount(f);
    badge.hidden = !n; badge.textContent = n; btn.classList.toggle('on', n > 0);
    clr.hidden = !inp.value;
    for (const b of root.querySelectorAll('.fcol')) b.setAttribute('aria-pressed', String(f.colors.has(b.dataset.c)));
    for (const b of root.querySelectorAll('[data-t]')) b.setAttribute('aria-pressed', String(f.type === b.dataset.t));
    for (const b of root.querySelectorAll('[data-x]')) b.setAttribute('aria-pressed', String(f.cmdr === b.dataset.x));
    for (const b of root.querySelectorAll('[data-m]')) b.setAttribute('aria-pressed', String(f.cmc !== '' && f.cmc != null && Number(b.dataset.m) === f.cmc));
    root.querySelector('.freset').hidden = !n;
  };
  const fire = () => { paint(); onChange(); };
  inp.addEventListener('input', () => { f.q = inp.value; clr.hidden = !inp.value; clearTimeout(t); t = setTimeout(onChange, 120); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  clr.onclick = () => { inp.value = ''; f.q = ''; fire(); inp.focus(); };
  btn.onclick = () => { const open = panel.hidden; panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); haptic('tap'); };
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.c) { if (f.colors.has(b.dataset.c)) f.colors.delete(b.dataset.c); else f.colors.add(b.dataset.c); }
    else if (b.dataset.t) f.type = f.type === b.dataset.t ? '' : b.dataset.t;
    else if (b.dataset.m) { const m = Number(b.dataset.m); f.cmc = f.cmc === m ? '' : m; }
    else if (b.dataset.x) f.cmdr = f.cmdr === b.dataset.x ? '' : b.dataset.x;
    else if (b.classList.contains('freset')) { f.colors.clear(); f.type = ''; f.cmc = ''; f.cmdr = ''; }
    else return;
    haptic('tap'); fire();
  });
  paint();
  return { paint, reset() { f.q = ''; f.colors.clear(); f.type = ''; f.cmc = ''; f.cmdr = ''; inp.value = ''; paint(); } };
}
