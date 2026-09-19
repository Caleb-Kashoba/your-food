import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandLogo } from '@/components/BrandLogo';
import { Card } from '@/components/ui/Card';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { getDashboardMetrics } from '@/features/dashboard/dashboard.service';
import { useTableRealtime } from '@/hooks/use-table-realtime';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, radii, shadows, spacing } from '@/theme/colors';

const dashboardRealtimeKeys = [['dashboard']] as const;

export default function DashboardScreen() {
  const router = useRouter();
  const { member } = useAuth();
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

      <Text style={styles.sectionEyebrow}>VUE D’ENSEMBLE</Text>
      <View style={styles.grid}>
        <MetricCard icon="people-outline" label="Total clients" value={data.totalCustomers} />
        <MetricCard icon="checkmark-circle-outline" label="Clients actifs" tone="success" value={data.activeCustomers} />
        <MetricCard icon="repeat-outline" label="Abonnements actifs" value={data.activeSubscriptions} />
        <MetricCard icon="time-outline" label="Expire bientôt" tone="warning" value={data.expiringSubscriptions} />
        <MetricCard icon="alert-circle-outline" label="Expirés" tone="danger" value={data.expiredSubscriptions} />
      </View>

      <Card style={styles.deliveryCard}>
        <View>
          <Text style={styles.deliveryEyebrow}>SERVICE DU JOUR</Text>
          <Text style={styles.deliveryTitle}>Livraisons aujourd’hui</Text>
          <Text style={styles.largeValue}>{data.deliveredToday} / {data.deliveriesToday}</Text>
          <Text style={styles.deliveryMuted}>{Math.max(data.deliveriesToday - data.deliveredToday, 0)} restantes</Text>
        </View>
        <Pressable onPress={() => router.push('/(tabs)/today')} style={styles.roundAction}>
          <Ionicons color={colors.white} name="arrow-forward" size={22} />
        </Pressable>
      </Card>

      <View style={styles.grid}>
        <MetricCard icon="add-circle-outline" label="Nouveaux abonnements" value={data.newSubscriptions} />
        <MetricCard icon="wallet-outline" label="Paiements en attente" tone="warning" value={data.pendingPayments} />
      </View>

      <Card style={styles.revenueCard}>
        <View style={styles.revenueIcon}><Ionicons color={colors.accent} name="trending-up" size={24} /></View>
        <View style={styles.revenueCopy}>
          <Text style={styles.cardTitle}>Revenus confirmés ce mois</Text>
          <Text style={styles.revenue}>{formatMoney(data.confirmedRevenue)}</Text>
        </View>
      </Card>

      <Pressable onPress={() => router.push('/subscriptions/new')} style={styles.primaryAction}>
        <Ionicons color={colors.white} name="add" size={22} />
        <Text style={styles.primaryActionText}>Créer un abonnement</Text>
      </Pressable>
    </ScrollView>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone = 'default'
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  return (
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
      <Text numberOfLines={2} style={styles.metricLabel}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
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
  metric: { flexBasis: '46%', flexGrow: 1, gap: spacing.sm },
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
  primaryAction: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radii.lg, padding: spacing.lg, alignItems: 'center', ...shadows.soft },
  primaryActionText: { color: colors.surface, fontSize: 16, fontWeight: '900' }
});
