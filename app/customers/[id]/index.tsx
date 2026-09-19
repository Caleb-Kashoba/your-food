import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { getCustomer } from '@/features/customers/customers.service';
import { listCustomerDeliveries } from '@/features/deliveries/deliveries.service';
import { listPayments } from '@/features/payments/payments.service';
import { listSubscriptions } from '@/features/subscriptions/subscriptions.service';
import { calculateRenewalStartDate, formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, spacing } from '@/theme/colors';

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id), enabled: Boolean(id) });
  const subscriptions = useQuery({ queryKey: ['subscriptions', id], queryFn: () => listSubscriptions(id), enabled: Boolean(id) });
  const payments = useQuery({ queryKey: ['payments', 'customer', id], queryFn: () => listPayments({ customerId: id, limit: 20 }), enabled: Boolean(id) });
  const deliveries = useQuery({ queryKey: ['deliveries', 'customer', id], queryFn: () => listCustomerDeliveries(id, 20), enabled: Boolean(id) });

  if (customer.isLoading) return <LoadingView />;
  if (customer.error || !customer.data) return <ErrorView message={getErrorMessage(customer.error)} onRetry={() => void customer.refetch()} />;

  const item = customer.data;
  const confirmedPaid = payments.data?.filter((payment) => payment.status === 'confirmed').reduce((sum, payment) => sum + payment.amount, 0) ?? 0;
  const activityDates = [
    item.createdAt,
    ...(subscriptions.data?.map((subscription) => subscription.startDate) ?? []),
    ...(payments.data?.map((payment) => payment.paidAt) ?? []),
    ...(deliveries.data?.map((delivery) => delivery.deliveryDate) ?? [])
  ].sort();
  const lastActivity = activityDates.at(-1);
  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{item.firstName[0]}{item.lastName[0]}</Text></View>
        <View style={styles.grow}>
          <Text style={styles.name}>{item.firstName} {item.lastName}</Text>
          <Text style={styles.meta}>{item.phone}</Text>
        </View>
        {hasPermission('customers.write') ? (
          <Pressable onPress={() => router.push({ pathname: '/customers/[id]/edit', params: { id } })} style={styles.iconButton}>
            <Ionicons color={colors.primary} name="pencil" size={20} />
          </Pressable>
        ) : null}
      </View>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Synthèse</Text>
        <Info label="Statut" value={item.status} />
        <Info label="Inscription" value={formatLocalDate(item.createdAt)} />
        <Info label="Total payé" value={formatMoney(confirmedPaid)} />
        <Info label="Dernière activité" value={lastActivity ? formatLocalDate(lastActivity) : null} />
      </Card>
      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push({
            pathname: '/whatsapp/compose',
            params: { phone: item.whatsapp || item.phone, customerName: item.firstName, templateCode: 'custom' }
          })}
          style={styles.whatsapp}
        >
          <Ionicons color={colors.surface} name="logo-whatsapp" size={21} />
          <Text style={styles.whatsappText}>Contacter</Text>
        </Pressable>
        {hasPermission('subscriptions.write') ? (
          <Pressable onPress={() => router.push({ pathname: '/subscriptions/new', params: { customerId: id } })} style={styles.secondaryAction}>
            <Ionicons color={colors.primary} name="add-circle-outline" size={21} />
            <Text style={styles.secondaryActionText}>Abonnement</Text>
          </Pressable>
        ) : null}
      </View>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Livraison</Text>
        <Info label="Résidence" value={item.residence} />
        <Info label="Bâtiment / chambre" value={[item.building, item.room].filter(Boolean).join(' / ') || null} />
        <Info label="Zone" value={item.zoneName} />
        <Info label="Complément" value={item.addressDetails} />
      </Card>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Paiements récents</Text>
        {payments.error ? <Text style={styles.errorText}>{getErrorMessage(payments.error)}</Text> : null}
        {payments.data?.length === 0 ? <Text style={styles.emptyText}>Aucun paiement enregistré.</Text> : null}
        {payments.data?.slice(0, 8).map((payment) => (
          <View key={payment.id} style={styles.historyRow}>
            <View style={styles.grow}>
              <Text style={styles.historyTitle}>{formatMoney(payment.amount, payment.currency)} · {payment.methodName}</Text>
              <Text style={styles.meta}>{formatLocalDate(payment.paidAt)}{payment.reference ? ` · ${payment.reference}` : ''}</Text>
            </View>
            <StatusBadge status={payment.status} />
          </View>
        ))}
      </Card>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Livraisons récentes</Text>
        {deliveries.error ? <Text style={styles.errorText}>{getErrorMessage(deliveries.error)}</Text> : null}
        {deliveries.data?.length === 0 ? <Text style={styles.emptyText}>Aucune livraison enregistrée.</Text> : null}
        {deliveries.data?.slice(0, 8).map((delivery) => (
          <View key={delivery.id} style={styles.historyRow}>
            <View style={styles.grow}>
              <Text style={styles.historyTitle}>{formatLocalDate(delivery.deliveryDate)} · {delivery.planName}</Text>
              <Text style={styles.meta}>{[delivery.zoneName, delivery.residence, delivery.building, delivery.room].filter(Boolean).join(' · ')}</Text>
            </View>
            <StatusBadge status={delivery.status} />
          </View>
        ))}
      </Card>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Alimentation</Text>
        <Info label="Préférences" value={item.foodPreferences} />
        <Info label="Allergies" value={item.allergies} />
        <Info label="À éviter" value={item.foodsToAvoid} />
      </Card>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Abonnements</Text>
        {subscriptions.isLoading ? <LoadingView /> : null}
        {subscriptions.data?.length === 0 ? <Text style={styles.emptyText}>Aucun abonnement enregistré.</Text> : null}
        {subscriptions.data?.map((subscription) => (
          <Pressable
            key={subscription.id}
            onPress={() => router.push({ pathname: '/subscriptions/[id]', params: { id: subscription.id } })}
            style={styles.subscription}
          >
            <View style={styles.subscriptionHeader}>
              <View style={styles.grow}>
                <Text style={styles.subscriptionName}>{subscription.planName}</Text>
                <Text style={styles.meta}>{formatLocalDate(subscription.startDate)} → {formatLocalDate(subscription.endDate)}</Text>
              </View>
              <StatusBadge status={subscription.effectiveStatus} />
            </View>
            <Text style={styles.payment}>{formatMoney(subscription.amountPaid)} / {formatMoney(subscription.price)}</Text>
            {hasPermission('subscriptions.write') ? (
              <Pressable
                onPress={() => router.push({
                  pathname: '/subscriptions/new',
                  params: {
                    customerId: id,
                    renewedFromId: subscription.id,
                    startDate: calculateRenewalStartDate(subscription.endDate)
                  }
                })}
              >
                <Text style={styles.link}>Renouveler</Text>
              </Pressable>
            ) : null}
          </Pressable>
        ))}
      </Card>
      {item.notes ? (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Notes internes</Text>
          <Text style={styles.notes}>{item.notes}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || 'Non renseigné'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { alignItems: 'center', justifyContent: 'center', width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary },
  avatarText: { color: colors.surface, fontSize: 18, fontWeight: '800' },
  grow: { flex: 1 },
  name: { color: colors.text, fontSize: 22, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  iconButton: { backgroundColor: colors.primarySoft, borderRadius: radii.round, padding: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  whatsapp: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: '#168C4B', borderRadius: radii.md, padding: spacing.md },
  whatsappText: { color: colors.surface, fontWeight: '800' },
  secondaryAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primarySoft, borderRadius: radii.md, padding: spacing.md },
  secondaryActionText: { color: colors.primaryDark, fontWeight: '800' },
  card: { gap: spacing.md },
  sectionTitle: { color: colors.primaryDark, fontSize: 17, fontWeight: '800' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  infoLabel: { color: colors.muted, fontSize: 14 },
  infoValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  subscription: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
  subscriptionHeader: { flexDirection: 'row', gap: spacing.sm },
  subscriptionName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  payment: { color: colors.success, fontWeight: '700' },
  link: { color: colors.primary, fontWeight: '800' },
  emptyText: { color: colors.muted },
  errorText: { color: colors.danger, fontSize: 13 },
  historyRow: { flexDirection: 'row', alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.sm, paddingTop: spacing.sm },
  historyTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  notes: { color: colors.text, fontSize: 14, lineHeight: 21 }
});
