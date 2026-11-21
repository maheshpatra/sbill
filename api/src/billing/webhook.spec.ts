import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';
import { verifyRazorpaySignature } from './providers';

function memory() {
  const state = {
    events: [] as Array<{ event_id: string }>,
    checkouts: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        tenant_id: 't1',
        plan_id: 'p1',
        billing_cycle: 'monthly',
        amount_paise: 58882,
        provider: 'razorpay',
        provider_order_id: 'order_1',
        status: 'pending',
      },
    ],
    plans: [{ id: 'p1', code: 'growth', name: 'Growth', price_monthly_paise: 49900, price_yearly_paise: 499000 }],
    tenants: [{ id: 't1', state_code: '29', gstin: null, plan: 'free' }],
    subs: [] as Array<Record<string, unknown>>,
    invoices: [] as Array<Record<string, unknown>>,
  };

  function table(name: string) {
    if (name === 'billing_events') return state.events;
    if (name === 'billing_checkouts') return state.checkouts;
    if (name === 'plans') return state.plans;
    if (name === 'tenants') return state.tenants;
    if (name === 'tenant_subscriptions') return state.subs;
    if (name === 'platform_invoices') return state.invoices;
    return [] as Array<Record<string, unknown>>;
  }

  function from(name: string) {
    const filters: Array<[string, unknown]> = [];
    const match = () =>
      (table(name) as Array<Record<string, unknown>>).filter((row) =>
        filters.every(([key, value]) => (Array.isArray(value) ? value.includes(row[key]) : row[key] === value)),
      );
    const api = {
      select() {
        return api;
      },
      eq(key: string, value: unknown) {
        filters.push([key, value]);
        return api;
      },
      in(key: string, value: unknown) {
        filters.push([key, value]);
        return api;
      },
      maybeSingle() {
        return Promise.resolve({ data: match()[0] ?? null, error: null });
      },
      single() {
        const row = match()[0];
        return Promise.resolve({ data: row, error: row ? null : { message: 'missing', code: 'PGRST116' } });
      },
      insert(row: Record<string, unknown>) {
        if (name === 'billing_events' && state.events.some((event) => event.event_id === row.event_id)) {
          return { select: () => ({ maybeSingle: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }) };
        }
        const saved = { id: `sub-${state.subs.length + 1}`, ...row };
        (table(name) as Array<Record<string, unknown>>).push(saved);
        return { select: () => ({ single: async () => ({ data: saved, error: null }), maybeSingle: async () => ({ data: saved, error: null }) }) };
      },
      update(patch: Record<string, unknown>) {
        return {
          eq() {
            const row = match()[0];
            if (row) Object.assign(row, patch);
            return { select: () => ({ single: async () => ({ data: row, error: null }), maybeSingle: async () => ({ data: row ?? null, error: null }) }) };
          },
        };
      },
    };
    return api;
  }

  return { state, client: { from, rpc: async () => ({ data: 0, error: null }) } };
}

describe('Razorpay activation', () => {
  const secret = 'whsec_test';

  it('checks the webhook signature', () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyRazorpaySignature(raw, signature, secret)).toBe(true);
    expect(verifyRazorpaySignature(raw, 'nope', secret)).toBe(false);
  });

  it('activates the plan once when the same event is delivered twice', async () => {
    const store = memory();
    const service = new BillingService(
      { serviceClient: () => store.client, userClient: () => store.client, anonClient: () => store.client } as never,
      { get: (key: string) => (key === 'RAZORPAY_WEBHOOK_SECRET' ? secret : key === 'PLATFORM_STATE_CODE' ? '27' : undefined) } as unknown as ConfigService,
    );
    const body = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', status: 'captured' } } },
    };
    const raw = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', secret).update(raw).digest('hex');

    const first = await service.handleRazorpay(raw, signature, 'evt_1', body);
    const second = await service.handleRazorpay(raw, signature, 'evt_1', body);

    expect(first).toMatchObject({ activated: true, plan: 'growth' });
    expect(second).toEqual({ duplicate: true });
    expect(store.state.invoices).toHaveLength(1);
    expect(store.state.invoices[0].igst_paise).toBeGreaterThan(0);
    expect(store.state.tenants[0].plan).toBe('growth');
    expect(store.state.checkouts[0].status).toBe('paid');
  });
});
