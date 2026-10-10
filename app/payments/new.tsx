import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Card } from '@/components/ui/Card';
import { Chips } from '@/components/ui/Chips';
import { DateField } from '@/components/ui/DateField';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { listPaymentMethods, recordPayment } from '@/features/payments/payments.service';
import { listSubscriptions } from '@/features/subscriptions/subscriptions.service';
import { localDateKey } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';

/** Sans accents ni majuscules, pour chercher « gaetan » et trouver « Gaëtan » */
function simplify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Montant saisi : espaces ignorés, virgule acceptée comme séparateur décimal (« 12,5 ») */
function parseAmount(text: string): number {
  return Number(text.replace(/\s/g, '').replace(',', '.'));
}

export default function NewPaymentScreen() {
  const params = useLocalSearchParams<{ subscriptionId?: string; customerId?: string }>();
  const { member } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const subscriptions = useQuery({ queryKey: ['subscriptions'], queryFn: () => listSubscriptions() });
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: listPaymentMethods });
  const [subscriptionId, setSubscriptionId] = useState(params.subscriptionId ?? '');
  const [search, setSearch] = useState('');
  // null = montant pas encore saisi : il reprend le reste dû de l'abonnement choisi
  const [amountInput, setAmountInput] = useState<string | null>(null);
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(localDateKey());
  const [saving, setSaving] = useState(false);

  const selected = subscriptions.data?.find((item) => item.id === subscriptionId);
  const amount = amountInput ?? (selected ? String(selected.amountRemaining) : '');
  const numericAmount = parseAmount(amount);
  const validAmount = Number.isFinite(numericAmount) && numericAmount > 0;
  // Premier moyen de la liste présélectionné tant qu'aucun n'est choisi
  const methodValue = methodId || (methods.data?.[0]?.id ?? '');
  const methodName = methods.data?.find((item) => item.id === methodValue)?.name;

  const query = simplify(search);
  const matches = (subscriptions.data ?? [])
    .filter((item) => item.amountRemaining > 0 && simplify(`${item.customerName} ${item.planName}`).includes(query))
    .sort((a, b) => a.customerName.localeCompare(b.customerName, 'fr'));

  const remainingAfter = selected ? Math.max(0, Math.round((selected.amountRemaining - numericAmount) * 100) / 100) : 0;

  const save = async () => {
    if (!member || !selected || !methodValue || !validAmount) {
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
        paymentMethodId: methodValue,
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
      {selected ? (
        <Card style={styles.selected}>
          <View style={styles.grow}>
            <Text style={styles.name}>{selected.customerName}</Text>
            <Text style={styles.meta}>{selected.planName}</Text>
          </View>
          <Text style={styles.amount}>{formatMoney(selected.amountRemaining, selected.currency)}</Text>
          <Pressable accessibilityRole="button" onPress={() => { setSubscriptionId(''); setAmountInput(null); }}>
            <Text style={styles.link}>Changer</Text>
          </Pressable>
        </Card>
      ) : (
        <>
          <AppInput label="Rechercher un client" onChangeText={setSearch} placeholder="Ex. : Gaëtan" value={search} />
          <View style={styles.stack}>
            {matches.map((item) => (
              <Pressable accessibilityRole="button" key={item.id} onPress={() => setSubscriptionId(item.id)} style={styles.choice}>
                <View style={styles.grow}><Text style={styles.name}>{item.customerName}</Text><Text style={styles.meta}>{item.planName}</Text></View>
                <Text style={styles.amount}>{formatMoney(item.amountRemaining, item.currency)}</Text>
              </Pressable>
            ))}
            {matches.length === 0 ? (
              <Text style={styles.meta}>{search.trim() ? 'Aucun abonnement ne correspond.' : 'Aucun abonnement à encaisser.'}</Text>
            ) : null}
          </View>
        </>
      )}

      <AppInput keyboardType="decimal-pad" label="Montant versé" onChangeText={setAmountInput} value={amount} />
      {selected ? (
        <Chips onChange={() => setAmountInput(String(selected.amountRemaining))} options={[{ value: 'all', label: 'Tout solder' }]} value={null} />
      ) : null}

      <Text style={styles.label}>Moyen de paiement</Text>
      <Chips
        label="Moyen de paiement"
        onChange={setMethodId}
        options={(methods.data ?? []).map((method) => ({ value: method.id, label: method.name }))}
        value={methodValue || null}
      />
      <DateField label="Date du paiement" max={localDateKey()} onChange={setDate} value={date} />
      <AppInput label="Référence" onChangeText={setReference} value={reference} />
      {selected && methodName && validAmount ? (
        <View style={styles.recap}>
          <Text style={styles.recapText}>
            Paiement de {formatMoney(numericAmount, selected.currency)} par {methodName} pour {selected.customerName}.{' '}
            {remainingAfter > 0 ? `Il restera ${formatMoney(remainingAfter, selected.currency)} à payer.` : 'Il ne restera rien à payer.'}
          </Text>
        </View>
      ) : null}
      <AppButton label="Confirmer le paiement" loading={saving} onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  stack: { gap: spacing.sm },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  selected: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
  name: { color: colors.text, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 12 },
  amount: { color: colors.danger, fontWeight: '800' },
  link: { color: colors.primary, fontWeight: '800' },
  recap: { backgroundColor: colors.infoSoft, borderRadius: radii.md, padding: spacing.md },
  recapText: { color: colors.text, fontSize: 14, lineHeight: 20 }
});
