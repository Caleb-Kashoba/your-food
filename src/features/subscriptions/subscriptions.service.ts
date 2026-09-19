import { requireSupabase } from '@/lib/supabase/client';
import type { SubscriptionSummary } from '@/types/domain';

interface SubscriptionRecord {
  id: string;
  customer_id: string;
  customer_name: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  price: string | number;
  currency: string;
  admin_status: SubscriptionSummary['adminStatus'];
  effective_status: SubscriptionSummary['effectiveStatus'];
  days_until_expiration: number;
  amount_paid: string | number;
  amount_remaining: string | number;
  payment_state: SubscriptionSummary['paymentState'];
}

interface SubscriptionDetailRow {
  notes: string | null;
  renewed_from_id: string | null;
  created_at: string;
  subscription_service_days: { weekday: number }[];
}

export interface SubscriptionDetail extends SubscriptionSummary {
  notes: string | null;
  renewedFromId: string | null;
  createdAt: string;
  serviceWeekdays: number[];
}

function mapSubscription(row: SubscriptionRecord): SubscriptionSummary {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    planName: row.plan_name,
    startDate: row.start_date,
    endDate: row.end_date,
    price: Number(row.price),
    currency: row.currency,
    adminStatus: row.admin_status,
    effectiveStatus: row.effective_status,
    daysUntilExpiration: row.days_until_expiration,
    amountPaid: Number(row.amount_paid),
    amountRemaining: Number(row.amount_remaining),
    paymentState: row.payment_state
  };
}

export async function listSubscriptions(customerId?: string): Promise<SubscriptionSummary[]> {
  let query = requireSupabase().from('subscription_overview').select('*').order('start_date', { ascending: false }).limit(150);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as SubscriptionRecord[]).map(mapSubscription);
}

export async function getSubscriptionDetail(id: string): Promise<SubscriptionDetail> {
  const client = requireSupabase();
  const [overviewResult, detailResult] = await Promise.all([
    client.from('subscription_overview').select('*').eq('id', id).single(),
    client
      .from('subscriptions')
      .select('notes, renewed_from_id, created_at, subscription_service_days(weekday)')
      .eq('id', id)
      .single()
  ]);
  if (overviewResult.error) throw overviewResult.error;
  if (detailResult.error) throw detailResult.error;
  const summary = mapSubscription(overviewResult.data as unknown as SubscriptionRecord);
  const detail = detailResult.data as unknown as SubscriptionDetailRow;
  return {
    ...summary,
    notes: detail.notes,
    renewedFromId: detail.renewed_from_id,
    createdAt: detail.created_at,
    serviceWeekdays: detail.subscription_service_days.map((day) => day.weekday).sort()
  };
}

export async function createSubscription(params: {
  organizationId: string;
  customerId: string;
  planId: string;
  startDate: string;
  notes?: string | null;
  renewedFromId?: string | null;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('create_subscription', {
    p_organization_id: params.organizationId,
    p_customer_id: params.customerId,
    p_plan_id: params.planId,
    p_start_date: params.startDate,
    p_notes: params.notes ?? null,
    p_renewed_from_id: params.renewedFromId ?? null
  });
  if (error) throw error;
  return data as string;
}

export async function setSubscriptionStatus(id: string, status: 'active' | 'suspended' | 'cancelled', reason?: string): Promise<void> {
  const { error } = await requireSupabase().rpc('set_subscription_status', {
    p_subscription_id: id,
    p_status: status,
    p_reason: reason?.trim() || null
  });
  if (error) throw error;
}

export async function updateSubscriptionNotes(id: string, notes: string): Promise<void> {
  const { error } = await requireSupabase().rpc('update_subscription_notes', {
    p_subscription_id: id,
    p_notes: notes
  });
  if (error) throw error;
}
