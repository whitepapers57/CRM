import { redirect } from "next/navigation";
import { qs } from "@/lib/api";

/** Moved to Продажи → Покупатели on 5 Oct 2026. */
export default async function Moved({ params, searchParams }: PageProps<"/outlets/[sdId]">) {
  const { sdId } = await params;
  const sp = await searchParams;
  redirect(`/prodazhi/pokupateli/${encodeURIComponent(sdId)}${qs(Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, typeof v === "string" ? v : undefined])))}`);
}
