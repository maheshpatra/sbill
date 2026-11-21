import { createHmac } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { SupabaseService } from '../src/supabase/supabase.service';

function sign(secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    role: 'authenticated',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const data = `${header}.${body}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

describe('admin routes refuse a non-admin', () => {
  let app: INestApplication;
  const secret = process.env.SUPABASE_JWT_SECRET ?? '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        anonClient: () => ({ from: () => ({}) }),
        userClient: () => ({
          rpc: async (name: string) => {
            if (name === 'is_platform_admin') return { data: false, error: null };
            return { data: null, error: { message: 'platform admin required', code: '42501' } };
          },
        }),
        serviceClient: () => {
          throw new Error('service client is not used');
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

  it('returns 403 on every admin read and write', async () => {
    const token = sign(secret);
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${token}` };
    const calls = [
      request(server).get('/admin/plans').set(auth),
      request(server).get('/admin/plans/free/features').set(auth),
      request(server).get('/admin/templates').set(auth),
      request(server).get('/admin/tenants').set(auth),
      request(server).get('/admin/settings').set(auth),
      request(server).patch('/admin/plans/free').set(auth).send({ price_monthly: 1 }),
      request(server).put('/admin/plans/free/features').set(auth).send({ features: [{ feature_key: 'pos', enabled: true }] }),
      request(server).put('/admin/templates/classic').set(auth).send({ name: 'Classic' }),
      request(server).post('/admin/tenants/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/suspend').set(auth).send({ status: 'suspended' }),
      request(server).post('/admin/tenants/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/plan').set(auth).send({ plan: 'growth' }),
      request(server).patch('/admin/settings').set(auth).send({
        app_domain: 'example.com',
        cloudinary: { api_secret: 'fake-cloudinary-secret' },
      }),
    ];
    for (const call of calls) {
      const response = await call.expect(403);
      expect(response.body.message).toBe('platform admin required');
      expect(JSON.stringify(response.body)).not.toContain('fake-cloudinary-secret');
    }
  });

  it('rejects Cloudinary as the provider when it is not configured', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        anonClient: () => ({ from: () => ({}) }),
        userClient: () => ({
          rpc: async (name: string) => {
            if (name === 'is_platform_admin') return { data: true, error: null };
            if (name === 'cloudinary_public_config') return { data: { cloud_name: null, api_key: null, secret_set: false }, error: null };
            return { data: null, error: { message: 'should not save', code: '22023' } };
          },
        }),
        serviceClient: () => {
          throw new Error('service client is not used');
        },
        currentTenantId: async () => 'tenant',
      })
      .compile();
    const adminApp = moduleRef.createNestApplication();
    adminApp.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    adminApp.useGlobalFilters(new AllExceptionsFilter());
    await adminApp.init();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    const response = await request(adminApp.getHttpServer())
      .patch('/admin/settings')
      .set('Authorization', `Bearer ${sign(secret)}`)
      .send({ storage_provider: 'cloudinary' });
    await adminApp.close();
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('STORAGE_PROVIDER_NOT_CONFIGURED');
    expect(JSON.stringify(response.body)).not.toContain('api_secret');
  });
});
