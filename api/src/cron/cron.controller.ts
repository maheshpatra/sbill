import { Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { CronService } from './cron.service';

@ApiTags('internal')
@Controller('internal/cron')
export class CronController {
  constructor(
    private readonly cron: CronService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('mark-overdue')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  @ApiHeader({ name: 'x-cron-secret', required: true })
  @ApiOkResponse({ description: 'Flips sent invoices past due_at to overdue. Returns { updated }.' })
  markOverdue(@Headers('x-cron-secret') secret?: string) {
    const expected = this.config.get<string>('CRON_SECRET');
    if (!expected || expected.startsWith('your-') || secret !== expected) {
      throw new UnauthorizedException('invalid cron secret');
    }
    return this.cron.markOverdue();
  }
}
