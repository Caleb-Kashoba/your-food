import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { DateField } from '@/components/ui/DateField';
import { Card } from '@/components/ui/Card';
import { Chips } from '@/components/ui/Chips';
import { Section } from '@/components/ui/Section';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/features/auth/AuthProvider';
import { listPayments } from '@/features/payments/payments.service';
import { listPlans } from '@/features/plans/plans.service';
import { WEEK_CHOICES, fridayAfterWeeks, mondayOnOrAfter, weeklyPrice } from '@/features/subscriptions/subscription-rules';
import {
  deleteSubscription,
  changeSubscriptionPlan,
  extendSubscriptionWeeks,
  getSubscriptionDetail,
  listSubscriptionChanges,
  modifySubscription,
  renewSubscriptionWeeks,
  setSubscriptionPrice,
  setSubscriptionStatus,
  updateSubscriptionNotes,
  type SubscriptionChange
} from '@/features/subscriptions/subscriptions.service';
import { addLocalDays, formatDayChip, formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';
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
      {/* Synthèse : ce qu'il faut savoir d'un coup d'œil */}
      <View style={styles.facts}>
        <Fact label="Période" value={`${formatDayChip(item.startDate)} → ${formatDayChip(item.endDate)}`} />
        <Fact label={item.daysUntilExpiration >= 0 ? 'Fin dans' : 'Terminé depuis'} value={`${Math.abs(item.daysUntilExpiration)} j`} />
        <Fact label="Reste à payer" tone={item.amountRemaining > 0 ? 'danger' : 'ok'} value={formatMoney(item.amountRemaining, item.currency)} />
      </View>
      <Text style={styles.meta}>Livré : {item.serviceWeekdays.map((day) => dayLabels[day - 1]).join(' · ')}</Text>

      {/* Action principale : prolonger (ou créer un nouvel abonnement s'il est terminé) */}
      {hasPermission('subscriptions.write') ? (
        item.adminStatus === 'cancelled' || item.effectiveStatus === 'expired' ? (
          <Card style={styles.card}>
            <Text style={styles.meta}>Cet abonnement est terminé. Pour continuer, créez un nouvel abonnement : celui-ci reste dans l’historique.</Text>
            <AppButton label="Nouvel abonnement" onPress={() => router.push({ pathname: '/subscriptions/new', params: { customerId: item.customerId } })} />
          </Card>
        ) : (
          <Card style={styles.card}>
            <ContinueEditor customerId={item.customerId} endDate={item.endDate} id={id} onSaved={refresh} planId={item.planId} />
          </Card>
        )
      ) : null}

      {hasPermission('payments.write') && item.amountRemaining > 0 ? (
        <AppButton
          label={`Enregistrer un paiement (${formatMoney(item.amountRemaining, item.currency)} dus)`}
          onPress={() => router.push({ pathname: '/payments/new', params: { subscriptionId: id, customerId: item.customerId } })}
          variant="secondary"
        />
      ) : null}

      <Section
        badge={payments.data && payments.data.length > 0 ? String(payments.data.length) : null}
        summary={`Versé ${formatMoney(item.amountPaid, item.currency)} sur ${formatMoney(item.price, item.currency)}`}
        title="Paiements"
      >
        <StatusBadge status={item.paymentState} />
        {payments.data?.length === 0 ? <Text style={styles.meta}>Aucun paiement enregistré.</Text> : null}
        {payments.data?.map((payment) => (
          <View key={payment.id} style={styles.paymentRow}>
            <View style={styles.grow}>
              <Text style={styles.paymentAmount}>{formatMoney(payment.amount, payment.currency)}</Text>
              <Text style={styles.meta}>{formatLocalDate(payment.paidAt)} · {payment.methodName}{payment.reference ? ` · ${payment.reference}` : ''}</Text>
            </View>
            <StatusBadge status={payment.status} />
          </View>
        ))}
      </Section>

      {/* Réglages occasionnels : repliés */}
      {hasPermission('subscriptions.write') ? (
        <>
          {item.adminStatus !== 'cancelled' && item.effectiveStatus !== 'expired' ? (
            <Section summary={`Formule actuelle : ${item.planName}`} title="Changer la formule de cette période">
              <PlanEditor endDate={item.endDate} id={id} onSaved={refresh} planId={item.planId} startDate={item.startDate} />
            </Section>
          ) : null}
          {item.adminStatus !== 'cancelled' ? (
            <Section summary={`Du ${formatLocalDate(item.startDate)} au ${formatLocalDate(item.endDate)}`} title="Modifier les dates">
              <DatesEditor endDate={item.endDate} id={id} onSaved={refresh} startDate={item.startDate} />
            </Section>
          ) : null}
          <Section summary={`Prix actuel : ${formatMoney(item.price, item.currency)}`} title="Prix exceptionnel">
            <PriceEditor currency={item.currency} currentPrice={item.price} id={id} onSaved={refresh} />
          </Section>
          <Section summary={item.notes ? item.notes : 'Aucune note'} title="Notes internes">
            <NotesEditor id={id} initialNotes={item.notes ?? ''} onSaved={refresh} />
          </Section>

          {/* Zone sensible : suspendre, annuler, supprimer */}
          <Section title="Zone sensible : suspendre, annuler, supprimer" tone="danger">
            <AppInput label="Motif (obligatoire pour suspendre ou annuler)" multiline onChangeText={setReason} value={reason} />
            {item.adminStatus === 'suspended' ? (
              <AppButton disabled={saving} label="Réactiver" onPress={() => changeStatus('active', 'Réactiver')} />
            ) : item.adminStatus !== 'cancelled' ? (
              <AppButton disabled={saving} label="Suspendre" onPress={() => changeStatus('suspended', 'Suspendre')} variant="secondary" />
            ) : null}
            {item.adminStatus !== 'cancelled' ? (
              <AppButton disabled={saving} label="Annuler l’abonnement" onPress={() => changeStatus('cancelled', 'Annuler')} variant="danger" />
            ) : null}
            <DeleteEditor id={id} onDeleted={async () => { await refresh(); if (router.canGoBack()) router.back(); else router.replace('/subscriptions'); }} />
          </Section>
          <Text style={styles.meta}>Un client n’a jamais deux abonnements en même temps : on prolonge celui-ci, on change sa formule, ou on prépare l’abonnement suivant. Chaque changement est gardé dans l’historique.</Text>
        </>
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

/**
 * Continuer l'abonnement : même formule → on le rallonge (fin + N semaines) ;
 * autre formule → un nouvel abonnement commence le lundi qui suit la fin de celui-ci.
 */
function ContinueEditor({ id, customerId, planId, endDate, onSaved }: { id: string; customerId: string; planId: string; endDate: string; onSaved: () => Promise<void> }) {
  const plans = useQuery({ queryKey: ['plans', 'active'], queryFn: () => listPlans(true) });
  const [weeks, setWeeks] = useState(1);
  const [choice, setChoice] = useState(planId);
  const [saving, setSaving] = useState(false);
  const plan = plans.data?.find((item) => item.id === choice);
  const same = choice === planId;
  const nextStart = mondayOnOrAfter(addLocalDays(endDate, 1));
  const newEnd = same ? addLocalDays(endDate, weeks * 7) : fridayAfterWeeks(nextStart, weeks);
  const amount = plan ? weeklyPrice(plan) * weeks : null;
  const summary = same
    ? `La fin passe du ${formatLocalDate(endDate)} au ${formatLocalDate(newEnd)}${amount !== null ? ` (+ ${formatMoney(amount, plan?.currency)})` : ''}.`
    : `Un nouvel abonnement ${plan?.name ?? ''} du ${formatLocalDate(nextStart)} au ${formatLocalDate(newEnd)}${amount !== null ? ` (${formatMoney(amount, plan?.currency)})` : ''}, à la suite de celui-ci.`;

  const save = () => {
    Alert.alert(same ? 'Rallonger cet abonnement ?' : 'Créer l’abonnement suivant ?', summary, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: same ? 'Rallonger' : 'Créer',
        onPress: () => {
          setSaving(true);
          void (same ? extendSubscriptionWeeks(id, weeks) : renewSubscriptionWeeks(customerId, weeks, choice))
            .then(onSaved)
            .then(() => Alert.alert(same ? 'Abonnement rallongé' : 'Abonnement suivant créé', summary))
            .catch((error: unknown) => Alert.alert('Action impossible', getErrorMessage(error)))
            .finally(() => setSaving(false));
        }
      }
    ]);
  };
  return (
    <View style={styles.notesEditor}>
      <Text style={styles.sectionTitle}>Prolonger</Text>
      <Text style={styles.meta}>Même formule : l’abonnement est rallongé. Autre formule : un nouvel abonnement commence le lundi qui suit la fin de celui-ci.</Text>
      <Chips onChange={(value) => setWeeks(Number(value))} options={WEEK_CHOICES.map((item) => ({ value: String(item.weeks), label: item.label }))} value={String(weeks)} />
      {plans.data ? (
        <Chips onChange={setChoice} options={plans.data.map((item) => ({ value: item.id, label: `${item.name}${item.id === planId ? ' (actuelle)' : ''}` }))} value={choice} />
      ) : null}
      <Text style={styles.meta}>{summary}</Text>
      <AppButton disabled={!plan} label={same ? `Rallonger de ${weeks} semaine${weeks > 1 ? 's' : ''}` : 'Créer l’abonnement suivant'} loading={saving} onPress={save} variant="secondary" />
    </View>
  );
}

/** Changer la formule de cet abonnement (motif obligatoire) : prix recalculé, viande des repas à venir ajustée */
function PlanEditor({ id, planId, startDate, endDate, onSaved }: { id: string; planId: string; startDate: string; endDate: string; onSaved: () => Promise<void> }) {
  const plans = useQuery({ queryKey: ['plans', 'active'], queryFn: () => listPlans(true) });
  const [choice, setChoice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const others = (plans.data ?? []).filter((item) => item.id !== planId);
  const plan = others.find((item) => item.id === choice);
  const weeks = Math.max(1, Math.ceil((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`) + 86_400_000) / (7 * 86_400_000)));
  const save = async () => {
    if (!plan) return;
    try {
      setSaving(true);
      await changeSubscriptionPlan(id, plan.id, reason);
      setChoice(null);
      setReason('');
      await onSaved();
      Alert.alert('Formule changée', `L’abonnement passe en ${plan.name}. Les repas à venir ont été ajustés.`);
    } catch (error) {
      Alert.alert('Changement impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  if (others.length === 0) return null;
  return (
    <View style={styles.notesEditor}>
      <Text style={styles.meta}>Pour toute la période de cet abonnement. Le prix est recalculé ; les repas à venir suivent la nouvelle formule (viande comprise).</Text>
      <Chips onChange={setChoice} options={others.map((item) => ({ value: item.id, label: item.name }))} value={choice} />
      {plan ? <Text style={styles.meta}>Nouveau prix : {formatMoney(weeklyPrice(plan) * weeks, plan.currency)} ({weeks} semaine{weeks > 1 ? 's' : ''} × {formatMoney(weeklyPrice(plan), plan.currency)}).</Text> : null}
      <AppInput label="Raison du changement" onChangeText={setReason} value={reason} />
      <AppButton disabled={!plan || !reason.trim()} label="Changer la formule" loading={saving} onPress={() => void save()} variant="secondary" />
    </View>
  );
}

/** Modifier le début ou la fin : motif obligatoire, conservé dans l'historique */
function DatesEditor({ id, startDate, endDate, onSaved }: { id: string; startDate: string; endDate: string; onSaved: () => Promise<void> }) {
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
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
      <Text style={styles.meta}>Les livraisons hors de la nouvelle période sont supprimées, celles de la nouvelle période sont créées. Le prix ne change pas (utilise « Prix exceptionnel » si besoin).</Text>
      <DateField label="Début" onChange={(value) => { setStart(value); if (end < value) setEnd(value); }} value={start} />
      <DateField label="Fin" min={start} onChange={setEnd} value={end} />
      <AppInput label="Raison du changement" onChangeText={setReason} value={reason} />
      <AppButton disabled={!changed || end < start || !reason.trim()} label="Modifier les dates" loading={saving} onPress={() => void save()} variant="secondary" />
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

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'ok' }) {
  return (
    <View style={[styles.fact, tone === 'danger' && styles.factDanger]}>
      <Text style={[styles.factLabel, tone === 'danger' && styles.factDangerText]}>{label}</Text>
      <Text style={[styles.factValue, tone === 'danger' && styles.factDangerText]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  grow: { flex: 1 },
  title: { color: colors.primaryDark, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 15 },
  card: { gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.sm, paddingTop: spacing.sm },
  paymentAmount: { color: colors.success, fontWeight: '800' },
  notesEditor: { gap: spacing.sm },
  facts: { flexDirection: 'row', gap: spacing.sm },
  fact: { flex: 1, gap: 2, backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm },
  factDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft },
  factLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  factValue: { color: colors.text, fontSize: 15, fontWeight: '900' },
  factDangerText: { color: colors.danger }
});
