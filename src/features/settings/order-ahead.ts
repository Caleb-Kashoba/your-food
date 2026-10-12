/**
 * Jusqu'où les clients peuvent choisir leurs repas à l'avance (réglage `order_ahead`) :
 * - « week » : jusqu'au vendredi de la semaine (par défaut) ;
 * - un nombre de jours à partir d'aujourd'hui (1 = demain seulement, l'ancien comportement) ;
 * - « none » : pas de limite, tous les menus publiés.
 */
export type OrderAhead = { mode: 'week' } | { mode: 'none' } | { mode: 'days'; days: number };

export const MAX_ORDER_AHEAD_DAYS = 60;

export function parseOrderAhead(value: string): OrderAhead {
  const text = value.trim().toLowerCase();
  if (text === 'none') return { mode: 'none' };
  if (/^[0-9]+$/.test(text)) return { mode: 'days', days: Math.min(Math.max(Number(text), 1), MAX_ORDER_AHEAD_DAYS) };
  return { mode: 'week' };
}

export function serializeOrderAhead(value: OrderAhead): string {
  return value.mode === 'days' ? String(value.days) : value.mode;
}

/** Valeur saisie pour le nombre de jours : un entier entre 1 et 60, sinon null */
export function parseDays(text: string): number | null {
  if (!/^[0-9]+$/.test(text.trim())) return null;
  const days = Number(text.trim());
  return days >= 1 && days <= MAX_ORDER_AHEAD_DAYS ? days : null;
}

/** Phrase affichée sous le réglage */
export function describeOrderAhead(value: OrderAhead): string {
  if (value.mode === 'none') return 'Les clients peuvent choisir tous les jours dont le menu est publié.';
  if (value.mode === 'days') {
    return value.days === 1
      ? 'Les clients choisissent seulement le repas de demain.'
      : `Les clients peuvent choisir jusqu’à ${value.days} jours à l’avance (dans la limite des menus publiés).`;
  }
  return 'Les clients peuvent choisir jusqu’au vendredi de la semaine (le week-end : la semaine qui commence lundi).';
}
