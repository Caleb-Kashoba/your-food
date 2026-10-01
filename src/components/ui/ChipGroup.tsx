import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '@/theme/colors';

interface ChipGroupProps<T extends string> {
  title: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
}

/** Groupe de pastilles à choix unique qui passent à la ligne (pas de défilement) ; retoucher la pastille active l'enlève */
export function ChipGroup<T extends string>({ title, options, value, onChange }: ChipGroupProps<T>) {
  return (
    <View style={styles.group}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.wrap}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={option.value}
              onPress={() => onChange(active ? null : option.value)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.text, active && styles.textActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  title: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: 9 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { color: colors.text, fontSize: 13, fontWeight: '700' },
  textActive: { color: colors.white }
});
