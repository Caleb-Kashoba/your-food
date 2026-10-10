import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { lockMenuNow } from '@/features/menus/menus.service';
import { getLive, setPrepared, type LiveRow, type LiveState } from '@/features/orders/orders.service';
import { StaffOrderSheet } from '@/features/orders/StaffOrderSheet';
import { addLocalDays, capitalizeFirst, formatDayMonth, localDateKey, nextWorkingDay } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

const STATE_LABEL: Record<LiveState, { text: string; bg: string }> = {
  commande: { text: 'a commandé', bg: colors.successSoft },
  defaut: { text: 'choisi par défaut', bg: colors.infoSoft },
  annule: { text: 'annulé', bg: colors.dangerSoft },
  en_attente: { text: 'en attente', bg: colors.warningSoft },
  livraison_annulee: { text: 'livraison annulée', bg: colors.dangerSoft }
};

function previousWorkingDay(date: string): string {
  let previous = addLocalDays(date, -1);
  while ([0, 6].includes(new Date(`${previous}T12:00:00Z`).getUTCDay())) previous = addLocalDays(previous, -1);
  return previous;
}

/** Suivi d'un jour : qui a commandé quoi, qui n'a pas encore choisi, et la liste à préparer (actualisé toutes les 15 s) */
export default function LiveScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // On commande la veille : le suivi s'ouvre sur le prochain jour de service (celui qu'on est en train de commander)
  const [date, setDate] = useState<string>(params.date ?? nextWorkingDay(localDateKey()));
  const [editing, setEditing] = useState<LiveRow | null>(null);
  const [confirmLock, setConfirmLock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = useQuery({ queryKey: ['orders', 'live', date], queryFn: () => getLive(date), refetchInterval: 15_000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['orders'] });

  const prepare = useMutation({
    mutationFn: (row: LiveRow) => setPrepared(row.delivery_id, !row.prepared),
    onSuccess: refresh,
    onError: (caught) => setError(getErrorMessage(caught))
  });
  const lock = useMutation({
    mutationFn: (day: string) => lockMenuNow(day),
    onSuccess: async () => {
      setConfirmLock(false);
      await refresh();
    },
    onError: (caught) => {
      setConfirmLock(false);
      setError(getErrorMessage(caught));
    }
  });

  if (live.isLoading) return <LoadingView />;
  if (live.error || !live.data) return <ErrorView message={getErrorMessage(live.error)} onRetry={() => void live.refetch()} />;

  const data = live.data;
  const count = (state: LiveState) => data.rows.filter((row) => row.state === state).length;
  const toPrepare = data.rows.filter((row) => ['commande', 'defaut'].includes(row.state));
  const prepared = toPrepare.filter((row) => row.prepared).length;
  const today = localDateKey();

  return (
    <Screen>
      <Text style={styles.title}>Suivi du jour</Text>
      <View style={styles.nav}>
        <AppButton label="‹" onPress={() => setDate(previousWorkingDay(data.date))} variant="ghost" />
        <Text style={styles.date}>{capitalizeFirst(formatDayMonth(data.date))}{data.date === today ? ' (aujourd’hui)' : data.date === nextWorkingDay(today) ? ' (prochain repas)' : ''}</Text>
        <AppButton label="›" onPress={() => setDate(nextWorkingDay(data.date))} variant="ghost" />
      </View>

      <Card style={styles.summary}>
        <Text style={styles.status}>
          {data.menu_status === 'aucun_menu' ? 'Aucun menu publié ce jour' : data.menu_status === 'locked' ? 'Menu verrouillé : liste finale (corrections possibles tant que le bol n’est pas prêt)' : 'Menu ouvert : les clients peuvent encore choisir ou changer leur repas'}
        </Text>
        <View style={styles.counters}>
          <Counter label="Commandes" value={count('commande')} />
          <Counter label="Par défaut" value={count('defaut')} />
          <Counter label="En attente" value={count('en_attente')} />
          <Counter label="Annulés" value={count('annule')} />
        </View>
        {toPrepare.length > 0 ? <Text style={styles.progress}>{prepared} / {toPrepare.length} repas préparés</Text> : null}
      </Card>

      {data.menu_status === 'open' && hasPermission('menus.write') ? (
        <AppButton label="Verrouiller maintenant" onPress={() => setConfirmLock(true)} variant="secondary" />
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {data.tallies.length > 0 ? (
        <Card style={styles.tallies}>
          <Text style={styles.section}>Ce qui est commandé</Text>
          {data.tallies.map((tally) => (
            <View key={`${tally.category}-${tally.name}`} style={styles.tally}>
              <Text style={styles.tallyName}>{tally.name}</Text>
              <Text style={styles.tallyCount}>{tally.count}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Text style={styles.section}>Livraisons ({data.rows.length})</Text>
      {data.rows.map((row) => {
        const label = STATE_LABEL[row.state];
        const canPrepare = ['commande', 'defaut'].includes(row.state) && hasPermission('deliveries.update');
        const canEdit = hasPermission('orders.write') && !['ready', 'out_for_delivery', 'delivered', 'failed'].includes(row.delivery_status);
        return (
          <Card key={row.delivery_id} style={styles.row}>
            <View style={styles.rowTop}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{row.bowl_number !== null ? `Bol n°${row.bowl_number} · ` : ''}{row.customer_name}</Text>
                <Text style={styles.meta}>{row.plan_name}{row.phone ? ` · ${row.phone}` : ''}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: label.bg }]}><Text style={styles.pillText}>{label.text}</Text></View>
            </View>
            {row.plat ? <Text style={styles.meal}>{[row.plat, row.accompagnement, row.viande].filter(Boolean).join(' · ')}</Text> : null}
            {canEdit ? (
              <AppButton
                label={['en_attente', 'annule', 'livraison_annulee'].includes(row.state) ? 'Saisir le repas' : 'Modifier le repas'}
                onPress={() => setEditing(row)}
                variant="secondary"
              />
            ) : null}
            {canPrepare ? (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: row.prepared }} onPress={() => prepare.mutate(row)} style={styles.prepare}>
                <Ionicons color={row.prepared ? colors.success : colors.muted} name={row.prepared ? 'checkbox' : 'square-outline'} size={24} />
                <Text style={styles.prepareText}>{row.prepared ? 'Préparé' : 'Marquer comme préparé'}</Text>
              </Pressable>
            ) : null}
          </Card>
        );
      })}

      {editing ? <StaffOrderSheet customerId={editing.customer_id} customerName={editing.customer_name} date={data.date} onClose={() => setEditing(null)} /> : null}

      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Verrouiller"
        loading={lock.isPending}
        message="Plus aucun client ne pourra changer son repas : les repas par défaut deviennent définitifs. Cette action est définitive."
        onCancel={() => setConfirmLock(false)}
        onConfirm={() => lock.mutate(data.date)}
        title="Verrouiller ce menu ?"
        visible={confirmLock}
      />
    </Screen>
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
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: colors.primaryDark, fontSize: 16, fontWeight: '800' },
  summary: { gap: spacing.md },
  status: { color: colors.text, fontSize: 14, fontWeight: '700' },
  counters: { flexDirection: 'row', justifyContent: 'space-between' },
  counter: { alignItems: 'center', flex: 1 },
  counterValue: { color: colors.primary, fontSize: 26, fontWeight: '900' },
  counterLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  progress: { color: colors.success, fontSize: 14, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  section: { color: colors.primaryDark, fontSize: 17, fontWeight: '800' },
  tallies: { gap: spacing.sm },
  tally: { flexDirection: 'row', justifyContent: 'space-between' },
  tallyName: { color: colors.text, fontSize: 14 },
  tallyCount: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  row: { gap: spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowText: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 12 },
  pill: { borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  pillText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  meal: { color: colors.text, fontSize: 14 },
  prepare: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  prepareText: { color: colors.text, fontSize: 14, fontWeight: '700' }
});
