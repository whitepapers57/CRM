import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { SyncService, type SyncKind } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('status')
  status() {
    return this.sync.status();
  }

  @Post('run')
  @HttpCode(200)
  run(@Body() body: { kind?: SyncKind } = {}) {
    const kind = body.kind ?? 'incremental';
    if (kind !== 'incremental' && kind !== 'full') {
      throw new BadRequestException('kind must be "incremental" or "full"');
    }
    return this.sync.run(kind);
  }
}
