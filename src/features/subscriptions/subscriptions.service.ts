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
  plan_id: string;
  notes: string | null;
  renewed_from_id: string | null;
  created_at: string;
  subscription_service_days: { weekday: number }[];
}

export interface SubscriptionDetail extends SubscriptionSummary {
  planId: string;
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
      .select('plan_id, notes, renewed_from_id, created_at, subscription_service_days(weekday)')
      .eq('id', id)
      .single()
  ]);
  if (overviewResult.error) throw overviewResult.error;
  if (detailResult.error) throw detailResult.error;
  const summary = mapSubscription(overviewResult.data as unknown as SubscriptionRecord);
  const detail = detailResult.data as unknown as SubscriptionDetailRow;
  return {
    ...summary,
    planId: detail.plan_id,
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

/** Abonnement en semaines : lundi → vendredi, prix hebdomadaire × semaines (ou prix total exceptionnel) */
export async function createSubscriptionWeeks(params: {
  customerId: string;
  planId: string;
  startDate: string;
  weeks: number;
  totalPrice?: number | null;
  notes?: string | null;
  renewedFromId?: string | null;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('create_subscription_weeks', {
    p_customer: params.customerId,
    p_plan: params.planId,
    p_start: params.startDate,
    p_weeks: params.weeks,
    p_total_price: params.totalPrice ?? null,
    p_notes: params.notes ?? null,
    p_renewed_from: params.renewedFromId ?? null
  });
  if (error) throw error;
  return data as string;
}

/** Prix exceptionnel pour un abonnement précis (la raison est conservée dans l'historique) */
export async function setSubscriptionPrice(id: string, total: number, reason: string): Promise<void> {
  const { error } = await requireSupabase().rpc('set_subscription_price', {
    p_subscription: id,
    p_total: total,
    p_reason: reason
  });
  if (error) throw error;
}

/** Abonnement qui se termine bientôt, sans suite : à renouveler (tableau de bord) */
export interface RenewalItem {
  subscriptionId: string;
  customerId: string;
  customerName: string;
  phone: string | null;
  planName: string;
  endDate: string;
  daysLeft: number;
  price: number;
  currency: string;
}

interface RenewalRow {
  subscription_id: string;
  customer_id: string;
  customer_name: string;
  phone: string | null;
  plan_name: string;
  end_date: string;
  days_left: number;
  price: string | number;
  currency: string;
}

export async function listSubscriptionsToRenew(): Promise<RenewalItem[]> {
  const { data, error } = await requireSupabase().rpc('subscriptions_to_renew');
  if (error) throw error;
  return (data as RenewalRow[]).map((row) => ({
    subscriptionId: row.subscription_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    phone: row.phone,
    planName: row.plan_name,
    endDate: row.end_date,
    daysLeft: row.days_left,
    price: Number(row.price),
    currency: row.currency
  }));
}

/**
 * Renouvelle un client : même formule → l'abonnement en cours est rallongé ;
 * autre formule → un nouvel abonnement commence le lundi qui suit la fin de l'abonnement en cours.
 */
export async function renewSubscriptionWeeks(customerId: string, weeks = 1, planId?: string | null): Promise<string> {
  const { data, error } = await requireSupabase().rpc('renew_subscription_weeks', { p_customer: customerId, p_weeks: weeks, p_plan: planId ?? null });
  if (error) throw error;
  return data as string;
}

/** Rallonge l'abonnement en cours : fin + N semaines, prix + N × prix hebdomadaire, livraisons ajoutées */
export async function extendSubscriptionWeeks(id: string, weeks: number, reason?: string): Promise<void> {
  const { error } = await requireSupabase().rpc('extend_subscription_weeks', {
    p_subscription: id,
    p_weeks: weeks,
    p_reason: reason?.trim() || null
  });
  if (error) throw error;
}

/** Modifie les dates d'un abonnement (motif obligatoire, conservé dans l'historique) */
export async function modifySubscription(params: { id: string; startDate?: string | null; endDate?: string | null; reason: string }): Promise<void> {
  const { error } = await requireSupabase().rpc('modify_subscription', {
    p_subscription: params.id,
    p_start: params.startDate || null,
    p_end: params.endDate || null,
    p_reason: params.reason.trim()
  });
  if (error) throw error;
}

/** Supprime un abonnement sans paiement ni repas déjà livré (motif obligatoire, conservé dans l'historique) */
export async function deleteSubscription(id: string, reason: string): Promise<void> {
  const { error } = await requireSupabase().rpc('delete_subscription', { p_subscription: id, p_reason: reason.trim() });
  if (error) throw error;
}

export interface SubscriptionChange {
  id: string;
  action: 'extended' | 'modified' | 'deleted';
  reason: string | null;
  details: Record<string, string | number | null>;
  createdAt: string;
}

export async function listSubscriptionChanges(subscriptionId: string): Promise<SubscriptionChange[]> {
  const { data, error } = await requireSupabase()
    .from('subscription_changes')
    .select('id, action, reason, details, created_at')
    .eq('subscription_id', subscriptionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as { id: string; action: SubscriptionChange['action']; reason: string | null; details: SubscriptionChange['details']; created_at: string }[]).map((row) => ({
    id: row.id,
    action: row.action,
    reason: row.reason,
    details: row.details,
    createdAt: row.created_at
  }));
}

/** Change la formule d'un abonnement en cours (motif obligatoire) : prix recalculé, viande des repas à venir ajustée */
export async function changeSubscriptionPlan(id: string, planId: string, reason: string): Promise<void> {
  const { error } = await requireSupabase().rpc('change_subscription_plan', { p_subscription: id, p_plan: planId, p_reason: reason.trim() });
  if (error) throw error;
}
