import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { SalesdocModule } from './salesdoc/salesdoc.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    SalesdocModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
