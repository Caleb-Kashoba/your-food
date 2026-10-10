-- Statut des clients calculé sur les abonnements (10 octobre 2026). Migration ADDITIVE.
--  • Actif : le client a un abonnement en cours, à venir ou suspendu (jamais un abonnement annulé).
--  • Inactif : son dernier abonnement est fini depuis plus de 2 jours ouvrés (lundi → vendredi) et il n'en a pas d'autre.
--  • Ancien client : seulement après l'approbation de l'administratrice. Un mois (30 jours) après la fin du dernier abonnement,
--    le client inactif est proposé ; un refus reporte la prochaine proposition de 2 semaines, à chaque refus.
--  • Un nouvel abonnement remet le client en « Actif » (aussi un ancien client) et efface les refus.
--  • Un client qui n'a jamais eu d'abonnement n'est pas touché.
-- Le calcul tourne chaque nuit (00h05 à Kinshasa) et aussitôt qu'un abonnement est créé, prolongé, modifié ou annulé.

alter table public.customers
  add column if not exists status_changed_at timestamptz,
  add column if not exists former_review_at date,
  add column if not exists former_refusals integer not null default 0;

-- n-ième jour ouvré (lundi → vendredi) après une date ; les jours fériés ne sont pas pris en compte
create or replace function public.add_business_days(p_date date, p_days integer)
returns date
language plpgsql
immutable
as $$
declare
  d date := p_date;
  counted integer := 0;
begin
  while counted < p_days loop
    d := d + 1;
    if extract(isodow from d) < 6 then counted := counted + 1; end if;
  end loop;
  return d;
end;
$$;

-- Recalcule le statut d'un client ; renvoie vrai s'il a changé
create or replace function public.refresh_customer_status(p_customer uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.customers%rowtype;
  today date;
  last_end date;
  has_current boolean;
  target public.customer_status;
  previous text := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off');
begin
  select * into c from public.customers where id = p_customer and archived_at is null;
  if not found then return false; end if;
  today := public.org_local_now(c.organization_id)::date;
  select max(end_date), coalesce(bool_or(end_date >= today), false) into last_end, has_current
  from public.subscriptions where customer_id = p_customer and admin_status <> 'cancelled';
  -- Jamais abonné : on ne touche à rien
  if last_end is null then return false; end if;

  if has_current then
    target := 'active';
  elsif c.status = 'former_customer' then
    return false;
  elsif today > public.add_business_days(last_end, 2) then
    target := 'inactive';
  else
    return false;
  end if;
  if target = c.status then return false; end if;

  perform set_config('app.audit_system', 'on', true);
  update public.customers
  set status = target,
      status_changed_at = now(),
      former_review_at = case when target = 'active' then null else former_review_at end,
      former_refusals = case when target = 'active' then 0 else former_refusals end
  where id = p_customer;
  perform set_config('app.audit_system', previous, true);
  return true;
end;
$$;
revoke all on function public.refresh_customer_status(uuid) from public, anon, authenticated;

create or replace function public.refresh_customer_statuses()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  changed integer := 0;
begin
  for r in select id from public.customers where archived_at is null loop
    if public.refresh_customer_status(r.id) then changed := changed + 1; end if;
  end loop;
  return changed;
end;
$$;
revoke all on function public.refresh_customer_statuses() from public, anon, authenticated;

create or replace function public.subscriptions_refresh_customer_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_customer_status(new.customer_id);
  return null;
end;
$$;
revoke all on function public.subscriptions_refresh_customer_status() from public, anon, authenticated;

drop trigger if exists subscriptions_customer_status on public.subscriptions;
create trigger subscriptions_customer_status
  after insert or update of end_date, admin_status on public.subscriptions
  for each row execute function public.subscriptions_refresh_customer_status();

-- Clients inactifs à proposer comme « anciens clients » (un mois après la fin du dernier abonnement, sauf report)
create or replace function public.former_customer_proposals()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  today date;
begin
  if public.current_member_id() is null or not public.has_permission('customers.write') then raise exception 'Permission denied'; end if;
  today := public.org_local_now(org)::date;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'customer_id', c.id,
      'customer_name', c.first_name || ' ' || c.last_name,
      'last_end', l.last_end,
      'inactive_days', today - l.last_end,
      'refusals', c.former_refusals
    ) order by l.last_end, c.last_name)
    from public.customers c
    cross join lateral (
      select max(s.end_date) as last_end from public.subscriptions s where s.customer_id = c.id and s.admin_status <> 'cancelled'
    ) l
    where c.organization_id = org and c.archived_at is null and c.status = 'inactive'
      and l.last_end is not null and today >= l.last_end + 30
      and (c.former_review_at is null or today >= c.former_review_at)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.former_customer_proposals() from public, anon;
grant execute on function public.former_customer_proposals() to authenticated;

-- Décision de l'administratrice : approuver (ancien client) ou refuser (nouvelle proposition dans 2 semaines)
create or replace function public.decide_former_customer(p_customer uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
  actor uuid := public.current_member_id();
  today date;
  c public.customers%rowtype;
  last_end date;
begin
  if actor is null or not public.has_permission('customers.write') then raise exception 'Permission denied'; end if;
  today := public.org_local_now(org)::date;
  select * into c from public.customers where id = p_customer and organization_id = org and archived_at is null for update;
  if not found then raise exception 'Client introuvable.'; end if;
  select max(end_date) into last_end from public.subscriptions where customer_id = c.id and admin_status <> 'cancelled';
  if c.status <> 'inactive' or last_end is null or today < last_end + 30 or (c.former_review_at is not null and today < c.former_review_at) then
    raise exception 'Ce client n''est plus à confirmer.';
  end if;

  if p_approve then
    update public.customers set status = 'former_customer', status_changed_at = now(), former_review_at = null, updated_by = actor where id = c.id;
    return 'former_customer';
  end if;
  update public.customers set former_review_at = today + 14, former_refusals = former_refusals + 1, updated_by = actor where id = c.id;
  return 'reported';
end;
$$;
revoke all on function public.decide_former_customer(uuid, boolean) from public, anon;
grant execute on function public.decide_former_customer(uuid, boolean) to authenticated;

-- Calcul de nuit (00h05 à Kinshasa = 23h05 UTC) et mise à niveau immédiate des clients existants
select cron.schedule('your-food-customer-status', '5 23 * * *', $$select public.refresh_customer_statuses();$$);
select public.refresh_customer_statuses();
