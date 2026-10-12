import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { PagePeriod } from "@/components/app/page-period";
import { StatementTable } from "@/components/app/statement-table";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
// import { Text } from "@/components/app/text"; // 6 Oct 2026: unused since the stale caption was retired
import { getT } from "@/i18n/server";
import { apiGet, qs, type SupplierList, type SupplierStatement } from "@/lib/api";
import { toDebtSign } from "@/lib/debt-sign";

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
  const name = sdId === "-" ? t("zakupki.no_supplier") : (list.ok && list.data.rows.find((r) => r.sdId === sdId)?.name) || sdId;
  const header = (
    <PageHeader back={`/zakupki/postavshiki${qs({ from, to })}`} title={name} subtitle={t("outlets.statement")}>
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
  // Same sign as the Поставщики list: what we owe is negative (1C «Долг (+ нам, − мы)»).
  const st = toDebtSign(res.data);
  return (
    <>
      <StickyToolbar>{header}</StickyToolbar>
      {/* 6 Oct 2026: Оплачено is real now (cash module); caption retired, key kept.
      <Text variant="caption">{t("recon.cash_pending")}</Text> */}
      <StatementTable
        opening={st.opening}
        closing={st.closing}
        rows={st.rows}
        labels={{
          date: t("statement.date"), document: t("statement.document"), amount: t("statement.amount"),
          balance: t("zakupki.debt"), opening: t("outlets.opening"), closing: t("outlets.closing"), empty: t("common.empty"),
          kind: { order: t("statement.kind.order"), return: t("statement.kind.return"), payment: t("statement.kind.payment"), purchase: t("statement.kind.purchase") },
        }}
      />
    </>
  );
}
