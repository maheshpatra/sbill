import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { IsArray, IsBoolean, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SupabaseService } from '../supabase/supabase.service';

export class WebhookBodyDto {
  @ApiProperty({ example: 'https://example.com/hooks/billflow' })
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  url!: string;

  @ApiProperty({ example: ['invoice.paid', 'invoice.sent'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  events!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'At least 16 characters. Generated when omitted.' })
  @IsOptional()
  @IsString()
  @MinLength(16)
  secret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(auth: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('webhook_endpoints')
      .select('id, url, events, active, description, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  async create(auth: AuthContext, dto: WebhookBodyDto) {
    await this.entitlements.assertFeature(auth, 'webhooks');
    const tenantId = await this.supabase.currentTenantId(auth.token);
    const secret = dto.secret ?? randomBytes(24).toString('hex');
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('webhook_endpoints')
      .insert({
        tenant_id: tenantId,
        url: dto.url,
        events: dto.events,
        description: dto.description ?? null,
        secret,
        active: dto.active ?? true,
      })
      .select('id, url, events, active, description, secret, created_at')
      .single();
    raiseSupabase(error);
    return data;
  }

  async update(auth: AuthContext, id: string, dto: Partial<WebhookBodyDto>) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('webhook_endpoints')
      .update({
        url: dto.url,
        events: dto.events,
        description: dto.description,
        active: dto.active,
        secret: dto.secret,
      })
      .eq('id', id)
      .select('id, url, events, active, description, updated_at')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Webhook not found');
    return data;
  }

  async remove(auth: AuthContext, id: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Webhook not found');
    return { deleted: true, id: data.id };
  }

  async deliveries(auth: AuthContext, id: string) {
    const { data, error } = await this.supabase
      .userClient(auth.token)
      .from('webhook_deliveries')
      .select('id, event, status, attempts, response_status, created_at')
      .eq('endpoint_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    raiseSupabase(error);
    return { data: data ?? [] };
  }
}
