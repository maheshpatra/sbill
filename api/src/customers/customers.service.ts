import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthContext } from '../common/auth-context';
import { pageOf, pageWindow } from '../common/pagination';
import { raiseSupabase } from '../common/supabase-error';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CustomerBodyDto, CustomerQueryDto, UpdateCustomerDto } from './dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(auth: AuthContext, query: CustomerQueryDto) {
    const { page, limit, from, to } = pageWindow(query);
    const tenantId = await this.supabase.currentTenantId(auth.token);
    let request = this.supabase
      .userClient(auth.token)
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });
    if (query.q) {
      const term = query.q.replace(/[%_,]/g, '');
      request = request.or(`name.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`);
    }
    const { data, error, count } = await request.range(from, to);
    raiseSupabase(error);
    return pageOf(data, count, page, limit);
  }

  async create(auth: AuthContext, dto: CustomerBodyDto) {
    await this.entitlements.assertUnderLimit(auth, 'customers');
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('customers')
      .insert({ ...dto, tenant_id: tenantId, currency: 'INR' })
      .select('*')
      .single();
    raiseSupabase(error);
    return data;
  }

  async get(auth: AuthContext, id: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Customer not found');
    return data;
  }

  async update(auth: AuthContext, id: string, dto: UpdateCustomerDto) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('customers')
      .update(dto)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Customer not found');
    return data;
  }

  async remove(auth: AuthContext, id: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('customers')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Customer not found');
    return { deleted: true, id: data.id };
  }
}
