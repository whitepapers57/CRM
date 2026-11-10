import { redirect } from "next/navigation";
import { ApiError } from "@/components/app/api-error";
import { CheckboxField } from "@/components/app/checkbox-field";
import { PageHeader } from "@/components/app/page-header";
import { PendingLink } from "@/components/app/pending-nav";
import { Select } from "@/components/app/select";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getT } from "@/i18n/server";
import { apiGet, qs, type StockResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StockGroups } from "./stock-groups";

/**
 * Склад, like Salesdoc: stock by category («позиция»), SKUs inside. Two views:
 * «Общее состояние» (units) and «Финансовое состояние» (on hand, new orders and
 * available to sell, in units and so'm at receipt prices, FIFO).
 * Goods receipts moved to Закупки → Приходные накладные.
 */
export default async function WarehousePage({ searchParams }: PageProps<"/warehouse">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  // Receipts moved to Закупки → Приходные накладные (spec 2026-10-01 §3.6).
  if (get("tab") === "purchases") redirect(`/zakupki/nakladnye${qs({ from: get("from"), to: get("to") })}`);

  const res = await apiGet<StockResponse>(
    `/warehouse/stock${qs({ warehouse: get("warehouse"), category: get("category"), search: get("search"), includeZero: get("includeZero") })}`,
  );
  const finance = get("view") === "finance";
  const viewHref = (v?: string) =>
    `/warehouse${qs({ view: v, warehouse: get("warehouse"), category: get("category"), search: get("search"), includeZero: get("includeZero") })}`;
  const tab = (active: boolean) => cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }), "active:scale-95");
  if (!res.ok) {
    return (
      <>
        <StickyToolbar><PageHeader title={t("nav.warehouse")} /></StickyToolbar>
        <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />
      </>
    );
  }
  return (
    <>
      <StickyToolbar>
        <PageHeader title={t("nav.warehouse")} />
        <div className="flex flex-wrap gap-2">
          <PendingLink href={viewHref()} aria-current={finance ? undefined : "page"} className={tab(!finance)}>{t("warehouse.view_general")}</PendingLink>
          <PendingLink href={viewHref("finance")} aria-current={finance ? "page" : undefined} className={tab(finance)}>{t("warehouse.view_finance")}</PendingLink>
        </div>
        <form className="flex flex-wrap items-center gap-3" action="/warehouse">
          {finance && <input type="hidden" name="view" value="finance" />}
          <Select
            name="warehouse"
            defaultValue={get("warehouse") ?? ""}
            ariaLabel={t("warehouse.warehouse")}
            options={[
              { value: "", label: `${t("warehouse.warehouse")}: ${t("common.all")}` },
              ...res.data.warehouses.map((w) => ({ value: w.sdId, label: w.name })),
            ]}
          />
          <Select
            name="category"
            defaultValue={get("category") ?? ""}
            ariaLabel={t("warehouse.category")}
            options={[
              { value: "", label: `${t("warehouse.category")}: ${t("common.all")}` },
              ...res.data.categories.map((c) => ({ value: c.sdId, label: c.name })),
              // "-" = products Salesdoc has not put in any category.
              ...(res.data.uncategorized || get("category") === "-" ? [{ value: "-", label: t("warehouse.no_category") }] : []),
            ]}
          />
          <Input name="search" defaultValue={get("search")} placeholder={t("common.search")} aria-label={t("common.search")} className="w-56" />
          <CheckboxField name="includeZero" defaultChecked={get("includeZero") === "true"} label={t("warehouse.include_zero")} />
          <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
        </form>
      </StickyToolbar>
      <StockGroups
        data={res.data}
        finance={finance}
        hideZero={get("includeZero") !== "true"}
        labels={{
          name: t("warehouse.name"),
          article: t("warehouse.article"),
          code: t("warehouse.code"),
          quantity: t("warehouse.quantity"),
          actual: t("warehouse.actual"),
          ordered: t("warehouse.ordered"),
          available: t("warehouse.available"),
          qty: t("warehouse.qty"),
          sum: t("warehouse.sum"),
          total: t("warehouse.total"),
          noCategory: t("warehouse.no_category"),
          empty: t("common.empty"),
          expandAll: t("warehouse.expand_all"),
          collapseAll: t("warehouse.collapse_all"),
        }}
      />
      {finance && <Text variant="caption" className="mt-2 block">{t("warehouse.fifo_note")}</Text>}
    </>
  );
}
