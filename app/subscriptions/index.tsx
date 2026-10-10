import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chips } from '@/components/ui/Chips';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { listSubscriptions } from '@/features/subscriptions/subscriptions.service';
import { useTableRealtime } from '@/hooks/use-table-realtime';
import { formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';
import type { SubscriptionEffectiveStatus } from '@/types/domain';

const subscriptionRealtimeKeys = [['subscriptions']] as const;

type StateFilter = 'all' | 'active' | 'expiring' | 'expired';
const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'active', label: 'En cours' },
  { value: 'expiring', label: 'Finissent bientôt' },
  { value: 'expired', label: 'Expirés' }
];
// Mêmes regroupements que les compteurs du tableau de bord
const STATES: Record<Exclude<StateFilter, 'all'>, SubscriptionEffectiveStatus[]> = {
  active: ['active', 'expiring_soon', 'expires_today'],
  expiring: ['expiring_soon', 'expires_today'],
  expired: ['expired']
};
function isStateFilter(value: string | undefined): value is StateFilter {
  return STATE_FILTERS.some((option) => option.value === value);
}

export default function SubscriptionsScreen() {
  const router = useRouter();
  const { member } = useAuth();
  const subscriptions = useQuery({ queryKey: ['subscriptions'], queryFn: () => listSubscriptions() });
  const params = useLocalSearchParams<{ state?: string }>();
  // Le choix fait ici prime ; un lien qui apporte un autre filtre le remplace
  const [picked, setPicked] = useState<{ from: string | undefined; state: StateFilter } | null>(null);
  const state: StateFilter = picked && picked.from === params.state ? picked.state : isStateFilter(params.state) ? params.state : 'all';
  useTableRealtime('subscriptions', member?.organizationId, subscriptionRealtimeKeys);
  useTableRealtime('payments', member?.organizationId, subscriptionRealtimeKeys);
  if (subscriptions.isLoading) return <LoadingView />;
  if (subscriptions.error) return <ErrorView message={getErrorMessage(subscriptions.error)} onRetry={() => void subscriptions.refetch()} />;

  return (
    <View style={styles.page}>
      <FlatList
        contentContainerStyle={styles.list}
        data={state === 'all' ? subscriptions.data : subscriptions.data?.filter((item) => STATES[state].includes(item.effectiveStatus))}
        ListHeaderComponent={<Chips label="Filtrer par état" onChange={(value) => setPicked({ from: params.state, state: value })} options={STATE_FILTERS} value={state} />}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<EmptyView message={state === 'all' ? 'Créez le premier abonnement depuis une fiche client.' : 'Aucun abonnement dans cet état.'} title="Aucun abonnement" />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: '/subscriptions/[id]', params: { id: item.id } })} style={styles.item}>
            <View style={styles.header}>
              <View style={styles.grow}>
                <Text style={styles.name}>{item.customerName}</Text>
                <Text style={styles.meta}>{item.planName}</Text>
              </View>
              <StatusBadge status={item.effectiveStatus} />
            </View>
            <Text style={styles.meta}>{formatLocalDate(item.startDate)} → {formatLocalDate(item.endDate)}</Text>
            <Text style={styles.amount}>{formatMoney(item.amountPaid, item.currency)} / {formatMoney(item.price, item.currency)}</Text>
          </Pressable>
        )}
      />
      <Pressable accessibilityLabel="Créer un abonnement" accessibilityRole="button" onPress={() => router.push('/subscriptions/new')} style={styles.fab}><Text style={styles.fabText}>＋</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md, paddingBottom: 90, gap: spacing.sm },
  item: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13 },
  amount: { color: colors.success, fontWeight: '700' },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, alignItems: 'center', justifyContent: 'center', width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary },
  fabText: { color: colors.surface, fontSize: 30, lineHeight: 34 }
});
