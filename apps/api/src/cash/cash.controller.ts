import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { parsePeriod } from '../settlements/period.js';
import { CashRefsService } from './cash-refs.service.js';
import { CashService, type CashInput } from './cash.service.js';
import { isPage } from './operations.js';

@Controller('cash')
export class CashController {
  constructor(
    private readonly refs: CashRefsService,
    private readonly cash: CashService,
  ) {}

  private page(page: string) {
    if (!isPage(page)) throw new NotFoundException('Страница не найдена');
    return page;
  }

  @Get('pages/:page')
  list(@Param('page') page: string, @Query('from') from?: string, @Query('to') to?: string, @Query('operation') operation?: string, @Query('box') box?: string, @Query('search') search?: string, @Query('includeCancelled') includeCancelled?: string) {
    return this.cash.list(this.page(page), parsePeriod(from, to), { operation: operation || undefined, box: box || undefined, search: search?.trim() || undefined, includeCancelled: includeCancelled === 'true' });
  }
  @Get('pages/:page/history') pageHistory(@Param('page') page: string) { return this.cash.history(this.page(page)); }
  @Get('form-options') formOptions() { return this.cash.formOptions(); }
  @Get('operations/:id') get(@Param('id') id: string) { return this.cash.get(id); }
  @Get('operations/:id/history') opHistory(@Param('id') id: string) { return this.cash.historyOf(id); }
  @Post('operations') create(@Body() b: CashInput, @CurrentUser() user: AuthUser) { return this.cash.create(b ?? ({} as CashInput), user); }
  @Put('operations/:id') @HttpCode(204) update(@Param('id') id: string, @Body() b: CashInput, @CurrentUser() user: AuthUser) { return this.cash.update(id, b ?? ({} as CashInput), user); }
  @Post('operations/:id/cancel') @HttpCode(204) cancel(@Param('id') id: string, @Body() b: { reason?: string }, @CurrentUser() user: AuthUser) { return this.cash.cancel(id, b?.reason ?? '', user); }
  @Post('operations/:id/restore') @HttpCode(204) restore(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.cash.restore(id, user); }

  @Get('bank-accounts') bankAccounts() { return this.refs.bankAccounts(); }
  @Post('bank-accounts') addBankAccount(@Body() b: { name?: string }) { return this.refs.addBankAccount(b?.name ?? ''); }
  @Patch('bank-accounts/:id') @HttpCode(204)
  async patchBankAccount(@Param('id') id: string, @Body() b: { name?: string; active?: boolean }) {
    if (b?.name !== undefined) await this.refs.renameBankAccount(id, b.name);
    if (b?.active !== undefined) await this.refs.setBankAccountActive(id, !!b.active);
  }

  @Get('categories') categories() { return this.refs.categories(); }
  @Post('categories') addCategory(@Body() b: { name?: string; kind?: string }) { return this.refs.addCategory(b?.name ?? '', b?.kind ?? ''); }
  @Patch('categories/:id') @HttpCode(204)
  async patchCategory(@Param('id') id: string, @Body() b: { name?: string; active?: boolean }) {
    if (b?.name !== undefined) await this.refs.renameCategory(id, b.name);
    if (b?.active !== undefined) await this.refs.setCategoryActive(id, !!b.active);
  }

  @Get('payment-types') paymentTypes() { return this.refs.paymentTypeAccounts(); }
  @Put('payment-types/:sdId') @HttpCode(204)
  setPaymentType(@Param('sdId') sdId: string, @Body() b: { account?: string }) { return this.refs.setPaymentTypeAccount(sdId, b?.account ?? ''); }
}
