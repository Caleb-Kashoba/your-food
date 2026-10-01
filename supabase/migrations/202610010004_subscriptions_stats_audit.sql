-- Étape 4 de la fusion : abonnements en semaines (lundi→vendredi, prix modifiable), renouvellement, statistiques,
-- journal d'audit lisible et compte du client (solde et paiements). Migration ADDITIVE.

-- ─── Abonnements en semaines ───
-- Un abonnement commence toujours un lundi et se termine un vendredi ; prix = prix hebdomadaire de la formule × semaines,
-- sauf prix total saisi pour ce client (cas exceptionnel).
create or replace function public.create_subscription_weeks(
  p_customer uuid,
  p_plan uuid,
  p_start date,
  p_weeks integer,
  p_total_price numeric default null,
  p_notes text default null,
  p_renewed_from uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  org uuid := public.current_organization_id();
  plan_record public.plans%rowtype;
  weekly numeric;
  total numeric;
  end_day date;
  new_id uuid;
begin
  if actor is null or not public.has_permission('subscriptions.write') then raise exception 'Permission denied'; end if;
  if extract(isodow from p_start) <> 1 then raise exception 'Un abonnement commence toujours un lundi.'; end if;
  if p_weeks < 1 or p_weeks > 52 then raise exception 'La durée doit être comprise entre 1 et 52 semaines.'; end if;

  select * into plan_record from public.plans where id = p_plan and organization_id = org and is_active;
  if not found then raise exception 'Active plan not found'; end if;
  if not exists (select 1 from public.customers where id = p_customer and organization_id = org and archived_at is null) then
    raise exception 'Customer not found';
  end if;
  if p_renewed_from is not null and not exists (
    select 1 from public.subscriptions where id = p_renewed_from and customer_id = p_customer and organization_id = org) then
    raise exception 'Invalid renewal source';
  end if;

  weekly := plan_record.price / (plan_record.duration_value * case plan_record.duration_unit when 'month' then 4 else 1 end);
  total := coalesce(p_total_price, weekly * p_weeks);
  if total <= 0 then raise exception 'Le prix doit être positif.'; end if;
  end_day := p_start + (p_weeks * 7) - 3;

  if exists (
    select 1 from public.subscriptions s
    where s.customer_id = p_customer and s.admin_status in ('pending', 'active', 'suspended')
      and daterange(s.start_date, s.end_date, '[]') && daterange(p_start, end_day, '[]')
  ) then
    raise exception 'Cette période chevauche l''abonnement en cours de ce client.';
  end if;

  insert into public.subscriptions (
    organization_id, customer_id, plan_id, start_date, end_date, applied_plan_name, applied_price, applied_currency,
    applied_duration_value, applied_duration_unit, plan_snapshot, admin_status, notes, renewed_from_id, created_by, updated_by)
  values (
    org, p_customer, p_plan, p_start, end_day, plan_record.name, total, plan_record.currency, p_weeks, 'week',
    jsonb_build_object('name', plan_record.name, 'weekly_price', weekly, 'weeks', p_weeks,
                       'price_overridden', p_total_price is not null, 'meat_weekdays', to_jsonb(plan_record.meat_weekdays)),
    'active', nullif(btrim(p_notes), ''), p_renewed_from, actor, actor)
  returning id into new_id;

  insert into public.subscription_service_days (subscription_id, weekday)
  select new_id, weekday from public.plan_service_days where plan_id = p_plan and weekday between 1 and 5;
  perform public.generate_deliveries_for_subscription(new_id);
  return new_id;
end;
$$;

-- Renouvellement : par défaut le lundi qui suit la fin (ou le prochain lundi si l'abonnement est expiré)
create or replace function public.renew_subscription_weeks(
  p_customer uuid,
  p_weeks integer,
  p_plan uuid default null,
  p_start date default null,
  p_total_price numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  last_sub public.subscriptions%rowtype;
  today date;
  base date;
  start_day date;
begin
  if public.current_member_id() is null or not public.has_permission('subscriptions.write') then raise exception 'Permission denied'; end if;
  select * into last_sub from public.subscriptions
  where customer_id = p_customer and organization_id = org and admin_status <> 'cancelled'
  order by end_date desc limit 1;
  if not found then raise exception 'Aucun abonnement à renouveler.'; end if;

  today := public.org_local_now(org)::date;
  base := case when last_sub.end_date >= today then last_sub.end_date + 1 else today + 1 end;
  start_day := coalesce(p_start, base + ((8 - extract(isodow from base)::int) % 7));

  return public.create_subscription_weeks(p_customer, coalesce(p_plan, last_sub.plan_id), start_day, p_weeks, p_total_price, null, last_sub.id);
end;
$$;

-- Prix exceptionnel d'un abonnement (un client précis)
create or replace function public.set_subscription_price(p_subscription uuid, p_total numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
begin
  if actor is null or not public.has_permission('subscriptions.write') then raise exception 'Permission denied'; end if;
  if p_total <= 0 then raise exception 'Le prix doit être positif.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Indique la raison du changement de prix.'; end if;
  if p_total < (select coalesce(sum(amount), 0) from public.payments where subscription_id = p_subscription and status = 'confirmed') then
    raise exception 'Le prix ne peut pas être inférieur aux paiements déjà reçus.';
  end if;
  update public.subscriptions
  set applied_price = p_total, updated_by = actor,
      plan_snapshot = plan_snapshot || jsonb_build_object('price_overridden', true, 'price_reason', btrim(p_reason))
  where id = p_subscription and organization_id = public.current_organization_id();
  if not found then raise exception 'Subscription not found'; end if;
end;
$$;

-- ─── Statistiques : plat le plus commandé (semaine, mois, année, historique) ───
create or replace function public.top_dishes(p_period text, p_ref date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  ref date := coalesce(p_ref, public.org_local_now(public.current_organization_id())::date);
  d_from date; d_to date;
  out jsonb := '{}'::jsonb;
  cat text;
  top record;
begin
  if public.current_member_id() is null or not (public.has_permission('orders.read') or public.has_permission('dashboard.read')) then
    raise exception 'Permission denied';
  end if;
  case p_period
    when 'week' then d_from := date_trunc('week', ref)::date; d_to := d_from + 6;
    when 'month' then d_from := date_trunc('month', ref)::date; d_to := (d_from + interval '1 month')::date - 1;
    when 'year' then d_from := date_trunc('year', ref)::date; d_to := (d_from + interval '1 year')::date - 1;
    when 'all' then d_from := null; d_to := null;
    else raise exception 'Période inconnue';
  end case;

  foreach cat in array array['plat', 'accompagnement', 'viande'] loop
    select c.name, count(*) as n into top
    from public.meal_orders o
    join public.daily_menus dm on dm.id = o.daily_menu_id and dm.status = 'locked'
    join public.menu_options mo on mo.id = case cat when 'plat' then o.plat_option_id
                                                    when 'accompagnement' then o.accompagnement_option_id
                                                    else o.viande_option_id end
    join public.catalog_items c on c.id = mo.catalog_item_id
    where o.organization_id = org and o.status = 'confirmed'
      and (d_from is null or dm.menu_date between d_from and d_to)
    group by c.id, c.name
    order by count(*) desc, c.name asc
    limit 1;
    out := out || jsonb_build_object(cat, case when top.name is null then null else jsonb_build_object('name', top.name, 'count', top.n) end);
  end loop;

  return out || jsonb_build_object('period', p_period, 'from', d_from, 'to', d_to);
end;
$$;

create or replace function public.orders_overview(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  d date := coalesce(p_date, public.org_local_now(public.current_organization_id())::date);
  menu_id uuid;
begin
  if public.current_member_id() is null or not (public.has_permission('orders.read') or public.has_permission('dashboard.read')) then
    raise exception 'Permission denied';
  end if;
  select id into menu_id from public.daily_menus where organization_id = org and menu_date = d;
  return jsonb_build_object(
    'date', d,
    'active_customers', (select count(distinct customer_id) from public.subscriptions
                         where organization_id = org and admin_status = 'active' and start_date <= d and end_date >= d),
    'deliveries_expected', (select count(*) from public.deliveries where organization_id = org and delivery_date = d and status <> 'cancelled'),
    'orders_confirmed', (select count(*) from public.meal_orders where daily_menu_id = menu_id and status = 'confirmed' and not is_default),
    'orders_default', (select count(*) from public.meal_orders where daily_menu_id = menu_id and is_default),
    'orders_cancelled', (select count(*) from public.meal_orders where daily_menu_id = menu_id and status = 'cancelled'),
    'tops', jsonb_build_object(
      'week', public.top_dishes('week', d), 'month', public.top_dishes('month', d),
      'year', public.top_dishes('year', d), 'all', public.top_dishes('all', d)));
end;
$$;

-- ─── Compte du client : abonnement, solde et paiements ───
create or replace function public.my_account()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cust public.customers%rowtype;
  ctx jsonb;
  sub_id uuid;
begin
  select * into cust from public.customers where id = public.assert_customer();
  ctx := public.customer_subscription_context(cust.id, public.org_local_now(cust.organization_id)::date);
  sub_id := nullif(ctx ->> 'subscription_id', '')::uuid;
  return jsonb_build_object(
    'customer', jsonb_build_object('first_name', cust.first_name, 'last_name', cust.last_name, 'phone', cust.phone),
    'subscription', ctx,
    'balance', case when sub_id is null then null else (
      select jsonb_build_object(
        'price', s.applied_price, 'currency', s.applied_currency,
        'paid', coalesce(sum(p.amount) filter (where p.status = 'confirmed'), 0),
        'remaining', greatest(s.applied_price - coalesce(sum(p.amount) filter (where p.status = 'confirmed'), 0), 0))
      from public.subscriptions s left join public.payments p on p.subscription_id = s.id
      where s.id = sub_id group by s.id) end,
    'payments', case when sub_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('amount', p.amount, 'currency', p.currency, 'paid_at', p.paid_at,
                                          'method', m.name, 'status', p.status) order by p.paid_at desc)
      from public.payments p join public.payment_methods m on m.id = p.payment_method_id
      where p.subscription_id = sub_id and p.status = 'confirmed'), '[]'::jsonb) end);
end;
$$;

-- ─── Journal d'audit : qui a fait quoi, avec des filtres clairs ───
alter table public.audit_logs add column actor_user_id uuid;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_json jsonb;
  new_json jsonb;
  org_id uuid;
  record_id text;
begin
  if tg_op = 'INSERT' then
    new_json := to_jsonb(new);
    org_id := (new_json ->> 'organization_id')::uuid;
    record_id := new_json ->> 'id';
  elsif tg_op = 'UPDATE' then
    old_json := to_jsonb(old);
    new_json := to_jsonb(new);
    org_id := (new_json ->> 'organization_id')::uuid;
    record_id := new_json ->> 'id';
  else
    old_json := to_jsonb(old);
    org_id := (old_json ->> 'organization_id')::uuid;
    record_id := old_json ->> 'id';
  end if;

  insert into public.audit_logs (
    organization_id, actor_member_id, actor_user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    org_id, public.current_member_id(), auth.uid(), lower(tg_op), tg_table_name, record_id, old_json, new_json
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

insert into public.permissions (code, description) values ('audit.read', 'Consulter le journal d''activité')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'audit.read' where r.name in ('root', 'admin')
on conflict do nothing;

create or replace function public.audit_search(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_actor_kind text default null,   -- equipe | client | systeme
  p_area text default null,         -- clients, abonnements, livraisons, paiements, plats, menus, commandes, avis, formules, parametres, acces, equipe
  p_action text default null,       -- cree | modifie | supprime | autre
  p_q text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  result jsonb;
  q text := nullif(public.normalize_login_text(p_q), '');
begin
  if public.current_member_id() is null or not public.has_permission('audit.read') then raise exception 'Permission denied'; end if;

  with base as (
    select a.*,
      case
        when a.entity_type = 'customers' then 'clients'
        when a.entity_type = 'customer' then 'acces'
        when a.entity_type = 'subscriptions' then 'abonnements'
        when a.entity_type = 'deliveries' then 'livraisons'
        when a.entity_type = 'payments' then 'paiements'
        when a.entity_type = 'catalog_items' then 'plats'
        when a.entity_type = 'daily_menus' then 'menus'
        when a.entity_type = 'meal_orders' then 'commandes'
        when a.entity_type = 'meal_reviews' then 'avis'
        when a.entity_type = 'plans' then 'formules'
        when a.entity_type in ('app_settings', 'message_templates') then 'parametres'
        else 'equipe' end as area,
      case a.action when 'insert' then 'cree' when 'update' then 'modifie' when 'delete' then 'supprime' else 'autre' end as action_kind,
      case
        when a.actor_user_id is null and a.actor_member_id is null then 'systeme'
        when a.actor_member_id is not null
             or exists (select 1 from public.organization_members om where om.user_id = a.actor_user_id) then 'equipe'
        else 'client' end as actor_kind,
      coalesce(nullif(concat_ws(' ', cu.first_name, cu.last_name), ''), pm.display_name, 'Système') as actor_name
    from public.audit_logs a
    left join public.organization_members m on m.id = a.actor_member_id
    left join public.profiles pm on pm.id = coalesce(a.actor_user_id, m.user_id)
    left join public.customers cu on cu.auth_user_id = a.actor_user_id
    where a.organization_id = org
      and (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to)
  ), filtered as (
    select * from base
    where (p_actor_kind is null or actor_kind = p_actor_kind)
      and (p_area is null or area = p_area)
      and (p_action is null or action_kind = p_action)
      and (q is null or public.normalize_login_text(concat_ws(' ', actor_name, area, action, entity_id, old_data::text, new_data::text)) like '%' || q || '%')
  ), page as (
    select * from filtered order by created_at desc, id desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'at', f.created_at, 'actor_name', f.actor_name, 'actor_kind', f.actor_kind, 'area', f.area,
      'action', f.action_kind, 'raw_action', f.action, 'entity_id', f.entity_id,
      'changed_fields', case when f.action = 'update' then (
          select coalesce(jsonb_agg(k.key order by k.key), '[]'::jsonb) from jsonb_each(f.new_data) k
          where f.old_data -> k.key is distinct from k.value and k.key not in ('updated_at', 'updated_by')) end
    ) order by f.created_at desc, f.id desc) from page f), '[]'::jsonb))
  into result;

  return result;
end;
$$;

-- Droits d'exécution
revoke all on function public.create_subscription_weeks(uuid, uuid, date, integer, numeric, text, uuid) from public, anon;
revoke all on function public.renew_subscription_weeks(uuid, integer, uuid, date, numeric) from public, anon;
revoke all on function public.set_subscription_price(uuid, numeric, text) from public, anon;
revoke all on function public.top_dishes(text, date) from public, anon;
revoke all on function public.orders_overview(date) from public, anon;
revoke all on function public.my_account() from public, anon;
revoke all on function public.audit_search(timestamptz, timestamptz, text, text, text, text, integer, integer) from public, anon;

grant execute on function public.create_subscription_weeks(uuid, uuid, date, integer, numeric, text, uuid) to authenticated;
grant execute on function public.renew_subscription_weeks(uuid, integer, uuid, date, numeric) to authenticated;
grant execute on function public.set_subscription_price(uuid, numeric, text) to authenticated;
grant execute on function public.top_dishes(text, date) to authenticated;
grant execute on function public.orders_overview(date) to authenticated;
grant execute on function public.my_account() to authenticated;
grant execute on function public.audit_search(timestamptz, timestamptz, text, text, text, text, integer, integer) to authenticated;
