import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { EmployeesService } from './employees.service.js';
import type { EmployeeInput } from './employee-rules.js';
import { StructureService } from './structure.service.js';

@Controller('kadry')
export class KadryController {
  constructor(
    private readonly structure: StructureService,
    private readonly employees: EmployeesService,
  ) {}

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
  @Get('employees') listEmployees(@Query('status') status?: string, @Query('department') departmentId?: string, @Query('position') positionId?: string, @Query('search') search?: string) {
    return this.employees.list({ status, departmentId: departmentId || undefined, positionId: positionId || undefined, search: search || undefined });
  }
  @Get('employees/:id') employee(@Param('id') id: string) { return this.employees.get(id); }
  @Post('employees') createEmployee(@Body() b: EmployeeInput, @CurrentUser() u: AuthUser) { return this.employees.create(b ?? {}, u); }
  @Put('employees/:id') @HttpCode(204) updateEmployee(@Param('id') id: string, @Body() b: EmployeeInput, @CurrentUser() u: AuthUser) { return this.employees.update(id, b ?? {}, u); }
  @Post('employees/:id/dismiss') @HttpCode(204) dismiss(@Param('id') id: string, @Body() b: { reasonId?: string }, @CurrentUser() u: AuthUser) { return this.employees.dismiss(id, b?.reasonId ?? '', u); }
  @Post('employees/:id/restore') @HttpCode(204) restore(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.employees.restore(id, u); }
  @Post('employees/:id/make-permanent') @HttpCode(204) makePermanent(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.employees.makePermanent(id, u); }
  @Delete('employees/:id') @HttpCode(204) removeEmployee(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.employees.remove(id, u); }
  @Post('employees/:id/relatives') addRelative(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.employees.saveRelative(id, null, b ?? {}, u); }
  @Put('employees/:id/relatives/:rid') @HttpCode(204) putRelative(@Param('id') id: string, @Param('rid') rid: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.employees.saveRelative(id, rid, b ?? {}, u).then(() => undefined); }
  @Delete('employees/:id/relatives/:rid') @HttpCode(204) delRelative(@Param('id') id: string, @Param('rid') rid: string, @CurrentUser() u: AuthUser) { return this.employees.deleteRelative(id, rid, u); }
  @Post('employees/:id/diplomas') addDiploma(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.employees.saveDiploma(id, null, b ?? {}, u); }
  @Put('employees/:id/diplomas/:did') @HttpCode(204) putDiploma(@Param('id') id: string, @Param('did') did: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.employees.saveDiploma(id, did, b ?? {}, u).then(() => undefined); }
  @Delete('employees/:id/diplomas/:did') @HttpCode(204) delDiploma(@Param('id') id: string, @Param('did') did: string, @CurrentUser() u: AuthUser) { return this.employees.deleteDiploma(id, did, u); }
  @Get('employees/:id/history') employeeHistory(@Param('id') id: string) { return this.employees.history(id); }
}
