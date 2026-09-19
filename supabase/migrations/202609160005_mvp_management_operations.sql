begin;

create or replace function public.update_plan_with_schedule(
  p_plan_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_currency text,
  p_duration_value integer,
  p_duration_unit public.duration_unit,
  p_weekdays integer[],
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
  clean_weekdays integer[];
begin
  if actor_id is null or not public.has_permission('settings.business.write') then
    raise exception 'Permission denied';
  end if;
  if btrim(p_name) = '' or p_price <= 0 or p_duration_value <= 0 then
    raise exception 'Invalid plan values';
  end if;

  perform 1 from public.plans
  where id = p_plan_id and organization_id = public.current_organization_id()
  for update;
  if not found then raise exception 'Plan not found'; end if;

  select array_agg(distinct day order by day) into clean_weekdays
  from unnest(p_weekdays) day
  where day between 1 and 7;
  if clean_weekdays is null or cardinality(clean_weekdays) = 0 then
    raise exception 'At least one service day is required';
  end if;

  update public.plans
  set name = btrim(p_name),
      description = nullif(btrim(p_description), ''),
      price = p_price,
      currency = upper(p_currency)::char(3),
      duration_value = p_duration_value,
      duration_unit = p_duration_unit,
      service_days_count = cardinality(clean_weekdays),
      is_active = p_is_active,
      updated_by = actor_id
  where id = p_plan_id;

  delete from public.plan_service_days where plan_id = p_plan_id;
  insert into public.plan_service_days (plan_id, weekday)
  select p_plan_id, day::smallint from unnest(clean_weekdays) day;
end;
$$;

create or replace function public.update_subscription_notes(p_subscription_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
begin
  if actor_id is null or not public.has_permission('subscriptions.write') then
    raise exception 'Permission denied';
  end if;

  update public.subscriptions
  set notes = nullif(btrim(p_notes), ''), updated_by = actor_id
  where id = p_subscription_id and organization_id = public.current_organization_id();
  if not found then raise exception 'Subscription not found'; end if;
end;
$$;

revoke all on function public.update_plan_with_schedule(uuid, text, text, numeric, text, integer, public.duration_unit, integer[], boolean) from public;
revoke all on function public.update_subscription_notes(uuid, text) from public;
grant execute on function public.update_plan_with_schedule(uuid, text, text, numeric, text, integer, public.duration_unit, integer[], boolean) to authenticated;
grant execute on function public.update_subscription_notes(uuid, text) to authenticated;

commit;
