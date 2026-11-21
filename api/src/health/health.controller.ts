import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', service: 'billflow-api', timestamp: '2026-11-20T00:00:00.000Z' },
    },
  })
  health() {
    return {
      status: 'ok',
      service: 'billflow-api',
      timestamp: new Date().toISOString(),
    };
  }
}
