import { Module } from '@nestjs/common';
import { SalesdocModule } from '../salesdoc/salesdoc.module.js';
import { PurchaseEditService } from './purchase-edit.service.js';
import { WarehouseController } from './warehouse.controller.js';
import { WarehouseService } from './warehouse.service.js';

@Module({
  imports: [SalesdocModule],
  controllers: [WarehouseController],
  providers: [WarehouseService, PurchaseEditService],
})
export class WarehouseModule {}
