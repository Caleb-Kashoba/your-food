-- Fiabilisation de la planification des repas (audit du 6 octobre 2026). Migration ADDITIVE : aucune donnée existante n'est modifiée.
--  1. Une livraison annulée (abonnement suspendu ou annulé) n'a plus de commande : elle ne gonfle plus les quantités à préparer,
--     les statistiques ni le calcul du repas par défaut. Si le client a une autre livraison maintenue ce jour-là (changement
--     d'abonnement), son repas la suit. L'annulation faite par le client lui-même reste enregistrée.
--  2. Seuil de votes (réglage « default_min_votes », 5 par défaut) : un ou deux clients ne décident plus pour tous. En dessous
--     du seuil, le repas par défaut reste le premier par ordre alphabétique.
--  3. Une fois le menu verrouillé (jour du repas), une saisie de l'équipe ne réécrit plus les repas par défaut des autres clients
--     (dont les bols déjà prêts). Seuls les repas manquants sont créés, aussi pour une livraison apparue le jour même.
--  4. Un menu oublié peut être publié le matin du jour même (repas par défaut pour tous, menu verrouillé dans la minute).
--  5. Changement d'abonnement : choix déterministe de la livraison du client (plus de hasard), la saisie de l'équipe ne rétablit
--     jamais la livraison d'un abonnement annulé ou suspendu.
--  6. Le suivi du jour et le tableau de livraison ne montrent plus deux fois le même client.
--  7. Un abonnement annulé n'a plus de « reste à payer » ; sans paiement, il sort de la liste des paiements à encaisser.
--  8. « À renouveler » : liste des abonnements qui se terminent bientôt sans suite (tableau de bord) ;
--     espace client : drapeau « dernier jour d'abonnement » (l'abonnement n'est pas « expiré » avant le lendemain).

-- ─── 1. Pas de commande sur une livraison annulée par l'équipe ───
create or replace function public.drop_orders_of_cancelled_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  perform set_config('app.audit_system', 'on', true);
  -- Changement d'abonnement : si le client a une autre livraison maintenue ce jour-là, son repas la suit
  update public.meal_orders o
  set delivery_id = d2.id, subscription_id = d2.subscription_id
  from public.deliveries d2
  where o.delivery_id = new.id and d2.customer_id = new.customer_id and d2.delivery_date = new.delivery_date
    and d2.status <> 'cancelled' and d2.id <> new.id;
  -- Sinon la commande disparaît (sauf si elle est déjà notée : elle est conservée avec son avis)
  delete from public.meal_orders o
  where o.delivery_id = new.id
    and not exists (select 1 from public.meal_reviews r where r.order_id = o.id);
  perform set_config('app.audit_system', previous, true);
  return new;
end;
$$;

drop trigger if exists deliveries_drop_orders_on_cancel on public.deliveries;
create trigger deliveries_drop_orders_on_cancel
after update of status on public.deliveries
for each row
when (new.status = 'cancelled' and old.status <> 'cancelled' and new.cancellation_reason is distinct from 'customer_cancelled')
execute function public.drop_orders_of_cancelled_delivery();

revoke all on function public.drop_orders_of_cancelled_delivery() from public, anon, authenticated;

-- ─── 2. Seuil de votes pour les repas par défaut (réglage, 5 par défaut) ───
create or replace function public.default_min_votes(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select greatest((value #>> '{}')::integer, 0) from public.app_settings where organization_id = p_org and key = 'default_min_votes' limit 1), 5);
$$;
revoke all on function public.default_min_votes(uuid) from public, anon, authenticated;

-- Lecture et modification depuis l'écran des réglages
create or replace function public.get_default_min_votes()
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_member_id() is null or not public.has_permission('settings.business.write') then raise exception 'Permission denied'; end if;
  return public.default_min_votes(public.current_organization_id());
end;
$$;

create or replace function public.set_default_min_votes(p_value integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
begin
  if public.current_member_id() is null or not public.has_permission('settings.business.write') then raise exception 'Permission denied'; end if;
  if p_value is null or p_value < 0 or p_value > 100 then raise exception 'Le seuil doit être un nombre entier entre 0 et 100.'; end if;
  insert into public.app_settings (organization_id, key, value, is_technical, updated_by)
  values (org, 'default_min_votes', to_jsonb(p_value), false, public.current_member_id())
  on conflict (organization_id, key) do update set value = excluded.value, updated_by = excluded.updated_by;
  -- Les repas par défaut des menus ouverts suivent tout de suite le nouveau seuil
  perform public.refresh_open_default_orders();
  return p_value;
end;
$$;
revoke all on function public.get_default_min_votes() from public, anon;
revoke all on function public.set_default_min_votes(integer) from public, anon;
grant execute on function public.get_default_min_votes() to authenticated;
grant execute on function public.set_default_min_votes(integer) to authenticated;

-- ─── 2b. Les repas par défaut ne bougent plus après le verrouillage ───
create or replace function public.refresh_default_orders(p_menu_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.daily_menus%rowtype;
  top_plat uuid; top_acc uuid; top_viande uuid;
  min_votes integer;
  votes integer;
  created integer := 0;
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  -- Le verrou du menu passe toujours en premier (comme pour une commande de client) : pas d'interblocage
  select * into m from public.daily_menus where id = p_menu_id for update;
  if not found then return 0; end if;
  perform set_config('app.audit_system', 'on', true);

  -- Seuls les choix de clients dont la livraison est maintenue comptent comme des votes.
  -- Tant qu'une catégorie compte moins de « default_min_votes » choix (5 par défaut), un ou deux clients ne décident pas pour tous :
  -- le repas par défaut reste alors le premier par ordre alphabétique.
  min_votes := public.default_min_votes(m.organization_id);
  select count(*) into votes from public.meal_orders mo join public.deliveries d on d.id = mo.delivery_id
  where mo.daily_menu_id = m.id and mo.status = 'confirmed' and not mo.is_default and d.status <> 'cancelled' and mo.plat_option_id is not null;
  select o.id into top_plat from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
  where o.daily_menu_id = m.id and c.category = 'plat'
  order by case when votes >= min_votes then (select count(*) from public.meal_orders mo join public.deliveries d on d.id = mo.delivery_id
            where mo.daily_menu_id = m.id and mo.status = 'confirmed' and not mo.is_default and d.status <> 'cancelled' and mo.plat_option_id = o.id) else 0 end desc, c.name asc limit 1;
  select count(*) into votes from public.meal_orders mo join public.deliveries d on d.id = mo.delivery_id
  where mo.daily_menu_id = m.id and mo.status = 'confirmed' and not mo.is_default and d.status <> 'cancelled' and mo.accompagnement_option_id is not null;
  select o.id into top_acc from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
  where o.daily_menu_id = m.id and c.category = 'accompagnement'
  order by case when votes >= min_votes then (select count(*) from public.meal_orders mo join public.deliveries d on d.id = mo.delivery_id
            where mo.daily_menu_id = m.id and mo.status = 'confirmed' and not mo.is_default and d.status <> 'cancelled' and mo.accompagnement_option_id = o.id) else 0 end desc, c.name asc limit 1;
  select count(*) into votes from public.meal_orders mo join public.deliveries d on d.id = mo.delivery_id
  where mo.daily_menu_id = m.id and mo.status = 'confirmed' and not mo.is_default and d.status <> 'cancelled' and mo.viande_option_id is not null;
  select o.id into top_viande from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
  where o.daily_menu_id = m.id and c.category = 'viande'
  order by case when votes >= min_votes then (select count(*) from public.meal_orders mo join public.deliveries d on d.id = mo.delivery_id
            where mo.daily_menu_id = m.id and mo.status = 'confirmed' and not mo.is_default and d.status <> 'cancelled' and mo.viande_option_id = o.id) else 0 end desc, c.name asc limit 1;

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

  -- Menu ouvert seulement : une fois verrouillé, les repas déjà attribués (parfois déjà préparés) ne changent plus
  if m.status = 'open' then
    update public.meal_orders o
    set plat_option_id = top_plat, accompagnement_option_id = top_acc,
        viande_option_id = case when public.meat_allowed(p.meat_weekdays, m.menu_date) then top_viande end
    from public.subscriptions s join public.plans p on p.id = s.plan_id
    where o.daily_menu_id = m.id and o.is_default and o.status = 'confirmed' and s.id = o.subscription_id
      and (o.plat_option_id is distinct from top_plat or o.accompagnement_option_id is distinct from top_acc
           or o.viande_option_id is distinct from case when public.meat_allowed(p.meat_weekdays, m.menu_date) then top_viande end);
  end if;

  perform set_config('app.audit_system', previous, true);
  return created;
end;
$$;

-- ─── 3. Les menus d'aujourd'hui et des 15 prochains jours, ouverts ou verrouillés : on complète les repas manquants ───
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
    where menu_date between public.organization_local_date(organization_id) and public.organization_local_date(organization_id) + 15
  loop
    total := total + public.refresh_default_orders(rec.id);
  end loop;
  return total;
end;
$$;

-- ─── 4. Un menu oublié peut être publié le jour même ───
create or replace function public.assert_menu_publishable(p_org uuid, p_date date)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if extract(isodow from p_date) > 5 then raise exception 'Les menus ne se publient que du lundi au vendredi.'; end if;
  if p_date < public.org_local_now(p_org)::date then
    raise exception 'On ne peut plus publier de menu pour un jour passé.';
  end if;
end;
$$;


-- ─── 5. Changement d'abonnement : un seul « bon » livraison par client et par jour ───
-- Quand deux livraisons existent le même jour (ancien et nouvel abonnement), on choisit toujours celle qui est maintenue,
-- sinon celle que le client a annulée lui-même (rétablissable), sinon n'importe laquelle. Plus de choix au hasard.
create or replace function public.best_delivery(p_org uuid, p_customer uuid, p_date date)
returns public.deliveries
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.* from public.deliveries d
  where d.organization_id = p_org and d.customer_id = p_customer and d.delivery_date = p_date
  order by case when d.status <> 'cancelled' then 0 when d.cancellation_reason = 'customer_cancelled' then 1 else 2 end, d.id
  limit 1;
$$;
revoke all on function public.best_delivery(uuid, uuid, date) from public, anon, authenticated;

-- La saisie de l'équipe ne rétablit une livraison que si c'est le client qui l'avait annulée (jamais celle d'un abonnement annulé ou suspendu)
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
  select * into dl from public.best_delivery(org, p_customer, p_date);
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
  select * into dl from public.best_delivery(org, p_customer, p_date);

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

  update public.deliveries set status = 'scheduled', cancellation_reason = null where id = dl.id and status = 'cancelled' and cancellation_reason = 'customer_cancelled';
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
  select * into dl from public.best_delivery(org, p_customer, p_date);

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

-- ─── 6. Le suivi n'affiche plus deux fois le même client ───
-- Une livraison annulée (ancien abonnement) est masquée si le client a une autre livraison maintenue le même jour.
create or replace function public.orders_live(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  d date;
  menu public.daily_menus%rowtype;
begin
  if public.current_member_id() is null or not public.has_permission('orders.read') then raise exception 'Permission denied'; end if;
  d := coalesce(p_date, public.org_local_now(org)::date);
  perform public.lock_due_menus();
  select * into menu from public.daily_menus where organization_id = org and menu_date = d;

  return jsonb_build_object(
    'date', d,
    'menu_id', menu.id,
    'menu_status', case when menu.id is null then 'aucun_menu' else menu.status::text end,
    'deadline_time', menu.deadline_time,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'delivery_id', dl.id, 'customer_id', dl.customer_id, 'customer_name', dl.customer_name, 'phone', dl.phone,
        'plan_name', dl.plan_name, 'delivery_status', dl.status, 'order_id', o.id,
        'state', case
          when dl.status = 'cancelled' and o.status = 'cancelled' then 'annule'
          when dl.status = 'cancelled' then 'livraison_annulee'
          when o.id is null then 'en_attente'
          when o.is_default then 'defaut'
          else 'commande' end,
        'plat', pc.name, 'accompagnement', ac.name, 'viande', vc.name, 'prepared', dl.status in ('ready', 'out_for_delivery', 'delivered')
      ) order by dl.customer_name)
      from public.deliveries dl
      left join public.meal_orders o on o.daily_menu_id = menu.id and o.customer_id = dl.customer_id
      left join public.menu_options po on po.id = o.plat_option_id left join public.catalog_items pc on pc.id = po.catalog_item_id
      left join public.menu_options ao on ao.id = o.accompagnement_option_id left join public.catalog_items ac on ac.id = ao.catalog_item_id
      left join public.menu_options vo on vo.id = o.viande_option_id left join public.catalog_items vc on vc.id = vo.catalog_item_id
      where dl.organization_id = org and dl.delivery_date = d and not (dl.status = 'cancelled' and exists (select 1 from public.deliveries d2
        where d2.customer_id = dl.customer_id and d2.delivery_date = dl.delivery_date and d2.status <> 'cancelled'))), '[]'::jsonb),
    'tallies', coalesce((
      select jsonb_agg(jsonb_build_object('category', c.category, 'name', c.name, 'count', t.n) order by c.category, t.n desc, c.name)
      from public.menu_options o2 join public.catalog_items c on c.id = o2.catalog_item_id
      cross join lateral (select count(*) as n from public.meal_orders mo
        where mo.status = 'confirmed' and (mo.plat_option_id = o2.id or mo.accompagnement_option_id = o2.id or mo.viande_option_id = o2.id)) t
      where o2.daily_menu_id = menu.id), '[]'::jsonb));
end;
$$;

create or replace function public.deliveries_board(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
begin
  if public.current_member_id() is null or not public.has_permission('deliveries.read') then raise exception 'Permission denied'; end if;
  if p_to < p_from or p_to - p_from > 14 then raise exception 'Période invalide (14 jours au plus).'; end if;

  -- Les menus passés 20h sont verrouillés (et les repas par défaut attribués) avant de lire
  perform public.lock_due_menus();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'delivery_id', dl.id,
      'date', dl.delivery_date,
      'customer_id', dl.customer_id,
      'customer_name', dl.customer_name,
      'phone', dl.phone,
      'zone_name', dl.zone_name,
      'residence', dl.residence,
      'building', dl.building,
      'room', dl.room,
      'address_details', dl.address_details,
      'plan_name', dl.plan_name,
      'delivery_status', dl.status,
      'menu_status', case when dm.id is null then 'aucun_menu' else dm.status::text end,
      'order_id', o.id,
      'state', case
        when dl.status = 'cancelled' and o.status = 'cancelled' then 'annule'
        when dl.status = 'cancelled' then 'livraison_annulee'
        when o.id is null then 'en_attente'
        when o.is_default then 'defaut'
        else 'commande' end,
      'plat', pc.name,
      'accompagnement', ac.name,
      'viande', vc.name
    ) order by dl.delivery_date, dl.customer_name)
    from public.deliveries dl
    left join public.daily_menus dm on dm.organization_id = dl.organization_id and dm.menu_date = dl.delivery_date
    left join public.meal_orders o on o.daily_menu_id = dm.id and o.customer_id = dl.customer_id
    left join public.menu_options po on po.id = o.plat_option_id
    left join public.catalog_items pc on pc.id = po.catalog_item_id
    left join public.menu_options ao on ao.id = o.accompagnement_option_id
    left join public.catalog_items ac on ac.id = ao.catalog_item_id
    left join public.menu_options vo on vo.id = o.viande_option_id
    left join public.catalog_items vc on vc.id = vo.catalog_item_id
    where dl.organization_id = org and dl.delivery_date between p_from and p_to and not (dl.status = 'cancelled' and exists (select 1 from public.deliveries d2
        where d2.customer_id = dl.customer_id and d2.delivery_date = dl.delivery_date and d2.status <> 'cancelled'))
  ), '[]'::jsonb);
