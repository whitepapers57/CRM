import { Controller, Get, Param, Query } from '@nestjs/common';
import { parsePeriod } from '../settlements/period.js';
import { WarehouseService } from './warehouse.service.js';

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get('stock')
  stock(
    @Query('warehouse') warehouse?: string,
    @Query('search') search?: string,
    @Query('includeZero') includeZero?: string,
  ) {
    return this.warehouse.stock({
      warehouse: warehouse || undefined,
      search: search?.trim() || undefined,
      includeZero: includeZero === 'true',
    });
  }

  @Get('purchases')
  purchases(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.purchases(parsePeriod(from, to));
  }

  @Get('purchases/:sdId')
  purchase(@Param('sdId') sdId: string) {
    return this.warehouse.purchase(sdId);
  }
}
