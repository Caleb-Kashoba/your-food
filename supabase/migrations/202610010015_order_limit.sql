-- Heure limite de commande réglable : la veille ou le jour J (13 octobre 2026). Migration ADDITIVE.
-- Réglage `order_limit` : « none » (par défaut : le menu se verrouille à minuit, au début du jour du repas),
-- « veille@HH:MM » (par exemple veille@20:00) ou « jour@HH:MM » (par exemple jour@06:00, au plus tard jour@12:00).
-- Au verrouillage, le menu se ferme, les repas par défaut sont figés et les bols sont numérotés : avec « jour », la cuisine
-- démarre donc après cette heure. L'ancien réglage `order_limit_time` (heure de la veille) reste lu tant que `order_limit` est vide.

-- ─── 1. La limite : mode et heure ───
create or replace function public.order_limit_parts(p_org uuid, out mode text, out at_time time)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s text := nullif(btrim((select value #>> '{}' from public.app_settings where organization_id = p_org and key = 'order_limit' limit 1)), '');
  legacy time;
begin
  if s is not null and s <> 'none' then
    mode := split_part(s, '@', 1);
    at_time := split_part(s, '@', 2)::time;
    return;
  end if;
  if s is null then
    legacy := public.order_limit_time(p_org);
    if legacy is not null then
      mode := 'veille';
      at_time := legacy;
      return;
    end if;
  end if;
  mode := 'none';
  at_time := null;
end;
$$;
revoke all on function public.order_limit_parts(uuid) from public, anon, authenticated;

-- Instant de verrouillage du menu d'un jour
create or replace function public.order_lock_at(p_org uuid, p_date date)
returns timestamp
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case l.mode
    when 'veille' then ((p_date - 1) + l.at_time)::timestamp
    when 'jour' then (p_date + l.at_time)::timestamp
    else p_date::timestamp
  end
  from public.order_limit_parts(p_org) l;
$$;
revoke all on function public.order_lock_at(uuid, date) from public, anon, authenticated;

create or replace function public.menu_is_past_lock(p_org uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.org_local_now(p_org) >= public.order_lock_at(p_org, p_date);
$$;

-- ─── 2. Lecture et modification depuis l'écran des réglages ───
create or replace function public.get_order_limit()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  l record;
begin
  if public.current_member_id() is null or not public.has_permission('settings.business.write') then raise exception 'Permission denied'; end if;
  select * into l from public.order_limit_parts(public.current_organization_id());
  return case when l.mode = 'none' then 'none' else l.mode || '@' || to_char(l.at_time, 'HH24:MI') end;
end;
$$;

create or replace function public.set_order_limit(p_value text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  v text := lower(btrim(coalesce(p_value, '')));
begin
  if public.current_member_id() is null or not public.has_permission('settings.business.write') then raise exception 'Permission denied'; end if;
  if v <> 'none' and v !~ '^(veille|jour)@([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'La limite doit être « none », « veille@HH:MM » ou « jour@HH:MM ».';
  end if;
  if v like 'jour@%' and split_part(v, '@', 2)::time > time '12:00' then
    raise exception 'Le jour du repas, la limite est midi au plus tard.';
  end if;
  insert into public.app_settings (organization_id, key, value, is_technical, updated_by)
  values (org, 'order_limit', to_jsonb(v), false, public.current_member_id())
  on conflict (organization_id, key) do update set value = excluded.value, updated_by = excluded.updated_by;
  return v;
end;
$$;
revoke all on function public.get_order_limit() from public, anon;
revoke all on function public.set_order_limit(text) from public, anon;
grant execute on function public.get_order_limit() to authenticated;
grant execute on function public.set_order_limit(text) to authenticated;

-- ─── 3. Commander un jour tant qu'il n'est pas verrouillé (le jour J compris, si la limite le permet) ───
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
  if m.menu_date < today then raise exception 'Ce jour n''est plus ouvert aux commandes.'; end if;
  if m.menu_date > public.order_horizon(c.organization_id) then raise exception 'Ce jour n''est pas encore ouvert aux commandes.'; end if;
  if m.status = 'locked' or public.menu_is_past_lock(c.organization_id, m.menu_date) then
    raise exception 'Le menu est verrouillé : les commandes sont closes.';
  end if;

  context := public.customer_subscription_context(c.id, m.menu_date);
  if context ->> 'state' = 'expire' then raise exception 'Ton abonnement est terminé ce jour-là.'; end if;
  if context ->> 'state' = 'non_commence' then raise exception 'Ton abonnement n''a pas encore commencé.'; end if;
  if context ->> 'state' in ('suspendu', 'annule', 'aucun') then raise exception 'Ton abonnement n''est pas actif.'; end if;
  if (context ->> 'start_date')::date = m.menu_date and m.menu_date >= today and public.is_new_start(c.id, m.menu_date) then
    raise exception 'C''est ton premier repas : il est attribué automatiquement.';
  end if;

  select id into d from public.deliveries
  where customer_id = c.id and delivery_date = m.menu_date
    and (status <> 'cancelled' or cancellation_reason = 'customer_cancelled')
  order by (status = 'cancelled'), id
  limit 1;
  if d is null then raise exception 'Aucune livraison n''est prévue pour toi ce jour-là.'; end if;

  return query select c, m, context, d;
end;
$$;

create or replace function public.my_today_menu(p_date date default null)
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
  last_day boolean;
  lim record;
begin
  select * into cust from public.customers where id = public.assert_customer();
  local_now := public.org_local_now(cust.organization_id);
  today := local_now::date;
  service := coalesce(p_date, today + 1);
  if p_date is not null and (p_date < today or p_date > public.order_horizon(cust.organization_id)
                             or (p_date = today and public.menu_is_past_lock(cust.organization_id, p_date))) then
    raise exception 'Ce jour n''est pas ouvert aux commandes.';
  end if;
  select * into lim from public.order_limit_parts(cust.organization_id);
  perform public.lock_due_menus();

  ctx := public.customer_subscription_context(cust.id, service);
  meat_ok := public.meat_allowed_ctx(ctx, service);
  first_day := ctx ->> 'state' in ('actif', 'bientot_expire') and (ctx ->> 'start_date')::date = service and service >= today
               and public.is_new_start(cust.id, service);
  last_day := service = today + 1 and ctx ->> 'state' = 'expire'
              and public.customer_subscription_context(cust.id, today) ->> 'state' in ('actif', 'bientot_expire');

  select * into menu from public.daily_menus where organization_id = cust.organization_id and menu_date = service;

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
  order by (dl.status = 'cancelled'), dl.id
  limit 1;

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
      'menu', null, 'order', null, 'today_meal', today_meal, 'next_menu_date', next_menu, 'first_day_default', first_day, 'last_day', last_day,
      'review_due', case when review_order is not null then jsonb_build_object('order_id', review_order, 'date', prev_date) end,
      'server_now', now());
  end if;

  select * into existing from public.meal_orders where daily_menu_id = menu.id and customer_id = cust.id;
  menu_state := case when menu.status = 'locked' or public.menu_is_past_lock(cust.organization_id, service) then 'verrouille' else 'normal' end;

  return jsonb_build_object(
    'date', service, 'order_date', today, 'menu_status', menu_state, 'subscription', ctx, 'meat_allowed_today', meat_ok,
    'first_day_default', first_day, 'last_day', last_day, 'today_meal', today_meal,
    'menu', jsonb_build_object(
      'id', menu.id, 'deadline_time', null, 'lock_time', lim.at_time,
      'lock_date', case lim.mode when 'veille' then service - 1 when 'jour' then service else null end,
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

-- La semaine du client : le jour J en premier tant qu'il est encore ouvert (limite « jour »), puis demain et la suite
create or replace function public.my_week_menu()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cust public.customers%rowtype;
  today date;
  horizon date;
  d date;
  result jsonb := '[]'::jsonb;
begin
  select * into cust from public.customers where id = public.assert_customer();
  today := public.org_local_now(cust.organization_id)::date;
  horizon := public.order_horizon(cust.organization_id);
  perform public.lock_due_menus();
  for d in
    select x from (
      select menu_date as x from public.daily_menus
      where organization_id = cust.organization_id and menu_date >= today and menu_date <= horizon and menu_date <= today + 60
        and not (menu_date = today and public.menu_is_past_lock(cust.organization_id, menu_date))
      union
      select today + 1 where extract(isodow from today + 1) <= 5
    ) t order by x
  loop
    result := result || jsonb_build_array(public.my_today_menu(d));
  end loop;
  if jsonb_array_length(result) = 0 then result := jsonb_build_array(public.my_today_menu(null)); end if;
  return result;
end;
$$;
