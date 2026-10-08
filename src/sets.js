/* ── sets.js : prochaines extensions (Scryfall) ──────────────────────────────────────────────────────
   Carte « Prochaines extensions » de l'accueil : les prochaines sorties papier (extensions, éditions de base, Masters, Commander…),
   plus la dernière sortie des 14 derniers jours. Source : Scryfall GET /sets (une seule requête, ≈ 1 000 éditions).
   · Lue par la file Scryfall de l'appli (cadence, pause après un 429 respectée), seulement quand l'accueil est vraiment à l'écran, quelques secondes
     après le lancement : jamais pendant une recherche, un scan ou une feuille.
   · Gardée 24 h (Cache) sous une forme réduite : seules les éditions utiles (à venir ou récentes), le tri et les dates relatives sont refaits à l'affichage.
   · Hors ligne, en erreur ou sans rien à venir : la carte reste cachée, sans message ; nouvel essai au prochain lancement. */
const SETS_KEY = 'sets:v1', SETS_TTL = DAY, SETS_RECENT = 14, SETS_MAX = 4;
/** Produits papier « grand public » : les autres types (promo, jetons, funny, cartes numériques, boîtes…) n'intéressent pas l'accueil. */
const SETS_TYPES = ['expansion', 'core', 'masters', 'draft_innovation', 'commander'];
const SETS = { list: null, st: '', t: 0, sig: '', delay: 2500 };      // st : '' · 'cache' (lecture) · 'wait' (requête prévue) · 'net' · 'done' · 'fail'

/** Jour local d'une date Scryfall « AAAA-MM-JJ » (minuit), null si illisible. */
function setsDay(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(s || '')); if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d) ? null : d;
}
/** Réponse /sets → éditions utiles (à venir ou sorties depuis moins de 14 jours), réduites aux champs affichés ; adresses vérifiées. */
function setsKeep(data, now = Date.now()) {
  const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  const out = [];
  for (const s of Array.isArray(data) ? data : []) {
    if (!s || s.digital || !SETS_TYPES.includes(s.set_type) || typeof s.name !== 'string' || typeof s.code !== 'string') continue;
    const d = setsDay(s.released_at); if (!d || Math.round((d - t0) / DAY) < -SETS_RECENT) continue;
    const code = s.code.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10); if (!code) continue;
    out.push({ code, name: s.name.slice(0, 80), at: s.released_at, type: s.set_type,
      parent: typeof s.parent_set_code === 'string' ? s.parent_set_code.toLowerCase() : '',
      icon: /^https:\/\/svgs\.scryfall\.io\/[\w./?=&-]+$/.test(s.icon_svg_uri || '') ? s.icon_svg_uri : '',
      url: /^https:\/\/scryfall\.com\/sets\/[\w-]+(\?[\w=&%-]*)?$/.test(s.scryfall_uri || '') ? s.scryfall_uri : 'https://scryfall.com/sets/' + code });
  }
  return out;
}
/** Éditions à afficher aujourd'hui : les produits rattachés à une édition affichée (decks Commander, Jumpstart…) rejoignent leur parent ;
 *  au plus une sortie récente (la dernière), puis les prochaines, par date. d : jours jusqu'à la sortie (négatif : déjà sortie). */
