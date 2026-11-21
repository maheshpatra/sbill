import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from '../billing/billing.service';
import { CommerceService } from '../commerce/commerce.service';
import { raiseSupabase } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly commerce: CommerceService,
    private readonly billing: BillingService,
  ) {}

  async markOverdue() {
    const { data, error } = await this.supabase.serviceClient().rpc('mark_overdue_invoices');
    raiseSupabase(error);
    return { updated: data ?? 0 };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduled() {
    if (process.env.CRON_ENABLED !== 'true') return;
    try {
      const result = await this.markOverdue();
      const transitions = await this.billing.applyTransitions();
      const reminders = await this.commerce.runReminders();
      this.logger.log(`plan transitions ${JSON.stringify(transitions)}`);
      this.logger.log(`marked ${result.updated} invoices overdue; reminders ${JSON.stringify(reminders)}`);
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'overdue cron failed');
    }
  }
}
