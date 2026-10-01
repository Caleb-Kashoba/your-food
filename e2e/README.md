# Parcours de bout en bout (navigateur)

`parcours.e2e.js` joue le parcours complet dans un vrai navigateur (Playwright) : accès client par lien, activation,
commande, annulation, reprise, homonymes, puis suivi, menus, carte, audit et statistiques côté administratrice.

**À lancer uniquement contre le projet Supabase de préparation, jamais contre la production** (il crée des comptes et des commandes).

1. `pnpm exec expo export --platform web --output-dir dist-test` avec un `.env` pointant vers la préparation
2. servir `dist-test` en mode application monopage sur http://localhost:4173 (`npx serve -s dist-test -l 4173`)
3. `npm i playwright-core jsqr pngjs` puis `node e2e/parcours.e2e.js`

Données attendues : `supabase/seed-preparation.sql` (administratrice de test, formules, clients fictifs) et un menu publié pour aujourd'hui.

## Identifiants de l'administratrice de préparation
Les parcours lisent `E2E_ADMIN_EMAIL` et `E2E_ADMIN_PASSWORD` (jamais écrits dans le dépôt) :

```bash
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... node e2e/gestion.e2e.js
```
