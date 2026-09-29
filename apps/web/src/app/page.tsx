import { ApiError } from "@/components/app/api-error";
import { DataAsOf } from "@/components/app/data-as-of";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { Text } from "@/components/app/text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { apiGet, qs, type Summary } from "@/lib/api";
import { formatDate } from "@/lib/format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-0">
      <Text variant="body">{label}</Text>
      <Money value={value} className="font-medium" />
    </div>
  );
}

export default async function Reconciliation({ searchParams }: PageProps<"/">) {
  const t = await getT();
  const sp = await searchParams;
  const res = await apiGet<Summary>(`/reconciliation/summary${qs({ from: sp.from as string, to: sp.to as string })}`);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const s = res.data;
  const goods = (Number(s.outlets.delivered) - Number(s.outlets.returned)).toFixed(2);
  const diff = (Number(goods) - Number(s.outlets.paid)).toFixed(2);

  return (
    <>
      <PageHeader title={t("nav.reconciliation")} subtitle={t("app.subtitle")}>
        <PeriodFilter
          from={s.period.from}
          to={s.period.to}
          labels={{ from: t("period.from"), to: t("period.to"), apply: t("common.apply"), invalid: t("errors.date_invalid"), order: t("errors.period_order") }}
        />
      </PageHeader>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <DataAsOf iso={s.dataAsOf} label={(time) => t("data.as_of", { time })} never={t("data.never")} />
        <Text variant="caption">{t("data.window", { date: formatDate(`${s.windowStart}T00:00:00Z`) })}</Text>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [t("recon.receivable"), s.outlets.receivable],
          [t("recon.prepaid"), s.outlets.prepaid],
          [t("recon.supplier_owed"), s.supplier.owed],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader><Text variant="caption">{label}</Text></CardHeader>
            <CardContent><Money value={value} className="text-2xl font-semibold" /></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("recon.goods")}</CardTitle></CardHeader>
          <CardContent>
            <Row label={t("recon.delivered")} value={s.outlets.delivered} />
            <Row label={t("recon.returned")} value={s.outlets.returned} />
            <Row label={t("recon.received")} value={s.supplier.received} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("recon.cash")}</CardTitle></CardHeader>
          <CardContent>
            <Row label={t("recon.paid")} value={s.outlets.paid} />
            <Row label={t("recon.supplier_paid")} value={s.supplier.paid} />
            <Text variant="caption" className="pt-2">{t("recon.cash_pending")}</Text>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="flex items-baseline justify-between gap-4">
          <Text variant="subtitle">{t("recon.difference")}</Text>
          <Money value={diff} className="text-xl font-semibold" />
        </CardContent>
      </Card>
    </>
  );
}
