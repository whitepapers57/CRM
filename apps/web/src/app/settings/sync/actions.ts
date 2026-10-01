"use server";

import { revalidatePath } from "next/cache";
import { apiPost } from "@/lib/api";

/** Starts a sync; the API answers at once and the page follows progress via /sync/status. */
export async function runSync(kind: "incremental" | "full"): Promise<{ ok: boolean; alreadyRunning?: boolean; message?: string }> {
  const res = await apiPost<{ alreadyRunning?: true; started?: true }>("/sync/run", { kind });
  revalidatePath("/", "layout");
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, alreadyRunning: res.data.alreadyRunning === true };
}
