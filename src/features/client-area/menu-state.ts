/**
 * Logique d'affichage du menu du client (états de la maquette) : pure, donc testable sans écran.
 */

import type { TodayMenu } from '@/features/client-area/client.service';

export type ClientMenuState =
  | 'aucun_menu'
  | 'non_commence'
  | 'expire'
  | 'inactif'
  | 'premier_jour'
  | 'dernier_jour'
  | 'annule'
  | 'defaut'
  | 'verrouille'
  | 'en_retard'
  | 'normal';

/**
 * État affiché. `resuming` : le client a annulé puis appuyé sur « Finalement, je mange » (possible avant 20h) :
 * on rouvre alors le choix sans repasser par le serveur.
 */
export function deriveMenuState(menu: TodayMenu, resuming = false): ClientMenuState {
  const subscription = menu.subscription.state;
  // Dernier jour : l'abonnement court encore aujourd'hui, il n'est « expiré » que demain
  if (menu.last_day && subscription === 'expire') return 'dernier_jour';
  if (subscription === 'expire') return 'expire';
  if (subscription === 'non_commence') return 'non_commence';
  if (subscription === 'suspendu' || subscription === 'annule' || subscription === 'aucun') return 'inactif';
  if (menu.menu_status === 'aucun_menu') return 'aucun_menu';
  // L'abonnement commence demain : on ne commande pas la veille du premier jour, le repas est attribué à 20h
  if (menu.first_day_default && menu.menu_status !== 'verrouille' && menu.order?.status !== 'confirmed') return 'premier_jour';

  const order = menu.order;
  if (order?.status === 'cancelled' && !(resuming && menu.menu_status !== 'verrouille')) return 'annule';
  if (menu.menu_status === 'verrouille') return order?.is_default ? 'defaut' : 'verrouille';
  return menu.menu_status === 'en_retard' ? 'en_retard' : 'normal';
}

export const HEADLINES: Record<ClientMenuState, string> = {
  normal: 'Fais-toi plaisir.',
  en_retard: 'Encore un instant.',
  verrouille: 'C’est noté pour demain.',
  defaut: 'On a choisi pour toi.',
  annule: 'Pas de repas demain.',
  expire: 'À très bientôt.',
  non_commence: 'On t’attend à table.',
  inactif: 'Ton abonnement est en pause.',
  aucun_menu: 'Pas de repas demain.',
  premier_jour: 'Bienvenue à table.',
  dernier_jour: 'C’est ton dernier jour.'
};

/** Le client peut-il encore choisir ou modifier son repas ? */
export function isEditable(state: ClientMenuState): boolean {
  return state === 'normal' || state === 'en_retard';
}

/** « 13:00:00 » ou « 13:00 » → secondes depuis minuit */
export function timeToSeconds(time: string): number {
  const [hours = '0', minutes = '0', seconds = '0'] = time.split(':');
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** Heure de Kinshasa (UTC+1, sans heure d'été) à partir d'un instant */
export function kinshasaClock(instantMs: number): { date: string; seconds: number } {
  const local = new Date(instantMs + 3600_000);
  const date = local.toISOString().slice(0, 10);
  const seconds = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
  return { date, seconds };
}

/**
 * Secondes restantes avant l'heure limite (menu « normal ») ou avant le verrouillage de 20h (« en retard » ou annulé).
 * `serverOffsetMs` = heure du serveur − heure de l'appareil, pour ne pas dépendre de l'horloge du téléphone.
 */
export function secondsLeft(menu: TodayMenu, state: ClientMenuState, nowMs: number, serverOffsetMs: number): number {
  if (!menu.menu || !menu.menu.lock_time) return 0;
  const clock = kinshasaClock(nowMs + serverOffsetMs);
  // Le choix et le verrouillage de 20h ont lieu la veille du repas (jour de commande)
  if (clock.date !== (menu.menu.lock_date ?? menu.date)) return 0;
  const target = timeToSeconds(menu.menu.lock_time);
  return Math.max(target - clock.seconds, 0);
}

export function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

/** « 13:00:00 » → « 13h00 » */
export function formatHour(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':');
  return `${Number(hours)}h${minutes.padStart(2, '0')}`;
}

export interface Picks {
  plat?: string;
  accompagnement?: string;
  viande?: string;
}

/** Choix déjà enregistrés par le client (vide si annulé ou sans commande) */
export function picksFromOrder(menu: TodayMenu): Picks {
  const order = menu.order;
  if (!order || order.status === 'cancelled') return {};
  return {
    ...(order.plat_option_id ? { plat: order.plat_option_id } : {}),
    ...(order.accompagnement_option_id ? { accompagnement: order.accompagnement_option_id } : {}),
    ...(order.viande_option_id ? { viande: order.viande_option_id } : {})
  };
}

/** Catégories à choisir pour le repas proposé (la viande dépend de la formule et du jour) */
export function requiredCategories(menu: TodayMenu): ('plat' | 'accompagnement' | 'viande')[] {
  const hasMeat = menu.meat_allowed_today && (menu.menu?.options.some((option) => option.category === 'viande') ?? false);
  return hasMeat ? ['plat', 'accompagnement', 'viande'] : ['plat', 'accompagnement'];
}

export function isComplete(menu: TodayMenu, picks: Picks): boolean {
  return requiredCategories(menu).every((category) => picks[category] !== undefined);
}

export function picksChanged(menu: TodayMenu, picks: Picks): boolean {
  const saved = picksFromOrder(menu);
  return requiredCategories(menu).some((category) => picks[category] !== saved[category]);
}
