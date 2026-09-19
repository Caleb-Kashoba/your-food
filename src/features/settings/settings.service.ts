import { requireSupabase } from '@/lib/supabase/client';

export interface AlertRule {
  id: string;
  name: string;
  daysBefore: number;
  isActive: boolean;
}

export interface MessageTemplate {
  id: string;
  code: string;
  name: string;
  body: string;
  isActive: boolean;
}

interface AlertRuleRow {
  id: string;
  name: string;
  days_before: number;
  is_active: boolean;
}

export async function listAlertRules(): Promise<AlertRule[]> {
  const { data, error } = await requireSupabase()
    .from('alert_rules')
    .select('id, name, days_before, is_active')
    .eq('alert_type', 'subscription_expiration')
    .order('days_before', { ascending: false });
  if (error) throw error;
  return (data as AlertRuleRow[]).map((row) => ({ id: row.id, name: row.name, daysBefore: row.days_before, isActive: row.is_active }));
}

export async function updateAlertRule(id: string, daysBefore: number, isActive: boolean): Promise<void> {
  const { error } = await requireSupabase().from('alert_rules').update({ days_before: daysBefore, is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function listMessageTemplates(): Promise<MessageTemplate[]> {
  const { data, error } = await requireSupabase()
    .from('message_templates')
    .select('id, code, name, body, is_active')
    .order('name');
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    body: row.body,
    isActive: row.is_active
  }));
}

export async function updateMessageTemplate(id: string, body: string, isActive: boolean): Promise<void> {
  const { error } = await requireSupabase()
    .from('message_templates')
    .update({ body: body.trim(), is_active: isActive })
    .eq('id', id);
  if (error) throw error;
}
