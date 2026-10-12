import { Module } from '@nestjs/common';
import { KadryController } from './kadry.controller.js';
import { StructureService } from './structure.service.js';

@Module({ controllers: [KadryController], providers: [StructureService], exports: [StructureService] })
export class KadryModule {}
