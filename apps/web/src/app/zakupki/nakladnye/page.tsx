import Link from "next/link";
import { HistoryButton } from "@/components/app/history-button";
import { HistoryList } from "@/components/app/history-list";
import { ApiError } from "@/components/app/api-error";
import { CheckboxField } from "@/components/app/checkbox-field";
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
import { apiGet, qs, type AuditEntry, type MonthRow, type PurchaseList } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { tashkentInstant } from "@/lib/month-label";
import { cn } from "@/lib/utils";
import { RestoreButton } from "./restore-button";
import { getLocale } from "@/i18n/server";

export default async function ReceiptsPage({ searchParams }: PageProps<"/zakupki/nakladnye">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = { from: get("from"), to: get("to"), supplier: get("supplier"), warehouse: get("warehouse"), search: get("search"), includeHidden: get("includeHidden") };
  const locale = await getLocale();
  const [res, months, history] = await Promise.all([
    apiGet<PurchaseList>(`/warehouse/purchases${qs(q)}`),
    apiGet<MonthRow[]>("/months"),
    apiGet<AuditEntry[]>("/audit?actionPrefix=purchase."),
  ]);
  const entries = history.ok ? history.data : [];
  const linkFor = Object.fromEntries(entries.map((e) => [e.target, { href: `/zakupki/nakladnye/${encodeURIComponent(e.target)}`, label: t("history.document", { number: e.target }) }]));
  const closed = new Set(months.ok ? months.data.filter((m) => m.closed).map((m) => m.month) : []);
  const header = (
    <PageHeader back="/zakupki" title={t("nav.receipts")}>
      <div className="flex flex-wrap items-center gap-2">
        <HistoryButton label={t("history.open")}>
          <HistoryList bare entries={entries} linkFor={linkFor} />
        </HistoryButton>
        <PagePeriod from={q.from} to={q.to} />
      </div>
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
          <CheckboxField name="includeHidden" defaultChecked={q.includeHidden === "true"} label={t("receipt.show_deleted")} />
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
              <TableRow key={r.sdId} className={cn("relative hover:bg-muted/50", r.hidden && "text-muted-foreground [&_td]:line-through")}>
                <TableCell className="whitespace-nowrap">
                  <Link href={link(r.sdId)} className="after:absolute after:inset-0">{formatDateTime(r.date)}</Link>
                </TableCell>
                <TableCell className="font-mono text-xs no-underline!">
                  <span className={cn(r.hidden && "line-through")}>{r.sdId}</span>
                  {r.hidden && (
                    <div className="max-w-64 whitespace-normal font-sans text-xs text-destructive">
                      {t("receipt.deleted_banner", { by: r.hidden.by, at: formatDateTime(tashkentInstant(r.hidden.at)), reason: r.hidden.reason })}
                    </div>
                  )}
                  {r.hidden && !closed.has(r.date.slice(0, 7)) && <RestoreButton sdId={r.sdId} locale={locale} />}
                </TableCell>
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
