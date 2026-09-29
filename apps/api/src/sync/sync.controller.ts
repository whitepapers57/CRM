import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Post } from '@nestjs/common';
import { SyncService, type SyncKind } from './sync.service.js';

@Controller('sync')
export class SyncController {
  private readonly log = new Logger(SyncController.name);

  constructor(private readonly sync: SyncService) {}

  @Get('status')
  status() {
    return this.sync.status();
  }

  /**
   * Starts a run and answers at once; progress is read from GET /sync/status.
   * A full load takes minutes — waiting for it timed the request out.
   */
  @Post('run')
  @HttpCode(202)
  run(@Body() body: { kind?: SyncKind } = {}) {
    const kind = body.kind ?? 'incremental';
    if (kind !== 'incremental' && kind !== 'full') {
      throw new BadRequestException('kind must be "incremental" or "full"');
    }
    if (kind === 'incremental' && this.sync.isRunning()) return { alreadyRunning: true };
    this.sync.run(kind).catch((e: unknown) => this.log.error(`sync ${kind} failed: ${String(e)}`));
    return { started: true, kind };
  }
}
