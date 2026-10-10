import type { CustomerStatus } from '@/types/domain';

/**
 * Statut d'un client, calculé sur ses abonnements (voir la migration 202610010013) :
 * actif = abonnement en cours, à venir ou suspendu ; inactif = dernier abonnement fini depuis plus de 2 jours ouvrés ;
 * ancien client = décidé par l'administratrice un mois après la fin du dernier abonnement.
 */
export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  active: 'Actif',
  inactive: 'Inactif',
  former_customer: 'Ancien client'
};

export type StatusFilter = 'all' | CustomerStatus;

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'active', label: 'Actifs' },
  { value: 'inactive', label: 'Inactifs' },
  { value: 'former_customer', label: 'Anciens clients' }
];

export function filterByStatus<T extends { status: CustomerStatus }>(customers: T[], filter: StatusFilter): T[] {
  return filter === 'all' ? customers : customers.filter((customer) => customer.status === filter);
}

/** « 35 jours » : durée d'inactivité affichée dans la carte « À confirmer » */
export function inactivityText(days: number): string {
  return days < 60 ? `${days} jours` : `${Math.floor(days / 30)} mois`;
}
