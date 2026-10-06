"use server";

import { revalidatePath } from "next/cache";
import { apiPost, apiPut } from "@/lib/api";

type Result = { ok: boolean; id?: string; message?: string };
const done = (res: { ok: boolean; message?: string }, id?: string): Result => {
  revalidatePath("/", "layout");
  return res.ok ? { ok: true, id } : { ok: false, message: res.message };
};

export async function saveCash(id: string | null, input: Record<string, unknown>): Promise<Result> {
  if (id) return done(await apiPut(`/cash/operations/${encodeURIComponent(id)}`, input), id);
  const res = await apiPost<{ id: string; number: string }>("/cash/operations", input);
  return done(res, res.ok ? res.data.id : undefined);
}
export async function cancelCash(id: string, reason: string): Promise<Result> {
  return done(await apiPost(`/cash/operations/${encodeURIComponent(id)}/cancel`, { reason }));
}
export async function restoreCash(id: string): Promise<Result> {
  return done(await apiPost(`/cash/operations/${encodeURIComponent(id)}/restore`));
}
