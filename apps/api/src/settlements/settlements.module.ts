import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module.js';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [SyncModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
})
export class SettlementsModule {}
