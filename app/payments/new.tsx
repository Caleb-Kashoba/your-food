import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { listPaymentMethods, recordPayment } from '@/features/payments/payments.service';
import { listSubscriptions } from '@/features/subscriptions/subscriptions.service';
import { localDateKey } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';

export default function NewPaymentScreen() {
  const params = useLocalSearchParams<{ subscriptionId?: string; customerId?: string }>();
  const { member } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const subscriptions = useQuery({ queryKey: ['subscriptions'], queryFn: () => listSubscriptions() });
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: listPaymentMethods });
  const [subscriptionId, setSubscriptionId] = useState(params.subscriptionId ?? '');
  const [methodId, setMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(localDateKey());
  const [saving, setSaving] = useState(false);
  const selected = subscriptions.data?.find((item) => item.id === subscriptionId);

  const save = async () => {
    const numericAmount = Number(amount.replace(/\s/g, ''));
    if (!member || !selected || !methodId || numericAmount <= 0) {
      Alert.alert('Informations incomplètes', 'Sélectionnez l’abonnement, le moyen et un montant positif.');
      return;
    }
    try {
      setSaving(true);
      await recordPayment({
        organizationId: member.organizationId,
        customerId: selected.customerId,
        subscriptionId: selected.id,
        amount: numericAmount,
        currency: selected.currency,
        paymentMethodId: methodId,
        reference: reference.trim() || null,
        paidAt: date,
        comment: null
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      ]);
      router.back();
    } catch (error) {
      Alert.alert('Paiement impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.label}>Abonnement</Text>
      <View style={styles.stack}>
        {subscriptions.data?.filter((item) => item.amountRemaining > 0).map((item) => (
          <Pressable key={item.id} onPress={() => setSubscriptionId(item.id)} style={[styles.choice, subscriptionId === item.id && styles.active]}>
            <View style={styles.grow}><Text style={styles.name}>{item.customerName}</Text><Text style={styles.meta}>{item.planName}</Text></View>
            <Text style={styles.amount}>{formatMoney(item.amountRemaining, item.currency)}</Text>
          </Pressable>
        ))}
      </View>
      <AppInput keyboardType="numeric" label="Montant versé" onChangeText={setAmount} value={amount} />
      <Text style={styles.label}>Moyen de paiement</Text>
      <View style={styles.methods}>
        {methods.data?.map((method) => (
          <Pressable key={method.id} onPress={() => setMethodId(method.id)} style={[styles.method, methodId === method.id && styles.active]}>
            <Text style={[styles.methodText, methodId === method.id && styles.activeText]}>{method.name}</Text>
          </Pressable>
        ))}
      </View>
      <AppInput label="Date (AAAA-MM-JJ)" onChangeText={setDate} value={date} />
      <AppInput label="Référence" onChangeText={setReference} value={reference} />
      <AppButton label="Confirmer le paiement" loading={saving} onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  stack: { gap: spacing.sm },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  active: { backgroundColor: colors.primary, borderColor: colors.primary },
  grow: { flex: 1 },
  name: { color: colors.text, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 12 },
  amount: { color: colors.danger, fontWeight: '800' },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  method: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  methodText: { color: colors.muted, fontWeight: '700' },
  activeText: { color: colors.surface }
});
