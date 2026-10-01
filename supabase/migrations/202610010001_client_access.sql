-- Étape 1 de la fusion : accès des clients (connexion « Prénom Nom », codes d'activation, lecture de leurs propres données).
-- Migration ADDITIVE : rien n'est supprimé ni renommé, aucune donnée n'est insérée (la production a déjà ses formules, etc.).

-- 1. Le téléphone devient facultatif (les numéros existants sont conservés)
alter table public.customers alter column phone drop not null;
alter table public.deliveries alter column phone drop not null;

-- 2. Identifiant de connexion « prénom nom » normalisé (minuscules, sans accents, espaces simples)
create or replace function public.normalize_login_text(p_text text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
    lower(translate(
      coalesce(p_text, ''),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy'
    )),
    '\s+', ' ', 'g'
  ));
$$;

alter table public.customers
  add column auth_user_id uuid unique references auth.users(id) on delete set null,
  add column login_key text generated always as (
    public.normalize_login_text(first_name || ' ' || last_name)
  ) stored;

create index customers_login_key_idx on public.customers(organization_id, login_key);

-- E-mail technique du compte Auth d'un client (jamais montré au client)
create or replace function public.customer_tech_email(p_customer_id uuid)
returns text
language sql
immutable
as $$
  select 'c-' || p_customer_id::text || '@clients.yourfood.invalid';
$$;

-- 3. Formules : jours de viande (null = viande tous les jours de service ; ex. {1,5} = lundi et vendredi)
alter table public.plans add column meat_weekdays smallint[];

-- 4. Codes d'accès (activation du compte ou réinitialisation du mot de passe)
create type public.access_code_type as enum ('activation', 'reset');

create table public.customer_access_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  type public.access_code_type not null default 'activation',
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.organization_members(id),
  used_at timestamptz
);

-- Un seul code ouvert par client à la fois
create unique index customer_one_open_code on public.customer_access_codes(customer_id) where used_at is null;

alter table public.customer_access_codes enable row level security;

create policy access_codes_select on public.customer_access_codes for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('customers.write'));

grant select on public.customer_access_codes to authenticated;

-- Code de 8 caractères sans ambiguïté (32 symboles : pas de 0, 1, I, O)
create or replace function public.generate_access_code()
returns text
language plpgsql
volatile
set search_path = public, extensions, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
begin
  for i in 1..8 loop
    result := result || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1);
  end loop;
  return result;
end;
$$;

