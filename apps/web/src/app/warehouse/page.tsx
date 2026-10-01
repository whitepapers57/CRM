import { redirect } from "next/navigation";
import { ApiError } from "@/components/app/api-error";
import { CheckboxField } from "@/components/app/checkbox-field";
import { PageHeader } from "@/components/app/page-header";
import { Select } from "@/components/app/select";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type StockResponse } from "@/lib/api";
import { formatQty } from "@/lib/format";

/** Склад: current stock only. Goods receipts moved to Закупки → Приходные накладные. */
export default async function WarehousePage({ searchParams }: PageProps<"/warehouse">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  // Receipts moved to Закупки → Приходные накладные (spec 2026-10-01 §3.6).
  if (get("tab") === "purchases") redirect(`/zakupki/nakladnye${qs({ from: get("from"), to: get("to") })}`);

  const res = await apiGet<StockResponse>(`/warehouse/stock${qs({ warehouse: get("warehouse"), search: get("search"), includeZero: get("includeZero") })}`);
  if (!res.ok) {
    return (
      <>
        <StickyToolbar><PageHeader title={t("nav.warehouse")} /></StickyToolbar>
        <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />
      </>
    );
  }
  return (
    <>
      <StickyToolbar>
        <PageHeader title={t("nav.warehouse")} />
        <form className="flex flex-wrap items-center gap-3" action="/warehouse">
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
