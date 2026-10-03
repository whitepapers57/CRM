import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { parsePeriod } from '../settlements/period.js';
import { PurchaseEditService } from './purchase-edit.service.js';
import { WarehouseService } from './warehouse.service.js';

@Controller('warehouse')
export class WarehouseController {
  constructor(
    private readonly warehouse: WarehouseService,
    private readonly edit: PurchaseEditService,
  ) {}

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
  purchases(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('supplier') supplier?: string,
    @Query('warehouse') warehouse?: string,
    @Query('search') search?: string,
    @Query('includeHidden') includeHidden?: string,
  ) {
    return this.warehouse.purchases(parsePeriod(from, to), {
      includeHidden: includeHidden === 'true',
      supplier: supplier || undefined,
      warehouse: warehouse || undefined,
      search: search?.trim() || undefined,
    });
  }

  @Get('purchases/:sdId')
  purchase(@Param('sdId') sdId: string) {
    return this.warehouse.purchase(sdId);
  }

  @Delete('purchases/:sdId')
  @HttpCode(204)
  remove(@Param('sdId') sdId: string, @Body() body: { reason?: string } = {}, @CurrentUser() user: AuthUser) {
    return this.edit.remove(sdId, body.reason ?? '', user);
  }

  @Post('purchases/:sdId/restore')
  @HttpCode(204)
  restore(@Param('sdId') sdId: string, @CurrentUser() user: AuthUser) {
    return this.edit.restore(sdId, user);
  }

  @Get('purchases/:sdId/history')
  history(@Param('sdId') sdId: string) {
    return this.edit.history(sdId);
  }
}
