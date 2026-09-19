import type { Session } from '@supabase/supabase-js';

import { parseAuthLink } from '@/features/auth/auth-link';
import { requireSupabase } from '@/lib/supabase/client';
import type { AppRole, CurrentMember } from '@/types/domain';

interface MemberRecord {
  id: string;
  organization_id: string;
  user_id: string;
  role_id: string;
  roles: { name: AppRole } | { name: AppRole }[];
  profiles: { display_name: string; email: string | null } | { display_name: string; email: string | null }[];
}

function singleRelation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0]! : value;
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}

export async function createSessionFromAuthLink(url: string): Promise<Session | null> {
  const client = requireSupabase();
  const result = parseAuthLink(url);

  if (result.kind === 'none') return null;
  if (result.kind === 'error') {
    const message = result.code === 'otp_expired'
      ? 'Ce lien d’invitation est invalide ou a expiré. Demandez une nouvelle invitation.'
      : result.message;
    throw new Error(message);
  }

  const sessionResult = result.kind === 'session'
    ? await client.auth.setSession({ access_token: result.accessToken, refresh_token: result.refreshToken })
    : await client.auth.exchangeCodeForSession(result.code);
  if (sessionResult.error) throw sessionResult.error;
  if (!sessionResult.data.session) throw new Error('La session d’invitation n’a pas pu être créée.');

  const { data: acceptedCount, error: acceptanceError } = await client.rpc('accept_my_pending_invitations');
  if (acceptanceError) {
    await client.auth.signOut().catch(() => undefined);
    throw acceptanceError;
  }
  if (typeof acceptedCount !== 'number' || acceptedCount < 1) {
    await client.auth.signOut().catch(() => undefined);
    throw new Error('Cette invitation a expiré, a déjà été utilisée ou n’est plus valide. Demandez une nouvelle invitation.');
  }
  return sessionResult.data.session;
}

export async function setInvitedUserPassword(password: string): Promise<void> {
  const { error } = await requireSupabase().auth.updateUser({ password });
  if (error) throw error;
}

export async function loadCurrentMember(session: Session): Promise<CurrentMember | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('organization_members')
    .select('id, organization_id, user_id, role_id, roles!inner(name), profiles!inner(display_name, email)')
    .eq('user_id', session.user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const record = data as unknown as MemberRecord;
  const role = singleRelation(record.roles);
  const profile = singleRelation(record.profiles);
  const { data: permissionRows, error: permissionsError } = await client
    .from('role_permissions')
    .select('permissions!inner(code)')
    .eq('role_id', record.role_id);

  if (permissionsError) throw permissionsError;

  const permissions = (permissionRows as unknown as { permissions: { code: string } | { code: string }[] }[]).map(
    (row) => singleRelation(row.permissions).code
  );

  return {
    id: record.id,
    organizationId: record.organization_id,
    userId: record.user_id,
    displayName: profile.display_name,
    email: profile.email,
    role: role.name,
    permissions
  };
}

export async function bootstrapFirstRoot(): Promise<void> {
  const { error } = await requireSupabase().rpc('bootstrap_first_root');
  if (error) throw error;
}
