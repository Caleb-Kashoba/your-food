import { requireSupabase } from '@/lib/supabase/client';
import type { AppRole } from '@/types/domain';

export interface AuditLog {
  id: number;
  actorMemberId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldData: unknown;
  newData: unknown;
  createdAt: string;
}

interface AuditRow {
  id: number;
  actor_member_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_data: unknown;
  new_data: unknown;
  created_at: string;
}

export interface PermissionMatrix {
  roles: { id: string; name: Exclude<AppRole, 'root'> }[];
  permissions: { id: string; code: string; description: string }[];
  enabled: Set<string>;
}

export interface TechnicalSetting {
  id: string;
  key: string;
  value: unknown;
}

export async function listAuditLogs(): Promise<AuditLog[]> {
  const { data, error } = await requireSupabase()
    .from('audit_logs')
    .select('id, actor_member_id, action, entity_type, entity_id, old_data, new_data, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as AuditRow[]).map((row) => ({
    id: row.id,
    actorMemberId: row.actor_member_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldData: row.old_data,
    newData: row.new_data,
    createdAt: row.created_at
  }));
}

export async function getPermissionMatrix(): Promise<PermissionMatrix> {
  const client = requireSupabase();
  const [rolesResult, permissionsResult, linksResult] = await Promise.all([
    client.from('roles').select('id, name').neq('name', 'root').order('hierarchy_level', { ascending: false }),
    client.from('permissions').select('id, code, description').not('code', 'like', 'system.%').order('code'),
    client.from('role_permissions').select('role_id, permission_id')
  ]);
  if (rolesResult.error) throw rolesResult.error;
  if (permissionsResult.error) throw permissionsResult.error;
  if (linksResult.error) throw linksResult.error;

  return {
    roles: rolesResult.data as { id: string; name: Exclude<AppRole, 'root'> }[],
    permissions: permissionsResult.data as { id: string; code: string; description: string }[],
    enabled: new Set((linksResult.data as { role_id: string; permission_id: string }[]).map((link) => `${link.role_id}:${link.permission_id}`))
  };
}

export async function setRolePermission(role: Exclude<AppRole, 'root'>, permissionCode: string, enabled: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc('set_role_permission', {
    p_role_name: role,
    p_permission_code: permissionCode,
    p_enabled: enabled
  });
  if (error) throw error;
}

export async function listTechnicalSettings(): Promise<TechnicalSetting[]> {
  const { data, error } = await requireSupabase()
    .from('app_settings')
    .select('id, key, value')
    .eq('is_technical', true)
    .order('key');
  if (error) throw error;
  return data as TechnicalSetting[];
}

export async function updateTechnicalSetting(id: string, value: unknown): Promise<void> {
  const { error } = await requireSupabase()
    .from('app_settings')
    .update({ value })
    .eq('id', id)
    .eq('is_technical', true);
  if (error) throw error;
}
