import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthContext } from '../auth-context';
import { IS_PUBLIC } from '../decorators';
import { JwtVerifier } from '../../supabase/jwt.service';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const path: string = request.path ?? request.url ?? '';
    if (path === '/health' || path === '/openapi.json' || path.startsWith('/docs')) {
      return true;
    }

    const header = request.headers?.authorization as string | undefined;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    const payload = await this.jwt.verify(token);
    const appMeta = (payload.app_metadata ?? {}) as Record<string, unknown>;
    const tenantFromClaim = stringClaim(payload.tenant_id) ?? stringClaim(appMeta.tenant_id);
    const roleFromClaim = stringClaim(payload.user_role) ?? stringClaim(appMeta.user_role);
    const user: AuthContext = {
      id: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : undefined,
      token,
      tenantId: tenantFromClaim,
      tenantRole: roleFromClaim,
    };
    request.user = user;
    return true;
  }
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
