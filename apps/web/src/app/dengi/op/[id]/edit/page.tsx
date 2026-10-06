import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type CashFormOptions, type CashOperationDetail, type CashPage, type MonthRow } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { tashkentInstant } from "@/lib/month-label";
import { tashkentToday } from "@/lib/today";
import { CashForm } from "../../../cash-form";

export default async function EditCashOperationPage({ params }: PageProps<"/dengi/op/[id]/edit">) {
  const t = await getT();
  const locale = await getLocale();
  const { id } = await params;
  const [res, opts, months] = await Promise.all([
    apiGet<CashOperationDetail>(`/cash/operations/${encodeURIComponent(id)}`),
    apiGet<CashFormOptions>("/cash/form-options"),
    apiGet<MonthRow[]>("/months"),
  ]);
  const header = (
    <StickyToolbar>
      <PageHeader title={t("money.edit_title", { number: res.ok ? res.data.number : id })} />
    </StickyToolbar>
  );
  const fail = !res.ok ? res : !opts.ok ? opts : null;
  if (fail) {
    return (
      <>
        {header}
        <ApiError message={fail.status === 0 ? t("errors.api_down") : fail.status === 404 ? t("money.not_found") : fail.message || t("errors.unknown")} />
      </>
    );
  }
  const o = (res as { data: CashOperationDetail }).data;
  // 6 Oct 2026: form options hold only active items; an operation on a hidden статья / account / buyer would show its raw id.
  const base = (opts as { data: CashFormOptions }).data;
  const hidden = ` (${t("refs.inactive")})`;
  const withCurrent = (list: Array<{ id: string; name: string }>, id: string | null, name: string | null) =>
    id && !list.some((x) => x.id === id) ? [...list, { id, name: `${name ?? id}${hidden}` }] : list;
  const options: CashFormOptions = {
    ...base,
    bankAccounts: withCurrent(base.bankAccounts, o.bankAccountId, o.bankAccountName),
    suppliers: withCurrent(base.suppliers, o.supplierSdId, o.supplierName),
    outlets: withCurrent(base.outlets, o.outletSdId, o.party),
    expenseCategories: o.categoryId && o.direction === "out" ? withCurrent(base.expenseCategories, o.categoryId, o.party) : base.expenseCategories,
    incomeCategories: o.categoryId && o.direction === "in" ? withCurrent(base.incomeCategories, o.categoryId, o.party) : base.incomeCategories,
  };
  if (o.cancelled || !o.monthOpen) {
    return (
      <>
        {header}
        <ApiError
          message={
            o.cancelled
              ? t("money.cancelled_banner", { by: o.cancelled.by, at: formatDateTime(tashkentInstant(o.cancelled.at)), reason: o.cancelled.reason })
              : t("receipt.month_closed")
          }
        />
      </>
    );
  }
  return (
    <>
      {header}
      <CashForm
        id={o.id}
        page={`${o.account}-${o.direction}` as CashPage}
        operation={o.operation}
        options={options}
        closedMonths={months.ok ? months.data.filter((m) => m.closed).map((m) => m.month) : []}
        today={tashkentToday()}
        locale={locale}
        initial={{
          date: o.date.slice(0, 10),
          amount: String(Number(o.amount)),
          cashboxSdId: o.cashboxSdId ?? "",
          bankAccountId: o.bankAccountId ?? "",
          supplierSdId: o.supplierSdId ?? "",
          outletSdId: o.outletSdId ?? "",
          categoryId: o.categoryId ?? "",
          counterpartyName: o.counterpartyName ?? "",
          comment: o.comment ?? "",
        }}
      />
    </>
  );
}
