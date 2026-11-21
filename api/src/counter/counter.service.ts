import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildUpiUri, upiQrSvg } from '@billflow/upi';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';
import { label, labels } from './labels';
import { draftFromOcrText, PurchaseDraft } from './ocr';
import { parseVoiceTranscript, VoiceLine } from './voice';

export interface SyncSale {
  client_id: string;
  customer_id?: string;
  device_id?: string;
  notes?: string;
  lines: Array<{
    product_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    gst_rate?: number;
    unit?: string;
    discount?: number;
  }>;
  payments?: Array<{
    client_id: string;
    method: string;
    amount: number;
    amount_tendered?: number;
    change_given?: number;
    paid_at?: string;
    transaction_ref?: string;
  }>;
}

export interface ReminderPlan {
  channel: 'whatsapp' | 'sms' | 'email';
  before_days: number[];
  on_due: boolean;
  after_days: number[];
  template?: string;
}

@Injectable()
export class CounterService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async sync(auth: AuthContext, sales: SyncSale[], deviceId?: string) {
    const payload = sales.map((sale) => ({ ...sale, device_id: sale.device_id ?? deviceId ?? null }));
    const { data, error } = await this.supabase.userClient(auth.token).rpc('sync_offline_sales', { p_sales: payload });
    raiseSupabase(error);
    return { results: data ?? [] };
  }

  tiles(auth: AuthContext, categoryId?: string) {
    return this.rpc(auth, 'pos_tiles', categoryId ? { p_category: categoryId } : { p_category: null });
  }

  async purchases(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('purchases')
      .select('id, supplier, bill_date, photo_ref, notes, taxable, tax, total, created_at, lines:purchase_lines(id, product_id, description, quantity, unit_price, gst_rate, tax_amount, line_total, sort_order)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async savePurchase(auth: AuthContext, body: Record<string, unknown>) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('save_purchase', { p_body: body });
    raiseSupabase(error);
    return data;
  }

  async categories(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('product_categories')
      .select('id, name, sort_order')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true });
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async saveCategory(auth: AuthContext, body: { name: string; sort_order?: number }, id?: string) {
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const row = { name: body.name, sort_order: body.sort_order ?? 0 };
    const query = id
      ? client.from('product_categories').update(row).eq('id', id).select('id, name, sort_order').single()
      : client.from('product_categories').insert({ ...row, tenant_id: tenantId }).select('id, name, sort_order').single();
    const { data, error } = await query;
    raiseSupabase(error);
    return data;
  }

  async deleteCategory(auth: AuthContext, id: string) {
    const { error } = await this.supabase.userClient(auth.token).from('product_categories').delete().eq('id', id);
    raiseSupabase(error);
    return { deleted: true };
  }

  morning(auth: AuthContext) {
    return this.rpc(auth, 'morning_summary');
  }

  async events(auth: AuthContext, invoiceId: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('invoice_events')
      .select('id, invoice_id, kind, metadata, created_at')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true });
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async reminderPlan(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('reminder_schedules')
      .select('offset_days, channel, template, enabled')
      .eq('tenant_id', tenantId)
      .eq('enabled', true);
    raiseSupabase(error);
    const rows = data ?? [];
    const channel = (rows[0]?.channel ?? 'whatsapp') as ReminderPlan['channel'];
    const same = rows.filter((row) => row.channel === channel);
    return {
      channel,
      before_days: same.filter((row) => row.offset_days < 0).map((row) => Math.abs(row.offset_days)).sort((a, b) => a - b),
      on_due: same.some((row) => row.offset_days === 0),
      after_days: same.filter((row) => row.offset_days > 0).map((row) => row.offset_days).sort((a, b) => a - b),
      template: same[0]?.template ?? label('en', 'reminder'),
    };
  }

  async saveReminderPlan(auth: AuthContext, plan: ReminderPlan) {
    const client = this.supabase.userClient(auth.token);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data: tenant, error: tenantError } = await client.from('tenants').select('locale').eq('id', tenantId).maybeSingle();
    raiseSupabase(tenantError);
    const template = plan.template?.trim() || label(tenant?.locale, 'reminder');
    const offsets = [
      ...plan.before_days.map((day) => -Math.abs(day)),
      ...(plan.on_due ? [0] : []),
      ...plan.after_days.map((day) => Math.abs(day)),
    ];
    const { error: deleteError } = await client.from('reminder_schedules').delete().eq('tenant_id', tenantId).eq('channel', plan.channel);
    raiseSupabase(deleteError);
    if (offsets.length) {
      const { error } = await client.from('reminder_schedules').insert(
        offsets.map((offset) => ({ tenant_id: tenantId, offset_days: offset, channel: plan.channel, template, enabled: true })),
      );
      raiseSupabase(error);
    }
    return this.reminderPlan(auth);
  }

  async createLedgerLink(auth: AuthContext, customerId: string) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('create_customer_ledger_link', { p_customer: customerId });
    raiseSupabase(error);
    const row = data as { token: string };
    return { ...row, url: `${this.origin()}/ledger/${row.token}` };
  }

  revokeLedgerLink(auth: AuthContext, customerId: string) {
    return this.rpc(auth, 'revoke_customer_ledger_link', { p_customer: customerId });
  }

  async publicLedger(token: string) {
    const ledger = await this.ledger(token);
    return this.withUpi(ledger);
  }

  async publicLedgerUpi(token: string) {
    const ledger = await this.withUpi(await this.ledger(token));
    return {
      balance: ledger.balance,
      upi_uri: ledger.upi_uri,
      qr_svg: ledger.qr_svg,
      razorpay_available: ledger.razorpay_available,
    };
  }

  async parseVoice(auth: AuthContext, body: { text?: string; audio_base64?: string; locale?: string }) {
    let transcript = body.text?.trim() ?? '';
    let provider = 'rules';
    if (!transcript && body.audio_base64) {
      transcript = await this.transcribe(body.audio_base64);
      provider = this.config.get('SPEECH_PROVIDER') || 'openai';
    }
    if (!transcript) throw new NotFoundException('Send a transcript or an audio clip');
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase.userClient(auth.token).from('products').select('id, name, price, unit').eq('tenant_id', tenantId).eq('active', true);
    raiseSupabase(error);
    const lines: VoiceLine[] = parseVoiceTranscript(transcript, data ?? []);
    return { locale: body.locale === 'bn' ? 'bn' : 'en', provider, transcript, lines };
  }

  async parseBill(body: { image_base64?: string; text?: string; filename?: string }) {
    if (body.text?.trim()) return draftFromOcrText(body.text, 'text');
    if (!body.image_base64) throw new NotFoundException('Send image_base64 or text');
    const providerName = this.config.get<string>('OCR_PROVIDER') || 'openai';
    const key = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (providerName === 'stub') return draftFromOcrText(this.config.get('OCR_STUB_TEXT') || 'Supplier: Sample\nRice  1  10', 'stub');
    if (!key || key.startsWith('your-')) this.ocrNotConfigured();
    const text = await this.openAiBill(body.image_base64, key);
    const draft: PurchaseDraft = draftFromOcrText(text, providerName);
    return draft;
  }

  dictionary(locale?: string) {
    return { locale: locale === 'bn' ? 'bn' : 'en', labels: labels(locale) };
  }

  private async ledger(token: string) {
    const { data, error } = await this.supabase.anonClient().rpc('get_customer_ledger', { p_token: token });
    raiseSupabase(error);
    if (!data) throw new NotFoundException('This ledger link is invalid or has been revoked');
    return data as {
      shop: { name: string; upi_vpa: string | null; upi_payee_name: string | null };
      balance: number;
      razorpay_available: boolean;
    };
  }

  private async withUpi<T extends { shop: { name: string; upi_vpa: string | null; upi_payee_name: string | null }; balance: number }>(ledger: T) {
    const amount = Number(ledger.balance);
    if (!ledger.shop.upi_vpa || amount <= 0) return { ...ledger, upi_uri: null, qr_svg: null };
    const input = {
      pa: ledger.shop.upi_vpa,
      pn: ledger.shop.upi_payee_name || ledger.shop.name,
      am: amount,
      tn: 'Ledger balance',
      tr: `ledger${Date.now()}`.slice(0, 20),
      cu: 'INR' as const,
    };
    return { ...ledger, upi_uri: buildUpiUri(input), qr_svg: await upiQrSvg(input) };
  }

  private async transcribe(audioBase64: string) {
    const key = this.config.get<string>('OPENAI_API_KEY')?.trim();
    const provider = this.config.get<string>('SPEECH_PROVIDER') || 'openai';
    if (!key || key.startsWith('your-') || provider === 'none') this.speechNotConfigured();
    const bytes = Buffer.from(audioBase64, 'base64');
    const form = new FormData();
    form.append('model', 'whisper-1');
    form.append('file', new Blob([bytes], { type: 'audio/webm' }), 'clip.webm');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) throw new HttpException('Speech provider rejected the clip', HttpStatus.BAD_GATEWAY);
    const payload = (await response.json()) as { text?: string };
    return payload.text?.trim() ?? '';
  }

  private async openAiBill(imageBase64: string, key: string) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.get('OCR_MODEL') || 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract this purchase bill as JSON: {"supplier": string|null, "lines": [{"description","quantity","unit_price","line_total"}], "total": number|null}. Reply with JSON only.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        }],
      }),
    });
    if (!response.ok) throw new HttpException('OCR provider rejected the image', HttpStatus.BAD_GATEWAY);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return payload.choices?.[0]?.message?.content ?? '';
  }

  private async rpc(auth: AuthContext, fn: string, args?: Record<string, unknown>) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc(fn, args);
    raiseSupabase(error);
    return data;
  }

  private origin() {
    return (this.config.get<string>('PUBLIC_APP_URL') || 'http://127.0.0.1:4318').replace(/\/$/, '');
  }

  private speechNotConfigured(): never {
    throw new HttpException(
      { statusCode: 503, error: 'Service Unavailable', code: 'SPEECH_NOT_CONFIGURED', message: 'Set OPENAI_API_KEY to transcribe audio. Text transcripts work without it.' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private ocrNotConfigured(): never {
    throw new HttpException(
      { statusCode: 503, error: 'Service Unavailable', code: 'OCR_NOT_CONFIGURED', message: 'Set OPENAI_API_KEY to read a bill photo. A text extraction can be sent as text.' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
