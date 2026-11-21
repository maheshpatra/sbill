import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PaymentsModule } from '../payments/payments.module';
import { StorageModule } from '../storage/storage.module';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { MessagingSettingsController } from './messaging-settings.controller';
import { MessagingSettingsService } from './messaging-settings.service';

@Module({
  imports: [EntitlementsModule, PaymentsModule, StorageModule],
  controllers: [CommerceController, MessagingSettingsController],
  providers: [CommerceService, MessagingSettingsService],
  exports: [CommerceService],
})
export class CommerceModule {}
