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
import {
  deleteSubscription,
  extendSubscriptionWeeks,
  getSubscriptionDetail,
  listSubscriptionChanges,
  modifySubscription,
  setSubscriptionPrice,
  setSubscriptionStatus,
  updateSubscriptionNotes,
  type SubscriptionChange
} from '@/features/subscriptions/subscriptions.service';
import { addLocalDays, formatLocalDate } from '@/lib/dates';
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
  const changes = useQuery({ queryKey: ['subscription', id, 'changes'], queryFn: () => listSubscriptionChanges(id), enabled: Boolean(id) });
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
          {item.adminStatus === 'cancelled' || item.effectiveStatus === 'expired' ? (
            <>
              <Text style={styles.meta}>Cet abonnement est terminé. Pour continuer, crée un nouvel abonnement : celui-ci reste dans l’historique.</Text>
              <AppButton label="Créer un nouvel abonnement" onPress={() => router.push({ pathname: '/subscriptions/new', params: { customerId: item.customerId } })} variant="secondary" />
            </>
          ) : (
            <ExtendEditor endDate={item.endDate} id={id} onSaved={refresh} />
          )}
          {item.adminStatus !== 'cancelled' ? <DatesEditor endDate={item.endDate} id={id} onSaved={refresh} startDate={item.startDate} /> : null}
          <PriceEditor currency={item.currency} currentPrice={item.price} id={id} onSaved={refresh} />
          <NotesEditor id={id} initialNotes={item.notes ?? ''} onSaved={refresh} />
          <DeleteEditor id={id} onDeleted={async () => { await refresh(); if (router.canGoBack()) router.back(); else router.replace('/subscriptions'); }} />
          <Text style={styles.meta}>Un client n’a qu’un abonnement en cours : on le rallonge. La formule ne change pas en cours de route (pour en changer : annule celui-ci puis crée-en un nouveau). Les dates et le prix ne changent que par une décision motivée, conservée dans l’historique.</Text>
        </Card>
      ) : null}
      {changes.data && changes.data.length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Historique des changements</Text>
          {changes.data.map((change) => <ChangeRow change={change} key={change.id} />)}
        </Card>
      ) : null}
    </Screen>
  );
}

