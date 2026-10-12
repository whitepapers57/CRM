import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';

// 2026-10-12: was const PREFIXES = ['purchase.', 'month.', 'cash.'];
const PREFIXES = ['purchase.', 'month.', 'cash.', 'hr.emp.', 'hr.struct.', 'hr.reason.'];

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query('actionPrefix') actionPrefix?: string, @Query('target') target?: string) {
    if (!actionPrefix || !PREFIXES.includes(actionPrefix)) throw new BadRequestException('Неверный раздел истории');
    return this.audit.list({ actionPrefix, target: target || undefined });
  }
}
