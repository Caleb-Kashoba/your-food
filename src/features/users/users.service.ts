import { requireSupabase } from '@/lib/supabase/client';
import type { AppRole } from '@/types/domain';

export interface TeamMember {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  role: AppRole;
  status: 'active' | 'disabled';
}

interface MemberRow {
  id: string;
  user_id: string;
  status: TeamMember['status'];
  profiles: { display_name: string; email: string | null } | { display_name: string; email: string | null }[];
  roles: { name: AppRole } | { name: AppRole }[];
}

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0]! : value;
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await requireSupabase()
    .from('organization_members')
    .select('id, user_id, status, profiles!inner(display_name, email), roles!inner(name)')
    .order('created_at');
  if (error) throw error;
  return (data as unknown as MemberRow[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    displayName: one(row.profiles).display_name,
    email: one(row.profiles).email,
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

export async function inviteTeamMember(email: string, displayName: string, role: AppRole): Promise<void> {
  const { error } = await requireSupabase().functions.invoke('admin-users', {
    body: { action: 'invite', email: email.trim(), displayName: displayName.trim(), role }
  });
  if (error) throw error;
}