/** Rallonge l'abonnement en cours : fin + N semaines, prix + N × prix hebdomadaire */
function ExtendEditor({ id, endDate, onSaved }: { id: string; endDate: string; onSaved: () => Promise<void> }) {
  const [weeks, setWeeks] = useState('1');
  const [saving, setSaving] = useState(false);
  const count = Number.parseInt(weeks, 10);
  const valid = Number.isInteger(count) && count >= 1 && count <= 52;
  const save = () => {
    Alert.alert('Rallonger cet abonnement ?', `La fin passe au ${formatLocalDate(addLocalDays(endDate, count * 7))} et le prix augmente d’autant de semaines.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Rallonger',
        onPress: () => {
          setSaving(true);
          void extendSubscriptionWeeks(id, count)
            .then(onSaved)
            .then(() => setWeeks('1'))
            .catch((error: unknown) => Alert.alert('Rallongement impossible', getErrorMessage(error)))
            .finally(() => setSaving(false));
        }
      }
    ]);
  };
  return (
    <View style={styles.notesEditor}>
      <Text style={styles.sectionTitle}>Rallonger</Text>
      <Text style={styles.meta}>Fin actuelle : {formatLocalDate(endDate)}.{valid ? ` Après : ${formatLocalDate(addLocalDays(endDate, count * 7))}.` : ''}</Text>
      <AppInput keyboardType="number-pad" label="Nombre de semaines à ajouter" onChangeText={setWeeks} value={weeks} />
      <AppButton disabled={!valid} label={valid ? `Rallonger de ${count} semaine${count > 1 ? 's' : ''}` : 'Rallonger'} loading={saving} onPress={save} variant="secondary" />
    </View>
  );
}

/** Modifier le début ou la fin : motif obligatoire, conservé dans l'historique */
function DatesEditor({ id, startDate, endDate, onSaved }: { id: string; startDate: string; endDate: string; onSaved: () => Promise<void> }) {
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const dateOk = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  const changed = start !== startDate || end !== endDate;
  const save = async () => {
    try {
      setSaving(true);
      await modifySubscription({ id, startDate: start !== startDate ? start : null, endDate: end !== endDate ? end : null, reason });
      setReason('');
      await onSaved();
      Alert.alert('Dates modifiées');
    } catch (error) {
      Alert.alert('Modification impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={styles.notesEditor}>
      <Text style={styles.sectionTitle}>Modifier les dates</Text>
      <Text style={styles.meta}>Les livraisons hors de la nouvelle période sont supprimées, celles de la nouvelle période sont créées. Le prix ne change pas (utilise « Prix exceptionnel » si besoin).</Text>
      <AppInput label="Début (AAAA-MM-JJ)" onChangeText={setStart} value={start} />
      <AppInput label="Fin (AAAA-MM-JJ)" onChangeText={setEnd} value={end} />
      <AppInput label="Raison du changement" onChangeText={setReason} value={reason} />
      <AppButton disabled={!changed || !dateOk(start) || !dateOk(end) || !reason.trim()} label="Modifier les dates" loading={saving} onPress={() => void save()} variant="secondary" />
    </View>
  );
}

/** Supprimer : seulement sans paiement ni repas déjà préparé ou livré ; sinon on annule */
function DeleteEditor({ id, onDeleted }: { id: string; onDeleted: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const remove = () => {
    Alert.alert('Supprimer cet abonnement ?', 'Il disparaît avec ses livraisons et ses repas. Impossible s’il a des paiements ou des repas déjà livrés : annule-le alors.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          void deleteSubscription(id, reason)
            .then(onDeleted)
            .catch((error: unknown) => Alert.alert('Suppression impossible', getErrorMessage(error)))
            .finally(() => setSaving(false));
        }
      }
    ]);
  };
  return (
    <View style={styles.notesEditor}>
      <Text style={styles.sectionTitle}>Supprimer</Text>
      <AppInput label="Raison de la suppression" onChangeText={setReason} value={reason} />
      <AppButton disabled={!reason.trim()} label="Supprimer l’abonnement" loading={saving} onPress={remove} variant="danger" />
    </View>
  );
}

function ChangeRow({ change }: { change: SubscriptionChange }) {
  const d = change.details;
  const day = (value: string | number | null | undefined) => (typeof value === 'string' ? formatLocalDate(value) : '—');
  const title = change.action === 'extended'
    ? `Rallongé de ${d.weeks} semaine${Number(d.weeks) > 1 ? 's' : ''} : fin ${day(d.end_before)} → ${day(d.end_after)}`
    : change.action === 'modified'
      ? `Dates modifiées : début ${day(d.start_before)} → ${day(d.start_after)}, fin ${day(d.end_before)} → ${day(d.end_after)}`
      : 'Abonnement supprimé';
  return (
    <View style={styles.paymentRow}>
      <View style={styles.grow}>
        <Text style={styles.paymentAmount}>{title}</Text>
        <Text style={styles.meta}>{formatLocalDate(change.createdAt.slice(0, 10))}{change.reason ? ` · ${change.reason}` : ''}</Text>
      </View>
    </View>
  );
}

/** Prix exceptionnel pour ce client uniquement (le prix de la formule, lui, ne bouge pas) ; la raison est conservée */
function PriceEditor({ id, currentPrice, currency, onSaved }: { id: string; currentPrice: number; currency: string; onSaved: () => Promise<void> }) {
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const value = Number.parseFloat(price.replace(/\s/g, '').replace(',', '.'));
  const save = async () => {
    try {
      setSaving(true);
      await setSubscriptionPrice(id, value, reason);
      setPrice('');
      setReason('');
      await onSaved();
      Alert.alert('Prix modifié');
    } catch (error) {
      Alert.alert('Modification impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={styles.notesEditor}>
      <Text style={styles.sectionTitle}>Prix exceptionnel</Text>
      <Text style={styles.meta}>Prix actuel : {formatMoney(currentPrice, currency)}. Ce changement ne concerne que cet abonnement.</Text>
      <AppInput keyboardType="decimal-pad" label="Nouveau prix total" onChangeText={setPrice} value={price} />
      <AppInput label="Raison du changement" onChangeText={setReason} value={reason} />
      <AppButton disabled={!Number.isFinite(value) || value <= 0 || !reason.trim()} label="Modifier le prix" loading={saving} onPress={() => void save()} variant="secondary" />
    </View>
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
