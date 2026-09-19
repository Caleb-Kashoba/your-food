import { normalizePhone } from '@/lib/phone';
import { requireSupabase } from '@/lib/supabase/client';
import type { CustomerPayload } from '@/features/customers/customer.schema';
import type { Customer } from '@/types/domain';

interface CustomerRecord {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  phone_normalized: string;
  whatsapp: string | null;
  residence: string | null;
  building: string | null;
  room: string | null;
  zone_id: string | null;
  address_details: string | null;
  food_preferences: string | null;
  allergies: string | null;
  foods_to_avoid: string | null;
  notes: string | null;
  status: Customer['status'];
  created_at: string;
  delivery_zones: { name: string } | { name: string }[] | null;
}

export interface DeliveryZone {
  id: string;
  name: string;
}

function relationName(value: CustomerRecord['delivery_zones']): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0]?.name ?? null : value.name;
}

function mapCustomer(row: CustomerRecord): Customer {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    normalizedPhone: row.phone_normalized,
    whatsapp: row.whatsapp,
    residence: row.residence,
    building: row.building,
    room: row.room,
    zoneId: row.zone_id,
    zoneName: relationName(row.delivery_zones),
    addressDetails: row.address_details,
    foodPreferences: row.food_preferences,
    allergies: row.allergies,
    foodsToAvoid: row.foods_to_avoid,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at
  };
}

const customerSelection =
  'id, first_name, last_name, phone, phone_normalized, whatsapp, residence, building, room, zone_id, address_details, food_preferences, allergies, foods_to_avoid, notes, status, created_at, delivery_zones(name)';

export async function listCustomers(search = ''): Promise<Customer[]> {
  const client = requireSupabase();
  let query = client.from('customers').select(customerSelection).order('last_name').order('first_name').limit(100);
  const cleaned = search.trim().replace(/[,()%]/g, '');
  if (cleaned) {
    const normalized = normalizePhone(cleaned);
    const filters = [`first_name.ilike.%${cleaned}%`, `last_name.ilike.%${cleaned}%`];
    if (normalized) {
      filters.push(`phone_normalized.eq.${normalized}`);
      filters.push(`whatsapp_normalized.eq.${normalized}`);
    }
    query = query.or(filters.join(','));
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as CustomerRecord[]).map(mapCustomer);
}

export async function getCustomer(id: string): Promise<Customer> {
  const { data, error } = await requireSupabase().from('customers').select(customerSelection).eq('id', id).single();
  if (error) throw error;
  return mapCustomer(data as unknown as CustomerRecord);
}

export async function createCustomer(organizationId: string, memberId: string, payload: CustomerPayload): Promise<string> {
  const normalized = normalizePhone(payload.phone);
  if (!normalized) throw new Error('Numéro de téléphone invalide.');

  const { data, error } = await requireSupabase()
    .from('customers')
    .insert({
      organization_id: organizationId,
      first_name: payload.firstName,
      last_name: payload.lastName,
      phone: payload.phone,
      whatsapp: payload.whatsapp || null,
      residence: payload.residence,
      building: payload.building,
      room: payload.room,
      zone_id: payload.zoneId,
      address_details: payload.addressDetails,
      food_preferences: payload.foodPreferences,
      allergies: payload.allergies,
      foods_to_avoid: payload.foodsToAvoid,
      notes: payload.notes,
      status: payload.status,
      created_by: memberId,
      updated_by: memberId
    })
    .select('id')
    .single();

  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updateCustomer(id: string, memberId: string, payload: CustomerPayload): Promise<void> {
  const { error } = await requireSupabase()
    .from('customers')
    .update({
      first_name: payload.firstName,
      last_name: payload.lastName,
      phone: payload.phone,
      whatsapp: payload.whatsapp || null,
      residence: payload.residence,
      building: payload.building,
      room: payload.room,
      zone_id: payload.zoneId,
      address_details: payload.addressDetails,
      food_preferences: payload.foodPreferences,
      allergies: payload.allergies,
      foods_to_avoid: payload.foodsToAvoid,
      notes: payload.notes,
      status: payload.status,
      updated_by: memberId
    })
    .eq('id', id);
  if (error) throw error;
}

export async function listDeliveryZones(): Promise<DeliveryZone[]> {
  const { data, error } = await requireSupabase().from('delivery_zones').select('id, name').eq('is_active', true).order('name');
  if (error) throw error;
  return data as DeliveryZone[];
}
