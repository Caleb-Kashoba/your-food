import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { listCustomers } from '@/features/customers/customers.service';
import { listPlans } from '@/features/plans/plans.service';
import { createSubscription } from '@/features/subscriptions/subscriptions.service';
import { calculateInclusiveEndDate, localDateKey } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';

export default function NewSubscriptionScreen() {
  const params = useLocalSearchParams<{ customerId?: string; renewedFromId?: string; startDate?: string }>();
  const { member } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const customers = useQuery({ queryKey: ['customers', 'subscription-picker'], queryFn: () => listCustomers() });
  const plans = useQuery({ queryKey: ['plans', 'active'], queryFn: () => listPlans(true) });
  const [customerId, setCustomerId] = useState(params.customerId ?? '');
  const [planId, setPlanId] = useState('');
  const [startDate, setStartDate] = useState(params.startDate ?? localDateKey());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedPlan = plans.data?.find((plan) => plan.id === planId);
  const endDate = useMemo(
    () => selectedPlan ? calculateInclusiveEndDate(startDate, selectedPlan.durationValue, selectedPlan.durationUnit) : null,
    [selectedPlan, startDate]
  );

  const save = async () => {
    if (!member || !customerId || !planId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      Alert.alert('Informations incomplètes', 'Sélectionnez un client, une formule et une date valide au format AAAA-MM-JJ.');
      return;
    }
    try {
      setSaving(true);
      await createSubscription({
        organizationId: member.organizationId,
        customerId,
        planId,
        startDate,
        notes: notes.trim() || null,
        renewedFromId: params.renewedFromId ?? null
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      ]);
      router.back();
    } catch (error) {
      Alert.alert('Création impossible', getErrorMessage(error));
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
            <Pressable key={customer.id} onPress={() => setCustomerId(customer.id)} style={[styles.choice, customerId === customer.id && styles.choiceActive]}>
              <Text style={[styles.choiceTitle, customerId === customer.id && styles.choiceTitleActive]}>{customer.firstName} {customer.lastName}</Text>
              <Text style={[styles.choiceMeta, customerId === customer.id && styles.choiceMetaActive]}>{customer.phone}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <Text style={styles.sectionTitle}>Formule</Text>
      <View style={styles.stack}>
        {plans.data?.map((plan) => (
          <Pressable key={plan.id} onPress={() => setPlanId(plan.id)} style={[styles.plan, planId === plan.id && styles.planActive]}>
            <View style={styles.grow}>
              <Text style={styles.planTitle}>{plan.name}</Text>
              <Text style={styles.choiceMeta}>{plan.durationValue} {plan.durationUnit} · {plan.serviceDaysCount} jours de service</Text>
            </View>
            <Text style={styles.planPrice}>{formatMoney(plan.price, plan.currency)}</Text>
          </Pressable>
        ))}
      </View>
      <AppInput label="Date de début (AAAA-MM-JJ)" onChangeText={setStartDate} value={startDate} />
      {endDate ? <Text style={styles.endDate}>Date de fin calculée : {endDate}</Text> : null}
      <AppInput label="Notes" multiline onChangeText={setNotes} textAlignVertical="top" value={notes} />
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
  endDate: { color: colors.primary, fontWeight: '700' }
});
