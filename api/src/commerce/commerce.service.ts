import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { isValidGstin, priceInvoice, rupeesInWords, supplyFromStates } from '@billflow/gst';
import { CashPaymentError, settleCash } from '../payments/cash';
import { buildUpiUri, upiQrSvg } from '@billflow/upi';
import { renderInvoicePdf } from '../invoices/render-pdf';
import { StorageService } from '../storage/storage.service';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthContext } from '../common/auth-context';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { MessagingSettingsService } from './messaging-settings.service';
import { PaymentsService } from '../payments/payments.service';
import { TenantRazorpayService } from '../payments/tenant-razorpay.service';
import {
  MetaWhatsAppSender,
  Msg91Sender,
  renderTemplate,
  ResendSender,
  SendResult,
  SmtpSender,
  TwilioSender,
  waMeLink,
} from './providers';

@Injectable()
export class CommerceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
    private readonly payments: PaymentsService,
    private readonly messaging: MessagingSettingsService,
    private readonly gateway: TenantRazorpayService,
    private readonly storage: StorageService,
  ) {}

  async createShare(auth: AuthContext, invoiceId: string, days = 30) {
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    const { data, error } = await client
      .from('invoice_shares')
      .insert({ tenant_id: tenantId, invoice_id: invoiceId, token, expires_at: expires })
      .select('token, expires_at')
      .single();
    raiseSupabase(error);
    return { ...data, url: `${this.publicOrigin()}/i/${data.token}` };
  }

  async revokeShare(auth: AuthContext, invoiceId: string) {
    const { error } = await this.supabase
      .userClient(auth.token)
      .from('invoice_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('invoice_id', invoiceId)
      .is('revoked_at', null);
    raiseSupabase(error);
    return { revoked: true };
  }

  async publicInvoice(token: string) {
    const { data, error } = await this.supabase.anonClient().rpc('get_shared_invoice', { p_token: token });
    raiseSupabase(error);
    if (!data) throw new NotFoundException('This link is invalid or has expired');
    await this.supabase.anonClient().rpc('record_share_view', { p_token: token });
    const branding = await this.supabase.anonClient().rpc('share_branding', { p_token: token });
    if (branding.data) Object.assign(data, branding.data);
    const upi = data.upi as { pa: string; pn: string; am: number; tn?: string; tr: string } | null;
    if (upi?.pa && upi.tr) {
      const input = { ...upi, cu: 'INR' as const };
      return { ...data, upi_uri: buildUpiUri(input), qr_svg: await upiQrSvg(input) };
    }
    return data;
  }

  async invoicePdf(auth: AuthContext, invoiceId: string) {
    const invoice = await this.loadInvoice(auth, invoiceId);
    let qr: Buffer | null = null;
    if (invoice.status !== 'paid' && invoice.status !== 'void') {
      try {
        const collect = await this.payments.collectUpi(auth, invoiceId);
        qr = Buffer.from(collect.qr_data_url.split(',')[1] ?? '', 'base64');
      } catch {
        qr = null;
      }
    }
    const buffer = await this.renderPdf(invoice, qr);
    const pdfUrl = await this.storage.putPdf(auth, String(invoice.tenant_id), invoiceId, buffer).catch(() => null);
    if (pdfUrl) {
      await this.supabase.userClient(auth.token).rpc('set_invoice_pdf_url', { p_invoice: invoiceId, p_url: pdfUrl });
    }
    const path = `${invoice.tenant_id}/${invoice.id}.pdf`;
    try {
      await this.supabase.serviceClient().storage.from('invoice-pdfs').upload(path, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });
    } catch {
      // Storage is optional in local Postgres. The download still returns the bytes.
    }
    return { buffer, filename: `${invoice.number}.pdf` };
  }

  async shareWhatsApp(auth: AuthContext, invoiceId: string) {
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const invoice = await this.loadInvoice(auth, invoiceId);
    const share = await this.createShare(auth, invoiceId);
    const text = `Invoice ${invoice.number} from ${invoice.seller_name} for INR ${invoice.total}. View it: ${share.url}`;
    const phone = String(invoice.buyer_phone || '');
    const cloud = await this.entitlements.hasFeature(auth, 'whatsapp_sharing');
    const click = await this.entitlements.hasFeature(auth, 'whatsapp_click_to_chat');
    if (!cloud && !click) await this.entitlements.assertFeature(auth, 'whatsapp_click_to_chat');
    const settings = await this.whatsappSecrets(tenantId);
    let result: SendResult | null = null;
    let status: 'sent' | 'failed' | 'skipped' = 'skipped';
    let errorMessage: string | null = null;
    if (cloud && settings?.enabled && settings.access_token && settings.phone_number_id && phone) {
      try {
        const sender = new MetaWhatsAppSender(
          settings.phone_number_id,
          settings.access_token,
          this.config.get<string>('WHATSAPP_TEMPLATE_NAME') || 'invoice_share',
        );
        result = await sender.send({
          to: phone,
          body: text,
          variables: { invoice_number: String(invoice.number), link: share.url, total: String(invoice.total) },
        });
        status = 'sent';
      } catch (error) {
        status = 'failed';
        errorMessage = error instanceof Error ? error.message : 'WhatsApp send failed';
      }
    }
    await client.from('message_logs').insert({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      customer_id: invoice.customer_id,
      channel: 'whatsapp',
      status,
      provider: result?.provider || 'wa.me',
      provider_id: result?.providerId || null,
      error: errorMessage,
      payload: { url: share.url },
    });
    return {
      status,
      error: errorMessage,
      url: share.url,
      wa_link: phone ? waMeLink(phone, text) : null,
    };
  }

  async whatsappSettings(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('whatsapp_settings')
      .select('tenant_id, phone_number_id, waba_id, enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    raiseSupabase(error);
    return data ?? { tenant_id: tenantId, phone_number_id: null, waba_id: null, enabled: false, token_set: false };
  }

  async saveWhatsapp(auth: AuthContext, body: { phone_number_id?: string; waba_id?: string; enabled?: boolean; access_token?: string }) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const patch: Record<string, unknown> = {
      tenant_id: tenantId,
      phone_number_id: body.phone_number_id,
      waba_id: body.waba_id,
      enabled: body.enabled ?? false,
    };
    if (body.access_token) patch.access_token = body.access_token;
    const { error } = await this.supabase.userClient(auth.token).from('whatsapp_settings').upsert(patch, { onConflict: 'tenant_id' });
    raiseSupabase(error);
    return this.whatsappSettings(auth);
  }

  async applyWebhookStatus(providerId: string, status: string) {
    const mapped = ['sent', 'delivered', 'read', 'failed'].includes(status) ? status : 'sent';
    const { error } = await this.supabase
      .serviceClient()
      .from('message_logs')
      .update({ status: mapped })
      .eq('provider_id', providerId);
    raiseSupabase(error);
    return { updated: true };
  }

  async gstr1(auth: AuthContext, from: string, to: string) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('gstr1_summary', { p_from: from, p_to: to });
    raiseSupabase(error);
    const rows = (data ?? []) as Array<Record<string, string | number>>;
    const header = 'hsn_sac,tax_rate,taxable_value,cgst,sgst,igst,total_tax';
    const lines = rows.map((row) =>
      [row.hsn_sac, row.tax_rate, row.taxable_value, row.cgst, row.sgst, row.igst, row.total_tax].join(','),
    );
    return `${header}\n${lines.join('\n')}\n`;
  }

  async creditNote(auth: AuthContext, invoiceId: string) {
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const original = await this.loadInvoice(auth, invoiceId);
    const { data: created, error } = await client
      .from('invoices')
      .insert({
        tenant_id: tenantId,
        customer_id: original.customer_id,
        document_type: 'credit_note',
        reference_invoice_id: invoiceId,
        supply_type: original.supply_type,
        place_of_supply: original.place_of_supply,
        notes: `Credit note for ${original.number}`,
      })
      .select('id, number')
      .single();
    raiseSupabase(error);
    const items = (original.items as Array<Record<string, unknown>>) ?? [];
    if (items.length) {
      const { error: itemError } = await client.from('invoice_items').insert(
        items.map((item, index) => ({
          tenant_id: tenantId,
          invoice_id: created.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount: item.discount ?? 0,
          tax_rate: item.tax_rate,
          hsn_sac: item.hsn_sac,
          unit: item.unit ?? 'NOS',
          sort_order: index + 1,
        })),
      );
      raiseSupabase(itemError);
    }
    return created;
  }

  async einvoiceStub(auth: AuthContext, invoiceId: string) {
    if (this.config.get('EINVOICE_STUB') !== 'success') {
      return {
        einvoice_status: 'not_generated',
        message: 'IRP/GSP is not connected. Implement EinvoiceProvider.generate() against your GSP when credentials are available.',
      };
    }
    const irn = randomBytes(16).toString('hex');
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('invoices')
      .update({
        irn,
        ack_no: `ACK${Date.now()}`,
        ack_date: new Date().toISOString(),
        signed_qr: 'stub-signed-qr',
        einvoice_status: 'generated',
      })
      .eq('id', invoiceId)
      .select('id, irn, ack_no, ack_date, einvoice_status')
      .single();
    raiseSupabase(error);
    return data;
  }

  validateGstin(gstin: string) {
    if (!isValidGstin(gstin)) throw new BadRequestException('GSTIN failed format or checksum validation');
    return { gstin: gstin.toUpperCase(), valid: true };
  }

  async schedules(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('reminder_schedules')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('offset_days');
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async replaceSchedules(auth: AuthContext, rows: Array<{ offset_days: number; channel: string; template: string; enabled?: boolean }>) {
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { error: deleteError } = await client.from('reminder_schedules').delete().eq('tenant_id', tenantId);
    raiseSupabase(deleteError);
    if (!rows.length) return { data: [] };
    const { data, error } = await client
      .from('reminder_schedules')
      .insert(rows.map((row) => ({ ...row, tenant_id: tenantId, enabled: row.enabled ?? true })))
      .select('*');
    raiseSupabase(error);
    return { data };
  }

  async jobs(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('reminder_jobs')
      .select('id, invoice_id, channel, status, attempts, last_error, sent_at, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100);
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async runReminders() {
    const client = this.supabase.serviceClient();
    const { data: enqueued, error } = await client.rpc('enqueue_due_reminders');
    raiseSupabase(error);
    await client.rpc('mark_overdue_invoices');
    const { data: jobs, error: jobError } = await client
      .from('reminder_jobs')
      .select('id, tenant_id, invoice_id, channel, attempts, schedule:reminder_schedules(template)')
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .limit(25);
    raiseSupabase(jobError);
    let sent = 0;
    let failed = 0;
    for (const job of jobs ?? []) {
      if (!(await this.entitlements.hasFeatureForTenant(job.tenant_id, 'auto_reminders'))) {
        await client.from('reminder_jobs').update({ status: 'skipped', last_error: 'FEATURE_LOCKED:auto_reminders' }).eq('id', job.id);
        continue;
      }
      const outcome = await this.deliverJob(job);
      if (outcome === 'sent') sent += 1;
      else failed += 1;
    }
    return { enqueued: enqueued ?? 0, sent, failed };
  }

  async products(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase.userClient(auth.token).from('products').select('*').eq('tenant_id', tenantId).order('name');
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async product(auth: AuthContext, id: string) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Product not found');
    return data;
  }

  async saveProduct(auth: AuthContext, body: Record<string, unknown>, id?: string) {
    await this.entitlements.assertFeature(auth, 'product_catalog');
    if (!id) await this.entitlements.assertUnderLimit(auth, 'max_products');
    if (body.stock !== undefined && body.stock !== null) await this.entitlements.assertFeature(auth, 'stock_tracking');
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const query = id
      ? client.from('products').update(body).eq('id', id).select('*').single()
      : client.from('products').insert({ ...body, tenant_id: tenantId }).select('*').single();
    const { data, error } = await query;
    raiseSupabase(error);
    return data;
  }

  async posSettings(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase.userClient(auth.token).from('pos_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
    raiseSupabase(error);
    return data ?? { tenant_id: tenantId, default_tax_rate: 18, receipt_footer: 'Thank you.', paper_width: 80 };
  }

  async savePosSettings(auth: AuthContext, body: { default_tax_rate: number; receipt_footer: string; paper_width: number }) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('pos_settings')
      .upsert({ tenant_id: tenantId, ...body }, { onConflict: 'tenant_id' })
      .select('*')
      .single();
    raiseSupabase(error);
    return data;
  }

  async checkout(auth: AuthContext, body: {
    customer_id?: string;
    walk_in_name?: string;
    lines: Array<{ description: string; quantity: number; unit_price: number; gst_rate: number; product_id?: string; discount?: number; hsn_sac?: string; unit?: string }>;
    method: 'cash' | 'upi' | 'card' | 'razorpay';
    online_mode?: 'checkout' | 'link';
    tendered?: number;
    change_given?: number;
    place_of_supply?: string;
  }) {
    await this.entitlements.assertFeature(auth, 'pos');
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data: tenant, error: tenantError } = await client
      .from('tenants')
      .select('state_code, upi_vpa, upi_payee_name, legal_name, name')
      .eq('id', tenantId)
      .single();
    raiseSupabase(tenantError);
    if (body.method === 'upi' && !tenant.upi_vpa) {
      throw new BadRequestException('Add a UPI VPA under Settings, then Payments');
    }
    if (body.method === 'cash') {
      const priced = priceInvoice(
        body.lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unit_price, gstRate: line.gst_rate })),
        supplyFromStates(tenant.state_code, body.place_of_supply || tenant.state_code),
      );
      try {
        settleCash({
          due: Number(priced.total),
          tendered: body.tendered ?? Number.NaN,
          changeGiven: body.change_given,
          allowPartial: false,
        });
      } catch (error) {
        if (error instanceof CashPaymentError) throw new BadRequestException(error.message);
        throw error;
      }
    }
    let customerId = body.customer_id;
    if (!customerId) {
      const { data: created, error } = await client
        .from('customers')
        .insert({ tenant_id: tenantId, name: body.walk_in_name || 'Walk-in', billing_state_code: tenant.state_code })
        .select('id')
        .single();
      raiseSupabase(error);
      customerId = created.id;
    }
    const { data: customer, error: customerError } = await client.from('customers').select('billing_state_code').eq('id', customerId).single();
    raiseSupabase(customerError);
    const supply = supplyFromStates(tenant.state_code, body.place_of_supply || customer.billing_state_code);
    const { data, error } = await client.rpc('pos_checkout', {
      p_customer_id: customerId,
      p_lines: body.lines,
      p_method: body.method,
      p_supply: supply,
      p_place: body.place_of_supply || customer.billing_state_code || tenant.state_code,
      p_tendered: body.tendered ?? null,
      p_change: body.change_given ?? null,
    });
    raiseSupabase(error);
    if (body.method === 'razorpay') {
      const opened = await this.gateway.startPos(auth, {
        invoice_id: data.invoice_id,
        payment_id: data.payment_id,
        number: data.number,
        total: Number(data.total),
      }, body.online_mode === 'link' ? 'link' : 'checkout');
      return { ...data, supply, razorpay: opened };
    }
    const payee = tenant.upi_payee_name || tenant.legal_name || tenant.name;
    const upi = body.method === 'upi'
      ? {
          pa: tenant.upi_vpa as string,
          pn: payee as string,
          am: data.total as number,
          tn: `Invoice ${data.number}`,
          tr: data.upi_tr as string,
          cu: 'INR' as const,
        }
      : null;
    return {
      ...data,
      supply,
      upi_uri: upi ? buildUpiUri(upi) : null,
      qr_svg: upi ? await upiQrSvg(upi) : null,
    };
  }

  private async deliverJob(job: {
    id: string;
    tenant_id: string;
    invoice_id: string;
    channel: string;
    attempts: number;
    schedule: { template: string } | { template: string }[] | null;
  }) {
    const client = this.supabase.serviceClient();
    const template = Array.isArray(job.schedule) ? job.schedule[0]?.template : job.schedule?.template;
    const { data: invoice } = await client.from('invoices').select('number, total, due_at, customer_id').eq('id', job.invoice_id).single();
    const { data: customer } = await client.from('customers').select('name, email, phone, reminder_opt_out').eq('id', invoice?.customer_id).maybeSingle();
    if (!invoice || customer?.reminder_opt_out) {
      await client.from('reminder_jobs').update({ status: 'skipped', last_error: 'opt-out or missing invoice' }).eq('id', job.id);
      return 'failed';
    }
    const body = renderTemplate(template || 'Invoice {{number}} for {{total}}', {
      customer_name: customer?.name || '',
      number: String(invoice.number),
      total: String(invoice.total),
      due_date: invoice.due_at ? String(invoice.due_at).slice(0, 10) : '',
    });
    try {
      const sender = await this.senderFor(job.tenant_id, job.channel);
      if (!sender) {
        await client.from('reminder_jobs').update({ status: 'skipped', last_error: 'provider not configured' }).eq('id', job.id);
        return 'failed';
      }
      const to = job.channel === 'email' ? customer?.email : customer?.phone;
      if (!to) throw new Error('customer has no destination');
      const result = await sender.send({ to, body, subject: `Invoice ${invoice.number}` });
      await client.from('reminder_jobs').update({ status: 'sent', provider_id: result.providerId, sent_at: new Date().toISOString() }).eq('id', job.id);
      await client.from('message_logs').insert({
        tenant_id: job.tenant_id,
        invoice_id: job.invoice_id,
        customer_id: invoice.customer_id,
        channel: job.channel,
        status: 'sent',
        provider: result.provider,
        provider_id: result.providerId,
      });
      return 'sent';
    } catch (error) {
      const attempts = (job.attempts ?? 0) + 1;
      const message = error instanceof Error ? error.message : 'send failed';
      const delayMinutes = 15 * 2 ** Math.min(attempts, 6);
      await client.from('reminder_jobs').update({
        attempts,
        last_error: message,
        status: attempts >= 5 ? 'failed' : 'pending',
        next_attempt_at: new Date(Date.now() + delayMinutes * 60000).toISOString(),
      }).eq('id', job.id);
      return 'failed';
    }
  }

  private async senderFor(tenantId: string, channel: string) {
    if (channel === 'whatsapp') {
      const settings = await this.whatsappSecrets(tenantId);
      if (!settings?.access_token || !settings.phone_number_id) return null;
      return new MetaWhatsAppSender(settings.phone_number_id, settings.access_token, this.config.get('WHATSAPP_TEMPLATE_NAME') || 'invoice_share');
    }
    const { data } = await this.supabase.serviceClient().from('messaging_settings').select('sms_provider, email_provider, msg91_sender_id, msg91_dlt_template_id, twilio_from, smtp_host, smtp_port, smtp_user, resend_from').eq('tenant_id', tenantId).maybeSingle();
    const secrets = await this.messaging.secretsFor(tenantId);
    if (channel === 'sms') {
      const provider = data?.sms_provider || 'none';
      if (provider === 'msg91') {
        const key = secrets.msg91_auth_key || this.config.get<string>('MSG91_AUTH_KEY');
        if (!key) return null;
        return new Msg91Sender(key, data?.msg91_sender_id || this.config.get('MSG91_SENDER_ID') || 'BILFLW', data?.msg91_dlt_template_id || this.config.get('MSG91_DLT_TEMPLATE_ID') || '');
      }
      if (provider === 'twilio') {
        const sid = secrets.twilio_account_sid || this.config.get<string>('TWILIO_ACCOUNT_SID');
        const token = secrets.twilio_auth_token || this.config.get<string>('TWILIO_AUTH_TOKEN');
        const from = data?.twilio_from || this.config.get<string>('TWILIO_FROM');
        if (!sid || !token || !from) return null;
        return new TwilioSender(sid, token, from);
      }
      return null;
    }
    const emailProvider = data?.email_provider || (this.config.get('RESEND_API_KEY') ? 'resend' : this.config.get('SMTP_HOST') ? 'smtp' : 'none');
    if (emailProvider === 'resend') {
      const key = secrets.resend_api_key || this.config.get<string>('RESEND_API_KEY');
      const from = data?.resend_from || this.config.get<string>('RESEND_FROM');
      if (!key || !from) return null;
      return new ResendSender(key, from);
    }
    if (emailProvider === 'smtp') {
      const host = data?.smtp_host || this.config.get<string>('SMTP_HOST');
      if (!host) return null;
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({
        host,
        port: data?.smtp_port || Number(this.config.get('SMTP_PORT') || 587),
        auth: {
          user: data?.smtp_user || this.config.get<string>('SMTP_USER'),
          pass: secrets.smtp_pass || this.config.get<string>('SMTP_PASS'),
        },
      });
      return new SmtpSender(transport, data?.resend_from || this.config.get('SMTP_FROM') || 'invoices@billflow.com');
    }
    return null;
  }

  private async whatsappSecrets(tenantId: string) {
    const { data } = await this.supabase.serviceClient().from('whatsapp_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
    if (data?.access_token) return data;
    const envToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    if (!envToken) return data;
    return { ...data, access_token: envToken, phone_number_id: data?.phone_number_id || this.config.get('WHATSAPP_PHONE_NUMBER_ID'), enabled: true };
  }

  private async loadInvoice(auth: AuthContext, invoiceId: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('invoices')
      .select('*, items:invoice_items(*), customer:customers(id, name, phone, email, gstin, billing_state_code)')
      .eq('id', invoiceId)
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Invoice not found');
    const { data: tenant } = await this.supabase.userClient(auth.token).from('tenants').select('name, legal_name, locale, logo_url, default_template').eq('id', data.tenant_id).maybeSingle();
    const customer = data.customer as { id?: string; name?: string; phone?: string; gstin?: string } | null;
    return {
      ...data,
      customer_id: data.customer_id as string,
      seller_name: tenant?.legal_name || tenant?.name || 'billflow',
      locale: tenant?.locale || 'en',
      logo_url: tenant?.logo_url || null,
      default_template: tenant?.default_template || 'classic',
      buyer_phone: customer?.phone,
      items: data.items,
    };
  }

  private async renderPdf(invoice: Record<string, unknown>, qr: Buffer | null = null) {
    const words = rupeesInWords(Number(invoice.total ?? 0));
    let logo: Buffer | null = null;
    const logoUrl = typeof invoice.logo_url === 'string' ? invoice.logo_url : '';
    if (logoUrl.startsWith('https://')) {
      try {
        const response = await fetch(logoUrl);
        if (response.ok) logo = Buffer.from(await response.arrayBuffer());
      } catch {
        logo = null;
      }
    }
    const pdf = await renderInvoicePdf({
      number: String(invoice.number ?? ''),
      total: invoice.total as number,
      locale: String(invoice.locale || 'en'),
      template_key: (invoice.template_key as string | null) ?? null,
      default_template: (invoice.default_template as string | null) ?? null,
      logo,
      cgst_total: invoice.cgst_total as number,
      sgst_total: invoice.sgst_total as number,
      igst_total: invoice.igst_total as number,
      items: (invoice.items as Array<Record<string, unknown>>) ?? [],
      qr,
    }, words);
    return pdf;
  }

  private publicOrigin() {
    return (this.config.get<string>('PUBLIC_APP_URL') || 'http://127.0.0.1:4318').replace(/\/$/, '');
  }
}
