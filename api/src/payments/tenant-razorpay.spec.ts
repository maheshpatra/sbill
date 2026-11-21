import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { encryptSecret, verifyCheckoutSignature, verifyWebhookSignature } from './secret-box';
import { TenantRazorpayService } from './tenant-razorpay.service';

describe('tenant Razorpay signatures', () => {
  const secret = 'tenant_webhook_secret';

  it('accepts a checkout signature of order_id|payment_id', () => {
    const { createHmac } = require('crypto') as typeof import('crypto');
    const signature = createHmac('sha256', 'key_secret').update('order_1|pay_1').digest('hex');
    expect(verifyCheckoutSignature('order_1', 'pay_1', signature, 'key_secret')).toBe(true);
    expect(verifyCheckoutSignature('order_1', 'pay_1', signature, 'other')).toBe(false);
  });

  it('accepts the webhook body signature', () => {
    const { createHmac } = require('crypto') as typeof import('crypto');
    const raw = Buffer.from('{"event":"payment.captured"}');
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyWebhookSignature(raw, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(raw, 'short', secret)).toBe(false);
  });
});

describe('tenant Razorpay webhook idempotency', () => {
  it('captures a payment once when the same event is delivered twice', async () => {
    const key = randomBytes(32);
    const updates: Array<Record<string, unknown>> = [];
    const events: string[] = [];
    const payments: Array<Record<string, unknown>> = [{ id: 'pay-intent', status: 'pending', provider_payment_id: null, provider_link_id: null }];
    const account = {
      key_id: 'rzp_test_key',
      key_secret_enc: encryptSecret('key_secret', key),
      webhook_secret_enc: encryptSecret('whsec_tenant', key),
      enabled: true,
    };

    function from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return api;
        },
        maybeSingle() {
          if (table === 'tenant_razorpay') return Promise.resolve({ data: account, error: null });
          const row = payments.find((payment) => filters.every(([column, value]) => payment[column] === value));
          return Promise.resolve({ data: row ?? null, error: null });
        },
        insert(row: { event_id: string }) {
          if (table === 'tenant_gateway_events' && events.includes(row.event_id)) {
            return { select: () => ({ maybeSingle: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }) };
          }
          events.push(row.event_id);
          return { select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) };
        },
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          Object.assign(payments[0], patch);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      };
      return api;
    }

    const service = new TenantRazorpayService(
      { serviceClient: () => ({ from }), userClient: () => ({ from }) } as never,
      { get: (name: string) => (name === 'PAYMENT_SECRETS_KEY' ? key.toString('base64') : undefined) } as ConfigService,
      { assertFeature: async () => undefined } as never,
    );
    const body = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_live', order_id: 'order_live', notes: { payment_intent_id: 'pay-intent' } } } },
    };
    const raw = Buffer.from(JSON.stringify(body));
    const { createHmac } = require('crypto') as typeof import('crypto');
    const signature = createHmac('sha256', 'whsec_tenant').update(raw).digest('hex');

    const first = await service.handleWebhook('20000000-0000-4000-8000-000000000001', raw, signature, 'evt_1', body);
    const second = await service.handleWebhook('20000000-0000-4000-8000-000000000001', raw, signature, 'evt_1', body);

    expect(first).toMatchObject({ activated: true });
    expect(second).toEqual({ duplicate: true });
    expect(updates.filter((row) => row.status === 'succeeded')).toHaveLength(1);
    expect(payments[0].transaction_ref).toBe('pay_live');
  });
});
