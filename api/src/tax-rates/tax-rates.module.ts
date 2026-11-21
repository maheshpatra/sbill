import { Module } from '@nestjs/common';
import { TaxRatesController } from './tax-rates.controller';

@Module({ controllers: [TaxRatesController] })
export class TaxRatesModule {}
