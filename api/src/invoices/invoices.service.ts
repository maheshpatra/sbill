import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { priceInvoice, SupplyType } from '@billflow/gst';
import { AuthContext } from '../common/auth-context';
import { pageOf, pageWindow } from '../common/pagination';
import { raiseSupabase } from '../common/supabase-error';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateInvoiceDto, InvoiceQueryDto, UpdateInvoiceDto } from './dto';

const INVOICE_SELECT = '*, customer:customers(id, name, email, gstin), items:invoice_items(*)';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async templates(auth: AuthContext) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('list_invoice_templates');
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async list(auth: AuthContext, query: InvoiceQueryDto) {
    const { page, limit, from, to } = pageWindow(query);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    let request = this.supabase
      .userClient(auth.token)
      .from('invoices')
      .select(INVOICE_SELECT, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (query.status) request = request.eq('status', query.status);
    if (query.customer_id) request = request.eq('customer_id', query.customer_id);
    if (query.q) request = request.ilike('number', `%${query.q.replace(/[%_]/g, '')}%`);
    const { data, error, count } = await request.range(from, to);
    raiseSupabase(error);
    return pageOf(data, count, page, limit);
  }

  async get(auth: AuthContext, id: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('id', id)
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Invoice not found');
    return data;
  }

  async create(auth: AuthContext, dto: CreateInvoiceDto) {
    await this.entitlements.assertUnderLimit(auth, 'invoices_per_month');
    if ((dto.supply_type ?? 'intra') === 'inter' || dto.items.some((item) => (item.tax_rate ?? 0) > 0 || item.tax_rate_id)) {
      await this.entitlements.assertFeature(auth, 'gst_invoices');
    }
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const client = this.supabase.userClient(auth.token);
    const supply: SupplyType = dto.supply_type ?? 'intra';
    const lines = [];
    for (const item of dto.items) {
      let rate = item.tax_rate ?? 0;
      if (item.tax_rate_id) {
        const { data: tax, error } = await client
          .from('tax_rates')
          .select('rate')
          .eq('id', item.tax_rate_id)
          .maybeSingle();
        raiseSupabase(error);
        if (!tax) throw new BadRequestException('Tax rate not found');
        rate = Number(tax.rate);
      }
      lines.push({ ...item, tax_rate: rate });
    }

    // Server-side totals. The database trigger recomputes the same formula and is what gets stored.
    try {
      priceInvoice(
        lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unit_price, gstRate: line.tax_rate })),
        supply,
        dto.discount ?? 0,
      );
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid invoice totals');
    }

    const { data: created, error } = await client
      .from('invoices')
      .insert({
        tenant_id: tenantId,
        customer_id: dto.customer_id,
        supply_type: supply,
        discount: dto.discount ?? 0,
        notes: dto.notes ?? null,
        terms: dto.terms ?? null,
        due_at: dto.due_at ?? null,
        place_of_supply: dto.place_of_supply ?? null,
        currency: (dto.currency ?? 'INR').toUpperCase(),
        template_key: dto.template_key ?? null,
      })
      .select('id')
      .single();
    raiseSupabase(error);

    const { error: itemError } = await client.from('invoice_items').insert(
      lines.map((line, index) => ({
        tenant_id: tenantId,
        invoice_id: created.id,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        tax_rate_id: line.tax_rate_id ?? null,
        tax_rate: line.tax_rate,
        hsn_sac: line.hsn_sac ?? null,
        sort_order: index + 1,
      })),
    );
    if (itemError) {
      await client.from('invoices').delete().eq('id', created.id);
      raiseSupabase(itemError);
    }
    return this.get(auth, created.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateInvoiceDto) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('invoices')
      .update(dto)
      .eq('id', id)
      .select(INVOICE_SELECT)
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Invoice not found');
    return data;
  }

  async send(auth: AuthContext, id: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('invoices')
      .update({ status: 'sent' })
      .eq('id', id)
      .select(INVOICE_SELECT)
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Invoice not found');
    return data;
  }

  async void(auth: AuthContext, id: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('invoices')
      .update({ status: 'void' })
      .eq('id', id)
      .select(INVOICE_SELECT)
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Invoice not found');
    return data;
  }
}
