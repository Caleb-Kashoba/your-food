-- Un abonnement peut commencer n'importe quel jour ouvré (13 octobre 2026). Migration ADDITIVE.
-- Avant : un abonnement commençait toujours un lundi. Maintenant : un jour ouvré (lundi à vendredi), et la durée se compte en
-- JOURS OUVRÉS : une semaine = 5 jours ouvrés. Un abonnement d'une semaine qui commence un mercredi finit le mardi suivant ;
-- le lundi, il finit toujours le vendredi (aucun changement pour les abonnements existants).
-- Rallonger d'une semaine = 5 jours ouvrés de plus à la suite de la fin actuelle : l'abonnement continue comme il est déjà.

-- Nombre de jours ouvrés (lundi → vendredi) entre deux dates, bornes comprises
create or replace function public.count_business_days(p_from date, p_to date)
returns integer
language sql
immutable
as $$
  select count(*)::integer from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  where extract(isodow from d) < 6;
$$;

-- ─── Créer un abonnement : début un jour ouvré, fin 5 × semaines jours ouvrés plus tard ───
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
  if extract(isodow from p_start) > 5 then raise exception 'Un abonnement commence un jour ouvré (du lundi au vendredi).'; end if;
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
  -- une semaine = 5 jours ouvrés : le premier jour compte
  end_day := public.add_business_days(p_start, p_weeks * 5 - 1);

  if exists (
    select 1 from public.subscriptions s
    where s.customer_id = p_customer and s.admin_status in ('pending', 'active', 'suspended')
      and daterange(s.start_date, s.end_date, '[]') && daterange(p_start, end_day, '[]')
  ) then
    raise exception 'Cette période chevauche l''abonnement en cours de ce client.';
  end if;

  if exists (
    select 1 from public.subscriptions s
    where s.customer_id = p_customer and s.admin_status in ('pending', 'active', 'suspended')
      and s.start_date > public.org_local_now(org)::date
  ) then
    raise exception 'Ce client a déjà un abonnement à venir : rallonge-le ou modifie-le au lieu d''en créer un autre.';
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

