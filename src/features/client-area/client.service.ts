/**
 * Espace client : menu du jour, commande, annulation, historique, avis et compte. Chaque appel passe par une
 * fonction SQL qui vérifie l'identité du client (voir supabase/migrations/…_orders.sql et …_subscriptions_stats_audit.sql).
 */

import { requireSupabase } from '@/lib/supabase/client';

export type MealCategory = 'plat' | 'accompagnement' | 'viande';
export type MenuStatus = 'aucun_menu' | 'normal' | 'en_retard' | 'verrouille';
export type SubscriptionState = 'aucun' | 'actif' | 'bientot_expire' | 'expire' | 'non_commence' | 'suspendu' | 'annule';

export interface MenuOption {
  option_id: string;
  item_id: string;
  name: string;
  category: MealCategory;
}

export interface ClientOrder {
  id: string;
  status: 'confirmed' | 'cancelled';
  is_default: boolean;
  plat_option_id: string | null;
  accompagnement_option_id: string | null;
  viande_option_id: string | null;
  updated_at: string;
}

export interface SubscriptionContext {
  state: SubscriptionState;
  plan_name?: string;
  start_date?: string;
  end_date?: string;
  working_days_left?: number;
}

/** Repas d'aujourd'hui (commandé hier) : en lecture seule */
export interface TodayMeal {
  date: string;
  delivery_status: 'scheduled' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'failed' | 'cancelled';
  is_default: boolean;
  cancelled: boolean;
  plat: string | null;
  accompagnement: string | null;
  viande: string | null;
}

export interface TodayMenu {
  /** Jour du repas proposé : demain (on commande la veille, jusqu'à 20h) */
  date: string;
  /** Jour où l'on commande (aujourd'hui) */
  order_date?: string;
  menu_status: MenuStatus;
  subscription: SubscriptionContext;
  meat_allowed_today: boolean;
  /** L'abonnement commence demain : le premier repas est attribué automatiquement */
  first_day_default?: boolean;
  /** Dernier jour d'abonnement : demain l'abonnement est terminé, mais il court encore aujourd'hui (pas « expiré ») */
  last_day?: boolean;
  today_meal?: TodayMeal | null;
  /** Quand il n'y a pas de menu demain : le prochain menu publié */
  next_menu_date?: string | null;
  /** `lock_time` : heure limite de commande si elle est réglée, sinon `null` (aucune limite) ; `deadline_time` n'est plus utilisé */
  menu: { id: string; deadline_time: string | null; lock_time: string | null; lock_date?: string | null; options: MenuOption[] } | null;
  order: ClientOrder | null;
  review_due: { order_id: string; date: string } | null;
  server_now: string;
  /** Heure du serveur − heure de l'appareil (ms), mesurée à la réception : le compte à rebours ne dépend pas de l'horloge du téléphone */
  device_offset_ms: number;
}

export interface HistoryEntry {
  order_id: string;
  date: string;
  status: 'confirmed' | 'cancelled';
  is_default: boolean;
  plat: string | null;
  accompagnement: string | null;
  viande: string | null;
  rating: number | null;
  comment: string | null;
  review_possible: boolean;
}

export interface Account {
  customer: { first_name: string; last_name: string; phone: string | null };
  subscription: SubscriptionContext;
  balance: { price: number; currency: string; paid: number; remaining: number } | null;
  payments: { amount: number; currency: string; paid_at: string; method: string; status: string }[];
}

export async function getTodayMenu(): Promise<TodayMenu> {
  const { data, error } = await requireSupabase().rpc('my_today_menu');
  if (error) throw error;
  const menu = data as Omit<TodayMenu, 'device_offset_ms'>;
  return { ...menu, device_offset_ms: Date.parse(menu.server_now) - Date.now() };
}

export async function submitOrder(params: {
  menuId: string;
  plat: string;
  accompagnement: string;
  viande: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().rpc('submit_my_order', {
    p_menu_id: params.menuId,
    p_plat: params.plat,
    p_accompagnement: params.accompagnement,
    p_viande: params.viande
  });
  if (error) throw error;
}

export async function cancelOrder(menuId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('cancel_my_order', { p_menu_id: menuId });
  if (error) throw error;
}

export async function getHistory(filters: { from?: string; to?: string; q?: string } = {}): Promise<HistoryEntry[]> {
  const { data, error } = await requireSupabase().rpc('my_history', {
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_q: filters.q?.trim() || null
  });
  if (error) throw error;
  return data as HistoryEntry[];
}

export async function submitReview(params: { orderId: string; rating?: number; comment?: string }): Promise<void> {
  const { error } = await requireSupabase().rpc('submit_my_review', {
    p_order_id: params.orderId,
    p_rating: params.rating ?? null,
    p_comment: params.comment?.trim() || null
  });
  if (error) throw error;
}

export async function getAccount(): Promise<Account> {
  const { data, error } = await requireSupabase().rpc('my_account');
  if (error) throw error;
  return data as Account;
}

/** Change le mot de passe après avoir vérifié l'ancien (la connexion se fait avec l'e-mail technique du compte) */
export async function changeMyPassword(oldPassword: string, newPassword: string): Promise<void> {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user?.email) throw new Error('Session expirée : reconnecte-toi.');

  const { error: checkError } = await client.auth.signInWithPassword({ email: userData.user.email, password: oldPassword });
  if (checkError) throw new Error('Ton mot de passe actuel est incorrect.');

  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
