import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { WebhookDispatcher } from './dispatcher.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [EntitlementsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcher],
  exports: [WebhookDispatcher],
})
export class WebhooksModule {}
