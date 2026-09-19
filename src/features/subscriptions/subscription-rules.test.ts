import { describe, expect, it } from 'vitest';

import { calculateInclusiveEndDate, calculateRenewalStartDate } from '@/lib/dates';
import { buildServiceDates, calculatePaymentState, deriveSubscriptionStatus } from '@/features/subscriptions/subscription-rules';

describe('subscription date rules', () => {
  it('calculates an inclusive one-week subscription', () => {
    expect(calculateInclusiveEndDate('2026-09-16', 1, 'week')).toBe('2026-09-22');
  });

  it('handles a monthly subscription across months and years', () => {
    expect(calculateInclusiveEndDate('2026-12-15', 1, 'month')).toBe('2027-01-14');
  });

  it('starts a renewal the day after the previous subscription', () => {
    expect(calculateRenewalStartDate('2026-12-31')).toBe('2027-01-01');
  });

  it('selects only configured service weekdays', () => {
    expect(buildServiceDates({ startDate: '2026-09-16', durationValue: 1, durationUnit: 'week', weekdays: [1, 3, 5] })).toEqual([
      '2026-09-16',
      '2026-09-18',
      '2026-09-21'
    ]);
  });

  it('detects J-2 and expiration day', () => {
    const today = new Date(2026, 8, 16, 12);
    expect(deriveSubscriptionStatus({ adminStatus: 'active', endDate: '2026-09-18', reminderThresholdDays: 5, today })).toBe('expiring_soon');
    expect(deriveSubscriptionStatus({ adminStatus: 'active', endDate: '2026-09-16', reminderThresholdDays: 5, today })).toBe('expires_today');
  });

  it('keeps suspension above temporal status', () => {
    expect(deriveSubscriptionStatus({
      adminStatus: 'suspended',
      endDate: '2026-09-01',
      reminderThresholdDays: 5,
      today: new Date(2026, 8, 16, 12)
    })).toBe('suspended');
  });
});

describe('subscription payments', () => {
  it('aggregates partial payments', () => {
    expect(calculatePaymentState(35000, [10000, 15000])).toEqual({ paid: 25000, remaining: 10000, state: 'partial' });
  });
});
