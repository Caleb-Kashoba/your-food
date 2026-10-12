import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

import { colors, radii, shadows, spacing } from '@/theme/colors';

interface AppButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  loading?: boolean;
  /**
   * primary : l'action principale (orange) ; secondary : action secondaire (blanc cassé, fin contour) ;
   * danger : action destructrice confirmée (rouge) ; ghost : lien discret ; dangerGhost : annulation discrète (texte rouge)
   */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'dangerGhost';
}

export function AppButton({ label, loading = false, variant = 'primary', disabled, style, ...props }: AppButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        styles[variant],
        state.pressed && styles.pressed,
        isDisabled && styles.disabled,
        typeof style === 'function' ? style(state) : style
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? colors.surface : colors.primary} />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const flat = { shadowOpacity: 0, elevation: 0 } as const;

const styles = StyleSheet.create({
  // Pastille, comme les filtres : un même langage pour tout ce qui se touche
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: radii.round,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm
  },
  primary: { backgroundColor: colors.primary, ...shadows.soft },
  secondary: { backgroundColor: colors.surfaceStrong, borderWidth: 1.5, borderColor: colors.border, ...flat },
  danger: { backgroundColor: colors.danger, ...shadows.soft },
  ghost: { backgroundColor: 'transparent', minHeight: 44, ...flat },
  dangerGhost: { backgroundColor: 'transparent', minHeight: 44, ...flat },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },
  label: { fontSize: 16, fontWeight: '800' },
  primaryLabel: { color: colors.white },
  secondaryLabel: { color: colors.primaryDark },
  dangerLabel: { color: colors.white },
  ghostLabel: { color: colors.primary, fontSize: 15 },
  dangerGhostLabel: { color: colors.danger, fontSize: 15 }
});
