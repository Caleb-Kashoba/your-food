/**
 * Carte des plats et menus du jour, côté administratrice. Chaque écriture passe par une fonction SQL qui applique
 * les règles (un menu compte au moins un plat, un accompagnement et une viande ; menu du lundi au vendredi ;
 * heure limite entre 11h et 19h ; verrouillage à 20h).
 */

import { requireSupabase } from '@/lib/supabase/client';
import type { MealCategory } from '@/features/client-area/client.service';

export interface CatalogEntry {
  id: string;
  category: MealCategory;
  name: string;
  is_active: boolean;
  /** Dates des menus non verrouillés qui proposent ce plat */
  next_menus: string[];
}

export interface WeekMenuOption {
  option_id: string;
  item_id: string;
  name: string;
  category: MealCategory;
}

export interface WeekDay {
  date: string;
  published: boolean;
  menu_id: string | null;
  status: 'open' | 'locked' | null;
  deadline_time: string | null;
  options: WeekMenuOption[];
  expected_deliveries: number;
  orders_received: number;
}

export class DishOnOpenMenuError extends Error {
  constructor(readonly date: string) {
    super('Ce plat est proposé sur un menu qui n’est pas encore verrouillé.');
    this.name = 'DishOnOpenMenuError';
  }
}

export async function listCatalog(): Promise<CatalogEntry[]> {
  const { data, error } = await requireSupabase().rpc('list_catalog');
  if (error) throw error;
  return data as CatalogEntry[];
}

export async function createDish(category: MealCategory, name: string): Promise<void> {
  const { error } = await requireSupabase().rpc('create_catalog_item', { p_category: category, p_name: name });
  if (error) throw error;
}

export async function updateDish(
  id: string,
  changes: { name?: string; category?: MealCategory; active?: boolean }
): Promise<{ removed_menus: string[]; kept_menus: string[] }> {
  const { data, error } = await requireSupabase().rpc('update_catalog_item', {
    p_id: id,
    p_name: changes.name ?? null,
    p_category: changes.category ?? null,
    p_active: changes.active ?? null
  });
  if (error) throw error;
  return data as { removed_menus: string[]; kept_menus: string[] };
}

/** Supprime un plat ; lève DishOnOpenMenuError (avec la date) s'il est encore sur un menu non verrouillé */
export async function deleteDish(id: string): Promise<{ remaining: number }> {
  const { data, error } = await requireSupabase().rpc('delete_catalog_item', { p_id: id });
  if (error) {
    if (error.message === 'PLAT_SUR_MENU_OUVERT') throw new DishOnOpenMenuError(error.details ?? '');
    throw error;
  }
  return data as { remaining: number };
}

export async function listMenuWeek(from: string, to: string): Promise<WeekDay[]> {
  const { data, error } = await requireSupabase().rpc('list_menu_week', { p_from: from, p_to: to });
  if (error) throw error;
  return data as WeekDay[];
}

export async function publishMenu(date: string, itemIds: string[], deadline: string): Promise<void> {
  const { error } = await requireSupabase().rpc('publish_menu', { p_date: date, p_item_ids: itemIds, p_deadline: deadline });
  if (error) throw error;
}

export async function publishMenus(start: string, days: number, itemIds: string[], deadline: string): Promise<{ created: string[]; ignored: string[] }> {
  const { data, error } = await requireSupabase().rpc('publish_menus', {
    p_start: start,
    p_days: days,
    p_item_ids: itemIds,
    p_deadline: deadline
  });
  if (error) throw error;
  return data as { created: string[]; ignored: string[] };
}

export async function updateMenu(date: string, changes: { itemIds?: string[]; deadline?: string }): Promise<void> {
  const { error } = await requireSupabase().rpc('update_menu', {
    p_date: date,
    p_item_ids: changes.itemIds ?? null,
    p_deadline: changes.deadline ?? null
  });
  if (error) throw error;
}

export async function lockMenuNow(date: string): Promise<number> {
  const { data, error } = await requireSupabase().rpc('lock_menu_now', { p_date: date });
  if (error) throw error;
  return data as number;
}
