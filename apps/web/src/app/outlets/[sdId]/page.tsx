import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { StatementTable } from "@/components/app/statement-table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type OutletStatement } from "@/lib/api";
import { tashkentToday } from "@/lib/today";

export default async function OutletStatementPage({ params, searchParams }: PageProps<"/outlets/[sdId]">) {
  const t = await getT();
  const { sdId } = await params;
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  const res = await apiGet<OutletStatement>(`/outlets/${encodeURIComponent(sdId)}/statement${qs({ from, to })}`);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const s = res.data;
  const today = tashkentToday();

  return (
    <>
      <PageHeader title={s.outlet.name} subtitle={[t("outlets.statement"), s.outlet.firmName, s.outlet.inn && `${t("outlets.inn")} ${s.outlet.inn}`].filter(Boolean).join(" · ")}>
        <PeriodFilter
          from={from ?? `${today.slice(0, 7)}-01`}
          to={to ?? today}
          labels={{ from: t("period.from"), to: t("period.to"), apply: t("common.apply"), invalid: t("errors.date_invalid"), order: t("errors.period_order") }}
        />
      </PageHeader>
      <StatementTable
        opening={s.opening}
        closing={s.closing}
        rows={s.rows}
        labels={{
          date: t("statement.date"), document: t("statement.document"), amount: t("statement.amount"),
          balance: t("statement.balance"), opening: t("outlets.opening"), closing: t("outlets.closing"), empty: t("common.empty"),
          kind: { order: t("statement.kind.order"), return: t("statement.kind.return"), payment: t("statement.kind.payment"), purchase: t("statement.kind.purchase") },
        }}
      />
    </>
  );
}
