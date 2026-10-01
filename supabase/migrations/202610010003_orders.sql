-- Étape 3 de la fusion : commandes des clients, verrouillage automatique à 20h, repas par défaut, avis, historique, suivi du jour.
-- Migration ADDITIVE.

create table public.meal_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null unique references public.meal_orders(id) on delete cascade,
  rating smallint check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  filled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rating is not null or comment is not null)
);
create trigger meal_reviews_updated_at before update on public.meal_reviews for each row execute function public.set_updated_at();
create trigger meal_reviews_audit after insert or update or delete on public.meal_reviews for each row execute function public.audit_row_change();
alter table public.meal_reviews enable row level security;
create policy meal_reviews_select on public.meal_reviews for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('orders.read'));
create policy meal_reviews_self_select on public.meal_reviews for select to authenticated
using (exists (select 1 from public.meal_orders o where o.id = order_id and o.customer_id = public.current_customer_id()));

-- ─── Règles communes ───
-- Viande incluse ce jour-là ? (null = tous les jours de service ; sinon liste de jours ISO, ex. {1,5})
create or replace function public.meat_allowed(p_meat_weekdays smallint[], p_date date)
returns boolean
language sql
immutable
as $$
  select p_meat_weekdays is null or extract(isodow from p_date)::smallint = any (p_meat_weekdays);
$$;

-- Viande incluse selon le contexte d'abonnement (liste de jours de la formule, ou null = tous les jours)
create or replace function public.meat_allowed_ctx(p_ctx jsonb, p_date date)
returns boolean
language sql
immutable
as $
  select case when jsonb_typeof(p_ctx -> 'meat_weekdays') = 'array'
    then extract(isodow from p_date)::int in (select x::int from jsonb_array_elements_text(p_ctx -> 'meat_weekdays') x)
    else true end;
$;

