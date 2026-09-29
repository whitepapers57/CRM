"use server";

import { revalidatePath } from "next/cache";
import { apiPost } from "@/lib/api";

export async function runSync(kind: "incremental" | "full"): Promise<{ ok: boolean; alreadyRunning?: boolean; message?: string }> {
  const res = await apiPost<{ alreadyRunning?: true }>("/sync/run", { kind });
  revalidatePath("/", "layout");
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, alreadyRunning: res.data.alreadyRunning === true };
}
