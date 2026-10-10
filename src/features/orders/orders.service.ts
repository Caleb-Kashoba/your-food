/**
 * Suivi des commandes, avis et statistiques de plats, côté administratrice.
 */

import { requireSupabase } from '@/lib/supabase/client';

export type LiveState = 'commande' | 'defaut' | 'annule' | 'en_attente' | 'livraison_annulee';

export interface LiveRow {
  delivery_id: string;
  customer_id: string;
  customer_name: string;
  phone: string | null;
  plan_name: string;
  delivery_status: string;
  /** Numéro du bol (donné au verrouillage du menu) */
  bowl_number: number | null;
  order_id: string | null;
  state: LiveState;
  plat: string | null;
  accompagnement: string | null;
  viande: string | null;
  prepared: boolean;
}

export interface Tally {
  category: 'plat' | 'accompagnement' | 'viande';
  name: string;
  count: number;
}

export interface LiveSummary {
  date: string;
  menu_id: string | null;
  menu_status: 'aucun_menu' | 'open' | 'locked';
  deadline_time: string | null;
  rows: LiveRow[];
  tallies: Tally[];
}

export interface AdminReview {
  review_id: string;
  customer_name: string;
  date: string;
  rating: number | null;
  comment: string | null;
  meal: string;
  created_at: string;
}

export interface TopDish {
  name: string;
  count: number;
}

export interface TopDishes {
  period: 'week' | 'month' | 'year' | 'all';
  from: string | null;
  to: string | null;
  plat: TopDish | null;
  accompagnement: TopDish | null;
  viande: TopDish | null;
}

export interface OrdersOverview {
  date: string;
  active_customers: number;
  deliveries_expected: number;
  orders_confirmed: number;
  orders_default: number;
  orders_cancelled: number;
  tops: Record<'week' | 'month' | 'year' | 'all', TopDishes>;
}

export async function getLive(date?: string): Promise<LiveSummary> {
  const { data, error } = await requireSupabase().rpc('orders_live', { p_date: date ?? null });
  if (error) throw error;
  return data as LiveSummary;
}

export async function listReviews(): Promise<AdminReview[]> {
  const { data, error } = await requireSupabase().rpc('admin_reviews');
  if (error) throw error;
  return data as AdminReview[];
}

/** Ce que l'écran « choisir le repas d'un client » doit savoir (options du menu, repas actuel, viande permise, saisie possible ou non) */
export interface StaffOrderContext {
  date: string;
  menu_id: string | null;
  menu_locked: boolean;
  editable: boolean;
  reason: string | null;
  meat_allowed: boolean;
  delivery_status: string | null;
  order: { status: 'confirmed' | 'cancelled'; is_default: boolean; plat_option_id: string | null; accompagnement_option_id: string | null; viande_option_id: string | null } | null;
  options: { option_id: string; item_id: string; name: string; category: 'plat' | 'accompagnement' | 'viande' }[];
}

export async function getStaffOrderContext(customerId: string, date: string): Promise<StaffOrderContext> {
  const { data, error } = await requireSupabase().rpc('staff_order_context', { p_customer: customerId, p_date: date });
  if (error) throw error;
  return data as StaffOrderContext;
}

/** Saisit ou modifie le repas d'un client (même après le verrouillage, tant que le bol n'est pas prêt) */
export async function staffSetOrder(params: { customerId: string; date: string; plat: string; accompagnement: string; viande: string | null }): Promise<void> {
  const { error } = await requireSupabase().rpc('staff_set_order', {
    p_customer: params.customerId,
    p_date: params.date,
    p_plat: params.plat,
    p_accompagnement: params.accompagnement,
    p_viande: params.viande
  });
  if (error) throw error;
}

export async function staffCancelOrder(customerId: string, date: string): Promise<void> {
  const { error } = await requireSupabase().rpc('staff_cancel_order', { p_customer: customerId, p_date: date });
  if (error) throw error;
}

export async function getOverview(date?: string): Promise<OrdersOverview> {
  const { data, error } = await requireSupabase().rpc('orders_overview', { p_date: date ?? null });
  if (error) throw error;
  return data as OrdersOverview;
}
