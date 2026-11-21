import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PaymentsModule } from '../payments/payments.module';
import { InvoiceTemplatesController, InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [EntitlementsModule, PaymentsModule],
  controllers: [InvoicesController, InvoiceTemplatesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
