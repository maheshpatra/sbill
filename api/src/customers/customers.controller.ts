import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { CustomersService } from './customers.service';
import { CustomerBodyDto, CustomerQueryDto, UpdateCustomerDto } from './dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@CurrentUser() user: AuthContext, @Query() query: CustomerQueryDto) {
    return this.customers.list(user, query);
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: CustomerBodyDto) {
    return this.customers.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.remove(user, id);
  }
}
