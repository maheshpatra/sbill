import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsObject, IsOptional, IsString, Matches, MinLength, ValidateNested } from 'class-validator';
import { normalizeGstin } from '@billflow/gst';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_MESSAGE = 'Enter a valid 15-character GSTIN, for example 22AAAAA0000A1ZC, or leave the field blank.';

export class AddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  line1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  line2?: string;

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

  @ApiPropertyOptional({ default: 'IN' })
  @IsOptional()
  @IsString()
  country?: string;
}

export class CustomerBodyDto {
  @ApiProperty({ example: 'Mehta & Co' })
  @IsString()
  @MinLength(1)
  name!: string;

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
  company?: string;

  @ApiPropertyOptional({ nullable: true, example: '22AAAAA0000A1ZC' })
  @Transform(({ value }) => (typeof value === 'string' ? normalizeGstin(value) : value))
  @IsOptional()
  @IsString()
  @Matches(GSTIN_FORMAT, { message: GSTIN_MESSAGE })
  gstin?: string | null;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  billing_address?: AddressDto;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  shipping_address?: AddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

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
  company?: string;

  @ApiPropertyOptional({ nullable: true, example: '22AAAAA0000A1ZC' })
  @Transform(({ value }) => (typeof value === 'string' ? normalizeGstin(value) : value))
  @IsOptional()
  @IsString()
  @Matches(GSTIN_FORMAT, { message: GSTIN_MESSAGE })
  gstin?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  billing_address?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  shipping_address?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, email, or company.' })
  @IsOptional()
  @IsString()
  q?: string;
}