function setsPick(list, now = Date.now()) {
  const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  const rows = (Array.isArray(list) ? list : []).map(s => ({ ...s, d: Math.round((setsDay(s.at) - t0) / DAY), kids: [] })).filter(s => Number.isFinite(s.d) && s.d >= -SETS_RECENT);
  const by = new Map(rows.map(s => [s.code, s])), top = [];
  for (const s of rows) { const p = s.parent && by.get(s.parent); if (p && p !== s && !p.parent) p.kids.push(s); else top.push(s); }
  const rank = t => (t === 'expansion' || t === 'core' ? 0 : t === 'masters' || t === 'draft_innovation' ? 1 : 2);
  top.sort((a, b) => a.d - b.d || rank(a.type) - rank(b.type) || a.name.localeCompare(b.name));
  const past = top.filter(s => s.d < 0), next = top.filter(s => s.d >= 0);
  return (past.length ? [past[past.length - 1]] : []).concat(next).slice(0, SETS_MAX)
    .map(s => ({ code: s.code, name: s.name, at: s.at, d: s.d, icon: s.icon, url: s.url, cmd: s.kids.some(k => k.type === 'commander') }));
}
/** « 14 novembre » (année seulement si ce n'est pas celle en cours) ; la pastille dit déjà « dans 12 jours » ou « Sortie récente ». */
function setsDate(r) {
  const d = setsDay(r.at), o = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString(LOC(), o);
}
/** Pastille : « Sortie récente », « Aujourd'hui », « Demain », « dans 12 jours », « dans 3 mois ». */
function setsWhen(d) {
  if (d < 0) return T('Sortie récente');
  if (d === 0) return T('Aujourd\'hui');
  if (d === 1) return T('Demain');
  if (d < 100) return TN(d, 'dans {n} jour', 'dans {n} jours');
  return T('dans {n} mois', { n: Math.round(d / 30.4) });                         // 100 jours ou plus : toujours 3 mois ou plus (pluriel dans les deux langues)
}

/** Appelé à chaque repeint de l'accueil (homePaint) : affiche la liste gardée, sinon prévoit la lecture. */
function setsSoon() {
  if (typeof document === 'undefined' || !$('#hmSets')) return;
  if (SETS.list) { setsPaint(); return; }
  if (SETS.st === 'wait' && !SETS.t) { setsArm(); return; }      // l'accueil n'était pas à l'écran au moment prévu : on reprend au repeint suivant
  if (SETS.st) return;
  SETS.st = 'cache';
  Cache.get(SETS_KEY, SETS_TTL).then(hit => {
    if (hit && Array.isArray(hit.sets)) { SETS.list = hit.sets; SETS.st = 'done'; setsPaint(); }
    else { SETS.st = 'wait'; setsArm(); }
  }, () => { SETS.st = 'wait'; setsArm(); });
}
function setsArm() {
  clearTimeout(SETS.t);
  SETS.t = setTimeout(() => {
    SETS.t = 0;
    const busy = S.view !== 'home' || document.hidden || (S.run && S.run.status === 'running') || document.querySelector('body > .dv.on, .sheet-wrap, .ob');
    if (!busy) setsFetch();
  }, SETS.delay);
}
async function setsFetch() {
  if ((typeof navigator !== 'undefined' && navigator.onLine === false) || scryLeft() > 0) { SETS.st = 'fail'; return; }      // hors ligne, ou Scryfall a demandé une pause : rien avant le prochain lancement
  SETS.st = 'net';
  try {
    const j = await httpJson(limScry, 'https://api.scryfall.com/sets', SCRY_JSON, undefined, 1);
    const sets = setsKeep(j && j.data);
    SETS.list = sets; SETS.st = 'done'; Cache.set(SETS_KEY, { sets }); setsPaint();
  } catch (e) { SETS.st = 'fail'; }
}
function setsPaint() {
  const box = $('#hmSets'), ul = $('#hmSetsList'); if (!box || !ul) return;
  const rows = setsPick(SETS.list), sig = [I18N.lang, new Date().toDateString(), rows.map(r => r.code + r.d).join()].join('|');
  if (sig === SETS.sig) return; SETS.sig = sig;
  box.hidden = !rows.length;
  if (!ul._err) { ul._err = true; ul.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true); }      // icône injoignable : la pastille reste, vide
  ul.innerHTML = rows.map(r => `<li><a class="hm-set${r.d < 0 ? ' past' : ''}" href="${esc(r.url)}" target="_blank" rel="noopener">
    <span class="hm-set-ic" aria-hidden="true">${r.icon ? `<img alt="" decoding="async" src="${esc(r.icon)}">` : ''}</span>
    <span class="hm-set-t"><b>${esc(r.name)}</b><span>${esc(setsDate(r))}${r.cmd ? ' · ' + esc(T('decks Commander')) : ''}</span></span>
    <em class="hm-set-when${r.d < 0 ? ' past' : r.d <= 7 ? ' soon' : ''}">${esc(setsWhen(r.d))}</em></a></li>`).join('');
}
