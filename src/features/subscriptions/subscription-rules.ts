import { addDays, eachDayOfInterval, format, getISODay, parseISO } from 'date-fns';

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

// ─── Abonnements en semaines (lundi → vendredi), reprise des règles de la première application ───

/** Prix par semaine d'une formule (une formule d'un mois compte 4 semaines) */
export function weeklyPrice(plan: { price: number; durationValue: number; durationUnit: DurationUnit }): number {
  return plan.price / (plan.durationValue * (plan.durationUnit === 'month' ? 4 : 1));
}

/** Prix total : prix hebdomadaire × nombre de semaines, sauf prix exceptionnel saisi pour ce client */
export function subscriptionTotal(weekly: number, weeks: number, override?: number | null): number {
  return override != null && override > 0 ? override : weekly * weeks;
}

/** Dernier jour d'un abonnement de `weeks` semaines commençant un lundi : le vendredi de la dernière semaine */
export function fridayAfterWeeks(mondayDate: string, weeks: number): string {
  return calculateInclusiveEndDate(mondayDate, weeks * 7 - 2, 'day');
}

/** Premier lundi à partir d'une date (la date elle-même si c'est un lundi) */
export function mondayOnOrAfter(date: string): string {
  const day = getISODay(parseISO(date));
  return day === 1 ? date : format(addDays(parseISO(date), 8 - day), 'yyyy-MM-dd');
}

export function isMonday(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && getISODay(parseISO(date)) === 1;
}

/** Durées proposées : 1 mois = 4 semaines */
export const WEEK_CHOICES: { weeks: number; label: string }[] = [
  { weeks: 1, label: '1 semaine' },
  { weeks: 2, label: '2 semaines' },
  { weeks: 3, label: '3 semaines' },
  { weeks: 4, label: '1 mois' },
  { weeks: 8, label: '2 mois' },
  { weeks: 12, label: '3 mois' }
];
