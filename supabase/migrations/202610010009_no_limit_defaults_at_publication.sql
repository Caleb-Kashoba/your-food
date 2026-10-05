-- Plus de limite de commande pour le lancement, et repas par défaut dès la publication du menu. Migration ADDITIVE.
--  1. Plus d'heure limite (11 h–19 h) ni de verrouillage à 20 h : le client peut choisir ou changer son repas de demain
--     pendant toute la journée de la veille. Le menu se verrouille au début de son jour (00 h 00), ce qui garde l'historique,
--     les avis et les statistiques. La limite se règlera plus tard : réglage `order_limit_time` (ex. « 20:00 »), vide = aucune.
--  2. Tous les clients attendus ont un repas par défaut DÈS la publication : pour chaque catégorie, l'option la plus choisie
--     (les repas par défaut ne comptent pas comme des choix ; égalité ou aucun choix : ordre alphabétique ; la viande seulement
--     si la formule l'inclut ce jour-là). Les repas par défaut suivent les choix au fil de l'eau (à chaque commande, annulation,
--     modification du menu, et chaque minute pour les nouveaux abonnements).

-- ─── 1. La limite de commande est un réglage (aucune pour l'instant) ───
create or replace function public.order_limit_time(p_org uuid)
returns time
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(btrim(value #>> '{}'), '')::time from public.app_settings where organization_id = p_org and key = 'order_limit_time' limit 1;
$$;

create or replace function public.menu_is_past_lock(p_org uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.order_limit_time(p_org) is null then public.org_local_now(p_org)::date >= p_date
    else public.org_local_now(p_org) >= ((p_date - 1) + public.order_limit_time(p_org))::timestamp
  end;
$$;

-- ─── 2. Repas par défaut : créés à la publication, recalculés au fil des choix ───
-- Renvoie le nombre de repas par défaut CRÉÉS (les existants sont mis à jour si l'option la plus choisie a changé).
create or replace function public.refresh_default_orders(p_menu_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.daily_menus%rowtype;
  top_plat uuid; top_acc uuid; top_viande uuid;
  created integer := 0;
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  -- Le verrou du menu passe toujours en premier (comme pour une commande de client) : pas d'interblocage
  select * into m from public.daily_menus where id = p_menu_id for update;
  if not found then return 0; end if;
  perform set_config('app.audit_system', 'on', true);

  select o.id into top_plat from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
  where o.daily_menu_id = m.id and c.category = 'plat'
  order by (select count(*) from public.meal_orders mo where mo.daily_menu_id = m.id and mo.status = 'confirmed' and not mo.is_default and mo.plat_option_id = o.id) desc, c.name asc limit 1;
  select o.id into top_acc from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
  where o.daily_menu_id = m.id and c.category = 'accompagnement'
  order by (select count(*) from public.meal_orders mo where mo.daily_menu_id = m.id and mo.status = 'confirmed' and not mo.is_default and mo.accompagnement_option_id = o.id) desc, c.name asc limit 1;
  select o.id into top_viande from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
  where o.daily_menu_id = m.id and c.category = 'viande'
  order by (select count(*) from public.meal_orders mo where mo.daily_menu_id = m.id and mo.status = 'confirmed' and not mo.is_default and mo.viande_option_id = o.id) desc, c.name asc limit 1;

  insert into public.meal_orders (organization_id, daily_menu_id, customer_id, subscription_id, delivery_id,
                                  plat_option_id, accompagnement_option_id, viande_option_id, status, is_default)
  select m.organization_id, m.id, dl.customer_id, dl.subscription_id, dl.id, top_plat, top_acc,
         case when public.meat_allowed(p.meat_weekdays, m.menu_date) then top_viande end, 'confirmed', true
  from public.deliveries dl
  join public.subscriptions s on s.id = dl.subscription_id
  join public.plans p on p.id = s.plan_id
  where dl.organization_id = m.organization_id and dl.delivery_date = m.menu_date and dl.status <> 'cancelled'
    and not exists (select 1 from public.meal_orders mo where mo.daily_menu_id = m.id and mo.customer_id = dl.customer_id)
  on conflict (daily_menu_id, customer_id) do nothing;
  get diagnostics created = row_count;

  update public.meal_orders o
  set plat_option_id = top_plat, accompagnement_option_id = top_acc,
      viande_option_id = case when public.meat_allowed(p.meat_weekdays, m.menu_date) then top_viande end
  from public.subscriptions s join public.plans p on p.id = s.plan_id
  where o.daily_menu_id = m.id and o.is_default and o.status = 'confirmed' and s.id = o.subscription_id
    and (o.plat_option_id is distinct from top_plat or o.accompagnement_option_id is distinct from top_acc
         or o.viande_option_id is distinct from case when public.meat_allowed(p.meat_weekdays, m.menu_date) then top_viande end);

  perform set_config('app.audit_system', previous, true);
  return created;
end;
$$;

-- Menus ouverts des 15 prochains jours : crée les repas par défaut qui manquent (nouvel abonnement, livraison rétablie…)
create or replace function public.refresh_open_default_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record;
  total integer := 0;
begin
  for rec in
    select id from public.daily_menus
    where status = 'open' and menu_date between public.organization_local_date(organization_id) and public.organization_local_date(organization_id) + 15
  loop
    total := total + public.refresh_default_orders(rec.id);
  end loop;
  return total;
end;
$$;

-- Le verrouillage ne crée plus rien de nouveau : il fige le menu et complète ce qui manquerait
create or replace function public.lock_menu(p_menu_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.daily_menus%rowtype;
begin
  update public.daily_menus set status = 'locked', locked_at = now()
  where id = p_menu_id and status = 'open'
  returning * into m;
  if not found then return 0; end if;
  return public.refresh_default_orders(m.id);
end;
$$;

select cron.schedule('your-food-refresh-defaults', '* * * * *', $$select public.refresh_open_default_orders();$$);

-- ─── Les repas par défaut suivent chaque changement ───
create or replace function public.publish_menu(p_date date, p_item_ids uuid[], p_deadline time default '13:00')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  org uuid := public.current_organization_id();
  new_id uuid;
begin
  if actor is null or not public.has_permission('menus.write') then raise exception 'Permission denied'; end if;
  perform public.assert_menu_publishable(org, p_date);
  perform public.assert_valid_menu_items(org, p_item_ids);
  if exists (select 1 from public.daily_menus where organization_id = org and menu_date = p_date) then
    raise exception 'Un menu est déjà publié pour le % : modifie-le plutôt.', p_date;
  end if;
  if p_deadline < time '11:00' or p_deadline > time '19:00' then
    raise exception 'L''heure limite doit être comprise entre 11:00 et 19:00.';
  end if;

  insert into public.daily_menus (organization_id, menu_date, deadline_time, created_by)
  values (org, p_date, p_deadline, actor) returning id into new_id;
  insert into public.menu_options (daily_menu_id, catalog_item_id)
  select new_id, x from unnest(p_item_ids) x group by x;
  perform public.refresh_default_orders(new_id);
  return new_id;
end;
$$;

create or replace function public.publish_menus(p_start date, p_days integer, p_item_ids uuid[], p_deadline time default '13:00')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  org uuid := public.current_organization_id();
  d date := p_start;
  counted integer := 0;
  created date[] := '{}';
  ignored date[] := '{}';
  new_id uuid;
begin
  if actor is null or not public.has_permission('menus.write') then raise exception 'Permission denied'; end if;
  if p_days < 1 or p_days > 30 then raise exception 'Le nombre de jours doit être compris entre 1 et 30.'; end if;
  perform public.assert_menu_publishable(org, p_start);
  perform public.assert_valid_menu_items(org, p_item_ids);
  if p_deadline < time '11:00' or p_deadline > time '19:00' then
    raise exception 'L''heure limite doit être comprise entre 11:00 et 19:00.';
  end if;

  while counted < p_days loop
    if extract(isodow from d) <= 5 then
      counted := counted + 1;
      if exists (select 1 from public.daily_menus where organization_id = org and menu_date = d) then
        ignored := ignored || d;
      else
        insert into public.daily_menus (organization_id, menu_date, deadline_time, created_by)
        values (org, d, p_deadline, actor) returning id into new_id;
        insert into public.menu_options (daily_menu_id, catalog_item_id)
        select new_id, x from unnest(p_item_ids) x group by x;
        perform public.refresh_default_orders(new_id);
        created := created || d;
      end if;
    end if;
    d := d + 1;
  end loop;

  return jsonb_build_object('created', to_jsonb(created), 'ignored', to_jsonb(ignored));
end;
$$;

-- Modifier un menu à venir. Un plat choisi PAR UN CLIENT ne peut pas être retiré ; les repas par défaut sont recalculés.
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
        raise exception 'Des clients ont déjà choisi un des plats que tu retires. Garde-le sur le menu.';
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

-- Désactiver un plat : il quitte les menus à venir (sauf s'il a été choisi par un client, ou s'il est la seule option de sa catégorie)
create or replace function public.update_catalog_item(
  p_id uuid,
  p_name text default null,
  p_category public.meal_category default null,
  p_active boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  item public.catalog_items%rowtype;
  today date;
  removed text[] := '{}';
  kept text[] := '{}';
  touched uuid[] := '{}';
  opt record;
  chosen integer;
  same_category integer;
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  if actor is null or not public.has_permission('menus.write') then raise exception 'Permission denied'; end if;
  select * into item from public.catalog_items
  where id = p_id and organization_id = public.current_organization_id() and not is_deleted for update;
  if not found then raise exception 'Plat introuvable dans le catalogue'; end if;
  if p_name is not null and btrim(p_name) = '' then raise exception 'Donne un nom au plat.'; end if;

  if p_category is not null and p_category <> item.category
     and exists (select 1 from public.menu_options where catalog_item_id = p_id) then
    raise exception 'Ce plat a déjà été proposé sur un menu : on ne peut plus changer sa catégorie. Crée plutôt un nouveau plat.';
  end if;

  update public.catalog_items
  set name = coalesce(btrim(p_name), name),
      category = coalesce(p_category, category),
      is_active = coalesce(p_active, is_active),
      updated_by = actor
  where id = p_id;

  if p_active = false and item.is_active then
    today := public.org_local_now(item.organization_id)::date;
    for opt in
      select o.id as option_id, m.menu_date, m.id as menu_id
      from public.menu_options o join public.daily_menus m on m.id = o.daily_menu_id
      where o.catalog_item_id = p_id and m.status = 'open' and m.menu_date > today
    loop
      select count(*) into chosen from public.meal_orders
      where daily_menu_id = opt.menu_id and status = 'confirmed' and not is_default
        and (plat_option_id = opt.option_id or accompagnement_option_id = opt.option_id or viande_option_id = opt.option_id);
      select count(*) into same_category from public.menu_options o2
      join public.catalog_items c2 on c2.id = o2.catalog_item_id
      where o2.daily_menu_id = opt.menu_id and c2.category = item.category;
      if chosen > 0 or same_category <= 1 then
        kept := kept || opt.menu_date::text;
      else
        perform set_config('app.audit_system', 'on', true);
        delete from public.meal_orders
        where daily_menu_id = opt.menu_id and is_default
          and (plat_option_id = opt.option_id or accompagnement_option_id = opt.option_id or viande_option_id = opt.option_id);
        perform set_config('app.audit_system', previous, true);
        delete from public.menu_options where id = opt.option_id;
        removed := removed || opt.menu_date::text;
        touched := touched || opt.menu_id;
      end if;
    end loop;
    for opt in select distinct x as menu_id from unnest(touched) x loop
      perform public.refresh_default_orders(opt.menu_id);
    end loop;
  end if;

  return jsonb_build_object('removed_menus', to_jsonb(removed), 'kept_menus', to_jsonb(kept));
end;
$$;

create or replace function public.submit_my_order(
  p_menu_id uuid, p_plat uuid, p_accompagnement uuid, p_viande uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prep record;
  meat_ok boolean;
  order_id uuid;
begin
  select * into prep from public.prepare_customer_order(p_menu_id);

  if not exists (select 1 from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
                 where o.id = p_plat and o.daily_menu_id = p_menu_id and c.category = 'plat')
     or not exists (select 1 from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
                    where o.id = p_accompagnement and o.daily_menu_id = p_menu_id and c.category = 'accompagnement') then
    raise exception 'Choisis un plat et un accompagnement de ce menu.';
  end if;

  meat_ok := public.meat_allowed_ctx(prep.ctx, (prep.menu).menu_date);

  if meat_ok then
    if p_viande is null or not exists (select 1 from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
                                       where o.id = p_viande and o.daily_menu_id = p_menu_id and c.category = 'viande') then
      raise exception 'Choisis une viande de ce menu.';
    end if;
  elsif p_viande is not null then
    raise exception 'La viande n''est pas incluse dans ta formule aujourd''hui.';
  end if;

  insert into public.meal_orders (organization_id, daily_menu_id, customer_id, subscription_id, delivery_id,
                                  plat_option_id, accompagnement_option_id, viande_option_id, status, is_default)
  values ((prep.cust).organization_id, p_menu_id, (prep.cust).id, (prep.ctx ->> 'subscription_id')::uuid, prep.delivery_id,
          p_plat, p_accompagnement, p_viande, 'confirmed', false)
  on conflict (daily_menu_id, customer_id) do update
  set plat_option_id = excluded.plat_option_id, accompagnement_option_id = excluded.accompagnement_option_id,
      viande_option_id = excluded.viande_option_id, status = 'confirmed', is_default = false, delivery_id = excluded.delivery_id
  returning id into order_id;

  update public.deliveries set status = 'scheduled', cancellation_reason = null
  where id = prep.delivery_id and status = 'cancelled' and cancellation_reason = 'customer_cancelled';
  perform public.refresh_default_orders(p_menu_id);
  return order_id;
end;
$$;

create or replace function public.cancel_my_order(p_menu_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prep record;
  order_id uuid;
begin
  select * into prep from public.prepare_customer_order(p_menu_id);

  insert into public.meal_orders (organization_id, daily_menu_id, customer_id, subscription_id, delivery_id, status, is_default)
  values ((prep.cust).organization_id, p_menu_id, (prep.cust).id, (prep.ctx ->> 'subscription_id')::uuid, prep.delivery_id, 'cancelled', false)
  on conflict (daily_menu_id, customer_id) do update
  set plat_option_id = null, accompagnement_option_id = null, viande_option_id = null, status = 'cancelled', is_default = false
  returning id into order_id;

  update public.deliveries set status = 'cancelled', cancellation_reason = 'customer_cancelled'
  where id = prep.delivery_id and status not in ('delivered', 'cancelled');
  perform public.refresh_default_orders(p_menu_id);
  return order_id;
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
  perform public.refresh_default_orders(menu_id);
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
  perform public.refresh_default_orders((info ->> 'menu_id')::uuid);
  return order_id;
end;
$$;

-- ─── Espace client : plus d'heure limite affichée ; le repas par défaut est proposé tout de suite ───
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
  limit_time time;
begin
  select * into cust from public.customers where id = public.assert_customer();
  local_now := public.org_local_now(cust.organization_id);
  today := local_now::date;
  service := today + 1;
  limit_time := public.order_limit_time(cust.organization_id);
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
  menu_state := case when menu.status = 'locked' then 'verrouille' else 'normal' end;

  return jsonb_build_object(
    'date', service, 'order_date', today, 'menu_status', menu_state, 'subscription', ctx, 'meat_allowed_today', meat_ok,
    'first_day_default', first_day, 'today_meal', today_meal,
    'menu', jsonb_build_object(
      'id', menu.id, 'deadline_time', null, 'lock_time', limit_time, 'lock_date', case when limit_time is null then null else today end,
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

revoke all on function public.order_limit_time(uuid) from public, anon, authenticated;
revoke all on function public.refresh_default_orders(uuid) from public, anon, authenticated;
revoke all on function public.refresh_open_default_orders() from public, anon, authenticated;
