import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Put, Query, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { httpsImageUrl } from '../common/https-url';
import { AuthContext } from '../common/auth-context';
import { CurrentUser, Public, RequiresFeature } from '../common/decorators';
import { CommerceService } from './commerce.service';

class ShareDto {
  @IsOptional()
  @IsNumber()
  days?: number;
}

class WhatsappDto {
  @IsOptional()
  @IsString()
  phone_number_id?: string;
  @IsOptional()
  @IsString()
  waba_id?: string;
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
  @IsOptional()
  @IsString()
  @MinLength(8)
  access_token?: string;
}

class ScheduleRow {
  @IsNumber()
  offset_days!: number;
  @IsIn(['email', 'sms', 'whatsapp'])
  channel!: 'email' | 'sms' | 'whatsapp';
  @IsString()
  template!: string;
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class SchedulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleRow)
  schedules!: ScheduleRow[];
}

class ProductDto {
  @IsString()
  name!: string;
  @IsOptional()
  @IsString()
  sku?: string;
  @IsOptional()
  @IsString()
  barcode?: string;
  @IsOptional()
  @IsString()
  hsn_sac?: string;
  @IsOptional()
  @IsString()
  unit?: string;
  @IsNumber()
  price!: number;
  @IsNumber()
  gst_rate!: number;
  @IsOptional()
  @IsNumber()
  stock?: number;

  @IsOptional()
  @IsBoolean()
  favourite?: boolean;

  @IsOptional()
  @IsNumber()
  reorder_level?: number;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'https URL. Empty or null clears it.' })
  @IsOptional()
  @IsString()
  image_url?: string | null;
}

class PosSettingsDto {
  @IsNumber()
  default_tax_rate!: number;
  @IsString()
  receipt_footer!: string;
  @IsIn([58, 80])
  paper_width!: 58 | 80;
}

class CheckoutLine {
  @IsOptional()
  @IsUUID()
  product_id?: string;
  @IsString()
  description!: string;
  @IsNumber()
  quantity!: number;
  @IsNumber()
  unit_price!: number;
  @IsOptional()
  @IsNumber()
  discount?: number;
  @IsNumber()
  gst_rate!: number;
  @IsOptional()
  @IsString()
  hsn_sac?: string;
  @IsOptional()
  @IsString()
  unit?: string;
}

class CheckoutDto {
  @IsOptional()
  @IsUUID()
  customer_id?: string;
  @IsOptional()
  @IsString()
  walk_in_name?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutLine)
  lines!: CheckoutLine[];
  @IsIn(['cash', 'upi', 'card', 'razorpay'])
  method!: 'cash' | 'upi' | 'card' | 'razorpay';
  @IsOptional()
  @IsIn(['checkout', 'link'])
  online_mode?: 'checkout' | 'link';
  @IsOptional()
  @IsNumber()
  tendered?: number;
  @IsOptional()
  @IsNumber()
  change_given?: number;
  @IsOptional()
  @IsString()
  place_of_supply?: string;
}

class GstinDto {
  @IsString()
  gstin!: string;
}

@ApiTags('commerce')
@Controller()
export class CommerceController {
  constructor(
    private readonly commerce: CommerceService,
    private readonly config: ConfigService,
  ) {}

  @ApiBearerAuth()
  @Post('invoices/:id/share')
  share(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShareDto) {
    return this.commerce.createShare(user, id, dto.days ?? 30);
  }

  @ApiBearerAuth()
  @Post('invoices/:id/share/revoke')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  revoke(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.commerce.revokeShare(user, id);
  }

  @Public()
  @Get('public/invoices/:token')
  publicInvoice(@Param('token') token: string) {
    return this.commerce.publicInvoice(token);
  }

