import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CounterService } from './counter.service';

describe('offline sync', () => {
  it('sends the batch to sync_offline_sales and returns per-client results', async () => {
    const calls: unknown[] = [];
    const service = new CounterService(
      {
        userClient: () => ({
          rpc: async (name: string, args: { p_sales: unknown }) => {
            calls.push({ name, args });
            return {
              data: [{ client_id: '11111111-1111-4111-8111-111111111111', status: 'created', invoice_id: 'inv', number: 'INV2526001' }],
              error: null,
            };
          },
        }),
      } as never,
      { get: () => undefined } as unknown as ConfigService,
    );

    const result = await service.sync({ id: 'u', token: 't' }, [{
      client_id: '11111111-1111-4111-8111-111111111111',
      lines: [{ description: 'Rice', quantity: 1, unit_price: 50 }],
    }], 'device-a');

    expect(result.results[0]).toMatchObject({ status: 'created', number: 'INV2526001' });
    expect(calls[0]).toMatchObject({ name: 'sync_offline_sales' });
  });

  it('asks pos_tiles for one category when a filter is set', async () => {
    let args: Record<string, unknown> = {};
    const service = new CounterService(
      {
        userClient: () => ({
          rpc: async (_name: string, next: Record<string, unknown>) => {
            args = next;
            return { data: { categories: [], favourites: [], top_sellers: [], uncategorized: [] }, error: null };
          },
        }),
      } as never,
      { get: () => undefined } as unknown as ConfigService,
    );
    await service.tiles({ id: 'u', token: 't' }, '33333333-3333-4333-8333-333333333333');
    expect(args.p_category).toBe('33333333-3333-4333-8333-333333333333');
  });
});

describe('bill photo without a provider key', () => {
  it('returns 503 OCR_NOT_CONFIGURED', async () => {
    const service = new CounterService({} as never, { get: () => undefined } as unknown as ConfigService);
    await expect(service.parseBill({ image_base64: 'aaaa' })).rejects.toBeInstanceOf(HttpException);
    try {
      await service.parseBill({ image_base64: 'aaaa' });
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
      expect(((error as HttpException).getResponse() as { code: string }).code).toBe('OCR_NOT_CONFIGURED');
    }
  });
});
