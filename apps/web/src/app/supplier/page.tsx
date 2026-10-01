import { redirect } from "next/navigation";
import { qs } from "@/lib/api";

/** Moved to Закупки → Поставщики: app/zakupki/postavshiki (spec 2026-10-01 §3.6). */
export default async function OldSupplierPage({ searchParams }: PageProps<"/supplier">) {
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  redirect(`/zakupki/postavshiki${qs({ from, to })}`);
}
