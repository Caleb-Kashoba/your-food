#!/usr/bin/env bash
# Prépare une base PostgreSQL LOCALE de simulation à partir des migrations du dépôt (jamais Supabase, jamais la production).
# Usage : CONTAINER=yourfood-postgres PGUSER=user ./setup-db.sh [nom_base]
set -euo pipefail
DB="${1:-fusion_sim}"; CONTAINER="${CONTAINER:-yourfood-postgres}"; PGUSER="${PGUSER:-user}"
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations"
psqlc() { docker exec -i "$CONTAINER" psql -U "$PGUSER" -v ON_ERROR_STOP=1 -q "$@"; }
psqlc -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
psqlc -d "$DB" < "$HERE/stubs.sql" 2>&1 | grep -v "wal_level\|HINT" || true
for f in "$MIG"/*.sql; do
  echo "migration $(basename "$f")"
  # pg_cron n'existe pas dans un PostgreSQL ordinaire : le verrouillage planifié est simulé par le moteur
  sed 's/^create extension if not exists pg_cron;$//' "$f" | psqlc -d "$DB"
done
# Horloge simulée : seule différence avec le dépôt (la source de l'heure), pour rejouer des semaines en quelques secondes
psqlc -d "$DB" < "$HERE/sim-clock.sql"
echo "base $DB prête"
