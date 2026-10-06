import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { CashRefsService } from './cash-refs.service.js';

@Controller('cash')
export class CashController {
  constructor(private readonly refs: CashRefsService) {}

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
