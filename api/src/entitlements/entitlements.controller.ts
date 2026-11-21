import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS } from '@billflow/types';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { EntitlementsService } from './entitlements.service';

@ApiTags('entitlements')
@ApiBearerAuth()
@Controller('entitlements')
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get()
  @ApiOkResponse({
    description: `Active plan, feature flags, and usage. Feature keys: ${FEATURE_KEYS.join(', ')}. Numeric limits are null when unlimited.`,
  })
  get(@CurrentUser() user: AuthContext) {
    return this.entitlements.forUser(user);
  }
}
