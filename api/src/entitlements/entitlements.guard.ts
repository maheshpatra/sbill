import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, REQUIRES_FEATURE } from '../common/decorators';
import { EntitlementsService } from './entitlements.service';

@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const feature = this.reflector.getAllAndOverride<string>(REQUIRES_FEATURE, [context.getHandler(), context.getClass()]);
    if (!feature) return true;
    const request = context.switchToHttp().getRequest();
    if (!request.user) return true;
    await this.entitlements.assertFeature(request.user, feature);
    return true;
  }
}
