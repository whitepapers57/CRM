import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncService } from './sync.service.js';

const enabled = () => process.env.SYNC_SCHEDULE !== 'off';

@Injectable()
export class SyncScheduler {
  constructor(private readonly sync: SyncService) {}

  /** Changes since the last success; the very first run becomes a full load. */
  @Cron('*/15 * * * *', { timeZone: 'Asia/Tashkent' })
  async incremental() {
    if (enabled()) await this.sync.run('incremental');
  }

  /**
   * A nightly full pass removes records Salesdoc deleted and trims the window.
   * 03:07, off the 15-minute grid, so it does not collide with the tick.
   */
  @Cron('7 3 * * *', { timeZone: 'Asia/Tashkent' })
  async nightly() {
    if (enabled()) await this.sync.run('full');
  }
}
