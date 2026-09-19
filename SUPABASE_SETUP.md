# Mise en service de Supabase

Ce guide initialise un projet Supabase Cloud pour le MVP Your Food. Il ne publie pas l'application mobile et ne place aucun secret d'administration dans le bundle React Native.

## 1. Créer et lier le projet

1. Créer un projet dans le [tableau de bord Supabase](https://supabase.com/dashboard).
2. Noter son `project-ref`, son URL et sa clé publique `anon`/publishable.
3. Se connecter puis lier ce dépôt :

   ```bash
   npx supabase@latest login
   npx supabase@latest link --project-ref VOTRE_PROJECT_REF
   ```

La commande de liaison demande le mot de passe de la base si celui-ci n'est pas déjà disponible dans l'environnement local.

## 2. Vérifier et appliquer le schéma

Afficher d'abord les migrations qui seraient appliquées :

```bash
npx supabase@latest db push --dry-run
```

Puis appliquer les migrations :

```bash
npx supabase@latest db push
```

Les migrations créent le modèle métier, les permissions, les politiques RLS, les fonctions sécurisées, le journal d'audit et la tâche quotidienne de génération des alertes. Elles activent aussi `pg_cron` ; si cette extension n'est pas disponible sur l'offre Supabase choisie, retirer uniquement la migration `202609160004_scheduled_jobs.sql` et déclencher la fonction `generate_subscription_alerts()` depuis un planificateur serveur autorisé.

Le fichier `supabase/seed.sql` contient des données de démonstration. Ne pas l'exécuter sur la production sans décision explicite. Pour une base locale de test seulement :

```bash
npx supabase@latest db reset
```

Références : [migrations Supabase](https://supabase.com/docs/guides/deployment/database-migrations) et [Supabase Cron](https://supabase.com/docs/guides/cron).

## 3. Déployer la fonction d'invitation

```bash
npx supabase@latest functions deploy admin-users
```

La fonction vérifie le JWT de l'appelant et son rôle applicatif avant d'utiliser l'API d'administration Auth. Le secret `SUPABASE_SERVICE_ROLE_KEY` est fourni à l'environnement Supabase Edge Functions et reste exclusivement côté serveur. Il ne doit jamais être copié dans `.env`, EAS ou le code mobile.

Référence : [secrets des Edge Functions](https://supabase.com/docs/guides/functions/secrets).

## 4. Configurer Auth

Dans **Authentication > Providers > Email** :

- conserver l'authentification par e-mail ;
- désactiver l'inscription publique (`Allow new users to sign up`) ;
- configurer le modèle d'e-mail d'invitation et l'expéditeur ;
- ajouter `yourfoodadmin://sign-in` aux URL de redirection autorisées.

La valeur `enable_signup = false` de `supabase/config.toml` protège l'environnement Supabase local ; le réglage du projet Cloud doit être fait séparément dans le tableau de bord.

Référence : [configuration Supabase Auth](https://supabase.com/docs/guides/auth/general-configuration).

## 5. Créer le premier utilisateur root

1. Dans **Authentication > Users**, créer manuellement le compte du propriétaire technique.
2. Renseigner localement `.env` à partir de `.env.example` avec uniquement l'URL et la clé publique du projet.
3. Lancer l'application et se connecter avec ce compte.
4. Sur l'écran d'initialisation, confirmer la création du premier `root`.

L'opération de bootstrap est atomique côté PostgreSQL et utilise un verrou transactionnel. Elle est refusée dès qu'un `root` actif existe. Ensuite, les comptes sont invités depuis **Plus > Utilisateurs** : seuls les `root` peuvent inviter un `admin` ou un autre `root`.

## 6. Variables du client mobile

Créer un fichier `.env` non versionné :

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://VOTRE_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=VOTRE_CLE_PUBLIQUE
EAS_PROJECT_ID=UUID_DU_PROJET_EAS
```

Ces deux variables Supabase sont publiques par conception. La sécurité des données repose sur le JWT utilisateur, les permissions PostgreSQL et les politiques RLS. Ne jamais ajouter une clé `service_role` ou une clé Supabase secrète préfixée `sb_secret_` dans une variable `EXPO_PUBLIC_*`.

## 7. Contrôles après mise en service

Vérifier avec au moins deux comptes que :

- un `root` peut inviter et changer les rôles autorisés ;
- un `admin` conserve les droits métier mais ne peut pas administrer un `root` ni attribuer le rôle `admin` ou `root` ;
- le dernier `root` actif ne peut être ni désactivé, ni supprimé, ni rétrogradé ;
- chaque changement de rôle apparaît dans le journal d'audit ;
- un compte sans permission ne peut pas contourner l'interface avec un appel direct à l'API ;
- les alertes J-5, J-2 et J0 sont produites une seule fois par abonnement et par règle.

