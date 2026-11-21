import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CommerceModule } from '../commerce/commerce.module';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';

@Module({ imports: [CommerceModule, BillingModule], controllers: [CronController], providers: [CronService] })
export class CronModule {}
