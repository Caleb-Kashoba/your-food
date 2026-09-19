begin;

create or replace function public.calculate_subscription_end_date(
  p_start_date date,
  p_duration_value integer,
  p_duration_unit public.duration_unit
)
returns date
language sql
immutable
strict
as $$
  select case p_duration_unit
    when 'day' then p_start_date + p_duration_value - 1
    when 'week' then p_start_date + (p_duration_value * 7) - 1
    when 'month' then (p_start_date + make_interval(months => p_duration_value))::date - 1
  end;
$$;

create or replace function public.create_plan_with_schedule(
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_currency text,
  p_duration_value integer,
  p_duration_unit public.duration_unit,
  p_weekdays integer[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
  new_plan_id uuid;
  clean_weekdays integer[];
begin
  if actor_id is null or not public.has_permission('settings.business.write') then raise exception 'Permission denied'; end if;
  if p_organization_id <> public.current_organization_id() then raise exception 'Invalid organization'; end if;
  if btrim(p_name) = '' or p_price <= 0 or p_duration_value <= 0 then raise exception 'Invalid plan values'; end if;

  select array_agg(distinct day order by day) into clean_weekdays
  from unnest(p_weekdays) day
  where day between 1 and 7;
  if clean_weekdays is null or cardinality(clean_weekdays) = 0 then raise exception 'At least one service day is required'; end if;

  insert into public.plans (
    organization_id, name, description, price, currency, duration_value, duration_unit,
    service_days_count, created_by, updated_by
  ) values (
    p_organization_id, btrim(p_name), nullif(btrim(p_description), ''), p_price,
    upper(p_currency)::char(3), p_duration_value, p_duration_unit,
    cardinality(clean_weekdays), actor_id, actor_id
  ) returning id into new_plan_id;

  insert into public.plan_service_days (plan_id, weekday)
  select new_plan_id, day::smallint from unnest(clean_weekdays) day;

  return new_plan_id;
end;
$$;

create or replace function public.generate_deliveries_for_subscription(p_subscription_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer;
begin
  insert into public.deliveries (
    organization_id, customer_id, subscription_id, delivery_date, customer_name, phone,
    residence, building, room, zone_id, zone_name, address_details, plan_name, status, updated_by
  )
  select
    s.organization_id,
    c.id,
    s.id,
    service_day::date,
    concat_ws(' ', c.first_name, c.last_name),
    c.phone,
    c.residence,
    c.building,
    c.room,
    c.zone_id,
    z.name,
    c.address_details,
    s.applied_plan_name,
    'scheduled'::public.delivery_status,
    public.current_member_id()
  from public.subscriptions s
  join public.customers c on c.id = s.customer_id
  left join public.delivery_zones z on z.id = c.zone_id
  cross join lateral generate_series(s.start_date::timestamp, s.end_date::timestamp, interval '1 day') service_day
  join public.subscription_service_days d
    on d.subscription_id = s.id
   and d.weekday = extract(isodow from service_day)::smallint
  where s.id = p_subscription_id
    and s.admin_status in ('active', 'pending')
    and not exists (
      select 1 from public.subscription_pauses pause
      where pause.subscription_id = s.id
        and service_day::date between pause.start_date and coalesce(pause.end_date, 'infinity'::date)
    )
  on conflict (subscription_id, delivery_date) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.create_subscription(
  p_organization_id uuid,
  p_customer_id uuid,
  p_plan_id uuid,
  p_start_date date,
  p_notes text default null,
  p_renewed_from_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
  plan_record public.plans%rowtype;
  new_end_date date;
  subscription_id uuid;
begin
  if actor_id is null or not public.has_permission('subscriptions.write') then raise exception 'Permission denied'; end if;
  if p_organization_id <> public.current_organization_id() then raise exception 'Invalid organization'; end if;

  select * into plan_record from public.plans
  where id = p_plan_id and organization_id = p_organization_id and is_active = true;
  if not found then raise exception 'Active plan not found'; end if;
  if not exists (select 1 from public.customers where id = p_customer_id and organization_id = p_organization_id and archived_at is null) then
    raise exception 'Customer not found';
  end if;

  new_end_date := public.calculate_subscription_end_date(p_start_date, plan_record.duration_value, plan_record.duration_unit);

  if exists (
    select 1 from public.subscriptions s
    where s.customer_id = p_customer_id
      and s.admin_status in ('pending', 'active', 'suspended')
      and daterange(s.start_date, s.end_date, '[]') && daterange(p_start_date, new_end_date, '[]')
  ) then
    raise exception 'This customer already has an overlapping subscription';
  end if;

  if p_renewed_from_id is not null and not exists (
    select 1 from public.subscriptions
    where id = p_renewed_from_id and customer_id = p_customer_id and organization_id = p_organization_id
  ) then
    raise exception 'Invalid renewal source';
  end if;

  insert into public.subscriptions (
    organization_id, customer_id, plan_id, start_date, end_date,
    applied_plan_name, applied_price, applied_currency, applied_duration_value,
    applied_duration_unit, plan_snapshot, admin_status, notes, renewed_from_id,
    created_by, updated_by
  ) values (
    p_organization_id, p_customer_id, p_plan_id, p_start_date, new_end_date,
    plan_record.name, plan_record.price, plan_record.currency, plan_record.duration_value,
    plan_record.duration_unit,
    jsonb_build_object(
      'name', plan_record.name,
      'description', plan_record.description,
      'price', plan_record.price,
      'currency', plan_record.currency,
      'duration_value', plan_record.duration_value,
      'duration_unit', plan_record.duration_unit,
      'features', plan_record.features
    ),
    'active', nullif(btrim(p_notes), ''), p_renewed_from_id, actor_id, actor_id
  ) returning id into subscription_id;

  insert into public.subscription_service_days (subscription_id, weekday)
  select subscription_id, weekday from public.plan_service_days where plan_id = p_plan_id;

  perform public.generate_deliveries_for_subscription(subscription_id);
  return subscription_id;
end;
$$;

create or replace function public.set_subscription_status(
  p_subscription_id uuid,
  p_status public.subscription_admin_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
  subscription_record public.subscriptions%rowtype;
  today date;
begin
  if actor_id is null or not public.has_permission('subscriptions.write') then raise exception 'Permission denied'; end if;
  if p_status = 'pending' then raise exception 'Pending is not a valid manual transition'; end if;

  select * into subscription_record from public.subscriptions
  where id = p_subscription_id and organization_id = public.current_organization_id()
  for update;
  if not found then raise exception 'Subscription not found'; end if;
  today := public.organization_local_date(subscription_record.organization_id);

  if subscription_record.admin_status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'A cancelled subscription cannot be reactivated';
  end if;
  if p_status = 'suspended' and subscription_record.admin_status <> 'active' then
    raise exception 'Only an active subscription can be suspended';
  end if;
  if p_status = 'active' and subscription_record.admin_status not in ('active', 'suspended') then
    raise exception 'Invalid subscription transition';
  end if;
  if p_status in ('suspended', 'cancelled') and nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required';
  end if;

  if p_status = 'suspended' and subscription_record.admin_status <> 'suspended' then
    insert into public.subscription_pauses (organization_id, subscription_id, start_date, reason, created_by)
    values (subscription_record.organization_id, p_subscription_id, today, p_reason, actor_id);
    update public.deliveries
      set status = 'cancelled', cancellation_reason = 'subscription_suspended', updated_by = actor_id
      where subscription_id = p_subscription_id and delivery_date >= today and status not in ('delivered', 'cancelled');
  elsif p_status = 'active' and subscription_record.admin_status = 'suspended' then
    update public.subscription_pauses
      set end_date = today, resumed_at = now(), resumed_by = actor_id
      where subscription_id = p_subscription_id and end_date is null;
    update public.deliveries
      set status = 'scheduled', cancellation_reason = null, updated_by = actor_id
      where subscription_id = p_subscription_id and delivery_date > today
        and status = 'cancelled' and cancellation_reason = 'subscription_suspended';
    perform public.generate_deliveries_for_subscription(p_subscription_id);
  elsif p_status = 'cancelled' then
    update public.deliveries
      set status = 'cancelled', cancellation_reason = 'subscription_cancelled', updated_by = actor_id
      where subscription_id = p_subscription_id and delivery_date >= today and status not in ('delivered', 'cancelled');
  end if;

  update public.subscriptions
  set admin_status = p_status,
      updated_by = actor_id,
      cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
      cancellation_reason = case when p_status = 'cancelled' then p_reason else cancellation_reason end
  where id = p_subscription_id;
end;
$$;

create or replace function public.update_delivery_status(p_delivery_id uuid, p_status public.delivery_status)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
begin
  if actor_id is null or not public.has_permission('deliveries.update') then raise exception 'Permission denied'; end if;
  update public.deliveries
  set status = p_status,
      delivered_at = case when p_status = 'delivered' then now() else null end,
      updated_by = actor_id
  where id = p_delivery_id and organization_id = public.current_organization_id();
  if not found then raise exception 'Delivery not found'; end if;
end;
$$;

create or replace function public.record_payment(
  p_organization_id uuid,
  p_customer_id uuid,
  p_subscription_id uuid,
  p_amount numeric,
  p_currency text,
  p_payment_method_id uuid,
  p_reference text,
  p_paid_at date,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
  subscription_record public.subscriptions%rowtype;
  payment_id uuid;
  already_paid numeric(14,2);
begin
  if actor_id is null or not public.has_permission('payments.write') then raise exception 'Permission denied'; end if;
  if p_organization_id <> public.current_organization_id() or p_amount <= 0 then raise exception 'Invalid payment'; end if;

  select * into subscription_record from public.subscriptions
  where id = p_subscription_id and customer_id = p_customer_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'Subscription not found'; end if;
  if subscription_record.admin_status = 'cancelled' then raise exception 'Cannot record a payment on a cancelled subscription'; end if;
  if upper(p_currency) <> subscription_record.applied_currency then raise exception 'Payment currency must match subscription currency'; end if;
  select coalesce(sum(amount), 0) into already_paid
  from public.payments
  where subscription_id = p_subscription_id and status = 'confirmed';
  if already_paid + p_amount > subscription_record.applied_price then
    raise exception 'Payment exceeds the remaining subscription balance';
  end if;
  if not exists (
    select 1 from public.payment_methods
    where id = p_payment_method_id and organization_id = p_organization_id and is_active = true
  ) then raise exception 'Payment method not found'; end if;

  insert into public.payments (
    organization_id, customer_id, subscription_id, amount, currency, paid_at,
    payment_method_id, reference, status, comment, created_by, updated_by, confirmed_at
  ) values (
    p_organization_id, p_customer_id, p_subscription_id, p_amount, upper(p_currency)::char(3), p_paid_at,
    p_payment_method_id, nullif(btrim(p_reference), ''), 'confirmed', nullif(btrim(p_comment), ''),
    actor_id, actor_id, now()
  ) returning id into payment_id;
  return payment_id;
end;
$$;

create or replace function public.cancel_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor_id uuid := public.current_member_id();
begin
  if actor_id is null or not public.has_permission('payments.write') then raise exception 'Permission denied'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A cancellation reason is required'; end if;
  update public.payments
  set status = 'cancelled', cancellation_reason = btrim(p_reason), cancelled_at = now(),
      cancelled_by = actor_id, updated_by = actor_id
  where id = p_payment_id and organization_id = public.current_organization_id() and status <> 'cancelled';
  if not found then raise exception 'Payment not found or already cancelled'; end if;
end;
$$;

create or replace function public.generate_subscription_alerts(p_date date default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer;
  caller_organization_id uuid := public.current_organization_id();
begin
  if auth.uid() is not null and (
    public.current_member_id() is null or not public.has_permission('subscriptions.read')
  ) then raise exception 'Permission denied'; end if;

  insert into public.alerts (
    organization_id, alert_type, rule_id, customer_id, subscription_id,
    title, body, trigger_date, status
  )
  select
    s.organization_id,
    'subscription_expiration',
    r.id,
    s.customer_id,
    s.id,
    case when r.days_before = 0 then 'Abonnement expirant aujourd’hui' else 'Abonnement proche de l’expiration' end,
    concat(concat_ws(' ', c.first_name, c.last_name), ' — ', s.applied_plan_name, ' — fin le ', to_char(s.end_date, 'DD/MM/YYYY')),
    coalesce(p_date, public.organization_local_date(s.organization_id)),
    'unread'
  from public.subscriptions s
  join public.customers c on c.id = s.customer_id
  join public.alert_rules r on r.organization_id = s.organization_id
    and r.alert_type = 'subscription_expiration' and r.is_active = true
  where (caller_organization_id is null or s.organization_id = caller_organization_id)
    and s.admin_status = 'active'
    and s.end_date - r.days_before = coalesce(p_date, public.organization_local_date(s.organization_id))
  on conflict (rule_id, subscription_id, trigger_date) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.update_alert_status(p_alert_id uuid, p_status public.alert_status)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor_id uuid := public.current_member_id();
begin
  if actor_id is null or not public.has_permission('alerts.manage') then raise exception 'Permission denied'; end if;
  update public.alerts
  set status = p_status,
      handled_at = case when p_status in ('handled', 'ignored') then now() else null end,
      handled_by = case when p_status in ('handled', 'ignored') then actor_id else null end
  where id = p_alert_id and organization_id = public.current_organization_id();
  if not found then raise exception 'Alert not found'; end if;
end;
$$;

create or replace view public.subscription_overview
with (security_invoker = true)
as
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
    when s.end_date <= public.organization_local_date(s.organization_id) + coalesce((
      select max(r.days_before) from public.alert_rules r
      where r.organization_id = s.organization_id and r.alert_type = 'subscription_expiration' and r.is_active
    ), 5) then 'expiring_soon'
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

create or replace view public.delivery_overview
with (security_invoker = true)
as
select
  id, organization_id, customer_id, subscription_id, delivery_date, customer_name,
  phone, residence, building, room, zone_id, zone_name, plan_name, status,
  scheduled_time, assigned_to, note, delivered_at
from public.deliveries;

create or replace view public.alert_overview
with (security_invoker = true)
as
select
  a.id, a.organization_id, a.alert_type, a.title, a.body, a.trigger_date, a.status,
  a.customer_id, a.subscription_id,
  concat_ws(' ', c.first_name, c.last_name) as customer_name,
  coalesce(c.whatsapp_normalized, c.phone_normalized) as whatsapp,
  a.created_at
from public.alerts a
left join public.customers c on c.id = a.customer_id;

grant select on public.subscription_overview, public.delivery_overview, public.alert_overview to authenticated;

create or replace function public.dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org_id uuid := public.current_organization_id();
  today date;
  month_start date;
  result jsonb;
begin
  if org_id is null or not public.has_permission('dashboard.read') then raise exception 'Permission denied'; end if;
  today := public.organization_local_date(org_id);
  month_start := date_trunc('month', today)::date;

  select jsonb_build_object(
    'total_customers', (select count(*) from public.customers where organization_id = org_id and archived_at is null),
    'active_customers', (select count(*) from public.customers where organization_id = org_id and status = 'active' and archived_at is null),
    'active_subscriptions', (select count(*) from public.subscription_overview where organization_id = org_id and effective_status in ('active', 'expiring_soon', 'expires_today')),
    'expiring_subscriptions', (select count(*) from public.subscription_overview where organization_id = org_id and effective_status in ('expiring_soon', 'expires_today')),
    'expired_subscriptions', (select count(*) from public.subscription_overview where organization_id = org_id and effective_status = 'expired'),
    'new_subscriptions', (select count(*) from public.subscriptions where organization_id = org_id and created_at >= month_start::timestamptz),
    'deliveries_today', (select count(*) from public.deliveries where organization_id = org_id and delivery_date = today and status <> 'cancelled'),
    'delivered_today', (select count(*) from public.deliveries where organization_id = org_id and delivery_date = today and status = 'delivered'),
    'pending_payments', (select count(*) from public.subscription_overview where organization_id = org_id and amount_remaining > 0 and effective_status <> 'cancelled'),
    'confirmed_revenue', (select coalesce(sum(amount), 0) from public.payments where organization_id = org_id and status = 'confirmed' and paid_at >= month_start and paid_at <= today)
  ) into result;
  return result;
end;
$$;

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
    organization_id, actor_member_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    org_id, public.current_member_id(), lower(tg_op), tg_table_name, record_id, old_json, new_json
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger customers_audit after insert or update or delete on public.customers for each row execute function public.audit_row_change();
create trigger plans_audit after insert or update or delete on public.plans for each row execute function public.audit_row_change();
create trigger subscriptions_audit after insert or update or delete on public.subscriptions for each row execute function public.audit_row_change();
create trigger deliveries_audit after insert or update or delete on public.deliveries for each row execute function public.audit_row_change();
create trigger payments_audit after insert or update or delete on public.payments for each row execute function public.audit_row_change();
create trigger app_settings_audit after insert or update or delete on public.app_settings for each row execute function public.audit_row_change();
create trigger templates_audit after insert or update or delete on public.message_templates for each row execute function public.audit_row_change();

revoke all on function public.create_plan_with_schedule(uuid, text, text, numeric, text, integer, public.duration_unit, integer[]) from public;
revoke all on function public.generate_deliveries_for_subscription(uuid) from public;
revoke all on function public.create_subscription(uuid, uuid, uuid, date, text, uuid) from public;
revoke all on function public.set_subscription_status(uuid, public.subscription_admin_status, text) from public;
revoke all on function public.update_delivery_status(uuid, public.delivery_status) from public;
revoke all on function public.record_payment(uuid, uuid, uuid, numeric, text, uuid, text, date, text) from public;
revoke all on function public.cancel_payment(uuid, text) from public;
revoke all on function public.generate_subscription_alerts(date) from public;
revoke all on function public.update_alert_status(uuid, public.alert_status) from public;
revoke all on function public.dashboard_metrics() from public;

grant execute on function public.create_plan_with_schedule(uuid, text, text, numeric, text, integer, public.duration_unit, integer[]) to authenticated;
grant execute on function public.create_subscription(uuid, uuid, uuid, date, text, uuid) to authenticated;
grant execute on function public.set_subscription_status(uuid, public.subscription_admin_status, text) to authenticated;
grant execute on function public.update_delivery_status(uuid, public.delivery_status) to authenticated;
grant execute on function public.record_payment(uuid, uuid, uuid, numeric, text, uuid, text, date, text) to authenticated;
grant execute on function public.cancel_payment(uuid, text) to authenticated;
grant execute on function public.generate_subscription_alerts(date) to authenticated;
grant execute on function public.update_alert_status(uuid, public.alert_status) to authenticated;
grant execute on function public.dashboard_metrics() to authenticated;

alter publication supabase_realtime add table public.subscriptions, public.deliveries, public.payments, public.alerts;

commit;