-- ─── Rallonger : 5 jours ouvrés de plus par semaine, à la suite de la fin actuelle ───
create or replace function public.extend_subscription_weeks(p_subscription uuid, p_weeks integer, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  org uuid := public.current_organization_id();
  s public.subscriptions%rowtype;
  today date;
  weekly numeric;
  new_end date;
  added numeric;
begin
  if actor is null or not public.has_permission('subscriptions.write') then raise exception 'Permission denied'; end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 52 then raise exception 'La durée doit être comprise entre 1 et 52 semaines.'; end if;
  select * into s from public.subscriptions where id = p_subscription and organization_id = org for update;
  if not found then raise exception 'Abonnement introuvable.'; end if;
  if s.admin_status = 'cancelled' then raise exception 'Un abonnement annulé ne se rallonge pas.'; end if;
  today := public.org_local_now(org)::date;
  if s.end_date < today then raise exception 'Cet abonnement est terminé : crée-en un nouveau.'; end if;

  weekly := coalesce(nullif(s.plan_snapshot ->> 'weekly_price', '')::numeric,
                     case when s.applied_duration_unit = 'week' then s.applied_price / nullif(s.applied_duration_value, 0) end);
  if weekly is null or weekly <= 0 then raise exception 'Prix hebdomadaire introuvable pour cet abonnement.'; end if;
  new_end := public.add_business_days(s.end_date, p_weeks * 5);
  if exists (
    select 1 from public.subscriptions o
    where o.customer_id = s.customer_id and o.id <> s.id and o.admin_status in ('pending', 'active', 'suspended')
      and daterange(o.start_date, o.end_date, '[]') && daterange(s.end_date + 1, new_end, '[]')
  ) then
    raise exception 'Cette période chevauche un autre abonnement de ce client.';
  end if;

  added := weekly * p_weeks;
  update public.subscriptions
  set end_date = new_end,
      applied_price = applied_price + added,
      applied_duration_value = case when applied_duration_unit = 'week' then applied_duration_value + p_weeks else applied_duration_value end,
      updated_by = actor
  where id = s.id;
  insert into public.subscription_changes (organization_id, subscription_id, customer_id, action, reason, details, created_by)
  values (org, s.id, s.customer_id, 'extended', nullif(btrim(coalesce(p_reason, '')), ''),
          jsonb_build_object('weeks', p_weeks, 'end_before', s.end_date, 'end_after', new_end, 'price_before', s.applied_price, 'price_after', s.applied_price + added), actor);
  perform public.generate_deliveries_for_subscription(s.id);
  return s.id;
end;
$$;

-- ─── Renouveler avec une autre formule : l'abonnement suivant commence le jour ouvré qui suit la fin ───
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
  if last_sub.end_date >= today then
    if p_plan is not null and p_plan <> last_sub.plan_id then
      -- Autre formule : le nouvel abonnement commence le jour ouvré qui suit la fin de l'abonnement en cours
      start_day := coalesce(p_start, public.add_business_days(last_sub.end_date, 1));
      return public.create_subscription_weeks(p_customer, p_plan, start_day, p_weeks, p_total_price, null, last_sub.id);
    end if;
    -- Même formule : on rallonge l'abonnement en cours
    if p_start is not null or p_total_price is not null then
      raise exception 'Un abonnement en cours se rallonge à la suite : ni début ni prix à choisir ici (prix exceptionnel : après le rallongement).';
    end if;
    return public.extend_subscription_weeks(last_sub.id, p_weeks);
  end if;

  -- Abonnement terminé : un nouveau commence le lundi suivant (l'ancien reste dans l'historique) ; un autre jour ouvré peut être choisi
  base := today + 1;
  start_day := coalesce(p_start, base + ((8 - extract(isodow from base)::int) % 7));
  return public.create_subscription_weeks(p_customer, coalesce(p_plan, last_sub.plan_id), start_day, p_weeks, p_total_price, null, last_sub.id);
end;
$$;

-- ─── Modifier les dates : la durée en semaines se recalcule en jours ouvrés ───
create or replace function public.modify_subscription(p_subscription uuid, p_start date default null, p_end date default null, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  org uuid := public.current_organization_id();
  s public.subscriptions%rowtype;
  new_start date;
  new_end date;
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  if actor is null or not public.has_permission('subscriptions.write') then raise exception 'Permission denied'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Indique la raison du changement.'; end if;
  if p_start is null and p_end is null then raise exception 'Aucune modification fournie.'; end if;
  select * into s from public.subscriptions where id = p_subscription and organization_id = org for update;
  if not found then raise exception 'Abonnement introuvable.'; end if;
  if s.admin_status = 'cancelled' then raise exception 'Un abonnement annulé ne se modifie pas.'; end if;
  new_start := coalesce(p_start, s.start_date);
  new_end := coalesce(p_end, s.end_date);
  if new_end < new_start then raise exception 'La fin ne peut pas précéder le début.'; end if;
  if exists (
    select 1 from public.deliveries d
    where d.subscription_id = s.id and d.status in ('ready', 'out_for_delivery', 'delivered', 'failed')
      and (d.delivery_date < new_start or d.delivery_date > new_end)
  ) then
    raise exception 'Des repas déjà préparés ou livrés se trouvent hors de la nouvelle période.';
  end if;
  if exists (
    select 1 from public.subscriptions o
    where o.customer_id = s.customer_id and o.id <> s.id and o.admin_status in ('pending', 'active', 'suspended')
      and daterange(o.start_date, o.end_date, '[]') && daterange(new_start, new_end, '[]')
  ) then
    raise exception 'Cette période chevauche un autre abonnement de ce client.';
  end if;

  perform set_config('app.audit_system', 'on', true);
  delete from public.meal_orders where delivery_id in (
    select id from public.deliveries where subscription_id = s.id and (delivery_date < new_start or delivery_date > new_end));
  perform set_config('app.audit_system', previous, true);
  delete from public.deliveries where subscription_id = s.id and (delivery_date < new_start or delivery_date > new_end);
  update public.subscriptions
  set start_date = new_start, end_date = new_end,
      applied_duration_value = case when applied_duration_unit = 'week'
                                    then greatest(1, ceil(public.count_business_days(new_start, new_end) / 5.0)::integer)
                                    else applied_duration_value end,
      updated_by = actor
  where id = s.id;
  insert into public.subscription_changes (organization_id, subscription_id, customer_id, action, reason, details, created_by)
  values (org, s.id, s.customer_id, 'modified', btrim(p_reason),
          jsonb_build_object('start_before', s.start_date, 'start_after', new_start, 'end_before', s.end_date, 'end_after', new_end), actor);
  perform public.generate_deliveries_for_subscription(s.id);
  return s.id;
end;
$$;
