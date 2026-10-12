/**
 * Heure limite de commande (réglage `order_limit`) :
 * - « none » : pas d'heure limite, le menu se verrouille à minuit, au début du jour du repas (par défaut) ;
 * - « veille@HH:MM » : les commandes se ferment la veille du repas à cette heure ;
 * - « jour@HH:MM » : les commandes restent ouvertes le jour du repas jusqu'à cette heure (midi au plus tard).
 */
export type OrderLimit = { mode: 'none' } | { mode: 'veille'; time: string } | { mode: 'jour'; time: string };
export type LimitMode = OrderLimit['mode'];

export const DEFAULT_LIMIT_TIME: Record<'veille' | 'jour', string> = { veille: '20:00', jour: '06:00' };
export const LATEST_DAY_TIME = '12:00';

export function parseOrderLimit(value: string): OrderLimit {
  const [mode, time] = value.trim().toLowerCase().split('@');
  if ((mode === 'veille' || mode === 'jour') && time && /^[0-2][0-9]:[0-5][0-9]$/.test(time)) return { mode, time };
  return { mode: 'none' };
}

export function serializeOrderLimit(limit: OrderLimit): string {
  return limit.mode === 'none' ? 'none' : `${limit.mode}@${limit.time}`;
}

/** « 6:00 », « 06:00 », « 20h », « 20h30 » → « HH:MM » ; null si ce n'est pas une heure */
export function parseTime(text: string): string | null {
  const match = /^(\d{1,2})\s*(?:[:hH]\s*(\d{2})?)$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** « 20:00 » → « 20h00 » */
export function hourLabel(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':');
  return `${Number(hours)}h${minutes}`;
}

export function validateOrderLimit(mode: LimitMode, timeText: string): { ok: true; value: OrderLimit } | { ok: false; error: string } {
  if (mode === 'none') return { ok: true, value: { mode: 'none' } };
  const time = parseTime(timeText);
  if (time === null) return { ok: false, error: 'Saisissez une heure, par exemple 20:00.' };
  if (mode === 'jour' && time > LATEST_DAY_TIME) return { ok: false, error: 'Le jour du repas, l’heure limite est midi au plus tard.' };
  return { ok: true, value: { mode, time } };
}

/** Phrase affichée sous le réglage */
export function describeOrderLimit(limit: OrderLimit): string {
  if (limit.mode === 'none') return 'Pas d’heure limite : les commandes se ferment à minuit, au début du jour du repas.';
  if (limit.mode === 'veille') return `Les commandes se ferment la veille du repas, à ${hourLabel(limit.time)}.`;
  return `Les commandes restent ouvertes le jour du repas jusqu’à ${hourLabel(limit.time)}. Les bols sont numérotés à cette heure : la cuisine commence après.`;
}