end;
$$;

-- Le repas d'aujourd'hui côté client : la livraison maintenue passe avant la livraison annulée
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
  last_day boolean;
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
  -- Dernier jour d'abonnement : demain il n'y a plus rien à commander, mais aujourd'hui l'abonnement court encore (pas « expiré »)
  last_day := ctx ->> 'state' = 'expire'
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
  menu_state := case when menu.status = 'locked' then 'verrouille' else 'normal' end;

  return jsonb_build_object(
    'date', service, 'order_date', today, 'menu_status', menu_state, 'subscription', ctx, 'meat_allowed_today', meat_ok,
    'first_day_default', first_day, 'last_day', last_day, 'today_meal', today_meal,
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

-- ─── 7. Un abonnement annulé n'a plus rien à payer ───
-- Plus de « reste à payer » ni d'impayé pour un abonnement annulé ; s'il n'a rien encaissé, son état de paiement devient « cancelled »
-- (il disparaît de la liste des paiements à encaisser). Un abonnement annulé qui a reçu de l'argent garde son montant payé.
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
  case when s.admin_status = 'cancelled' then 0 else greatest(s.applied_price - coalesce(payment_totals.amount_paid, 0), 0) end::numeric(14,2) as amount_remaining,
  case
    when s.admin_status = 'cancelled' and coalesce(payment_totals.amount_paid, 0) = 0 then 'cancelled'
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

-- ─── 8. Abonnements à renouveler (tableau de bord) ───
-- Abonnements actifs qui se terminent bientôt (même règle que « Expire bientôt » : 2 jours pour une semaine, 5 au-delà)
-- et dont le client n'a pas encore d'abonnement qui suit.
create or replace function public.subscriptions_to_renew()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
begin
  if public.current_member_id() is null or not public.has_permission('subscriptions.read') then raise exception 'Permission denied'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'subscription_id', o.id, 'customer_id', o.customer_id, 'customer_name', o.customer_name, 'phone', c.phone,
      'plan_name', o.plan_name, 'end_date', o.end_date, 'days_left', o.days_until_expiration, 'price', o.price, 'currency', o.currency
    ) order by o.end_date, o.customer_name)
    from public.subscription_overview o
    join public.customers c on c.id = o.customer_id
    where o.organization_id = org
      and o.admin_status = 'active'
      and o.effective_status in ('expiring_soon', 'expires_today')
      and not exists (select 1 from public.subscriptions s2
                      where s2.customer_id = o.customer_id and s2.id <> o.id
                        and s2.admin_status in ('pending', 'active', 'suspended') and s2.end_date > o.end_date)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.subscriptions_to_renew() from public, anon;
grant execute on function public.subscriptions_to_renew() to authenticated;
