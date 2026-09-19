import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandLogo } from '@/components/BrandLogo';
import { SignInForm } from '@/features/auth/SignInForm';
import { colors, radii, shadows, spacing } from '@/theme/colors';

export default function SignInScreen() {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.page}>
      <View style={styles.orangeOrb} />
      <View style={styles.greenOrb} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brandPanel}>
          <BrandLogo showTagline />
          <View style={styles.pill}><Text style={styles.pillText}>ESPACE ÉQUIPE</Text></View>
        </View>
        <View style={styles.formCard}>
          <SignInForm />
        </View>
        <Text style={styles.footer}>Des repas variés, équilibrés et livrés à temps.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, overflow: 'hidden', backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', gap: spacing.lg, padding: spacing.lg },
  orangeOrb: { position: 'absolute', right: 0, top: -80, width: 170, height: 170, borderRadius: 85, backgroundColor: colors.primarySoft },
  greenOrb: { position: 'absolute', left: 0, bottom: -80, width: 160, height: 160, borderRadius: 80, backgroundColor: colors.accentSoft },
  brandPanel: { alignItems: 'center', gap: spacing.md },
  pill: { backgroundColor: colors.primary, borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: 7 },
  pillText: { color: colors.white, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  formCard: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.xl, padding: spacing.lg, ...shadows.raised },
  footer: { color: colors.muted, fontSize: 12, fontWeight: '600', textAlign: 'center' }
});
