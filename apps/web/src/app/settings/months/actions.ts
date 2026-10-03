"use server";

import { revalidatePath } from "next/cache";
import { apiPost } from "@/lib/api";

export async function setMonth(month: string, closed: boolean): Promise<{ ok: boolean; message?: string }> {
  const res = await apiPost(`/months/${month}/${closed ? "close" : "open"}`);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, message: res.message };
}
