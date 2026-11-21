import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { randomBytes } from 'crypto';
import { Resolver } from 'dns/promises';
import { AuthContext } from '../common/auth-context';
import { CurrentUser, RequiresFeature } from '../common/decorators';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { withHttpsSiteImages } from '../common/https-url';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';
import { RESERVED_SUBDOMAINS } from '@billflow/host-resolution';
import { BadRequestException } from '@nestjs/common';

class ApplyTemplateDto {
  @ApiProperty()
  @IsUUID()
  template_id!: string;
}

class DraftDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'hero_image_url and about_image_url must be https URLs or null.',
  })
  @IsObject()
  overrides!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  template_id?: string;
}

class SubdomainDto {
  @ApiProperty({ example: 'acme' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  subdomain!: string;
}

class DomainDto {
  @ApiProperty({ example: 'pay.example.com' })
  @IsString()
  domain!: string;
}

@ApiTags('website')
@ApiBearerAuth()
@Controller('website')
export class WebsiteController {
  private readonly dns = new Resolver();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private rootDomain() {
    return (this.config.get<string>('ROOT_DOMAIN') || this.config.get<string>('APP_DOMAIN') || 'billflow.com')
      .toLowerCase()
      .replace(/^\.+|\.+$/g, '');
  }

  @Get('templates')
  async templates(@CurrentUser() user: AuthContext) {
    const { data, error } = await this.supabase
      .userClient(user.token)
      .from('templates')
      .select('id, name, slug, description, config, preview_image_url')
      .eq('is_active', true)
      .order('name');
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  @Get()
  async current(@CurrentUser() user: AuthContext) {
    const client = this.supabase.userClient(user.token);
    const tenantId = await this.supabase.currentTenantId(user.token);
    const [tenant, settings, domains, templates, products] = await Promise.all([
      client.from('tenants').select('id, name, slug, subdomain, logo_url').eq('id', tenantId).single(),
      client
        .from('tenant_template_settings')
        .select('tenant_id, template_id, overrides, published_overrides, published_at, updated_at, template:templates(id, name, slug, config, preview_image_url)')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      client
        .from('tenant_domains')
        .select('id, domain, verified, verification_token, ssl_status, is_primary, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true }),
      client.from('templates').select('id, name, slug, description, config, preview_image_url').eq('is_active', true).order('name'),
      client.from('products').select('id, name, price, image_url').eq('tenant_id', tenantId).eq('active', true).order('name'),
    ]);
    raiseSupabase(tenant.error);
    raiseSupabase(settings.error);
    raiseSupabase(domains.error);
    raiseSupabase(templates.error);
    raiseSupabase(products.error);
    const root = this.rootDomain();
    return {
      tenant: tenant.data,
      settings: settings.data,
      domains: (domains.data ?? []).map((row) => this.withDns(row, root)),
      templates: templates.data ?? [],
      products: products.data ?? [],
      root_domain: root,
      cname_target: `sites.${root}`,
    };
  }

  @Post('template')
  async apply(@CurrentUser() user: AuthContext, @Body() dto: ApplyTemplateDto) {
    const client = this.supabase.userClient(user.token);
    const tenantId = await this.supabase.currentTenantId(user.token);
    const { data: template, error } = await client.from('templates').select('*').eq('id', dto.template_id).maybeSingle();
    raiseSupabase(error);
    if (!template) throw new BadRequestException('Unknown template');
    const overrides = {
      colors: template.config?.colors ?? {},
      fonts: template.config?.fonts ?? {},
      layout: template.config?.layout ?? {},
      sections: template.config?.sections ?? [],
    };
    const { data, error: saveError } = await client
      .from('tenant_template_settings')
      .upsert({ tenant_id: tenantId, template_id: template.id, overrides }, { onConflict: 'tenant_id' })
      .select('tenant_id, template_id, overrides, published_at')
      .single();
    raiseSupabase(saveError);
    return data;
  }

  @Put('draft')
  async draft(@CurrentUser() user: AuthContext, @Body() dto: DraftDto) {
    const client = this.supabase.userClient(user.token);
    const tenantId = await this.supabase.currentTenantId(user.token);
    const patch: Record<string, unknown> = { tenant_id: tenantId, overrides: withHttpsSiteImages(dto.overrides) };
    if (dto.template_id) patch.template_id = dto.template_id;
    const { data, error } = await client
      .from('tenant_template_settings')
      .upsert(patch, { onConflict: 'tenant_id' })
      .select('tenant_id, template_id, overrides, published_at, updated_at')
      .single();
    raiseSupabase(error);
    return data;
  }

  @Post('publish')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  async publish(@CurrentUser() user: AuthContext) {
    const client = this.supabase.userClient(user.token);
    const tenantId = await this.supabase.currentTenantId(user.token);
    const { data: current, error } = await client
      .from('tenant_template_settings')
      .select('overrides, template:templates(slug)')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    raiseSupabase(error);
    if (!current) throw new BadRequestException('Choose a template before publishing');
    const template = current.template as { slug?: string } | { slug?: string }[] | null;
    const slug = Array.isArray(template) ? template[0]?.slug : template?.slug;
    if (slug && slug !== 'classic') await this.entitlements.assertFeature(user, 'custom_templates');
    const { data, error: saveError } = await client
      .from('tenant_template_settings')
      .update({ published_overrides: current.overrides, published_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .select('tenant_id, published_at, published_overrides')
      .single();
    raiseSupabase(saveError);
    await client.from('sites').update({ published: true }).eq('tenant_id', tenantId);
    return data;
  }

  @Put('subdomain')
  async subdomain(@CurrentUser() user: AuthContext, @Body() dto: SubdomainDto) {
    if ((RESERVED_SUBDOMAINS as readonly string[]).includes(dto.subdomain)) {
      throw new BadRequestException('That subdomain is reserved');
    }
    const client = this.supabase.userClient(user.token);
    const tenantId = await this.supabase.currentTenantId(user.token);
    const { data, error } = await client
      .from('tenants')
      .update({ subdomain: dto.subdomain })
      .eq('id', tenantId)
      .select('id, slug, subdomain')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new BadRequestException('Only an owner or admin can change the subdomain');
    return { ...data, host: `${data.subdomain}.${this.rootDomain()}` };
  }

  @Get('domains')
  async domains(@CurrentUser() user: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(user.token);
    const { data, error } = await this.supabase
      .userClient(user.token)
      .from('tenant_domains')
      .select('id, domain, verified, verification_token, ssl_status, is_primary, created_at')
      .eq('tenant_id', tenantId);
    raiseSupabase(error);
    const root = this.rootDomain();
    return { data: (data ?? []).map((row) => this.withDns(row, root)), cname_target: `sites.${root}` };
  }

  @Post('domains')
  @RequiresFeature('custom_domains')
  async addDomain(@CurrentUser() user: AuthContext, @Body() dto: DomainDto) {
    await this.entitlements.assertUnderLimit(user, 'max_custom_domains');
    const domain = dto.domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    const root = this.rootDomain();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain === root || domain.endsWith(`.${root}`)) {
      throw new BadRequestException('Use a custom domain you control. Subdomains of the app belong in subdomain settings.');
    }
    const client = this.supabase.userClient(user.token);
    const tenantId = await this.supabase.currentTenantId(user.token);
    const token = `billflow-verify=${randomBytes(16).toString('hex')}`;
    const { data, error } = await client
      .from('tenant_domains')
      .insert({ tenant_id: tenantId, domain, verification_token: token, verified: false, ssl_status: 'pending' })
      .select('id, domain, verified, verification_token, ssl_status, is_primary, created_at')
      .single();
    raiseSupabase(error);
    return this.withDns(data, root);
  }

  @Post('domains/:id/verify')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  async verify(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const client = this.supabase.userClient(user.token);
    const { data: row, error } = await client
      .from('tenant_domains')
      .select('id, domain, verification_token, verified, ssl_status, is_primary, created_at')
      .eq('id', id)
      .maybeSingle();
    raiseSupabase(error);
    if (!row) throw new BadRequestException('Domain not found');
    const found = await this.txtHasToken(row.domain, row.verification_token);
    if (!found) {
      return { ...this.withDns(row, this.rootDomain()), verified: false, message: 'TXT record not found yet.' };
    }
    const { data, error: saveError } = await client
      .from('tenant_domains')
      .update({ verified: true, ssl_status: 'pending' })
      .eq('id', id)
      .select('id, domain, verified, verification_token, ssl_status, is_primary, created_at')
      .single();
    raiseSupabase(saveError);
    return { ...this.withDns(data, this.rootDomain()), message: 'Domain verified. Certificate issuance depends on your host.' };
  }

  @Delete('domains/:id')
  async removeDomain(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const { data, error } = await this.supabase
      .userClient(user.token)
      .from('tenant_domains')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new BadRequestException('Domain not found');
    return { deleted: true, id: data.id };
  }

  private withDns(
    row: {
      id: string;
      domain: string;
      verified: boolean;
      verification_token: string;
      ssl_status: string;
      is_primary: boolean;
      created_at: string;
    },
    root: string,
  ) {
    return {
      ...row,
      txt_host: `_billflow-verify.${row.domain}`,
      txt_value: row.verification_token,
      cname_host: row.domain,
      cname_target: `sites.${root}`,
    };
  }

  private async txtHasToken(domain: string, token: string) {
    try {
      const records = await this.dns.resolveTxt(`_billflow-verify.${domain}`);
      return records.some((parts) => parts.join('').includes(token));
    } catch {
      return false;
    }
  }
}
