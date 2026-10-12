import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '@/theme/colors';

interface ChipsProps<T extends string> {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
  /** À la ligne plutôt qu'en défilement (peu de choix à voir d'un coup) */
  wrap?: boolean;
}

/** Rangée de pastilles à choix unique (filtres, catégories) */
export function Chips<T extends string>({ options, value, onChange, label, wrap = false }: ChipsProps<T>) {
  const items = options.map((option) => {
    const active = option.value === value;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        key={option.value}
        onPress={() => onChange(option.value)}
        style={[styles.chip, active && styles.chipActive]}
      >
        <Text style={[styles.text, active && styles.textActive]}>{option.label}</Text>
      </Pressable>
    );
  });
  if (wrap) {
    return (
      <View accessibilityLabel={label} style={styles.wrap}>
        {items}
      </View>
    );
  }
  return (
    <ScrollView accessibilityLabel={label} contentContainerStyle={styles.row} horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
      {items}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: 'center', backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: 9 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { color: colors.text, fontSize: 14, fontWeight: '700' },
  textActive: { color: colors.white }
});
