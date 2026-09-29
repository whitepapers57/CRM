import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller.js';
import { WarehouseService } from './warehouse.service.js';

@Module({
  controllers: [WarehouseController],
  providers: [WarehouseService],
})
export class WarehouseModule {}
