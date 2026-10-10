import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { longDate, monthGrid, monthTitle, shiftMonth } from '@/lib/calendar';
import { localDateKey } from '@/lib/dates';
import { colors, radii, shadows, spacing } from '@/theme/colors';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

interface DateFieldProps {
  label: string;
  /** AAAA-MM-JJ */
  value: string;
  onChange: (value: string) => void;
  /** Seuls les lundis sont choisissables (début d'abonnement) */
  mondaysOnly?: boolean;
  /** Dates choisissables : de `min` à `max` (AAAA-MM-JJ) */
  min?: string;
  max?: string;
  help?: string;
}

/**
 * Sélecteur de date : un bouton qui affiche la date en toutes lettres, et un calendrier en fenêtre.
 * Remplace la saisie « AAAA-MM-JJ » partout (même comportement sur téléphone et ordinateur).
 */
export function DateField({ label, value, onChange, mondaysOnly, min, max, help }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value);
  const today = localDateKey();
  const weeks = monthGrid(month);

  const allowed = (date: string, weekday: number) =>
    (!mondaysOnly || weekday === 1) && (!min || date >= min) && (!max || date <= max);
  const pick = (date: string) => {
    onChange(date);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityLabel={`${label} : ${longDate(value)}. Appuie pour changer`}
        accessibilityRole="button"
        onPress={() => { setMonth(value); setOpen(true); }}
        style={styles.field}
      >
        <Ionicons color={colors.primary} name="calendar-outline" size={20} />
        <Text style={styles.value}>{longDate(value)}</Text>
        <Ionicons color={colors.muted} name="chevron-down" size={18} />
      </Pressable>
      {help ? <Text style={styles.help}>{help}</Text> : null}

      <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <Pressable onPress={() => setOpen(false)} style={styles.backdrop}>
          <Pressable onPress={() => undefined} style={styles.sheet}>
            <Text style={styles.title}>{label}</Text>
            <View style={styles.monthRow}>
              <Pressable accessibilityLabel="Mois précédent" accessibilityRole="button" onPress={() => setMonth(shiftMonth(month, -1))} style={styles.arrow}>
                <Ionicons color={colors.primaryDark} name="chevron-back" size={22} />
              </Pressable>
              <Text style={styles.month}>{monthTitle(month)}</Text>
              <Pressable accessibilityLabel="Mois suivant" accessibilityRole="button" onPress={() => setMonth(shiftMonth(month, 1))} style={styles.arrow}>
                <Ionicons color={colors.primaryDark} name="chevron-forward" size={22} />
              </Pressable>
            </View>
            <View style={styles.weekRow}>
              {WEEKDAYS.map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}
            </View>
            {weeks.map((week) => (
              <View key={week[0]!.date} style={styles.weekRow}>
                {week.map((day) => {
                  const ok = allowed(day.date, day.weekday);
                  const selected = day.date === value;
                  return (
                    <Pressable
                      accessibilityLabel={longDate(day.date)}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !ok, selected }}
                      disabled={!ok}
                      key={day.date}
                      onPress={() => pick(day.date)}
                      style={[styles.day, selected && styles.daySelected, day.date === today && !selected && styles.dayToday]}
                    >
                      <Text style={[styles.dayText, !day.inMonth && styles.dayOutside, !ok && styles.dayOff, selected && styles.dayTextSelected]}>
                        {Number(day.date.slice(8))}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {mondaysOnly ? <Text style={styles.help}>Un abonnement commence toujours un lundi : seuls les lundis sont proposés.</Text> : null}
            <AppButton label="Fermer" onPress={() => setOpen(false)} variant="secondary" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 50, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md },
  value: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  backdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(53, 23, 14, 0.45)', padding: spacing.lg },
  sheet: { alignSelf: 'center', width: '100%', maxWidth: 380, gap: spacing.sm, backgroundColor: colors.surfaceStrong, borderRadius: radii.xl, padding: spacing.lg, ...shadows.raised },
  title: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { color: colors.primaryDark, fontSize: 17, fontWeight: '800', textTransform: 'capitalize' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.primarySoft },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: colors.muted, fontSize: 12, fontWeight: '800', paddingVertical: spacing.xs },
  day: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.round, margin: 1 },
  daySelected: { backgroundColor: colors.primary },
  dayToday: { borderColor: colors.primary, borderWidth: 1 },
  dayText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  dayOutside: { color: colors.muted },
  dayOff: { opacity: 0.3 },
  dayTextSelected: { color: colors.white }
});
