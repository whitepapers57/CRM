import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, type PurchaseDetail } from "@/lib/api";
import { formatDateTime, formatQty } from "@/lib/format";

export default async function PurchasePage({ params }: PageProps<"/warehouse/purchases/[sdId]">) {
  const t = await getT();
  const { sdId } = await params;
  const res = await apiGet<PurchaseDetail>(`/warehouse/purchases/${encodeURIComponent(sdId)}`);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const p = res.data;
  return (
    <>
      <PageHeader
        title={`${t("statement.kind.purchase")} ${p.sdId}`}
        subtitle={[formatDateTime(p.date), p.warehouseName, p.supplierName].filter(Boolean).join(" · ")}
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("warehouse.product")}</TableHead>
              <TableHead className="text-right">{t("warehouse.quantity")}</TableHead>
              <TableHead className="text-right">{t("warehouse.price")}</TableHead>
              <TableHead className="text-right">{t("statement.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.lines.map((l, i) => (
              <TableRow key={`${l.productSdId}-${i}`}>
                <TableCell className="min-w-48 whitespace-normal">{l.productName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(l.quantity)}</TableCell>
                <TableCell className="text-right"><Money value={l.price} /></TableCell>
                <TableCell className="text-right"><Money value={l.amount} /></TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={3}>{t("warehouse.total")}</TableCell>
              <TableCell className="text-right"><Money value={p.total} /></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
