import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { listMenuWeek, type WeekDay } from '@/features/menus/menus.service';
import { formatHour } from '@/features/client-area/menu-state';
import { addLocalDays, capitalizeFirst, formatDayMonth, localDateKey, mondayOf } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

const CATEGORY_ORDER = ['plat', 'accompagnement', 'viande'] as const;

export default function MenusScreen() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = addLocalDays(mondayOf(localDateKey()), weekOffset * 7);
  const friday = addLocalDays(monday, 4);
  const week = useQuery({ queryKey: ['menus', monday], queryFn: () => listMenuWeek(monday, friday) });
  const today = localDateKey();

  return (
    <Screen>
      <Text style={styles.title}>Menus de la semaine</Text>
      <View style={styles.nav}>
        <AppButton label="‹ Précédente" onPress={() => setWeekOffset((value) => value - 1)} variant="ghost" />
        <Text style={styles.range}>{formatDayMonth(monday)} → {formatDayMonth(friday)}</Text>
        <AppButton label="Suivante ›" onPress={() => setWeekOffset((value) => value + 1)} variant="ghost" />
      </View>
      {hasPermission('menus.write') ? (
        <AppButton label="Publier un menu" onPress={() => router.push('/menus/publish')} />
      ) : null}

      {week.isLoading ? <LoadingView /> : null}
      {week.error ? <ErrorView message={getErrorMessage(week.error)} onRetry={() => void week.refetch()} /> : null}
      {week.data?.map((day) => (
        <DayCard
          canWrite={hasPermission('menus.write')}
          day={day}
          key={day.date}
          onEdit={() => router.push({ pathname: '/menus/publish', params: { date: day.date } })}
          onFollow={() => router.push({ pathname: '/orders/live', params: { date: day.date } })}
          past={day.date < today}
        />
      ))}
    </Screen>
  );
}

function DayCard({ day, canWrite, past, onEdit, onFollow }: { day: WeekDay; canWrite: boolean; past: boolean; onEdit: () => void; onFollow: () => void }) {
  const locked = day.status === 'locked';
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.day}>{capitalizeFirst(formatDayMonth(day.date))}</Text>
        <View style={[styles.pill, !day.published ? styles.pillIdle : locked ? styles.pillLocked : styles.pillOpen]}>
          <Text style={styles.pillText}>{!day.published ? 'non publié' : locked ? 'verrouillé' : `ouvert · limite ${formatHour(day.deadline_time ?? '13:00')}`}</Text>
        </View>
      </View>

      {day.published
        ? CATEGORY_ORDER.map((category) => {
            const names = day.options.filter((option) => option.category === category).map((option) => option.name);
            return names.length > 0 ? <Text key={category} style={styles.line}>{names.join(' · ')}</Text> : null;
          })
        : <Text style={styles.muted}>Aucun menu publié pour ce jour.</Text>}

      <Text style={styles.meta}>
        {day.expected_deliveries} livraison{day.expected_deliveries > 1 ? 's' : ''} prévue{day.expected_deliveries > 1 ? 's' : ''}
        {day.published ? ` · ${day.orders_received} commande${day.orders_received > 1 ? 's' : ''} reçue${day.orders_received > 1 ? 's' : ''}` : ''}
      </Text>

      <View style={styles.actions}>
        {canWrite && !locked && !past ? <AppButton label={day.published ? 'Modifier' : 'Publier'} onPress={onEdit} variant={day.published ? 'secondary' : 'primary'} /> : null}
        {day.published ? <AppButton label="Suivi du jour" onPress={onFollow} variant="ghost" /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 28, fontWeight: '900', letterSpacing: -0.6 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  range: { color: colors.primaryDark, fontSize: 13, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  day: { color: colors.primaryDark, fontSize: 17, fontWeight: '900' },
  pill: { borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  pillIdle: { backgroundColor: colors.primarySoft },
  pillOpen: { backgroundColor: colors.successSoft },
  pillLocked: { backgroundColor: colors.infoSoft },
  pillText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  line: { color: colors.text, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 14 },
  meta: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }
});
