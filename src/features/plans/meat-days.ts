/**
 * Jours de viande d'une formule : « tous les jours de service » (null) ou au plus deux jours du lundi au vendredi.
 * Par défaut : lundi et vendredi (formule à 25 000).
 */

export const MEAT_DAYS_MAX = 2;
export const DEFAULT_MEAT_DAYS = [1, 5];

export const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'] as const;
const WEEKDAY_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'] as const;

/** Ajoute ou retire un jour ; refuse un troisième jour (retourne la liste inchangée) */
export function toggleMeatDay(current: number[], day: number): number[] {
  if (day < 1 || day > 5) return current;
  if (current.includes(day)) {
    // Il doit en rester au moins un : pour « tous les jours », utiliser l'autre mode
    return current.length > 1 ? current.filter((value) => value !== day) : current;
  }
  if (current.length >= MEAT_DAYS_MAX) return current;
  return [...current, day].sort((a, b) => a - b);
}

/** « lundi et vendredi », « tous les jours de service » */
export function describeMeatDays(days: number[] | null): string {
  if (days === null || days.length === 0) return 'viande tous les jours';
  return `viande le ${days.map((day) => WEEKDAY_LONG[day - 1]).join(' et le ')}`;
}
