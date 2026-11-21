import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';

class PlanPatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  price_monthly?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  price_yearly?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  price_monthly_paise?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  price_yearly_paise?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_public?: boolean;
}

class FeatureFlagDto {
  @ApiProperty()
  @IsString()
  feature_key!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  limit_value?: number | null;
}

class FeaturesDto {
  @ApiProperty({ type: [FeatureFlagDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureFlagDto)
  features!: FeatureFlagDto[];
}

class TemplatePatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  required_feature?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class StatusDto {
  @ApiProperty({ enum: ['active', 'suspended'] })
  @IsIn(['active', 'suspended'])
  status!: 'active' | 'suspended';
}

class PlanCodeDto {
  @ApiProperty()
  @IsString()
  plan!: string;
}

class CloudinarySettingsDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  cloud_name?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  api_key?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Write-only. Empty keeps the current secret. Null clears it.',
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  api_secret?: string | null;
}

class SettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  app_domain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dashboard_host?: string;

  @ApiPropertyOptional({ enum: ['supabase', 'cloudinary', 'r2'] })
  @IsOptional()
  @IsIn(['supabase', 'cloudinary', 'r2'])
  storage_provider?: 'supabase' | 'cloudinary' | 'r2';

  @ApiPropertyOptional({ type: CloudinarySettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CloudinarySettingsDto)
  cloudinary?: CloudinarySettingsDto;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('plans')
  plans(@CurrentUser() user: AuthContext) {
    return this.admin.plans(user);
  }

  @Patch('plans/:code')
  @ApiBody({ type: PlanPatchDto })
  updatePlan(@CurrentUser() user: AuthContext, @Param('code') code: string, @Body() dto: PlanPatchDto) {
    return this.admin.updatePlan(user, code, dto as unknown as Record<string, unknown>);
  }

  @Get('plans/:code/features')
  features(@CurrentUser() user: AuthContext, @Param('code') code: string) {
    return this.admin.listFeatures(user, code);
  }

  @Put('plans/:code/features')
  @ApiBody({ type: FeaturesDto })
  replaceFeatures(@CurrentUser() user: AuthContext, @Param('code') code: string, @Body() dto: FeaturesDto) {
    return this.admin.replaceFeatures(user, code, dto.features);
  }

  @Get('templates')
  templates(@CurrentUser() user: AuthContext) {
    return this.admin.templates(user);
  }

  @Put('templates/:key')
  @ApiBody({ type: TemplatePatchDto })
  template(@CurrentUser() user: AuthContext, @Param('key') key: string, @Body() dto: TemplatePatchDto) {
    return this.admin.upsertTemplate(user, key, dto as unknown as Record<string, unknown>);
  }

  @Get('tenants')
  tenants(@CurrentUser() user: AuthContext) {
    return this.admin.tenants(user);
  }

  @Post('tenants/:id/suspend')
  @ApiBody({ type: StatusDto })
  suspend(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.admin.setStatus(user, id, dto.status);
  }

  @Post('tenants/:id/plan')
  @ApiBody({ type: PlanCodeDto })
  plan(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: PlanCodeDto) {
    return this.admin.setPlan(user, id, dto.plan);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthContext) {
    return this.admin.settings(user);
  }

  @Patch('settings')
  @ApiBody({ type: SettingsDto })
  updateSettings(@CurrentUser() user: AuthContext, @Body() dto: SettingsDto) {
    return this.admin.updateSettings(user, dto as unknown as Record<string, unknown>);
  }
}
