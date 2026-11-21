import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { AuthContext } from '../common/auth-context';
import { CurrentUser, Public, RequiresFeature } from '../common/decorators';
import { CounterService } from './counter.service';

class SyncLineDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  product_id?: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty()
  @IsNumber()
  quantity!: number;

  @ApiProperty()
  @IsNumber()
  unit_price!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  gst_rate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  discount?: number;
}

class SyncPaymentDto {
  @ApiProperty()
  @IsUUID()
  client_id!: string;

  @ApiProperty()
  @IsString()
  method!: string;

  @ApiProperty()
  @IsNumber()
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount_tendered?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  change_given?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paid_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transaction_ref?: string;
}

class SyncSaleDto {
  @ApiProperty()
  @IsUUID()
  client_id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  device_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [SyncLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncLineDto)
  lines!: SyncLineDto[];

  @ApiPropertyOptional({ type: [SyncPaymentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncPaymentDto)
  payments?: SyncPaymentDto[];
}

class SyncSalesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  device_id?: string;

  @ApiProperty({ type: [SyncSaleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncSaleDto)
  sales!: SyncSaleDto[];
}

class ReminderPlanDto {
  @ApiProperty({ enum: ['whatsapp', 'sms', 'email'] })
  @IsIn(['whatsapp', 'sms', 'email'])
  channel!: 'whatsapp' | 'sms' | 'email';

  @ApiProperty({ type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  before_days!: number[];

  @ApiProperty()
  @IsBoolean()
  on_due!: boolean;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  after_days!: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  template?: string;
}

class VoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  audio_base64?: string;

  @ApiPropertyOptional({ enum: ['en', 'bn'] })
  @IsOptional()
  @IsIn(['en', 'bn'])
  locale?: 'en' | 'bn';
}

class PurchaseLineDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  product_id?: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty()
  @IsNumber()
  quantity!: number;

  @ApiProperty()
  @IsNumber()
  unit_price!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  gst_rate?: number;
}

class PurchaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bill_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  gst_rate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photo_ref?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [PurchaseLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];
}

class CategoryDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  sort_order?: number;
}

class BillDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image_base64?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  filename?: string;
}

@ApiTags('counter')
@Controller()
export class CounterController {
  constructor(private readonly counter: CounterService) {}

  @ApiBearerAuth()
  @Post('sync/sales')
  @ApiBody({ type: SyncSalesDto })
  sync(@CurrentUser() user: AuthContext, @Body() dto: SyncSalesDto) {
    return this.counter.sync(user, dto.sales, dto.device_id);
  }

  @ApiBearerAuth()
  @Get('pos/tiles')
  tiles(@CurrentUser() user: AuthContext, @Query('category_id') categoryId?: string) {
    return this.counter.tiles(user, categoryId);
  }

  @ApiBearerAuth()
  @Get('purchases')
  purchases(@CurrentUser() user: AuthContext) {
    return this.counter.purchases(user);
  }

  @ApiBearerAuth()
  @Post('purchases')
  @ApiBody({ type: PurchaseDto })
  savePurchase(@CurrentUser() user: AuthContext, @Body() dto: PurchaseDto) {
    return this.counter.savePurchase(user, dto as unknown as Record<string, unknown>);
  }

  @ApiBearerAuth()
  @RequiresFeature('product_catalog')
  @Get('product-categories')
  categories(@CurrentUser() user: AuthContext) {
    return this.counter.categories(user);
  }

  @ApiBearerAuth()
  @RequiresFeature('product_catalog')
  @Post('product-categories')
  @ApiBody({ type: CategoryDto })
  createCategory(@CurrentUser() user: AuthContext, @Body() dto: CategoryDto) {
    return this.counter.saveCategory(user, dto);
  }

  @ApiBearerAuth()
  @RequiresFeature('product_catalog')
  @Put('product-categories/:id')
  @ApiBody({ type: CategoryDto })
  updateCategory(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryDto) {
    return this.counter.saveCategory(user, dto, id);
  }

  @ApiBearerAuth()
  @RequiresFeature('product_catalog')
  @Delete('product-categories/:id')
  deleteCategory(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.counter.deleteCategory(user, id);
  }

  @ApiBearerAuth()
  @Get('dashboard/morning')
  morning(@CurrentUser() user: AuthContext) {
    return this.counter.morning(user);
  }

  @ApiBearerAuth()
  @Get('invoices/:id/events')
  events(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.counter.events(user, id);
  }

  @ApiBearerAuth()
  @Get('reminders/plan')
  plan(@CurrentUser() user: AuthContext) {
    return this.counter.reminderPlan(user);
  }

  @ApiBearerAuth()
  @RequiresFeature('auto_reminders')
  @Put('reminders/plan')
  @ApiBody({ type: ReminderPlanDto })
  savePlan(@CurrentUser() user: AuthContext, @Body() dto: ReminderPlanDto) {
    return this.counter.saveReminderPlan(user, dto);
  }

  @ApiBearerAuth()
  @Post('customers/:id/ledger-link')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  createLink(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.counter.createLedgerLink(user, id);
  }

  @ApiBearerAuth()
  @Post('customers/:id/ledger-link/revoke')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  revokeLink(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.counter.revokeLedgerLink(user, id);
  }

  @Public()
  @Get('public/ledger/:token')
  ledger(@Param('token') token: string) {
    return this.counter.publicLedger(token);
  }

  @Public()
  @Post('public/ledger/:token/upi')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  ledgerUpi(@Param('token') token: string) {
    return this.counter.publicLedgerUpi(token);
  }

  @ApiBearerAuth()
  @Post('voice/parse')
  @ApiBody({ type: VoiceDto })
  voice(@CurrentUser() user: AuthContext, @Body() dto: VoiceDto) {
    return this.counter.parseVoice(user, dto);
  }

  @ApiBearerAuth()
  @Post('purchases/parse')
  @ApiBody({ type: BillDto })
  bill(@Body() dto: BillDto) {
    return this.counter.parseBill(dto);
  }

  @Public()
  @Get('i18n/labels')
  i18n(@Query('locale') locale?: string) {
    return this.counter.dictionary(locale);
  }
}
