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

/** Marque une livraison comme préparée (ou remet « planifiée ») */
export async function setPrepared(deliveryId: string, prepared: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc('update_delivery_status', {
    p_delivery_id: deliveryId,
    p_status: prepared ? 'ready' : 'scheduled'
  });
  if (error) throw error;
}

export async function listReviews(): Promise<AdminReview[]> {
  const { data, error } = await requireSupabase().rpc('admin_reviews');
  if (error) throw error;
  return data as AdminReview[];
}

export async function getOverview(date?: string): Promise<OrdersOverview> {
  const { data, error } = await requireSupabase().rpc('orders_overview', { p_date: date ?? null });
  if (error) throw error;
  return data as OrdersOverview;
}
