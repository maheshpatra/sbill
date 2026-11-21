import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';
import { assertUpload, extensionFor, objectKey, r2Config } from './r2';
import { chooseProvider, cloudinaryFolder, cloudinarySignature, CloudinaryPublicConfig, present, resolveCloudinary, storageSettingsView, StorageProviderName } from './providers';

@Injectable()
export class StorageService {
  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  settingsView(selected: string, database?: CloudinaryPublicConfig | null) {
    return storageSettingsView({
      selected,
      supabaseUrl: this.config.get<string>('SUPABASE_URL'),
      cloudinary: resolveCloudinary({ database, env: this.envCloudinary() }),
    });
  }

  async cloudinaryConfig(auth: AuthContext): Promise<CloudinaryPublicConfig> {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('cloudinary_public_config');
    if (error) return { cloud_name: null, api_key: null, secret_set: false };
    return (data ?? {}) as CloudinaryPublicConfig;
  }

  async presign(auth: AuthContext, body: { kind: string; content_type: string; size: number }) {
    const kind = assertUpload(body.kind, body.content_type, body.size);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const selected = await this.selected(auth.token);
    const database = await this.cloudinaryConfig(auth);
    const resolved = resolveCloudinary({ database, env: this.envCloudinary() });
    const provider = chooseProvider(selected, {
      supabase: true,
      cloudinary: resolved.configured,
      r2: false,
    });
    if (provider === 'cloudinary') return this.cloudinaryPresign(auth, kind, tenantId, resolved);
    if (provider === 'r2') return this.r2Presign(kind, tenantId, auth.id, body.content_type, body.size);
    return this.supabasePresign(auth, kind, tenantId, body.content_type);
  }

  async putPdf(auth: AuthContext, tenantId: string, invoiceId: string, body: Buffer): Promise<string | null> {
    const provider = chooseProvider(await this.selected(auth.token), {
      supabase: true,
      cloudinary: false,
      r2: this.r2Configured(),
    });
    if (provider === 'r2') return this.r2PutPdf(tenantId, invoiceId, body);
    const path = `${tenantId}/${invoiceId}.pdf`;
    const { error } = await this.supabase.userClient(auth.token).storage.from('invoice-pdfs').upload(path, body, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (error) return null;
    return path;
  }

  private async selected(token: string) {
    const { data, error } = await this.supabase.userClient(token).from('platform_settings').select('storage_provider').eq('id', 1).maybeSingle();
    raiseSupabase(error);
    return (data?.storage_provider as string | undefined) ?? 'supabase';
  }

  private async supabasePresign(auth: AuthContext, kind: string, tenantId: string, contentType: string) {
    const bucket = kind === 'logo' ? 'logos'
      : kind === 'avatar' ? 'avatars'
      : kind === 'product' ? 'products'
      : kind === 'site' ? 'site-images'
      : 'bill-photos';
    const path = `${tenantId}/${kind === 'avatar' ? `${auth.id}/` : ''}${randomUUID()}.${extensionFor(contentType)}`;
    const { data, error } = await this.supabase.userClient(auth.token).storage.from(bucket).createSignedUploadUrl(path);
    raiseSupabase(error);
    const base = this.config.getOrThrow<string>('SUPABASE_URL').replace(/\/$/, '');
    return {
      provider: 'supabase' as const,
      url: data.signedUrl,
      headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
      public_url: bucket === 'bill-photos' ? null : `${base}/storage/v1/object/public/${bucket}/${path}`,
      path: data.path,
    };
  }

  private async cloudinaryPresign(
    auth: AuthContext,
    kind: string,
    tenantId: string,
    resolved: ReturnType<typeof resolveCloudinary>,
  ) {
    const cloud = resolved.details.cloud_name!;
    const apiKey = resolved.details.api_key!;
    const folder = cloudinaryFolder(kind, tenantId, auth.id);
    const publicId = randomUUID();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { folder, public_id: publicId, timestamp };
    const toSign = Object.keys(params).sort().map((key) => `${key}=${params[key as keyof typeof params]}`).join('&');
    const database = await this.cloudinaryConfig(auth);
    let signature: string;
    if (database.secret_set) {
      const { data, error } = await this.supabase.userClient(auth.token).rpc('cloudinary_sign', { p_params_to_sign: toSign });
      raiseSupabase(error);
      signature = String(data);
    } else {
      signature = cloudinarySignature(params, present(this.config.get<string>('CLOUDINARY_API_SECRET')) ?? '');
    }
    return {
      provider: 'cloudinary' as const,
      url: `https://api.cloudinary.com/v1_1/${cloud}/image/upload`,
      fields: { api_key: apiKey, timestamp, signature, folder, public_id: publicId },
      public_url: `https://res.cloudinary.com/${cloud}/image/upload/${folder}/${publicId}`,
    };
  }

  private async r2Presign(kind: string, tenantId: string, userId: string, contentType: string, size: number) {
    const settings = r2Config(this.config);
    const key = objectKey(tenantId, kind as 'logo', userId, extensionFor(contentType));
    const command = new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    });
    const url = await getSignedUrl(this.r2Client(settings), command, { expiresIn: 600 });
    return {
      provider: 'r2' as const,
      url,
      headers: { 'Content-Type': contentType, 'Content-Length': String(size) },
      public_url: `${settings.publicBaseUrl}/${key}`,
      key,
    };
  }

  private async r2PutPdf(tenantId: string, invoiceId: string, body: Buffer) {
    const settings = r2Config(this.config);
    const key = `${tenantId}/pdfs/${invoiceId}.pdf`;
    await this.r2Client(settings).send(new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/pdf',
    }));
    return `${settings.publicBaseUrl}/${key}`;
  }

  private envCloudinary(): CloudinaryPublicConfig {
    return {
      cloud_name: this.config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.get<string>('CLOUDINARY_API_KEY'),
      secret_set: Boolean(present(this.config.get<string>('CLOUDINARY_API_SECRET'))),
    };
  }

  private r2Configured() {
    try {
      r2Config(this.config);
      return true;
    } catch {
      return false;
    }
  }

  private r2Client(settings: ReturnType<typeof r2Config>) {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });
  }
}

export type { StorageProviderName };
