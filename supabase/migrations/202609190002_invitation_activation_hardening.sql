begin;

-- Invitations create the future member ahead of activation, but the membership
-- must remain disabled until the invited user proves possession of the invite
-- link and accepts it through Supabase Auth.
update public.organization_members member
set status = 'disabled'
from public.internal_user_invitations invitation
where invitation.organization_id = member.organization_id
  and invitation.invited_user_id = member.user_id
  and invitation.status = 'pending'
  and member.status = 'active';

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

  -- Security boundary: the requested role exists, but it cannot be exercised
  -- until accept_my_pending_invitations() activates this membership.
  insert into public.organization_members (organization_id, user_id, role_id, status)
  values (
    actor_record.organization_id,
    p_invited_user_id,
    requested_role_record.id,
    'disabled'
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

create or replace function public.accept_my_pending_invitations()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  accepted_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Expired invitations remain non-members: keep their organization membership
  -- disabled even if an older migration created it as active.
  update public.organization_members member
  set status = 'disabled'
  from public.internal_user_invitations invitation
  where invitation.invited_user_id = current_user_id
    and invitation.organization_id = member.organization_id
    and member.user_id = current_user_id
    and invitation.status = 'pending'
    and invitation.expires_at <= now();

  update public.internal_user_invitations
  set status = 'expired'
  where invited_user_id = current_user_id
    and status = 'pending'
    and expires_at <= now();

  -- Activate only memberships backed by an invitation that is still valid.
  update public.organization_members member
  set status = 'active'
  from public.internal_user_invitations invitation
  where invitation.invited_user_id = current_user_id
    and invitation.organization_id = member.organization_id
    and member.user_id = current_user_id
    and invitation.status = 'pending'
    and invitation.expires_at > now();

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
  update public.organization_members member
  set status = 'disabled'
  from public.internal_user_invitations invitation
  where invitation.organization_id = member.organization_id
    and invitation.invited_user_id = member.user_id
    and invitation.status = 'pending'
    and invitation.expires_at <= now();

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

commit;
