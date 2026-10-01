-- DONNÉES DE TEST — PROJET DE PRÉPARATION UNIQUEMENT. Ne jamais exécuter en production.
-- Administratrice de test : admin.prepa@yourfood.test / Admin@2026!

do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  admin_id uuid := '00000000-0000-4000-8000-0000000000a1';
  admin_role uuid;
  admin_member uuid;
  f1 uuid; f2 uuid;
  c record;
  sub_id uuid;
  plan_id uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'admin.prepa@yourfood.test', extensions.crypt('Admin@2026!', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{"display_name":"Sarah BOKETSU"}', now(), now())
  on conflict (id) do nothing;

  select id into admin_role from public.roles where name = 'root';
  insert into public.organization_members (organization_id, user_id, role_id, status)
  values (org, admin_id, admin_role, 'active')
  on conflict (organization_id, user_id) do nothing;
  select id into admin_member from public.organization_members where user_id = admin_id;

  -- Formules (prix hebdomadaires actuels ; la formule 1 ne comprend la viande que le lundi et le vendredi)
  insert into public.plans (organization_id, name, description, price, currency, duration_value, duration_unit,
                            service_days_count, meat_weekdays, created_by)
  values (org, 'Formule 1', 'Plat + accompagnement, viande le lundi et le vendredi', 25000, 'CDF', 1, 'week', 5, '{1,5}', admin_member)
  on conflict (organization_id, name) do nothing;
  insert into public.plans (organization_id, name, description, price, currency, duration_value, duration_unit,
                            service_days_count, meat_weekdays, created_by)
  values (org, 'Formule 2', 'Plat + accompagnement + viande tous les jours', 35000, 'CDF', 1, 'week', 5, null, admin_member)
  on conflict (organization_id, name) do nothing;
  select id into f1 from public.plans where name = 'Formule 1';
  select id into f2 from public.plans where name = 'Formule 2';
  insert into public.plan_service_days (plan_id, weekday)
  select p, d from (values (f1), (f2)) t(p), generate_series(1, 5) d
  on conflict do nothing;

  insert into public.payment_methods (organization_id, code, name, display_order) values
    (org, 'cash', 'Espèces', 1), (org, 'mpesa', 'M-Pesa', 2),
    (org, 'airtel', 'Airtel Money', 3), (org, 'orange', 'Orange Money', 4)
  on conflict do nothing;

  insert into public.alert_rules (organization_id, alert_type, name, days_before) values
    (org, 'subscription_expiration', 'Expiration dans 5 jours', 5),
    (org, 'subscription_expiration', 'Expiration dans 2 jours', 2),
    (org, 'subscription_expiration', 'Expire aujourd''hui', 0)
  on conflict do nothing;

  insert into public.message_templates (organization_id, code, name, body) values
    (org, 'welcome_access', 'Accès client',
     'Bonjour {{prenom}}, voici ton accès Your Food : {{lien}} (code {{code}}). À très vite à table !'),
    (org, 'subscription_reminder', 'Rappel de réabonnement',
     'Bonjour {{prenom}}, ton abonnement Your Food se termine le {{date_fin}}. Réponds-nous pour le renouveler.')
  on conflict do nothing;

  -- Clients fictifs
  for c in select * from (values
    ('Patrick', 'Mbuyi',     '+243811110001', 'Formule 1', date '2026-09-28', 4),
    ('Mireille', 'Kabongo',  '+243811110002', 'Formule 2', date '2026-09-28', 4),
    ('Sarah', 'Ilunga',      '+243811110003', 'Formule 2', date '2026-09-28', 4),
    ('Freddy', 'Kalala',     '+243811110004', 'Formule 2', date '2026-09-07', 2),
    ('Marie', 'Kabongo',     '+243811110005', 'Formule 1', date '2026-09-28', 4),
    ('Marie', 'Kabongo',     '+243811110006', 'Formule 2', date '2026-09-28', 4),
    ('Jean', 'Tshimanga',    null,            'Formule 1', date '2026-09-28', 4)
  ) as t(first_name, last_name, phone, plan_name, start_date, weeks)
  loop
    insert into public.customers (organization_id, first_name, last_name, phone, created_by)
    values (org, c.first_name, c.last_name, c.phone, admin_member);

    select id into plan_id from public.plans where name = c.plan_name;
    insert into public.subscriptions (
      organization_id, customer_id, plan_id, start_date, end_date, applied_plan_name, applied_price, applied_currency,
      applied_duration_value, applied_duration_unit, plan_snapshot, admin_status, created_by)
    select org, cu.id, plan_id, c.start_date, c.start_date + (c.weeks * 7) - 3,
           p.name, p.price * c.weeks, 'CDF', c.weeks, 'week',
           jsonb_build_object('name', p.name, 'price', p.price, 'weeks', c.weeks), 'active', admin_member
    from public.customers cu, public.plans p
    where cu.first_name = c.first_name and cu.last_name = c.last_name
      and cu.phone is not distinct from c.phone and p.id = plan_id
    returning id into sub_id;

    insert into public.subscription_service_days (subscription_id, weekday)
    select sub_id, d from generate_series(1, 5) d;
    perform public.generate_deliveries_for_subscription(sub_id);
  end loop;
end $$;
