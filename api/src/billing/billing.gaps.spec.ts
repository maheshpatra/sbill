import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';

describe('billing subscription embed', () => {
  it('names the plan foreign key so PostgREST can tell the two plan links apart', async () => {
    const selects: string[] = [];
    const service = new BillingService(
      {
        currentTenantId: async () => 'tenant-1',
        userClient: () => ({
          from: () => ({
            select: (query: string) => {
              selects.push(query);
              return {
                eq: () => ({
                  order: async () => ({ data: [], error: null }),
                }),
              };
            },
          }),
        }),
      } as never,
      { get: () => undefined } as unknown as ConfigService,
    );

    await service.subscription({ id: 'user', token: 'token' });
    expect(selects[0]).toContain('plans!tenant_subscriptions_plan_id_fkey');
  });
});

describe('platform checkout without Razorpay keys', () => {
  function billing(plan: Record<string, unknown>) {
    const calls: string[] = [];
    const service = new BillingService(
      {
        currentTenantId: async () => 'tenant-1',
        serviceClient: () => {
          throw new Error('Invalid API key');
        },
        anonClient: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: plan, error: null }),
                }),
              }),
            }),
          }),
        }),
        userClient: () => ({
          rpc: async (name: string) => {
            calls.push(name);
            if (name === 'current_user_role') return { data: 'owner', error: null };
            if (name === 'record_billing_checkout') return { data: { id: 'checkout-1' }, error: null };
            if (name === 'activate_platform_checkout') return { data: { activated: true }, error: null };
            return { data: null, error: null };
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'tenant-1', state_code: '27', gstin: null, plan: 'free' }, error: null }),
              }),
            }),
          }),
        }),
      } as never,
      { get: () => undefined } as unknown as ConfigService,
    );
    return { service, calls };
  }

  it('returns 503 BILLING_NOT_CONFIGURED before any service-role call', async () => {
    const { service, calls } = billing({
      id: 'plan-1',
      code: 'growth',
      name: 'Growth',
      price_monthly_paise: 49900,
      price_yearly_paise: 499000,
      sort_order: 20,
    });

    await expect(service.checkout({ id: 'user', token: 'token' }, { plan_code: 'growth', billing_cycle: 'monthly' })).rejects.toBeInstanceOf(HttpException);
    try {
      await service.checkout({ id: 'user', token: 'token' }, { plan_code: 'growth', billing_cycle: 'monthly' });
    } catch (error) {
      const response = (error as HttpException).getResponse() as { code: string };
      expect((error as HttpException).getStatus()).toBe(503);
      expect(response.code).toBe('BILLING_NOT_CONFIGURED');
    }
    expect(calls).not.toContain('record_billing_checkout');
  });

  it('activates a free plan with the user client when the service-role key is missing', async () => {
    const { service, calls } = billing({
      id: 'plan-free',
      code: 'free',
      name: 'Free',
      price_monthly_paise: 0,
      price_yearly_paise: 0,
      sort_order: 0,
    });

    const result = await service.checkout({ id: 'user', token: 'token' }, { plan_code: 'free', billing_cycle: 'monthly' });
    expect(result).toMatchObject({ provider: 'manual', status: 'active', plan: 'free', checkout_id: 'checkout-1' });
    expect(calls).toContain('record_billing_checkout');
    expect(calls).toContain('activate_platform_checkout');
  });
});
