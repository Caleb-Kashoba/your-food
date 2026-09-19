import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '@/theme/colors';

const labels: Record<string, string> = {
  active: 'Actif',
  pending: 'En attente',
  suspended: 'Suspendu',
  cancelled: 'Annulé',
  expiring_soon: 'Expire bientôt',
  expires_today: 'Expire aujourd’hui',
  expired: 'Expiré',
  scheduled: 'Planifiée',
  preparing: 'Préparation',
  ready: 'Prête',
  out_for_delivery: 'En livraison',
  delivered: 'Livrée',
  failed: 'Échec',
  unread: 'Non traitée',
  handled: 'Traitée',
  ignored: 'Ignorée',
  confirmed: 'Confirmé',
  unpaid: 'Non payé',
  partial: 'Partiel',
  paid: 'Payé'
};

export function StatusBadge({ status }: { status: string }) {
  const danger = ['cancelled', 'expired', 'failed'].includes(status);
  const warning = ['pending', 'expiring_soon', 'expires_today', 'unread'].includes(status);
  const success = ['active', 'delivered', 'confirmed', 'handled'].includes(status);

  return (
    <View style={[styles.badge, danger ? styles.danger : warning ? styles.warning : success ? styles.success : styles.neutral]}>
      <View style={[styles.dot, danger ? styles.dangerDot : warning ? styles.warningDot : success ? styles.successDot : styles.neutralDot]} />
      <Text style={[styles.text, danger ? styles.dangerText : warning ? styles.warningText : success ? styles.successText : null]}>
        {labels[status] ?? status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  neutral: { backgroundColor: colors.primarySoft },
  danger: { backgroundColor: colors.dangerSoft },
  warning: { backgroundColor: colors.warningSoft },
  success: { backgroundColor: colors.successSoft },
  dot: { width: 6, height: 6, borderRadius: 3 },
  neutralDot: { backgroundColor: colors.primary },
  dangerDot: { backgroundColor: colors.danger },
  warningDot: { backgroundColor: colors.warning },
  successDot: { backgroundColor: colors.success },
  text: { color: colors.primaryDark, fontSize: 11, fontWeight: '800' },
  dangerText: { color: colors.danger },
  warningText: { color: colors.warning },
  successText: { color: colors.success }
});
