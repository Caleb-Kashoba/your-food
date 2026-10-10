import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandLogo } from '@/components/BrandLogo';
import { Card } from '@/components/ui/Card';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { getDashboardMetrics } from '@/features/dashboard/dashboard.service';
import { NextMenuCard } from '@/features/menus/NextMenuCard';
import { RenewalsCard } from '@/features/subscriptions/RenewalsCard';
import { useTableRealtime } from '@/hooks/use-table-realtime';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, shadows, spacing } from '@/theme/colors';

const dashboardRealtimeKeys = [['dashboard']] as const;

export default function DashboardScreen() {
  const router = useRouter();
  const { member, hasPermission } = useAuth();
  const metrics = useQuery({ queryKey: ['dashboard'], queryFn: getDashboardMetrics });
  useTableRealtime('deliveries', member?.organizationId, dashboardRealtimeKeys);
  useTableRealtime('subscriptions', member?.organizationId, dashboardRealtimeKeys);
  useTableRealtime('payments', member?.organizationId, dashboardRealtimeKeys);

  if (metrics.isLoading) return <LoadingView label="Chargement du tableau de bord…" />;
  if (metrics.error || !metrics.data) {
    return <ErrorView message={getErrorMessage(metrics.error)} onRetry={() => void metrics.refetch()} />;
  }

  const data = metrics.data;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={metrics.isRefetching} onRefresh={() => void metrics.refetch()} tintColor={colors.primary} />}
    >
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <BrandLogo compact />
          <View style={styles.rolePill}><Text style={styles.role}>{member?.role.toUpperCase()}</Text></View>
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.greeting}>Bonjour, {member?.displayName}</Text>
          <Text style={styles.heroText}>Voici l’essentiel de votre activité aujourd’hui.</Text>
        </View>
      </View>

      <Text style={styles.sectionEyebrow}>À FAIRE AUJOURD’HUI</Text>
      {hasPermission('menus.write') ? <NextMenuCard /> : null}

      <Card style={styles.deliveryCard}>
        <View>
          <Text style={styles.deliveryEyebrow}>SERVICE DU JOUR</Text>
          <Text style={styles.deliveryTitle}>Livraisons aujourd’hui</Text>
          <Text style={styles.largeValue}>{data.deliveredToday} / {data.deliveriesToday}</Text>
          <Text style={styles.deliveryMuted}>{Math.max(data.deliveriesToday - data.deliveredToday, 0)} restantes</Text>
        </View>
        <Pressable accessibilityLabel="Ouvrir le service du jour" accessibilityRole="button" onPress={() => router.push('/(tabs)/today')} style={styles.roundAction}>
          <Ionicons color={colors.white} name="arrow-forward" size={22} />
        </Pressable>
      </Card>

      {hasPermission('orders.read') ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/orders/live')} style={styles.liveLink}>
          <Ionicons color={colors.primary} name="checkbox-outline" size={22} />
          <Text style={styles.liveLinkText}>Commandes du jour</Text>
          <Ionicons color={colors.muted} name="chevron-forward" size={20} />
        </Pressable>
      ) : null}

      {hasPermission('subscriptions.read') ? <RenewalsCard /> : null}

      <Text style={styles.sectionEyebrow}>VUE D’ENSEMBLE</Text>
      <View style={styles.grid}>
        <MetricCard icon="people-outline" label="Clients actifs" onPress={() => router.push('/(tabs)/customers')} tone="success" value={data.activeCustomers} detail={`sur ${data.totalCustomers}`} />
        <MetricCard icon="repeat-outline" label="Abonnements en cours" onPress={() => router.push({ pathname: '/subscriptions', params: { state: 'active' } })} value={data.activeSubscriptions} />
        <MetricCard icon="time-outline" label="Finissent bientôt" onPress={() => router.push({ pathname: '/subscriptions', params: { state: 'expiring' } })} tone="warning" value={data.expiringSubscriptions} />
        <MetricCard icon="alert-circle-outline" label="Expirés" onPress={() => router.push({ pathname: '/subscriptions', params: { state: 'expired' } })} tone="danger" value={data.expiredSubscriptions} />
        <MetricCard icon="add-circle-outline" label="Nouveaux abonnements ce mois" value={data.newSubscriptions} />
        <MetricCard icon="wallet-outline" label="Paiements en attente" onPress={hasPermission('payments.read') ? () => router.push('/payments') : undefined} tone="warning" value={data.pendingPayments} />
      </View>

      <Card style={styles.revenueCard}>
        <View style={styles.revenueIcon}><Ionicons color={colors.accent} name="trending-up" size={24} /></View>
        <View style={styles.revenueCopy}>
          <Text style={styles.cardTitle}>Revenus confirmés ce mois</Text>
          <Text style={styles.revenue}>{formatMoney(data.confirmedRevenue)}</Text>
        </View>
      </Card>

      {hasPermission('subscriptions.write') ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/subscriptions/new')} style={styles.secondaryAction}>
          <Ionicons color={colors.primary} name="add" size={22} />
          <Text style={styles.secondaryActionText}>Créer un abonnement</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  onPress,
  tone = 'default'
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: number;
  detail?: string;
  onPress?: (() => void) | undefined;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const card = (
    <Card
      style={[
        styles.metric,
        tone === 'warning' && styles.warningMetric,
        tone === 'danger' && styles.dangerMetric,
        tone === 'success' && styles.successMetric
      ]}
    >
      <View style={styles.metricTop}>
        <View style={styles.metricIcon}><Ionicons color={colors.primary} name={icon} size={20} /></View>
        <Text style={styles.metricValue}>{value}</Text>
      </View>
      <Text numberOfLines={2} style={styles.metricLabel}>{label}{detail ? ` ${detail}` : ''}</Text>
      {onPress ? <Ionicons color={colors.muted} name="chevron-forward" size={16} style={styles.metricChevron} /> : null}
    </Card>
  );
  if (!onPress) return <View style={styles.metricSlot}>{card}</View>;
  return (
    <Pressable accessibilityLabel={`${label} : ${value}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.metricSlot, pressed && styles.pressed]}>
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  liveLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md },
  liveLinkText: { flex: 1, color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  content: { padding: spacing.md, gap: spacing.md, backgroundColor: colors.background },
  hero: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.xl, padding: spacing.md, gap: spacing.lg, ...shadows.soft },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  heroCopy: { gap: spacing.xs },
  greeting: { color: colors.primaryDark, fontSize: 25, fontWeight: '900', letterSpacing: -0.6 },
  heroText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  rolePill: { backgroundColor: colors.accentSoft, borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  role: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  sectionEyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginTop: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metricSlot: { flexBasis: '46%', flexGrow: 1 },
  metric: { flex: 1, gap: spacing.sm },
  metricChevron: { position: 'absolute', right: spacing.sm, bottom: spacing.sm },
  pressed: { opacity: 0.7 },
  warningMetric: { backgroundColor: colors.warningSoft },
  dangerMetric: { backgroundColor: colors.dangerSoft },
  successMetric: { backgroundColor: colors.successSoft },
  metricTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  metricIcon: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft },
  metricValue: { color: colors.primaryDark, fontSize: 29, fontWeight: '900' },
  metricLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  deliveryCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primaryDark, borderColor: colors.primaryDark, padding: spacing.lg },
  deliveryEyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  deliveryTitle: { color: colors.cream, fontSize: 16, fontWeight: '800', marginTop: spacing.xs },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  largeValue: { color: colors.white, fontSize: 34, fontWeight: '900', marginTop: spacing.sm },
  deliveryMuted: { color: colors.sand, fontSize: 14 },
  roundAction: { alignItems: 'center', justifyContent: 'center', width: 50, height: 50, backgroundColor: colors.primary, borderRadius: 25 },
  revenueCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  revenueIcon: { alignItems: 'center', justifyContent: 'center', width: 50, height: 50, borderRadius: 25, backgroundColor: colors.accentSoft },
  revenueCopy: { flex: 1 },
  revenue: { color: colors.accent, fontSize: 27, fontWeight: '900', marginTop: spacing.xs },
  secondaryAction: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.surfaceStrong, borderColor: colors.primary, borderWidth: 1, borderRadius: radii.lg, minHeight: 52, padding: spacing.md, alignItems: 'center' },
  secondaryActionText: { color: colors.primary, fontSize: 16, fontWeight: '900' }
});
