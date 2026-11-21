import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [EntitlementsModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
