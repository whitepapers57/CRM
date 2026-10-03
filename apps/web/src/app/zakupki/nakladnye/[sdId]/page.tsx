import { ApiError } from "@/components/app/api-error";
import { HistoryList } from "@/components/app/history-list";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type AuditEntry, type FormOptions, type PurchaseDetail } from "@/lib/api";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { tashkentInstant } from "@/lib/month-label";
import { ReceiptActions } from "./receipt-actions";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text variant="caption">{label}</Text>
      <Text variant="body" className="font-medium">{value}</Text>
    </div>
  );
}

export default async function ReceiptPage({ params }: PageProps<"/zakupki/nakladnye/[sdId]">) {
  const t = await getT();
  const locale = await getLocale();
  const { sdId } = await params;
  const [res, history, opts] = await Promise.all([
    apiGet<PurchaseDetail>(`/warehouse/purchases/${encodeURIComponent(sdId)}`),
    apiGet<AuditEntry[]>(`/warehouse/purchases/${encodeURIComponent(sdId)}/history`),
    apiGet<FormOptions>("/warehouse/form-options"),
  ]);
  if (!res.ok) {
    return (
      <>
        <StickyToolbar><PageHeader title={t("nav.receipts")} /></StickyToolbar>
        <ApiError message={res.status === 0 ? t("errors.api_down") : res.status === 404 ? t("zakupki.not_found") : res.message || t("errors.unknown")} />
      </>
    );
  }
  const p = res.data;
  // sdId → name for the history's before/after snapshots.
  const names: Record<string, string> = {};
  if (opts.ok) for (const x of [...opts.data.warehouses, ...opts.data.suppliers, ...opts.data.products]) names[x.sdId] = x.name;
  return (
    <>
      <StickyToolbar>
        <PageHeader title={t("zakupki.receipt_title", { number: p.sdId, date: formatDate(p.date) })}>
          <ReceiptActions sdId={p.sdId} monthOpen={p.monthOpen} hidden={!!p.hidden} locale={locale} />
        </PageHeader>
      </StickyToolbar>
      {p.hidden && (
        <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {t("receipt.deleted_banner", { by: p.hidden.by, at: formatDateTime(tashkentInstant(p.hidden.at)), reason: p.hidden.reason })}
        </div>
      )}
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label={t("zakupki.supplier")} value={p.supplierName ?? "—"} />
          <Field label={t("zakupki.number")} value={<span className="font-mono">{p.sdId}</span>} />
          <Field label={t("warehouse.warehouse")} value={p.warehouseName ?? "—"} />
          <Field label={t("zakupki.date")} value={formatDateTime(p.date)} />
          <Field label={t("zakupki.operation")} value={t("zakupki.operation_receipt")} />
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">N</TableHead>
              <TableHead>{t("nav.nomenclature")}</TableHead>
              <TableHead className="text-right">{t("warehouse.quantity")}</TableHead>
              <TableHead className="text-right">{t("warehouse.price")}</TableHead>
              <TableHead className="text-right">{t("statement.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.lines.map((l, i) => (
              <TableRow key={`${l.productSdId}-${i}`}>
                <TableCell className="tabular-nums">{i + 1}</TableCell>
                <TableCell className="min-w-48 whitespace-normal">{l.productName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(l.quantity)}</TableCell>
                <TableCell className="text-right"><Money value={l.price} /></TableCell>
                <TableCell className="text-right"><Money value={l.amount} /></TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={4}>{t("warehouse.total")}</TableCell>
              <TableCell className="text-right"><Money value={p.total} /></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <HistoryList entries={history.ok ? history.data : []} names={names} />
    </>
  );
}
