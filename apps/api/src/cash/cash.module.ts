import { Module } from '@nestjs/common';
import { CashController } from './cash.controller.js';
import { CashRefsService } from './cash-refs.service.js';

// CashService is added in Task 3.
@Module({ controllers: [CashController], providers: [CashRefsService], exports: [CashRefsService] })
export class CashModule {}
