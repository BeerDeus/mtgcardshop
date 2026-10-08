#!/bin/bash
# Lance les tests UN PAR UN (ports fixes : jamais en parallèle). Usage : bash run-tests.sh [fichier.mjs …]  (sans argument : tout)
# Résumé dans tests/run-tests.out, log de chaque test dans tests/logs/<test>.txt. Code retour 1 si un test échoue.
# Lancé depuis la racine du dépôt (les tests lancent « node proxy.mjs » et lisent deck-deal.html).
cd "$(dirname "$0")/.." || exit 1
mkdir -p tests/logs; : > tests/run-tests.out
T=("$@")
if [ ${#T[@]} -eq 0 ]; then T=(
  test.mjs test-prices.mjs test-trade.mjs test-cloud.mjs test-jobs.mjs test-proxy.mjs test-push.mjs test-alerts.mjs test-edh-gen.mjs
  smoke.mjs ui-e2e.mjs cm-e2e.mjs i18n-e2e.mjs list-e2e.mjs value-e2e.mjs frcat-e2e.mjs alerts-e2e.mjs dklist-e2e.mjs back-e2e.mjs
  lang-e2e.mjs art-e2e.mjs viewer-e2e.mjs builder-e2e.mjs coll-e2e.mjs extras-e2e.mjs edh-e2e.mjs
  prix-e2e.mjs pwa-e2e.mjs sw-e2e.mjs push-client-e2e.mjs sync-e2e.mjs e2e-account.mjs scan-e2e.mjs live-e2e.mjs trade-e2e.mjs motion-e2e.mjs rules-test.mjs
); fi
fail=0
for t in "${T[@]}"; do
  s=$(date +%s); timeout 420 node "tests/$t" > "tests/logs/$t.txt" 2>&1; rc=$?
  [ $rc -ne 0 ] && fail=1
  echo "$t rc=$rc $(( $(date +%s)-s ))s" | tee -a tests/run-tests.out
done
echo "FIN (échecs : $fail)" | tee -a tests/run-tests.out
exit $fail
