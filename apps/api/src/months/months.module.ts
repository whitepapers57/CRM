import { Global, Module } from '@nestjs/common';
import { AuditController } from '../audit/audit.controller.js';
import { AuditService } from '../audit/audit.service.js';
import { MonthsController } from './months.controller.js';
import { MonthsService } from './months.service.js';

@Global()
@Module({
  controllers: [MonthsController, AuditController],
  providers: [AuditService, MonthsService],
  exports: [AuditService, MonthsService],
})
export class MonthsModule {}
