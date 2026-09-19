begin;

insert into public.organizations (id, name, default_currency, timezone, phone_country)
values ('11111111-1111-4111-8111-111111111111', 'Your Food', 'CDF', 'Africa/Kinshasa', 'CD');

insert into public.roles (name, display_name, hierarchy_level) values
  ('root', 'Root technique', 100),
  ('admin', 'Administrateur', 80),
  ('manager', 'Manager', 50),
  ('staff', 'Personnel', 20);

insert into public.permissions (code, description) values
  ('dashboard.read', 'Consulter le tableau de bord'),
  ('users.read', 'Consulter les utilisateurs'),
  ('users.create', 'Inviter des utilisateurs'),
  ('users.update', 'Activer ou désactiver des utilisateurs'),
  ('users.change_role', 'Modifier les rôles autorisés'),
  ('customers.read', 'Consulter les clients'),
  ('customers.write', 'Créer et modifier les clients'),
  ('subscriptions.read', 'Consulter les formules et abonnements'),
  ('subscriptions.write', 'Gérer les formules et abonnements'),
  ('deliveries.read', 'Consulter les livraisons'),
  ('deliveries.update', 'Mettre à jour les livraisons'),
  ('payments.read', 'Consulter les paiements'),
  ('payments.write', 'Créer et annuler les paiements'),
  ('finances.read', 'Consulter les finances'),
  ('finances.write', 'Gérer les finances'),
  ('stock.read', 'Consulter les stocks'),
  ('stock.write', 'Gérer les stocks'),
  ('reports.read', 'Consulter les rapports'),
  ('settings.business.write', 'Gérer les paramètres métier'),
  ('alerts.manage', 'Gérer les alertes'),
  ('system.audit.read', 'Consulter tout le journal d’audit'),
  ('system.settings.write', 'Gérer les paramètres techniques critiques'),
  ('system.root.manage', 'Gérer les utilisateurs root');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'root';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
  and p.code not in ('system.audit.read', 'system.settings.write', 'system.root.manage');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = any (array[
  'dashboard.read', 'users.read', 'customers.read', 'customers.write',
  'subscriptions.read', 'subscriptions.write', 'deliveries.read', 'deliveries.update',
  'payments.read', 'payments.write', 'finances.read', 'reports.read', 'alerts.manage'
])
where r.name = 'manager';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = any (array[
  'dashboard.read', 'customers.read', 'subscriptions.read', 'deliveries.read',
  'deliveries.update', 'payments.read'
])
where r.name = 'staff';

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id
  from public.organization_members m
  where m.user_id = auth.uid() and m.status = 'active'
  order by m.created_at
  limit 1;
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = auth.uid() and m.status = 'active'
  order by m.created_at
  limit 1;
$$;

create or replace function public.current_role_name()
returns public.app_role_name
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.name
  from public.organization_members m
  join public.roles r on r.id = m.role_id
  where m.id = public.current_member_id()
  limit 1;
$$;

create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.role_permissions rp on rp.role_id = m.role_id
    join public.permissions p on p.id = rp.permission_id
    where m.id = public.current_member_id()
      and p.code = permission_code
  );
$$;

create or replace function public.organization_local_date(org_id uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (now() at time zone o.timezone)::date
  from public.organizations o
  where o.id = org_id;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, 'Utilisateur'), '@', 1)),
    new.email
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger auth_user_profile_created
after insert or update of email on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.bootstrap_first_root()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_user_id uuid := auth.uid();
  default_org_id uuid := '11111111-1111-4111-8111-111111111111';
  root_role_id uuid;
  auth_email text;
  auth_name text;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtext('your-food-bootstrap-root'));

  if exists (
    select 1 from public.organization_members m
    join public.roles r on r.id = m.role_id
    where r.name = 'root' and m.status = 'active'
  ) then
    raise exception 'A root user already exists';
  end if;

  select email, coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(email, 'Root'), '@', 1))
  into auth_email, auth_name
  from auth.users
  where id = actor_user_id;

  insert into public.profiles (id, display_name, email)
  values (actor_user_id, auth_name, auth_email)
  on conflict (id) do update set display_name = excluded.display_name, email = excluded.email;

  select id into root_role_id from public.roles where name = 'root';

  insert into public.organization_members (organization_id, user_id, role_id, status)
  values (default_org_id, actor_user_id, root_role_id, 'active')
  on conflict (organization_id, user_id)
  do update set role_id = excluded.role_id, status = 'active';
end;
$$;

create or replace function public.protect_root_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_role public.app_role_name;
  new_role public.app_role_name;
  actor_role public.app_role_name;
  active_root_count integer;
