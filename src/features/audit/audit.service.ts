/**
 * Journal d'activité : qui a fait quoi, avec des filtres simples (période, qui, domaine, type d'action, recherche).
 */

import { requireSupabase } from '@/lib/supabase/client';

export type ActorKind = 'equipe' | 'client' | 'systeme';
export type AuditArea =
  | 'clients' | 'abonnements' | 'livraisons' | 'paiements' | 'plats' | 'menus' | 'commandes' | 'avis'
  | 'formules' | 'parametres' | 'acces' | 'equipe';
export type AuditAction = 'cree' | 'modifie' | 'supprime' | 'autre';

export interface AuditFilters {
  from?: string;
  to?: string;
  actorKind?: ActorKind;
  area?: AuditArea;
  action?: AuditAction;
  q?: string;
}

export interface AuditRow {
  id: number;
  at: string;
  actor_name: string;
  actor_kind: ActorKind;
  area: AuditArea;
  action: AuditAction;
  raw_action: string;
  entity_id: string;
  changed_fields: string[] | null;
}

export const PAGE_SIZE = 40;

export const ACTOR_LABEL: Record<ActorKind, string> = { equipe: 'Équipe', client: 'Clients', systeme: 'Système' };
export const AREA_LABEL: Record<AuditArea, string> = {
  clients: 'Clients', abonnements: 'Abonnements', livraisons: 'Livraisons', paiements: 'Paiements', plats: 'Plats',
  menus: 'Menus', commandes: 'Commandes', avis: 'Avis', formules: 'Formules', parametres: 'Paramètres', acces: 'Accès', equipe: 'Équipe'
};
export const ACTION_LABEL: Record<AuditAction, string> = { cree: 'Créé', modifie: 'Modifié', supprime: 'Supprimé', autre: 'Autre' };

/** Phrase lisible : « Mireille Kabongo — commande modifiée » */
export function describeRow(row: AuditRow): string {
  const subject = AREA_LABEL[row.area].toLowerCase();
  const verb = row.action === 'cree' ? 'créé' : row.action === 'modifie' ? 'modifié' : row.action === 'supprime' ? 'supprimé' : row.raw_action.replaceAll('_', ' ');
  return row.action === 'autre' ? `${subject} : ${verb}` : `${subject} ${verb}`;
}

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
