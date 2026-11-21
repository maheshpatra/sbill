import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { InvoiceRazorpayController, PaymentsController, RazorpaySettingsController, TenantRazorpayWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { TenantRazorpayService } from './tenant-razorpay.service';
import { ManualPaymentProvider, UpiPaymentProvider } from './providers';

@Module({
  imports: [EntitlementsModule, WebhooksModule],
  controllers: [PaymentsController, InvoiceRazorpayController, RazorpaySettingsController, TenantRazorpayWebhookController],
  providers: [PaymentsService, TenantRazorpayService, UpiPaymentProvider, ManualPaymentProvider],
  exports: [PaymentsService, TenantRazorpayService],
})
export class PaymentsModule {}
