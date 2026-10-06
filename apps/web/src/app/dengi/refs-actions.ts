"use server";

import { revalidatePath } from "next/cache";
import { apiPatch, apiPost, apiPut } from "@/lib/api";

type Result = { ok: boolean; message?: string };
const done = (r: { ok: boolean; message?: string }): Result => {
  revalidatePath("/dengi", "layout");
  return r.ok ? { ok: true } : { ok: false, message: r.message };
};
export async function addRef(kind: "categories" | "bank-accounts", body: { name: string; kind?: string }) {
  return done(await apiPost(`/cash/${kind}`, body));
}
export async function patchRef(kind: "categories" | "bank-accounts", id: string, body: { name?: string; active?: boolean }) {
  return done(await apiPatch(`/cash/${kind}/${encodeURIComponent(id)}`, body));
}
export async function setPaymentTypeAccount(sdId: string, account: "cash" | "bank") {
  return done(await apiPut(`/cash/payment-types/${encodeURIComponent(sdId)}`, { account }));
}
