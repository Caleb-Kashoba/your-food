import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { listPlans } from '@/features/plans/plans.service';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';

const dayLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function PlansScreen() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => listPlans() });
  if (plans.isLoading) return <LoadingView />;
  if (plans.error) return <ErrorView message={getErrorMessage(plans.error)} onRetry={() => void plans.refetch()} />;

  return (
    <View style={styles.page}>
      <FlatList
        contentContainerStyle={styles.list}
        data={plans.data}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<EmptyView message="Ajoutez une formule pour créer des abonnements." title="Aucune formule" />}
        renderItem={({ item }) => (
          <Pressable
            disabled={!hasPermission('settings.business.write')}
            onPress={() => router.push({ pathname: '/plans/[id]/edit', params: { id: item.id } })}
            style={[styles.item, !item.isActive && styles.inactive]}
          >
            <View style={styles.header}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.price}>{formatMoney(item.price, item.currency)}</Text>
            </View>
            <Text style={styles.meta}>{item.durationValue} {item.durationUnit} · {item.serviceDaysCount} jours de service</Text>
            <Text style={styles.days}>{item.serviceWeekdays.map((day) => dayLabels[day - 1]).join(' · ')}</Text>
            {!item.isActive ? <Text style={styles.inactiveText}>Formule inactive</Text> : null}
          </Pressable>
        )}
      />
      {hasPermission('settings.business.write') ? (
        <Pressable onPress={() => router.push('/plans/new')} style={styles.fab}><Text style={styles.fabText}>＋</Text></Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: 90 },
  item: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  inactive: { opacity: 0.65 },
  inactiveText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  name: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' },
  price: { color: colors.primaryDark, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13 },
  days: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, alignItems: 'center', justifyContent: 'center', width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary },
  fabText: { color: colors.surface, fontSize: 30, lineHeight: 34 }
});
