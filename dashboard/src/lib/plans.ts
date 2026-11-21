/** Display names for the plan that first includes a feature. Caps are not listed here. */
export const FEATURE_PLAN: Record<string, string> = {
  basic_invoices: "Free",
  public_site: "Free",
  upi_qr: "Free",
  cash_payments: "Free",
  gst_invoices: "Starter",
  product_catalog: "Starter",
  whatsapp_click_to_chat: "Starter",
  auto_reminders: "Growth",
  online_payments: "Growth",
  pos: "Growth",
  multi_user_roles: "Growth",
  stock_tracking: "Growth",
  reporting_dashboard: "Growth",
  webhooks: "Growth",
  audit_log: "Growth",
  api_access: "Growth",
  custom_templates: "Business",
  custom_domains: "Business",
  whatsapp_sharing: "Business",
  remove_branding: "Business",
  priority_support: "Business",
};

export function requiredPlanName(feature: string, fromApi?: string | null) {
  if (fromApi) return fromApi.charAt(0).toUpperCase() + fromApi.slice(1);
  return FEATURE_PLAN[feature] ?? "a higher";
}
