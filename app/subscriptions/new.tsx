import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Chips } from '@/components/ui/Chips';
import { Screen } from '@/components/ui/Screen';
import { listCustomers } from '@/features/customers/customers.service';
import { listPlans } from '@/features/plans/plans.service';
import { createSubscriptionWeeks } from '@/features/subscriptions/subscriptions.service';
import {
  WEEK_CHOICES,
  fridayAfterWeeks,
  isMonday,
  mondayOnOrAfter,
  subscriptionTotal,
  weeklyPrice
} from '@/features/subscriptions/subscription-rules';
import { formatLocalDate, localDateKey } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';

/**
 * Nouvel abonnement ou renouvellement : toujours du lundi au vendredi, durée en semaines (1 mois = 4 semaines),
 * prix de la formule × semaines, avec un prix total exceptionnel possible pour ce client.
 */
export default function NewSubscriptionScreen() {
  const params = useLocalSearchParams<{ customerId?: string; renewedFromId?: string; startDate?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const customers = useQuery({ queryKey: ['customers', 'subscription-picker'], queryFn: () => listCustomers() });
  const plans = useQuery({ queryKey: ['plans', 'active'], queryFn: () => listPlans(true) });
  const [customerId, setCustomerId] = useState(params.customerId ?? '');
  const [planId, setPlanId] = useState('');
  const [weeks, setWeeks] = useState(4);
  const [startDate, setStartDate] = useState(mondayOnOrAfter(params.startDate ?? localDateKey()));
  const [override, setOverride] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = plans.data?.find((item) => item.id === planId);
  const weekly = plan ? weeklyPrice(plan) : null;
  const overrideValue = Number.parseFloat(override.replace(/\s/g, '').replace(',', '.'));
  const total = weekly !== null ? subscriptionTotal(weekly, weeks, Number.isFinite(overrideValue) ? overrideValue : null) : null;
  const validStart = isMonday(startDate);
  const endDate = validStart ? fridayAfterWeeks(startDate, weeks) : null;

  const save = async () => {
    if (!customerId || !planId) {
      setError('Sélectionne un client et une formule.');
      return;
    }
    if (!validStart) {
      setError('Un abonnement commence toujours un lundi (format AAAA-MM-JJ).');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await createSubscriptionWeeks({
        customerId,
        planId,
        startDate,
        weeks,
        totalPrice: Number.isFinite(overrideValue) && overrideValue > 0 ? overrideValue : null,
        notes: notes.trim() || null,
        renewedFromId: params.renewedFromId ?? null
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      ]);
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.sectionTitle}>Client</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chips}>
          {customers.data?.map((customer) => (
            <Pressable accessibilityRole="button" key={customer.id} onPress={() => setCustomerId(customer.id)} style={[styles.choice, customerId === customer.id && styles.choiceActive]}>
              <Text style={[styles.choiceTitle, customerId === customer.id && styles.choiceTitleActive]}>{customer.firstName} {customer.lastName}</Text>
              <Text style={[styles.choiceMeta, customerId === customer.id && styles.choiceMetaActive]}>{customer.phone ?? 'Pas de numéro'}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Text style={styles.sectionTitle}>Formule</Text>
      <View style={styles.stack}>
        {plans.data?.map((item) => (
          <Pressable accessibilityRole="button" key={item.id} onPress={() => setPlanId(item.id)} style={[styles.plan, planId === item.id && styles.planActive]}>
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

      <AppInput label="Début : un lundi (AAAA-MM-JJ)" onChangeText={setStartDate} value={startDate} />
      {endDate ? <Text style={styles.endDate}>Du {formatLocalDate(startDate)} au {formatLocalDate(endDate)} (lundi → vendredi)</Text> : null}
      {total !== null ? (
        <Text style={styles.total}>
          Total : {formatMoney(total, plan?.currency)}{override.trim() ? ' (prix exceptionnel)' : ` · ${weeks} × ${formatMoney(weekly ?? 0, plan?.currency)}`}
        </Text>
      ) : null}

      <AppInput keyboardType="decimal-pad" label="Prix total exceptionnel pour ce client (facultatif)" onChangeText={setOverride} placeholder="Laisser vide pour le prix de la formule" value={override} />
      <AppInput label="Notes" multiline onChangeText={setNotes} textAlignVertical="top" value={notes} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <AppButton label={params.renewedFromId ? 'Créer le renouvellement' : 'Créer l’abonnement'} loading={saving} onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: colors.primaryDark, fontSize: 17, fontWeight: '800' },
  chips: { flexDirection: 'row', gap: spacing.sm },
  choice: { minWidth: 160, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceTitle: { color: colors.text, fontWeight: '700' },
  choiceTitleActive: { color: colors.surface },
  choiceMeta: { color: colors.muted, fontSize: 12, marginTop: spacing.xs },
  choiceMetaActive: { color: colors.primarySoft },
  stack: { gap: spacing.sm },
  plan: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  planActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  grow: { flex: 1 },
  planTitle: { color: colors.text, fontWeight: '800' },
  planPrice: { color: colors.primaryDark, fontWeight: '800' },
  endDate: { color: colors.primary, fontWeight: '700' },
  total: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' }
});
