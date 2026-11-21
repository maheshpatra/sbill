import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';

class TaxRateDto {
  @ApiProperty({ example: 'GST 18%' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 18 })
  @IsNumber()
  @Min(0)
  @Max(100)
  rate!: number;

  @ApiPropertyOptional({ enum: ['gst', 'igst', 'cgst', 'sgst', 'exempt', 'custom'] })
  @IsOptional()
  @IsIn(['gst', 'igst', 'cgst', 'sgst', 'exempt', 'custom'])
  tax_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

@ApiTags('tax-rates')
@ApiBearerAuth()
@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const tenantId = await this.supabase.currentTenantId(user.token);
    const { data, error } = await this.supabase
      .userClient(user.token)
      .from('tax_rates')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('rate', { ascending: true });
    raiseSupabase(error);
    return { data: data ?? [] };
  }

  @Post()
  async create(@CurrentUser() user: AuthContext, @Body() dto: TaxRateDto) {
    const tenantId = await this.supabase.currentTenantId(user.token);
    const { data, error } = await this.supabase
      .userClient(user.token)
      .from('tax_rates')
      .insert({ ...dto, tenant_id: tenantId, tax_type: dto.tax_type ?? 'gst' })
      .select('*')
      .single();
    raiseSupabase(error);
    return data;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TaxRateDto,
  ) {
    const { data, error } = await this.supabase
      .userClient(user.token)
      .from('tax_rates')
      .update(dto)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    raiseSupabase(error);
    if (!data) throw new NotFoundException('Tax rate not found');
    return data;
  }
}
