// Point d'entrée CommonJS : certains hébergeurs chargent l'entry file avec require(),
// ce qui échoue (ERR_REQUIRE_ESM) sur un .mjs. import() fonctionne partout, Node ≥ 18.
import('./proxy.mjs').catch(err => {
  console.error('Deck Deal : démarrage impossible\n', err);
  process.exit(1);
});
