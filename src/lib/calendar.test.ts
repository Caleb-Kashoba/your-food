import { describe, expect, it } from 'vitest';

import { longDate, monthGrid, monthTitle, shiftMonth } from '@/lib/calendar';

describe('calendrier du sélecteur de date', () => {
  it('octobre 2026 : 5 semaines du lundi au dimanche, le 1er est un jeudi', () => {
    const weeks = monthGrid('2026-10-15');
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7 && week[0]!.weekday === 1)).toBe(true);
    expect(weeks[0]![0]!.date).toBe('2026-09-28');
    expect(weeks[0]![0]!.inMonth).toBe(false);
    expect(weeks[0]![3]!.date).toBe('2026-10-01');
    expect(weeks[0]![3]!.inMonth).toBe(true);
    expect(weeks.at(-1)![6]!.date).toBe('2026-11-01');
  });

  it('change de mois et affiche en français', () => {
    expect(shiftMonth('2026-12-10', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-31', -1)).toBe('2025-12-01');
    expect(monthTitle('2026-10-15')).toBe('octobre 2026');
    expect(longDate('2026-10-12')).toBe('lundi 12 octobre 2026');
  });
});
