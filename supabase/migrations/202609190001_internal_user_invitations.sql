begin;

create type public.invitation_channel as enum ('email', 'whatsapp');
create type public.invitation_status as enum ('pending', 'accepted', 'expired', 'cancelled');

alter table public.profiles
  add column whatsapp text,
  add column whatsapp_normalized text generated always as (public.normalize_phone(whatsapp)) stored;

create table public.internal_user_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_member_id uuid references public.organization_members(id),
  invited_user_id uuid references auth.users(id) on delete set null,
  requested_role_id uuid not null references public.roles(id),
  display_name text not null check (btrim(display_name) <> ''),
  email text not null check (btrim(email) <> ''),
  whatsapp text,
  whatsapp_normalized text generated always as (public.normalize_phone(whatsapp)) stored,
  channel public.invitation_channel not null,
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel <> 'whatsapp' or whatsapp is not null),
  check (expires_at > created_at)
);

create index internal_user_invitations_org_created_idx
  on public.internal_user_invitations(organization_id, created_at desc);
create index internal_user_invitations_user_status_idx
  on public.internal_user_invitations(invited_user_id, status);

create trigger internal_user_invitations_updated_at
before update on public.internal_user_invitations
for each row execute function public.set_updated_at();

alter table public.internal_user_invitations enable row level security;

create policy internal_user_invitations_select
on public.internal_user_invitations
for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.has_permission('users.read')
    or public.has_permission('system.audit.read')
  )
);

grant select on public.internal_user_invitations to authenticated;

