/**
 * Journal d'activité : qui a fait quoi, avec des filtres simples (période, qui, domaine, type d'action, recherche).
 */

import { requireSupabase } from '@/lib/supabase/client';
import type { AuditFilters, AuditRow } from '@/features/audit/audit-labels';

export * from '@/features/audit/audit-labels';

export const PAGE_SIZE = 40;

export async function searchAudit(filters: AuditFilters, page: number): Promise<{ total: number; rows: AuditRow[] }> {
  const { data, error } = await requireSupabase().rpc('audit_search', {
    p_from: filters.from ? `${filters.from}T00:00:00+01:00` : null,
    p_to: filters.to ? `${filters.to}T23:59:59.999+01:00` : null,
    p_actor_kind: filters.actorKind ?? null,
    p_area: filters.area ?? null,
    p_action: filters.action ?? null,
    p_q: filters.q?.trim() || null,
    p_limit: PAGE_SIZE,
    p_offset: page * PAGE_SIZE
  });
  if (error) throw error;
  return data as { total: number; rows: AuditRow[] };
}
