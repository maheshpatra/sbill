import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertUpload, objectKey, r2Config } from './r2';

describe('R2 uploads', () => {
  it('returns 503 STORAGE_NOT_CONFIGURED when the env is missing', () => {
    expect(() => r2Config({ get: () => undefined } as unknown as ConfigService)).toThrow(HttpException);
    try {
      r2Config({ get: () => '' } as unknown as ConfigService);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
      expect(((error as HttpException).getResponse() as { code: string }).code).toBe('STORAGE_NOT_CONFIGURED');
    }
  });

  it('rejects an oversized logo and builds a tenant-scoped key', () => {
    expect(() => assertUpload('logo', 'image/png', 3_000_000)).toThrow(HttpException);
    const key = objectKey('tenant-1', 'avatar', 'user-1', 'png');
    expect(key.startsWith('tenant-1/avatar/user-1/')).toBe(true);
    expect(objectKey('tenant-1', 'bill_photo', 'user-1', 'jpg')).toMatch(/^tenant-1\/bill_photo\//);
    expect(() => assertUpload('product', 'application/pdf', 1000)).toThrow(HttpException);
    expect(() => assertUpload('site', 'image/png', 2_000_001)).toThrow(HttpException);
    expect(assertUpload('product', 'image/webp', 2_000_000)).toBe('product');
    expect(assertUpload('site', 'image/jpeg', 1)).toBe('site');
  });
});
