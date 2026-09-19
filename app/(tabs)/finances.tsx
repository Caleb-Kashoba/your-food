import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { listSubscriptions } from '@/features/subscriptions/subscriptions.service';
import { useTableRealtime } from '@/hooks/use-table-realtime';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, shadows, spacing } from '@/theme/colors';

const financeRealtimeKeys = [['subscriptions'], ['payments'], ['dashboard']] as const;

export default function FinancesScreen() {
  const router = useRouter();
  const { hasPermission, member } = useAuth();
  const subscriptions = useQuery({ queryKey: ['subscriptions'], queryFn: () => listSubscriptions() });
  useTableRealtime('payments', member?.organizationId, financeRealtimeKeys);
  useTableRealtime('subscriptions', member?.organizationId, financeRealtimeKeys);

  if (subscriptions.isLoading) return <LoadingView />;
  if (subscriptions.error) return <ErrorView message={getErrorMessage(subscriptions.error)} onRetry={() => void subscriptions.refetch()} />;

  const pending = subscriptions.data?.filter((item) => item.amountRemaining > 0) ?? [];
  const totalDue = pending.reduce((sum, item) => sum + item.amountRemaining, 0);

  return (
    <View style={styles.page}>
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Solde à recevoir</Text>
        <Text style={styles.summaryValue}>{formatMoney(totalDue)}</Text>
        <Text style={styles.summaryMeta}>{pending.length} abonnement(s) non soldé(s)</Text>
        <Pressable onPress={() => router.push('/payments')} style={styles.historyAction}>
          <Text style={styles.historyActionText}>Voir l’historique des paiements</Text>
        </Pressable>
      </View>
      <FlatList
        contentContainerStyle={styles.list}
        data={pending}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<EmptyView message="Tous les abonnements visibles sont soldés." title="Aucun solde en attente" />}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <View style={styles.itemHeader}>
              <View style={styles.grow}>
                <Text style={styles.name}>{item.customerName}</Text>
                <Text style={styles.meta}>{item.planName}</Text>
              </View>
              <StatusBadge status={item.paymentState} />
            </View>
            <Text style={styles.amount}>{formatMoney(item.amountRemaining, item.currency)} restant</Text>
            <Text style={styles.meta}>{formatMoney(item.amountPaid, item.currency)} payé sur {formatMoney(item.price, item.currency)}</Text>
            {hasPermission('payments.write') ? (
              <Pressable
                onPress={() => router.push({ pathname: '/payments/new', params: { subscriptionId: item.id, customerId: item.customerId } })}
                style={styles.action}
              >
                <Text style={styles.actionText}>Enregistrer un paiement</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  summary: { backgroundColor: colors.primaryDark, margin: spacing.md, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.xs, ...shadows.raised },
  summaryLabel: { color: colors.primarySoft, fontSize: 14 },
  summaryValue: { color: colors.surface, fontSize: 31, fontWeight: '900' },
  summaryMeta: { color: colors.primarySoft, fontSize: 13 },
  historyAction: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: radii.round, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  historyActionText: { color: colors.primaryDark, fontWeight: '800' },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  item: { backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, ...shadows.soft },
  itemHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  grow: { flex: 1 },
  name: { color: colors.primaryDark, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13 },
  amount: { color: colors.danger, fontSize: 18, fontWeight: '800' },
  action: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radii.md, padding: spacing.md },
  actionText: { color: colors.primary, fontWeight: '800' }
});
