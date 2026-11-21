import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { resolveHost } from '@billflow/host-resolution';
import { ConfigService } from '@nestjs/config';
import { AuthContext } from '../common/auth-context';
import { CurrentUser, Public } from '../common/decorators';
import { raiseSupabase } from '../common/supabase-error';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SupabaseService } from '../supabase/supabase.service';

class ResolveQueryDto {
  @ApiProperty({ example: 'acme.billflow.app' })
  @IsString()
  host!: string;
}

class UpdateSiteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tagline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  about?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({ example: 'pay.acmetraders.in' })
  @IsOptional()
  @IsString()
  custom_domain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;
}

@ApiTags('sites')
@Controller('sites')
export class SitesController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Public()
  @Get('resolve')
  @ApiOkResponse({
    description:
      'Host classification plus a published site, or site: null. Uses get_site_by_host for tenant subdomains and custom domains.',
  })
  async resolve(@Query() query: ResolveQueryDto) {
    const appDomain = this.config.get<string>('ROOT_DOMAIN') ?? this.config.get<string>('APP_DOMAIN') ?? 'billflow.com';
    const resolution = resolveHost(query.host, { appDomain });
    if (resolution.kind !== 'tenant-subdomain' && resolution.kind !== 'custom-domain') {
      return { resolution, site: null };
    }
    const { data, error } = await this.supabase.anonClient().rpc('get_site_by_host', { p_host: query.host });
    raiseSupabase(error);
    return { resolution, site: data };
  }

  @ApiBearerAuth()
  @Get('current')
  async current(@CurrentUser() user: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(user.token);
    const { data, error } = await this.supabase
      .userClient(user.token)
      .from('sites')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    raiseSupabase(error);
    return data;
  }

  @ApiBearerAuth()
  @Patch('current')
  async update(@CurrentUser() user: AuthContext, @Body() dto: UpdateSiteDto) {
    if (dto.custom_domain) await this.entitlements.assertFeature(user, 'custom_domains');
    const tenantId = await this.supabase.currentTenantId(user.token);
    const { data, error } = await this.supabase
      .userClient(user.token)
      .from('sites')
      .update(dto)
      .eq('tenant_id', tenantId)
      .select('*')
      .maybeSingle();
    raiseSupabase(error);
    return data;
  }
}
