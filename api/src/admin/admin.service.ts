import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AuthContext } from '../common/auth-context';
import { raiseSupabase } from '../common/supabase-error';
import { present, resolveCloudinary } from '../storage/providers';
import { StorageService } from '../storage/storage.service';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: StorageService,
  ) {}

  plans(auth: AuthContext) {
    return this.rpc(auth, 'admin_list_plans', {});
  }

  updatePlan(auth: AuthContext, code: string, patch: Record<string, unknown>) {
    return this.rpc(auth, 'admin_update_plan', { p_code: code, p_patch: patch });
  }

  listFeatures(auth: AuthContext, code: string) {
    return this.rpc(auth, 'admin_list_plan_features', { p_code: code });
  }

  replaceFeatures(auth: AuthContext, code: string, features: unknown[]) {
    return this.rpc(auth, 'admin_replace_plan_features', { p_code: code, p_features: features });
  }

  templates(auth: AuthContext) {
    return this.rpc(auth, 'admin_list_templates', {});
  }

  upsertTemplate(auth: AuthContext, key: string, patch: Record<string, unknown>) {
    return this.rpc(auth, 'admin_upsert_invoice_template', { p_key: key, p_patch: patch });
  }

  tenants(auth: AuthContext) {
    return this.rpc(auth, 'admin_list_tenants', {});
  }

  setStatus(auth: AuthContext, id: string, status: string) {
    return this.rpc(auth, 'admin_set_tenant_status', { p_tenant: id, p_status: status });
  }

  setPlan(auth: AuthContext, id: string, plan: string) {
    return this.rpc(auth, 'admin_set_tenant_plan', { p_tenant: id, p_code: plan });
  }

  async settings(auth: AuthContext) {
    const row = (await this.rpc(auth, 'admin_get_settings', {})) as Record<string, unknown>;
    const database = await this.storage.cloudinaryConfig(auth);
    return {
      ...row,
      storage: this.storage.settingsView(String(row.storage_provider ?? 'supabase'), database),
    };
  }

  async updateSettings(auth: AuthContext, patch: Record<string, unknown>) {
    const cloudinary = patch.cloudinary as Record<string, unknown> | undefined;
    if (cloudinary) {
      await this.rpc(auth, 'admin_set_cloudinary', { p_patch: cloudinary });
    }
    if (patch.storage_provider === 'cloudinary') {
      const database = await this.storage.cloudinaryConfig(auth);
      const resolved = resolveCloudinary({
        database,
        env: {
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          secret_set: Boolean(present(process.env.CLOUDINARY_API_SECRET)),
        },
      });
      if (!resolved.configured) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'Bad Request',
            code: 'STORAGE_PROVIDER_NOT_CONFIGURED',
            message: 'Set the Cloudinary cloud name, API key, and API secret before selecting Cloudinary.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const { cloudinary: _ignored, ...rest } = patch;
    if (Object.keys(rest).length === 0) return this.settings(auth);
    await this.rpc(auth, 'admin_update_settings', { p_patch: rest });
    return this.settings(auth);
  }

  private async rpc(auth: AuthContext, fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.supabase.userClient(auth.token).rpc(fn, args);
    raiseSupabase(error);
    return data;
  }
}
