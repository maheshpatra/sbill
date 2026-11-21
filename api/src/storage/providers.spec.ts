import { createHash } from 'crypto';
import { chooseProvider, cloudinaryFolder, cloudinarySignature, resolveCloudinary, storageSettingsView } from './providers';

describe('storage providers', () => {
  const configured = { supabase: true, cloudinary: false, r2: false };

  it('falls back to supabase when the selected provider has no env', () => {
    expect(chooseProvider('r2', configured)).toBe('supabase');
    expect(chooseProvider('cloudinary', { ...configured, cloudinary: true })).toBe('cloudinary');
    expect(chooseProvider('supabase', configured)).toBe('supabase');
  });

  it('signs Cloudinary params and keeps avatars under the user folder', () => {
    const params = { folder: 'billflow/logos/tenant-1', public_id: 'file', timestamp: '10' };
    expect(cloudinarySignature(params, 'secret')).toBe(
      cloudinarySignature({ timestamp: '10', public_id: 'file', folder: params.folder }, 'secret'),
    );
    expect(cloudinaryFolder('avatar', 'tenant-1', 'user-9')).toBe('billflow/avatars/user-9');
    expect(cloudinaryFolder('logo', 'tenant-1', 'user-9')).toBe('billflow/logos/tenant-1');
    expect(cloudinaryFolder('product', 'tenant-1', 'user-9')).toBe('billflow/products/tenant-1');
    expect(cloudinaryFolder('site', 'tenant-1', 'user-9')).toBe('billflow/site/tenant-1');
  });

  it('signs with the documented Cloudinary sha1 of the sorted params plus the secret', () => {
    const secret = 'fake-cloudinary-secret';
    const signed = cloudinarySignature(
      { timestamp: '10', public_id: 'file', folder: 'billflow/logos/t' },
      secret,
    );
    const documented = createHash('sha1')
      .update('folder=billflow/logos/t&public_id=file&timestamp=10' + secret)
      .digest('hex');
    expect(signed).toBe(documented);
  });

  it('describes Cloudinary without returning the secret', () => {
    const secret = 'fake-cloudinary-secret';
    const cloudinary = resolveCloudinary({
      database: { cloud_name: 'from-db', api_key: '123', secret_set: true },
      env: { cloud_name: 'from-env', api_key: '456', secret_set: true },
    });
    const view = storageSettingsView({
      selected: 'cloudinary',
      supabaseUrl: 'https://example.supabase.co',
      cloudinary,
    });
    expect(view.provider).toBe('cloudinary');
    expect(view.providers.cloudinary).toEqual({
      configured: true,
      available: true,
      details: {
        cloud_name: 'from-db',
        api_key: '123',
        secret_set: true,
        source: 'database',
        folders: {
          logos: 'billflow/logos',
          avatars: 'billflow/avatars',
          products: 'billflow/products',
          site: 'billflow/site',
        },
      },
    });
    expect(view.providers.r2).toEqual({ configured: false, available: false });
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(JSON.stringify(view)).not.toContain('api_secret');
    expect(resolveCloudinary({
      database: { cloud_name: null, api_key: null, secret_set: false },
      env: { secret_set: false },
    }).configured).toBe(false);
    expect(storageSettingsView({
      selected: 'r2',
      cloudinary: resolveCloudinary({}),
    }).provider).toBe('supabase');
  });
});
