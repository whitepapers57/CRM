"use server";

import { revalidatePath } from "next/cache";
import { apiDelete, apiPost, apiPut } from "@/lib/api";

type Result = { ok: boolean; message?: string };
const done = (res: { ok: boolean; message?: string }): Result => {
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, message: res.message };
};

export async function saveReceipt(
  sdId: string,
  input: { date: string; warehouseSdId: string; supplierSdId: string | null; lines: Array<{ productSdId: string; quantity: number; price: number }> },
): Promise<Result> {
  return done(await apiPut(`/warehouse/purchases/${encodeURIComponent(sdId)}`, input));
}

export async function deleteReceipt(sdId: string, reason: string): Promise<Result> {
  return done(await apiDelete(`/warehouse/purchases/${encodeURIComponent(sdId)}`, { reason }));
}

export async function restoreReceipt(sdId: string): Promise<Result> {
  return done(await apiPost(`/warehouse/purchases/${encodeURIComponent(sdId)}/restore`));
}
