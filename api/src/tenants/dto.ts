import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MinLength } from 'class-validator';
import { normalizeGstin } from '@billflow/gst';

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_MESSAGE = 'Enter a valid 15-character GSTIN, for example 22AAAAA0000A1ZC, or leave the field blank.';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Traders' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 'acme', description: 'Lowercase kebab-case. Becomes the public site subdomain.' })
  @IsString()
  @Matches(SLUG, { message: 'slug must be lowercase kebab-case' })
  slug!: string;
}

export class SwitchTenantDto {
  @ApiProperty()
  @IsUUID()
  tenant_id!: string;
}

export class UpdateTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legal_name?: string;

  @ApiPropertyOptional({ nullable: true, example: '22AAAAA0000A1ZC' })
  @Transform(({ value }) => (typeof value === 'string' ? normalizeGstin(value) : value))
  @IsOptional()
  @IsString()
  @Matches(GSTIN_FORMAT, { message: GSTIN_MESSAGE })
  gstin?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address_line1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address_line2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state_code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pincode?: string;

  @ApiPropertyOptional({ example: 'acme@okhdfcbank' })
  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, { message: 'Enter a UPI VPA such as shop@okhdfcbank' })
  upi_vpa?: string | null;

  @ApiPropertyOptional({ example: 'Acme Traders' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  upi_payee_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logo_url?: string;

  @ApiPropertyOptional({ example: 'classic' })
  @IsOptional()
  @IsString()
  default_template?: string;

  @ApiPropertyOptional({ example: 'INV' })
  @IsOptional()
  @IsString()
  @Length(1, 12)
  invoice_prefix?: string;
}

export class InviteMemberDto {
  @ApiProperty({ example: 'billing@acmetraders.example' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['admin', 'billing', 'member'] })
  @IsIn(['admin', 'billing', 'member'])
  role!: 'admin' | 'billing' | 'member';
}

export class UpdateMemberDto {
  @ApiProperty({ enum: ['admin', 'billing', 'member', 'owner'] })
  @IsIn(['admin', 'billing', 'member', 'owner'])
  role!: 'admin' | 'billing' | 'member' | 'owner';
}
