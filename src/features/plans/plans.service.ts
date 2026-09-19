import { requireSupabase } from '@/lib/supabase/client';
import type { Plan } from '@/types/domain';

interface PlanRecord {
  id: string;
  name: string;
  description: string | null;
  price: string | number;
  currency: string;
  duration_value: number;
  duration_unit: Plan['durationUnit'];
  service_days_count: number;
  is_active: boolean;
  plan_service_days: { weekday: number }[];
}

export interface PlanPayload {
  name: string;
  description: string | null;
  price: number;
  currency: string;
  durationValue: number;
  durationUnit: Plan['durationUnit'];
  weekdays: number[];
}

export async function listPlans(activeOnly = false): Promise<Plan[]> {
  let query = requireSupabase()
    .from('plans')
    .select('id, name, description, price, currency, duration_value, duration_unit, service_days_count, is_active, plan_service_days(weekday)')
    .order('name');
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as PlanRecord[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    durationValue: row.duration_value,
    durationUnit: row.duration_unit,
    serviceDaysCount: row.service_days_count,
    serviceWeekdays: row.plan_service_days.map((day) => day.weekday).sort(),
    isActive: row.is_active
  }));
}

export async function getPlan(id: string): Promise<Plan> {
  const { data, error } = await requireSupabase()
    .from('plans')
    .select('id, name, description, price, currency, duration_value, duration_unit, service_days_count, is_active, plan_service_days(weekday)')
    .eq('id', id)
    .single();
  if (error) throw error;
  const row = data as unknown as PlanRecord;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    durationValue: row.duration_value,
    durationUnit: row.duration_unit,
    serviceDaysCount: row.service_days_count,
    serviceWeekdays: row.plan_service_days.map((day) => day.weekday).sort(),
    isActive: row.is_active
  };
}

export async function createPlan(organizationId: string, payload: PlanPayload): Promise<string> {
  const { data, error } = await requireSupabase().rpc('create_plan_with_schedule', {
    p_organization_id: organizationId,
    p_name: payload.name,
    p_description: payload.description,
    p_price: payload.price,
    p_currency: payload.currency,
    p_duration_value: payload.durationValue,
    p_duration_unit: payload.durationUnit,
    p_weekdays: payload.weekdays
  });
  if (error) throw error;
  return data as string;
}

export async function updatePlan(id: string, payload: PlanPayload, isActive: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc('update_plan_with_schedule', {
    p_plan_id: id,
    p_name: payload.name,
    p_description: payload.description,
    p_price: payload.price,
    p_currency: payload.currency,
    p_duration_value: payload.durationValue,
    p_duration_unit: payload.durationUnit,
    p_weekdays: payload.weekdays,
    p_is_active: isActive
  });
  if (error) throw error;
}
