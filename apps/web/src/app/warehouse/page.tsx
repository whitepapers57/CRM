import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PagePeriod } from "@/components/app/page-period";
import { Text } from "@/components/app/text";
import { CheckboxField } from "@/components/app/checkbox-field";
import { Select } from "@/components/app/select";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
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
        <StickyToolbar>
        <PageHeader title={t("nav.warehouse")}>{tabs}</PageHeader>
        <form className="flex flex-wrap items-center gap-3" action="/warehouse">
          <input type="hidden" name="tab" value="stock" />
          <Select
            name="warehouse"
            defaultValue={get("warehouse") ?? ""}
            ariaLabel={t("warehouse.warehouse")}
            options={[
              { value: "", label: `${t("warehouse.warehouse")}: ${t("common.all")}` },
              ...res.data.warehouses.map((w) => ({ value: w.sdId, label: w.name })),
            ]}
          />
          <Input name="search" defaultValue={get("search")} placeholder={t("common.search")} aria-label={t("common.search")} className="w-56" />
          <CheckboxField name="includeZero" defaultChecked={get("includeZero") === "true"} label={t("warehouse.include_zero")} />
          <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
        </form>
        </StickyToolbar>
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
  if (!res.ok) return <><StickyToolbar><PageHeader title={t("nav.warehouse")}>{tabs}</PageHeader><PagePeriod from={from} to={to} /></StickyToolbar><ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} /></>;
  return (
    <>
      <StickyToolbar>
        <PageHeader title={t("nav.warehouse")}>{tabs}</PageHeader>
        <PagePeriod from={from} to={to} />
      </StickyToolbar>
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
