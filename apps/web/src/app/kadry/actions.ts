"use server";

import { revalidatePath } from "next/cache";
import { apiDelete, apiPost, apiPut } from "@/lib/api";
import type { EmployeeForm } from "@/lib/kadry-rules";

type Result = { ok: boolean; message?: string; field?: string; code?: string };
type Raw = { ok: boolean; message?: string; field?: string; code?: string };
const failure = (r: Raw): Result => ({ ok: false, message: r.message, ...(r.field ? { field: r.field } : {}), ...(r.code ? { code: r.code } : {}) });
const done = (r: Raw): Result => {
  revalidatePath("/kadry", "layout");
  return r.ok ? { ok: true } : failure(r);
};
const path = (base: string, id: string | null) => (id ? `${base}/${encodeURIComponent(id)}` : base);

// Saves are FULL REPLACE on the API: always send every field.
export interface DepartmentBody { name: string; sortOrder: number; headEmployeeId: string | null }
export interface PositionBody { name: string; departmentId: string | null; description: string | null; sortOrder: number; startTime: string | null; workdays: number[] }
export interface ReasonBody { label: string; sortOrder: number; active: boolean }

export async function saveDepartment(id: string | null, body: DepartmentBody) {
  return done(await (id ? apiPut : apiPost)(path("/kadry/departments", id), body));
}
export async function deleteDepartment(id: string) {
  return done(await apiDelete(path("/kadry/departments", id)));
}
export async function savePosition(id: string | null, body: PositionBody) {
  return done(await (id ? apiPut : apiPost)(path("/kadry/positions", id), body));
}
export async function deletePosition(id: string) {
  return done(await apiDelete(path("/kadry/positions", id)));
}
export async function saveReason(id: string | null, body: ReasonBody) {
  return done(await (id ? apiPut : apiPost)(path("/kadry/reasons", id), body));
}

// Employees. PUT is FULL REPLACE of the editable fields (status is not changed by it), so the form always carries every field.
// "" goes out as null; numbers stay typed strings (the API strips spaces and accepts a decimal comma).
function toBody(form: EmployeeForm, withStatus: boolean) {
  const { status, workSchedule, remote, ...rest } = form;
  const text = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));
  return { ...text, lastName: form.lastName.trim(), firstName: form.firstName.trim(), remote, workSchedule, ...(withStatus ? { status } : {}) };
}
export async function createEmployee(form: EmployeeForm): Promise<Result & { id?: string }> {
  const r = await apiPost<{ id: string }>("/kadry/employees", toBody(form, true));
  revalidatePath("/kadry", "layout");
  return r.ok ? { ok: true, id: r.data.id } : failure(r);
}
export async function updateEmployee(id: string, form: EmployeeForm): Promise<Result> {
  return done(await apiPut(path("/kadry/employees", id), toBody(form, false)));
}

// Status changes and deletion.
const emp = (id: string) => path("/kadry/employees", id);
export async function dismissEmployee(id: string, reasonId: string) {
  return done(await apiPost(`${emp(id)}/dismiss`, { reasonId }));
}
export async function restoreEmployee(id: string) {
  return done(await apiPost(`${emp(id)}/restore`, {}));
}
export async function makePermanent(id: string) {
  return done(await apiPost(`${emp(id)}/make-permanent`, {}));
}
export async function deleteEmployee(id: string) {
  return done(await apiDelete(emp(id)));
}

// Relatives and diplomas: saves are FULL REPLACE (a field not sent becomes null), so the dialogs send every field.
export interface RelativeBody { relation: string; fullName: string | null; birthDate: string | null; workplacePosition: string | null; residenceAddress: string | null; phone: string | null }
export interface DiplomaBody { degree: string | null; institution: string | null; specialty: string | null; enrolledYear: number | null; graduatedYear: number | null; seriesNumber: string | null; issuedDate: string | null; status: string | null }
export async function saveRelative(id: string, rid: string | null, body: RelativeBody) {
  return done(await (rid ? apiPut : apiPost)(path(`${emp(id)}/relatives`, rid), body));
}
export async function deleteRelative(id: string, rid: string) {
  return done(await apiDelete(path(`${emp(id)}/relatives`, rid)));
}
export async function saveDiploma(id: string, did: string | null, body: DiplomaBody) {
  return done(await (did ? apiPut : apiPost)(path(`${emp(id)}/diplomas`, did), body));
}
export async function deleteDiploma(id: string, did: string) {
  return done(await apiDelete(path(`${emp(id)}/diplomas`, did)));
}

// Salesdoc accounts.
export async function linkAccount(id: string, kind: string, sdId: string) {
  return done(await apiPost(`${emp(id)}/salesdoc`, { kind, sdId }));
}
export async function unlinkAccount(id: string, kind: string, sdId: string) {
  return done(await apiDelete(`${emp(id)}/salesdoc/${encodeURIComponent(kind)}/${encodeURIComponent(sdId)}`));
}
