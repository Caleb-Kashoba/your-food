-- Calendrier « la veille » : le client commande le repas de demain jusqu'à 20 h aujourd'hui (le lundi : le dimanche à 20 h),
-- la cuisine prépare et livre le lendemain. Migration ADDITIVE : aucune table supprimée, aucune donnée modifiée.
--  1. Le verrouillage d'un menu tombe la VEILLE de son jour, à 20 h (heure de Kinshasa).
--  2. Le client voit et commande le menu de demain ; il voit aussi l'état du repas d'aujourd'hui.
--  3. Un abonnement qui commence demain ne permet pas de commander : le premier repas est attribué automatiquement.
--  4. Un avis ne peut être donné qu'à partir du jour du repas (le menu est désormais verrouillé la veille).
--  5. L'administratrice / le manager peuvent saisir, modifier ou annuler le repas d'un client, même après 20 h,
--     tant que le bol n'est pas marqué prêt.
--  6. « Bientôt expiré » tient compte des abonnements d'une semaine (jamais « bientôt expiré » dès le premier jour).
--  7. Fixe le search_path de 4 petites fonctions (alerte de sécurité Supabase).

-- ─── 1. Verrouillage la veille à 20 h ───
create or replace function public.menu_is_past_lock(p_org uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.org_local_now(p_org) >= ((p_date - 1) + time '20:00')::timestamp;
$$;

-- ─── 6. « Bientôt expiré » : 2 jours ouvrés pour un abonnement d'une semaine, 5 au-delà ───
create or replace function public.customer_subscription_context(p_customer uuid, p_today date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.subscriptions%rowtype;
  p public.plans%rowtype;
  state text;
  left_days integer;
  total_days integer;
begin
  select * into s from public.subscriptions
  where customer_id = p_customer and admin_status in ('active', 'suspended') and start_date <= p_today and end_date >= p_today
  order by start_date desc limit 1;
  if not found then
    select * into s from public.subscriptions
    where customer_id = p_customer and admin_status in ('active', 'suspended') and start_date > p_today
    order by start_date asc limit 1;
  end if;
  if not found then
    select * into s from public.subscriptions where customer_id = p_customer order by end_date desc limit 1;
  end if;
  if not found then return jsonb_build_object('state', 'aucun'); end if;

  select * into p from public.plans where id = s.plan_id;
  select count(*) into left_days
  from generate_series(greatest(p_today, s.start_date)::timestamp, s.end_date::timestamp, interval '1 day') g
  where extract(isodow from g) <= 5;
  select count(*) into total_days
  from generate_series(s.start_date::timestamp, s.end_date::timestamp, interval '1 day') g
  where extract(isodow from g) <= 5;

  state := case
    when s.admin_status = 'cancelled' then 'annule'
    when s.admin_status = 'suspended' and s.start_date <= p_today and s.end_date >= p_today then 'suspendu'
    when s.start_date > p_today then 'non_commence'
    when s.end_date < p_today then 'expire'
    when left_days <= case when total_days <= 5 then 2 else 5 end then 'bientot_expire'
    else 'actif'
  end;

  return jsonb_build_object(
    'state', state, 'subscription_id', s.id, 'plan_name', s.applied_plan_name,
    'start_date', s.start_date, 'end_date', s.end_date, 'working_days_left', left_days,
    'meat_weekdays', to_jsonb(p.meat_weekdays), 'plan_id', p.id
  );
end;
$$;

create or replace view public.subscription_overview with (security_invoker = true) as
select
  s.id,
  s.organization_id,
  s.customer_id,
  concat_ws(' ', c.first_name, c.last_name) as customer_name,
  s.applied_plan_name as plan_name,
  s.start_date,
  s.end_date,
  s.applied_price as price,
  s.applied_currency as currency,
  s.admin_status,
  case
    when s.admin_status = 'cancelled' then 'cancelled'
    when s.admin_status = 'suspended' then 'suspended'
    when s.admin_status = 'pending' then 'pending'
    when s.start_date > public.organization_local_date(s.organization_id) then 'pending'
    when s.end_date < public.organization_local_date(s.organization_id) then 'expired'
    when s.end_date = public.organization_local_date(s.organization_id) then 'expires_today'
    when s.end_date <= public.organization_local_date(s.organization_id) + case
      when s.end_date - s.start_date <= 7 then 2
      else coalesce((
        select max(r.days_before) from public.alert_rules r
        where r.organization_id = s.organization_id and r.alert_type = 'subscription_expiration' and r.is_active
      ), 5) end then 'expiring_soon'
    else 'active'
  end as effective_status,
  s.end_date - public.organization_local_date(s.organization_id) as days_until_expiration,
  coalesce(payment_totals.amount_paid, 0)::numeric(14,2) as amount_paid,
  greatest(s.applied_price - coalesce(payment_totals.amount_paid, 0), 0)::numeric(14,2) as amount_remaining,
  case
    when coalesce(payment_totals.amount_paid, 0) = 0 then 'unpaid'
    when coalesce(payment_totals.amount_paid, 0) < s.applied_price then 'partial'
    else 'paid'
  end as payment_state,
  s.renewed_from_id,
  s.created_at
from public.subscriptions s
join public.customers c on c.id = s.customer_id
left join lateral (
  select sum(p.amount) as amount_paid
  from public.payments p
  where p.subscription_id = s.id and p.status = 'confirmed'
) payment_totals on true;

-- ─── 2. Espace client : le menu de demain, et l'état du repas d'aujourd'hui ───
create or replace function public.my_today_menu()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cust public.customers%rowtype;
  today date;
  service date;
  local_now timestamp;
  ctx jsonb;
  menu public.daily_menus%rowtype;
  existing public.meal_orders%rowtype;
  prev_date date;
  review_order uuid;
  meat_ok boolean;
  menu_state text;
  today_meal jsonb;
  next_menu date;
  first_day boolean;
begin
  select * into cust from public.customers where id = public.assert_customer();
  local_now := public.org_local_now(cust.organization_id);
  today := local_now::date;
  service := today + 1;
  perform public.lock_due_menus();

  ctx := public.customer_subscription_context(cust.id, service);
  meat_ok := public.meat_allowed_ctx(ctx, service);
  first_day := ctx ->> 'state' in ('actif', 'bientot_expire') and (ctx ->> 'start_date')::date > today;

  select * into menu from public.daily_menus where organization_id = cust.organization_id and menu_date = service;

  -- Repas d'aujourd'hui (lecture seule) : commandé hier, en préparation ou livré
  select jsonb_build_object(
      'date', today, 'delivery_status', dl.status, 'is_default', coalesce(o.is_default, false),
      'cancelled', coalesce(o.status = 'cancelled', false) or dl.status = 'cancelled',
      'plat', pc.name, 'accompagnement', ac.name, 'viande', vc.name)
  into today_meal
  from public.deliveries dl
  left join public.daily_menus tm on tm.organization_id = dl.organization_id and tm.menu_date = dl.delivery_date
  left join public.meal_orders o on o.daily_menu_id = tm.id and o.customer_id = dl.customer_id
  left join public.menu_options po on po.id = o.plat_option_id left join public.catalog_items pc on pc.id = po.catalog_item_id
  left join public.menu_options ao on ao.id = o.accompagnement_option_id left join public.catalog_items ac on ac.id = ao.catalog_item_id
  left join public.menu_options vo on vo.id = o.viande_option_id left join public.catalog_items vc on vc.id = vo.catalog_item_id
  where dl.customer_id = cust.id and dl.delivery_date = today
  limit 1;

  -- Repas du dernier jour ouvré, à noter (le lundi : celui du vendredi)
  prev_date := case extract(isodow from today) when 1 then today - 3 when 7 then today - 2 else today - 1 end;
  select o.id into review_order
  from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id
  left join public.meal_reviews r on r.order_id = o.id
  where o.customer_id = cust.id and dm.menu_date = prev_date and o.status = 'confirmed' and coalesce(r.filled, false) = false
  limit 1;

  if menu.id is null then
    select min(menu_date) into next_menu from public.daily_menus
    where organization_id = cust.organization_id and menu_date > service and status = 'open';
    return jsonb_build_object(
      'date', service, 'order_date', today, 'menu_status', 'aucun_menu', 'subscription', ctx, 'meat_allowed_today', meat_ok,
      'menu', null, 'order', null, 'today_meal', today_meal, 'next_menu_date', next_menu, 'first_day_default', first_day,
      'review_due', case when review_order is not null then jsonb_build_object('order_id', review_order, 'date', prev_date) end,
      'server_now', now());
  end if;

  select * into existing from public.meal_orders where daily_menu_id = menu.id and customer_id = cust.id;
  menu_state := case
    when menu.status = 'locked' then 'verrouille'
    when local_now::time > menu.deadline_time then 'en_retard'
    else 'normal' end;

  return jsonb_build_object(
    'date', service, 'order_date', today, 'menu_status', menu_state, 'subscription', ctx, 'meat_allowed_today', meat_ok,
    'first_day_default', first_day, 'today_meal', today_meal,
    'menu', jsonb_build_object(
      'id', menu.id, 'deadline_time', menu.deadline_time, 'lock_time', '20:00', 'lock_date', today,
      'options', (select coalesce(jsonb_agg(jsonb_build_object('option_id', o.id, 'item_id', c.id, 'name', c.name, 'category', c.category)
                                            order by c.category, c.name), '[]'::jsonb)
                  from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id where o.daily_menu_id = menu.id)),
    'order', case when existing.id is not null then jsonb_build_object(
      'id', existing.id, 'status', existing.status, 'is_default', existing.is_default,
      'plat_option_id', existing.plat_option_id, 'accompagnement_option_id', existing.accompagnement_option_id,
      'viande_option_id', existing.viande_option_id, 'updated_at', existing.updated_at) end,
    'review_due', case when review_order is not null then jsonb_build_object('order_id', review_order, 'date', prev_date) end,
    'server_now', now());
end;
$$;

-- Vérifications communes à la commande et à l'annulation (le repas de demain)
create or replace function public.prepare_customer_order(p_menu_id uuid)
returns table (cust public.customers, menu public.daily_menus, ctx jsonb, delivery_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.customers%rowtype;
  m public.daily_menus%rowtype;
  today date;
  context jsonb;
  d uuid;
begin
  select * into c from public.customers where id = public.assert_customer();
  today := public.org_local_now(c.organization_id)::date;
  select * into m from public.daily_menus where id = p_menu_id and organization_id = c.organization_id for update;
  if not found then raise exception 'Menu introuvable'; end if;
  if m.menu_date <> today + 1 then raise exception 'Tu commandes le repas de demain, la veille avant 20 h.'; end if;
  if m.status = 'locked' or public.menu_is_past_lock(c.organization_id, m.menu_date) then
    raise exception 'Le menu est verrouillé : les commandes sont closes.';
  end if;

  context := public.customer_subscription_context(c.id, m.menu_date);
  if context ->> 'state' = 'expire' then raise exception 'Ton abonnement est expiré.'; end if;
  if context ->> 'state' = 'non_commence' then raise exception 'Ton abonnement n''a pas encore commencé.'; end if;
  if context ->> 'state' in ('suspendu', 'annule', 'aucun') then raise exception 'Ton abonnement n''est pas actif.'; end if;
  if (context ->> 'start_date')::date > today then
    raise exception 'Ton abonnement commence demain : ton premier repas est attribué automatiquement.';
  end if;

  select id into d from public.deliveries
  where customer_id = c.id and delivery_date = m.menu_date
    and (status <> 'cancelled' or cancellation_reason = 'customer_cancelled')
  limit 1;
  if d is null then raise exception 'Aucune livraison n''est prévue pour toi demain.'; end if;

  return query select c, m, context, d;
end;
$$;

-- ─── 4. Historique et avis : seulement à partir du jour du repas ───
create or replace function public.my_history(p_from date default null, p_to date default null, p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cust uuid := public.assert_customer();
  q text := nullif(public.normalize_login_text(p_q), '');
  today date := public.organization_local_date((select organization_id from public.customers where id = cust));
begin
  return coalesce((
    select jsonb_agg(h.j order by h.d desc) from (
      select dm.menu_date as d, jsonb_build_object(
        'order_id', o.id, 'date', dm.menu_date, 'status', o.status, 'is_default', o.is_default,
        'plat', pc.name, 'accompagnement', ac.name, 'viande', vc.name,
        'rating', r.rating, 'comment', r.comment,
        'review_possible', o.status = 'confirmed' and coalesce(r.filled, false) = false) as j
      from public.meal_orders o
      join public.daily_menus dm on dm.id = o.daily_menu_id and dm.status = 'locked' and dm.menu_date <= today
      left join public.menu_options po on po.id = o.plat_option_id left join public.catalog_items pc on pc.id = po.catalog_item_id
      left join public.menu_options ao on ao.id = o.accompagnement_option_id left join public.catalog_items ac on ac.id = ao.catalog_item_id
      left join public.menu_options vo on vo.id = o.viande_option_id left join public.catalog_items vc on vc.id = vo.catalog_item_id
      left join public.meal_reviews r on r.order_id = o.id
      where o.customer_id = cust
        and (p_from is null or dm.menu_date >= p_from) and (p_to is null or dm.menu_date <= p_to)
        and (q is null or public.normalize_login_text(concat_ws(' ', pc.name, ac.name, vc.name)) like '%' || q || '%')
      order by dm.menu_date desc limit 300
    ) h), '[]'::jsonb);
end;
$$;

create or replace function public.submit_my_review(p_order_id uuid, p_rating smallint default null, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cust uuid := public.assert_customer();
  o public.meal_orders%rowtype;
  menu_row public.daily_menus%rowtype;
  clean text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into o from public.meal_orders where id = p_order_id and customer_id = cust;
  if not found then raise exception 'Commande introuvable'; end if;
  if o.status = 'cancelled' then raise exception 'Ce repas a été annulé : il n''y a rien à noter.'; end if;
  select * into menu_row from public.daily_menus where id = o.daily_menu_id;
  if menu_row.status <> 'locked' or menu_row.menu_date > public.organization_local_date(o.organization_id) then
    raise exception 'Tu pourras donner ton avis une fois le repas servi.';
  end if;
  if p_rating is null and clean is null then raise exception 'Ajoute une note ou un commentaire'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then raise exception 'La note doit être comprise entre 1 et 5.'; end if;
  if clean is not null and char_length(clean) > 1000 then raise exception 'Le commentaire est trop long.'; end if;

  insert into public.meal_reviews (organization_id, order_id, rating, comment)
  values (o.organization_id, o.id, p_rating, clean)
  on conflict (order_id) do update
  set rating = coalesce(excluded.rating, public.meal_reviews.rating),
      comment = coalesce(excluded.comment, public.meal_reviews.comment), filled = true;
end;
$$;

-- ─── 5. Saisir, modifier ou annuler le repas d'un client (administratrice, manager) ───
insert into public.permissions (code, description) values ('orders.write', 'Saisir ou modifier le repas d''un client')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'orders.write' where r.name in ('root', 'admin', 'manager')
on conflict do nothing;

-- Ce que l'écran de saisie doit savoir : options du menu, repas actuel, viande permise, et si la saisie est encore possible
create or replace function public.staff_order_context(p_customer uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  menu public.daily_menus%rowtype;
  dl public.deliveries%rowtype;
  o public.meal_orders%rowtype;
  sub public.subscriptions%rowtype;
  ctx jsonb;
  reason text;
begin
  if public.current_member_id() is null or not public.has_permission('orders.write') then raise exception 'Permission denied'; end if;
  select * into menu from public.daily_menus where organization_id = org and menu_date = p_date;
  select * into dl from public.deliveries where organization_id = org and customer_id = p_customer and delivery_date = p_date;
  select * into o from public.meal_orders where daily_menu_id = menu.id and customer_id = p_customer;
  if dl.id is not null then select * into sub from public.subscriptions where id = dl.subscription_id; end if;
  ctx := public.customer_subscription_context(p_customer, p_date);

  reason := case
    when menu.id is null then 'Aucun menu n''est publié pour ce jour.'
    when dl.id is null then 'Aucune livraison n''est prévue ce jour-là pour ce client.'
    when p_date < public.org_local_now(org)::date then 'Ce jour est passé.'
    when dl.status in ('ready', 'out_for_delivery', 'delivered', 'failed') then 'Le repas est déjà prêt ou livré : il ne peut plus être changé.'
    when sub.admin_status <> 'active' or sub.start_date > p_date or sub.end_date < p_date then 'L''abonnement n''est pas actif ce jour-là.'
    else null end;

  return jsonb_build_object(
    'date', p_date, 'menu_id', menu.id, 'menu_locked', coalesce(menu.status = 'locked', false),
    'editable', reason is null, 'reason', reason, 'meat_allowed', public.meat_allowed_ctx(ctx, p_date),
    'delivery_status', dl.status,
    'order', case when o.id is not null then jsonb_build_object(
      'status', o.status, 'is_default', o.is_default, 'plat_option_id', o.plat_option_id,
      'accompagnement_option_id', o.accompagnement_option_id, 'viande_option_id', o.viande_option_id) end,
    'options', case when menu.id is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('option_id', mo.id, 'item_id', c.id, 'name', c.name, 'category', c.category)
                               order by c.category, c.name), '[]'::jsonb)
      from public.menu_options mo join public.catalog_items c on c.id = mo.catalog_item_id where mo.daily_menu_id = menu.id) end);
end;
$$;

create or replace function public.staff_set_order(
  p_customer uuid, p_date date, p_plat uuid, p_accompagnement uuid, p_viande uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  info jsonb;
  menu_id uuid;
  dl public.deliveries%rowtype;
  order_id uuid;
begin
  info := public.staff_order_context(p_customer, p_date);
  if not (info ->> 'editable')::boolean then raise exception '%', info ->> 'reason'; end if;
  menu_id := (info ->> 'menu_id')::uuid;
  select * into dl from public.deliveries where organization_id = org and customer_id = p_customer and delivery_date = p_date;

  if not exists (select 1 from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
                 where o.id = p_plat and o.daily_menu_id = menu_id and c.category = 'plat')
     or not exists (select 1 from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
                    where o.id = p_accompagnement and o.daily_menu_id = menu_id and c.category = 'accompagnement') then
    raise exception 'Choisis un plat et un accompagnement de ce menu.';
  end if;
  if (info ->> 'meat_allowed')::boolean then
    if p_viande is null or not exists (select 1 from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
                                       where o.id = p_viande and o.daily_menu_id = menu_id and c.category = 'viande') then
      raise exception 'Choisis une viande de ce menu.';
    end if;
  elsif p_viande is not null then
    raise exception 'La viande n''est pas incluse dans la formule de ce client ce jour-là.';
  end if;

  insert into public.meal_orders (organization_id, daily_menu_id, customer_id, subscription_id, delivery_id,
                                  plat_option_id, accompagnement_option_id, viande_option_id, status, is_default)
  values (org, menu_id, p_customer, dl.subscription_id, dl.id, p_plat, p_accompagnement, p_viande, 'confirmed', false)
  on conflict (daily_menu_id, customer_id) do update
  set plat_option_id = excluded.plat_option_id, accompagnement_option_id = excluded.accompagnement_option_id,
      viande_option_id = excluded.viande_option_id, status = 'confirmed', is_default = false, delivery_id = excluded.delivery_id
  returning id into order_id;

  update public.deliveries set status = 'scheduled', cancellation_reason = null where id = dl.id and status = 'cancelled';
  return order_id;
end;
$$;

create or replace function public.staff_cancel_order(p_customer uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  info jsonb;
  dl public.deliveries%rowtype;
  order_id uuid;
begin
  info := public.staff_order_context(p_customer, p_date);
  if not (info ->> 'editable')::boolean then raise exception '%', info ->> 'reason'; end if;
  select * into dl from public.deliveries where organization_id = org and customer_id = p_customer and delivery_date = p_date;

  insert into public.meal_orders (organization_id, daily_menu_id, customer_id, subscription_id, delivery_id, status, is_default)
  values (org, (info ->> 'menu_id')::uuid, p_customer, dl.subscription_id, dl.id, 'cancelled', false)
  on conflict (daily_menu_id, customer_id) do update
  set plat_option_id = null, accompagnement_option_id = null, viande_option_id = null, status = 'cancelled', is_default = false
  returning id into order_id;

  update public.deliveries set status = 'cancelled', cancellation_reason = 'customer_cancelled'
  where id = dl.id and status not in ('delivered', 'cancelled');
  return order_id;
end;
$$;

revoke all on function public.staff_order_context(uuid, date) from public, anon;
revoke all on function public.staff_set_order(uuid, date, uuid, uuid, uuid) from public, anon;
revoke all on function public.staff_cancel_order(uuid, date) from public, anon;
grant execute on function public.staff_order_context(uuid, date) to authenticated;
grant execute on function public.staff_set_order(uuid, date, uuid, uuid, uuid) to authenticated;
grant execute on function public.staff_cancel_order(uuid, date) to authenticated;

-- ─── 7. search_path fixé (alerte de sécurité Supabase) ───
alter function public.meat_allowed(smallint[], date) set search_path = public, pg_temp;
alter function public.meat_allowed_ctx(jsonb, date) set search_path = public, pg_temp;
alter function public.normalize_login_text(text) set search_path = public, pg_temp;
alter function public.customer_tech_email(uuid) set search_path = public, pg_temp;
