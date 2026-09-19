import { eachDayOfInterval, format, getISODay, parseISO } from 'date-fns';

import { daysUntil, type DurationUnit, calculateInclusiveEndDate } from '@/lib/dates';
import type { SubscriptionAdminStatus, SubscriptionEffectiveStatus } from '@/types/domain';

export function deriveSubscriptionStatus(params: {
  adminStatus: SubscriptionAdminStatus;
  endDate: string;
  reminderThresholdDays: number;
  today?: Date;
}): SubscriptionEffectiveStatus {
  if (params.adminStatus !== 'active') return params.adminStatus;
  const remaining = daysUntil(params.endDate, params.today);
  if (remaining < 0) return 'expired';
  if (remaining === 0) return 'expires_today';
  if (remaining <= params.reminderThresholdDays) return 'expiring_soon';
  return 'active';
}

export function buildServiceDates(params: {
  startDate: string;
  durationValue: number;
  durationUnit: DurationUnit;
  weekdays: number[];
}): string[] {
  const endDate = calculateInclusiveEndDate(params.startDate, params.durationValue, params.durationUnit);
  const allowedDays = new Set(params.weekdays);
  return eachDayOfInterval({ start: parseISO(params.startDate), end: parseISO(endDate) })
    .filter((date) => allowedDays.has(getISODay(date)))
    .map((date) => format(date, 'yyyy-MM-dd'));
}

export function calculatePaymentState(expected: number, payments: number[]): {
  paid: number;
  remaining: number;
  state: 'unpaid' | 'partial' | 'paid';
} {
  const paid = payments.reduce((sum, amount) => sum + amount, 0);
  const remaining = Math.max(expected - paid, 0);
  return {
    paid,
    remaining,
    state: paid <= 0 ? 'unpaid' : paid < expected ? 'partial' : 'paid'
  };
}
