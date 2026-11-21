import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthContext } from './auth-context';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRES_FEATURE = 'requiresFeature';
export const RequiresFeature = (feature: string) => SetMetadata(REQUIRES_FEATURE, feature);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest().user as AuthContext;
});
