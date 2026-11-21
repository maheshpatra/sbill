import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CashPaymentError, settleCash } from './cash';
import { randomBytes } from 'crypto';
import { buildUpiUri, formatUpiAmount, upiQrDataUrl, upiQrSvg } from '@billflow/upi';
import { AuthContext } from '../common/auth-context';
import { pageOf, pageWindow } from '../common/pagination';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';
import { WebhookDispatcher } from '../webhooks/dispatcher.service';
import { CreatePaymentDto, MarkPaidDto, PaymentQueryDto } from './dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  async list(auth: AuthContext, query: PaymentQueryDto) {
    const { page, limit, from, to } = pageWindow(query);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    let request = this.supabase
      .userClient(auth.token)
      .from('payments')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (query.invoice_id) request = request.eq('invoice_id', query.invoice_id);
    if (query.status) request = request.eq('status', query.status);
    const { data, error, count } = await request.range(from, to);
    raiseSupabase(error);
    return pageOf(data, count, page, limit);
  }

  async get(auth: AuthContext, id: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('payments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Payment not found');
    return data;
  }

  async create(auth: AuthContext, dto: CreatePaymentDto) {
    return this.markPaid(auth, dto.invoice_id, dto);
  }

  /**
   * Records a succeeded payment. A database trigger marks the invoice paid
   * once succeeded payments cover the total.
   */
  async markPaid(auth: AuthContext, invoiceId: string, dto: MarkPaidDto) {
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data: invoice, error } = await client
      .from('invoices')
      .select('id, tenant_id, number, status, total, currency')
      .eq('id', invoiceId)
      .maybeSingle();
    raiseSupabase(error);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'void' || invoice.status === 'paid') {
      throw new BadRequestException('This invoice is not open for a payment');
    }

    const { data: succeeded, error: paidError } = await client
      .from('payments')
      .select('amount')
      .eq('invoice_id', invoiceId)
      .eq('status', 'succeeded');
    raiseSupabase(paidError);
    const received = (succeeded ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
    const balance = Math.round((Number(invoice.total) - received) * 100) / 100;

    let amount = dto.amount;
    let tendered: number | null = null;
    let changeGiven: number | null = null;
    if (dto.method === 'cash') {
      try {
        const settlement = settleCash({
          due: balance,
          tendered: dto.amount_tendered ?? dto.amount,
          changeGiven: dto.change_given,
          allowPartial: true,
        });
        amount = settlement.applied;
        tendered = settlement.tendered;
        changeGiven = settlement.changeGiven;
      } catch (error) {
        if (error instanceof CashPaymentError) throw new BadRequestException(error.message);
        throw error;
      }
    } else if (dto.amount - balance > 0.001) {
      throw new BadRequestException('amount is above the outstanding balance');
    }

    const { data: payment, error: payError } = await client
      .from('payments')
      .insert({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        amount,
        method: dto.method,
        status: 'succeeded',
        transaction_ref: dto.transaction_ref ?? null,
        notes: dto.notes ?? null,
        paid_at: dto.paid_at ?? new Date().toISOString(),
        tendered,
        change_amount: changeGiven,
        amount_tendered: tendered,
        change_given: changeGiven,
        recorded_by: auth.id,
      })
      .select('*')
      .single();
    raiseSupabase(payError);

    const { data: updated, error: reloadError } = await client
      .from('invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', invoiceId)
      .single();
    raiseSupabase(reloadError);

    const event = updated.status === 'paid' ? 'invoice.paid' : 'payment.succeeded';
    await this.webhooks.dispatch(auth, event, { invoice: updated, payment });
    return { payment, invoice: updated };
  }

  /**
   * Basic invoice UPI QR is on every plan. The pending payment row is the intent.
   * Confirmation is manual: this does not ask a bank or a gateway.
   */
  async collectUpi(auth: AuthContext, invoiceId: string, amount?: number) {
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data: invoice, error } = await client
      .from('invoices')
      .select('id, number, total, currency, status')
      .eq('id', invoiceId)
      .maybeSingle();
    raiseSupabase(error);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'void' || invoice.status === 'paid') {
      throw new BadRequestException('This invoice is not open for collection');
    }

    const { data: succeeded, error: paidError } = await client
      .from('payments')
      .select('amount')
      .eq('invoice_id', invoiceId)
      .eq('status', 'succeeded');
    raiseSupabase(paidError);
    const received = (succeeded ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
    const balance = Math.round((Number(invoice.total) - received) * 100) / 100;
    const due = amount ?? balance;
    if (!Number.isFinite(due) || due <= 0 || due - balance > 0.001) {
      throw new BadRequestException('Amount must be within the outstanding balance');
    }
    const amountText = formatUpiAmount(due.toFixed(2));

    const { data: tenant, error: tenantError } = await client
      .from('tenants')
      .select('name, legal_name, upi_vpa, upi_payee_name')
      .eq('id', tenantId)
      .maybeSingle();
    raiseSupabase(tenantError);
    if (!tenant?.upi_vpa) throw new BadRequestException('Add a UPI VPA under Settings, then Payments');
    const payee = tenant.upi_payee_name || tenant.legal_name || tenant.name;

    const { data: existing, error: existingError } = await client
      .from('payments')
      .select('id, amount, transaction_ref, status')
      .eq('invoice_id', invoiceId)
      .eq('method', 'upi_qr')
      .eq('status', 'pending')
      .eq('amount', Number(amountText))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    raiseSupabase(existingError);

    let payment = existing;
    if (!payment) {
      const tr = `BF${randomBytes(8).toString('hex')}`;
      const { data: created, error: insertError } = await client
        .from('payments')
        .insert({
          tenant_id: tenantId,
          invoice_id: invoiceId,
          amount: Number(amountText),
          method: 'upi_qr',
          status: 'pending',
          transaction_ref: tr,
        })
        .select('id, amount, transaction_ref, status')
        .single();
      raiseSupabase(insertError);
      payment = created;
    }

    const input = {
      pa: tenant.upi_vpa as string,
      pn: payee as string,
      am: payment.amount as number,
      tn: `Invoice ${invoice.number}`,
      tr: payment.transaction_ref as string,
      cu: 'INR' as const,
    };
    return {
      payment_id: payment.id,
      invoice_id: invoice.id,
      number: invoice.number,
      amount: payment.amount,
      balance,
      currency: invoice.currency ?? 'INR',
      tr: payment.transaction_ref,
      upi_uri: buildUpiUri(input),
      qr_svg: await upiQrSvg(input),
      qr_data_url: await upiQrDataUrl(input),
    };
  }

  async confirmUpi(auth: AuthContext, paymentId: string, utr?: string) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('confirm_upi_payment', {
      p_payment: paymentId,
      p_utr: utr ?? null,
    });
    raiseSupabase(error);
    return data;
  }

  async voidUpi(auth: AuthContext, paymentId: string) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('void_upi_payment', { p_payment: paymentId });
    raiseSupabase(error);
    return data;
  }
}
