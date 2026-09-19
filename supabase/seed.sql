-- Local/demo data only. Do not run this file automatically against production.

insert into public.delivery_zones (id, organization_id, name, description) values
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Campus', 'Résidences proches du campus'),
  ('21111111-1111-4111-8111-222222222222', '11111111-1111-4111-8111-111111111111', 'Centre-ville', 'Zone centrale'),
  ('21111111-1111-4111-8111-333333333333', '11111111-1111-4111-8111-111111111111', 'Périphérie', 'Livraisons périphériques')
on conflict (organization_id, name) do nothing;

insert into public.payment_methods (organization_id, code, name, display_order) values
  ('11111111-1111-4111-8111-111111111111', 'cash', 'Espèces', 1),
  ('11111111-1111-4111-8111-111111111111', 'mpesa', 'M-Pesa', 2),
  ('11111111-1111-4111-8111-111111111111', 'airtel_money', 'Airtel Money', 3),
  ('11111111-1111-4111-8111-111111111111', 'orange_money', 'Orange Money', 4),
  ('11111111-1111-4111-8111-111111111111', 'other', 'Autre', 5)
on conflict (organization_id, code) do nothing;

insert into public.alert_rules (organization_id, alert_type, name, days_before) values
  ('11111111-1111-4111-8111-111111111111', 'subscription_expiration', 'Premier rappel', 5),
  ('11111111-1111-4111-8111-111111111111', 'subscription_expiration', 'Rappel J-2', 2),
  ('11111111-1111-4111-8111-111111111111', 'subscription_expiration', 'Expiration aujourd’hui', 0)
on conflict (organization_id, alert_type, days_before) do nothing;

insert into public.message_templates (organization_id, code, name, body) values
  ('11111111-1111-4111-8111-111111111111', 'welcome', 'Bienvenue', 'Bonjour {customer_name}, bienvenue chez Your Food !'),
  ('11111111-1111-4111-8111-111111111111', 'subscription_confirmation', 'Confirmation d’abonnement', 'Bonjour {customer_name}, votre abonnement Your Food est confirmé.'),
  ('11111111-1111-4111-8111-111111111111', 'payment_confirmation', 'Confirmation de paiement', 'Bonjour {customer_name}, nous confirmons votre paiement. Merci !'),
  ('11111111-1111-4111-8111-111111111111', 'expiration_reminder', 'Expiration proche', 'Bonjour {customer_name}, votre abonnement Your Food arrive à expiration le {expiration_date}. Souhaitez-vous le renouveler ?'),
  ('11111111-1111-4111-8111-111111111111', 'renewal', 'Renouvellement', 'Bonjour {customer_name}, votre renouvellement Your Food est confirmé.'),
  ('11111111-1111-4111-8111-111111111111', 'expired', 'Abonnement expiré', 'Bonjour {customer_name}, votre abonnement Your Food est arrivé à expiration. Contactez-nous pour le renouveler.'),
  ('11111111-1111-4111-8111-111111111111', 'custom', 'Message personnalisé', 'Bonjour {customer_name}, ')
on conflict (organization_id, code) do nothing;

insert into public.app_settings (organization_id, key, value, is_technical) values
  ('11111111-1111-4111-8111-111111111111', 'business_name', '"Your Food"'::jsonb, false),
  ('11111111-1111-4111-8111-111111111111', 'default_currency', '"CDF"'::jsonb, false),
  ('11111111-1111-4111-8111-111111111111', 'phone_country', '"CD"'::jsonb, false),
  ('11111111-1111-4111-8111-111111111111', 'diagnostics_enabled', 'true'::jsonb, true)
on conflict (organization_id, key) do nothing;

insert into public.plans (
  id, organization_id, name, description, price, currency,
  duration_value, duration_unit, service_days_count, features
) values
  ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Formule 1', 'Formule hebdomadaire standard', 25000, 'CDF', 1, 'week', 6, '["Repas du lundi au samedi"]'),
  ('31111111-1111-4111-8111-222222222222', '11111111-1111-4111-8111-111111111111', 'Formule 2', 'Formule hebdomadaire complète', 35000, 'CDF', 1, 'week', 6, '["Repas du lundi au samedi", "Option complète"]')
on conflict (organization_id, name) do nothing;

insert into public.plan_service_days (plan_id, weekday)
select plan_id, weekday
from (values
  ('31111111-1111-4111-8111-111111111111'::uuid),
  ('31111111-1111-4111-8111-222222222222'::uuid)
) plans(plan_id)
cross join generate_series(1, 6) weekday
on conflict do nothing;

insert into public.customers (
  organization_id, first_name, last_name, phone, whatsapp, residence,
  building, room, zone_id, food_preferences, allergies, notes
) values
  ('11111111-1111-4111-8111-111111111111', 'Grâce', 'Mbala', '0812345678', '+243812345678', 'Résidence Universitaire', 'Bloc A', '12', '21111111-1111-4111-8111-111111111111', 'Riz', null, 'Cliente de démonstration'),
  ('11111111-1111-4111-8111-111111111111', 'Patrick', 'Ilunga', '+243991234567', '+243991234567', 'Home Étudiant', 'Bloc C', '07', '21111111-1111-4111-8111-111111111111', null, 'Arachides', 'Client de démonstration')
on conflict (organization_id, phone_normalized) do nothing;
