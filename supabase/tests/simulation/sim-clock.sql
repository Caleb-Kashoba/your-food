-- Horloge simulée : les deux fonctions du dépôt qui lisent l'heure lisent d'abord le réglage « app.sim_now » (sinon now()).
create or replace function public.org_local_now(p_org uuid)
returns timestamp language sql stable security definer set search_path = public, pg_temp as $$
  select (coalesce(nullif(current_setting('app.sim_now', true), '')::timestamptz, now()) at time zone o.timezone)
  from public.organizations o where o.id = p_org;
$$;
create or replace function public.organization_local_date(org_id uuid)
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select (coalesce(nullif(current_setting('app.sim_now', true), '')::timestamptz, now()) at time zone o.timezone)::date
  from public.organizations o where o.id = org_id;
$$;
