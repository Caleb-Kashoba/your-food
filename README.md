# Your Food Admin

Application mobile interne Android/iOS de gestion des abonnements de restauration Your Food.

## Stack

- React Native et Expo SDK 57
- Expo Router et TypeScript strict
- Supabase Auth, PostgreSQL et Row Level Security
- EAS Build pour Android et iOS

## Périmètre du MVP

- authentification privée, session persistante et bootstrap atomique du premier `root` ;
- rôles `root`, `admin`, `manager`, `staff` et matrice de permissions extensible ;
- clients, recherche et historique des abonnements, paiements et livraisons ;
- formules configurables avec instantané historique dans chaque abonnement ;
- création, renouvellement, suspension et annulation contrôlée des abonnements ;
- calcul des périodes, jours de service, livraisons quotidiennes et vue sur sept jours ;
- paiements multiples, solde restant et annulation traçable ;
- alertes d’expiration configurables et modèles WhatsApp éditables ;
- dashboard, Realtime ciblé, journal d’audit et outils techniques `root`.

Production, stocks et rapports restent affichés comme modules ultérieurs, conformément au découpage après-MVP du cahier des charges.

## Démarrage local

1. Installer les dépendances avec `pnpm install`.
2. Copier `.env.example` vers `.env`.
3. Renseigner l’URL Supabase et la clé publique anonyme/publishable.
4. Appliquer les migrations en suivant `SUPABASE_SETUP.md`.
5. Lancer `pnpm start`.

La clé Supabase `service_role` ne doit jamais être placée dans `.env`, dans le code mobile ou dans un profil EAS.

## Initialisation du premier root

Créer le premier utilisateur dans Supabase Auth, se connecter dans l’application, puis utiliser l’initialisation proposée. La fonction PostgreSQL refuse cette opération dès qu’un utilisateur `root` actif existe.

## Vérifications

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

Les bundles JavaScript Android et iOS peuvent être contrôlés sans publication avec :

```bash
npx expo export --platform android
npx expo export --platform ios
```

La procédure complète de mise en service de la base se trouve dans `SUPABASE_SETUP.md`. La création des APK, AAB et builds TestFlight est documentée dans `DEPLOYMENT.md`.

Les identifiants natifs initiaux sont `com.yourfood.admin`. Ils doivent être confirmés avant la première soumission aux stores, car leur modification devient contraignante après publication.
