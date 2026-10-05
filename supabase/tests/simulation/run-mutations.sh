#!/usr/bin/env bash
# Vérifie que la simulation « a des dents » : chaque panne injectée casse volontairement une règle ; le scénario de la veille
# OU la simulation d'un mois DOIT alors échouer.
# Usage : CONTAINER=yourfood-postgres PGUSER=user ./run-mutations.sh [dossier-de-sortie]
set -u
cd "$(dirname "$0")"
OUT="${1:-.}"
for f in mutations/*.sql; do
  name="$(basename "$f" .sql)"
  CONTAINER="${CONTAINER:-yourfood-postgres}" PGUSER="${PGUSER:-user}" ./setup-db.sh fusion_sim > /dev/null 2>&1
  SIM_DB=fusion_sim SIM_MUTATION="$f" node veille.js > "$OUT/mut-$name-veille.log" 2>&1
  veille=$?
  CONTAINER="${CONTAINER:-yourfood-postgres}" PGUSER="${PGUSER:-user}" ./setup-db.sh fusion_sim > /dev/null 2>&1
  SIM_DB=fusion_sim SIM_MUTATION="$f" node month.js "$OUT" > "$OUT/mut-$name.log" 2>&1
  month=$?
  cp "$OUT/sim-results.json" "$OUT/mut-$name.json" 2>/dev/null
  if [ "$veille" = "1" ] || [ "$month" = "1" ]; then echo "DETECTEE   $name (veille=$veille, mois=$month)"; else echo "NON DETECTEE $name (veille=$veille, mois=$month)"; fi
done
