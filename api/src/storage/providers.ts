import { createHash } from 'crypto';

export type StorageProviderName = 'supabase' | 'cloudinary' | 'r2';

export interface CloudinaryPublicConfig {
  cloud_name?: string | null;
  api_key?: string | null;
  secret_set?: boolean;
}

export function present(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.startsWith('your-')) return null;
  return trimmed;
}

export function resolveCloudinary(input: {
  database?: CloudinaryPublicConfig | null;
  env?: CloudinaryPublicConfig | null;
}) {
  const db = input.database ?? {};
  const env = input.env ?? {};
  const cloudName = present(db.cloud_name) ?? present(env.cloud_name);
  const apiKey = present(db.api_key) ?? present(env.api_key);
  const secretSet = Boolean(db.secret_set) || Boolean(env.secret_set);
  const fromDatabase = Boolean(present(db.cloud_name) && present(db.api_key) && db.secret_set);
  const configured = Boolean(cloudName && apiKey && secretSet);
  const source = fromDatabase ? 'database' : configured ? 'env' : null;
  return {
    configured,
    available: true as const,
    details: {
      cloud_name: cloudName,
      api_key: apiKey,
      secret_set: secretSet,
      source,
      folders: {
        logos: 'billflow/logos',
        avatars: 'billflow/avatars',
        products: 'billflow/products',
        site: 'billflow/site',
      },
    },
  };
}

export function storageSettingsView(input: {
  selected?: string | null;
  supabaseUrl?: string | null;
  cloudinary: ReturnType<typeof resolveCloudinary>;
}) {
  const base = (input.supabaseUrl ?? '').replace(/\/$/, '');
  const provider = chooseProvider(input.selected, {
    supabase: true,
    cloudinary: input.cloudinary.configured,
    r2: false,
  });
  return {
    provider,
    providers: {
      supabase: {
        configured: Boolean(base),
        details: {
          buckets: ['logos', 'avatars', 'bill-photos', 'products', 'site-images'],
          public_url: base ? `${base}/storage/v1/object/public/<bucket>/<path>` : undefined,
        },
      },
      cloudinary: input.cloudinary,
      r2: { configured: false, available: false },
    },
  };
}

export function chooseProvider(
  selected: string | null | undefined,
  configured: Record<StorageProviderName, boolean>,
): StorageProviderName {
  if (selected === 'cloudinary' && configured.cloudinary) return 'cloudinary';
  if (selected === 'r2' && configured.r2) return 'r2';
  return 'supabase';
}

export function cloudinarySignature(params: Record<string, string>, secret: string) {
  const encoded = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
  return createHash('sha1').update(encoded + secret).digest('hex');
}

export function cloudinaryFolder(kind: string, tenantId: string, userId: string) {
  if (kind === 'avatar') return `billflow/avatars/${userId}`;
  if (kind === 'bill_photo') return `billflow/bills/${tenantId}`;
  if (kind === 'product') return `billflow/products/${tenantId}`;
  if (kind === 'site') return `billflow/site/${tenantId}`;
  return `billflow/logos/${tenantId}`;
}
