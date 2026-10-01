import { addDays, addMonths, addWeeks, differenceInCalendarDays, format, getISODay, parseISO, startOfISOWeek, subDays } from 'date-fns';
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

/** « jeudi 1 octobre » */
export function formatDayMonth(date: string): string {
  return format(parseISO(date), 'EEEE d MMMM', { locale: fr });
}

/** « 1 oct. » */
export function formatShortDate(date: string): string {
  return format(parseISO(date), 'd MMM', { locale: fr });
}

/** Lundi de la semaine d'une date (AAAA-MM-JJ) */
export function mondayOf(date: string): string {
  return format(startOfISOWeek(parseISO(date)), 'yyyy-MM-dd');
}

/** Prochain jour ouvré (lundi → vendredi) après une date */
export function nextWorkingDay(date: string): string {
  let next = addDays(parseISO(date), 1);
  while (getISODay(next) > 5) next = addDays(next, 1);
  return format(next, 'yyyy-MM-dd');
}

/** Première lettre en majuscule (« jeudi 1 octobre » → « Jeudi 1 octobre ») */
export function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** « ven. 2 oct. » : étiquette courte d'un jour */
export function formatDayChip(date: string): string {
  return format(parseISO(date), 'EEE d MMM', { locale: fr });
}
