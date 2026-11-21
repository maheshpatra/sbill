import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { EntitlementCacheMiddleware } from './cache';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsGuard } from './entitlements.guard';
import { EntitlementsService } from './entitlements.service';

@Module({
  controllers: [EntitlementsController],
  providers: [EntitlementsService, EntitlementsGuard],
  exports: [EntitlementsService, EntitlementsGuard],
})
export class EntitlementsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(EntitlementCacheMiddleware).forRoutes('*');
  }
}
