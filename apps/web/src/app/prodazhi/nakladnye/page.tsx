import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PagePeriod } from "@/components/app/page-period";
import { Select } from "@/components/app/select";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MessageKey } from "@/i18n/messages";
import { getT } from "@/i18n/server";
import { apiGet, qs, type SalesOrderList } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Salesdoc order statuses 1–5; 5 = cancelled (greyed, not in Итого). */
const STATUSES = [1, 2, 3, 4, 5];

export default async function SalesInvoicesPage({ searchParams }: PageProps<"/prodazhi/nakladnye">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = { from: get("from"), to: get("to"), status: get("status"), warehouse: get("warehouse"), agent: get("agent"), search: get("search") };
  const res = await apiGet<SalesOrderList>(`/sales/orders${qs(q)}`);
  const header = (
    <PageHeader title={t("nav.sales_invoices")}>
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
  const link = (sdId: string) => `/prodazhi/nakladnye/${encodeURIComponent(sdId)}${qs({ from: q.from, to: q.to })}`;

  return (
    <>
      <StickyToolbar>
        {header}
        <form className="flex flex-wrap items-center gap-3" action="/prodazhi/nakladnye">
          {q.from && <input type="hidden" name="from" value={q.from} />}
          {q.to && <input type="hidden" name="to" value={q.to} />}
          <Select
            name="status"
            defaultValue={q.status ?? ""}
            ariaLabel={t("months.status")}
            options={[
              { value: "", label: `${t("months.status")}: ${t("common.all")}` },
              ...STATUSES.map((s) => ({ value: String(s), label: t(`sales.status.${s}` as MessageKey) })),
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
          <Select
            name="agent"
            defaultValue={q.agent ?? ""}
            ariaLabel={t("outlets.agent")}
            options={[
              { value: "", label: `${t("outlets.agent")}: ${t("common.all")}` },
              ...filters.agents.map((a) => ({ value: a.sdId, label: a.name })),
            ]}
          />
          <Input name="search" defaultValue={q.search} placeholder={t("sales.search")} aria-label={t("sales.search")} className="w-64" />
          <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
        </form>
      </StickyToolbar>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("zakupki.date")}</TableHead>
              <TableHead>{t("zakupki.number")}</TableHead>
              <TableHead>{t("sales.buyer")}</TableHead>
              <TableHead className="text-right">{t("statement.amount")}</TableHead>
              <TableHead>{t("warehouse.warehouse")}</TableHead>
              <TableHead>{t("outlets.agent")}</TableHead>
              <TableHead>{t("months.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.sdId} className={cn("relative hover:bg-muted/50", r.status === 5 && "text-muted-foreground")}>
                <TableCell className="whitespace-nowrap">
                  <Link href={link(r.sdId)} className="after:absolute after:inset-0">{formatDateTime(r.date)}</Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.sdId}</TableCell>
                <TableCell className="min-w-48 whitespace-normal">{r.outletName ?? r.outletSdId ?? "—"}</TableCell>
                <TableCell className={cn("text-right", r.status === 5 && "line-through")}><Money value={r.total} /></TableCell>
                <TableCell>{r.warehouseName}</TableCell>
                <TableCell>{r.agentName}</TableCell>
                <TableCell>
                  <Badge variant={r.status === 5 ? "destructive" : "secondary"}>{t(`sales.status.${r.status}` as MessageKey)}</Badge>
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={3}>{t("warehouse.total")}</TableCell>
              <TableCell className="text-right"><Money value={total} /></TableCell>
              <TableCell colSpan={3}><Text variant="caption">{t("sales.total_note")}</Text></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
