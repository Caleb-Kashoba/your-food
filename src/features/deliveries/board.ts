/**
 * Tableau de préparation et de livraison : logique pure (sans réseau), pour afficher le repas de chaque client,
 * séparer la préparation des bols de la livraison, et totaliser ce qu'il faut préparer.
 */

export type BoardState = 'commande' | 'defaut' | 'annule' | 'en_attente' | 'livraison_annulee';

export interface BoardRow {
  delivery_id: string;
  date: string;
  customer_id: string;
  customer_name: string;
  phone: string | null;
  zone_name: string | null;
  residence: string | null;
  building: string | null;
  room: string | null;
  address_details: string | null;
  plan_name: string;
  delivery_status: string;
  /** Numéro du bol, donné au verrouillage du menu (minuit), dans l'ordre des plats ; null tant que le menu est ouvert */
  bowl_number: number | null;
  menu_status: 'aucun_menu' | 'open' | 'locked';
  order_id: string | null;
  state: BoardState;
  plat: string | null;
  accompagnement: string | null;
  viande: string | null;
}

/**
 * Étape d'un repas :
 * - attente_choix : le client n'a pas encore de repas (pas de menu publié, ou livraison ajoutée à l'instant : le repas par défaut arrive dans la minute) ;
 * - a_preparer : choisi, le bol n'est pas encore rempli ;
 * - prete : le bol est prêt, à livrer ;
 * - livree : livré ;
 * - annulee : annulé par le client ou livraison annulée.
 */
export type Stage = 'attente_choix' | 'a_preparer' | 'prete' | 'livree' | 'annulee';

export function stageOf(row: BoardRow): Stage {
  if (row.delivery_status === 'delivered') return 'livree';
  if (row.state === 'annule' || row.state === 'livraison_annulee' || row.delivery_status === 'cancelled') return 'annulee';
  if (row.state === 'en_attente') return 'attente_choix';
  if (['ready', 'out_for_delivery'].includes(row.delivery_status)) return 'prete';
  return 'a_preparer';
}

/** Les trois éléments du repas, dans l'ordre : plat, accompagnement, viande */
export function mealParts(row: BoardRow): string[] {
  return [row.plat, row.accompagnement, row.viande].filter((part): part is string => Boolean(part));
}

/** « Riz + Haricots + Cuisse de poulet » */
export function mealText(row: BoardRow): string {
  return mealParts(row).join(' + ');
}

const byName = (a: string | null, b: string | null) => (a ?? '\uffff').localeCompare(b ?? '\uffff', 'fr', { sensitivity: 'base' });

/**
 * Ordre de la cuisine : par numéro de bol (donné au verrouillage), sinon par plat, accompagnement, viande, puis client.
 * Les repas sans numéro (menu encore ouvert) sont classés de la même façon, après les bols numérotés.
 */
export function kitchenOrder(rows: BoardRow[]): BoardRow[] {
  return [...rows].sort((a, b) => {
    if (a.bowl_number !== null && b.bowl_number !== null) return a.bowl_number - b.bowl_number;
    if (a.bowl_number !== null) return -1;
    if (b.bowl_number !== null) return 1;
    return byName(a.plat, b.plat) || byName(a.accompagnement, b.accompagnement) || byName(a.viande, b.viande) || byName(a.customer_name, b.customer_name);
  });
}

export interface PlatGroup {
  plat: string;
  rows: BoardRow[];
}

/** Bols regroupés par plat, dans l'ordre de la cuisine (les repas sans plat à la fin, sous « Sans repas ») */
export function groupByPlat(rows: BoardRow[]): PlatGroup[] {
  const groups: PlatGroup[] = [];
  for (const row of kitchenOrder(rows)) {
    const plat = row.plat ?? 'Sans repas';
    const last = groups.at(-1);
    if (last && last.plat === plat) last.rows.push(row);
    else groups.push({ plat, rows: [row] });
  }
  return groups;
}

/** « Bols n°3 à 7 » ou « Bol n°3 » ; vide si aucun numéro */
export function bowlRange(rows: BoardRow[]): string {
  const numbers = rows.map((row) => row.bowl_number).filter((value): value is number => value !== null);
  if (numbers.length === 0) return '';
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return min === max ? `Bol n°${min}` : `Bols n°${min} à ${max}`;
}

/** Adresse de livraison sur une ligne */
export function addressText(row: BoardRow): string {
  return [row.zone_name, row.residence, row.building, row.room, row.address_details].filter(Boolean).join(' · ');
}

export function countByStage(rows: BoardRow[]): Record<Stage, number> {
  const counts: Record<Stage, number> = { attente_choix: 0, a_preparer: 0, prete: 0, livree: 0, annulee: 0 };
  for (const row of rows) counts[stageOf(row)] += 1;
  return counts;
}

export interface MealTotal {
  category: 'plat' | 'accompagnement' | 'viande';
  name: string;
  count: number;
}

/** Totaux à préparer (hors annulés) : « 3 × Pondu », « 2 × Fufu »… classés par catégorie puis par quantité */
export function totalsToPrepare(rows: BoardRow[]): MealTotal[] {
  const totals = new Map<string, MealTotal>();
  for (const row of rows) {
    if (['annulee', 'attente_choix'].includes(stageOf(row))) continue;
    for (const [category, name] of [['plat', row.plat], ['accompagnement', row.accompagnement], ['viande', row.viande]] as const) {
      if (!name) continue;
      const key = `${category}:${name}`;
      const entry = totals.get(key) ?? { category, name, count: 0 };
      entry.count += 1;
      totals.set(key, entry);
    }
  }
  const order = { plat: 0, accompagnement: 1, viande: 2 };
  return [...totals.values()].sort((a, b) => order[a.category] - order[b.category] || b.count - a.count || a.name.localeCompare(b.name, 'fr'));
}

/** Livraisons d'un jour */
export function rowsOfDay(rows: BoardRow[], date: string): BoardRow[] {
  return rows.filter((row) => row.date === date);
}

/** Jours distincts présents, du plus proche au plus lointain */
export function daysOf(rows: BoardRow[]): string[] {
  return [...new Set(rows.map((row) => row.date))].sort();
}

/** Prochaine action sur une livraison (statut de livraison à enregistrer), ou null si rien à faire */
export function nextStatus(row: BoardRow, mode: 'preparation' | 'livraison'): { status: 'ready' | 'delivered' | 'scheduled'; label: string } | null {
  const stage = stageOf(row);
  if (mode === 'preparation') {
    if (stage === 'a_preparer') return { status: 'ready', label: 'Marquer comme prêt' };
    if (stage === 'prete') return { status: 'scheduled', label: 'Remettre à préparer' };
    return null;
  }
  if (stage === 'prete') return { status: 'delivered', label: 'Marquer comme livré' };
  if (stage === 'livree') return { status: 'ready', label: 'Annuler la livraison' };
  return null;
}
