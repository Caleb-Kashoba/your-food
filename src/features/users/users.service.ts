import { requireSupabase } from '@/lib/supabase/client';
import type { AppRole } from '@/types/domain';

import type { InvitationChannel } from './invitation';

export interface TeamMember {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  whatsapp: string | null;
  role: AppRole;
  status: 'active' | 'disabled';
}

interface MemberRow {
  id: string;
  user_id: string;
  status: TeamMember['status'];
  profiles:
    | { display_name: string; email: string | null; whatsapp: string | null }
    | { display_name: string; email: string | null; whatsapp: string | null }[];
  roles: { name: AppRole } | { name: AppRole }[];
}

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0]! : value;
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await requireSupabase()
    .from('organization_members')
    .select('id, user_id, status, profiles!inner(display_name, email, whatsapp), roles!inner(name)')
    .order('created_at');
  if (error) throw error;
  return (data as unknown as MemberRow[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    displayName: one(row.profiles).display_name,
    email: one(row.profiles).email,
    whatsapp: one(row.profiles).whatsapp,
    role: one(row.roles).name,
    status: row.status
  }));
}

export async function changeMemberRole(memberId: string, role: AppRole): Promise<void> {
  const { error } = await requireSupabase().rpc('change_member_role', {
    p_target_member_id: memberId,
    p_new_role: role
  });
  if (error) throw error;
}

export async function setMemberStatus(memberId: string, status: 'active' | 'disabled'): Promise<void> {
  const { error } = await requireSupabase().rpc('set_member_status', {
    p_target_member_id: memberId,
    p_status: status
  });
  if (error) throw error;
}

export interface InviteTeamMemberInput {
  email: string;
  displayName: string;
  whatsapp: string | null;
  role: AppRole;
  channel: InvitationChannel;
}

export interface InviteTeamMemberResult {
  invitationId: string;
  userId: string;
  channel: InvitationChannel;
  status: 'pending';
  expiresAt: string;
  inviteLink?: string;
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof payload?.error === 'string') return payload.error;
    }
  }

  return error instanceof Error ? error.message : 'Invitation impossible.';
}

export async function inviteTeamMember(input: InviteTeamMemberInput): Promise<InviteTeamMemberResult> {
  const { data, error } = await requireSupabase().functions.invoke<InviteTeamMemberResult>('admin-users', {
    body: {
      action: 'invite',
      email: input.email.trim(),
      displayName: input.displayName.trim(),
      whatsapp: input.whatsapp,
      role: input.role,
      channel: input.channel
    }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (!data) throw new Error('Le serveur n’a retourné aucune invitation.');
  return data;
}
