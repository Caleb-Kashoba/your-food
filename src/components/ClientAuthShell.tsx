import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandLogo } from '@/components/BrandLogo';
import { colors, radii, shadows, spacing } from '@/theme/colors';

interface ClientAuthShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** Coque des écrans d'accès du client : logo et couleurs Your Food, ton chaleureux */
export function ClientAuthShell({ title, subtitle, children }: ClientAuthShellProps) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.page}>
      <View style={styles.orangeOrb} />
      <View style={styles.greenOrb} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <BrandLogo showTagline />
        </View>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <View style={styles.body}>{children}</View>
        </View>
        <Text style={styles.footer}>Des repas variés, équilibrés et livrés à temps.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, overflow: 'hidden', backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', gap: spacing.lg, padding: spacing.lg, maxWidth: 480, width: '100%', alignSelf: 'center' },
  orangeOrb: { position: 'absolute', right: -30, top: -80, width: 190, height: 190, borderRadius: 95, backgroundColor: colors.primarySoft },
  greenOrb: { position: 'absolute', left: -30, bottom: -80, width: 180, height: 180, borderRadius: 90, backgroundColor: colors.accentSoft },
  brand: { alignItems: 'center' },
  card: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.xs, ...shadows.raised },
  title: { color: colors.primaryDark, fontSize: 30, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  body: { gap: spacing.md, marginTop: spacing.md },
  footer: { color: colors.muted, fontSize: 12, fontWeight: '600', textAlign: 'center' }
});
