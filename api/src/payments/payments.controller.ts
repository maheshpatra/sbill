import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { RawBodyRequest } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthContext } from '../common/auth-context';
import { CurrentUser, Public } from '../common/decorators';
import { ConfirmUpiDto, CreatePaymentDto, PaymentQueryDto } from './dto';
import { PaymentsService } from './payments.service';
import { TenantRazorpayService } from './tenant-razorpay.service';

class RazorpaySettingsDto {
  @ApiProperty({ example: 'rzp_test_key' })
  @IsString()
  @MinLength(8)
  key_id!: string;
  @ApiPropertyOptional({ description: 'Write-only. Omitted on later saves.' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  key_secret?: string;
  @ApiPropertyOptional({ description: 'Write-only.' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  webhook_secret?: string;
}

class RazorpayVerifyDto {
  @ApiProperty()
  @IsString()
  order_id!: string;
  @ApiProperty()
  @IsString()
  razorpay_payment_id!: string;
  @ApiProperty()
  @IsString()
  signature!: string;
}

class RazorpayCollectDto {
  @ApiProperty({ enum: ['checkout', 'link'] })
  @IsIn(['checkout', 'link'])
  mode!: 'checkout' | 'link';
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly razorpay: TenantRazorpayService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthContext, @Query() query: PaymentQueryDto) {
    return this.payments.list(user, query);
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: CreatePaymentDto) {
    return this.payments.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(user, id);
  }

  @Post(':id/confirm')
  @ApiBody({ type: ConfirmUpiDto })
  confirm(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmUpiDto) {
    return this.payments.confirmUpi(user, id, dto.utr);
  }

  @Post(':id/void')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  voidPayment(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.razorpay.voidPending(user, id);
  }

  @Post(':id/razorpay/verify')
  @ApiBody({ type: RazorpayVerifyDto })
  verify(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RazorpayVerifyDto,
  ) {
    return this.razorpay.verifyCheckout(user, id, dto.order_id, dto.razorpay_payment_id, dto.signature);
  }

  @Post(':id/refund')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  refund(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.razorpay.refund(user, id);
  }
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller('invoices')
export class InvoiceRazorpayController {
  constructor(private readonly razorpay: TenantRazorpayService) {}

  @Post(':id/razorpay')
  @ApiBody({ type: RazorpayCollectDto })
  collect(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RazorpayCollectDto) {
    return this.razorpay.startInvoice(user, id, dto.mode, dto.amount);
  }
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller('settings/razorpay')
export class RazorpaySettingsController {
  constructor(private readonly razorpay: TenantRazorpayService) {}

  @Get()
  get(@CurrentUser() user: AuthContext) {
    return this.razorpay.settings(user);
  }

  @Put()
  @ApiBody({ type: RazorpaySettingsDto })
  save(@CurrentUser() user: AuthContext, @Body() dto: RazorpaySettingsDto) {
    return this.razorpay.save(user, dto);
  }

  @Post('test')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  test(@CurrentUser() user: AuthContext) {
    return this.razorpay.test(user);
  }
}

@Controller()
export class TenantRazorpayWebhookController {
  constructor(private readonly razorpay: TenantRazorpayService) {}

  @Public()
  @Post('public/payments/razorpay/:tenantId')
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  webhook(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature = '',
    @Headers('x-razorpay-event-id') eventId = '',
    @Body() body: { event?: string },
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body));
    return this.razorpay.handleWebhook(tenantId, raw, signature, eventId || `${body.event ?? 'event'}:${raw.length}`, body);
  }
}
