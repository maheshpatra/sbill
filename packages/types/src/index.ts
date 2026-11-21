/** Stable entitlement keys stored on plan_features and returned by GET /entitlements. */
export const FEATURE_KEYS = [
  'basic_invoices',
  'public_site',
  'gst_invoices',
  'product_catalog',
  'whatsapp_click_to_chat',
  'whatsapp_sharing',
  'upi_qr',
  'cash_payments',
  'auto_reminders',
  'online_payments',
  'pos',
  'multi_user_roles',
  'stock_tracking',
  'reporting_dashboard',
  'custom_templates',
  'custom_domains',
  'custom_domain',
  'webhooks',
  'audit_log',
  'api_access',
  'remove_branding',
  'priority_support',
  'invoices_per_month',
  'customers',
  'members',
  'max_users',
  'max_invoices_per_month',
  'max_customers',
  'max_products',
  'max_custom_domains',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Numeric limits are null when the plan is unlimited. */
export interface PlanFeatures {
  invoices_per_month: number | null;
  customers: number | null;
  members: number | null;
  custom_domain: boolean;
  upi_qr: boolean;
  gst_invoices: boolean;
  webhooks: boolean;
  audit_log: boolean;
  remove_branding: boolean;
  api_access: boolean;
  public_site: boolean;
  [key: string]: boolean | number | null | undefined;
}

export interface EntitlementUsage {
  invoices_this_month: number;
  customers: number;
  members: number;
  products: number;
  custom_domains: number;
}

export interface Entitlements {
  tenant_id: string;
  plan: string;
  plan_name: string;
  subscription_status: string | null;
  over_limit_grace?: boolean;
  features: PlanFeatures;
  usage: EntitlementUsage;
}

export type MemberRole = 'owner' | 'admin' | 'billing' | 'member';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'void';

export type BillingCycle = 'monthly' | 'yearly';

export type PaymentMethod = 'upi' | 'bank_transfer' | 'cash' | 'card' | 'cheque' | 'other';

export interface Page<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}
