import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { SalesdocModule } from './salesdoc/salesdoc.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    SalesdocModule,
    ScheduleModule.forRoot(),
    SyncModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
