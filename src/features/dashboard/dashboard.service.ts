import { requireSupabase } from '@/lib/supabase/client';
import type { DashboardMetrics } from '@/types/domain';

interface DashboardRecord {
  total_customers?: number;
  active_customers?: number;
  active_subscriptions?: number;
  expiring_subscriptions?: number;
  expired_subscriptions?: number;
  new_subscriptions?: number;
  deliveries_today?: number;
  delivered_today?: number;
  pending_payments?: number;
  confirmed_revenue?: number;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const { data, error } = await requireSupabase().rpc('dashboard_metrics');
  if (error) throw error;

  const record = (data ?? {}) as DashboardRecord;
  return {
    totalCustomers: Number(record.total_customers ?? 0),
    activeCustomers: Number(record.active_customers ?? 0),
    activeSubscriptions: Number(record.active_subscriptions ?? 0),
    expiringSubscriptions: Number(record.expiring_subscriptions ?? 0),
    expiredSubscriptions: Number(record.expired_subscriptions ?? 0),
    newSubscriptions: Number(record.new_subscriptions ?? 0),
    deliveriesToday: Number(record.deliveries_today ?? 0),
    deliveredToday: Number(record.delivered_today ?? 0),
    pendingPayments: Number(record.pending_payments ?? 0),
    confirmedRevenue: Number(record.confirmed_revenue ?? 0)
  };
}
