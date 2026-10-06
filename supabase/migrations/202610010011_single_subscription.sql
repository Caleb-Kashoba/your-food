-- Un seul abonnement en cours par client (décision du 6 octobre 2026). Migration ADDITIVE : aucune donnée existante n'est modifiée.
--  1. On rallonge l'abonnement existant (fin + N semaines, prix + N × prix hebdomadaire, livraisons ajoutées) au lieu d'en créer un autre.
--     Créer un deuxième abonnement tant que le premier n'est pas terminé est refusé. « Renouveler » rallonge l'abonnement en cours,
--     ou en crée un nouveau à partir du lundi suivant si le précédent est terminé (historique conservé).
--  2. Modifier les dates d'un abonnement : motif obligatoire, journal des changements (avant / après, qui, quand).
--  3. Supprimer un abonnement : motif obligatoire, seulement sans paiement ni repas déjà préparé ou livré ; sinon on l'annule.
--  4. Changer de formule en cours : on annule l'ancien abonnement et on en crée un nouveau (les repas suivent, voir 0010).
--  L'ancienne fonction create_subscription (abonnement en jours, fin un dimanche) n'est plus appelable depuis l'application.

-- ─── Journal des changements d'abonnement (conservé même après suppression) ───
create table if not exists public.subscription_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null,          -- pas de clé étrangère : le journal survit à la suppression de l'abonnement
  customer_id uuid not null,
  action text not null check (action in ('extended', 'modified', 'deleted')),
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references public.organization_members(id),
  created_at timestamptz not null default now()
);
create index if not exists subscription_changes_subscription_idx on public.subscription_changes(subscription_id, created_at desc);
alter table public.subscription_changes enable row level security;
drop policy if exists subscription_changes_select on public.subscription_changes;
create policy subscription_changes_select on public.subscription_changes for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('subscriptions.read'));
grant select on public.subscription_changes to authenticated;

-- ─── Rallonger ───
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
  new_end := s.end_date + (p_weeks * 7);
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

-- ─── Modifier les dates (motif obligatoire) ───
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

  -- Les livraisons (et leurs commandes) hors de la nouvelle période disparaissent, celles de la nouvelle période sont créées
  perform set_config('app.audit_system', 'on', true);
  delete from public.meal_orders where delivery_id in (
    select id from public.deliveries where subscription_id = s.id and (delivery_date < new_start or delivery_date > new_end));
  perform set_config('app.audit_system', previous, true);
  delete from public.deliveries where subscription_id = s.id and (delivery_date < new_start or delivery_date > new_end);
  update public.subscriptions
  set start_date = new_start, end_date = new_end,
      applied_duration_value = case when applied_duration_unit = 'week' then greatest(1, ceil((new_end - new_start + 1) / 7.0)::integer) else applied_duration_value end,
      updated_by = actor
  where id = s.id;
  insert into public.subscription_changes (organization_id, subscription_id, customer_id, action, reason, details, created_by)
  values (org, s.id, s.customer_id, 'modified', btrim(p_reason),
          jsonb_build_object('start_before', s.start_date, 'start_after', new_start, 'end_before', s.end_date, 'end_after', new_end), actor);
  perform public.generate_deliveries_for_subscription(s.id);
  return s.id;
end;
$$;

-- ─── Supprimer (sans paiement ni repas déjà préparé ou livré) ───
create or replace function public.delete_subscription(p_subscription uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  org uuid := public.current_organization_id();
  s public.subscriptions%rowtype;
  who text;
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  if actor is null or not public.has_permission('subscriptions.write') then raise exception 'Permission denied'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Indique la raison de la suppression.'; end if;
  select * into s from public.subscriptions where id = p_subscription and organization_id = org for update;
  if not found then raise exception 'Abonnement introuvable.'; end if;
  if exists (select 1 from public.payments where subscription_id = s.id) then
    raise exception 'Cet abonnement a des paiements : annule-le plutôt que de le supprimer.';
  end if;
  if exists (select 1 from public.deliveries where subscription_id = s.id and status in ('ready', 'out_for_delivery', 'delivered', 'failed')) then
    raise exception 'Des repas ont déjà été préparés ou livrés : annule l''abonnement plutôt que de le supprimer.';
  end if;

  select concat_ws(' ', first_name, last_name) into who from public.customers where id = s.customer_id;
  insert into public.subscription_changes (organization_id, subscription_id, customer_id, action, reason, details, created_by)
  values (org, s.id, s.customer_id, 'deleted', btrim(p_reason),
          jsonb_build_object('customer', who, 'plan', s.applied_plan_name, 'start', s.start_date, 'end', s.end_date, 'price', s.applied_price, 'status', s.admin_status), actor);

  perform set_config('app.audit_system', 'on', true);
  delete from public.meal_orders where subscription_id = s.id or delivery_id in (select id from public.deliveries where subscription_id = s.id);
  perform set_config('app.audit_system', previous, true);
  delete from public.deliveries where subscription_id = s.id;
  delete from public.alerts where subscription_id = s.id;
  update public.subscriptions set renewed_from_id = null where renewed_from_id = s.id;
  delete from public.subscriptions where id = s.id;
end;
$$;

-- ─── Création : un seul abonnement en cours par client ───
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

  -- Un client n'a qu'un seul abonnement en cours : on le rallonge (extend_subscription_weeks) au lieu d'en créer un autre
  if exists (
    select 1 from public.subscriptions s
    where s.customer_id = p_customer and s.admin_status in ('pending', 'active', 'suspended')
      and s.end_date >= public.org_local_now(org)::date
  ) then
    raise exception 'Ce client a déjà un abonnement en cours : rallonge-le au lieu d''en créer un autre.';
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

-- ─── Renouveler : rallonge l'abonnement en cours, ou en crée un nouveau (le lundi suivant) s'il est terminé ───
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
    -- Abonnement en cours : on le rallonge à la suite
    if p_plan is not null and p_plan <> last_sub.plan_id then
      raise exception 'Pour changer de formule, annule l''abonnement en cours puis crée-en un nouveau.';
    end if;
    if p_start is not null or p_total_price is not null then
      raise exception 'Un abonnement en cours se rallonge à la suite : ni début ni prix à choisir ici (prix exceptionnel : après le rallongement).';
    end if;
    return public.extend_subscription_weeks(last_sub.id, p_weeks);
  end if;

  -- Abonnement terminé : un nouveau commence le lundi suivant (l'ancien reste dans l'historique)
  base := today + 1;
  start_day := coalesce(p_start, base + ((8 - extract(isodow from base)::int) % 7));
  return public.create_subscription_weeks(p_customer, coalesce(p_plan, last_sub.plan_id), start_day, p_weeks, p_total_price, null, last_sub.id);
end;
$$;

-- ─── Droits ───
revoke all on function public.extend_subscription_weeks(uuid, integer, text) from public, anon;
revoke all on function public.modify_subscription(uuid, date, date, text) from public, anon;
revoke all on function public.delete_subscription(uuid, text) from public, anon;
grant execute on function public.extend_subscription_weeks(uuid, integer, text) to authenticated;
grant execute on function public.modify_subscription(uuid, date, date, text) to authenticated;
grant execute on function public.delete_subscription(uuid, text) to authenticated;
revoke all on function public.create_subscription(uuid, uuid, uuid, date, text, uuid) from public, anon, authenticated;
