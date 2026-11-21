import { HttpException, HttpStatus } from '@nestjs/common';

const REQUIRED_PLAN: Record<string, string> = {
  gst_invoices: 'starter',
  product_catalog: 'starter',
  whatsapp_click_to_chat: 'starter',
  upi_qr: 'free',
  auto_reminders: 'growth',
  online_payments: 'growth',
  pos: 'growth',
  multi_user_roles: 'growth',
  stock_tracking: 'growth',
  reporting_dashboard: 'growth',
  webhooks: 'growth',
  audit_log: 'growth',
  api_access: 'growth',
  custom_templates: 'business',
  custom_domains: 'business',
  custom_domain: 'business',
  whatsapp_sharing: 'business',
  remove_branding: 'business',
  priority_support: 'business',
};

export function requiredPlan(feature: string): string {
  return REQUIRED_PLAN[feature] ?? 'business';
}

export class FeatureLockedException extends HttpException {
  constructor(feature: string) {
    const plan = requiredPlan(feature);
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Payment Required',
        code: 'FEATURE_LOCKED',
        message: `${feature} is included on the ${plan} plan`,
        feature,
        required_plan: plan,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class LimitReachedException extends HttpException {
  constructor(feature: string) {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        code: 'LIMIT_REACHED',
        message: `Plan limit reached for ${feature}`,
        feature,
        required_plan: requiredPlan(feature),
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
