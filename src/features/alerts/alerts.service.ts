import { requireSupabase } from '@/lib/supabase/client';
import type { AlertItem, AlertStatus } from '@/types/domain';

interface AlertRecord {
  id: string;
  title: string;
  body: string;
  status: AlertStatus;
  alert_type: string;
  trigger_date: string;
  customer_id: string | null;
  subscription_id: string | null;
  customer_name: string | null;
  whatsapp: string | null;
}

export async function listAlerts(): Promise<AlertItem[]> {
  await requireSupabase().rpc('generate_subscription_alerts');
  const { data, error } = await requireSupabase()
    .from('alert_overview')
    .select('*')
    .order('trigger_date', { ascending: false })
    .limit(150);
  if (error) throw error;
  return (data as unknown as AlertRecord[]).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    alertType: row.alert_type,
    triggerDate: row.trigger_date,
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    customerName: row.customer_name,
    whatsapp: row.whatsapp
  }));
}

export async function updateAlertStatus(id: string, status: AlertStatus): Promise<void> {
  const { error } = await requireSupabase().rpc('update_alert_status', { p_alert_id: id, p_status: status });
  if (error) throw error;
}

export async function getMessageTemplate(code: string): Promise<string> {
  const { data, error } = await requireSupabase()
    .from('message_templates')
    .select('body')
    .eq('code', code)
    .eq('is_active', true)
    .single();
  if (error) throw error;
  return (data as { body: string }).body;
}
