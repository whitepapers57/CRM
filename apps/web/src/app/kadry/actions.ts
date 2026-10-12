"use server";

import { revalidatePath } from "next/cache";
import { apiDelete, apiPost, apiPut } from "@/lib/api";

type Result = { ok: boolean; message?: string };
const done = (r: { ok: boolean; message?: string }): Result => {
  revalidatePath("/kadry", "layout");
  return r.ok ? { ok: true } : { ok: false, message: r.message };
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
