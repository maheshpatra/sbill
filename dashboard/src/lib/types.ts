export type Role = "owner" | "admin" | "billing" | "member";
export type InvoiceStatus = "draft" | "sent" | "paid" | "partially_paid" | "overdue" | "void";

export interface Page<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface Me {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    tenant_id: string | null;
    role: Role | null;
  } | null;
  memberships: Array<{
    id: string;
    role: Role;
    status: string;
    tenant: { id: string; name: string; slug: string; plan: string; status: string } | null;
  }>;
  claims: { tenant_id: string | null; user_role: string | null };
}

export interface Tenant {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string;
  plan: string;
  status: string;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  upi_vpa: string | null;
  upi_payee_name: string | null;
  currency: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  gstin: string | null;
  notes: string | null;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number | string;
  unit_price: number | string;
  tax_rate: number | string;
  hsn_sac: string | null;
  line_subtotal: number | string;
  cgst_amount: number | string;
  sgst_amount: number | string;
  igst_amount: number | string;
  tax_amount: number | string;
  line_total: number | string;
}

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  amount: number | string;
  tax: number | string;
  discount: number | string;
  total: number | string;
  currency: string;
  supply_type: "intra" | "inter";
  place_of_supply: string | null;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  notes: string | null;
  terms: string | null;
  customer_id: string;
  customer?: { id: string; name: string; email: string | null; gstin: string | null } | null;
  items?: InvoiceItem[];
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number | string;
  method: string;
  status: string;
  transaction_ref: string | null;
  paid_at: string | null;
  notes: string | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  price_monthly: number | string;
  price_yearly: number | string;
  currency: string;
  features: Record<string, number | boolean | null>;
  limits?: Record<string, number | null>;
  sort_order?: number;
  price_monthly_paise?: number;
  price_yearly_paise?: number;
}

export interface Entitlements {
  tenant_id: string;
  plan: string;
  plan_name: string;
  subscription_status: string | null;
  over_limit_grace?: boolean;
  features: Record<string, number | boolean | null>;
  usage: {
    invoices_this_month: number;
    customers: number;
    members: number;
    products?: number;
    custom_domains?: number;
  };
}

export interface PlatformInvoice {
  id: string;
  number: string;
  total_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  created_at: string;
}

export interface Member {
  id: string;
  user_id: string;
  role: Role;
  status: string;
  user: { id: string; email: string | null; name: string | null } | null;
}
