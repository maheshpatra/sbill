import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

const METHODS = ['upi', 'upi_qr', 'bank_transfer', 'cash', 'card', 'cheque', 'other'] as const;

export class MarkPaidDto {
  @ApiProperty({ example: 1180 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ enum: METHODS })
  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @ApiPropertyOptional({ example: 'UPI-ACME-INV-0001' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transaction_ref?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  paid_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Cash handed over by the customer.' })
  @IsOptional()
  @IsNumber()
  amount_tendered?: number;

  @ApiPropertyOptional({ description: 'Cash handed back. Omit to use tendered minus the amount due.' })
  @IsOptional()
  @IsNumber()
  change_given?: number;
}

export class CreatePaymentDto extends MarkPaidDto {
  @ApiProperty()
  @IsUUID()
  invoice_id!: string;
}

export class CollectUpiDto {
  @ApiPropertyOptional({ description: 'Amount to collect. Defaults to the outstanding balance.' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;
}

export class ConfirmUpiDto {
  @ApiPropertyOptional({ description: '12-digit UPI / UTR reference. Optional.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{12}$/, { message: 'UTR must be 12 digits' })
  utr?: string;
}

export class PaymentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  invoice_id?: string;

  @ApiPropertyOptional({ enum: ['pending', 'succeeded', 'failed', 'refunded'] })
  @IsOptional()
  @IsIn(['pending', 'succeeded', 'failed', 'refunded'])
  status?: string;
}
