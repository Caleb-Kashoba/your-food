import { describe, expect, it } from 'vitest';

import {
  WEEK_CHOICES,
  fridayAfterWeeks,
  isMonday,
  mondayOnOrAfter,
  subscriptionTotal,
  weeklyPrice
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

  it('un abonnement se termine toujours un vendredi', () => {
    expect(fridayAfterWeeks('2026-10-05', 1)).toBe('2026-10-09');
    expect(fridayAfterWeeks('2026-10-05', 2)).toBe('2026-10-16');
    expect(fridayAfterWeeks('2026-10-05', 4)).toBe('2026-10-30');
  });

  it('commence toujours un lundi', () => {
    expect(isMonday('2026-10-05')).toBe(true);
    expect(isMonday('2026-10-06')).toBe(false);
    expect(isMonday('demain')).toBe(false);
    expect(mondayOnOrAfter('2026-10-05')).toBe('2026-10-05');
    expect(mondayOnOrAfter('2026-10-01')).toBe('2026-10-05'); // jeudi → lundi suivant
    expect(mondayOnOrAfter('2026-10-24')).toBe('2026-10-26'); // lendemain d'une fin de vendredi
  });

  it('propose 1 mois = 4 semaines', () => {
    expect(WEEK_CHOICES.find((choice) => choice.label === '1 mois')?.weeks).toBe(4);
  });
});
