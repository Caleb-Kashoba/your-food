import { addDays, addMonths, addWeeks, differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';

export type DurationUnit = 'day' | 'week' | 'month';

export function calculateInclusiveEndDate(startDate: string, value: number, unit: DurationUnit): string {
  const start = parseISO(startDate);
  const exclusiveEnd =
    unit === 'day' ? addDays(start, value) : unit === 'week' ? addWeeks(start, value) : addMonths(start, value);

  return format(subDays(exclusiveEnd, 1), 'yyyy-MM-dd');
}

export function daysUntil(date: string, today = new Date()): number {
  return differenceInCalendarDays(parseISO(date), today);
}

export function formatLocalDate(date: string): string {
  return format(parseISO(date), 'd MMMM yyyy', { locale: fr });
}

export function localDateKey(date = new Date()): string {
  return format(date, 'yyyy-MM-dd');
}

export function addLocalDays(date: string, amount: number): string {
  return format(addDays(parseISO(date), amount), 'yyyy-MM-dd');
}

export function calculateRenewalStartDate(previousEndDate: string): string {
  return addLocalDays(previousEndDate, 1);
}
