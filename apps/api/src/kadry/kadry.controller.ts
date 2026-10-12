import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { StructureService } from './structure.service.js';

@Controller('kadry')
export class KadryController {
  constructor(private readonly structure: StructureService) {}

  @Get('structure') getStructure() { return this.structure.structure(); }
  @Post('departments') addDepartment(@Body() b: { name?: string; sortOrder?: number; headEmployeeId?: string | null }, @CurrentUser() u: AuthUser) { return this.structure.saveDepartment(null, b ?? {}, u); }
  @Put('departments/:id') putDepartment(@Param('id') id: string, @Body() b: { name?: string; sortOrder?: number; headEmployeeId?: string | null }, @CurrentUser() u: AuthUser) { return this.structure.saveDepartment(id, b ?? {}, u); }
  @Delete('departments/:id') @HttpCode(204) delDepartment(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.structure.deleteDepartment(id, u); }
  @Post('positions') addPosition(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.structure.savePosition(null, b ?? {}, u); }
  @Put('positions/:id') putPosition(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.structure.savePosition(id, b ?? {}, u); }
  @Delete('positions/:id') @HttpCode(204) delPosition(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.structure.deletePosition(id, u); }
  @Get('reasons') getReasons() { return this.structure.reasons(); }
  @Post('reasons') addReason(@Body() b: { label?: string; sortOrder?: number; active?: boolean }, @CurrentUser() u: AuthUser) { return this.structure.saveReason(null, b ?? {}, u); }
  @Put('reasons/:id') putReason(@Param('id') id: string, @Body() b: { label?: string; sortOrder?: number; active?: boolean }, @CurrentUser() u: AuthUser) { return this.structure.saveReason(id, b ?? {}, u); }
}
