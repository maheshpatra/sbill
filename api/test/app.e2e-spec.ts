import { createHmac } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { SupabaseService } from '../src/supabase/supabase.service';

function plansChain() {
  const result = {
    data: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        code: 'starter',
        name: 'Starter',
        description: 'For a new shop.',
        price_monthly: 0,
        price_yearly: 0,
        currency: 'INR',
        features: { invoices_per_month: 20, customers: 50, members: 2, upi_qr: true },
        sort_order: 10,
      },
    ],
    error: null,
    count: 1,
  };
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = self;
  builder.eq = self;
  builder.order = self;
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function signHs256(payload: Record<string, unknown>, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

describe('Billflow API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        anonClient: () => ({ from: () => plansChain() }),
        userClient: () => {
          throw new Error('user client is not used in these tests');
        },
        serviceClient: () => {
          throw new Error('service client is not used in these tests');
        },
        currentTenantId: async () => 'tenant',
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is public', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('billflow-api');
  });

  it('GET /billing/plans returns the catalog without a token', async () => {
    const response = await request(app.getHttpServer()).get('/billing/plans').expect(200);
    expect(response.body.data[0].code).toBe('starter');
    expect(response.body.data[0].features.invoices_per_month).toBe(20);
  });

  it('rejects a missing bearer token with the shared error shape', async () => {
    const response = await request(app.getHttpServer()).get('/entitlements').expect(401);
    expect(response.body.statusCode).toBe(401);
    expect(response.body.path).toBe('/entitlements');
    expect(response.body.message).toBe('Missing bearer token');
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it('rejects an invalid create-tenant body before calling Supabase', async () => {
    const token = signHs256(
      {
        sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        role: 'authenticated',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      process.env.SUPABASE_JWT_SECRET ?? '',
    );

    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'A', slug: 'Bad Slug' })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
    expect(response.body.error).toBe('Bad Request');
    expect(Array.isArray(response.body.message)).toBe(true);
  });
});
