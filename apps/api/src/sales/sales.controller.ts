import { Controller, Get, Param, Query } from '@nestjs/common';
import { parsePeriod } from '../settlements/period.js';
import { SalesService } from './sales.service.js';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('orders')
  orders(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('warehouse') warehouse?: string,
    @Query('agent') agent?: string,
    @Query('search') search?: string,
  ) {
    return this.sales.orders(parsePeriod(from, to), {
      status: Number(status) || undefined,
      warehouse: warehouse || undefined,
      agent: agent || undefined,
      search: search?.trim() || undefined,
    });
  }

  @Get('orders/:sdId')
  order(@Param('sdId') sdId: string) {
    return this.sales.order(sdId);
  }
}
