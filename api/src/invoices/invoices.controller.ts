import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { CreateInvoiceDto, InvoiceQueryDto, UpdateInvoiceDto } from './dto';
import { InvoicesService } from './invoices.service';
import { CollectUpiDto, MarkPaidDto } from '../payments/dto';
import { PaymentsService } from '../payments/payments.service';

@ApiTags('invoices')
@ApiBearerAuth()
@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoice-templates')
export class InvoiceTemplatesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.invoices.templates(user);
  }
}

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthContext, @Query() query: InvoiceQueryDto) {
    return this.invoices.list(user, query);
  }

  @Post()
  @ApiOkResponse({ description: 'Draft invoice. amount, tax, and total are computed on the server from the lines.' })
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateInvoiceDto) {
    return this.invoices.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoices.update(user, id, dto);
  }

  @Post(':id/send')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  send(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.send(user, id);
  }

  @Post(':id/void')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  void(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.void(user, id);
  }

  @Post(':id/mark-paid')
  @ApiOkResponse({ description: 'Inserts a succeeded payment and returns the payment plus the updated invoice.' })
  markPaid(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.payments.markPaid(user, id, dto);
  }

  @Get(':id/upi')
  upi(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.collectUpi(user, id);
  }

  @Post(':id/upi')
  @ApiBody({ type: CollectUpiDto })
  collectUpi(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectUpiDto,
  ) {
    return this.payments.collectUpi(user, id, dto.amount);
  }
}
