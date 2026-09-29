import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PagePeriod } from "@/components/app/page-period";
import { Text } from "@/components/app/text";
import { Select } from "@/components/app/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type PurchaseList, type StockResponse } from "@/lib/api";
import { formatDateTime, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function WarehousePage({ searchParams }: PageProps<"/warehouse">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab = get("tab") === "purchases" ? "purchases" : "stock";
  const tabs = (
    <nav className="flex gap-1">
      {(["stock", "purchases"] as const).map((k) => (
        <Link
          key={k}
          href={`/warehouse?tab=${k}`}
          className={cn("rounded-md px-3 py-2 text-sm transition active:scale-95", tab === k ? "bg-foreground text-background" : "hover:bg-muted")}
        >
          {t(k === "stock" ? "warehouse.stock" : "warehouse.purchases")}
        </Link>
      ))}
    </nav>
  );

  if (tab === "stock") {
    const res = await apiGet<StockResponse>(`/warehouse/stock${qs({ warehouse: get("warehouse"), search: get("search"), includeZero: get("includeZero") })}`);
    if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
    return (
      <>
        <PageHeader title={t("nav.warehouse")}>{tabs}</PageHeader>
        <form className="flex flex-wrap items-center gap-3" action="/warehouse">
          <input type="hidden" name="tab" value="stock" />
          <Select name="warehouse" defaultValue={get("warehouse") ?? ""} aria-label={t("warehouse.warehouse")}>
            <option value="">{t("warehouse.warehouse")}: {t("common.all")}</option>
            {res.data.warehouses.map((w) => <option key={w.sdId} value={w.sdId}>{w.name}</option>)}
          </Select>
          <Input name="search" defaultValue={get("search")} placeholder={t("common.search")} aria-label={t("common.search")} className="w-56" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="includeZero" value="true" defaultChecked={get("includeZero") === "true"} />
            {t("warehouse.include_zero")}
          </label>
          <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
        </form>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("warehouse.warehouse")}</TableHead>
                <TableHead>{t("warehouse.product")}</TableHead>
                <TableHead className="text-right">{t("warehouse.quantity")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.data.rows.length === 0 && (
                <TableRow><TableCell colSpan={3}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
              )}
              {res.data.rows.map((r) => (
                <TableRow key={`${r.warehouseSdId}:${r.productSdId}`}>
                  <TableCell className="whitespace-nowrap">{r.warehouseName}</TableCell>
                  <TableCell className="min-w-48 whitespace-normal"><Text as="span">{r.productName}</Text></TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.quantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  const from = get("from");
  const to = get("to");
  const res = await apiGet<PurchaseList>(`/warehouse/purchases${qs({ from, to })}`);
  if (!res.ok) return <><PageHeader title={t("nav.warehouse")}>{tabs}</PageHeader><PagePeriod from={from} to={to} /><ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} /></>;
  return (
    <>
      <PageHeader title={t("nav.warehouse")}>{tabs}</PageHeader>
      <PagePeriod from={from} to={to} />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("statement.date")}</TableHead>
              <TableHead>{t("warehouse.warehouse")}</TableHead>
              <TableHead>{t("warehouse.supplier")}</TableHead>
              <TableHead className="text-right">{t("warehouse.lines")}</TableHead>
              <TableHead className="text-right">{t("statement.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.rows.length === 0 && (
              <TableRow><TableCell colSpan={5}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
            )}
            {res.data.rows.map((r) => (
              <TableRow key={r.sdId}>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/warehouse/purchases/${encodeURIComponent(r.sdId)}`} className="underline-offset-4 hover:underline">
                    {formatDateTime(r.date)}
                  </Link>
                </TableCell>
                <TableCell>{r.warehouseName}</TableCell>
                <TableCell>{r.supplierName}</TableCell>
                <TableCell className="text-right tabular-nums">{r.lineCount}</TableCell>
                <TableCell className="text-right"><Money value={r.total} /></TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={4}>{t("warehouse.total")}</TableCell>
              <TableCell className="text-right"><Money value={res.data.total} /></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
