import { describe, expect, it } from 'vitest';

import { describeRow, type AuditRow } from '@/features/audit/audit-labels';

const row = (overrides: Partial<AuditRow>): AuditRow => ({
  id: 1,
  at: '2026-10-01T10:00:00Z',
  actor_name: 'Sarah BOKETSU',
  actor_kind: 'equipe',
  area: 'commandes',
  action: 'modifie',
  raw_action: 'update',
  entity_id: 'x',
  changed_fields: null,
  ...overrides
});

describe('phrases du journal d’activité', () => {
  it('accorde le participe avec le genre du domaine', () => {
    expect(describeRow(row({ area: 'commandes', action: 'modifie' }))).toBe('Commande modifiée');
    expect(describeRow(row({ area: 'livraisons', action: 'supprime' }))).toBe('Livraison supprimée');
    expect(describeRow(row({ area: 'clients', action: 'cree' }))).toBe('Client créé');
    expect(describeRow(row({ area: 'plats', action: 'modifie' }))).toBe('Plat modifié');
  });

  it('décrit les actions particulières avec leur nom', () => {
    expect(describeRow(row({ area: 'acces', action: 'autre', raw_action: 'customer_access_code_issued' }))).toBe('Accès : customer access code issued');
  });
});
