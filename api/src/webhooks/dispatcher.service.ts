import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AuthContext } from '../common/auth-context';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(private readonly supabase: SupabaseService) {}

  async dispatch(auth: AuthContext, event: string, data: unknown) {
    try {
      const client = this.supabase.userClient(auth.token);
      const tenantId = await this.supabase.currentTenantId(auth.token);
      const { data: endpoints, error } = await client
        .from('webhook_endpoints')
        .select('id, url, secret, events, active')
        .eq('tenant_id', tenantId)
        .eq('active', true);
      if (error || !endpoints?.length) return;

      const body = JSON.stringify({
        id: crypto.randomUUID(),
        type: event,
        created_at: new Date().toISOString(),
        data,
      });

      await Promise.all(
        endpoints
          .filter((endpoint) => endpoint.events?.includes(event) || endpoint.events?.includes('*'))
          .map((endpoint) => this.deliver(tenantId, endpoint, event, body)),
      );
    } catch (error) {
      this.logger.warn(`webhook dispatch skipped: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async deliver(
    tenantId: string,
    endpoint: { id: string; url: string; secret: string },
    event: string,
    body: string,
  ) {
    const signature = `sha256=${createHmac('sha256', endpoint.secret).update(body).digest('hex')}`;
    let status: 'succeeded' | 'failed' = 'failed';
    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-billflow-event': event,
          'x-billflow-signature': signature,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      responseStatus = response.status;
      responseBody = (await response.text()).slice(0, 2000);
      status = response.ok ? 'succeeded' : 'failed';
    } catch (error) {
      responseBody = (error instanceof Error ? error.message : 'delivery failed').slice(0, 500);
    }

    const { error } = await this.supabase.serviceClient().from('webhook_deliveries').insert({
      tenant_id: tenantId,
      endpoint_id: endpoint.id,
      event,
      payload: JSON.parse(body),
      status,
      attempts: 1,
      response_status: responseStatus,
      response_body: responseBody,
    });
    if (error) this.logger.warn(`delivery log failed: ${error.message}`);
  }
}