create or replace function public.register_internal_user_invitation(
  p_actor_user_id uuid,
  p_invited_user_id uuid,
  p_email text,
  p_display_name text,
  p_whatsapp text,
  p_requested_role public.app_role_name,
  p_channel public.invitation_channel,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_record record;
  requested_role_record record;
  invitation_id uuid;
  normalized_email text := lower(btrim(p_email));
  normalized_whatsapp text := public.normalize_phone(nullif(btrim(p_whatsapp), ''));
begin
  select
    m.id,
    m.organization_id,
    m.role_id,
    r.name as role_name,
    r.hierarchy_level
  into actor_record
  from public.organization_members m
  join public.roles r on r.id = m.role_id
  where m.user_id = p_actor_user_id
    and m.status = 'active'
  order by m.created_at
  limit 1;

  if not found then
    raise exception 'Active membership required';
  end if;

  if actor_record.role_name <> 'root' and not exists (
    select 1
    from public.role_permissions rp
    join public.permissions permission on permission.id = rp.permission_id
    where rp.role_id = actor_record.role_id
      and permission.code = 'users.create'
  ) then
    raise exception 'Permission denied';
  end if;

  select id, name, hierarchy_level
  into requested_role_record
  from public.roles
  where name = p_requested_role;

  if not found then
    raise exception 'Invalid role';
  end if;

  if actor_record.role_name <> 'root' and requested_role_record.name in ('root', 'admin') then
    raise exception 'Only a root can invite admin or root users';
  end if;

  if actor_record.role_name <> 'root'
     and requested_role_record.hierarchy_level >= actor_record.hierarchy_level then
    raise exception 'Cannot invite a user with a role at or above your own role';
  end if;

  if normalized_email = '' or position('@' in normalized_email) < 2 then
    raise exception 'Invalid email address';
  end if;

  if p_channel = 'whatsapp' and normalized_whatsapp is null then
    raise exception 'A valid WhatsApp number is required';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '1 day' then
    raise exception 'Invalid invitation expiration';
  end if;

  if not exists (
    select 1
    from auth.users auth_user
    where auth_user.id = p_invited_user_id
      and lower(auth_user.email) = normalized_email
  ) then
    raise exception 'Invited Auth user does not match the requested email';
  end if;

  if exists (
    select 1
    from public.organization_members member
    where member.organization_id = actor_record.organization_id
      and member.user_id = p_invited_user_id
  ) then
    raise exception 'This user already belongs to the organization';
  end if;

  insert into public.profiles (id, display_name, email, whatsapp)
  values (p_invited_user_id, btrim(p_display_name), normalized_email, normalized_whatsapp)
  on conflict (id) do update
  set display_name = excluded.display_name,
      email = excluded.email,
      whatsapp = excluded.whatsapp;

  insert into public.organization_members (organization_id, user_id, role_id, status)
  values (
    actor_record.organization_id,
    p_invited_user_id,
    requested_role_record.id,
    'active'
  );

  insert into public.internal_user_invitations (
    organization_id,
    actor_member_id,
    invited_user_id,
    requested_role_id,
    display_name,
    email,
    whatsapp,
    channel,
    status,
    expires_at
  ) values (
    actor_record.organization_id,
    actor_record.id,
    p_invited_user_id,
    requested_role_record.id,
    btrim(p_display_name),
    normalized_email,
    normalized_whatsapp,
    p_channel,
    'pending',
    p_expires_at
  ) returning id into invitation_id;

  insert into public.audit_logs (
    organization_id,
    actor_member_id,
    action,
    entity_type,
    entity_id,
    new_data
  ) values (
    actor_record.organization_id,
    actor_record.id,
    'user_invitation_created',
    'internal_user_invitation',
    invitation_id::text,
    jsonb_build_object(
      'invited_user_id', p_invited_user_id,
      'display_name', btrim(p_display_name),
      'email', normalized_email,
      'whatsapp', normalized_whatsapp,
      'requested_role', requested_role_record.name,
      'channel', p_channel,
      'status', 'pending',
      'expires_at', p_expires_at
    )
  );

  return invitation_id;
end;
$$;

revoke all on function public.register_internal_user_invitation(
  uuid, uuid, text, text, text, public.app_role_name,
  public.invitation_channel, timestamptz
) from public, anon, authenticated;
grant execute on function public.register_internal_user_invitation(
  uuid, uuid, text, text, text, public.app_role_name,
  public.invitation_channel, timestamptz
) to service_role;

create or replace function public.audit_internal_user_invitation_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  status_actor_member_id uuid;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  select member.id into status_actor_member_id
  from public.organization_members member
  where member.organization_id = new.organization_id
    and member.user_id = auth.uid()
  limit 1;

  insert into public.audit_logs (
    organization_id,
    actor_member_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data
  ) values (
    new.organization_id,
    status_actor_member_id,
    'user_invitation_status_changed',
    'internal_user_invitation',
    new.id::text,
    jsonb_build_object('status', old.status),
    jsonb_build_object(
      'status', new.status,
      'invited_user_id', new.invited_user_id,
      'channel', new.channel,
      'accepted_at', new.accepted_at,
      'cancelled_at', new.cancelled_at
    )
  );

  return new;
end;
$$;

create trigger internal_user_invitation_status_audit
after update of status on public.internal_user_invitations
for each row execute function public.audit_internal_user_invitation_status();

create or replace function public.accept_my_pending_invitations()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  accepted_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.internal_user_invitations
  set status = 'expired'
  where invited_user_id = current_user_id
    and status = 'pending'
    and expires_at <= now();

  update public.internal_user_invitations
  set status = 'accepted', accepted_at = now()
  where invited_user_id = current_user_id
    and status = 'pending'
    and expires_at > now();

  get diagnostics accepted_count = row_count;
  return accepted_count;
end;
$$;

revoke all on function public.accept_my_pending_invitations() from public, anon;
grant execute on function public.accept_my_pending_invitations() to authenticated;

create or replace function public.expire_internal_user_invitations()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  expired_count integer;
begin
  update public.internal_user_invitations
  set status = 'expired'
  where status = 'pending'
    and expires_at <= now();

  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

revoke all on function public.expire_internal_user_invitations() from public, anon, authenticated;
grant execute on function public.expire_internal_user_invitations() to service_role;

select cron.schedule(
  'your-food-expire-user-invitations',
  '*/15 * * * *',
  $$select public.expire_internal_user_invitations();$$
);

commit;
