import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { MonthsService } from './months.service.js';

@Controller('months')
export class MonthsController {
  constructor(private readonly months: MonthsService) {}

  @Get()
  list() {
    return this.months.list();
  }

  @Get('history')
  history() {
    return this.months.history();
  }

  @Post(':month/close')
  @HttpCode(204)
  close(@Param('month') month: string, @CurrentUser() user: AuthUser) {
    return this.months.setClosed(month, true, user);
  }

  @Post(':month/open')
  @HttpCode(204)
  open(@Param('month') month: string, @CurrentUser() user: AuthUser) {
    return this.months.setClosed(month, false, user);
  }
}
