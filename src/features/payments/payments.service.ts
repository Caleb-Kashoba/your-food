import { requireSupabase } from '@/lib/supabase/client';
import type { PaymentItem, PaymentStatus } from '@/types/domain';

export interface PaymentMethod {
  id: string;
  name: string;
  code: string;
}

export interface PaymentPayload {
  organizationId: string;
  customerId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  paymentMethodId: string;
  reference: string | null;
  paidAt: string;
  comment: string | null;
}

interface PaymentRow {
  id: string;
  customer_id: string;
  subscription_id: string;
  amount: string | number;
  currency: string;
  paid_at: string;
  reference: string | null;
  status: PaymentStatus;
  comment: string | null;
  cancellation_reason: string | null;
  created_at: string;
  payment_methods: { name: string } | { name: string }[];
  customers: { first_name: string; last_name: string } | { first_name: string; last_name: string }[];
}

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0]! : value;
}

function mapPayment(row: PaymentRow): PaymentItem {
  const customer = one(row.customers);
  return {
    id: row.id,
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    customerName: `${customer.first_name} ${customer.last_name}`,
    amount: Number(row.amount),
    currency: row.currency,
    paidAt: row.paid_at,
    methodName: one(row.payment_methods).name,
    reference: row.reference,
    status: row.status,
    comment: row.comment,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at
  };
}

export async function listPayments(filters: { customerId?: string; subscriptionId?: string; limit?: number } = {}): Promise<PaymentItem[]> {
  let query = requireSupabase()
    .from('payments')
    .select('id, customer_id, subscription_id, amount, currency, paid_at, reference, status, comment, cancellation_reason, created_at, payment_methods!inner(name), customers!inner(first_name, last_name)')
    .order('paid_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 100);
  if (filters.customerId) query = query.eq('customer_id', filters.customerId);
  if (filters.subscriptionId) query = query.eq('subscription_id', filters.subscriptionId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as PaymentRow[]).map(mapPayment);
}

export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  const { data, error } = await requireSupabase()
    .from('payment_methods')
    .select('id, name, code')
    .eq('is_active', true)
    .order('display_order');
  if (error) throw error;
  return data as PaymentMethod[];
}

export async function recordPayment(payload: PaymentPayload): Promise<string> {
  const { data, error } = await requireSupabase().rpc('record_payment', {
    p_organization_id: payload.organizationId,
    p_customer_id: payload.customerId,
    p_subscription_id: payload.subscriptionId,
    p_amount: payload.amount,
    p_currency: payload.currency,
    p_payment_method_id: payload.paymentMethodId,
    p_reference: payload.reference,
    p_paid_at: payload.paidAt,
    p_comment: payload.comment
  });
  if (error) throw error;
  return data as string;
}

export async function cancelPayment(id: string, reason: string): Promise<void> {
  const { error } = await requireSupabase().rpc('cancel_payment', {
    p_payment_id: id,
    p_reason: reason
  });
  if (error) throw error;
}
