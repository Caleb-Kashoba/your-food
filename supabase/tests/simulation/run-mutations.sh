#!/usr/bin/env bash
# Vérifie que la simulation « a des dents » : chaque mutation casse volontairement une règle, la simulation DOIT échouer.
# Usage : CONTAINER=yourfood-postgres PGUSER=user ./run-mutations.sh [dossier-de-sortie]
set -u
cd "$(dirname "$0")"
OUT="${1:-.}"
for f in mutations/*.sql; do
  name="$(basename "$f" .sql)"
  CONTAINER="${CONTAINER:-yourfood-postgres}" PGUSER="${PGUSER:-user}" ./setup-db.sh fusion_sim > /dev/null 2>&1
  SIM_DB=fusion_sim SIM_MUTATION="$f" node month.js "$OUT" > "$OUT/mut-$name.log" 2>&1
  code=$?
  cp "$OUT/sim-results.json" "$OUT/mut-$name.json" 2>/dev/null
  if [ "$code" = "1" ]; then echo "DETECTEE   $name"; else echo "NON DETECTEE ($code) $name"; fi
done
