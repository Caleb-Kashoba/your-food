-- Étape 2 de la fusion : carte des plats, menus du jour, table des commandes.
-- Migration ADDITIVE (nouvelles tables, fonctions et permissions uniquement).

create type public.meal_category as enum ('plat', 'accompagnement', 'viande');
create type public.menu_status as enum ('open', 'locked');
create type public.order_status as enum ('confirmed', 'cancelled');

-- Nouvelles permissions, accordées aux rôles existants
insert into public.permissions (code, description) values
  ('menus.read', 'Consulter la carte et les menus'),
  ('menus.write', 'Gérer la carte et publier les menus'),
  ('orders.read', 'Consulter les commandes, le suivi du jour et les avis')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('menus.read', 'menus.write', 'orders.read')
where r.name in ('root', 'admin', 'manager')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('menus.read', 'orders.read')
where r.name = 'staff'
on conflict do nothing;

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category public.meal_category not null,
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.organization_members(id),
  updated_by uuid references public.organization_members(id)
);
create index catalog_items_org_idx on public.catalog_items(organization_id, category, is_deleted);

create table public.daily_menus (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  menu_date date not null,
  deadline_time time not null default '13:00' check (deadline_time between time '11:00' and time '19:00'),
  status public.menu_status not null default 'open',
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.organization_members(id),
  unique (organization_id, menu_date),
  check (extract(isodow from menu_date) between 1 and 5)
);

create table public.menu_options (
  id uuid primary key default gen_random_uuid(),
  daily_menu_id uuid not null references public.daily_menus(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  unique (daily_menu_id, catalog_item_id)
);
create index menu_options_item_idx on public.menu_options(catalog_item_id);

create table public.meal_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  daily_menu_id uuid not null references public.daily_menus(id),
  customer_id uuid not null references public.customers(id),
  subscription_id uuid not null references public.subscriptions(id),
  delivery_id uuid references public.deliveries(id),
  plat_option_id uuid references public.menu_options(id),
  accompagnement_option_id uuid references public.menu_options(id),
  viande_option_id uuid references public.menu_options(id),
  status public.order_status not null default 'confirmed',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_menu_id, customer_id),
  check (
    (status = 'cancelled' and plat_option_id is null and accompagnement_option_id is null
       and viande_option_id is null and not is_default)
    or (status = 'confirmed' and plat_option_id is not null and accompagnement_option_id is not null)
  )
);
create index meal_orders_menu_idx on public.meal_orders(daily_menu_id, status);
create index meal_orders_customer_idx on public.meal_orders(customer_id, created_at desc);

create trigger catalog_items_updated_at before update on public.catalog_items for each row execute function public.set_updated_at();
create trigger daily_menus_updated_at before update on public.daily_menus for each row execute function public.set_updated_at();
create trigger meal_orders_updated_at before update on public.meal_orders for each row execute function public.set_updated_at();

create trigger catalog_items_audit after insert or update or delete on public.catalog_items for each row execute function public.audit_row_change();
create trigger daily_menus_audit after insert or update or delete on public.daily_menus for each row execute function public.audit_row_change();
create trigger meal_orders_audit after insert or update or delete on public.meal_orders for each row execute function public.audit_row_change();

alter table public.catalog_items enable row level security;
alter table public.daily_menus enable row level security;
alter table public.menu_options enable row level security;
alter table public.meal_orders enable row level security;

-- Lecture réservée au personnel ; toute écriture passe par les fonctions ci-dessous
create policy catalog_items_select on public.catalog_items for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('menus.read'));
create policy daily_menus_select on public.daily_menus for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('menus.read'));
create policy menu_options_select on public.menu_options for select to authenticated
using (exists (select 1 from public.daily_menus m where m.id = daily_menu_id
               and m.organization_id = public.current_organization_id()) and public.has_permission('menus.read'));
create policy meal_orders_select on public.meal_orders for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('orders.read'));
create policy meal_orders_self_select on public.meal_orders for select to authenticated
using (customer_id = public.current_customer_id());

