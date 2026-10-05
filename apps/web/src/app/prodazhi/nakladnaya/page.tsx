import { redirect } from "next/navigation";
import { apiGet, qs, type SalesOrderList } from "@/lib/api";
import { tashkentToday, windowStartFor } from "@/lib/today";

/** «Накладная» in the Продажи panel: opens the newest расходная накладная (the list opens any other). */
export default async function LatestSalesInvoicePage() {
  const res = await apiGet<SalesOrderList>(`/sales/orders${qs({ from: windowStartFor(), to: tashkentToday() })}`);
  // Rows come newest first.
  const newest = res.ok ? res.data.rows[0] : undefined;
  redirect(newest ? `/prodazhi/nakladnye/${encodeURIComponent(newest.sdId)}` : "/prodazhi/nakladnye");
}
