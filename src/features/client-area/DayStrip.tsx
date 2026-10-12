import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

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

/** Rangée des jours que le client peut commander : le jour, et son état d'un coup d'œil (à choisir, choisi, verrouillé…) */
export function DayStrip({ days, selected, onSelect }: DayStripProps) {
  return (
    <ScrollView accessibilityLabel="Jours à commander" contentContainerStyle={styles.row} horizontal showsHorizontalScrollIndicator={false}>
      {days.map((day) => {
        const active = day.date === selected;
        const status = dayStatus(day);
        return (
          <Pressable
            accessibilityLabel={`${formatDayChip(day.date)} : ${status.label}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={day.date}
            onPress={() => onSelect(day.date)}
            style={[styles.day, active && styles.dayActive]}
          >
            <Text style={[styles.date, active && styles.dateActive]}>{formatDayChip(day.date)}</Text>
            <Text style={[styles.status, { color: TONE_COLOR[status.tone] }]}>{status.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  day: {
    minWidth: 92,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  dayActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderWidth: 2 },
  date: { color: colors.text, fontSize: 14, fontWeight: '800' },
  dateActive: { color: colors.primaryDark },
  status: { fontSize: 12, fontWeight: '800' }
});
