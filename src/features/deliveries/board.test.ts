import { describe, expect, it } from 'vitest';

import {
  addressText,
  NO_MEAT,
  bowlContents,
  bowlRange,
  filterBowls,
  groupBowls,
  hasFilter,
  sortBowls,
  groupByPlat,
  kitchenOrder,
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
  bowl_number: null,
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

describe('bols numérotés, triés par plat', () => {
  const r = (id: string, plat: string | null, acc: string | null, name: string, bowl: number | null = null) =>
    row({ delivery_id: id, plat, accompagnement: acc, customer_name: name, bowl_number: bowl });

  it('sans numéro (menu ouvert) : par plat, accompagnement puis client', () => {
    const ordered = kitchenOrder([r('1', 'Riz', 'Pondu', 'Zoé'), r('2', 'Fufu', 'Haricots', 'Yves'), r('3', 'Riz', 'Haricots', 'Anne'), r('4', null, null, 'Bob')]);
    expect(ordered.map((x) => x.delivery_id)).toEqual(['2', '3', '1', '4']);
  });

  it('avec numéros (menu verrouillé) : l\'ordre des numéros prime, les bols ajoutés après coup à la fin', () => {
    const ordered = kitchenOrder([r('a', 'Riz', 'X', 'A', 2), r('b', 'Fufu', 'X', 'B', 1), r('c', 'Fufu', 'X', 'C', null)]);
    expect(ordered.map((x) => x.delivery_id)).toEqual(['b', 'a', 'c']);
  });

  it('regroupe par plat et donne la plage de numéros', () => {
    const groups = groupByPlat([r('1', 'Riz', 'A', 'A', 3), r('2', 'Fufu', 'A', 'B', 1), r('3', 'Fufu', 'B', 'C', 2), r('4', null, null, 'D')]);
    expect(groups.map((g) => [g.plat, g.rows.length])).toEqual([['Fufu', 2], ['Riz', 1], ['Sans repas', 1]]);
    expect(bowlRange(groups[0]!.rows)).toBe('Bols n°1 à 2');
    expect(bowlRange(groups[1]!.rows)).toBe('Bol n°3');
    expect(bowlRange(groups[2]!.rows)).toBe('');
  });
});

describe('contenu des bols : filtres et tris', () => {
  const r = (id: string, plat: string | null, acc: string | null, viande: string | null, name: string, bowl: number | null = null) =>
    row({ delivery_id: id, plat, accompagnement: acc, viande, customer_name: name, bowl_number: bowl });
  const rows = [
    r('1', 'Riz', 'Haricots', 'Cuisse', 'Anne', 1),
    r('2', 'Riz', 'Pondu', null, 'Bob', 2),
    r('3', 'Fufu', 'Haricots', 'Poisson', 'Cléo', 3),
    r('4', 'Fufu', 'Pondu', 'Cuisse', 'Dan', 4)
  ];

  it('compte ce que contiennent les bols', () => {
    const c = bowlContents(rows);
    expect(c.plat).toEqual([{ name: 'Fufu', count: 2 }, { name: 'Riz', count: 2 }]);
    expect(c.accompagnement).toEqual([{ name: 'Haricots', count: 2 }, { name: 'Pondu', count: 2 }]);
    expect(c.viande).toEqual([{ name: 'Cuisse', count: 2 }, { name: 'Poisson', count: 1 }]);
    expect(c.withoutMeat).toBe(1);
  });

  it('filtre : les bols qui contiennent tout ce qui est demandé', () => {
    expect(hasFilter({})).toBe(false);
    expect(filterBowls(rows, { plat: 'Riz' }).map((x) => x.delivery_id)).toEqual(['1', '2']);
    expect(filterBowls(rows, { plat: 'Riz', viande: 'Cuisse' }).map((x) => x.delivery_id)).toEqual(['1']);
    expect(filterBowls(rows, { accompagnement: 'Pondu', viande: NO_MEAT }).map((x) => x.delivery_id)).toEqual(['2']);
    expect(filterBowls(rows, { viande: 'Poisson' }).map((x) => x.delivery_id)).toEqual(['3']);
  });

  it('trie par viande puis plat, les bols sans viande à la fin', () => {
    expect(sortBowls(rows, 'viande').map((x) => x.delivery_id)).toEqual(['4', '1', '3', '2']);
    expect(sortBowls(rows, 'client').map((x) => x.customer_name)).toEqual(['Anne', 'Bob', 'Cléo', 'Dan']);
    expect(sortBowls(rows, 'bol').map((x) => x.delivery_id)).toEqual(['1', '2', '3', '4']);
  });

  it('regroupe selon le tri choisi', () => {
    expect(groupBowls(rows, 'viande').map((g) => [g.title, g.rows.length])).toEqual([['Cuisse', 2], ['Poisson', 1], ['Sans viande', 1]]);
    expect(groupBowls(rows, 'accompagnement').map((g) => [g.title, g.rows.length])).toEqual([['Haricots', 2], ['Pondu', 2]]);
    expect(groupBowls(rows, 'bol')).toHaveLength(1);
    expect(groupBowls([], 'plat')).toEqual([]);
  });
});
