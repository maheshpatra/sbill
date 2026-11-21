import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthContext | undefined;
    if (!user?.token) throw new ForbiddenException('platform admin required');
    const { data, error } = await this.supabase.userClient(user.token).rpc('is_platform_admin');
    raiseSupabase(error);
    if (data !== true) throw new ForbiddenException('platform admin required');
    return true;
  }
}
