-- Numérotation des bols et abonnements plus simples à enchaîner (retours du 9 octobre 2026). Migration ADDITIVE.
--  1. Bols numérotés : au verrouillage du menu (minuit), chaque bol reçoit un numéro, dans l'ordre plat → accompagnement → viande
--     → client. Les numéros ne bougent plus ensuite ; un bol ajouté après coup prend le numéro suivant. Le tableau « Aujourd'hui »
--     et le suivi du jour affichent le numéro et trient par plat.
--  2. Abonnements : on peut créer l'abonnement SUIVANT pendant que l'actuel court encore (jamais deux en même temps, et un seul
--     abonnement à venir). « Renouveler » avec une autre formule crée la suite à partir du lundi qui suit la fin de l'actuel.
--  3. Changer la formule d'un abonnement en cours (motif obligatoire) : prix recalculé, viande des repas à venir ajustée.
--  4. Sécurité : les fonctions de gestion ne sont plus appelables sans être connecté (elles refusaient déjà, par principe).
--  5. « Premier jour » (repas attribué d'office) réservé aux vrais nouveaux clients : un client qui enchaîne choisit son repas.

-- ─── 1. Numéros de bols ───
alter table public.deliveries add column if not exists bowl_number integer;
create index if not exists deliveries_bowl_idx on public.deliveries(organization_id, delivery_date, bowl_number);

create or replace function public.assign_bowl_numbers(p_org uuid, p_date date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  start_at integer;
  assigned integer := 0;
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  if not exists (select 1 from public.daily_menus where organization_id = p_org and menu_date = p_date and status = 'locked') then
    return 0;
  end if;
  -- Rien à numéroter : on ne touche à rien (lecture fréquente du tableau)
  if not exists (
    select 1 from public.deliveries dl
    join public.daily_menus dm on dm.organization_id = dl.organization_id and dm.menu_date = dl.delivery_date
    join public.meal_orders o on o.daily_menu_id = dm.id and o.customer_id = dl.customer_id and o.status = 'confirmed'
    where dl.organization_id = p_org and dl.delivery_date = p_date and dl.status <> 'cancelled' and dl.bowl_number is null
  ) then
    return 0;
  end if;

  select coalesce(max(bowl_number), 0) into start_at from public.deliveries where organization_id = p_org and delivery_date = p_date;
  perform set_config('app.audit_system', 'on', true);
  with todo as (
    select dl.id, row_number() over (order by pc.name, ac.name, vc.name nulls last, dl.customer_name, dl.id) as rn
    from public.deliveries dl
    join public.daily_menus dm on dm.organization_id = dl.organization_id and dm.menu_date = dl.delivery_date
    join public.meal_orders o on o.daily_menu_id = dm.id and o.customer_id = dl.customer_id and o.status = 'confirmed'
    left join public.menu_options po on po.id = o.plat_option_id left join public.catalog_items pc on pc.id = po.catalog_item_id
    left join public.menu_options ao on ao.id = o.accompagnement_option_id left join public.catalog_items ac on ac.id = ao.catalog_item_id
    left join public.menu_options vo on vo.id = o.viande_option_id left join public.catalog_items vc on vc.id = vo.catalog_item_id
    where dl.organization_id = p_org and dl.delivery_date = p_date and dl.status <> 'cancelled' and dl.bowl_number is null
  )
  update public.deliveries d set bowl_number = start_at + todo.rn from todo where d.id = todo.id;
  get diagnostics assigned = row_count;
  perform set_config('app.audit_system', previous, true);
  return assigned;
end;
$$;
revoke all on function public.assign_bowl_numbers(uuid, date) from public, anon, authenticated;

create or replace function public.lock_menu(p_menu_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.daily_menus%rowtype;
  created integer;
begin
  update public.daily_menus set status = 'locked', locked_at = now()
  where id = p_menu_id and status = 'open'
  returning * into m;
  if not found then return 0; end if;
  created := public.refresh_default_orders(m.id);
  -- Les bols sont numérotés dès le verrouillage, triés par plat
  perform public.assign_bowl_numbers(m.organization_id, m.menu_date);
  return created;
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
  -- Menus verrouillés : chaque bol reçoit son numéro (les livraisons ajoutées après coup prennent les numéros suivants)
  perform public.assign_bowl_numbers(org, dm.menu_date) from public.daily_menus dm
  where dm.organization_id = org and dm.menu_date between p_from and p_to and dm.status = 'locked';

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
      'bowl_number', dl.bowl_number,
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
    ) order by dl.delivery_date, dl.bowl_number nulls last, pc.name, ac.name, vc.name, dl.customer_name)
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
  if menu.status = 'locked' then perform public.assign_bowl_numbers(org, d); end if;

  return jsonb_build_object(
    'date', d,
    'menu_id', menu.id,
    'menu_status', case when menu.id is null then 'aucun_menu' else menu.status::text end,
    'deadline_time', menu.deadline_time,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'delivery_id', dl.id, 'customer_id', dl.customer_id, 'customer_name', dl.customer_name, 'phone', dl.phone,
        'plan_name', dl.plan_name, 'delivery_status', dl.status, 'order_id', o.id, 'bowl_number', dl.bowl_number,
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

-- ─── 2. Abonnements : l'abonnement suivant peut être préparé pendant que l'actuel court ───
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

  -- Jamais deux abonnements en même temps (contrôle ci-dessus) ; à la suite de l'abonnement en cours, un seul abonnement à venir
  -- (par exemple une autre formule à partir du lundi suivant) : pour en changer, on le rallonge ou on le modifie.
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
      -- Autre formule : un nouvel abonnement commence le lundi qui suit la fin de l'abonnement en cours
      base := last_sub.end_date + 1;
      start_day := coalesce(p_start, base + ((8 - extract(isodow from base)::int) % 7));
      return public.create_subscription_weeks(p_customer, p_plan, start_day, p_weeks, p_total_price, null, last_sub.id);
    end if;
    -- Même formule : on rallonge l'abonnement en cours
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

-- ─── 3. Changer la formule d'un abonnement en cours ou à venir ───
alter table public.subscription_changes drop constraint if exists subscription_changes_action_check;
alter table public.subscription_changes add constraint subscription_changes_action_check
  check (action in ('extended', 'modified', 'deleted', 'plan_changed'));

create or replace function public.change_subscription_plan(p_subscription uuid, p_plan uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  org uuid := public.current_organization_id();
  s public.subscriptions%rowtype;
  pl public.plans%rowtype;
  today date;
  weekly numeric;
  weeks integer;
  new_price numeric;
  paid numeric;
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  if actor is null or not public.has_permission('subscriptions.write') then raise exception 'Permission denied'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Indique la raison du changement.'; end if;
  select * into s from public.subscriptions where id = p_subscription and organization_id = org for update;
  if not found then raise exception 'Abonnement introuvable.'; end if;
  if s.admin_status = 'cancelled' then raise exception 'Un abonnement annulé ne se modifie pas.'; end if;
  today := public.org_local_now(org)::date;
  if s.end_date < today then raise exception 'Cet abonnement est terminé : crée-en un nouveau avec la formule voulue.'; end if;
  select * into pl from public.plans where id = p_plan and organization_id = org and is_active;
  if not found then raise exception 'Formule introuvable ou désactivée.'; end if;
  if pl.id = s.plan_id then raise exception 'L''abonnement a déjà cette formule.'; end if;

  weekly := pl.price / (pl.duration_value * case pl.duration_unit when 'month' then 4 else 1 end);
  weeks := case when s.applied_duration_unit = 'week' then s.applied_duration_value
                else greatest(1, ceil((s.end_date - s.start_date + 1) / 7.0)::integer) end;
  new_price := weekly * weeks;
  select coalesce(sum(amount), 0) into paid from public.payments where subscription_id = s.id and status = 'confirmed';
  if paid > new_price then
    raise exception 'Les paiements déjà reçus (%) dépassent le prix avec la nouvelle formule (%) : annule d''abord un paiement.', paid, new_price;
  end if;

  update public.subscriptions
  set plan_id = pl.id, applied_plan_name = pl.name, applied_price = new_price,
      plan_snapshot = coalesce(plan_snapshot, '{}'::jsonb) || jsonb_build_object('name', pl.name, 'weekly_price', weekly, 'price_overridden', false,
                                                                                 'meat_weekdays', to_jsonb(pl.meat_weekdays)),
      updated_by = actor
  where id = s.id;
  update public.deliveries set plan_name = pl.name where subscription_id = s.id and delivery_date >= today;

  -- Repas des menus encore ouverts : un choix du client dont la viande ne correspond plus à la formule redevient « par défaut »
  -- (le client le voit et peut choisir à nouveau) ; les repas par défaut sont recalculés avec la nouvelle formule.
  perform set_config('app.audit_system', 'on', true);
  update public.meal_orders o set is_default = true
  from public.daily_menus dm
  where dm.id = o.daily_menu_id and dm.status = 'open' and o.subscription_id = s.id and o.status = 'confirmed' and not o.is_default
    and ((o.viande_option_id is null) = public.meat_allowed(pl.meat_weekdays, dm.menu_date));
  perform set_config('app.audit_system', previous, true);
  perform public.refresh_default_orders(dm.id) from public.daily_menus dm
  where dm.organization_id = org and dm.status = 'open' and dm.menu_date >= today;

  insert into public.subscription_changes (organization_id, subscription_id, customer_id, action, reason, details, created_by)
  values (org, s.id, s.customer_id, 'plan_changed', btrim(p_reason),
          jsonb_build_object('plan_before', s.applied_plan_name, 'plan_after', pl.name, 'price_before', s.applied_price, 'price_after', new_price), actor);
  return s.id;
end;
$$;
revoke all on function public.change_subscription_plan(uuid, uuid, text) from public, anon;
grant execute on function public.change_subscription_plan(uuid, uuid, text) to authenticated;

-- ─── 4. Fonctions de gestion : plus appelables sans être connecté ───
-- Elles vérifiaient déjà les droits ; on retire en plus l'accès anonyme (signalé par le contrôle de sécurité de Supabase).
do $grants$
declare
  f text;
begin
  foreach f in array array[
    'public.cancel_payment(uuid, text)',
    'public.change_member_role(uuid, public.app_role_name)',
    'public.create_plan_with_schedule(uuid, text, text, numeric, text, integer, public.duration_unit, integer[])',
    'public.dashboard_metrics()',
    'public.generate_deliveries_for_subscription(uuid)',
    'public.generate_subscription_alerts(date)',
    'public.record_payment(uuid, uuid, uuid, numeric, text, uuid, text, date, text)',
    'public.set_member_status(uuid, public.member_status)',
    'public.set_role_permission(public.app_role_name, text, boolean)',
    'public.set_subscription_status(uuid, public.subscription_admin_status, text)',
    'public.update_alert_status(uuid, public.alert_status)',
    'public.update_delivery_status(uuid, public.delivery_status)',
    'public.update_plan_with_schedule(uuid, text, text, numeric, text, integer, public.duration_unit, integer[], boolean)',
    'public.update_subscription_notes(uuid, text)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end
$grants$;

-- ─── 5. « Premier jour » : seulement pour un vrai nouveau client ───
-- Un client dont un abonnement (même annulé) se terminait juste avant (le vendredi pour un début le lundi) n'est pas nouveau :
-- il choisit son repas du premier jour la veille, comme d'habitude. Seul un nouveau client reçoit d'office le repas par défaut.
create or replace function public.is_new_start(p_customer uuid, p_start date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.subscriptions s
    where s.customer_id = p_customer and s.start_date < p_start and s.end_date >= p_start - 4
  );
$$;
revoke all on function public.is_new_start(uuid, date) from public, anon, authenticated;

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
  if m.menu_date <> today + 1 then raise exception 'Tu commandes le repas de demain, la veille.'; end if;
  if m.status = 'locked' or public.menu_is_past_lock(c.organization_id, m.menu_date) then
    raise exception 'Le menu est verrouillé : les commandes sont closes.';
  end if;

  context := public.customer_subscription_context(c.id, m.menu_date);
  if context ->> 'state' = 'expire' then raise exception 'Ton abonnement est expiré.'; end if;
  if context ->> 'state' = 'non_commence' then raise exception 'Ton abonnement n''a pas encore commencé.'; end if;
  if context ->> 'state' in ('suspendu', 'annule', 'aucun') then raise exception 'Ton abonnement n''est pas actif.'; end if;
  if (context ->> 'start_date')::date > today and public.is_new_start(c.id, (context ->> 'start_date')::date) then
    raise exception 'Ton abonnement commence demain : ton premier repas est attribué automatiquement.';
  end if;

  select id into d from public.deliveries
  where customer_id = c.id and delivery_date = m.menu_date
    and (status <> 'cancelled' or cancellation_reason = 'customer_cancelled')
  order by (status = 'cancelled'), id
  limit 1;
  if d is null then raise exception 'Aucune livraison n''est prévue pour toi demain.'; end if;

  return query select c, m, context, d;
end;
$$;

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
  first_day := ctx ->> 'state' in ('actif', 'bientot_expire') and (ctx ->> 'start_date')::date > today
               and public.is_new_start(cust.id, (ctx ->> 'start_date')::date);
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
