import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { decryptSecret, encryptSecret } from '../payments/secret-box';
import { SupabaseService } from '../supabase/supabase.service';

const SECRET_KEYS = ['msg91_auth_key', 'twilio_account_sid', 'twilio_auth_token', 'smtp_pass', 'resend_api_key'] as const;

export type MessagingSecrets = Partial<Record<(typeof SECRET_KEYS)[number], string>>;

const PUBLIC_COLUMNS = 'sms_provider, email_provider, msg91_sender_id, msg91_dlt_template_id, twilio_from, smtp_host, smtp_port, smtp_user, resend_from';

@Injectable()
export class MessagingSettingsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async get(auth: AuthContext) {
    await this.requireAdmin(auth);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const client = this.supabase.userClient(auth.token);
    const { data, error } = await client.from('messaging_settings').select(PUBLIC_COLUMNS).eq('tenant_id', tenantId).maybeSingle();
    raiseSupabase(error);
    const { data: flags, error: flagError } = await client.rpc('messaging_secret_flags');
    raiseSupabase(flagError);
    const present = (flags ?? {}) as Record<string, boolean>;
    return {
      sms_provider: data?.sms_provider ?? 'none',
      email_provider: data?.email_provider ?? 'none',
      msg91_sender_id: data?.msg91_sender_id ?? null,
      msg91_dlt_template_id: data?.msg91_dlt_template_id ?? null,
      twilio_from: data?.twilio_from ?? null,
      smtp_host: data?.smtp_host ?? null,
      smtp_port: data?.smtp_port ?? null,
      smtp_user: data?.smtp_user ?? null,
      resend_from: data?.resend_from ?? null,
      secrets_set: Object.fromEntries(SECRET_KEYS.map((key) => [key, present[key] === true])),
    };
  }

  async save(auth: AuthContext, body: MessagingSettingsBody) {
    await this.requireAdmin(auth);
    const client = this.supabase.userClient(auth.token);
    const current = await this.secretsForUser(auth);
    const next: MessagingSecrets = { ...current };
    for (const key of SECRET_KEYS) {
      const value = body[key];
      if (typeof value === 'string' && value.length > 0) next[key] = value;
    }
    const flags = Object.fromEntries(SECRET_KEYS.map((key) => [key, Boolean(next[key])]));
    const { error } = await client.rpc('save_messaging_settings', {
      p_sms_provider: body.sms_provider,
      p_email_provider: body.email_provider,
      p_msg91_sender_id: body.msg91_sender_id ?? null,
      p_msg91_dlt_template_id: body.msg91_dlt_template_id ?? null,
      p_twilio_from: body.twilio_from ?? null,
      p_smtp_host: body.smtp_host ?? null,
      p_smtp_port: body.smtp_port ?? null,
      p_smtp_user: body.smtp_user ?? null,
      p_resend_from: body.resend_from ?? null,
      p_secrets_enc: encryptSecret(JSON.stringify(next), this.masterKey()),
      p_secrets_flags: flags,
    });
    raiseSupabase(error);
    return this.get(auth);
  }

  /** Cron and reminder delivery. No user JWT, so this stays on the service role. */
  async secretsFor(tenantId: string): Promise<MessagingSecrets> {
    const { data, error } = await this.supabase
      .serviceClient()
      .from('messaging_settings')
      .select('secrets, secrets_enc')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    raiseSupabase(error);
    return this.decode(data?.secrets_enc as string | null, data?.secrets as MessagingSecrets | undefined);
  }

  private async secretsForUser(auth: AuthContext): Promise<MessagingSecrets> {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('messaging_secrets_enc');
    raiseSupabase(error);
    return this.decode(data as string | null, undefined);
  }

  private decode(encoded: string | null | undefined, plaintext: MessagingSecrets | undefined): MessagingSecrets {
    if (encoded) {
      const raw = this.config.get<string>('PAYMENT_SECRETS_KEY');
      if (!raw) return {};
      try {
        return JSON.parse(decryptSecret(encoded, Buffer.from(raw, 'base64'))) as MessagingSecrets;
      } catch {
        return {};
      }
    }
    return plaintext ?? {};
  }

  private masterKey() {
    const raw = this.config.get<string>('PAYMENT_SECRETS_KEY');
    if (!raw) throw new BadRequestException('PAYMENT_SECRETS_KEY is not configured');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new BadRequestException('PAYMENT_SECRETS_KEY must be 32 bytes of base64');
    return key;
  }

  private async requireAdmin(auth: AuthContext) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc('current_user_role');
    raiseSupabase(error);
    if (data !== 'owner' && data !== 'admin') throw new ForbiddenException('Owner or admin role is required');
  }
}

export interface MessagingSettingsBody {
  sms_provider: 'none' | 'msg91' | 'twilio';
  email_provider: 'none' | 'smtp' | 'resend';
  msg91_sender_id?: string;
  msg91_dlt_template_id?: string;
  twilio_from?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  resend_from?: string;
  msg91_auth_key?: string;
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  smtp_pass?: string;
  resend_api_key?: string;
}
