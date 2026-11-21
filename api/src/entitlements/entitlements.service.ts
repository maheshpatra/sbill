import { Injectable } from '@nestjs/common';
import { Entitlements, PlanFeatures } from '@billflow/types';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';
import { entitlementCache } from './cache';
import { FeatureLockedException, LimitReachedException } from './feature-locked';

const LIMITS: Record<string, string> = {
  invoices_per_month: 'max_invoices_per_month',
  customers: 'max_customers',
  members: 'max_users',
  max_products: 'max_products',
  max_custom_domains: 'max_custom_domains',
  max_users: 'max_users',
  max_invoices_per_month: 'max_invoices_per_month',
  max_customers: 'max_customers',
};

@Injectable()
export class EntitlementsService {
  constructor(private readonly supabase: SupabaseService) {}

  async forUser(auth: AuthContext): Promise<Entitlements> {
    const store = entitlementCache.getStore();
    const cached = store?.get(auth.token);
    if (cached) return cached;

    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await client.rpc('tenant_entitlements', { p_tenant: tenantId });
    raiseSupabase(error);
    const payload = (data ?? {}) as {
      plan?: string;
      plan_name?: string;
      subscription_status?: string | null;
      features?: PlanFeatures;
      over_limit_grace?: boolean;
    };

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [invoices, customers, members, products, domains] = await Promise.all([
      client.from('invoices').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).neq('status', 'void').gte('created_at', monthStart.toISOString()),
      client.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      client.from('memberships').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active'),
      client.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      client.from('tenant_domains').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    ]);
    raiseSupabase(invoices.error);
    raiseSupabase(customers.error);
    raiseSupabase(members.error);
    raiseSupabase(products.error);
    raiseSupabase(domains.error);

    const entitlements: Entitlements = {
      tenant_id: tenantId,
      plan: payload.plan ?? 'free',
      plan_name: payload.plan_name ?? 'Free',
      subscription_status: payload.subscription_status ?? null,
      features: (payload.features ?? {}) as PlanFeatures,
      over_limit_grace: Boolean(payload.over_limit_grace),
      usage: {
        invoices_this_month: invoices.count ?? 0,
        customers: customers.count ?? 0,
        members: members.count ?? 0,
        products: products.count ?? 0,
        custom_domains: domains.count ?? 0,
      },
    };
    store?.set(auth.token, entitlements);
    return entitlements;
  }

  async hasFeature(auth: AuthContext, feature: string): Promise<boolean> {
    const entitlements = await this.forUser(auth);
    return entitlements.features[this.alias(feature)] === true;
  }

  async hasFeatureForTenant(tenantId: string, feature: string): Promise<boolean> {
    const { data, error } = await this.supabase.serviceClient().rpc('has_feature', { p_tenant: tenantId, p_key: feature });
    raiseSupabase(error);
    return Boolean(data);
  }

  async assertFeature(auth: AuthContext, feature: string) {
    if (!(await this.hasFeature(auth, feature))) throw new FeatureLockedException(this.alias(feature));
    return this.forUser(auth);
  }

  async assertUnderLimit(auth: AuthContext, feature: string) {
    const entitlements = await this.forUser(auth);
    const key = LIMITS[feature] ?? feature;
    const limit = entitlements.features[key];
    if (entitlements.over_limit_grace) throw new LimitReachedException(key);
    if (typeof limit !== 'number') return entitlements;
    const usage = this.usageFor(entitlements, key);
    if (usage >= limit) throw new LimitReachedException(key);
    return entitlements;
  }

  private alias(feature: string) {
    if (feature === 'custom_domain') return 'custom_domains';
    return feature;
  }

  private usageFor(entitlements: Entitlements, key: string) {
    if (key === 'max_invoices_per_month') return entitlements.usage.invoices_this_month;
    if (key === 'max_customers') return entitlements.usage.customers;
    if (key === 'max_users') return entitlements.usage.members;
    if (key === 'max_products') return entitlements.usage.products;
    if (key === 'max_custom_domains') return entitlements.usage.custom_domains;
    return 0;
  }
}
