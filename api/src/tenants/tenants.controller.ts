import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { CreateTenantDto, InviteMemberDto, SwitchTenantDto, UpdateMemberDto, UpdateTenantDto } from './dto';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  @ApiOkResponse({
    description:
      'RPC create_tenant result: { id, name, slug, plan, status, currency, role, membership_id, created_at }.',
  })
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateTenantDto) {
    return this.tenants.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.tenants.listMine(user);
  }

  @Get('current')
  current(@CurrentUser() user: AuthContext) {
    return this.tenants.current(user);
  }

  @Patch('current')
  update(@CurrentUser() user: AuthContext, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(user, dto);
  }

  @Post('switch')
  switchTenant(@CurrentUser() user: AuthContext, @Body() dto: SwitchTenantDto) {
    return this.tenants.switch(user, dto);
  }

  @Get('members')
  members(@CurrentUser() user: AuthContext) {
    return this.tenants.members(user);
  }

  @Post('members')
  invite(@CurrentUser() user: AuthContext, @Body() dto: InviteMemberDto) {
    return this.tenants.invite(user, dto);
  }

  @Patch('members/:id')
  updateMember(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.tenants.updateMember(user, id, dto);
  }

  @Delete('members/:id')
  removeMember(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.removeMember(user, id);
  }
}