begin
  select name into old_role from public.roles where id = old.role_id;
  if tg_op = 'UPDATE' then
    select name into new_role from public.roles where id = new.role_id;
  end if;
  actor_role := public.current_role_name();

  if old_role = 'root' and auth.uid() is not null and actor_role is distinct from 'root' then
    raise exception 'Only a root can modify a root user';
  end if;

  if tg_op = 'UPDATE' and new_role = 'root' and old_role <> 'root'
     and auth.uid() is not null and actor_role is distinct from 'root' then
    raise exception 'Only a root can assign the root role';
  end if;

  if old_role = 'root' and old.status = 'active'
     and (tg_op = 'DELETE' or new.status <> 'active' or new_role <> 'root') then
    perform pg_advisory_xact_lock(hashtext('your-food-root-protection:' || old.organization_id::text));
    select count(*) into active_root_count
    from public.organization_members m
    join public.roles r on r.id = m.role_id
    where m.organization_id = old.organization_id
      and m.status = 'active'
      and r.name = 'root'
      and m.id <> old.id;

    if active_root_count = 0 then
      raise exception 'The last active root cannot be removed, disabled or demoted';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_root_member_before_change
before update or delete on public.organization_members
for each row execute function public.protect_root_member();

create or replace function public.change_member_role(p_target_member_id uuid, p_new_role public.app_role_name)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
  actor_role public.app_role_name := public.current_role_name();
  actor_level smallint;
  target_record record;
  next_role_id uuid;
  next_role_level smallint;
begin
  if actor_id is null or not public.has_permission('users.change_role') then
    raise exception 'Permission denied';
  end if;

  select r.hierarchy_level into actor_level
  from public.organization_members m join public.roles r on r.id = m.role_id
  where m.id = actor_id;

  select m.*, r.name as role_name, r.hierarchy_level as role_level into target_record
  from public.organization_members m
  join public.roles r on r.id = m.role_id
  where m.id = p_target_member_id
    and m.organization_id = public.current_organization_id()
  for update;

  if not found then raise exception 'Member not found'; end if;

  if actor_role <> 'root' and (
    target_record.role_name in ('root', 'admin') or p_new_role in ('root', 'admin')
  ) then
    raise exception 'Only a root can manage admin and root roles';
  end if;

  select id, hierarchy_level into next_role_id, next_role_level from public.roles where name = p_new_role;
  if actor_role <> 'root' and (
    target_record.role_level >= actor_level or next_role_level >= actor_level
  ) then
    raise exception 'You cannot manage or assign a role at or above your own level';
  end if;

  if p_new_role = 'root' and actor_role <> 'root' then
    raise exception 'Only a root can assign the root role';
  end if;

  update public.organization_members set role_id = next_role_id where id = p_target_member_id;

  insert into public.role_change_audit (
    organization_id, actor_member_id, target_member_id, old_role, new_role
  ) values (
    target_record.organization_id, actor_id, p_target_member_id, target_record.role_name, p_new_role
  );

  insert into public.audit_logs (
    organization_id, actor_member_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    target_record.organization_id,
    actor_id,
    'role_change',
    'organization_member',
    p_target_member_id::text,
    jsonb_build_object('role', target_record.role_name),
    jsonb_build_object('role', p_new_role)
  );
end;
$$;

create or replace function public.set_member_status(p_target_member_id uuid, p_status public.member_status)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
  actor_role public.app_role_name := public.current_role_name();
  actor_level smallint;
  target_record record;
begin
  if actor_id is null or not public.has_permission('users.update') then
    raise exception 'Permission denied';
  end if;

  select r.hierarchy_level into actor_level
  from public.organization_members m join public.roles r on r.id = m.role_id
  where m.id = actor_id;

  select m.*, r.name as role_name, r.hierarchy_level as role_level into target_record
  from public.organization_members m
  join public.roles r on r.id = m.role_id
  where m.id = p_target_member_id
    and m.organization_id = public.current_organization_id()
  for update;

  if not found then raise exception 'Member not found'; end if;
  if p_target_member_id = actor_id and p_status = 'disabled' then raise exception 'You cannot disable your own account'; end if;
  if actor_role <> 'root' and target_record.role_name in ('root', 'admin') then
    raise exception 'Only a root can manage admin and root accounts';
  end if;
  if actor_role <> 'root' and target_record.role_level >= actor_level then
    raise exception 'You cannot manage an account at or above your own role level';
  end if;

  update public.organization_members set status = p_status where id = p_target_member_id;

  insert into public.audit_logs (
    organization_id, actor_member_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    target_record.organization_id,
    actor_id,
    'member_status_change',
    'organization_member',
    p_target_member_id::text,
    jsonb_build_object('status', target_record.status),
    jsonb_build_object('status', p_status)
  );
end;
$$;

