import { redirect } from "next/navigation";

/** Moved to Закупки → Накладная: app/zakupki/nakladnye/[sdId]/page.tsx (spec 2026-10-01 §3.6). */
export default async function OldPurchasePage({ params }: PageProps<"/warehouse/purchases/[sdId]">) {
  const { sdId } = await params;
  redirect(`/zakupki/nakladnye/${encodeURIComponent(sdId)}`);
}
