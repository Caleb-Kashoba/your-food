import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Card } from '@/components/ui/Card';
import { Chips } from '@/components/ui/Chips';
import { Screen } from '@/components/ui/Screen';
import { listCustomers } from '@/features/customers/customers.service';
import { listPlans } from '@/features/plans/plans.service';
import { createSubscriptionWeeks, listSubscriptions } from '@/features/subscriptions/subscriptions.service';
import {
  WEEK_CHOICES,
  fridayAfterWeeks,
  isMonday,
  mondayOnOrAfter,
  subscriptionTotal,
  weeklyPrice
} from '@/features/subscriptions/subscription-rules';
import { addLocalDays, formatDayChip, formatLocalDate, localDateKey, mondayOf } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';

const MAX_RESULTS = 8;

/** Sans accents ni majuscules, pour chercher « gaetan » et trouver « Gaëtan » */
function simplify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Nouvel abonnement : toujours du lundi au vendredi, durée en semaines (1 mois = 4 semaines),
 * prix de la formule × semaines, avec un prix total exceptionnel possible pour ce client.
 * Un client n'a jamais deux abonnements en même temps : si un abonnement court encore, le nouveau commence après
 * (au plus un abonnement à venir). Pour simplement ajouter des semaines, on rallonge l'abonnement depuis sa fiche.
 */
