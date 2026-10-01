import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DEFAULT_MEAT_DAYS, MEAT_DAYS_MAX, WEEKDAY_SHORT, toggleMeatDay } from '@/features/plans/meat-days';
import { colors, radii, spacing } from '@/theme/colors';

interface MeatDaysFieldProps {
  /** null = viande tous les jours de service */
  value: number[] | null;
  onChange: (value: number[] | null) => void;
}

/** Choix des jours de viande d'une formule : tous les jours, ou deux jours au plus (lundi et vendredi par défaut) */
export function MeatDaysField({ value, onChange }: MeatDaysFieldProps) {
  const everyDay = value === null;
  return (
    <View style={styles.box}>
      <Text style={styles.label}>Viande incluse</Text>
      <View style={styles.modes}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: everyDay }} onPress={() => onChange(null)} style={[styles.mode, everyDay && styles.active]}>
          <Text style={[styles.modeText, everyDay && styles.activeText]}>Tous les jours</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: !everyDay }}
          onPress={() => onChange(everyDay ? [...DEFAULT_MEAT_DAYS] : value)}
          style={[styles.mode, !everyDay && styles.active]}
        >
          <Text style={[styles.modeText, !everyDay && styles.activeText]}>Certains jours</Text>
        </Pressable>
      </View>
      {!everyDay ? (
        <>
          <View style={styles.days}>
            {WEEKDAY_SHORT.map((label, index) => {
              const day = index + 1;
              const on = value.includes(day);
              return (
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} key={label} onPress={() => onChange(toggleMeatDay(value, day))} style={[styles.day, on && styles.active]}>
                  <Text style={[styles.modeText, on && styles.activeText]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.help}>{MEAT_DAYS_MAX} jours au maximum (lundi et vendredi par défaut). Les autres jours, le repas n’inclut pas de viande.</Text>
        </>
      ) : (
        <Text style={styles.help}>Le client choisit une viande chaque jour de service.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  modes: { flexDirection: 'row', gap: spacing.sm },
  mode: { flex: 1, alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.md },
  modeText: { color: colors.muted, fontWeight: '700' },
  active: { backgroundColor: colors.primary, borderColor: colors.primary },
  activeText: { color: colors.surface },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  day: { borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  help: { color: colors.muted, fontSize: 13, lineHeight: 19 }
});
