import { StyleSheet, Text, View } from 'react-native';

import { Chips } from '@/components/ui/Chips';
import {
  NO_MEAT,
  SORT_OPTIONS,
  bowlContents,
  filterBowls,
  hasFilter,
  type BoardRow,
  type BowlFilter,
  type ContentOption,
  type SortKey
} from '@/features/deliveries/board';
import { colors, radii, spacing } from '@/theme/colors';

const ALL = '';

interface BowlToolsProps {
  /** Bols de la liste affichée (avant le filtre sur le contenu) */
  rows: BoardRow[];
  filter: BowlFilter;
  onFilter: (filter: BowlFilter) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
}

/**
 * Outils de la cuisine : trier les bols (par numéro, plat, accompagnement, viande ou client) et filtrer sur ce qu'ils contiennent.
 * Les nombres à côté de chaque plat tiennent compte des autres filtres choisis : on voit toujours combien de bols restent.
 */
export function BowlTools({ rows, filter, onFilter, sort, onSort }: BowlToolsProps) {
  const withMeal = rows.filter((row) => row.plat);
  if (withMeal.length === 0) return null;

  const options = (category: 'plat' | 'accompagnement' | 'viande'): ContentOption[] =>
    bowlContents(filterBowls(withMeal, { ...filter, [category]: null }))[category];
  const chips = (category: 'plat' | 'accompagnement' | 'viande') => {
    const list = options(category);
    const result = [{ value: ALL, label: 'Tous' }, ...list.map((item) => ({ value: item.name, label: `${item.name} · ${item.count}` }))];
    if (category === 'viande') {
      const without = bowlContents(filterBowls(withMeal, { ...filter, viande: null })).withoutMeat;
      if (without > 0) result.push({ value: NO_MEAT, label: `Sans viande · ${without}` });
    }
    return result;
  };
  const set = (category: 'plat' | 'accompagnement' | 'viande') => (value: string) => onFilter({ ...filter, [category]: value === ALL ? null : value });
  const shown = filterBowls(withMeal, filter).length;
  const active = [filter.plat, filter.accompagnement, filter.viande === NO_MEAT ? 'sans viande' : filter.viande].filter(Boolean).join(' + ');

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Contenu des bols</Text>
      <Text style={styles.label}>Trier par</Text>
      <Chips onChange={onSort} options={SORT_OPTIONS} value={sort} />
      <Text style={styles.label}>Plat</Text>
      <Chips onChange={set('plat')} options={chips('plat')} value={filter.plat ?? ALL} />
      <Text style={styles.label}>Accompagnement</Text>
      <Chips onChange={set('accompagnement')} options={chips('accompagnement')} value={filter.accompagnement ?? ALL} />
      <Text style={styles.label}>Viande</Text>
      <Chips onChange={set('viande')} options={chips('viande')} value={filter.viande ?? ALL} />
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {hasFilter(filter) ? `${shown} bol${shown > 1 ? 's' : ''} sur ${withMeal.length} : ${active}` : `${withMeal.length} bol${withMeal.length > 1 ? 's' : ''}`}
        </Text>
        {hasFilter(filter) ? (
          <Text accessibilityRole="button" onPress={() => onFilter({})} style={styles.reset}>Tout afficher</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, gap: spacing.xs, padding: spacing.md },
  title: { color: colors.primaryDark, fontSize: 16, fontWeight: '900', marginBottom: spacing.xs },
  label: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, marginTop: spacing.xs },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.sm },
  summaryText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '800' },
  reset: { color: colors.primary, fontSize: 14, fontWeight: '800', paddingVertical: spacing.xs }
});
