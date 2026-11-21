import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [EntitlementsModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
