import { Injectable } from '@nestjs/common';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

  async me(auth: AuthContext) {
    const client = this.supabase.userClient(auth.token);
    const admin = await client.rpc('claim_platform_admin');
    raiseSupabase(admin.error);
    const { data: user, error } = await client
      .from('users')
      .select('id, email, name, avatar_url, tenant_id, active_tenant_id, role, created_at')
      .eq('id', auth.id)
      .maybeSingle();
    raiseSupabase(error);
    const { data: memberships, error: membershipError } = await client
      .from('memberships')
      .select('id, tenant_id, role, status, created_at, tenant:tenants(id, name, slug, plan, status)')
      .eq('user_id', auth.id);
    raiseSupabase(membershipError);
    return {
      user,
      is_super_admin: admin.data === true,
      memberships: memberships ?? [],
      claims: {
        tenant_id: auth.tenantId ?? null,
        user_role: auth.tenantRole ?? null,
      },
    };
  }

  async updateMe(auth: AuthContext, body: { name?: string; avatar_url?: string }) {
    const patch: Record<string, string> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.avatar_url !== undefined) patch.avatar_url = body.avatar_url;
    const { data, error } = await this.supabase.userClient(auth.token).from('users').update(patch).eq('id', auth.id).select('id, email, name, avatar_url').single();
    raiseSupabase(error);
    return data;
  }
}
