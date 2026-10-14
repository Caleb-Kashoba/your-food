import { describe, expect, it } from 'vitest';

import {
  WEEK_CHOICES,
  addWorkingDays,
  endOfWeeks,
  isWorkingDay,
  subscriptionTotal,
  weeklyPrice,
  workingDayOnOrAfter
} from '@/features/subscriptions/subscription-rules';

describe('abonnements en semaines', () => {
  it('le prix hebdomadaire d’une formule d’un mois compte 4 semaines', () => {
    expect(weeklyPrice({ price: 35000, durationValue: 1, durationUnit: 'week' })).toBe(35000);
    expect(weeklyPrice({ price: 140000, durationValue: 1, durationUnit: 'month' })).toBe(35000);
    expect(weeklyPrice({ price: 70000, durationValue: 2, durationUnit: 'week' })).toBe(35000);
  });

  it('les prix s’additionnent sur la durée, sauf prix exceptionnel', () => {
    expect(subscriptionTotal(25000, 4)).toBe(100000);
    expect(subscriptionTotal(25000, 4, 80000)).toBe(80000);
    expect(subscriptionTotal(25000, 4, 0)).toBe(100000);
    expect(subscriptionTotal(35000, 2, null)).toBe(70000);
  });

  it('du lundi, un abonnement finit toujours un vendredi', () => {
    expect(endOfWeeks('2026-10-05', 1)).toBe('2026-10-09');
    expect(endOfWeeks('2026-10-05', 2)).toBe('2026-10-16');
    expect(endOfWeeks('2026-10-05', 4)).toBe('2026-10-30');
  });

  it('commencé en semaine, une semaine = 5 jours ouvrés : le premier jour compte', () => {
    expect(endOfWeeks('2026-10-14', 1)).toBe('2026-10-20'); // mercredi → mardi suivant
    expect(endOfWeeks('2026-10-14', 2)).toBe('2026-10-27');
    expect(endOfWeeks('2026-10-16', 1)).toBe('2026-10-22'); // vendredi → jeudi suivant
    expect(endOfWeeks('2026-10-07', 1)).toBe('2026-10-13'); // le cas de Confiant
  });

  it('rallonger d\u2019une semaine = 5 jours ouvrés de plus à la suite de la fin', () => {
    expect(addWorkingDays('2026-10-13', 5)).toBe('2026-10-20'); // Confiant : mardi 13 → mardi 20
    expect(addWorkingDays('2026-10-19', 5)).toBe('2026-10-26'); // Bonel : lundi 19 → lundi 26
    expect(addWorkingDays('2026-10-16', 5)).toBe('2026-10-23'); // un vendredi reste un vendredi
    expect(addWorkingDays('2026-10-14', 0)).toBe('2026-10-14');
  });

  it('commence un jour ouvré, jamais un week-end', () => {
    expect(isWorkingDay('2026-10-05')).toBe(true);
    expect(isWorkingDay('2026-10-14')).toBe(true);
    expect(isWorkingDay('2026-10-16')).toBe(true);
    expect(isWorkingDay('2026-10-17')).toBe(false); // samedi
    expect(isWorkingDay('2026-10-18')).toBe(false); // dimanche
    expect(isWorkingDay('demain')).toBe(false);
    expect(workingDayOnOrAfter('2026-10-14')).toBe('2026-10-14');
    expect(workingDayOnOrAfter('2026-10-17')).toBe('2026-10-19'); // samedi → lundi
    expect(workingDayOnOrAfter('2026-10-18')).toBe('2026-10-19');
  });

  it('propose 1 mois = 4 semaines', () => {
    expect(WEEK_CHOICES.find((choice) => choice.label === '1 mois')?.weeks).toBe(4);
  });
});
