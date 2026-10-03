import { ApiError } from "@/components/app/api-error";
import { HistoryList } from "@/components/app/history-list";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, type AuditEntry, type MonthRow } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { monthLabel, tashkentInstant } from "@/lib/month-label";
import { MonthButton } from "./month-button";

export default async function MonthsPage() {
  const t = await getT();
  const [months, history] = await Promise.all([apiGet<MonthRow[]>("/months"), apiGet<AuditEntry[]>("/months/history")]);
  const header = (
    <StickyToolbar>
      <PageHeader title={t("nav.months")} />
    </StickyToolbar>
  );
  if (!months.ok)
    return (
      <>
        {header}
        <ApiError message={months.status === 0 ? t("errors.api_down") : months.message || t("errors.unknown")} />
      </>
    );
  return (
    <>
      {header}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("months.month")}</TableHead>
              <TableHead>{t("months.status")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("months.changed")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...months.data].reverse().map((m) => {
              const label = monthLabel(m.month, t);
              const changed = m.changedBy
                ? `${m.changedBy}${m.changedAt ? `, ${formatDateTime(tashkentInstant(m.changedAt))}` : ""}`
                : "—";
              return (
                <TableRow key={m.month}>
                  <TableCell>
                    <div className="font-medium">{label}</div>
                    {/* Phones: «Изменил» folds under the month so the button stays in view. */}
                    {m.changedBy && <div className="whitespace-normal text-xs text-muted-foreground sm:hidden">{changed}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.closed ? "default" : "secondary"}>{m.closed ? t("months.closed") : t("months.open")}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{changed}</TableCell>
                  <TableCell className="text-right">
                    <MonthButton
                      month={m.month}
                      closed={m.closed}
                      labels={{
                        action: m.closed ? t("months.reopen") : t("months.close"),
                        confirm: t(m.closed ? "months.confirm_open" : "months.confirm_close", { month: label }),
                        ok: t("common.confirm"),
                        cancel: t("common.cancel"),
                        failed: t("errors.unknown"),
                      }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <HistoryList entries={history.ok ? history.data : []} />
    </>
  );
}
