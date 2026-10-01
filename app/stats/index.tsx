import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { getOverview, type TopDishes } from '@/features/orders/orders.service';
import { formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme/colors';

const PERIODS: { key: 'week' | 'month' | 'year' | 'all'; title: string }[] = [
  { key: 'week', title: 'Cette semaine' },
  { key: 'month', title: 'Ce mois' },
  { key: 'year', title: 'Cette année' },
  { key: 'all', title: 'Depuis le début' }
];

/** Plat le plus commandé : semaine, mois, année et historique général, avec les chiffres du jour */
export default function StatsScreen() {
  const overview = useQuery({ queryKey: ['orders', 'overview'], queryFn: () => getOverview() });

  if (overview.isLoading) return <LoadingView />;
  if (overview.error || !overview.data) return <ErrorView message={getErrorMessage(overview.error)} onRetry={() => void overview.refetch()} />;

  const data = overview.data;
  return (
    <Screen>
      <Text style={styles.title}>Statistiques</Text>

      <Card style={styles.today}>
        <Text style={styles.section}>Aujourd’hui</Text>
        <View style={styles.counters}>
          <Counter label="Clients actifs" value={data.active_customers} />
          <Counter label="Livraisons" value={data.deliveries_expected} />
          <Counter label="Commandes" value={data.orders_confirmed} />
          <Counter label="Par défaut" value={data.orders_default} />
          <Counter label="Annulés" value={data.orders_cancelled} />
        </View>
      </Card>

      <Text style={styles.section}>Plat le plus commandé</Text>
      {PERIODS.map((period) => (
        <TopCard dishes={data.tops[period.key]} key={period.key} title={period.title} />
      ))}
    </Screen>
  );
}

function TopCard({ title, dishes }: { title: string; dishes: TopDishes }) {
  const range = dishes.from && dishes.to ? `${formatLocalDate(dishes.from)} → ${formatLocalDate(dishes.to)}` : 'Tous les repas servis';
  const lines = [
    { label: 'Plat', dish: dishes.plat },
    { label: 'Accompagnement', dish: dishes.accompagnement },
    { label: 'Viande', dish: dishes.viande }
  ];
  return (
    <Card style={styles.top}>
      <Text style={styles.topTitle}>{title}</Text>
      <Text style={styles.range}>{range}</Text>
      {lines.every((line) => !line.dish) ? <Text style={styles.empty}>Pas encore de repas servi sur cette période.</Text> : null}
      {lines.map((line) =>
        line.dish ? (
          <View key={line.label} style={styles.line}>
            <Text style={styles.lineLabel}>{line.label}</Text>
            <Text style={styles.lineName}>{line.dish.name}</Text>
            <Text style={styles.lineCount}>{line.dish.count}×</Text>
          </View>
        ) : null
      )}
    </Card>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.counter}>
      <Text style={styles.counterValue}>{value}</Text>
      <Text style={styles.counterLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 28, fontWeight: '900', letterSpacing: -0.6 },
  section: { color: colors.primaryDark, fontSize: 17, fontWeight: '800' },
  today: { gap: spacing.md },
  counters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  counter: { alignItems: 'center', minWidth: 80, flex: 1 },
  counterValue: { color: colors.primary, fontSize: 26, fontWeight: '900' },
  counterLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  top: { gap: spacing.sm },
  topTitle: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
  range: { color: colors.muted, fontSize: 12 },
  empty: { color: colors.muted, fontSize: 14 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  lineLabel: { color: colors.muted, fontSize: 12, width: 100 },
  lineName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  lineCount: { color: colors.primary, fontSize: 14, fontWeight: '900' }
});
