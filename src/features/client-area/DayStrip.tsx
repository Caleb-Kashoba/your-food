import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TodayMenu } from '@/features/client-area/client.service';
import { dayStatus, type DayTone } from '@/features/client-area/menu-state';
import { formatDayChip } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme/colors';

interface DayStripProps {
  days: TodayMenu[];
  selected: string;
  onSelect: (date: string) => void;
}

const TONE_COLOR: Record<DayTone, string> = {
  ok: colors.success,
  todo: colors.warning,
  info: colors.primary,
  muted: colors.muted
};

/**
 * Rangée des jours que le client peut commander. Même langage que les filtres : le jour choisi est plein (orange),
 * les autres sont blancs ; sous le numéro, un point de couleur et un mot disent où on en est (à choisir, choisi, verrouillé…).
 */
export function DayStrip({ days, selected, onSelect }: DayStripProps) {
  return (
    <ScrollView accessibilityLabel="Jours à commander" contentContainerStyle={styles.row} horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
      {days.map((day) => {
        const active = day.date === selected;
        const status = dayStatus(day);
        const date = parseISO(day.date);
        return (
          <Pressable
            accessibilityLabel={`${formatDayChip(day.date)} : ${status.label}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={day.date}
            onPress={() => onSelect(day.date)}
            style={[styles.day, active && styles.dayActive]}
          >
            <Text style={[styles.weekday, active && styles.onActive]}>{format(date, 'EEE', { locale: fr })}</Text>
            <Text style={[styles.number, active && styles.onActive]}>{format(date, 'd')}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: active ? colors.white : TONE_COLOR[status.tone] }]} />
              <Text style={[styles.status, active ? styles.onActive : { color: TONE_COLOR[status.tone] }]}>{status.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { flexGrow: 1, gap: spacing.sm, paddingVertical: 2 },
  day: {
    flex: 1,
    minWidth: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm
  },
  dayActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  weekday: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  number: { color: colors.primaryDark, fontSize: 22, fontWeight: '900', lineHeight: 26 },
  onActive: { color: colors.white },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  status: { fontSize: 11, fontWeight: '800' }
});
