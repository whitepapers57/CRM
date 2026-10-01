import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { PagePeriod } from "@/components/app/page-period";
import { StatementTable } from "@/components/app/statement-table";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { getT } from "@/i18n/server";
import { apiGet, qs, type SupplierList, type SupplierStatement } from "@/lib/api";

export default async function SupplierStatementPage({ params, searchParams }: PageProps<"/zakupki/postavshiki/[sdId]">) {
  const t = await getT();
  const { sdId } = await params;
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  const [res, list] = await Promise.all([
    apiGet<SupplierStatement>(`/supplier/statement${qs({ from, to, supplier: sdId })}`),
    apiGet<SupplierList>(`/suppliers${qs({ from, to })}`),
  ]);
  const name = (list.ok && list.data.rows.find((r) => r.sdId === sdId)?.name) || sdId;
  const header = (
    <PageHeader title={name} subtitle={t("outlets.statement")}>
      <PagePeriod from={from} to={to} />
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
  return (
    <>
      <StickyToolbar>{header}</StickyToolbar>
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
