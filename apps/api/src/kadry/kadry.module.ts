import { Module } from '@nestjs/common';
import { KadryController } from './kadry.controller.js';
import { EmployeesService } from './employees.service.js';
import { StructureService } from './structure.service.js';

@Module({ controllers: [KadryController], providers: [StructureService, EmployeesService], exports: [StructureService, EmployeesService] })
export class KadryModule {}
