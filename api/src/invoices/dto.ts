import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

export class InvoiceItemInputDto {
  @ApiProperty({ example: 'Monthly bookkeeping retainer' })
  @IsString()
  @MinLength(1)
  description!: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @ApiProperty({ example: 10000, description: 'Tax-exclusive unit price in the invoice currency.' })
  @IsNumber()
  @Min(0)
  unit_price!: number;

  @ApiPropertyOptional({ description: 'Catalog tax rate. When set, the stored percent comes from tax_rates.' })
  @IsOptional()
  @IsUUID()
  tax_rate_id?: string;

  @ApiPropertyOptional({ example: 18, description: 'GST percent used when tax_rate_id is omitted.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tax_rate?: number;

  @ApiPropertyOptional({ example: '9982' })
  @IsOptional()
  @IsString()
  hsn_sac?: string;
}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsUUID()
  customer_id!: string;

  @ApiPropertyOptional({ enum: ['intra', 'inter'], default: 'intra' })
  @IsOptional()
  @IsIn(['intra', 'inter'])
  supply_type?: 'intra' | 'inter';

  @ApiPropertyOptional({ description: 'Tax-exclusive discount in rupees. Totals are computed on the server.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  terms?: string;

  @ApiPropertyOptional({ example: '27', description: 'GST place-of-supply state code.' })
  @IsOptional()
  @IsString()
  place_of_supply?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  due_at?: string;

  @ApiPropertyOptional({ default: 'INR' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: 'classic' })
  @IsOptional()
  @IsString()
  template_key?: string;

  @ApiProperty({ type: [InvoiceItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInputDto)
  items!: InvoiceItemInputDto[];
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  terms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  due_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  place_of_supply?: string;

  @ApiPropertyOptional({ example: 'classic' })
  @IsOptional()
  @IsString()
  template_key?: string;
}

export class InvoiceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'sent', 'paid', 'overdue', 'void'] })
  @IsOptional()
  @IsIn(['draft', 'sent', 'paid', 'overdue', 'void'])
  status?: string;

  @ApiPropertyOptional({ description: 'Invoice number search.' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customer_id?: string;
}
