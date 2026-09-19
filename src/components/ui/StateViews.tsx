import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppButton } from '@/components/ui/AppButton';
import { colors, spacing } from '@/theme/colors';

export function LoadingView({ label = 'Chargement…' }: { label?: string }) {
  return (
    <View style={styles.state}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function EmptyView({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.state}>
      <View style={styles.icon}><Ionicons color={colors.primary} name="restaurant-outline" size={27} /></View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.muted}>{message}</Text>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.state}>
      <View style={[styles.icon, styles.errorIcon]}><Ionicons color={colors.danger} name="alert-circle-outline" size={27} /></View>
      <Text style={styles.errorTitle}>Impossible de charger les données</Text>
      <Text style={styles.muted}>{message}</Text>
      {onRetry ? <AppButton label="Réessayer" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  icon: { alignItems: 'center', justifyContent: 'center', width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primarySoft },
  errorIcon: { backgroundColor: colors.dangerSoft },
  title: { color: colors.primaryDark, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  errorTitle: { color: colors.danger, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' }
});
