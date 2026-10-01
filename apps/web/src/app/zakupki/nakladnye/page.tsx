import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PagePeriod } from "@/components/app/page-period";
import { Select } from "@/components/app/select";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type PurchaseList } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export default async function ReceiptsPage({ searchParams }: PageProps<"/zakupki/nakladnye">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = { from: get("from"), to: get("to"), supplier: get("supplier"), warehouse: get("warehouse"), search: get("search") };
  const res = await apiGet<PurchaseList>(`/warehouse/purchases${qs(q)}`);
  const header = (
    <PageHeader title={t("nav.receipts")}>
      <PagePeriod from={q.from} to={q.to} />
    </PageHeader>
  );
  if (!res.ok) {
    return (
      <>
        <StickyToolbar>{header}</StickyToolbar>
        <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />
      </>
    );
  }
  const { rows, total, filters } = res.data;
  const link = (sdId: string) => `/zakupki/nakladnye/${encodeURIComponent(sdId)}${qs({ from: q.from, to: q.to })}`;

  return (
    <>
      <StickyToolbar>
        {header}
        <form className="flex flex-wrap items-center gap-3" action="/zakupki/nakladnye">
          {q.from && <input type="hidden" name="from" value={q.from} />}
          {q.to && <input type="hidden" name="to" value={q.to} />}
          <Select
            name="supplier"
            defaultValue={q.supplier ?? ""}
            ariaLabel={t("zakupki.supplier")}
            options={[
              { value: "", label: `${t("zakupki.supplier")}: ${t("common.all")}` },
              ...filters.suppliers.map((s) => ({ value: s.sdId, label: s.name })),
            ]}
          />
          <Select
            name="warehouse"
            defaultValue={q.warehouse ?? ""}
            ariaLabel={t("warehouse.warehouse")}
            options={[
              { value: "", label: `${t("warehouse.warehouse")}: ${t("common.all")}` },
              ...filters.warehouses.map((w) => ({ value: w.sdId, label: w.name })),
            ]}
          />
          <Input name="search" defaultValue={q.search} placeholder={t("zakupki.search_number")} aria-label={t("zakupki.search_number")} className="w-48" />
          <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
        </form>
      </StickyToolbar>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("zakupki.date")}</TableHead>
              <TableHead>{t("zakupki.number")}</TableHead>
              <TableHead>{t("zakupki.supplier")}</TableHead>
              <TableHead className="text-right">{t("statement.amount")}</TableHead>
              <TableHead>{t("warehouse.warehouse")}</TableHead>
              <TableHead className="text-right">{t("warehouse.lines")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.sdId} className="relative hover:bg-muted/50">
                <TableCell className="whitespace-nowrap">
                  <Link href={link(r.sdId)} className="after:absolute after:inset-0">{formatDateTime(r.date)}</Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.sdId}</TableCell>
                <TableCell>{r.supplierName ?? r.supplierSdId}</TableCell>
                <TableCell className="text-right"><Money value={r.total} /></TableCell>
                <TableCell>{r.warehouseName}</TableCell>
                <TableCell className="text-right tabular-nums">{r.lineCount}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={3}>{t("warehouse.total")}</TableCell>
              <TableCell className="text-right"><Money value={total} /></TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
