import { describe, expect, it } from 'vitest';

import { describeOrderAhead, parseDays, parseOrderAhead, serializeOrderAhead } from '@/features/settings/order-ahead';

describe('limite de commande à l’avance', () => {
  it('lit et écrit les trois formes', () => {
    expect(parseOrderAhead('week')).toEqual({ mode: 'week' });
    expect(parseOrderAhead('none')).toEqual({ mode: 'none' });
    expect(parseOrderAhead('3')).toEqual({ mode: 'days', days: 3 });
    expect(serializeOrderAhead({ mode: 'week' })).toBe('week');
    expect(serializeOrderAhead({ mode: 'none' })).toBe('none');
    expect(serializeOrderAhead({ mode: 'days', days: 7 })).toBe('7');
  });

  it('retombe sur la semaine pour une valeur inconnue et borne le nombre de jours', () => {
    expect(parseOrderAhead('')).toEqual({ mode: 'week' });
    expect(parseOrderAhead('autre')).toEqual({ mode: 'week' });
    expect(parseOrderAhead('0')).toEqual({ mode: 'days', days: 1 });
    expect(parseOrderAhead('999')).toEqual({ mode: 'days', days: 60 });
  });

  it('valide la saisie du nombre de jours (1 à 60)', () => {
    expect(parseDays('5')).toBe(5);
    expect(parseDays(' 14 ')).toBe(14);
    expect(parseDays('0')).toBeNull();
    expect(parseDays('61')).toBeNull();
    expect(parseDays('2,5')).toBeNull();
    expect(parseDays('')).toBeNull();
  });

  it('décrit chaque réglage', () => {
    expect(describeOrderAhead({ mode: 'week' })).toContain('vendredi');
    expect(describeOrderAhead({ mode: 'none' })).toContain('tous les jours');
    expect(describeOrderAhead({ mode: 'days', days: 1 })).toContain('demain');
    expect(describeOrderAhead({ mode: 'days', days: 4 })).toContain('4 jours');
  });
});
