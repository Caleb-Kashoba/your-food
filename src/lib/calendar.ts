import { addDays, addMonths, endOfMonth, format, getISODay, parseISO, startOfMonth, startOfISOWeek } from 'date-fns';
import { fr } from 'date-fns/locale';

export interface CalendarDay {
  /** AAAA-MM-JJ */
  date: string;
  /** Appartient au mois affiché (sinon : jour voisin, grisé) */
  inMonth: boolean;
  /** 1 = lundi … 7 = dimanche */
  weekday: number;
}

/** Grille d'un mois, semaines du lundi au dimanche (6 semaines au plus), pour un sélecteur de date */
export function monthGrid(month: string): CalendarDay[][] {
  const first = startOfMonth(parseISO(`${month.slice(0, 7)}-01`));
  const last = endOfMonth(first);
  const weeks: CalendarDay[][] = [];
  let cursor = startOfISOWeek(first);
  while (cursor <= last) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(cursor, i);
      week.push({ date: format(day, 'yyyy-MM-dd'), inMonth: day.getMonth() === first.getMonth(), weekday: getISODay(day) });
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/** Mois précédent ou suivant (AAAA-MM-01) */
export function shiftMonth(month: string, amount: number): string {
  return format(addMonths(parseISO(`${month.slice(0, 7)}-01`), amount), 'yyyy-MM-01');
}

/** « octobre 2026 » */
export function monthTitle(month: string): string {
  return format(parseISO(`${month.slice(0, 7)}-01`), 'LLLL yyyy', { locale: fr });
}

/** « lundi 12 octobre 2026 » */
export function longDate(date: string): string {
  return format(parseISO(date), 'EEEE d MMMM yyyy', { locale: fr });
}
