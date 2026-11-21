import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { MessagingSettingsService } from './messaging-settings.service';

export class MessagingSettingsDto {
  @ApiProperty({ enum: ['none', 'msg91', 'twilio'] })
  @IsIn(['none', 'msg91', 'twilio'])
  sms_provider!: 'none' | 'msg91' | 'twilio';

  @ApiProperty({ enum: ['none', 'smtp', 'resend'] })
  @IsIn(['none', 'smtp', 'resend'])
  email_provider!: 'none' | 'smtp' | 'resend';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  msg91_sender_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  msg91_dlt_template_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  twilio_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  smtp_host?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  smtp_port?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  smtp_user?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resend_from?: string;

  @ApiPropertyOptional({ description: 'Write-only. Omitted values are left unchanged.' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  msg91_auth_key?: string;

  @ApiPropertyOptional({ description: 'Write-only.' })
  @IsOptional()
  @IsString()
  twilio_account_sid?: string;

  @ApiPropertyOptional({ description: 'Write-only.' })
  @IsOptional()
  @IsString()
  twilio_auth_token?: string;

  @ApiPropertyOptional({ description: 'Write-only.' })
  @IsOptional()
  @IsString()
  smtp_pass?: string;

  @ApiPropertyOptional({ description: 'Write-only.' })
  @IsOptional()
  @IsString()
  resend_api_key?: string;
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/messaging')
export class MessagingSettingsController {
  constructor(private readonly messaging: MessagingSettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthContext) {
    return this.messaging.get(user);
  }

  @Put()
  @ApiBody({ type: MessagingSettingsDto })
  save(@CurrentUser() user: AuthContext, @Body() dto: MessagingSettingsDto) {
    return this.messaging.save(user, dto);
  }
}