create or replace function public.set_role_permission(
  p_role_name public.app_role_name,
  p_permission_code text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := public.current_member_id();
  target_role_id uuid;
  target_permission_id uuid;
begin
  if actor_id is null or public.current_role_name() <> 'root' or not public.has_permission('system.root.manage') then
    raise exception 'Only a root can manage global permissions';
  end if;
  if p_role_name = 'root' then
    raise exception 'Root permissions are immutable';
  end if;
  if p_permission_code like 'system.%' then
    raise exception 'System permissions are reserved for root users';
  end if;

  select id into target_role_id from public.roles where name = p_role_name;
  select id into target_permission_id from public.permissions where code = p_permission_code;
  if target_role_id is null or target_permission_id is null then raise exception 'Role or permission not found'; end if;

  if p_enabled then
    insert into public.role_permissions (role_id, permission_id)
    values (target_role_id, target_permission_id)
    on conflict do nothing;
  else
    delete from public.role_permissions
    where role_id = target_role_id and permission_id = target_permission_id;
  end if;

  insert into public.audit_logs (
    organization_id, actor_member_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    public.current_organization_id(), actor_id, 'permission_change', 'role_permission',
    p_role_name::text || ':' || p_permission_code,
    jsonb_build_object('enabled', not p_enabled), jsonb_build_object('enabled', p_enabled)
  );
end;
$$;

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.organization_members enable row level security;
alter table public.role_change_audit enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.customers enable row level security;
alter table public.plans enable row level security;
alter table public.plan_service_days enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_service_days enable row level security;
alter table public.subscription_pauses enable row level security;
alter table public.deliveries enable row level security;
alter table public.payment_methods enable row level security;
alter table public.payments enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alerts enable row level security;
alter table public.message_templates enable row level security;

create policy organizations_select on public.organizations for select to authenticated
using (id = public.current_organization_id());
create policy profiles_select on public.profiles for select to authenticated
using (id = auth.uid() or public.has_permission('users.read'));
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());
create policy roles_select on public.roles for select to authenticated
using (public.current_member_id() is not null);
create policy permissions_select on public.permissions for select to authenticated
using (public.current_member_id() is not null);
create policy role_permissions_select on public.role_permissions for select to authenticated
using (public.current_member_id() is not null);
create policy members_select on public.organization_members for select to authenticated
using (organization_id = public.current_organization_id() and (user_id = auth.uid() or public.has_permission('users.read')));
create policy role_audit_select on public.role_change_audit for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('system.audit.read'));
create policy audit_logs_select on public.audit_logs for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('system.audit.read'));
create policy settings_select on public.app_settings for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (not is_technical or public.has_permission('system.settings.write'))
);
create policy settings_update on public.app_settings for update to authenticated
using (
  organization_id = public.current_organization_id()
  and ((not is_technical and public.has_permission('settings.business.write')) or public.has_permission('system.settings.write'))
)
with check (
  organization_id = public.current_organization_id()
  and ((not is_technical and public.has_permission('settings.business.write')) or public.has_permission('system.settings.write'))
);
create policy zones_select on public.delivery_zones for select to authenticated
using (organization_id = public.current_organization_id() and (public.has_permission('customers.read') or public.has_permission('deliveries.read')));
create policy zones_write on public.delivery_zones for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'))
with check (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'));
create policy customers_select on public.customers for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('customers.read'));
create policy customers_insert on public.customers for insert to authenticated
with check (organization_id = public.current_organization_id() and public.has_permission('customers.write'));
create policy customers_update on public.customers for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('customers.write'))
with check (organization_id = public.current_organization_id() and public.has_permission('customers.write'));
create policy plans_select on public.plans for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('subscriptions.read'));
create policy plans_update on public.plans for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'))
with check (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'));
create policy plan_days_select on public.plan_service_days for select to authenticated
using (exists (select 1 from public.plans p where p.id = plan_id and p.organization_id = public.current_organization_id()) and public.has_permission('subscriptions.read'));
create policy subscriptions_select on public.subscriptions for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('subscriptions.read'));
create policy subscription_days_select on public.subscription_service_days for select to authenticated
using (exists (select 1 from public.subscriptions s where s.id = subscription_id and s.organization_id = public.current_organization_id()) and public.has_permission('subscriptions.read'));
create policy pauses_select on public.subscription_pauses for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('subscriptions.read'));
create policy deliveries_select on public.deliveries for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('deliveries.read'));
create policy payment_methods_select on public.payment_methods for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('payments.read'));
create policy payment_methods_write on public.payment_methods for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'))
with check (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'));
create policy payments_select on public.payments for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('payments.read'));
create policy alert_rules_select on public.alert_rules for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('subscriptions.read'));
create policy alert_rules_update on public.alert_rules for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'))
with check (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'));
create policy alerts_select on public.alerts for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('subscriptions.read'));
create policy templates_select on public.message_templates for select to authenticated
using (organization_id = public.current_organization_id());
create policy templates_update on public.message_templates for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'))
with check (organization_id = public.current_organization_id() and public.has_permission('settings.business.write'));

revoke all on function public.bootstrap_first_root() from public;
revoke all on function public.change_member_role(uuid, public.app_role_name) from public;
revoke all on function public.set_member_status(uuid, public.member_status) from public;
revoke all on function public.set_role_permission(public.app_role_name, text, boolean) from public;
grant execute on function public.bootstrap_first_root() to authenticated;
grant execute on function public.change_member_role(uuid, public.app_role_name) to authenticated;
grant execute on function public.set_member_status(uuid, public.member_status) to authenticated;
grant execute on function public.set_role_permission(public.app_role_name, text, boolean) to authenticated;

commit;