-- Situation d'abonnement d'un client à une date : période courante, sinon prochaine, sinon dernière
create or replace function public.customer_subscription_context(p_customer uuid, p_today date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.subscriptions%rowtype;
  p public.plans%rowtype;
  state text;
  left_days integer;
begin
  select * into s from public.subscriptions
  where customer_id = p_customer and admin_status in ('active', 'suspended') and start_date <= p_today and end_date >= p_today
  order by start_date desc limit 1;
  if not found then
    select * into s from public.subscriptions
    where customer_id = p_customer and admin_status in ('active', 'suspended') and start_date > p_today
    order by start_date asc limit 1;
  end if;
  if not found then
    select * into s from public.subscriptions where customer_id = p_customer order by end_date desc limit 1;
  end if;
  if not found then return jsonb_build_object('state', 'aucun'); end if;

  select * into p from public.plans where id = s.plan_id;
  select count(*) into left_days
  from generate_series(greatest(p_today, s.start_date)::timestamp, s.end_date::timestamp, interval '1 day') g
  where extract(isodow from g) <= 5;

  state := case
    when s.admin_status = 'cancelled' then 'annule'
    when s.admin_status = 'suspended' and s.start_date <= p_today and s.end_date >= p_today then 'suspendu'
    when s.start_date > p_today then 'non_commence'
    when s.end_date < p_today then 'expire'
    when left_days <= 10 then 'bientot_expire'
    else 'actif'
  end;

  return jsonb_build_object(
    'state', state, 'subscription_id', s.id, 'plan_name', s.applied_plan_name,
    'start_date', s.start_date, 'end_date', s.end_date, 'working_days_left', left_days,
    'meat_weekdays', to_jsonb(p.meat_weekdays), 'plan_id', p.id
  );
end;
$$;

-- ─── Verrouillage et repas par défaut ───
-- Verrouille un menu (une seule fois, de façon atomique) puis attribue à chaque livraison prévue sans commande
-- les options les plus demandées de chaque catégorie. Les clients qui ont annulé n'en reçoivent pas.
create or replace function public.lock_menu(p_menu_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.daily_menus%rowtype;
  top_plat uuid; top_acc uuid; top_viande uuid;
  rec record;
  created integer := 0;
begin
  update public.daily_menus set status = 'locked', locked_at = now()
  where id = p_menu_id and status = 'open'
  returning * into m;
  if not found then return 0; end if;

  select o.id into top_plat from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
  where o.daily_menu_id = m.id and c.category = 'plat'
  order by (select count(*) from public.meal_orders mo where mo.status = 'confirmed' and mo.plat_option_id = o.id) desc, c.name asc limit 1;
  select o.id into top_acc from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
  where o.daily_menu_id = m.id and c.category = 'accompagnement'
  order by (select count(*) from public.meal_orders mo where mo.status = 'confirmed' and mo.accompagnement_option_id = o.id) desc, c.name asc limit 1;
  select o.id into top_viande from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
  where o.daily_menu_id = m.id and c.category = 'viande'
  order by (select count(*) from public.meal_orders mo where mo.status = 'confirmed' and mo.viande_option_id = o.id) desc, c.name asc limit 1;

  for rec in
    select dl.id as delivery_id, dl.customer_id, dl.subscription_id, p.meat_weekdays
    from public.deliveries dl
    join public.subscriptions s on s.id = dl.subscription_id
    join public.plans p on p.id = s.plan_id
    where dl.organization_id = m.organization_id and dl.delivery_date = m.menu_date and dl.status <> 'cancelled'
      and not exists (select 1 from public.meal_orders mo where mo.daily_menu_id = m.id and mo.customer_id = dl.customer_id)
  loop
    insert into public.meal_orders (organization_id, daily_menu_id, customer_id, subscription_id, delivery_id,
                                    plat_option_id, accompagnement_option_id, viande_option_id, status, is_default)
    values (m.organization_id, m.id, rec.customer_id, rec.subscription_id, rec.delivery_id, top_plat, top_acc,
            case when public.meat_allowed(rec.meat_weekdays, m.menu_date) then top_viande end, 'confirmed', true);
    created := created + 1;
  end loop;

  return created;
end;
$$;

create or replace function public.lock_due_menus()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record;
  total integer := 0;
begin
  for rec in select id from public.daily_menus where status = 'open' and public.menu_is_past_lock(organization_id, menu_date)
  loop
    total := total + public.lock_menu(rec.id);
  end loop;
  return total;
end;
$$;

-- Verrouillage manuel par l'administratrice
create or replace function public.lock_menu_now(p_date date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  menu_id uuid;
begin
  if public.current_member_id() is null or not public.has_permission('menus.write') then raise exception 'Permission denied'; end if;
  select id into menu_id from public.daily_menus where organization_id = public.current_organization_id() and menu_date = p_date;
  if menu_id is null then raise exception 'Aucun menu publié pour ce jour'; end if;
  return public.lock_menu(menu_id);
end;
$$;

select cron.schedule('your-food-lock-menus', '* * * * *', $$select public.lock_due_menus();$$);

-- ─── Espace client ───
create or replace function public.assert_customer()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare c uuid := public.current_customer_id();
begin
  if c is null then raise exception 'Permission denied'; end if;
  return c;
end;
$$;

-- Menu du jour tel que le voit le client
create or replace function public.my_today_menu()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cust public.customers%rowtype;
  today date;
  local_now timestamp;
  ctx jsonb;
  menu public.daily_menus%rowtype;
  existing public.meal_orders%rowtype;
  prev_date date;
  review_order uuid;
  meat_ok boolean;
  menu_state text;
begin
  select * into cust from public.customers where id = public.assert_customer();
  local_now := public.org_local_now(cust.organization_id);
  today := local_now::date;
  perform public.lock_due_menus();

  ctx := public.customer_subscription_context(cust.id, today);
  meat_ok := public.meat_allowed_ctx(ctx, today);

  select * into menu from public.daily_menus where organization_id = cust.organization_id and menu_date = today;

  -- Repas du dernier jour ouvré, à noter (le lundi : celui du vendredi)
  prev_date := case extract(isodow from today) when 1 then today - 3 when 7 then today - 2 else today - 1 end;
  select o.id into review_order
  from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id
  left join public.meal_reviews r on r.order_id = o.id
  where o.customer_id = cust.id and dm.menu_date = prev_date and o.status = 'confirmed' and coalesce(r.filled, false) = false
  limit 1;

  if menu.id is null then
    return jsonb_build_object(
      'date', today, 'menu_status', 'aucun_menu', 'subscription', ctx, 'meat_allowed_today', meat_ok,
      'menu', null, 'order', null, 'review_due', case when review_order is not null then jsonb_build_object('order_id', review_order, 'date', prev_date) end,
      'server_now', now());
  end if;

  select * into existing from public.meal_orders where daily_menu_id = menu.id and customer_id = cust.id;
  menu_state := case
    when menu.status = 'locked' then 'verrouille'
    when local_now::time > menu.deadline_time then 'en_retard'
    else 'normal' end;

  return jsonb_build_object(
    'date', today, 'menu_status', menu_state, 'subscription', ctx, 'meat_allowed_today', meat_ok,
    'menu', jsonb_build_object(
      'id', menu.id, 'deadline_time', menu.deadline_time, 'lock_time', '20:00',
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

-- Vérifications communes à la commande et à l'annulation du jour
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
  if m.menu_date <> today then raise exception 'Tu ne peux commander que pour le menu du jour.'; end if;
  if m.status = 'locked' or public.menu_is_past_lock(c.organization_id, m.menu_date) then
    raise exception 'Le menu est verrouillé : les commandes sont closes.';
  end if;

  context := public.customer_subscription_context(c.id, today);
  if context ->> 'state' = 'expire' then raise exception 'Ton abonnement est expiré.'; end if;
  if context ->> 'state' = 'non_commence' then raise exception 'Ton abonnement n''a pas encore commencé.'; end if;
  if context ->> 'state' in ('suspendu', 'annule', 'aucun') then raise exception 'Ton abonnement n''est pas actif.'; end if;

  select id into d from public.deliveries
  where customer_id = c.id and delivery_date = today
    and (status <> 'cancelled' or cancellation_reason = 'customer_cancelled')
  limit 1;
  if d is null then raise exception 'Aucune livraison n''est prévue pour toi aujourd''hui.'; end if;

  return query select c, m, context, d;
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
  return order_id;
end;
$$;

-- Annuler son repas du jour, même sans commande préalable (réversible jusqu'au verrouillage)
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
  return order_id;
end;
$$;

-- Historique des repas servis (menus verrouillés), filtre par dates et recherche par plat
create or replace function public.my_history(p_from date default null, p_to date default null, p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cust uuid := public.assert_customer();
  q text := nullif(public.normalize_login_text(p_q), '');
begin
  return coalesce((
    select jsonb_agg(h.j order by h.d desc) from (
      select dm.menu_date as d, jsonb_build_object(
        'order_id', o.id, 'date', dm.menu_date, 'status', o.status, 'is_default', o.is_default,
        'plat', pc.name, 'accompagnement', ac.name, 'viande', vc.name,
        'rating', r.rating, 'comment', r.comment,
        'review_possible', o.status = 'confirmed' and coalesce(r.filled, false) = false) as j
      from public.meal_orders o
      join public.daily_menus dm on dm.id = o.daily_menu_id and dm.status = 'locked'
      left join public.menu_options po on po.id = o.plat_option_id left join public.catalog_items pc on pc.id = po.catalog_item_id
      left join public.menu_options ao on ao.id = o.accompagnement_option_id left join public.catalog_items ac on ac.id = ao.catalog_item_id
      left join public.menu_options vo on vo.id = o.viande_option_id left join public.catalog_items vc on vc.id = vo.catalog_item_id
      left join public.meal_reviews r on r.order_id = o.id
      where o.customer_id = cust
        and (p_from is null or dm.menu_date >= p_from) and (p_to is null or dm.menu_date <= p_to)
        and (q is null or public.normalize_login_text(concat_ws(' ', pc.name, ac.name, vc.name)) like '%' || q || '%')
      order by dm.menu_date desc limit 300
    ) h), '[]'::jsonb);
end;
$$;

-- Avis facultatif (note et/ou commentaire) sur un repas servi, y compris des jours plus tard
create or replace function public.submit_my_review(p_order_id uuid, p_rating smallint default null, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cust uuid := public.assert_customer();
  o public.meal_orders%rowtype;
  menu_status public.menu_status;
  clean text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into o from public.meal_orders where id = p_order_id and customer_id = cust;
  if not found then raise exception 'Commande introuvable'; end if;
  if o.status = 'cancelled' then raise exception 'Ce repas a été annulé : il n''y a rien à noter.'; end if;
  select status into menu_status from public.daily_menus where id = o.daily_menu_id;
  if menu_status <> 'locked' then raise exception 'Tu pourras donner ton avis une fois le repas servi.'; end if;
  if p_rating is null and clean is null then raise exception 'Ajoute une note ou un commentaire'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then raise exception 'La note doit être comprise entre 1 et 5.'; end if;
  if clean is not null and char_length(clean) > 1000 then raise exception 'Le commentaire est trop long.'; end if;

  insert into public.meal_reviews (organization_id, order_id, rating, comment)
  values (o.organization_id, o.id, p_rating, clean)
  on conflict (order_id) do update
  set rating = coalesce(excluded.rating, public.meal_reviews.rating),
      comment = coalesce(excluded.comment, public.meal_reviews.comment), filled = true;
end;
$$;

-- ─── Espace administratrice ───
-- Suivi d'un jour : une ligne par livraison prévue, avec l'état de la commande
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
      where dl.organization_id = org and dl.delivery_date = d), '[]'::jsonb),
    'tallies', coalesce((
      select jsonb_agg(jsonb_build_object('category', c.category, 'name', c.name, 'count', t.n) order by c.category, t.n desc, c.name)
      from public.menu_options o2 join public.catalog_items c on c.id = o2.catalog_item_id
      cross join lateral (select count(*) as n from public.meal_orders mo
        where mo.status = 'confirmed' and (mo.plat_option_id = o2.id or mo.accompagnement_option_id = o2.id or mo.viande_option_id = o2.id)) t
      where o2.daily_menu_id = menu.id), '[]'::jsonb));
end;
$$;

create or replace function public.admin_reviews()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'review_id', r.id, 'customer_name', concat_ws(' ', c.first_name, c.last_name), 'date', dm.menu_date,
    'rating', r.rating, 'comment', r.comment,
    'meal', concat_ws(' · ', pc.name, ac.name, vc.name), 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
  from public.meal_reviews r
  join public.meal_orders o on o.id = r.order_id
  join public.customers c on c.id = o.customer_id
  join public.daily_menus dm on dm.id = o.daily_menu_id
  left join public.menu_options po on po.id = o.plat_option_id left join public.catalog_items pc on pc.id = po.catalog_item_id
  left join public.menu_options ao on ao.id = o.accompagnement_option_id left join public.catalog_items ac on ac.id = ao.catalog_item_id
  left join public.menu_options vo on vo.id = o.viande_option_id left join public.catalog_items vc on vc.id = vo.catalog_item_id
  where r.organization_id = public.current_organization_id() and r.filled and public.has_permission('orders.read');
$$;

-- Droits d'exécution
revoke all on function public.meat_allowed(smallint[], date) from public, anon;
revoke all on function public.meat_allowed_ctx(jsonb, date) from public, anon;
revoke all on function public.customer_subscription_context(uuid, date) from public, anon, authenticated;
revoke all on function public.lock_menu(uuid) from public, anon, authenticated;
revoke all on function public.lock_due_menus() from public, anon, authenticated;
revoke all on function public.lock_menu_now(date) from public, anon;
revoke all on function public.assert_customer() from public, anon, authenticated;
revoke all on function public.my_today_menu() from public, anon;
revoke all on function public.prepare_customer_order(uuid) from public, anon, authenticated;
revoke all on function public.submit_my_order(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.cancel_my_order(uuid) from public, anon;
revoke all on function public.my_history(date, date, text) from public, anon;
revoke all on function public.submit_my_review(uuid, smallint, text) from public, anon;
revoke all on function public.orders_live(date) from public, anon;
revoke all on function public.admin_reviews() from public, anon;

grant execute on function public.lock_menu_now(date) to authenticated;
grant execute on function public.my_today_menu() to authenticated;
grant execute on function public.submit_my_order(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.cancel_my_order(uuid) to authenticated;
grant execute on function public.my_history(date, date, text) to authenticated;
grant execute on function public.submit_my_review(uuid, smallint, text) to authenticated;
grant execute on function public.orders_live(date) to authenticated;
grant execute on function public.admin_reviews() to authenticated;
