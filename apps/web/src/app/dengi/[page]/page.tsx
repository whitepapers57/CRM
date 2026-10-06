import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@/components/app/api-error";
import { CheckboxField } from "@/components/app/checkbox-field";
import { HistoryButton } from "@/components/app/history-button";
import { HistoryList } from "@/components/app/history-list";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PagePeriod } from "@/components/app/page-period";
// import { PlaceholderPage } from "@/components/app/placeholder-page"; // 6 Oct 2026: unused with the LATER lookup retired
import { Select } from "@/components/app/select";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import { apiGet, qs, type AuditEntry, type CashList, type CashPage } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { tashkentInstant } from "@/lib/month-label";
import { cn } from "@/lib/utils";
import { cashNames } from "@/lib/cash-names";
import { CreateMenu } from "../create-menu";

const PAGES: CashPage[] = ["cash-in", "cash-out", "bank-in", "bank-out"];
// Panel links whose pages come later.
// 6 Oct 2026: stati and scheta now have their own pages (Task 9); old entry kept:
// const LATER: Record<string, MessageKey> = { stati: "money.categories", scheta: "money.accounts" };
// const LATER: Record<string, MessageKey> = {}; // 6 Oct 2026: empty, only fed the buggy `in` lookup

export default async function CashListPage({ params, searchParams }: PageProps<"/dengi/[page]">) {
  const { page } = await params;
  const t = await getT();
  // 6 Oct 2026: `page in LATER` also matched "constructor"/"toString" (/dengi/constructor crashed); LATER is empty, so unknown names go to notFound().
  // if (page in LATER) return <PlaceholderPage title={t(LATER[page])} />;
  if (!PAGES.includes(page as CashPage)) notFound();
  const cashPage = page as CashPage;
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = { from: get("from"), to: get("to"), operation: get("operation"), box: get("box"), search: get("search"), includeCancelled: get("includeCancelled") };
  const [res, history] = await Promise.all([
    apiGet<CashList>(`/cash/pages/${cashPage}${qs(q)}`),
    apiGet<AuditEntry[]>(`/cash/pages/${cashPage}/history`),
  ]);
  const entries = history.ok ? history.data : [];
  const names = await cashNames(res.ok ? res.data.rows : []);
  const numbers = new Map(res.ok ? res.data.rows.map((r) => [r.id, r.number] as const) : []);
  const linkFor = Object.fromEntries(
    entries.map((e) => [e.target, { href: `/dengi/op/${encodeURIComponent(e.target)}`, label: numbers.get(e.target) ?? t("history.open_document") }]),
  );
  const isIn = cashPage.endsWith("-in");
  const title = t(`money.${cashPage}` as MessageKey);
  const header = (
    <PageHeader title={title}>
      <div className="flex flex-wrap items-center gap-2">
        {res.ok && (
          <CreateMenu
            label={t("money.create")}
            items={res.data.filters.operations.map((code) => ({
              href: `/dengi/op/new${qs({ page: cashPage, operation: code })}`,
              label: t(`money.op.${code}` as MessageKey),
            }))}
          />
        )}
        <HistoryButton label={t("history.open")}>
          <HistoryList bare entries={entries} linkFor={linkFor} names={names} />
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

  return (
    <>
      <StickyToolbar>
        {header}
        <form className="flex flex-wrap items-center gap-3" action={`/dengi/${cashPage}`}>
          {q.from && <input type="hidden" name="from" value={q.from} />}
          {q.to && <input type="hidden" name="to" value={q.to} />}
          <Select
            name="operation"
            defaultValue={q.operation ?? ""}
            ariaLabel={t("money.operation")}
            options={[
              { value: "", label: `${t("money.operation")}: ${t("common.all")}` },
              ...filters.operations.map((c) => ({ value: c, label: t(`money.op.${c}` as MessageKey) })),
            ]}
          />
          <Select
            name="box"
            defaultValue={q.box ?? ""}
            ariaLabel={t("money.box")}
            options={[
              { value: "", label: `${t("money.box")}: ${t("common.all")}` },
              ...filters.boxes.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
          <Input name="search" defaultValue={q.search} placeholder={t("money.search")} aria-label={t("money.search")} className="w-48" />
          <CheckboxField name="includeCancelled" defaultChecked={q.includeCancelled === "true"} label={t("money.show_cancelled")} />
          <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
        </form>
      </StickyToolbar>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("money.date")}</TableHead>
              <TableHead>{t("money.number")}</TableHead>
              <TableHead>{isIn ? t("money.from") : t("money.to")}</TableHead>
              <TableHead className="text-right">{t("money.amount")}</TableHead>
              <TableHead>{t("money.operation")}</TableHead>
              <TableHead>{t("money.comment")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
            )}
            {rows.map((r) => {
              const app = r.source === "app";
              return (
                <TableRow key={r.id} className={cn("relative", app && "hover:bg-muted/50", r.cancelled && "text-muted-foreground")}>
                  <TableCell className="whitespace-nowrap">
                    {app ? (
                      <Link href={`/dengi/op/${encodeURIComponent(r.id)}`} className="after:absolute after:inset-0">{formatDate(r.date)}</Link>
                    ) : (
                      formatDate(r.date)
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {r.number}
                      {r.source === "salesdoc" && <Badge variant="secondary" className="font-sans">{t("money.from_salesdoc")}</Badge>}
                    </span>
                    {r.cancelled && (
                      <div className="max-w-64 whitespace-normal font-sans text-xs text-destructive">
                        {t("money.cancelled_banner", { by: r.cancelled.by, at: formatDateTime(tashkentInstant(r.cancelled.at)), reason: r.cancelled.reason })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{r.party ?? "—"}</TableCell>
                  <TableCell className="text-right"><Money value={r.amount} className={cn(r.cancelled && "line-through")} /></TableCell>
                  <TableCell>{r.mirrored ? t("money.deposit_mirror") : t(`money.op.${r.operation}` as MessageKey)}</TableCell>
                  <TableCell className="max-w-64 whitespace-normal">{r.comment}</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={3}>{t("money.total")}</TableCell>
              <TableCell className="text-right"><Money value={total} /></TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
