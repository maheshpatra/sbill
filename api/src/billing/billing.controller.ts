import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { AuthContext } from '../common/auth-context';
import { CurrentUser, Public } from '../common/decorators';
import { BillingService } from './billing.service';
import { SubscribeDto } from './dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get('plans')
  @ApiOkResponse({
    description:
      'Public plan catalog. Each plan includes price_monthly, price_yearly (INR), and features (the entitlement keys).',
  })
  plans() {
    return this.billing.plans();
  }

  @ApiBearerAuth()
  @Get('subscription')
  subscription(@CurrentUser() user: AuthContext) {
    return this.billing.subscription(user);
  }

  @ApiBearerAuth()
  @Get('invoices')
  invoices(@CurrentUser() user: AuthContext) {
    return this.billing.invoices(user);
  }

  @ApiBearerAuth()
  @Post('checkout')
  checkout(@CurrentUser() user: AuthContext, @Body() dto: SubscribeDto) {
    return this.billing.checkout(user, dto);
  }

  @ApiBearerAuth()
  @Post('subscription')
  subscribe(@CurrentUser() user: AuthContext, @Body() dto: SubscribeDto) {
    return this.billing.schedule(user, dto);
  }

  @ApiBearerAuth()
  @Post('subscription/cancel')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  cancel(@CurrentUser() user: AuthContext) {
    return this.billing.cancel(user);
  }

}

@Controller()
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Post('public/billing/razorpay')
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  razorpay(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature = '',
    @Headers('x-razorpay-event-id') eventId = '',
    @Body() body: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } } },
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body));
    return this.billing.handleRazorpay(raw, signature, eventId || body.event || 'event', body);
  }
}
