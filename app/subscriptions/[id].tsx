import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/features/auth/AuthProvider';
import { listPayments } from '@/features/payments/payments.service';
import { getSubscriptionDetail, setSubscriptionStatus, updateSubscriptionNotes } from '@/features/subscriptions/subscriptions.service';
import { calculateRenewalStartDate, formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, spacing } from '@/theme/colors';
import type { SubscriptionAdminStatus } from '@/types/domain';

const dayLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function SubscriptionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const subscription = useQuery({ queryKey: ['subscription', id], queryFn: () => getSubscriptionDetail(id), enabled: Boolean(id) });
  const payments = useQuery({ queryKey: ['payments', 'subscription', id], queryFn: () => listPayments({ subscriptionId: id }), enabled: Boolean(id) });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (subscription.isLoading) return <LoadingView />;
  if (subscription.error || !subscription.data) {
    return <ErrorView message={getErrorMessage(subscription.error)} onRetry={() => void subscription.refetch()} />;
  }

  const item = subscription.data;
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['subscription', id] }),
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
      queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    ]);
  };
  const changeStatus = (status: Exclude<SubscriptionAdminStatus, 'pending'>, label: string) => {
    if (status !== 'active' && !reason.trim()) {
      Alert.alert('Motif requis', 'Renseignez un motif avant cette action.');
      return;
    }
    Alert.alert(`${label} cet abonnement ?`, 'Cette action mettra aussi à jour les livraisons futures concernées.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: label,
        style: status === 'cancelled' ? 'destructive' : 'default',
        onPress: () => {
          setSaving(true);
          void setSubscriptionStatus(id, status, reason)
            .then(refresh)
            .catch((error: unknown) => Alert.alert('Action impossible', getErrorMessage(error)))
            .finally(() => setSaving(false));
        }
      }
    ]);
  };
  return (
    <Screen>
      <View style={styles.heading}>
        <View style={styles.grow}>
          <Text style={styles.title}>{item.customerName}</Text>
          <Text style={styles.subtitle}>{item.planName}</Text>
        </View>
        <StatusBadge status={item.effectiveStatus} />
      </View>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Période et service</Text>
        <Info label="Début" value={formatLocalDate(item.startDate)} />
        <Info label="Fin" value={formatLocalDate(item.endDate)} />
        <Info label="Jours" value={item.serviceWeekdays.map((day) => dayLabels[day - 1]).join(' · ')} />
        <Info label="Statut administratif" value={item.adminStatus} />
      </Card>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Paiement</Text>
        <Info label="Attendu" value={formatMoney(item.price, item.currency)} />
        <Info label="Versé" value={formatMoney(item.amountPaid, item.currency)} />
        <Info label="Restant" value={formatMoney(item.amountRemaining, item.currency)} />
        <StatusBadge status={item.paymentState} />
        {hasPermission('payments.write') && item.amountRemaining > 0 ? (
          <AppButton
            label="Enregistrer un paiement"
            onPress={() => router.push({ pathname: '/payments/new', params: { subscriptionId: id, customerId: item.customerId } })}
            variant="secondary"
          />
        ) : null}
        {payments.data?.map((payment) => (
          <View key={payment.id} style={styles.paymentRow}>
            <View style={styles.grow}>
              <Text style={styles.paymentAmount}>{formatMoney(payment.amount, payment.currency)}</Text>
              <Text style={styles.meta}>{formatLocalDate(payment.paidAt)} · {payment.methodName}{payment.reference ? ` · ${payment.reference}` : ''}</Text>
            </View>
            <StatusBadge status={payment.status} />
          </View>
        ))}
      </Card>
      {hasPermission('subscriptions.write') ? (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Gestion contrôlée</Text>
          <AppInput label="Motif de suspension ou d’annulation" multiline onChangeText={setReason} value={reason} />
          {item.adminStatus === 'suspended' ? (
            <AppButton disabled={saving} label="Réactiver" onPress={() => changeStatus('active', 'Réactiver')} />
          ) : item.adminStatus !== 'cancelled' ? (
            <AppButton disabled={saving} label="Suspendre" onPress={() => changeStatus('suspended', 'Suspendre')} variant="secondary" />
          ) : null}
          {item.adminStatus !== 'cancelled' ? (
            <AppButton disabled={saving} label="Annuler l’abonnement" onPress={() => changeStatus('cancelled', 'Annuler')} variant="danger" />
          ) : null}
          <AppButton
            label="Renouveler sans écraser l’historique"
            onPress={() => router.push({
              pathname: '/subscriptions/new',
              params: {
                customerId: item.customerId,
                renewedFromId: id,
                startDate: calculateRenewalStartDate(item.endDate)
              }
            })}
            variant="secondary"
          />
          <NotesEditor id={id} initialNotes={item.notes ?? ''} onSaved={refresh} />
          <Text style={styles.meta}>Le client, la formule appliquée, le tarif et la période restent immuables pour préserver l’historique.</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

function NotesEditor({ id, initialNotes, onSaved }: { id: string; initialNotes: string; onSaved: () => Promise<void> }) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    try {
      setSaving(true);
      await updateSubscriptionNotes(id, notes);
      await onSaved();
      Alert.alert('Notes enregistrées');
    } catch (error) {
      Alert.alert('Modification impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={styles.notesEditor}>
      <AppInput label="Notes internes" multiline onChangeText={setNotes} value={notes} />
      <AppButton label="Enregistrer les notes" loading={saving} onPress={() => void save()} variant="ghost" />
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.info}><Text style={styles.meta}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  grow: { flex: 1 },
  title: { color: colors.primaryDark, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 15 },
  card: { gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  info: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  infoValue: { flex: 1, color: colors.text, fontWeight: '700', textAlign: 'right' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.sm, paddingTop: spacing.sm },
  paymentAmount: { color: colors.success, fontWeight: '800' },
  notesEditor: { gap: spacing.sm }
});
