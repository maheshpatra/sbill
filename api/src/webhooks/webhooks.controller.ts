import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { WebhookBodyDto, WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.webhooks.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: WebhookBodyDto) {
    return this.webhooks.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WebhookBodyDto,
  ) {
    return this.webhooks.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.remove(user, id);
  }

  @Get(':id/deliveries')
  deliveries(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.deliveries(user, id);
  }
}