  @ApiBearerAuth()
  @Get('invoices/:id/pdf')
  async pdf(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.commerce.invoicePdf(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @ApiBearerAuth()
  @Post('invoices/:id/whatsapp')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  whatsapp(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.commerce.shareWhatsApp(user, id);
  }

  @ApiBearerAuth()
  @RequiresFeature('gst_invoices')
  @Post('invoices/:id/credit-note')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  credit(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.commerce.creditNote(user, id);
  }

  @ApiBearerAuth()
  @RequiresFeature('gst_invoices')
  @Post('invoices/:id/einvoice')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  einvoice(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.commerce.einvoiceStub(user, id);
  }

  @ApiBearerAuth()
  @Post('gstin/validate')
  gstin(@Body() dto: GstinDto) {
    return this.commerce.validateGstin(dto.gstin);
  }

  @ApiBearerAuth()
  @RequiresFeature('reporting_dashboard')
  @Get('reports/gstr1')
  @Header('Content-Type', 'text/csv')
  gstr1(@CurrentUser() user: AuthContext, @Query('from') from: string, @Query('to') to: string) {
    return this.commerce.gstr1(user, from, to);
  }

  @Public()
  @Get('public/whatsapp/webhook')
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    if (mode === 'subscribe' && token && token === this.config.get('WHATSAPP_VERIFY_TOKEN')) return challenge;
    throw new UnauthorizedException('invalid webhook token');
  }

  @Public()
  @Post('public/whatsapp/webhook')
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async webhook(@Body() body: { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id: string; status: string }> } }> }> }, @Headers('x-webhook-secret') secret?: string) {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (expected && secret && secret !== expected) throw new UnauthorizedException('invalid webhook token');
    const statuses = body.entry?.flatMap((entry) => entry.changes ?? []).flatMap((change) => change.value?.statuses ?? []) ?? [];
    for (const row of statuses) await this.commerce.applyWebhookStatus(row.id, row.status);
    return { received: statuses.length };
  }

  @ApiBearerAuth()
  @Get('settings/whatsapp')
  getWhatsapp(@CurrentUser() user: AuthContext) {
    return this.commerce.whatsappSettings(user);
  }

  @ApiBearerAuth()
  @Put('settings/whatsapp')
  saveWhatsapp(@CurrentUser() user: AuthContext, @Body() dto: WhatsappDto) {
    return this.commerce.saveWhatsapp(user, dto);
  }

  @ApiBearerAuth()
  @Get('reminders/schedules')
  schedules(@CurrentUser() user: AuthContext) {
    return this.commerce.schedules(user);
  }

  @ApiBearerAuth()
  @RequiresFeature('auto_reminders')
  @Put('reminders/schedules')
  saveSchedules(@CurrentUser() user: AuthContext, @Body() dto: SchedulesDto) {
    return this.commerce.replaceSchedules(user, dto.schedules);
  }

  @ApiBearerAuth()
  @Get('reminders/jobs')
  jobs(@CurrentUser() user: AuthContext) {
    return this.commerce.jobs(user);
  }

  @Public()
  @Post('internal/cron/reminders')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  runReminders(@Headers('x-cron-secret') secret?: string) {
    const expected = this.config.get<string>('CRON_SECRET');
    if (!expected || expected.startsWith('your-') || secret !== expected) throw new UnauthorizedException('invalid cron secret');
    return this.commerce.runReminders();
  }

  @ApiBearerAuth()
  @Get('products')
  products(@CurrentUser() user: AuthContext) {
    return this.commerce.products(user);
  }

  @ApiBearerAuth()
  @Get('products/:id')
  product(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.commerce.product(user, id);
  }

  @ApiBearerAuth()
  @RequiresFeature('product_catalog')
  @Post('products')
  createProduct(@CurrentUser() user: AuthContext, @Body() dto: ProductDto) {
    return this.commerce.saveProduct(user, productBody(dto));
  }

  @ApiBearerAuth()
  @Put('products/:id')
  updateProduct(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductDto) {
    return this.commerce.saveProduct(user, productBody(dto), id);
  }

  @ApiBearerAuth()
  @Get('pos/settings')
  posSettings(@CurrentUser() user: AuthContext) {
    return this.commerce.posSettings(user);
  }

  @ApiBearerAuth()
  @RequiresFeature('pos')
  @Put('pos/settings')
  savePos(@CurrentUser() user: AuthContext, @Body() dto: PosSettingsDto) {
    return this.commerce.savePosSettings(user, dto);
  }

  @ApiBearerAuth()
  @RequiresFeature('pos')
  @Post('pos/checkout')
  checkout(@CurrentUser() user: AuthContext, @Body() dto: CheckoutDto) {
    return this.commerce.checkout(user, dto);
  }
}

function productBody(dto: ProductDto) {
  const { favourite, image_url, ...rest } = dto;
  const image = httpsImageUrl(image_url, 'image_url');
  return {
    ...rest,
    ...(favourite === undefined ? {} : { is_favourite: favourite }),
    ...(image === undefined ? {} : { image_url: image }),
  };
}
