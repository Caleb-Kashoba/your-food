# Mise en production de la fusion (commandes des clients + gestion)

> À exécuter par une personne qui a accès au projet Supabase de **production**, après avoir relu le rapport de fusion.
> Tout a été essayé sur un projet de préparation, jamais sur la production. Les migrations ne font qu'**ajouter** (tables, colonnes,
> fonctions, permissions) : aucune suppression, aucun renommage, aucune donnée existante modifiée.

## 0. Principe de sécurité
Tant que l'administratrice **ne publie aucun menu**, rien ne change pour elle : les livraisons, paiements et abonnements fonctionnent
comme avant. La publication d'un menu est l'interrupteur qui active la commande des clients.

## 1. Avant de toucher à la production
1. **Sauvegarde** : Supabase → *Database → Backups* (ou `pg_dump`). Vérifier qu'elle est lisible.
2. **Comparer le schéma de production avec le dépôt** (la préparation a été construite depuis les migrations du dépôt, pas depuis la production) :
   `supabase db diff --linked` ou comparer les tables dans *Table Editor*. Toute différence (colonne ajoutée à la main, par exemple) est à régler **avant**.
3. Vérifier : `select timezone from organizations;` → `Africa/Kinshasa` ; l'extension `pg_cron` est activée (déjà utilisée par la migration 4 d'origine).
4. Prévenir l'administratrice : une courte coupure n'est pas nécessaire (migrations rapides), mais éviter le créneau 19h–21h.

## 2. Base de données (dans l'ordre)
```bash
supabase link --project-ref <REF_PRODUCTION>
supabase db push        # applique 202610010001 → 202610010004
```
Contrôles juste après :
```sql
select count(*) from public.catalog_items;            -- 0 (vide au départ)
select cron.job.jobname from cron.job;                -- contient your-food-lock-menus
select count(*) from public.customers where phone is null;  -- 0 (rien n'a changé)
```

## 3. Données à régler à la main (une seule fois)
La formule 1 ne comprend la viande que le lundi et le vendredi. Sans cette ligne, **toutes** les formules auraient de la viande tous les jours :
```sql
-- Vérifier d'abord les noms exacts : select id, name, price from public.plans;
update public.plans set meat_weekdays = '{1,5}' where name = '<nom exact de la formule à 25 000>';
```
Vérifier aussi que chaque formule n'a des jours de service que du lundi au vendredi : `select p.name, array_agg(d.weekday order by d.weekday) from plans p join plan_service_days d on d.plan_id = p.id group by p.name;`

## 4. Fonction d'accès des clients
```bash
supabase functions deploy client-access --no-verify-jwt
```
(Elle est publique par conception : le client n'a pas encore de session. La protection est le code à 8 caractères, à usage unique, limité à 10 essais.)

## 5. Application
- **Web** : déployer sur Vercel avec la variable `EXPO_PUBLIC_WEB_URL` = adresse publique du site (utilisée dans les liens et QR codes envoyés aux clients).
- **Mobile** : mise à jour à distance EAS (`eas update`) ; aucune dépendance native n'a été ajoutée (le QR code est dessiné en JavaScript).

## 6. Essai sur la production avec un faux client
1. Créer un client « TEST Fusion » (sans téléphone), générer son code, ouvrir le lien dans un autre navigateur, créer le mot de passe.
2. Lui créer un abonnement d'une semaine, publier un menu pour **demain**, vérifier qu'il le voit demain matin et qu'il peut commander.
3. Archiver le faux client : `update public.customers set archived_at = now(), status = 'inactive' where first_name = 'TEST';`

## 7. Ouverture aux clients
1. Menus → publier le menu du jour suivant.
2. Clients → icône clé → **Préparer les accès** : un code par client existant, puis un bouton WhatsApp par client (l'administratrice relit et envoie chaque message).
3. Les clients sans numéro : copier le lien ou montrer le **QR code** depuis leur fiche.
4. Les homonymes sans téléphone ne peuvent pas se distinguer : leur remettre l'accès en main propre ou renseigner leur numéro.

## 8. Retour arrière
- **Application** : republier la version précédente du web et de la mise à jour mobile. Les clients perdent seulement l'accès à leur espace.
- **Base** : les migrations sont additives, on peut les laisser. Pour couper le verrouillage automatique : `select cron.unschedule('your-food-lock-menus');`.
- **Retour complet** (dernier recours) : restaurer la sauvegarde de l'étape 1.