-- ─── Outils horaires (fuseau de l'organisation) ───
create or replace function public.org_local_now(p_org uuid)
returns timestamp
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (now() at time zone o.timezone) from public.organizations o where o.id = p_org;
$$;

create or replace function public.menu_is_past_lock(p_org uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.org_local_now(p_org) >= (p_date + time '20:00')::timestamp;
$$;

-- Un menu compte au moins un plat, un accompagnement et une viande actifs, sans maximum
create or replace function public.assert_valid_menu_items(p_org uuid, p_item_ids uuid[])
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  wanted integer := (select count(distinct x) from unnest(p_item_ids) x);
  found_items integer;
begin
  select count(*) into found_items from public.catalog_items
  where organization_id = p_org and id = any (p_item_ids) and is_active and not is_deleted;
  if wanted = 0 or found_items <> wanted then
    raise exception 'Un ou plusieurs plats sont introuvables ou désactivés.';
  end if;
  if (select count(distinct category) from public.catalog_items where id = any (p_item_ids)) < 3 then
    raise exception 'Un menu doit contenir au moins un plat, un accompagnement et une viande.';
  end if;
end;
$$;

create or replace function public.assert_menu_publishable(p_org uuid, p_date date)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if extract(isodow from p_date) > 5 then raise exception 'Les menus ne se publient que du lundi au vendredi.'; end if;
  if p_date < public.org_local_now(p_org)::date or public.menu_is_past_lock(p_org, p_date) then
    raise exception 'On ne peut plus publier de menu pour ce jour : il est trop tard.';
  end if;
end;
$$;

-- ─── Carte des plats ───
create or replace function public.create_catalog_item(p_category public.meal_category, p_name text, p_active boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  new_id uuid;
begin
  if actor is null or not public.has_permission('menus.write') then raise exception 'Permission denied'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Donne un nom au plat.'; end if;
  insert into public.catalog_items (organization_id, category, name, is_active, created_by, updated_by)
  values (public.current_organization_id(), p_category, btrim(p_name), coalesce(p_active, true), actor, actor)
  returning id into new_id;
  return new_id;
end;
$$;

-- Modifier un plat. Désactivé, il quitte les menus à venir (après aujourd'hui), sauf s'il a déjà été choisi
-- ou s'il est la seule option de sa catégorie sur ce menu.
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
  opt record;
  chosen integer;
  same_category integer;
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
      where status = 'confirmed' and (plat_option_id = opt.option_id or accompagnement_option_id = opt.option_id or viande_option_id = opt.option_id);
      select count(*) into same_category from public.menu_options o2
      join public.catalog_items c2 on c2.id = o2.catalog_item_id
      where o2.daily_menu_id = opt.menu_id and c2.category = item.category;
      if chosen > 0 or same_category <= 1 then
        kept := kept || opt.menu_date::text;
      else
        delete from public.menu_options where id = opt.option_id;
        removed := removed || opt.menu_date::text;
      end if;
    end loop;
  end if;

  return jsonb_build_object('removed_menus', to_jsonb(removed), 'kept_menus', to_jsonb(kept));
end;
$$;

-- Supprimer un plat : refusé s'il est sur un menu non verrouillé, supprimé en douceur s'il a déjà été servi,
-- définitivement sinon.
create or replace function public.delete_catalog_item(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_member_id();
  item public.catalog_items%rowtype;
  open_menu_date date;
begin
  if actor is null or not public.has_permission('menus.write') then raise exception 'Permission denied'; end if;
  select * into item from public.catalog_items
  where id = p_id and organization_id = public.current_organization_id() and not is_deleted for update;
  if not found then raise exception 'Plat introuvable dans le catalogue'; end if;

  select min(m.menu_date) into open_menu_date
  from public.menu_options o join public.daily_menus m on m.id = o.daily_menu_id
  where o.catalog_item_id = p_id and m.status = 'open';
  if open_menu_date is not null then
    raise exception 'PLAT_SUR_MENU_OUVERT' using detail = open_menu_date::text;
  end if;

  if exists (select 1 from public.menu_options where catalog_item_id = p_id) then
    update public.catalog_items set is_deleted = true, is_active = false, updated_by = actor where id = p_id;
  else
    delete from public.catalog_items where id = p_id;
  end if;

  return jsonb_build_object('remaining',
    (select count(*) from public.catalog_items where organization_id = item.organization_id and not is_deleted));
end;
$$;

create or replace function public.list_catalog()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'category', c.category, 'name', c.name, 'is_active', c.is_active,
    'next_menus', coalesce((
      select jsonb_agg(m.menu_date order by m.menu_date)
      from public.menu_options o join public.daily_menus m on m.id = o.daily_menu_id
      where o.catalog_item_id = c.id and m.status = 'open'), '[]'::jsonb)
  ) order by c.category, c.is_active desc, c.name), '[]'::jsonb)
  from public.catalog_items c
  where c.organization_id = public.current_organization_id() and not c.is_deleted
    and public.has_permission('menus.read');
$$;

-- ─── Menus ───
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
  return new_id;
end;
$$;

-- Même menu sur plusieurs jours ouvrés ; les jours déjà publiés sont ignorés
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
        created := created || d;
      end if;
    end if;
    d := d + 1;
  end loop;

  return jsonb_build_object('created', to_jsonb(created), 'ignored', to_jsonb(ignored));
end;
$$;

-- Modifier un menu à venir : heure limite et/ou plats. Un plat déjà choisi par un client ne peut pas être retiré.
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
      where daily_menu_id = menu.id and status = 'confirmed'
        and (plat_option_id = any (removed) or accompagnement_option_id = any (removed) or viande_option_id = any (removed));
      if chosen > 0 then
        raise exception 'Des clients ont déjà choisi un des plats que tu retires. Garde-le sur le menu.';
      end if;
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
end;
$$;

-- Jours ouvrés d'une plage, publiés ou non, avec livraisons attendues et commandes reçues
create or replace function public.list_menu_week(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(t.j order by (t.j ->> 'date')), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'date', d::date,
      'published', m.id is not null,
      'menu_id', m.id,
      'status', m.status,
      'deadline_time', m.deadline_time,
      'options', coalesce((
        select jsonb_agg(jsonb_build_object('option_id', o.id, 'item_id', c.id, 'name', c.name, 'category', c.category)
                         order by c.category, c.name)
        from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
        where o.daily_menu_id = m.id), '[]'::jsonb),
      'expected_deliveries', (
        select count(*) from public.deliveries dl
        where dl.organization_id = public.current_organization_id() and dl.delivery_date = d::date and dl.status <> 'cancelled'),
      'orders_received', (
        select count(*) from public.meal_orders mo where mo.daily_menu_id = m.id and mo.status = 'confirmed')
    ) as j
    from generate_series(p_from::timestamp, least(p_to, p_from + 61)::timestamp, interval '1 day') d
    left join public.daily_menus m
      on m.organization_id = public.current_organization_id() and m.menu_date = d::date
    where extract(isodow from d) <= 5
  ) t
  where public.has_permission('menus.read');
$$;

-- Droits d'exécution
revoke all on function public.org_local_now(uuid) from public, anon, authenticated;
revoke all on function public.menu_is_past_lock(uuid, date) from public, anon, authenticated;
revoke all on function public.assert_valid_menu_items(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.assert_menu_publishable(uuid, date) from public, anon, authenticated;
revoke all on function public.create_catalog_item(public.meal_category, text, boolean) from public, anon;
revoke all on function public.update_catalog_item(uuid, text, public.meal_category, boolean) from public, anon;
revoke all on function public.delete_catalog_item(uuid) from public, anon;
revoke all on function public.list_catalog() from public, anon;
revoke all on function public.publish_menu(date, uuid[], time) from public, anon;
revoke all on function public.publish_menus(date, integer, uuid[], time) from public, anon;
revoke all on function public.update_menu(date, uuid[], time) from public, anon;
revoke all on function public.list_menu_week(date, date) from public, anon;

grant execute on function public.create_catalog_item(public.meal_category, text, boolean) to authenticated;
grant execute on function public.update_catalog_item(uuid, text, public.meal_category, boolean) to authenticated;
grant execute on function public.delete_catalog_item(uuid) to authenticated;
grant execute on function public.list_catalog() to authenticated;
grant execute on function public.publish_menu(date, uuid[], time) to authenticated;
grant execute on function public.publish_menus(date, integer, uuid[], time) to authenticated;
grant execute on function public.update_menu(date, uuid[], time) to authenticated;
grant execute on function public.list_menu_week(date, date) to authenticated;
