export type AppRole = 'root' | 'admin' | 'manager' | 'staff';

export type CustomerStatus = 'active' | 'inactive' | 'former_customer';
export type SubscriptionAdminStatus = 'pending' | 'active' | 'suspended' | 'cancelled';
export type SubscriptionEffectiveStatus =
  | SubscriptionAdminStatus
  | 'expiring_soon'
  | 'expires_today'
  | 'expired';
export type DeliveryStatus =
  | 'scheduled'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'cancelled';
export type PaymentStatus = 'pending' | 'confirmed' | 'cancelled';
export type AlertStatus = 'unread' | 'handled' | 'ignored';

export interface CurrentMember {
  id: string;
  organizationId: string;
  userId: string;
  displayName: string;
  email: string | null;
  role: AppRole;
  permissions: string[];
}

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  normalizedPhone: string;
  whatsapp: string | null;
  residence: string | null;
  building: string | null;
  room: string | null;
  zoneId: string | null;
  zoneName: string | null;
  addressDetails: string | null;
  foodPreferences: string | null;
  allergies: string | null;
  foodsToAvoid: string | null;
  notes: string | null;
  status: CustomerStatus;
  createdAt: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  durationValue: number;
  durationUnit: 'day' | 'week' | 'month';
  serviceDaysCount: number;
  serviceWeekdays: number[];
  isActive: boolean;
}

export interface SubscriptionSummary {
  id: string;
  customerId: string;
  customerName: string;
  planName: string;
  startDate: string;
  endDate: string;
  price: number;
  currency: string;
  adminStatus: SubscriptionAdminStatus;
  effectiveStatus: SubscriptionEffectiveStatus;
  daysUntilExpiration: number;
  amountPaid: number;
  amountRemaining: number;
  paymentState: 'unpaid' | 'partial' | 'paid';
}

export interface Delivery {
  id: string;
  customerId: string;
  subscriptionId: string;
  deliveryDate: string;
  customerName: string;
  phone: string;
  residence: string | null;
  building: string | null;
  room: string | null;
  zoneName: string | null;
  planName: string;
  status: DeliveryStatus;
}

export interface PaymentItem {
  id: string;
  customerId: string;
  subscriptionId: string;
  customerName: string;
  amount: number;
  currency: string;
  paidAt: string;
  methodName: string;
  reference: string | null;
  status: PaymentStatus;
  comment: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export interface AlertItem {
  id: string;
  title: string;
  body: string;
  status: AlertStatus;
  alertType: string;
  triggerDate: string;
  customerId: string | null;
  subscriptionId: string | null;
  customerName: string | null;
  whatsapp: string | null;
}

export interface DashboardMetrics {
  totalCustomers: number;
  activeCustomers: number;
  activeSubscriptions: number;
  expiringSubscriptions: number;
  expiredSubscriptions: number;
  newSubscriptions: number;
  deliveriesToday: number;
  deliveredToday: number;
  pendingPayments: number;
  confirmedRevenue: number;
}
