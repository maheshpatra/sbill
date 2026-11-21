import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { raiseSupabase } from '../common/supabase-error';

@Injectable()
export class SupabaseService {
  constructor(private readonly config: ConfigService) {}

  anonClient(): SupabaseClient {
    return this.client(this.config.getOrThrow<string>('SUPABASE_ANON_KEY'));
  }

  /** User-scoped client. RLS applies as this JWT. */
  userClient(jwt: string): SupabaseClient {
    return this.client(this.config.getOrThrow<string>('SUPABASE_ANON_KEY'), jwt);
  }

  /** Bypasses RLS. Webhooks, cron, and other calls that have no user JWT. */
  serviceClient(): SupabaseClient {
    return this.client(this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'));
  }

  async currentTenantId(jwt: string): Promise<string> {
    const { data, error } = await this.userClient(jwt).rpc('current_tenant_id');
    raiseSupabase(error);
    if (!data) {
      throw new ForbiddenException('No active tenant. Create one with POST /tenants or switch with POST /tenants/switch.');
    }
    return data as string;
  }

  private client(key: string, jwt?: string): SupabaseClient {
    return createClient(this.config.getOrThrow<string>('SUPABASE_URL'), key, {
      global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : undefined,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
}