export default function NewSubscriptionScreen() {
  const params = useLocalSearchParams<{ customerId?: string; renewedFromId?: string; startDate?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = localDateKey();
  const customers = useQuery({ queryKey: ['customers', 'subscription-picker'], queryFn: () => listCustomers() });
  const plans = useQuery({ queryKey: ['plans', 'active'], queryFn: () => listPlans(true) });
  const [customerId, setCustomerId] = useState(params.customerId ?? '');
  const [search, setSearch] = useState('');
  const [pickedPlan, setPickedPlan] = useState('');
  const [weeks, setWeeks] = useState(1);
  const [pickedStart, setPickedStart] = useState<string | null>(params.startDate ? mondayOnOrAfter(params.startDate) : null);
  const [otherDate, setOtherDate] = useState('');
  const [override, setOverride] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Abonnements du client choisi : formule reprise et date de début proposée après l'abonnement en cours
  const history = useQuery({ queryKey: ['subscriptions', customerId], queryFn: () => listSubscriptions(customerId), enabled: Boolean(customerId) });
  const live = (history.data ?? []).filter((item) => item.adminStatus !== 'cancelled' && item.endDate >= today).sort((a, b) => a.endDate.localeCompare(b.endDate));
  const current = live.find((item) => item.startDate <= today);
  const upcoming = live.find((item) => item.startDate > today);
  const latest = [...(history.data ?? [])].filter((item) => item.adminStatus !== 'cancelled').sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const suggestedStart = current ? mondayOnOrAfter(addLocalDays(current.endDate, 1)) : null;

  // Valeurs proposées tant que l'administratrice n'a rien choisi : formule du dernier abonnement, lundi qui suit l'abonnement en cours
  const previousPlanId = latest ? plans.data?.find((item) => item.name === latest.planName)?.id ?? '' : '';
  const planId = pickedPlan || previousPlanId;
  const startDate = pickedStart ?? suggestedStart ?? mondayOnOrAfter(today);
  const setPlanId = setPickedPlan;
  const setStartDate = setPickedStart;

  const customer = customers.data?.find((item) => item.id === customerId);
  const matches = (customers.data ?? [])
    .filter((item) => !search.trim() || simplify(`${item.firstName} ${item.lastName} ${item.phone ?? ''}`).includes(simplify(search)))
    .slice(0, MAX_RESULTS);

  const plan = plans.data?.find((item) => item.id === planId);
  const weekly = plan ? weeklyPrice(plan) : null;
  const overrideValue = Number.parseFloat(override.replace(/\s/g, '').replace(',', '.'));
  const total = weekly !== null ? subscriptionTotal(weekly, weeks, Number.isFinite(overrideValue) ? overrideValue : null) : null;
  const chosenStart = otherDate.trim() ? otherDate.trim() : startDate;
  const validStart = isMonday(chosenStart);
  const endDate = validStart ? fridayAfterWeeks(chosenStart, weeks) : null;

  // Lundis proposés : celui de cette semaine (début rétroactif), les trois suivants, et le lundi qui suit l'abonnement en cours
  const thisMonday = mondayOf(today);
  const mondays = [...new Set([thisMonday, addLocalDays(thisMonday, 7), addLocalDays(thisMonday, 14), addLocalDays(thisMonday, 21), ...(suggestedStart ? [suggestedStart] : [])])].sort();

  const save = async () => {
    if (!customerId || !planId) {
      setError('Sélectionne un client et une formule.');
      return;
    }
    if (!validStart) {
      setError('Un abonnement commence un lundi : choisis un lundi dans la liste, ou saisis-en un (AAAA-MM-JJ).');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const id = await createSubscriptionWeeks({
        customerId,
        planId,
        startDate: chosenStart,
        weeks,
        totalPrice: Number.isFinite(overrideValue) && overrideValue > 0 ? overrideValue : null,
        notes: notes.trim() || null,
        renewedFromId: params.renewedFromId ?? current?.id ?? null
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      ]);
      router.replace({ pathname: '/subscriptions/[id]', params: { id } });
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.sectionTitle}>Client</Text>
      {customer ? (
        <Card style={styles.selected}>
          <View style={styles.grow}>
            <Text style={styles.planTitle}>{customer.firstName} {customer.lastName}</Text>
            <Text style={styles.choiceMeta}>{customer.phone ?? 'Pas de numéro'}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => { setCustomerId(''); setPickedPlan(''); setPickedStart(null); setError(null); }}>
            <Text style={styles.link}>Changer</Text>
          </Pressable>
        </Card>
      ) : (
        <>
          <AppInput label="Rechercher un client (nom ou téléphone)" onChangeText={setSearch} placeholder="Ex. : Gaëtan" value={search} />
          <View style={styles.stack}>
            {matches.map((item) => (
              <Pressable accessibilityRole="button" key={item.id} onPress={() => { setCustomerId(item.id); setSearch(''); setError(null); }} style={styles.plan}>
                <View style={styles.grow}>
                  <Text style={styles.planTitle}>{item.firstName} {item.lastName}</Text>
                  <Text style={styles.choiceMeta}>{item.phone ?? 'Pas de numéro'}</Text>
                </View>
              </Pressable>
            ))}
            {matches.length === 0 ? <Text style={styles.choiceMeta}>Aucun client ne correspond.</Text> : null}
          </View>
        </>
      )}

      {customer && current ? (
        <Card style={styles.info}>
          <Text style={styles.infoText}>
            Abonnement en cours : {current.planName}, du {formatLocalDate(current.startDate)} au {formatLocalDate(current.endDate)}.
            {upcoming ? '' : ` Le nouvel abonnement commencera après, le ${formatLocalDate(suggestedStart ?? current.endDate)}.`}
          </Text>
          <Text style={styles.infoText}>Pour garder la même formule, il est plus simple de le rallonger.</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/subscriptions/[id]', params: { id: current.id } })}>
            <Text style={styles.link}>Ouvrir l’abonnement en cours</Text>
          </Pressable>
        </Card>
      ) : null}
      {customer && upcoming ? (
        <Card style={styles.warning}>
          <Text style={styles.infoText}>
            Ce client a déjà un abonnement à venir ({upcoming.planName}, du {formatLocalDate(upcoming.startDate)} au {formatLocalDate(upcoming.endDate)}) : rallonge-le ou change sa formule plutôt que d’en créer un autre.
          </Text>
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/subscriptions/[id]', params: { id: upcoming.id } })}>
            <Text style={styles.link}>Ouvrir l’abonnement à venir</Text>
          </Pressable>
        </Card>
      ) : null}

      <Text style={styles.sectionTitle}>Formule</Text>
      <View style={styles.stack}>
        {plans.data?.map((item) => (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: planId === item.id }} key={item.id} onPress={() => setPlanId(item.id)} style={[styles.plan, planId === item.id && styles.planActive]}>
            <View style={styles.grow}>
              <Text style={styles.planTitle}>{item.name}</Text>
              {item.description ? <Text style={styles.choiceMeta}>{item.description}</Text> : null}
            </View>
            <Text style={styles.planPrice}>{formatMoney(weeklyPrice(item), item.currency)} / sem.</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Durée</Text>
      <Chips
        onChange={(value) => setWeeks(Number(value))}
        options={WEEK_CHOICES.map((choice) => ({ value: String(choice.weeks), label: choice.label }))}
        value={String(weeks)}
      />

      <Text style={styles.sectionTitle}>Début (un lundi)</Text>
      <Chips
        onChange={(value) => { setStartDate(value); setOtherDate(''); }}
        options={mondays.map((value) => ({
          value,
          label: `${formatDayChip(value)}${value === thisMonday ? ' (cette semaine)' : ''}${value === suggestedStart ? ' (après l’actuel)' : ''}`
        }))}
        value={otherDate.trim() ? null : startDate}
      />
      <AppInput label="Ou un autre lundi (AAAA-MM-JJ)" onChangeText={setOtherDate} placeholder="Facultatif" value={otherDate} />
      {endDate ? <Text style={styles.endDate}>Du {formatLocalDate(chosenStart)} au {formatLocalDate(endDate)} (lundi → vendredi)</Text> : null}
      {total !== null ? (
        <Text style={styles.total}>
          Total : {formatMoney(total, plan?.currency)}{override.trim() ? ' (prix exceptionnel)' : ` · ${weeks} × ${formatMoney(weekly ?? 0, plan?.currency)}`}
        </Text>
      ) : null}

      <AppInput keyboardType="decimal-pad" label="Prix total exceptionnel pour ce client (facultatif)" onChangeText={setOverride} placeholder="Laisser vide pour le prix de la formule" value={override} />
      <AppInput label="Notes" multiline onChangeText={setNotes} textAlignVertical="top" value={notes} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <AppButton disabled={!customerId || !planId} label={current ? 'Créer l’abonnement suivant' : 'Créer l’abonnement'} loading={saving} onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: colors.primaryDark, fontSize: 17, fontWeight: '800' },
  choiceMeta: { color: colors.muted, fontSize: 12, marginTop: spacing.xs },
  stack: { gap: spacing.sm },
  selected: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { gap: spacing.sm, backgroundColor: colors.infoSoft },
  warning: { gap: spacing.sm, backgroundColor: colors.warningSoft },
  infoText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '800' },
  plan: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  planActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  grow: { flex: 1 },
  planTitle: { color: colors.text, fontWeight: '800' },
  planPrice: { color: colors.primaryDark, fontWeight: '800' },
  endDate: { color: colors.primary, fontWeight: '700' },
  total: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' }
});
