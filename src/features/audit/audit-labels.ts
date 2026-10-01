/**
 * Types, libellés et phrases du journal d'activité (partie pure, sans accès au réseau : testable).
 */


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

export const ACTOR_LABEL: Record<ActorKind, string> = { equipe: 'Équipe', client: 'Clients', systeme: 'Système' };
export const AREA_LABEL: Record<AuditArea, string> = {
  clients: 'Clients', abonnements: 'Abonnements', livraisons: 'Livraisons', paiements: 'Paiements', plats: 'Plats',
  menus: 'Menus', commandes: 'Commandes', avis: 'Avis', formules: 'Formules', parametres: 'Paramètres', acces: 'Accès', equipe: 'Équipe'
};
export const ACTION_LABEL: Record<AuditAction, string> = { cree: 'Créé', modifie: 'Modifié', supprime: 'Supprimé', autre: 'Autre' };

/** Nom au singulier et genre de chaque domaine, pour accorder le verbe (« commande modifiée », « client créé ») */
const SUBJECT: Record<AuditArea, { noun: string; feminine: boolean }> = {
  clients: { noun: 'client', feminine: false },
  abonnements: { noun: 'abonnement', feminine: false },
  livraisons: { noun: 'livraison', feminine: true },
  paiements: { noun: 'paiement', feminine: false },
  plats: { noun: 'plat', feminine: false },
  menus: { noun: 'menu', feminine: false },
  commandes: { noun: 'commande', feminine: true },
  avis: { noun: 'avis', feminine: false },
  formules: { noun: 'formule', feminine: true },
  parametres: { noun: 'paramètre', feminine: false },
  acces: { noun: 'accès', feminine: false },
  equipe: { noun: 'compte de l’équipe', feminine: false }
};

/** Phrase lisible : « Commande modifiée », « Client créé » */
export function describeRow(row: AuditRow): string {
  const { noun, feminine } = SUBJECT[row.area];
  const capitalized = noun.charAt(0).toUpperCase() + noun.slice(1);
  const agree = (masculine: string) => (feminine ? `${masculine}e` : masculine);

  if (row.action === 'cree') return `${capitalized} ${agree('créé')}`;
  if (row.action === 'modifie') return `${capitalized} ${agree('modifié')}`;
  if (row.action === 'supprime') return `${capitalized} ${agree('supprimé')}`;
  return `${capitalized} : ${row.raw_action.replaceAll('_', ' ')}`;
}
