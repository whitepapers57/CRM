import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/lib/format";
import { tashkentToday, windowStartFor } from "@/lib/today";
import { PeriodFilter } from "./period-filter";

/** The period picker for a page: defaults to this month, never earlier than the stored window. */
export async function PagePeriod({ from, to }: { from?: string; to?: string }) {
  const t = await getT();
  const locale = await getLocale();
  const today = tashkentToday();
  const min = windowStartFor(today);
  return (
    <PeriodFilter
      from={from ?? `${today.slice(0, 7)}-01`}
      to={to ?? today}
      min={min}
      locale={locale}
      labels={{
        from: t("period.from"),
        to: t("period.to"),
        apply: t("common.apply"),
        invalid: t("errors.date_invalid"),
        order: t("errors.period_order"),
        beforeWindow: t("errors.before_window", { date: formatDate(`${min}T00:00:00Z`) }),
      }}
    />
  );
}
