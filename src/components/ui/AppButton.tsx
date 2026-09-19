import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

import { colors, radii, shadows, spacing } from '@/theme/colors';

interface AppButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
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

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadows.soft
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.5 },
  label: { fontSize: 15, fontWeight: '800', letterSpacing: 0.1 },
  primaryLabel: { color: colors.surface },
  secondaryLabel: { color: colors.accent },
  dangerLabel: { color: colors.surface },
  ghostLabel: { color: colors.primary }
});
