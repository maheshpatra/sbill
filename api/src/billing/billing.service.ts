import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';
import { SubscribeDto } from './dto';
import { platformTax, RazorpayProvider, StripeStubProvider, verifyRazorpaySignature } from './providers';

const OPEN = ['trialing', 'active', 'past_due', 'paused'];

interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  price_monthly_paise: number;
  price_yearly_paise: number;
  currency: string;
  features: Record<string, unknown>;
  limits: Record<string, unknown>;
  sort_order: number;
  active: boolean;
}

interface CheckoutRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  billing_cycle: 'monthly' | 'yearly';
  amount_paise: number;
  provider: string;
  provider_order_id: string | null;
  status: string;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async plans() {
    const { data, error } = await this.supabase
      .anonClient()
      .from('plans')
      .select('id, code, name, description, price_monthly, price_yearly, price_monthly_paise, price_yearly_paise, currency, features, limits, sort_order, active')
      .eq('is_public', true)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async subscription(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('tenant_subscriptions')
      .select('*, plan:plans!tenant_subscriptions_plan_id_fkey(code, name, sort_order)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    raiseSupabase(error);
    const rows = data ?? [];
    return {
      current: rows.find((row) => OPEN.includes(row.status)) ?? null,
      data: rows,
    };
  }

  async invoices(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('platform_invoices')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async checkout(auth: AuthContext, dto: SubscribeDto & { provider?: 'razorpay' | 'stripe' }) {
    await this.requireAdmin(auth);
    const providerName = dto.provider ?? 'razorpay';
    if (providerName === 'stripe') {
      void new StripeStubProvider();
      return { provider: 'stripe', status: 'not_connected', message: 'Stripe is a stub. Use Razorpay for INR checkout.' };
    }
    const plan = await this.planByCode(dto.plan_code);
    const taxable = dto.billing_cycle === 'yearly' ? plan.price_yearly_paise : plan.price_monthly_paise;
    if (taxable > 0 && !this.platformRazorpayConfigured()) {
      this.billingNotConfigured();
    }
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const tenant = await this.tenantFor(auth, tenantId);
    const tax = platformTax(taxable, this.sellerState(), tenant.state_code);
    const checkoutId = randomBytes(8).toString('hex');
    let orderId = `manual_${checkoutId}`;
    let keyId: string | null = null;
    const razorpay = this.razorpay();
    if (razorpay && taxable > 0) {
      let order;
      try {
        order = await razorpay.createOrder({
          amountPaise: tax.total,
          receipt: checkoutId,
          notes: { tenant_id: tenantId, plan: plan.code },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/invalid api key/i.test(message)) this.billingNotConfigured();
        throw error;
      }
      orderId = order.orderId;
      keyId = this.config.get<string>('RAZORPAY_KEY_ID') ?? null;
    }
    const { data, error } = await this.supabase.userClient(auth.token).rpc('record_billing_checkout', {
      p_plan_id: plan.id,
      p_billing_cycle: dto.billing_cycle,
      p_amount_paise: tax.total,
      p_provider: razorpay && taxable > 0 ? 'razorpay' : 'manual',
      p_provider_order_id: orderId,
    });
    raiseSupabase(error);
    const recorded = data as { id: string };

    if (!razorpay || taxable === 0) {
      if (this.config.get('BILLING_DEV_ACTIVATE') === 'true' || taxable === 0) {
        await this.activateAsUser(auth, orderId, `dev_${checkoutId}`, tax);
        return { provider: 'manual', status: 'active', plan: plan.code, checkout_id: recorded.id };
      }
      return {
        provider: 'manual',
        status: 'pending',
      checkout_id: recorded.id,
      message: 'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, then pay the order.',
    };
    }
    return {
      provider: 'razorpay',
      status: 'pending',
      key_id: keyId,
      order_id: orderId,
      amount_paise: tax.total,
      currency: 'INR',
      checkout_id: recorded.id,
      plan: plan.code,
    };
  }

  async schedule(auth: AuthContext, dto: SubscribeDto) {
    await this.requireAdmin(auth);
    const plan = await this.planByCode(dto.plan_code);
    const current = await this.subscription(auth);
    const currentSort = (current.current?.plan as { sort_order?: number } | null)?.sort_order ?? 0;
    if (plan.sort_order > currentSort) {
      throw new HttpException(
        {
          statusCode: 402,
          error: 'Payment Required',
          code: 'CHECKOUT_REQUIRED',
          message: 'Upgrades are charged now. Start checkout for this plan.',
          required_plan: plan.code,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    const { data, error } = await this.supabase.userClient(auth.token).rpc('schedule_platform_plan', { p_plan_id: plan.id });
    raiseSupabase(error);
    if (!data) throw new NotFoundException('No open subscription');
    const scheduled = data as { current_period_end: string | null };
    return {
      scheduled: true,
      plan: plan.code,
      applies_on: scheduled.current_period_end,
      message: 'The lower plan starts when the current period ends. Until then the current features stay on. If usage is over the new limits, new records are blocked and existing ones stay readable.',
    };
  }

  async cancel(auth: AuthContext) {
    await this.requireAdmin(auth);
    const { data, error } = await this.supabase.userClient(auth.token).rpc('cancel_platform_subscription');
    raiseSupabase(error);
    if (!data) throw new NotFoundException('No open subscription');
    return data;
  }

  async handleRazorpay(raw: Buffer, signature: string, eventId: string, body: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } } }) {
    const secret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET') ?? '';
    if (!verifyRazorpaySignature(raw, signature, secret)) {
      throw new UnauthorizedException('invalid webhook signature');
    }
    const fresh = await this.claimEvent('razorpay', eventId, body);
    if (!fresh) return { duplicate: true };
    const payment = body.payload?.payment?.entity;
    const orderId = payment?.order_id;
    if (!orderId) return { ignored: true };
    if (body.event === 'payment.captured' || payment?.status === 'captured') {
      return this.activateOrder(orderId, payment?.id ?? eventId);
    }
    if (body.event === 'payment.failed') return this.markPastDue(orderId);
    return { ignored: true };
  }

  async activateOrder(orderId: string, paymentId: string) {
    const service = this.supabase.serviceClient();
    const { data: checkout, error } = await service
      .from('billing_checkouts')
      .select('*')
      .eq('provider_order_id', orderId)
      .maybeSingle();
    raiseSupabase(error);
    if (!checkout) throw new NotFoundException('Checkout not found');
    const row = checkout as CheckoutRow;
    if (row.status === 'paid') return { activated: false, duplicate: true };

    const { data: plan, error: planError } = await service.from('plans').select('*').eq('id', row.plan_id).single();
    raiseSupabase(planError);
    const chosen = plan as PlanRow;
    const tenant = await this.tenant(row.tenant_id);
    const taxable = row.billing_cycle === 'yearly' ? chosen.price_yearly_paise : chosen.price_monthly_paise;
    const tax = platformTax(taxable, this.sellerState(), tenant.state_code);
    const start = new Date();
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + (row.billing_cycle === 'yearly' ? 365 : 30));
    const periodStart = start.toISOString().slice(0, 10);
    const periodEnd = end.toISOString().slice(0, 10);

    const { data: existing, error: existingError } = await service
      .from('tenant_subscriptions')
      .select('id')
      .eq('tenant_id', row.tenant_id)
      .in('status', OPEN)
      .maybeSingle();
    raiseSupabase(existingError);

    const patch = {
      plan_id: chosen.id,
      pending_plan_id: null,
      status: 'active',
      billing_cycle: row.billing_cycle,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: false,
      grace_until: null,
      over_limit_grace: false,
      provider: row.provider,
      provider_subscription_id: paymentId,
      price_paise: taxable,
    };
    const saved = existing
      ? await service.from('tenant_subscriptions').update(patch).eq('id', existing.id).select('id').single()
      : await service.from('tenant_subscriptions').insert({ ...patch, tenant_id: row.tenant_id }).select('id').single();
    raiseSupabase(saved.error);

    const { error: tenantError } = await service.from('tenants').update({ plan: chosen.code, status: 'active' }).eq('id', row.tenant_id);
    raiseSupabase(tenantError);
    const { error: paidError } = await service
      .from('billing_checkouts')
      .update({ status: 'paid', provider_payment_id: paymentId })
      .eq('id', row.id);
    raiseSupabase(paidError);
    const { error: invoiceError } = await service.from('platform_invoices').insert({
      tenant_id: row.tenant_id,
      subscription_id: saved.data.id,
      number: `PF-${start.getUTCFullYear()}-${row.id.slice(0, 8)}`,
      taxable_paise: taxable,
      cgst_paise: tax.cgst,
      sgst_paise: tax.sgst,
      igst_paise: tax.igst,
      total_paise: tax.total,
      gst_rate: 18,
      seller_gstin: this.config.get<string>('PLATFORM_GSTIN') || null,
      buyer_gstin: tenant.gstin,
      place_of_supply: tax.place,
      provider_payment_id: paymentId,
    });
    raiseSupabase(invoiceError);
    return { activated: true, plan: chosen.code, invoice_total_paise: tax.total };
  }

  async markPastDue(orderId: string) {
    const service = this.supabase.serviceClient();
    const { data: checkout, error } = await service.from('billing_checkouts').select('tenant_id').eq('provider_order_id', orderId).maybeSingle();
    raiseSupabase(error);
    if (!checkout) return { updated: false };
    const grace = new Date(Date.now() + 7 * 86400000).toISOString();
    const { error: updateError } = await service
      .from('tenant_subscriptions')
      .update({ status: 'past_due', grace_until: grace })
      .eq('tenant_id', checkout.tenant_id)
      .in('status', OPEN);
    raiseSupabase(updateError);
    await service.from('billing_checkouts').update({ status: 'failed' }).eq('provider_order_id', orderId);
    return { updated: true, grace_until: grace };
  }

  async applyTransitions() {
    const { data, error } = await this.supabase.serviceClient().rpc('apply_plan_transitions');
    raiseSupabase(error);
    return { transitioned: data ?? 0 };
  }

  private async claimEvent(provider: string, eventId: string, payload: unknown) {
    const { error } = await this.supabase.serviceClient().from('billing_events').insert({ provider, event_id: eventId, payload }).select('event_id').maybeSingle();
    if (error?.code === '23505') return false;
    raiseSupabase(error);
    return true;
  }

  private async planByCode(code: string) {
    const { data, error } = await this.supabase.anonClient().from('plans').select('*').eq('code', code).eq('active', true).maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Unknown plan');
    return data as PlanRow;
  }

  private async tenantFor(auth: AuthContext, id: string) {
    const { data, error } = await this.supabase.userClient(auth.token).from('tenants').select('id, state_code, gstin, plan').eq('id', id).single();
    raiseSupabase(error);
    return data as { id: string; state_code: string | null; gstin: string | null; plan: string };
  }

  private async activateAsUser(
    auth: AuthContext,
    orderId: string,
    paymentId: string,
    tax: { cgst: number; sgst: number; igst: number; total: number; place: string | null },
  ) {
    const taxable = tax.total - tax.cgst - tax.sgst - tax.igst;
    const { error } = await this.supabase.userClient(auth.token).rpc('activate_platform_checkout', {
      p_order_id: orderId,
      p_payment_id: paymentId,
      p_taxable_paise: taxable,
      p_cgst_paise: tax.cgst,
      p_sgst_paise: tax.sgst,
      p_igst_paise: tax.igst,
      p_total_paise: tax.total,
      p_place_of_supply: tax.place,
      p_seller_gstin: this.config.get<string>('PLATFORM_GSTIN') || null,
    });
    raiseSupabase(error);
  }

  private async tenant(id: string) {
    const { data, error } = await this.supabase.serviceClient().from('tenants').select('id, state_code, gstin, plan').eq('id', id).single();
    raiseSupabase(error);
    return data as { id: string; state_code: string | null; gstin: string | null; plan: string };
  }

  private platformRazorpayConfigured() {
    const keyId = this.config.get<string>('RAZORPAY_KEY_ID')?.trim() ?? '';
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET')?.trim() ?? '';
    if (!keyId || !keySecret) return false;
    if (keyId.startsWith('your-') || keySecret.startsWith('your-')) return false;
    return true;
  }

  private billingNotConfigured(): never {
    throw new HttpException(
      {
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'BILLING_NOT_CONFIGURED',
        message: 'Platform Razorpay keys are not configured.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private razorpay() {
    if (!this.platformRazorpayConfigured()) return null;
    return new RazorpayProvider(
      this.config.get<string>('RAZORPAY_KEY_ID')!.trim(),
      this.config.get<string>('RAZORPAY_KEY_SECRET')!.trim(),
    );
  }

  private sellerState() {
    return this.config.get<string>('PLATFORM_STATE_CODE') || '27';
  }

  private async requireAdmin(auth: AuthContext) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('current_user_role');
    raiseSupabase(error);
    if (data !== 'owner' && data !== 'admin') throw new ForbiddenException('Owner or admin role is required');
  }
}
