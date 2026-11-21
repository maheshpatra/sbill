import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateTenantDto, InviteMemberDto, SwitchTenantDto, UpdateMemberDto, UpdateTenantDto } from './dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(auth: AuthContext, dto: CreateTenantDto) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .rpc('create_tenant', { p_name: dto.name, p_slug: dto.slug });
    raiseSupabase(error);
    return data;
  }

  async listMine(auth: AuthContext) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('memberships')
      .select('id, role, status, tenant:tenants(id, name, slug, plan, status, currency)')
      .eq('user_id', auth.id)
      .eq('status', 'active');
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async current(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Active tenant not found');
    return data;
  }

  async update(auth: AuthContext, dto: UpdateTenantDto) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('tenants')
      .update(dto)
      .eq('id', tenantId)
      .select('*')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Tenant was not updated. Owner or admin role is required.');
    return data;
  }

  async switch(auth: AuthContext, dto: SwitchTenantDto) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .rpc('set_active_tenant', { p_tenant_id: dto.tenant_id });
    raiseSupabase(error);
    return {
      ...(data as object),
      note: 'Call supabase.auth.refreshSession() so the next JWT carries this tenant_id.',
    };
  }

  async members(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('memberships')
      .select('id, user_id, role, status, created_at, user:users(id, email, name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async invite(auth: AuthContext, dto: InviteMemberDto) {
    await this.entitlements.assertFeature(auth, 'multi_user_roles');
    await this.entitlements.assertUnderLimit(auth, 'members');
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .rpc('invite_member', { p_email: dto.email, p_role: dto.role });
    raiseSupabase(error);
    return data;
  }

  async updateMember(auth: AuthContext, membershipId: string, dto: UpdateMemberDto) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('memberships')
      .update({ role: dto.role })
      .eq('id', membershipId)
      .select('id, user_id, role, status, tenant_id')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Membership was not updated');
    return data;
  }

  async removeMember(auth: AuthContext, membershipId: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('memberships')
      .delete()
      .eq('id', membershipId)
      .select('id')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Membership was not removed');
    return { deleted: true, id: data.id };
  }
}
