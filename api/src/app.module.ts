import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { EntitlementsGuard } from './entitlements/entitlements.guard';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CommerceModule } from './commerce/commerce.module';
import { CounterModule } from './counter/counter.module';
import { CronModule } from './cron/cron.module';
import { CustomersModule } from './customers/customers.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { SitesModule } from './sites/sites.module';
import { StorageModule } from './storage/storage.module';
import { SupabaseModule } from './supabase/supabase.module';
import { TaxRatesModule } from './tax-rates/tax-rates.module';
import { TenantsModule } from './tenants/tenants.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    ScheduleModule.forRoot(),
    SupabaseModule,
    HealthModule,
    AuthModule,
    AdminModule,
    StorageModule,
    TenantsModule,
    BillingModule,
    EntitlementsModule,
    CustomersModule,
    InvoicesModule,
    PaymentsModule,
    TaxRatesModule,
    SitesModule,
    WebhooksModule,
    CronModule,
    CommerceModule,
    CounterModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: EntitlementsGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
