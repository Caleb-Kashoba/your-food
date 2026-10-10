import { describe, expect, it } from 'vitest';

import { CUSTOMER_STATUS_LABEL, filterByStatus, inactivityText } from '@/features/customers/customer-status';

describe('statut des clients', () => {
  const customers = [
    { name: 'A', status: 'active' as const },
    { name: 'B', status: 'inactive' as const },
    { name: 'C', status: 'former_customer' as const },
    { name: 'D', status: 'inactive' as const }
  ];

  it('affiche les statuts en français', () => {
    expect(CUSTOMER_STATUS_LABEL.active).toBe('Actif');
    expect(CUSTOMER_STATUS_LABEL.inactive).toBe('Inactif');
    expect(CUSTOMER_STATUS_LABEL.former_customer).toBe('Ancien client');
  });

  it('filtre par statut, « tous » garde tout le monde', () => {
    expect(filterByStatus(customers, 'all')).toHaveLength(4);
    expect(filterByStatus(customers, 'inactive').map((c) => c.name)).toEqual(['B', 'D']);
    expect(filterByStatus(customers, 'former_customer').map((c) => c.name)).toEqual(['C']);
  });

  it('exprime l\'inactivité en jours puis en mois', () => {
    expect(inactivityText(30)).toBe('30 jours');
    expect(inactivityText(45)).toBe('45 jours');
    expect(inactivityText(75)).toBe('2 mois');
  });
});
