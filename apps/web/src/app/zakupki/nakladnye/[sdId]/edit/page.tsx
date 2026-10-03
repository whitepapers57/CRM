import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type FormOptions, type PurchaseDetail } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { tashkentInstant } from "@/lib/month-label";
import { ReceiptEditor } from "../receipt-editor";

export default async function ReceiptEditPage({ params }: PageProps<"/zakupki/nakladnye/[sdId]/edit">) {
  const t = await getT();
  const locale = await getLocale();
  const { sdId } = await params;
  const [res, opts] = await Promise.all([
    apiGet<PurchaseDetail>(`/warehouse/purchases/${encodeURIComponent(sdId)}`),
    apiGet<FormOptions>("/warehouse/form-options"),
  ]);
  const header = (
    <StickyToolbar>
      <PageHeader title={t("receipt.edit_title", { number: sdId })} />
    </StickyToolbar>
  );
  const fail = !res.ok ? res : !opts.ok ? opts : null;
  if (fail) {
    return (
      <>
        {header}
        <ApiError message={fail.status === 0 ? t("errors.api_down") : fail.status === 404 ? t("zakupki.not_found") : fail.message || t("errors.unknown")} />
      </>
    );
  }
  const p = (res as { data: PurchaseDetail }).data;
  if (p.hidden || !p.monthOpen) {
    return (
      <>
        {header}
        <ApiError
          message={
            p.hidden
              ? t("receipt.deleted_banner", { by: p.hidden.by, at: formatDateTime(tashkentInstant(p.hidden.at)), reason: p.hidden.reason })
              : t("receipt.month_closed")
          }
        />
      </>
    );
  }
  return (
    <>
      {header}
      <ReceiptEditor
        sdId={p.sdId}
        locale={locale}
        options={(opts as { data: FormOptions }).data}
        initial={{
          date: p.date.slice(0, 10),
          warehouseSdId: p.warehouseSdId ?? "",
          supplierSdId: p.supplierSdId ?? "",
          lines: p.lines.map((l) => ({ productSdId: l.productSdId ?? "", quantity: String(Number(l.quantity)), price: String(Number(l.price)), amount: l.amount })),
        }}
      />
    </>
  );
}
