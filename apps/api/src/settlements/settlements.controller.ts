import { Controller, Get, Param, Query } from '@nestjs/common';
import { parsePeriod } from './period.js';
import { SettlementsService } from './settlements.service.js';

@Controller()
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('reconciliation/summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.settlements.summary(parsePeriod(from, to));
  }

  @Get('outlets/filters')
  filters() {
    return this.settlements.outletFilters();
  }

  @Get('outlets/balances')
  balances(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('expeditor') expeditor?: string,
    @Query('agent') agent?: string,
    @Query('nonZero') nonZero?: string,
    @Query('page') page?: string,
  ) {
    return this.settlements.outletBalances(parsePeriod(from, to), {
      search: search?.trim() || undefined,
      expeditor: expeditor || undefined,
      agent: agent || undefined,
      nonZero: nonZero === 'true',
      page: Math.max(1, Number(page) || 1),
    });
  }

  @Get('outlets/:sdId/statement')
  statement(@Param('sdId') sdId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.settlements.outletStatement(sdId, parsePeriod(from, to));
  }

  @Get('supplier/statement')
  supplier(@Query('from') from?: string, @Query('to') to?: string) {
    return this.settlements.supplierStatement(parsePeriod(from, to));
  }
}
