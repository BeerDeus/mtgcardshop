/* ── back.js : bouton Retour du téléphone ─────────────────────────────────────────────────────────
   Un écran ouvert (feuille, collection, scan, éditeur de deck, visionneuse, résultats) se ferme au lieu de quitter l'app.
   Sur l'accueil : un 1er Retour affiche « Appuie encore sur Retour pour quitter », le 2e (dans les 2,5 s) quitte.
   Principe : l'historique garde toujours deux entrées [root, trap] ; Retour ramène sur « root », on traite puis on repose « trap ». */
const BK = { armed: 0 };
/** Ferme l'écran le plus haut ; retourne vrai s'il y en avait un. */
function backClose() {
  if (typeof imgView !== 'undefined' && imgView) { imgView.close(); return true; }
  if (sheets.length) { sheets[sheets.length - 1].close(); return true; }
  const dvs = $$('body > .dv.on'), top = dvs[dvs.length - 1];
  if (top && top.__close) { if (top.classList.contains('bd')) bdClose(); else top.__close(); return true; }
  if (S.view === 'results') { $('#btnBack').click(); return true; }
  return false;
}
function backInit() {
  if (typeof history === 'undefined' || !history.pushState || !/^https?:$/.test(location.protocol)) return;
  const mark = d => { try { history.pushState({ dd: d }, ''); } catch (e) { /* ignore */ } };
  const st = history.state && history.state.dd;
  if (st === 'root') mark('trap');
  else if (st !== 'trap') { try { history.replaceState({ dd: 'root' }, ''); } catch (e) { return; } mark('trap'); }      // déjà sur « trap » après un rechargement : rien à ajouter
  window.addEventListener('popstate', e => {
    if (!e.state || e.state.dd !== 'root') return;
    if (backClose()) { BK.armed = 0; mark('trap'); return; }
    if (Date.now() - BK.armed < 2500) { BK.armed = 0; history.back(); return; }      // 2e Retour : on laisse partir
    BK.armed = Date.now(); toast('Appuie encore sur Retour pour quitter'); mark('trap');
  });
}
