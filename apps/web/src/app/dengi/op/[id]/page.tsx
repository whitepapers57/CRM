import { ApiError } from "@/components/app/api-error";
import { HistoryButton } from "@/components/app/history-button";
import { HistoryList } from "@/components/app/history-list";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Card, CardContent } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import { apiGet, type AuditEntry, type CashOperationDetail } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { tashkentInstant } from "@/lib/month-label";
import { cashNames } from "@/lib/cash-names";
import { OpActions } from "../../op-actions";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text variant="caption">{label}</Text>
      <Text variant="body" className="font-medium">{value}</Text>
    </div>
  );
}

export default async function CashOperationPage({ params }: PageProps<"/dengi/op/[id]">) {
  const t = await getT();
  const locale = await getLocale();
  const { id } = await params;
  const [res, history] = await Promise.all([
    apiGet<CashOperationDetail>(`/cash/operations/${encodeURIComponent(id)}`),
    apiGet<AuditEntry[]>(`/cash/operations/${encodeURIComponent(id)}/history`),
  ]);
  if (!res.ok) {
    return (
      <>
        <StickyToolbar><PageHeader title={t("nav.money")} /></StickyToolbar>
        <ApiError message={res.status === 0 ? t("errors.api_down") : res.status === 404 ? t("money.not_found") : res.message || t("errors.unknown")} />
      </>
    );
  }
  const o = res.data;
  const names = await cashNames([o]);
  if (o.outletSdId && o.party) names[o.outletSdId] ??= o.party;
  const opName = t(`money.op.${o.operation}` as MessageKey);
  return (
    <>
      <StickyToolbar>
        <PageHeader title={t("money.op_title", { operation: opName, number: o.number, date: formatDate(o.date) })}>
          <div className="flex flex-wrap items-center gap-2">
            <HistoryButton label={t("history.open")}>
              <HistoryList bare entries={history.ok ? history.data : []} names={names} />
            </HistoryButton>
            <OpActions id={o.id} number={o.number} monthOpen={o.monthOpen} cancelled={!!o.cancelled} locale={locale} />
          </div>
        </PageHeader>
      </StickyToolbar>
      {o.cancelled && (
        <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {t("money.cancelled_banner", { by: o.cancelled.by, at: formatDateTime(tashkentInstant(o.cancelled.at)), reason: o.cancelled.reason })}
        </div>
      )}
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label={t("money.date")} value={formatDate(o.date)} />
          <Field label={t("money.amount")} value={<Money value={o.amount} className={o.cancelled ? "line-through" : undefined} />} />
          <Field label={t("money.box")} value={o.cashboxName ?? o.bankAccountName ?? "—"} />
          {o.operation === "cash_to_bank" && <Field label={t("money.bank_for_deposit")} value={o.bankAccountName ?? "—"} />}
          <Field label={t("money.party")} value={o.party ?? "—"} />
          <Field label={t("money.comment")} value={o.comment ?? "—"} />
          <Field label={t("money.created_by")} value={o.createdByName} />
        </CardContent>
      </Card>
    </>
  );
}
