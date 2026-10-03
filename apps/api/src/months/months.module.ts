import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { MonthsController } from './months.controller.js';
import { MonthsService } from './months.service.js';

@Global()
@Module({
  controllers: [MonthsController],
  providers: [AuditService, MonthsService],
  exports: [AuditService, MonthsService],
})
export class MonthsModule {}
