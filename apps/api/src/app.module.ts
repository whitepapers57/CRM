import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { CashModule } from './cash/cash.module.js';
import { KadryModule } from './kadry/kadry.module.js';
import { MonthsModule } from './months/months.module.js';
import { SalesModule } from './sales/sales.module.js';
import { SalesdocModule } from './salesdoc/salesdoc.module.js';
import { SettlementsModule } from './settlements/settlements.module.js';
import { WarehouseModule } from './warehouse/warehouse.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    MonthsModule,
    SalesdocModule,
    ScheduleModule.forRoot(),
    SyncModule,
    SettlementsModule,
    WarehouseModule,
    SalesModule,
    CashModule,
    KadryModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
