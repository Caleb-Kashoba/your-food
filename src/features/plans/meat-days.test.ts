import { describe, expect, it } from 'vitest';

import { DEFAULT_MEAT_DAYS, describeMeatDays, toggleMeatDay } from '@/features/plans/meat-days';

describe('jours de viande d’une formule', () => {
  it('par défaut : lundi et vendredi', () => {
    expect(DEFAULT_MEAT_DAYS).toEqual([1, 5]);
    expect(describeMeatDays(DEFAULT_MEAT_DAYS)).toBe('viande le lundi et le vendredi');
  });

  it('on peut changer de jour', () => {
    let days = toggleMeatDay([1, 5], 5);
    expect(days).toEqual([1]);
    days = toggleMeatDay(days, 3);
    expect(days).toEqual([1, 3]);
  });

  it('refuse un troisième jour de viande', () => {
    expect(toggleMeatDay([1, 5], 3)).toEqual([1, 5]);
  });

  it('garde toujours au moins un jour (pour « tous les jours », choisir l’autre mode)', () => {
    expect(toggleMeatDay([1], 1)).toEqual([1]);
  });

  it('ignore le week-end', () => {
    expect(toggleMeatDay([1], 6)).toEqual([1]);
  });

  it('classe les jours', () => {
    expect(toggleMeatDay([5], 2)).toEqual([2, 5]);
  });

  it('sans liste : viande tous les jours', () => {
    expect(describeMeatDays(null)).toBe('viande tous les jours');
  });
});
