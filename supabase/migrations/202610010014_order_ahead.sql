-- Commander plusieurs jours à l'avance (12 octobre 2026). Migration ADDITIVE.
-- Avant : un client ne pouvait commander que le repas de demain. Maintenant : tous les jours dont le menu est publié, de demain
-- jusqu'à une limite réglable par l'administratrice (réglage `order_ahead`) :
--   • « week »  (par défaut) : jusqu'au vendredi de la semaine du prochain jour ouvré (le week-end : la semaine qui commence lundi) ;
--   • un nombre N : N jours à partir d'aujourd'hui (1 = demain seulement, l'ancien comportement) ;
--   • « none » : pas de limite (tous les menus publiés).
-- Chaque jour reste modifiable jusqu'à son verrouillage (minuit la veille, ou l'heure limite `order_limit_time` si elle est réglée).

-- ─── 1. La limite est un réglage ───
create or replace function public.order_ahead(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(btrim((select value #>> '{}' from public.app_settings where organization_id = p_org and key = 'order_ahead' limit 1)), ''), 'week');
$$;
revoke all on function public.order_ahead(uuid) from public, anon, authenticated;

-- Dernier jour commandable (infini si la limite est désactivée)
create or replace function public.order_horizon(p_org uuid)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  today date := public.org_local_now(p_org)::date;
  mode text := public.order_ahead(p_org);
  next_working date;
begin
  if mode = 'none' then return 'infinity'::date; end if;
  if mode ~ '^[0-9]+$' then return today + greatest(mode::integer, 1); end if;
  next_working := public.add_business_days(today, 1);
  return next_working + (5 - extract(isodow from next_working)::integer);
end;
$$;
revoke all on function public.order_horizon(uuid) from public, anon, authenticated;

create or replace function public.get_order_ahead()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_member_id() is null or not public.has_permission('settings.business.write') then raise exception 'Permission denied'; end if;
  return public.order_ahead(public.current_organization_id());
end;
$$;

create or replace function public.set_order_ahead(p_value text)
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
  if v not in ('week', 'none') and not (v ~ '^[0-9]+$' and v::integer between 1 and 60) then
    raise exception 'La limite doit être « week », « none » ou un nombre de jours entre 1 et 60.';
  end if;
  insert into public.app_settings (organization_id, key, value, is_technical, updated_by)
  values (org, 'order_ahead', to_jsonb(v), false, public.current_member_id())
  on conflict (organization_id, key) do update set value = excluded.value, updated_by = excluded.updated_by;
  return v;
end;
$$;
revoke all on function public.get_order_ahead() from public, anon;
revoke all on function public.set_order_ahead(text) from public, anon;
grant execute on function public.get_order_ahead() to authenticated;
grant execute on function public.set_order_ahead(text) to authenticated;

-- ─── 2. Commander un jour de la fenêtre (et plus seulement demain) ───
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
  if m.menu_date <= today then raise exception 'Ce jour n''est plus ouvert aux commandes.'; end if;
  if m.menu_date > public.order_horizon(c.organization_id) then raise exception 'Ce jour n''est pas encore ouvert aux commandes.'; end if;
  if m.status = 'locked' or public.menu_is_past_lock(c.organization_id, m.menu_date) then
    raise exception 'Le menu est verrouillé : les commandes sont closes.';
  end if;

  context := public.customer_subscription_context(c.id, m.menu_date);
  if context ->> 'state' = 'expire' then raise exception 'Ton abonnement est terminé ce jour-là.'; end if;
  if context ->> 'state' = 'non_commence' then raise exception 'Ton abonnement n''a pas encore commencé.'; end if;
  if context ->> 'state' in ('suspendu', 'annule', 'aucun') then raise exception 'Ton abonnement n''est pas actif.'; end if;
  -- Premier jour d'un vrai nouveau client : son repas est attribué d'office
  if (context ->> 'start_date')::date = m.menu_date and m.menu_date > today and public.is_new_start(c.id, m.menu_date) then
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

-- ─── 3. Le menu d'un jour (par défaut : demain) et la semaine entière ───
drop function if exists public.my_today_menu();

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
  limit_time time;
begin
  select * into cust from public.customers where id = public.assert_customer();
  local_now := public.org_local_now(cust.organization_id);
  today := local_now::date;
  service := coalesce(p_date, today + 1);
  if p_date is not null and (p_date <= today or p_date > public.order_horizon(cust.organization_id)) then
    raise exception 'Ce jour n''est pas ouvert aux commandes.';
  end if;
  limit_time := public.order_limit_time(cust.organization_id);
  perform public.lock_due_menus();

  ctx := public.customer_subscription_context(cust.id, service);
  meat_ok := public.meat_allowed_ctx(ctx, service);
  first_day := ctx ->> 'state' in ('actif', 'bientot_expire') and (ctx ->> 'start_date')::date = service and service > today
               and public.is_new_start(cust.id, service);
  -- Dernier jour d'abonnement : demain il n'y a plus rien à commander, mais aujourd'hui l'abonnement court encore (pas « expiré »)
  last_day := service = today + 1 and ctx ->> 'state' = 'expire'
              and public.customer_subscription_context(cust.id, today) ->> 'state' in ('actif', 'bientot_expire');

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
  order by (dl.status = 'cancelled'), dl.id
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
      'id', menu.id, 'deadline_time', null, 'lock_time', limit_time, 'lock_date', case when limit_time is null then null else service - 1 end,
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
revoke all on function public.my_today_menu(date) from public, anon;
grant execute on function public.my_today_menu(date) to authenticated;

-- La semaine du client : un élément par jour commandable (menus publiés de demain jusqu'à la limite, plus demain s'il est ouvré)
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
      where organization_id = cust.organization_id and menu_date > today and menu_date <= horizon and menu_date <= today + 60
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
revoke all on function public.my_week_menu() from public, anon;
grant execute on function public.my_week_menu() to authenticated;

-- ─── 4. Modifier un menu déjà répondu : jamais de perte silencieuse ───
-- Retirer un plat que des clients ont choisi reste refusé, mais le message dit maintenant lesquels et combien.
create or replace function public.update_menu(p_date date, p_item_ids uuid[] default null, p_deadline time default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  org uuid := public.current_organization_id();
  menu public.daily_menus%rowtype;
  removed uuid[];
  chosen integer;
  detail text;
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  if actor is null or not public.has_permission('menus.write') then raise exception 'Permission denied'; end if;
  if p_item_ids is null and p_deadline is null then raise exception 'Aucune modification fournie'; end if;

  select * into menu from public.daily_menus where organization_id = org and menu_date = p_date for update;
  if not found then raise exception 'Aucun menu publié pour ce jour'; end if;
  if menu.status = 'locked' or public.menu_is_past_lock(org, p_date) then
    raise exception 'Ce menu est verrouillé : il ne peut plus être modifié.';
  end if;

  if p_item_ids is not null then
    perform public.assert_valid_menu_items(org, p_item_ids);
    select array_agg(o.id) into removed from public.menu_options o
    where o.daily_menu_id = menu.id and not (o.catalog_item_id = any (p_item_ids));
    if removed is not null then
      select count(*) into chosen from public.meal_orders
      where daily_menu_id = menu.id and status = 'confirmed' and not is_default
        and (plat_option_id = any (removed) or accompagnement_option_id = any (removed) or viande_option_id = any (removed));
      if chosen > 0 then
        select string_agg(t.name || ' (' || t.n || ' client' || case when t.n > 1 then 's' else '' end || ')', ', ' order by t.name) into detail
        from (
          select ci.name, count(*) as n
          from public.meal_orders o
          join public.menu_options mo on mo.id = any (removed) and mo.id in (o.plat_option_id, o.accompagnement_option_id, o.viande_option_id)
          join public.catalog_items ci on ci.id = mo.catalog_item_id
          where o.daily_menu_id = menu.id and o.status = 'confirmed' and not o.is_default
          group by ci.name
        ) t;
        raise exception 'Des clients ont déjà choisi : %. Garde ces plats sur le menu.', coalesce(detail, 'un plat retiré');
      end if;
      perform set_config('app.audit_system', 'on', true);
      delete from public.meal_orders
      where daily_menu_id = menu.id and is_default
        and (plat_option_id = any (removed) or accompagnement_option_id = any (removed) or viande_option_id = any (removed));
      perform set_config('app.audit_system', previous, true);
      delete from public.menu_options where id = any (removed);
    end if;
    insert into public.menu_options (daily_menu_id, catalog_item_id)
    select menu.id, x from unnest(p_item_ids) x group by x
    on conflict do nothing;
  end if;

  if p_deadline is not null then
    if p_deadline < time '11:00' or p_deadline > time '19:00' then
      raise exception 'L''heure limite doit être comprise entre 11:00 et 19:00.';
    end if;
    update public.daily_menus set deadline_time = p_deadline where id = menu.id;
  end if;

  perform public.refresh_default_orders(menu.id);
end;
$$;
