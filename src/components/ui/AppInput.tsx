import { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radii, spacing } from '@/theme/colors';

interface AppInputProps extends TextInputProps {
  label: string;
  error?: string | undefined;
}

export const AppInput = forwardRef<TextInput, AppInputProps>(function AppInput(
  { label, error, style, onBlur, onFocus, ...props },
  ref
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
      <TextInput
        ref={ref}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        placeholderTextColor={colors.muted}
        selectionColor={colors.primary}
        style={[styles.input, focused && styles.inputFocused, error ? styles.inputError : null, style]}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  label: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  labelFocused: { color: colors.primary },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceStrong,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  inputFocused: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.surface },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 13 }
});
