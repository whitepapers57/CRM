import { Module } from '@nestjs/common';
import { CashController } from './cash.controller.js';
import { CashRefsService } from './cash-refs.service.js';
import { CashService } from './cash.service.js';

@Module({ controllers: [CashController], providers: [CashRefsService, CashService], exports: [CashRefsService, CashService] })
export class CashModule {}
