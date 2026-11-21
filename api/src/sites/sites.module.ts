import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { SitesController } from './sites.controller';
import { WebsiteController } from './website.controller';

@Module({ imports: [EntitlementsModule], controllers: [SitesController, WebsiteController] })
export class SitesModule {}
