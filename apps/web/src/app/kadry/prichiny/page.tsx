import { ApiError } from "@/components/app/api-error";
import { HistoryButton } from "@/components/app/history-button";
import { HistoryList } from "@/components/app/history-list";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Card, CardContent } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type AuditEntry, type KadryReason } from "@/lib/api";
import { AddReason, ReasonRow } from "./reason-row";

export default async function ReasonsPage() {
  const t = await getT();
  const locale = await getLocale();
  const [res, history] = await Promise.all([
    apiGet<KadryReason[]>("/kadry/reasons"),
    apiGet<AuditEntry[]>("/kadry/history/reasons"),
  ]);
  const header = (
    <StickyToolbar>
      <PageHeader back="/kadry" title={t("kadry.reasons")}>
        <HistoryButton label={t("history.open")}>
          <HistoryList bare entries={history.ok ? history.data : []} />
        </HistoryButton>
      </PageHeader>
    </StickyToolbar>
  );
  if (!res.ok) return <>{header}<ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} /></>;
  const nextSort = res.data.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 10;
  return (
    <>
      {header}
      <Card className="max-w-2xl">
        <CardContent>
          <ul>
            {res.data.map((r) => (
              <ReasonRow key={r.id} id={r.id} label={r.label} sortOrder={r.sortOrder} active={r.active} locale={locale} />
            ))}
          </ul>
          <AddReason nextSort={nextSort} locale={locale} />
        </CardContent>
      </Card>
    </>
  );
}
