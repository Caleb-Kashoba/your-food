import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { listDeliveries, listDeliveriesRange, updateDeliveryStatus } from '@/features/deliveries/deliveries.service';
import { useTableRealtime } from '@/hooks/use-table-realtime';
import { addLocalDays, formatLocalDate, localDateKey } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, shadows, spacing } from '@/theme/colors';
import type { DeliveryStatus } from '@/types/domain';

const realtimeKeys = [['deliveries'], ['dashboard']] as const;
const statusFilters: { label: string; value: DeliveryStatus | 'all' }[] = [
  { label: 'Toutes', value: 'all' },
  { label: 'Restantes', value: 'scheduled' },
  { label: 'Prêtes', value: 'ready' },
  { label: 'Livrées', value: 'delivered' }
];

export default function TodayScreen() {
  const { member, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DeliveryStatus | 'all'>('all');
  const [zone, setZone] = useState('all');
  const [view, setView] = useState<'today' | 'week'>('today');
  const date = localDateKey();
  const weekEnd = addLocalDays(date, 6);
  const deliveries = useQuery({
    queryKey: ['deliveries', view, date, weekEnd],
    queryFn: () => view === 'today' ? listDeliveries(date) : listDeliveriesRange(date, weekEnd)
  });
  useTableRealtime('deliveries', member?.organizationId, realtimeKeys);

  const mutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: DeliveryStatus }) => updateDeliveryStatus(id, nextStatus),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      ]);
    },
    onError: (error) => Alert.alert('Mise à jour impossible', getErrorMessage(error))
  });

  const zones = useMemo(
    () => Array.from(new Set(deliveries.data?.map((item) => item.zoneName).filter((value): value is string => Boolean(value)) ?? [])),
    [deliveries.data]
  );
  const filtered = useMemo(
    () =>
      deliveries.data?.filter((item) => {
        const statusMatches = status === 'all' || (status === 'scheduled' ? item.status !== 'delivered' && item.status !== 'cancelled' : item.status === status);
        return statusMatches && (zone === 'all' || item.zoneName === zone);
      }) ?? [],
    [deliveries.data, status, zone]
  );
  const deliveredCount = deliveries.data?.filter((item) => item.status === 'delivered').length ?? 0;

  if (deliveries.isLoading) return <LoadingView label="Chargement des livraisons…" />;
  if (deliveries.error) return <ErrorView message={getErrorMessage(deliveries.error)} onRetry={() => void deliveries.refetch()} />;

  return (
    <View style={styles.page}>
      <View style={styles.summary}>
        <View style={styles.viewSwitch}>
          <Pressable onPress={() => setView('today')} style={[styles.viewButton, view === 'today' && styles.viewButtonActive]}>
            <Text style={[styles.viewText, view === 'today' && styles.viewTextActive]}>Aujourd’hui</Text>
          </Pressable>
          <Pressable onPress={() => setView('week')} style={[styles.viewButton, view === 'week' && styles.viewButtonActive]}>
            <Text style={[styles.viewText, view === 'week' && styles.viewTextActive]}>7 jours</Text>
          </Pressable>
        </View>
        <Text style={styles.date}>{view === 'today' ? formatLocalDate(date) : `${formatLocalDate(date)} → ${formatLocalDate(weekEnd)}`}</Text>
        <Text style={styles.total}>{deliveries.data?.length ?? 0} prévues</Text>
        <Text style={styles.progress}>{deliveredCount} livrées · {Math.max((deliveries.data?.length ?? 0) - deliveredCount, 0)} restantes</Text>
      </View>
      <ScrollView horizontal contentContainerStyle={styles.filters} showsHorizontalScrollIndicator={false}>
        {statusFilters.map((filter) => (
          <Pressable key={filter.value} onPress={() => setStatus(filter.value)} style={[styles.filter, status === filter.value && styles.filterActive]}>
            <Text style={[styles.filterText, status === filter.value && styles.filterTextActive]}>{filter.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {zones.length ? (
        <ScrollView horizontal contentContainerStyle={styles.zoneFilters} showsHorizontalScrollIndicator={false}>
          <Pressable onPress={() => setZone('all')}><Text style={[styles.zoneText, zone === 'all' && styles.zoneTextActive]}>Toutes zones</Text></Pressable>
          {zones.map((item) => (
            <Pressable key={item} onPress={() => setZone(item)}><Text style={[styles.zoneText, zone === item && styles.zoneTextActive]}>{item}</Text></Pressable>
          ))}
        </ScrollView>
      ) : null}
      <FlatList
        contentContainerStyle={styles.list}
        data={filtered}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<EmptyView message="Aucune livraison ne correspond aux filtres." title="Aucune livraison" />}
        onRefresh={() => void deliveries.refetch()}
        refreshing={deliveries.isRefetching}
        renderItem={({ item }) => (
          <View style={styles.delivery}>
            <View style={styles.deliveryHeader}>
              <View style={styles.deliveryTitle}>
                <Text style={styles.name}>{item.customerName}</Text>
                <Text style={styles.meta}>{item.planName}</Text>
              </View>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.meta}>{[item.zoneName, item.residence, item.building, item.room].filter(Boolean).join(' · ')}</Text>
            {view === 'week' ? <Text style={styles.deliveryDate}>{formatLocalDate(item.deliveryDate)}</Text> : null}
            <Text style={styles.meta}>{item.phone}</Text>
            {item.status !== 'delivered' && item.status !== 'cancelled' && hasPermission('deliveries.update') ? (
              <Pressable
                disabled={mutation.isPending}
                onPress={() => mutation.mutate({ id: item.id, nextStatus: 'delivered' })}
                style={styles.deliverButton}
              >
                <Text style={styles.deliverButtonText}>Marquer comme livrée</Text>
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
  summary: { backgroundColor: colors.primaryDark, borderRadius: radii.lg, margin: spacing.md, marginBottom: spacing.sm, padding: spacing.lg, gap: spacing.xs, ...shadows.soft },
  viewSwitch: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: radii.round, padding: spacing.xs },
  viewButton: { borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  viewButtonActive: { backgroundColor: colors.primary },
  viewText: { color: colors.muted, fontWeight: '700' },
  viewTextActive: { color: colors.surface },
  date: { color: colors.sand, fontSize: 13, textTransform: 'capitalize' },
  total: { color: colors.white, fontSize: 30, fontWeight: '900' },
  progress: { color: colors.sand, fontSize: 14, fontWeight: '600' },
  filters: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  filter: { borderRadius: radii.round, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.muted, fontWeight: '600' },
  filterTextActive: { color: colors.surface },
  zoneFilters: { gap: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  zoneText: { color: colors.muted, fontWeight: '600' },
  zoneTextActive: { color: colors.primary, fontWeight: '900' },
  list: { padding: spacing.md, gap: spacing.sm },
  delivery: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, ...shadows.soft },
  deliveryHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  deliveryTitle: { flex: 1 },
  name: { color: colors.primaryDark, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  deliveryDate: { color: colors.primaryDark, fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },
  deliverButton: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radii.md, marginTop: spacing.sm, padding: spacing.md },
  deliverButtonText: { color: colors.accent, fontWeight: '900' }
});
