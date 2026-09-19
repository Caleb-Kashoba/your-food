# Déploiement de Your Food

Ce document couvre les builds Android et iOS. Aucune commande ci-dessous ne publie automatiquement l’application sur Google Play ou sur l’App Store, sauf lorsqu’une étape mentionne explicitement l’envoi vers TestFlight.

## Prérequis communs

1. Installer une version LTS récente de Node.js et Git.
2. Installer les dépendances :

   ```bash
   pnpm install
   ```

3. Se connecter à Expo :

   ```bash
   npx eas-cli@latest login
   ```

4. Lier le dépôt à un projet EAS :

   ```bash
   npx eas-cli@latest init
   ```

5. Copier l’UUID EAS obtenu dans `EAS_PROJECT_ID` pour le développement local et dans les environnements EAS concernés.
6. Confirmer avant la première distribution les identifiants natifs définis dans `app.config.ts` :

   - Android : `com.yourfood.admin`
   - iOS : `com.yourfood.admin`

Après une première publication sur un store, changer ces identifiants crée généralement une nouvelle application au lieu de mettre à jour l’application existante.

## 1. Générer un APK Android

Le profil `preview` utilise la distribution interne et `android.buildType: apk`.

```bash
npx eas-cli@latest build --platform android --profile preview
```

À la première exécution, EAS peut proposer de créer et conserver un keystore Android. Accepter la gestion par EAS convient au projet, puis conserver l’accès au compte Expo qui possède ces identifiants.

Après le build, télécharger l’APK depuis le lien affiché dans le terminal ou depuis la page du build sur expo.dev.

Pour une build de développement avec Dev Client :

```bash
npx eas-cli@latest build --platform android --profile development
```

Cette version nécessite généralement le serveur de développement :

```bash
pnpm start
```

## 2. Installer l’APK sur un téléphone Android

### Installation directe

1. Ouvrir le lien EAS du build `preview` sur le téléphone.
2. Télécharger le fichier APK.
3. Lorsque Android le demande, autoriser temporairement l’installation d’applications inconnues pour le navigateur ou le gestionnaire de fichiers utilisé.
4. Ouvrir l’APK et confirmer l’installation.
5. Désactiver ensuite cette autorisation si elle n’est plus nécessaire.

### Installation avec ADB

Avec le débogage USB activé et Android Platform Tools installé :

```bash
adb install chemin/vers/your-food.apk
```

Pour remplacer une build existante signée avec le même keystore :

```bash
adb install -r chemin/vers/your-food.apk
```

Un APK ne doit pas être envoyé sur Google Play. Pour produire un AAB sans le publier :

```bash
npx eas-cli@latest build --platform android --profile production
```

Le profil `production` génère un Android App Bundle (`.aab`). Sa création ne déclenche aucune soumission au Play Store.

## 3. Créer une build iOS sans Mac

Les builds iOS sont effectués dans le cloud EAS ; aucun Mac local n’est requis.

Prérequis Apple :

- adhésion active à l’Apple Developer Program ;
- accès à App Store Connect ;
- autorisation de créer ou utiliser les certificats et profils de provisioning ;
- bundle identifier `com.yourfood.admin` disponible dans l’équipe Apple.

Créer une build destinée à TestFlight :

```bash
npx eas-cli@latest build --platform ios --profile production
```

Lors du premier build, EAS demandera une connexion Apple et pourra créer ou réutiliser :

- le certificat Apple Distribution ;
- le provisioning profile App Store ;
- l’identifiant de l’application.

Le profil `preview` sur iOS est une distribution ad hoc. Les appareils doivent être enregistrés avant le build :

```bash
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile preview
```

Pour une équipe non technique, TestFlight est généralement plus pratique que la distribution ad hoc.

## 4. Envoyer la build vers TestFlight

Après un build iOS `production` terminé :

```bash
npx eas-cli@latest submit --platform ios --profile production --latest
```

EAS Submit demandera les informations App Store Connect nécessaires. À la première soumission, créer au besoin la fiche de l’application dans App Store Connect, puis conserver son identifiant Apple (`ascAppId`) pour une future automatisation contrôlée.

L’envoi vers TestFlight ne publie pas l’application sur l’App Store. Apple doit d’abord traiter le build ; il apparaîtra ensuite dans l’onglet TestFlight d’App Store Connect.

Il est également possible de construire et soumettre en une commande, mais cette option ne doit être utilisée qu’après autorisation explicite :

