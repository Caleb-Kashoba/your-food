import { describe, expect, it } from 'vitest';

import {
  addressText,
  countByStage,
  daysOf,
  mealText,
  nextStatus,
  stageOf,
  totalsToPrepare,
  type BoardRow
} from '@/features/deliveries/board';

const row = (overrides: Partial<BoardRow> = {}): BoardRow => ({
  delivery_id: 'd1',
  date: '2026-10-06',
  customer_id: 'c1',
  customer_name: 'Mireille Kabongo',
  phone: '+243811110002',
  zone_name: 'Gombe',
  residence: 'Résidence A',
  building: 'Bloc 2',
  room: '12',
  address_details: null,
  plan_name: 'Formule 2',
  delivery_status: 'scheduled',
  menu_status: 'locked',
  order_id: 'o1',
  state: 'commande',
  plat: 'Riz',
  accompagnement: 'Haricots',
  viande: 'Cuisse de poulet',
  ...overrides
});

describe('tableau de préparation et de livraison', () => {
  it('affiche le repas choisi : « Riz + Haricots + Cuisse de poulet »', () => {
    expect(mealText(row())).toBe('Riz + Haricots + Cuisse de poulet');
    expect(mealText(row({ viande: null }))).toBe('Riz + Haricots');
    expect(mealText(row({ plat: null, accompagnement: null, viande: null }))).toBe('');
  });

  it('assemble l’adresse sans les champs vides', () => {
    expect(addressText(row())).toBe('Gombe · Résidence A · Bloc 2 · 12');
    expect(addressText(row({ zone_name: null, residence: null, building: null, room: null }))).toBe('');
  });

  it('distingue les étapes : choix, préparation, livraison', () => {
    expect(stageOf(row({ state: 'en_attente', order_id: null, plat: null, accompagnement: null, viande: null }))).toBe('attente_choix');
    expect(stageOf(row())).toBe('a_preparer');
    expect(stageOf(row({ state: 'defaut' }))).toBe('a_preparer');
    expect(stageOf(row({ delivery_status: 'ready' }))).toBe('prete');
    expect(stageOf(row({ delivery_status: 'delivered' }))).toBe('livree');
    expect(stageOf(row({ state: 'annule', delivery_status: 'cancelled' }))).toBe('annulee');
  });

  it('un repas livré reste « livré » même si le client n’avait pas choisi', () => {
    expect(stageOf(row({ state: 'en_attente', delivery_status: 'delivered' }))).toBe('livree');
  });

  it('compte les repas par étape', () => {
    const counts = countByStage([
      row(),
      row({ delivery_id: 'd2', delivery_status: 'ready' }),
      row({ delivery_id: 'd3', delivery_status: 'delivered' }),
      row({ delivery_id: 'd4', state: 'annule', delivery_status: 'cancelled' }),
      row({ delivery_id: 'd5', state: 'en_attente' })
    ]);
    expect(counts).toEqual({ attente_choix: 1, a_preparer: 1, prete: 1, livree: 1, annulee: 1 });
  });

  it('totalise ce qu’il faut préparer, sans les annulés ni ceux qui n’ont pas choisi', () => {
    const totals = totalsToPrepare([
      row(),
      row({ delivery_id: 'd2', accompagnement: 'Fufu' }),
      row({ delivery_id: 'd3', plat: 'Pondu', viande: null }),
      row({ delivery_id: 'd4', state: 'annule', delivery_status: 'cancelled' }),
      row({ delivery_id: 'd5', state: 'en_attente', plat: null, accompagnement: null, viande: null })
    ]);
    expect(totals.find((t) => t.name === 'Riz')?.count).toBe(2);
    expect(totals.find((t) => t.name === 'Pondu')?.count).toBe(1);
    expect(totals.find((t) => t.name === 'Cuisse de poulet')?.count).toBe(2);
    expect(totals.map((t) => t.category)).toEqual(['plat', 'plat', 'accompagnement', 'accompagnement', 'viande']);
  });

  it('propose la bonne action selon l’onglet', () => {
    expect(nextStatus(row(), 'preparation')?.status).toBe('ready');
    expect(nextStatus(row({ delivery_status: 'ready' }), 'preparation')?.status).toBe('scheduled');
    expect(nextStatus(row(), 'livraison')).toBeNull(); // pas encore prêt : rien à livrer
    expect(nextStatus(row({ delivery_status: 'ready' }), 'livraison')?.status).toBe('delivered');
    expect(nextStatus(row({ delivery_status: 'delivered' }), 'livraison')?.status).toBe('ready');
    expect(nextStatus(row({ state: 'en_attente' }), 'preparation')).toBeNull();
  });

  it('liste les jours présents dans l’ordre', () => {
    expect(daysOf([row({ date: '2026-10-07' }), row({ date: '2026-10-06' }), row({ date: '2026-10-07' })])).toEqual(['2026-10-06', '2026-10-07']);
  });
});
