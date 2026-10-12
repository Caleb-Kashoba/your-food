import { describe, expect, it } from 'vitest';

import { describeOrderLimit, hourLabel, parseOrderLimit, parseTime, serializeOrderLimit, validateOrderLimit } from '@/features/settings/order-limit';

describe('heure limite de commande', () => {
  it('lit et écrit les trois formes', () => {
    expect(parseOrderLimit('none')).toEqual({ mode: 'none' });
    expect(parseOrderLimit('veille@20:00')).toEqual({ mode: 'veille', time: '20:00' });
    expect(parseOrderLimit('jour@06:30')).toEqual({ mode: 'jour', time: '06:30' });
    expect(serializeOrderLimit({ mode: 'none' })).toBe('none');
    expect(serializeOrderLimit({ mode: 'veille', time: '21:15' })).toBe('veille@21:15');
    expect(serializeOrderLimit({ mode: 'jour', time: '06:00' })).toBe('jour@06:00');
  });

  it('retombe sur « aucune » pour une valeur inconnue', () => {
    expect(parseOrderLimit('')).toEqual({ mode: 'none' });
    expect(parseOrderLimit('veille')).toEqual({ mode: 'none' });
    expect(parseOrderLimit('veille@abc')).toEqual({ mode: 'none' });
    expect(parseOrderLimit('semaine@20:00')).toEqual({ mode: 'none' });
  });

  it('comprend les heures saisies à la main', () => {
    expect(parseTime('6:00')).toBe('06:00');
    expect(parseTime('06:05')).toBe('06:05');
    expect(parseTime('20h')).toBe('20:00');
    expect(parseTime('20h30')).toBe('20:30');
    expect(parseTime(' 7 ')).toBeNull();
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('12:75')).toBeNull();
    expect(parseTime('midi')).toBeNull();
    expect(parseTime('')).toBeNull();
  });

  it('valide : le jour du repas, midi au plus tard', () => {
    expect(validateOrderLimit('none', '')).toEqual({ ok: true, value: { mode: 'none' } });
    expect(validateOrderLimit('veille', '23h30')).toEqual({ ok: true, value: { mode: 'veille', time: '23:30' } });
    expect(validateOrderLimit('jour', '12:00')).toEqual({ ok: true, value: { mode: 'jour', time: '12:00' } });
    expect(validateOrderLimit('jour', '12:01')).toEqual({ ok: false, error: 'Le jour du repas, l’heure limite est midi au plus tard.' });
    expect(validateOrderLimit('veille', 'abc').ok).toBe(false);
  });

  it('décrit chaque réglage', () => {
    expect(hourLabel('06:00')).toBe('6h00');
    expect(describeOrderLimit({ mode: 'none' })).toContain('minuit');
    expect(describeOrderLimit({ mode: 'veille', time: '20:00' })).toBe('Les commandes se ferment la veille du repas, à 20h00.');
    expect(describeOrderLimit({ mode: 'jour', time: '06:00' })).toContain('le jour du repas jusqu’à 6h00');
  });
});
