import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/features/auth/AuthProvider';
import { cancelPayment, listPayments } from '@/features/payments/payments.service';
import { formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';

export default function PaymentsScreen() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const payments = useQuery({ queryKey: ['payments'], queryFn: () => listPayments() });
  const [reason, setReason] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  if (payments.isLoading) return <LoadingView />;
  if (payments.error) return <ErrorView message={getErrorMessage(payments.error)} onRetry={() => void payments.refetch()} />;

  const requestCancellation = (id: string) => {
    if (!reason.trim()) {
      Alert.alert('Motif requis', 'Renseignez le motif de correction avant d’annuler un paiement.');
      return;
    }
    Alert.alert('Annuler ce paiement ?', 'Le paiement restera visible et sera marqué comme annulé.', [
      { text: 'Retour', style: 'cancel' },
      {
        text: 'Annuler le paiement',
        style: 'destructive',
        onPress: () => {
          setCancellingId(id);
          void cancelPayment(id, reason)
            .then(async () => {
              setReason('');
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['payments'] }),
                queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
                queryClient.invalidateQueries({ queryKey: ['dashboard'] })
              ]);
            })
            .catch((error: unknown) => Alert.alert('Annulation impossible', getErrorMessage(error)))
            .finally(() => setCancellingId(null));
        }
      }
    ]);
  };

  return (
    <Screen>
      {hasPermission('payments.write') ? (
        <AppInput label="Motif de correction / annulation" multiline onChangeText={setReason} value={reason} />
      ) : null}
      {payments.data?.length === 0 ? <EmptyView message="Les paiements enregistrés apparaîtront ici." title="Aucun paiement" /> : null}
      {payments.data?.map((payment) => (
        <View key={payment.id} style={styles.item}>
          <View style={styles.header}>
            <View style={styles.grow}>
              <Text style={styles.name}>{payment.customerName}</Text>
              <Text style={styles.amount}>{formatMoney(payment.amount, payment.currency)}</Text>
            </View>
            <StatusBadge status={payment.status} />
          </View>
          <Text style={styles.meta}>{formatLocalDate(payment.paidAt)} · {payment.methodName}</Text>
          {payment.reference ? <Text style={styles.meta}>Référence : {payment.reference}</Text> : null}
          {payment.comment ? <Text style={styles.meta}>{payment.comment}</Text> : null}
          {payment.cancellationReason ? <Text style={styles.cancelled}>Motif : {payment.cancellationReason}</Text> : null}
          {hasPermission('payments.write') && payment.status !== 'cancelled' ? (
            <AppButton
              label="Annuler avec traçabilité"
              loading={cancellingId === payment.id}
              onPress={() => requestCancellation(payment.id)}
              variant="danger"
            />
          ) : null}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  amount: { color: colors.success, fontSize: 18, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  cancelled: { color: colors.danger, fontSize: 13, fontWeight: '700' }
});
