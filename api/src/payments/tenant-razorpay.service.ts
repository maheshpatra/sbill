import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { linkQrSvg } from '@billflow/upi';
import { waMeLink } from '../commerce/providers';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SupabaseService } from '../supabase/supabase.service';
import { decryptSecret, encryptSecret, verifyCheckoutSignature, verifyWebhookSignature } from './secret-box';

interface RazorpayAccount {
  tenantId: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

@Injectable()
export class TenantRazorpayService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async settings(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('tenant_razorpay')
      .select('key_id, enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    raiseSupabase(error);
    return { key_id: data?.key_id ?? null, enabled: Boolean(data?.enabled), connected: Boolean(data?.key_id) };
  }

  async save(auth: AuthContext, body: { key_id: string; key_secret?: string; webhook_secret?: string; enabled?: boolean }) {
    await this.requireAdmin(auth);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const key = this.masterKey();
    const existing = await this.account(tenantId);
    const keySecret = body.key_secret || existing?.keySecret;
    const webhookSecret = body.webhook_secret || existing?.webhookSecret;
    if (!keySecret || !webhookSecret) throw new BadRequestException('Key secret and webhook secret are required the first time');
    const { error } = await this.supabase.serviceClient().from('tenant_razorpay').upsert({
      tenant_id: tenantId,
      key_id: body.key_id.trim(),
      key_secret_enc: encryptSecret(keySecret, key),
      webhook_secret_enc: encryptSecret(webhookSecret, key),
      enabled: body.enabled ?? true,
    });
    raiseSupabase(error);
    return this.settings(auth);
  }

  async test(auth: AuthContext) {
    await this.requireAdmin(auth);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const account = await this.requireAccount(tenantId);
    const response = await fetch('https://api.razorpay.com/v1/payments?count=1', { headers: { Authorization: this.basic(account) } });
    if (!response.ok) throw new BadRequestException(`Razorpay rejected the keys (${response.status}). Use test-mode keys while you are trying this.`);
    return { ok: true };
  }

  async startInvoice(auth: AuthContext, invoiceId: string, mode: 'checkout' | 'link', amount?: number) {
    await this.entitlements.assertFeature(auth, 'online_payments');
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    await this.voidOtherPending(auth, invoiceId);
    const { data: invoice, error } = await client.from('invoices').select('id, number, total, status').eq('id', invoiceId).maybeSingle();
    raiseSupabase(error);
    if (!invoice || invoice.status === 'void' || invoice.status === 'paid') throw new BadRequestException('This invoice is not open');
    const { data: succeeded, error: paidError } = await client.from('payments').select('amount').eq('invoice_id', invoiceId).eq('status', 'succeeded');
    raiseSupabase(paidError);
    const received = (succeeded ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
    const balance = Math.round((Number(invoice.total) - received) * 100) / 100;
    const due = amount ?? balance;
    if (due <= 0 || due - balance > 0.001) throw new BadRequestException('Amount must be within the outstanding balance');
    const { data: payment, error: insertError } = await client
      .from('payments')
      .insert({ tenant_id: tenantId, invoice_id: invoiceId, amount: due, method: 'razorpay', status: 'pending', recorded_by: auth.id })
      .select('id, amount')
      .single();
    raiseSupabase(insertError);
    return this.openGateway(tenantId, invoiceId, String(invoice.number), payment.id, Number(payment.amount), mode, auth);
  }

  async startPos(auth: AuthContext, sale: { invoice_id: string; payment_id: string; number: string; total: number }, mode: 'checkout' | 'link') {
    await this.entitlements.assertFeature(auth, 'online_payments');
    const tenantId = await this.supabase.currentTenantId(auth.token);
    return this.openGateway(tenantId, sale.invoice_id, sale.number, sale.payment_id, sale.total, mode, auth);
  }

  async verifyCheckout(auth: AuthContext, paymentId: string, orderId: string, razorpayPaymentId: string, signature: string) {
    const payment = await this.pendingPayment(auth, paymentId);
    const account = await this.requireAccount(payment.tenant_id);
    if (!verifyCheckoutSignature(orderId, razorpayPaymentId, signature, account.keySecret)) {
      throw new UnauthorizedException('invalid Razorpay checkout signature');
    }
    return this.markCaptured(payment.id, razorpayPaymentId, orderId, payment.provider_link_id);
  }

  async refund(auth: AuthContext, paymentId: string) {
    await this.entitlements.assertFeature(auth, 'online_payments');
    const { data: payment, error } = await this.supabase.userClient(auth.token).from('payments').select('*').eq('id', paymentId).maybeSingle();
    raiseSupabase(error);
    if (!payment || payment.method !== 'razorpay' || payment.status !== 'succeeded') throw new BadRequestException('Only a captured Razorpay payment can be refunded');
    const account = await this.requireAccount(payment.tenant_id);
    const response = await fetch(`https://api.razorpay.com/v1/payments/${payment.provider_payment_id}/refund`, {
      method: 'POST',
      headers: { Authorization: this.basic(account), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(Number(payment.amount) * 100) }),
    });
    if (!response.ok) throw new BadRequestException(`Razorpay refund failed (${response.status})`);
    const { error: updateError } = await this.supabase.serviceClient().from('payments').update({ status: 'refunded' }).eq('id', paymentId);
    raiseSupabase(updateError);
    return { refunded: true, payment_id: paymentId };
  }

  async handleWebhook(tenantId: string, raw: Buffer, signature: string, eventId: string, body: RazorpayEvent) {
    const account = await this.account(tenantId);
    if (!account || !verifyWebhookSignature(raw, signature, account.webhookSecret)) {
      throw new UnauthorizedException('invalid Razorpay webhook signature');
    }
    const fresh = await this.claimEvent(tenantId, eventId);
    if (!fresh) return { duplicate: true };
    const paymentEntity = body.payload?.payment?.entity;
    const linkId = body.payload?.payment_link?.entity?.id ?? null;
    const intentId = paymentEntity?.notes?.payment_intent_id || body.payload?.payment_link?.entity?.notes?.payment_intent_id;
    if ((body.event === 'payment.captured' || body.event === 'payment_link.paid') && paymentEntity?.id && intentId) {
      await this.markCaptured(intentId, paymentEntity.id, paymentEntity.order_id ?? null, linkId);
      return { activated: true };
    }
    if (body.event === 'payment.failed' && intentId) {
      await this.supabase.serviceClient().from('payments').update({ status: 'failed', provider_payment_id: paymentEntity?.id ?? null }).eq('id', intentId).eq('status', 'pending');
      return { failed: true };
    }
    if (body.event === 'refund.processed' && paymentEntity?.id) {
      await this.supabase.serviceClient().from('payments').update({ status: 'refunded' }).eq('provider_payment_id', paymentEntity.id);
      return { refunded: true };
    }
    return { ignored: true };
  }

  async voidPending(auth: AuthContext, paymentId: string) {
    const client = this.supabase.userClient(auth.token);
    const { data, error } = await client.from('payments').select('id, method, status').eq('id', paymentId).maybeSingle();
    raiseSupabase(error);
    if (!data || data.status !== 'pending') return { voided: false };
    if (data.method === 'upi_qr') return this.supabase.userClient(auth.token).rpc('void_upi_payment', { p_payment: paymentId }).then((result) => {
      raiseSupabase(result.error);
      return result.data;
    });
    const { error: updateError } = await client.from('payments').update({ status: 'void' }).eq('id', paymentId).eq('status', 'pending');
    raiseSupabase(updateError);
    return { voided: true, payment_id: paymentId };
  }

  private async openGateway(tenantId: string, invoiceId: string, number: string, paymentId: string, amount: number, mode: 'checkout' | 'link', auth: AuthContext) {
    const account = await this.requireAccount(tenantId);
    const notes = { tenant_id: tenantId, invoice_id: invoiceId, payment_intent_id: paymentId };
    const paise = Math.round(amount * 100);
    if (mode === 'checkout') {
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { Authorization: this.basic(account), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: paise, currency: 'INR', receipt: paymentId.slice(0, 40), notes }),
      });
      if (!response.ok) throw new BadRequestException(`Razorpay order failed (${response.status})`);
      const order = (await response.json()) as { id: string };
      await this.supabase.serviceClient().from('payments').update({ provider_order_id: order.id }).eq('id', paymentId);
      return { mode, payment_id: paymentId, key_id: account.keyId, order_id: order.id, amount_paise: paise, currency: 'INR' };
    }
    const response = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: { Authorization: this.basic(account), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: paise, currency: 'INR', description: `Invoice ${number}`, notes, notify: { sms: false, email: false } }),
    });
    if (!response.ok) throw new BadRequestException(`Razorpay payment link failed (${response.status})`);
    const link = (await response.json()) as { id: string; short_url: string };
    await this.supabase.serviceClient().from('payments').update({ provider_link_id: link.id }).eq('id', paymentId);
    const text = `Invoice ${number} is ready to pay: ${link.short_url}`;
    const { data: invoice } = await this.supabase.userClient(auth.token).from('invoices').select('customer:customers(phone)').eq('id', invoiceId).maybeSingle();
    const phone = (invoice?.customer as { phone?: string } | { phone?: string }[] | null);
    const customerPhone = Array.isArray(phone) ? phone[0]?.phone : phone?.phone;
    return {
      mode,
      payment_id: paymentId,
      url: link.short_url,
      qr_svg: await linkQrSvg(link.short_url),
      wa_link: customerPhone ? waMeLink(customerPhone, text) : null,
      sms_body: text,
    };
  }

  private async markCaptured(paymentId: string, razorpayPaymentId: string, orderId: string | null, linkId: string | null) {
    const service = this.supabase.serviceClient();
    const { data: existing, error } = await service.from('payments').select('id, status, provider_payment_id').eq('id', paymentId).maybeSingle();
    raiseSupabase(error);
    if (!existing) throw new NotFoundException('Payment intent not found');
    if (existing.status === 'succeeded') return { duplicate: true, payment_id: paymentId };
    const { error: updateError } = await service.from('payments').update({
      status: 'succeeded',
      transaction_ref: razorpayPaymentId,
      provider_payment_id: razorpayPaymentId,
      provider_order_id: orderId,
      provider_link_id: linkId,
      paid_at: new Date().toISOString(),
    }).eq('id', paymentId).eq('status', 'pending');
    raiseSupabase(updateError);
    return { activated: true, payment_id: paymentId };
  }

  private async claimEvent(tenantId: string, eventId: string) {
    const { error } = await this.supabase.serviceClient().from('tenant_gateway_events').insert({ tenant_id: tenantId, event_id: eventId }).select('event_id').maybeSingle();
    if (error?.code === '23505') return false;
    raiseSupabase(error);
    return true;
  }

  private async pendingPayment(auth: AuthContext, paymentId: string) {
    const { data, error } = await this.supabase.userClient(auth.token).from('payments').select('id, tenant_id, status, provider_link_id').eq('id', paymentId).maybeSingle();
    raiseSupabase(error);
    if (!data || data.status !== 'pending') throw new NotFoundException('Pending Razorpay payment not found');
    return data as { id: string; tenant_id: string; provider_link_id: string | null };
  }

  private async voidOtherPending(auth: AuthContext, invoiceId: string) {
    const { error } = await this.supabase
      .userClient(auth.token)
      .from('payments')
      .update({ status: 'void' })
      .eq('invoice_id', invoiceId)
      .eq('status', 'pending')
      .in('method', ['upi_qr', 'razorpay']);
    raiseSupabase(error);
  }

  private async account(tenantId: string): Promise<RazorpayAccount | null> {
    const { data, error } = await this.supabase.serviceClient().from('tenant_razorpay').select('key_id, key_secret_enc, webhook_secret_enc, enabled').eq('tenant_id', tenantId).maybeSingle();
    raiseSupabase(error);
    if (!data?.enabled) return null;
    const key = this.masterKey();
    return {
      tenantId,
      keyId: data.key_id,
      keySecret: decryptSecret(data.key_secret_enc, key),
      webhookSecret: decryptSecret(data.webhook_secret_enc, key),
    };
  }

  private async requireAccount(tenantId: string) {
    const account = await this.account(tenantId);
    if (!account) throw new BadRequestException('Connect Razorpay under Settings, then Payments');
    return account;
  }

  private masterKey() {
    const raw = this.config.get<string>('PAYMENT_SECRETS_KEY');
    if (!raw) throw new BadRequestException('PAYMENT_SECRETS_KEY is not configured');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new BadRequestException('PAYMENT_SECRETS_KEY must be 32 bytes of base64');
    return key;
  }

  private basic(account: RazorpayAccount) {
    return `Basic ${Buffer.from(`${account.keyId}:${account.keySecret}`).toString('base64')}`;
  }

  private async requireAdmin(auth: AuthContext) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('current_user_role');
    raiseSupabase(error);
    if (data !== 'owner' && data !== 'admin') throw new ForbiddenException('Owner or admin role is required');
  }
}

interface RazorpayEvent {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; notes?: { payment_intent_id?: string } } };
    payment_link?: { entity?: { id?: string; notes?: { payment_intent_id?: string } } };
  };
}
