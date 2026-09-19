import { localDateKey } from '@/lib/dates';
import { requireSupabase } from '@/lib/supabase/client';
import type { Delivery, DeliveryStatus } from '@/types/domain';

interface DeliveryRecord {
  id: string;
  customer_id: string;
  subscription_id: string;
  delivery_date: string;
  customer_name: string;
  phone: string;
  residence: string | null;
  building: string | null;
  room: string | null;
  zone_name: string | null;
  plan_name: string;
  status: DeliveryStatus;
}

function mapDelivery(row: DeliveryRecord): Delivery {
  return {
    id: row.id,
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    deliveryDate: row.delivery_date,
    customerName: row.customer_name,
    phone: row.phone,
    residence: row.residence,
    building: row.building,
    room: row.room,
    zoneName: row.zone_name,
    planName: row.plan_name,
    status: row.status
  };
}

export async function listDeliveries(date = localDateKey()): Promise<Delivery[]> {
  const { data, error } = await requireSupabase()
    .from('delivery_overview')
    .select('*')
    .eq('delivery_date', date)
    .order('zone_name')
    .order('customer_name');
  if (error) throw error;
  return (data as unknown as DeliveryRecord[]).map(mapDelivery);
}

export async function listDeliveriesRange(startDate: string, endDate: string, customerId?: string): Promise<Delivery[]> {
  let query = requireSupabase()
    .from('delivery_overview')
    .select('*')
    .gte('delivery_date', startDate)
    .lte('delivery_date', endDate)
    .order('delivery_date')
    .order('zone_name')
    .order('customer_name');
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as DeliveryRecord[]).map(mapDelivery);
}

export async function listCustomerDeliveries(customerId: string, limit = 20): Promise<Delivery[]> {
  const { data, error } = await requireSupabase()
    .from('delivery_overview')
    .select('*')
    .eq('customer_id', customerId)
    .order('delivery_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as unknown as DeliveryRecord[]).map(mapDelivery);
}

export async function updateDeliveryStatus(id: string, status: DeliveryStatus): Promise<void> {
  const { error } = await requireSupabase().rpc('update_delivery_status', {
    p_delivery_id: id,
    p_status: status
  });
  if (error) throw error;
}
