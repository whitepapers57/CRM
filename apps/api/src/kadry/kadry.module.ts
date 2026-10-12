import { Module } from '@nestjs/common';
import { KadryController } from './kadry.controller.js';
import { EmployeesService } from './employees.service.js';
import { SalesdocLinksService } from './salesdoc-links.service.js';
import { KadryStatsService } from './kadry-stats.service.js';
import { StructureService } from './structure.service.js';

@Module({ controllers: [KadryController], providers: [StructureService, EmployeesService, SalesdocLinksService, KadryStatsService], exports: [StructureService, EmployeesService, SalesdocLinksService, KadryStatsService] })
export class KadryModule {}
