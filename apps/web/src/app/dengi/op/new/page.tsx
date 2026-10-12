import { notFound } from "next/navigation";
import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { getLocale, getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import { apiGet, type CashFormOptions, type CashPage, type MonthRow } from "@/lib/api";
import { OPS_FOR_PAGE } from "@/lib/cash-ops";
import { tashkentToday } from "@/lib/today";
import { CashForm } from "../../cash-form";

const PAGES: CashPage[] = ["cash-in", "cash-out", "bank-in", "bank-out"];

export default async function NewCashOperationPage({ searchParams }: PageProps<"/dengi/op/new">) {
  const t = await getT();
  const locale = await getLocale();
  const sp = await searchParams;
  const page = typeof sp.page === "string" ? sp.page : "";
  const operation = typeof sp.operation === "string" ? sp.operation : "";
  if (!PAGES.includes(page as CashPage)) notFound();
  const cashPage = page as CashPage;
  // 6 Oct 2026: validated against the whole page list (thousands of rows); now from OPS_FOR_PAGE.
  // const list = await apiGet<CashList>(`/cash/pages/${cashPage}`); ... if (list.ok && !list.data.filters.operations.includes(operation)) notFound();
  if (!OPS_FOR_PAGE[cashPage].includes(operation)) notFound();
  const [opts, months] = await Promise.all([
    apiGet<CashFormOptions>("/cash/form-options"),
    apiGet<MonthRow[]>("/months"),
  ]);
  const fail = !opts.ok ? opts : null;
  const header = (
    <StickyToolbar>
      <PageHeader back={`/dengi/${cashPage}`} title={t("money.new_title", { operation: t(`money.op.${operation}` as MessageKey) })} />
    </StickyToolbar>
  );
  if (fail) {
    return (
      <>
        {header}
        <ApiError message={fail.status === 0 ? t("errors.api_down") : fail.message || t("errors.unknown")} />
      </>
    );
  }
  return (
    <>
      {header}
      <CashForm
        cancelHref={`/dengi/${cashPage}`}
        page={cashPage}
        operation={operation}
        options={(opts as { data: CashFormOptions }).data}
        closedMonths={months.ok ? months.data.filter((m) => m.closed).map((m) => m.month) : []}
        today={tashkentToday()}
        locale={locale}
      />
    </>
  );
}
