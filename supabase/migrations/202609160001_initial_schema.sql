begin;

create extension if not exists pgcrypto;

create type public.app_role_name as enum ('root', 'admin', 'manager', 'staff');
create type public.member_status as enum ('active', 'disabled');
create type public.customer_status as enum ('active', 'inactive', 'former_customer');
create type public.duration_unit as enum ('day', 'week', 'month');
create type public.subscription_admin_status as enum ('pending', 'active', 'suspended', 'cancelled');
create type public.delivery_status as enum ('scheduled', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'failed', 'cancelled');
create type public.payment_status as enum ('pending', 'confirmed', 'cancelled');
create type public.alert_status as enum ('unread', 'handled', 'ignored');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_currency char(3) not null default 'CDF',
  timezone text not null default 'Africa/Kinshasa',
  phone_country char(2) not null default 'CD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name public.app_role_name not null unique,
  display_name text not null,
  hierarchy_level smallint not null unique,
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.role_change_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_member_id uuid references public.organization_members(id),
  target_member_id uuid not null references public.organization_members(id),
  old_role public.app_role_name not null,
  new_role public.app_role_name not null,
  changed_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  actor_member_id uuid references public.organization_members(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value jsonb not null,
  is_technical boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.organization_members(id),
  unique (organization_id, key)
);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create or replace function public.normalize_phone(input text)
returns text
language plpgsql
immutable
strict
as $$
declare
  digits text := regexp_replace(input, '[^0-9]', '', 'g');
begin
  if digits = '' then
    return null;
  elsif digits like '0%' and length(digits) between 9 and 10 then
    return '+243' || substring(digits from 2);
  elsif digits like '243%' then
    return '+' || digits;
  elsif input like '+%' then
    return '+' || digits;
  elsif length(digits) = 9 then
    return '+243' || digits;
  end if;

  return '+' || digits;
end;
$$;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  phone text not null,
  phone_normalized text generated always as (public.normalize_phone(phone)) stored,
  whatsapp text,
  whatsapp_normalized text generated always as (public.normalize_phone(whatsapp)) stored,
  residence text,
  building text,
  room text,
  zone_id uuid references public.delivery_zones(id),
  address_details text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  food_preferences text,
  allergies text,
  foods_to_avoid text,
  notes text,
  status public.customer_status not null default 'active',
  registered_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.organization_members(id),
  updated_by uuid references public.organization_members(id),
  archived_at timestamptz,
  check (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  unique (organization_id, phone_normalized)
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  price numeric(14,2) not null check (price > 0),
  currency char(3) not null default 'CDF',
  duration_value integer not null check (duration_value > 0),
  duration_unit public.duration_unit not null,
  service_days_count smallint not null check (service_days_count between 1 and 7),
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.organization_members(id),
  updated_by uuid references public.organization_members(id),
  archived_at timestamptz,
  unique (organization_id, name)
);

create table public.plan_service_days (
  plan_id uuid not null references public.plans(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  primary key (plan_id, weekday)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  plan_id uuid not null references public.plans(id),
  start_date date not null,
  end_date date not null,
  applied_plan_name text not null,
  applied_price numeric(14,2) not null check (applied_price > 0),
  applied_currency char(3) not null,
  applied_duration_value integer not null check (applied_duration_value > 0),
  applied_duration_unit public.duration_unit not null,
  plan_snapshot jsonb not null,
  admin_status public.subscription_admin_status not null default 'active',
  notes text,
  renewed_from_id uuid references public.subscriptions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.organization_members(id),
  updated_by uuid references public.organization_members(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  check (end_date >= start_date),
  check (renewed_from_id is null or renewed_from_id <> id)
);

create table public.subscription_service_days (
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  primary key (subscription_id, weekday)
);

create table public.subscription_pauses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  start_date date not null,
  end_date date,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.organization_members(id),
  resumed_at timestamptz,
  resumed_by uuid references public.organization_members(id),
  check (end_date is null or end_date >= start_date)
);

create unique index subscription_one_open_pause
on public.subscription_pauses(subscription_id)
where end_date is null;

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  subscription_id uuid not null references public.subscriptions(id),
  delivery_date date not null,
  customer_name text not null,
  phone text not null,
  residence text,
  building text,
  room text,
  zone_id uuid references public.delivery_zones(id),
  zone_name text,
  address_details text,
  plan_name text not null,
  status public.delivery_status not null default 'scheduled',
  scheduled_time time,
  assigned_to uuid references public.organization_members(id),
  note text,
  cancellation_reason text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.organization_members(id),
  unique (subscription_id, delivery_date)
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  display_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  subscription_id uuid not null references public.subscriptions(id),
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null,
  paid_at date not null,
  payment_method_id uuid not null references public.payment_methods(id),
  reference text,
  status public.payment_status not null default 'confirmed',
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.organization_members(id),
  updated_by uuid references public.organization_members(id),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.organization_members(id),
  cancellation_reason text
);

create unique index payments_reference_unique
on public.payments(organization_id, payment_method_id, reference)
where reference is not null and status <> 'cancelled';

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_type text not null,
  name text not null,
  days_before smallint not null check (days_before between 0 and 90),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, alert_type, days_before)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_type text not null,
  rule_id uuid references public.alert_rules(id),
  customer_id uuid references public.customers(id),
  subscription_id uuid references public.subscriptions(id),
  title text not null,
  body text not null,
  trigger_date date not null,
  status public.alert_status not null default 'unread',
  handled_at timestamptz,
  handled_by uuid references public.organization_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, subscription_id, trigger_date)
);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.organization_members(id),
  unique (organization_id, code)
);

create index customers_name_idx on public.customers(organization_id, lower(last_name), lower(first_name));
create index customers_whatsapp_idx on public.customers(organization_id, whatsapp_normalized);
create index subscriptions_customer_idx on public.subscriptions(customer_id, start_date desc);
create index subscriptions_expiration_idx on public.subscriptions(organization_id, admin_status, end_date);
create index deliveries_date_status_idx on public.deliveries(organization_id, delivery_date, status);
create index payments_subscription_idx on public.payments(subscription_id, status, paid_at);
create index alerts_status_date_idx on public.alerts(organization_id, status, trigger_date desc);
create index audit_logs_entity_idx on public.audit_logs(organization_id, entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger members_updated_at before update on public.organization_members for each row execute function public.set_updated_at();
create trigger app_settings_updated_at before update on public.app_settings for each row execute function public.set_updated_at();
create trigger delivery_zones_updated_at before update on public.delivery_zones for each row execute function public.set_updated_at();
create trigger customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger plans_updated_at before update on public.plans for each row execute function public.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger deliveries_updated_at before update on public.deliveries for each row execute function public.set_updated_at();
create trigger payments_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger alert_rules_updated_at before update on public.alert_rules for each row execute function public.set_updated_at();
create trigger alerts_updated_at before update on public.alerts for each row execute function public.set_updated_at();
create trigger message_templates_updated_at before update on public.message_templates for each row execute function public.set_updated_at();

commit;
