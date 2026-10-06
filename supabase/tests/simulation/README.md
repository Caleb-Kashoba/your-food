# Simulation d'un mois d'utilisation

Rejoue **du 2 octobre au 6 novembre 2026** (36 jours) sur une base PostgreSQL **locale reconstruite à partir des migrations du dépôt** : 100 clients de tous profils, une administratrice, un manager, la cuisine. Aucun accès à Supabase : rien de réel n'est touché.

## Lancer

```bash
# Docker Desktop doit tourner (conteneur PostgreSQL du projet : yourfood-postgres)
npm install --no-save pg                    # une seule fois (dépendance du moteur uniquement)
cd supabase/tests/simulation
CONTAINER=yourfood-postgres PGUSER=user ./setup-db.sh fusion_sim   # base vierge + migrations + horloge simulée
SIM_DB=fusion_sim node month.js ./sortie                            # ≈ 1 min 40 ; code de sortie 0 = tout est conforme
node report.js ./sortie/sim-results.json ./annexe.md ./sortie       # annexe détaillée en Markdown
./run-mutations.sh ./sortie                                         # essais de sensibilité (≈ 15 min)
```

Variables : `SIM_HOST`, `SIM_PORT` (55432), `SIM_USER`, `SIM_PASSWORD`, `SIM_DB` (`fusion_sim`). Le hasard est reproductible (graine fixe) : deux lancements donnent le même mois.

## Principe

- **Horloge simulée** : `sim-clock.sql` remplace `org_local_now` / `organization_local_date` par une version qui lit `app.sim_now`. Chaque action est donc jouée à une heure précise de Kinshasa (19:59:59, 20:00:00, 20:00:30…), sans attendre.
- **Mêmes droits que l'application** : chaque appel passe par `set local role authenticated` avec les `claims` du client ou de l'équipe, donc par la sécurité réelle (RLS, fonctions `security definer`).
- **Oracle indépendant** : `month.js` recalcule de son côté l'état d'abonnement, les jours de viande, les commandes autorisées, les repas par défaut attendus et les statistiques ; toute différence avec la base est une violation.
- **Cas nommés** (`C(...)`) : attendu / constaté pour chaque règle métier ; **invariants** (I1–I8, RLS) contrôlés chaque soir.
- **Concurrence** : connexions multiples (20 commandes pendant un verrouillage, 5 verrouillages simultanés, 4 commandes du même client).
- **Essais de sensibilité** (`mutations/`) : une règle est cassée volontairement, la simulation doit échouer. Une simulation qui ne détecte pas une panne injectée ne prouve rien.

## Fichiers

| Fichier | Rôle |
|---|---|
| `setup-db.sh`, `stubs.sql` | Base vierge + rôles Supabase factices + migrations (sans `pg_cron`) |
| `sim-clock.sql` | Horloge simulée |
| `lib.js` | Connexion, identités, hasard reproductible, dates, journal |
| `seed.js` | Équipe, formules, carte, 100 clients, abonnements, comptes, profils |
| `month.js` | Le mois : planning, comportements, cas, invariants, concurrence, statistiques, mesures |
| `report.js` | Annexe Markdown |
| `veille.js` | Calendrier « la veille », repas par défaut, saisie par l'équipe (`SIM_DB=fusion_sim node veille.js`) |
| `audit-planning.js` | Cas limites de la planification (suspension après création des défauts, saisie le jour du repas, menu oublié, abonnement saisi tard) : un cas en échec est une faille |
| `mutations/`, `run-mutations.sh` | Pannes injectées |

## Limites

La base est locale : pas de latence réseau, pas de vrai `pg_cron` (le verrouillage planifié est joué en appelant `lock_due_menus()` comme le fait la tâche), pas d'Auth ni d'Edge Function (voir les parcours navigateur dans `e2e/`).
