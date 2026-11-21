import { randomBytes } from 'crypto';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptSecret } from '../payments/secret-box';
import { MessagingSettingsService } from './messaging-settings.service';

describe('messaging settings', () => {
  const key = randomBytes(32);

  function service(role: string) {
    const row: Record<string, unknown> = {};
    let serviceRoleUsed = false;
    const supabase = {
      currentTenantId: async () => 'tenant-1',
      serviceClient: () => {
        serviceRoleUsed = true;
        throw new Error('Invalid API key');
      },
      userClient: () => ({
        rpc: async (name: string, args?: Record<string, unknown>) => {
          if (name === 'current_user_role') return { data: role, error: null };
          if (name === 'messaging_secrets_enc') return { data: row.secrets_enc ?? null, error: null };
          if (name === 'messaging_secret_flags') return { data: row.secrets_flags ?? {}, error: null };
          if (name === 'save_messaging_settings') {
            row.secrets_enc = args?.p_secrets_enc;
            row.secrets_flags = args?.p_secrets_flags;
            row.secrets = {};
            row.sms_provider = args?.p_sms_provider;
            row.email_provider = args?.p_email_provider;
            return { error: null };
          }
          return { data: null, error: null };
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  sms_provider: row.sms_provider ?? 'none',
                  email_provider: row.email_provider ?? 'none',
                  msg91_sender_id: null,
                  msg91_dlt_template_id: null,
                  twilio_from: null,
                  smtp_host: null,
                  smtp_port: null,
                  smtp_user: null,
                  resend_from: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    return {
      row,
      usedServiceRole: () => serviceRoleUsed,
      api: new MessagingSettingsService(supabase as never, { get: (name: string) => (name === 'PAYMENT_SECRETS_KEY' ? key.toString('base64') : undefined) } as ConfigService),
    };
  }

  it('stores provider secrets encrypted and does not return them', async () => {
    const { row, usedServiceRole, api } = service('admin');
    const saved = await api.save({ id: 'user', token: 'token' }, {
      sms_provider: 'msg91',
      email_provider: 'none',
      msg91_auth_key: 'secret-auth-key',
    });
    expect(JSON.stringify(saved)).not.toContain('secret-auth-key');
    expect(saved.secrets_set.msg91_auth_key).toBe(true);
    expect(row.secrets).toEqual({});
    const flags = row.secrets_flags as Record<string, boolean>;
    expect(flags.msg91_auth_key).toBe(true);
    const decoded = JSON.parse(decryptSecret(String(row.secrets_enc), key));
    expect(decoded.msg91_auth_key).toBe('secret-auth-key');
    expect(usedServiceRole()).toBe(false);
  });

  it('reads settings with the user client when the service-role key is missing', async () => {
    const { usedServiceRole, api } = service('owner');
    const settings = await api.get({ id: 'user', token: 'token' });
    expect(settings.sms_provider).toBe('none');
    expect(settings.secrets_set.msg91_auth_key).toBe(false);
    expect(usedServiceRole()).toBe(false);
  });

  it('rejects a member', async () => {
    const { api } = service('member');
    await expect(api.get({ id: 'user', token: 'token' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