-- 5. Administratrice : émettre (ou renvoyer) le code d'un client
create or replace function public.issue_customer_access_code(
  p_customer_id uuid,
  p_type public.access_code_type default 'activation'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
  customer_record public.customers%rowtype;
  open_code public.customer_access_codes%rowtype;
  new_code text;
begin
  if actor_id is null or not public.has_permission('customers.write') then raise exception 'Permission denied'; end if;

  select * into customer_record from public.customers
  where id = p_customer_id and organization_id = public.current_organization_id() and archived_at is null;
  if not found then raise exception 'Customer not found'; end if;

  if p_type = 'activation' and customer_record.auth_user_id is not null then
    raise exception 'This account is already activated';
  end if;
  if p_type = 'reset' and customer_record.auth_user_id is null then
    raise exception 'This account is not activated yet';
  end if;

  select * into open_code from public.customer_access_codes where customer_id = p_customer_id and used_at is null;
  -- Renvoi d'une activation : le même code (jamais régénéré tant qu'il n'est pas utilisé)
  if found and open_code.type = 'activation' and p_type = 'activation' and open_code.attempts < 10 then
    return open_code.code;
  end if;
  if found then
    update public.customer_access_codes set used_at = now() where id = open_code.id;
  end if;

  new_code := public.generate_access_code();
  insert into public.customer_access_codes (organization_id, customer_id, code, type, created_by)
  values (customer_record.organization_id, p_customer_id, new_code, p_type, actor_id);

  insert into public.audit_logs (organization_id, actor_member_id, action, entity_type, entity_id, new_data)
  values (customer_record.organization_id, actor_id, 'customer_access_code_issued', 'customer', p_customer_id::text,
          jsonb_build_object('type', p_type));

  return new_code;
end;
$$;

-- Administratrice : codes manquants pour tous les clients sans compte (envoi groupé par WhatsApp)
create or replace function public.issue_missing_access_codes()
returns table (customer_id uuid, first_name text, last_name text, phone text, code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid;
begin
  if public.current_member_id() is null or not public.has_permission('customers.write') then raise exception 'Permission denied'; end if;

  for target in
    select c.id from public.customers c
    where c.organization_id = public.current_organization_id()
      and c.auth_user_id is null and c.archived_at is null and c.status = 'active'
    order by c.last_name, c.first_name
  loop
    perform public.issue_customer_access_code(target, 'activation');
  end loop;

  return query
  select c.id, c.first_name, c.last_name, c.phone, k.code
  from public.customers c
  join public.customer_access_codes k on k.customer_id = c.id and k.used_at is null and k.type = 'activation'
  where c.organization_id = public.current_organization_id() and c.auth_user_id is null
  order by c.last_name, c.first_name;
end;
$$;

-- 6. Public (avant connexion) : retrouver un client à partir de « Prénom Nom » (+ 4 derniers chiffres si homonymes)
create or replace function public.resolve_customer_login(p_login text, p_last4 text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  key text := public.normalize_login_text(p_login);
  matches uuid[];
  chosen public.customers%rowtype;
begin
  if key = '' then return jsonb_build_object('status', 'not_found'); end if;

  select array_agg(c.id) into matches
  from public.customers c
  where c.login_key = key and c.archived_at is null and c.status = 'active';

  if matches is null then return jsonb_build_object('status', 'not_found'); end if;

  if cardinality(matches) > 1 then
    if p_last4 is null or btrim(p_last4) = '' then
      return jsonb_build_object('status', 'need_last4');
    end if;
    select array_agg(c.id) into matches
    from public.customers c
    where c.id = any (matches)
      and right(regexp_replace(coalesce(c.phone_normalized, ''), '[^0-9]', '', 'g'), 4) = regexp_replace(p_last4, '[^0-9]', '', 'g');
    if matches is null or cardinality(matches) <> 1 then
      return jsonb_build_object('status', 'not_found');
    end if;
  end if;

  select * into chosen from public.customers where id = matches[1];
  return jsonb_build_object(
    'status', 'ok',
    'customer_id', chosen.id,
    'first_name', chosen.first_name,
    'activated', chosen.auth_user_id is not null,
    'email', public.customer_tech_email(chosen.id)
  );
end;
$$;

-- Public : vérifier un code sans le consommer (étape 1 de la première connexion). 10 essais maximum par code.
create or replace function public.verify_customer_access_code(p_login text, p_code text, p_last4 text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved jsonb := public.resolve_customer_login(p_login, p_last4);
  open_code public.customer_access_codes%rowtype;
  clean_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
begin
  if resolved ->> 'status' <> 'ok' then return resolved; end if;

  select * into open_code from public.customer_access_codes
  where customer_id = (resolved ->> 'customer_id')::uuid and used_at is null;
  if not found or open_code.attempts >= 10 then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  if open_code.code <> clean_code then
    update public.customer_access_codes set attempts = attempts + 1 where id = open_code.id;
    return jsonb_build_object('status', 'invalid_code');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'customer_id', resolved ->> 'customer_id',
    'first_name', resolved ->> 'first_name',
    'type', open_code.type
  );
end;
$$;

-- Réservé à l'Edge Function (service_role) : consommer le code et lier le compte Auth au client
create or replace function public.complete_customer_access(p_customer_id uuid, p_code text, p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  open_code public.customer_access_codes%rowtype;
begin
  select * into open_code from public.customer_access_codes
  where customer_id = p_customer_id and used_at is null for update;
  if not found or open_code.attempts >= 10 or open_code.code <> upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) then
    raise exception 'Invalid access code';
  end if;

  update public.customer_access_codes set used_at = now() where id = open_code.id;
  update public.customers set auth_user_id = p_auth_user_id where id = p_customer_id and auth_user_id is null;

  insert into public.audit_logs (organization_id, action, entity_type, entity_id, new_data)
  values (open_code.organization_id, 'customer_access_completed', 'customer', p_customer_id::text,
          jsonb_build_object('type', open_code.type));
end;
$$;

-- 7. Un client connecté ne lit que ses propres données
create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id from public.customers c where c.auth_user_id = auth.uid() limit 1;
$$;

create policy customers_self_select on public.customers for select to authenticated
using (id = public.current_customer_id());
create policy subscriptions_self_select on public.subscriptions for select to authenticated
using (customer_id = public.current_customer_id());
create policy subscription_days_self_select on public.subscription_service_days for select to authenticated
using (exists (select 1 from public.subscriptions s where s.id = subscription_id and s.customer_id = public.current_customer_id()));
create policy deliveries_self_select on public.deliveries for select to authenticated
using (customer_id = public.current_customer_id());
create policy payments_self_select on public.payments for select to authenticated
using (customer_id = public.current_customer_id());

-- Qui suis-je ? (personnel de l'organisation, client, ou personne) : décide quel espace afficher
create or replace function public.my_context()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.current_member_id() is not null
      then jsonb_build_object('kind', 'member', 'role', public.current_role_name())
    when public.current_customer_id() is not null
      then jsonb_build_object('kind', 'customer', 'customer_id', public.current_customer_id())
    else jsonb_build_object('kind', 'none')
  end;
$$;

-- 8. Droits d'exécution
revoke all on function public.generate_access_code() from public, anon, authenticated;
revoke all on function public.issue_customer_access_code(uuid, public.access_code_type) from public, anon;
revoke all on function public.issue_missing_access_codes() from public, anon;
revoke all on function public.resolve_customer_login(text, text) from public;
revoke all on function public.verify_customer_access_code(text, text, text) from public;
revoke all on function public.complete_customer_access(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.current_customer_id() from public, anon;
revoke all on function public.my_context() from public, anon;

grant execute on function public.issue_customer_access_code(uuid, public.access_code_type) to authenticated;
grant execute on function public.issue_missing_access_codes() to authenticated;
grant execute on function public.resolve_customer_login(text, text) to anon, authenticated;
grant execute on function public.verify_customer_access_code(text, text, text) to anon, authenticated;
grant execute on function public.complete_customer_access(uuid, text, uuid) to service_role;
grant execute on function public.current_customer_id() to authenticated;
grant execute on function public.my_context() to authenticated;