```bash
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

## 5. Ajouter les membres de l’équipe comme testeurs

Dans App Store Connect :

1. ouvrir l’application Your Food ;
2. ouvrir l’onglet **TestFlight** ;
3. créer un groupe de test interne, par exemple **Équipe Your Food** ;
4. ajouter les utilisateurs App Store Connect concernés au groupe ;
5. sélectionner le build disponible ;
6. les testeurs installent l’application **TestFlight** sur leur iPhone et acceptent l’invitation.

Pour des personnes qui ne sont pas membres App Store Connect, utiliser un groupe de test externe. Le premier build d’un groupe externe peut nécessiter une Beta App Review d’Apple.

## 6. Créer une nouvelle version

1. Créer un commit ou tag Git correspondant à la version actuellement stable.
2. Modifier `APP_VERSION` dans `app.config.ts`, par exemple de `1.0.0` à `1.1.0`.
3. Aligner la valeur `version` de `package.json`.
4. Exécuter les contrôles :

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   npx expo-doctor
   ```

5. Créer d’abord une build `preview` et la tester sur de vrais appareils.
6. Créer ensuite une build `production` après validation.

`eas.json` utilise `appVersionSource: remote` et `autoIncrement: true` en production. EAS augmente donc le numéro de build Android/iOS à chaque nouveau build de production. La version commerciale (`1.0.0`, `1.1.0`, etc.) reste une décision explicite dans `app.config.ts`.

## 7. Gérer les variables d’environnement de production

Les profils EAS utilisent explicitement les environnements `development`, `preview` et `production`.

Créer les variables publiques nécessaires :

```bash
npx eas-cli@latest env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://PROJECT.supabase.co --environment production --visibility plaintext
npx eas-cli@latest env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value VOTRE_CLE_PUBLIQUE --environment production --visibility sensitive
npx eas-cli@latest env:set --name EAS_PROJECT_ID --value UUID_DU_PROJET --environment production --visibility plaintext
```

Répéter pour `preview` et `development` avec les projets Supabase appropriés. Vérifier les valeurs :

```bash
npx eas-cli@latest env:list --environment production
```

Pour les récupérer localement :

```bash
npx eas-cli@latest env:pull --environment development
```

Règles importantes :

- toute variable `EXPO_PUBLIC_*` est incluse dans l’application et doit être considérée publique ;
- la clé Supabase publique anonyme/publishable est prévue pour le client mobile et doit être protégée par RLS ;
- `SUPABASE_SERVICE_ROLE_KEY` ne doit jamais être placée dans EAS pour le bundle mobile ;
- la clé `service_role` utilisée par l’Edge Function `admin-users` doit être conservée uniquement dans les secrets du projet Supabase ;
- `.env` et les variantes locales restent ignorés par Git.

## 8. Revenir à une version précédente

### APK distribué directement

1. Retrouver le build stable dans l’historique EAS et télécharger son APK.
2. Essayer de l’installer par-dessus la version courante si Android l’autorise.
3. Android bloque généralement un downgrade lorsque le `versionCode` est inférieur. Dans ce cas :
   - soit désinstaller la version actuelle puis installer l’ancien APK ;
   - soit reconstruire le commit stable avec un numéro de build supérieur.

Les données métier étant dans Supabase Cloud, désinstaller l’application n’efface pas ces données. Les préférences locales et la session du téléphone seront néanmoins supprimées.

### TestFlight

1. Dans App Store Connect, retirer le build problématique du groupe de test.
2. Réattribuer un build antérieur encore valide au groupe, si Apple le permet.
3. Sinon, repartir du tag Git stable, augmenter le numéro de build et soumettre un nouveau correctif.

### Version déjà publiée sur un store

Google Play et l’App Store ne proposent pas un véritable retour binaire instantané vers un numéro de build inférieur. Repartir du dernier commit stable, créer une nouvelle version corrective avec un numéro de build supérieur, la tester, puis demander l’autorisation avant toute soumission.

Le projet n’active pas encore EAS Update/OTA. Il n’existe donc pas de rollback JavaScript OTA à gérer pour ce MVP ; chaque retour passe par une build signée et traçable.

## Interdiction de publication automatique

Ne pas exécuter les commandes suivantes sans autorisation explicite du propriétaire :

```bash
npx eas-cli@latest submit --platform android
npx eas-cli@latest submit --platform ios
npx eas-cli@latest build --auto-submit
```

La seule exception prévue dans ce document est l’envoi manuel et autorisé d’une build iOS à TestFlight, qui reste distinct d’une publication sur l’App Store.
