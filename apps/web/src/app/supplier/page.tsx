import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { StatementTable } from "@/components/app/statement-table";
import { Text } from "@/components/app/text";
import { getT } from "@/i18n/server";
import { apiGet, qs, type SupplierStatement } from "@/lib/api";
import { tashkentToday } from "@/lib/today";

export default async function SupplierPage({ searchParams }: PageProps<"/supplier">) {
  const t = await getT();
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  const res = await apiGet<SupplierStatement>(`/supplier/statement${qs({ from, to })}`);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const today = tashkentToday();

  return (
    <>
      <PageHeader title={t("supplier.title")}>
        <PeriodFilter
          from={from ?? `${today.slice(0, 7)}-01`}
          to={to ?? today}
          labels={{ from: t("period.from"), to: t("period.to"), apply: t("common.apply"), invalid: t("errors.date_invalid"), order: t("errors.period_order") }}
        />
      </PageHeader>
      <Text variant="caption">{t("recon.cash_pending")}</Text>
      <StatementTable
        opening={res.data.opening}
        closing={res.data.closing}
        rows={res.data.rows}
        labels={{
          date: t("statement.date"), document: t("statement.document"), amount: t("statement.amount"),
          balance: t("statement.balance"), opening: t("outlets.opening"), closing: t("outlets.closing"), empty: t("common.empty"),
          kind: { order: t("statement.kind.order"), return: t("statement.kind.return"), payment: t("statement.kind.payment"), purchase: t("statement.kind.purchase") },
        }}
      />
    </>
  );
}
