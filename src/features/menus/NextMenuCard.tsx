import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { listMenuWeek } from '@/features/menus/menus.service';
import { formatDayChip, localDateKey, nextWorkingDay } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme/colors';

/**
 * Tableau de bord : le menu du prochain jour ouvré. Les clients commandent la veille ;
 * sans menu publié, ils ne peuvent pas choisir. C'est donc la première tâche de la journée.
 */
export function NextMenuCard() {
  const router = useRouter();
  const date = nextWorkingDay(localDateKey());
  const menu = useQuery({ queryKey: ['menus', 'next', date], queryFn: () => listMenuWeek(date, date) });
  const day = menu.data?.[0];
  if (menu.isLoading || menu.error) return null;

  const label = formatDayChip(date);
  if (!day?.published) {
    return (
      <Card style={[styles.card, styles.todo]}>
        <View style={styles.row}>
          <View style={styles.iconTodo}><Ionicons color={colors.warning} name="restaurant-outline" size={22} /></View>
          <View style={styles.grow}>
            <Text style={styles.title}>Menu du {label} non publié</Text>
            <Text style={styles.meta}>Les clients ne peuvent pas encore choisir leur repas.</Text>
          </View>
        </View>
        <AppButton label="Publier le menu" onPress={() => router.push({ pathname: '/menus/publish', params: { date } })} />
      </Card>
    );
  }
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconDone}><Ionicons color={colors.success} name="checkmark-circle" size={22} /></View>
        <View style={styles.grow}>
          <Text style={styles.title}>Menu du {label} publié</Text>
          <Text style={styles.meta}>{day.orders_received} commande{day.orders_received > 1 ? 's' : ''} reçue{day.orders_received > 1 ? 's' : ''} sur {day.expected_deliveries}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <AppButton label="Voir les commandes" onPress={() => router.push({ pathname: '/orders/live', params: { date } })} style={styles.grow} variant="secondary" />
        {day.status === 'open' ? (
          <AppButton label="Modifier" onPress={() => router.push({ pathname: '/menus/publish', params: { date } })} style={styles.grow} variant="ghost" />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  todo: { backgroundColor: colors.warningSoft, borderColor: colors.warningSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
  iconTodo: { alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: radii.round, backgroundColor: colors.surface },
  iconDone: { alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: radii.round, backgroundColor: colors.successSoft },
  title: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm }
});
