# Correctif invitation WhatsApp / activation

Ce correctif termine et durcit le flux d'invitation interne.

## Modifications

- Le membre invité est créé avec le statut `disabled` et n'obtient l'accès qu'après acceptation d'un lien d'invitation encore valide.
- Une invitation interne expirée ne peut plus ouvrir une session utilisable dans l'application.
- L'activation passe le membre à `active` et marque l'invitation `accepted` dans la même logique serveur.
- Le job d'expiration conserve les membres expirés en `disabled`.
- La validation d'adresse e-mail de l'Edge Function accepte désormais les adresses standards contenant notamment `_` ou `%`.
- Une invitation expirée/perdue peut être recréée proprement tant que le compte n'a jamais été activé ; un vrai compte déjà accepté n'est jamais remplacé.
- La version package est alignée sur l'application `1.0.3`.

## Déploiement

1. Copier les fichiers du patch dans le projet en conservant les chemins.
2. Appliquer la nouvelle migration Supabase `202609190002_invitation_activation_hardening.sql`.
3. Redéployer l'Edge Function `admin-users`.
4. Lancer `pnpm typecheck`, `pnpm lint`, `pnpm test`.
5. Tester une invitation WhatsApp avec une adresse e-mail de test neuve.
6. Générer l'APK 1.0.3 / versionCode 4, car `expo-clipboard` est un module natif ajouté depuis l'APK 1.0.2.

Ne jamais mettre de clé `service_role` dans l'application mobile.
