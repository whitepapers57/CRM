import { redirect } from "next/navigation";
import { apiGet, qs, type PurchaseList } from "@/lib/api";
import { tashkentToday, windowStartFor } from "@/lib/today";

/** «Накладная» in the Закупки panel: opens the newest приходная накладная (the list opens any other). */
export default async function LatestReceiptPage() {
  const res = await apiGet<PurchaseList>(`/warehouse/purchases${qs({ from: windowStartFor(), to: tashkentToday() })}`);
  // Rows come newest first.
  const newest = res.ok ? res.data.rows[0] : undefined;
  redirect(newest ? `/zakupki/nakladnye/${encodeURIComponent(newest.sdId)}` : "/zakupki/nakladnye");
}
