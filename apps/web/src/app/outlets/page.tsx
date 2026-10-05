import { redirect } from "next/navigation";
import { qs } from "@/lib/api";

/** «Торговые точки» became Продажи → Покупатели on 5 Oct 2026; old links keep their filters. */
export default async function Moved({ searchParams }: PageProps<"/outlets">) {
  const sp = await searchParams;
  redirect(`/prodazhi/pokupateli${qs(Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, typeof v === "string" ? v : undefined])))}`);
}
