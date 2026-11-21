import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type UploadKind = 'logo' | 'avatar' | 'bill_photo' | 'product' | 'site';

const IMAGES = ['image/png', 'image/jpeg', 'image/webp'];

const LIMITS: Record<UploadKind, { bytes: number; types: string[] }> = {
  logo: { bytes: 2_000_000, types: IMAGES },
  avatar: { bytes: 2_000_000, types: IMAGES },
  product: { bytes: 2_000_000, types: IMAGES },
  site: { bytes: 2_000_000, types: IMAGES },
  bill_photo: { bytes: 8_000_000, types: [...IMAGES, 'application/pdf'] },
};

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

export function r2Config(config: ConfigService): R2Config {
  const read = (name: string) => config.get<string>(name)?.trim() ?? '';
  const values = {
    accountId: read('R2_ACCOUNT_ID'),
    accessKeyId: read('R2_ACCESS_KEY_ID'),
    secretAccessKey: read('R2_SECRET_ACCESS_KEY'),
    bucket: read('R2_BUCKET'),
    publicBaseUrl: read('R2_PUBLIC_BASE_URL').replace(/\/$/, ''),
  };
  if (Object.values(values).some((value) => !value || value.startsWith('your-'))) {
    throw new HttpException(
      {
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'STORAGE_NOT_CONFIGURED',
        message: 'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_PUBLIC_BASE_URL.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return values;
}

export function assertUpload(kind: string, contentType: string, size: number): UploadKind {
  if (!(kind in LIMITS)) {
    throw new HttpException('kind must be logo, avatar, bill_photo, product, or site', HttpStatus.BAD_REQUEST);
  }
  const rule = LIMITS[kind as UploadKind];
  if (!rule.types.includes(contentType)) {
    throw new HttpException(`content_type must be one of ${rule.types.join(', ')}`, HttpStatus.BAD_REQUEST);
  }
  if (!Number.isFinite(size) || size <= 0 || size > rule.bytes) {
    throw new HttpException(`size must be between 1 and ${rule.bytes} bytes`, HttpStatus.BAD_REQUEST);
  }
  return kind as UploadKind;
}

export function objectKey(tenantId: string, kind: UploadKind, userId: string, extension: string) {
  const id = crypto.randomUUID();
  if (kind === 'avatar') return `${tenantId}/avatar/${userId}/${id}.${extension}`;
  return `${tenantId}/${kind}/${id}.${extension}`;
}

export function extensionFor(contentType: string) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'application/pdf') return 'pdf';
  return 'jpg';
}
