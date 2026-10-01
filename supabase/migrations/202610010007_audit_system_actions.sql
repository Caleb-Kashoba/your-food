-- Journal d'activité : les actions du système ne sont plus attribuées à l'utilisateur qui les déclenche.
-- Défaut trouvé par la simulation d'un mois : quand le verrouillage de 20h se fait « à la lecture » (un client ouvre son menu
-- après 20h avant la tâche planifiée), les repas par défaut de TOUS les clients étaient attribués à ce client dans le journal.
-- Principe : `lock_due_menus` pose un indicateur local à la transaction ; `audit_row_change` ne mentionne alors personne
-- (le journal affiche « Système »). Le verrouillage manuel par l'administratrice reste attribué à l'administratrice.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_json jsonb;
  new_json jsonb;
  org_id uuid;
  record_id text;
  system_action boolean := coalesce(nullif(current_setting('app.audit_system', true), ''), 'off') = 'on';
begin
  if tg_op = 'INSERT' then
    new_json := to_jsonb(new);
    org_id := (new_json ->> 'organization_id')::uuid;
    record_id := new_json ->> 'id';
  elsif tg_op = 'UPDATE' then
    old_json := to_jsonb(old);
    new_json := to_jsonb(new);
    org_id := (new_json ->> 'organization_id')::uuid;
    record_id := new_json ->> 'id';
  else
    old_json := to_jsonb(old);
    org_id := (old_json ->> 'organization_id')::uuid;
    record_id := old_json ->> 'id';
  end if;

  insert into public.audit_logs (
    organization_id, actor_member_id, actor_user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    org_id,
    case when system_action then null else public.current_member_id() end,
    case when system_action then null else auth.uid() end,
    lower(tg_op), tg_table_name, record_id, old_json, new_json
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
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
  perform set_config('app.audit_system', 'on', true);
  for rec in select id from public.daily_menus where status = 'open' and public.menu_is_past_lock(organization_id, menu_date)
  loop
    total := total + public.lock_menu(rec.id);
  end loop;
  perform set_config('app.audit_system', 'off', true);
  return total;
end;
$$;

revoke all on function public.lock_due_menus() from public, anon, authenticated;
