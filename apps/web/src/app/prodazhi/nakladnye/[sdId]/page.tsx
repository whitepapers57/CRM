import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MessageKey } from "@/i18n/messages";
import { getT } from "@/i18n/server";
import { apiGet, periodQs, type SalesOrder } from "@/lib/api";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text variant="caption">{label}</Text>
      <Text variant="body" className="font-medium">{value}</Text>
    </div>
  );
}

/** One расходная накладная (a Salesdoc order), read-only. */
export default async function SalesInvoicePage({ params, searchParams }: PageProps<"/prodazhi/nakladnye/[sdId]">) {
  const t = await getT();
  const { sdId } = await params;
  const back = `/prodazhi/nakladnye${periodQs(await searchParams)}`;
  const res = await apiGet<SalesOrder>(`/sales/orders/${encodeURIComponent(sdId)}`);
  if (!res.ok) {
    return (
      <>
        <StickyToolbar><PageHeader back={back} title={t("nav.sales_invoices")} /></StickyToolbar>
        <ApiError message={res.status === 0 ? t("errors.api_down") : res.status === 404 ? t("zakupki.not_found") : res.message || t("errors.unknown")} />
      </>
    );
  }
  const o = res.data;
  const anyDiscount = o.lines.some((l) => Number(l.discount) !== 0);
  const anyReturned = o.lines.some((l) => Number(l.returned) !== 0);
  return (
    <>
      <StickyToolbar>
        <PageHeader back={back} title={t("sales.invoice_title", { number: o.sdId, date: formatDate(o.date) })}>
          <Badge variant={o.status === 5 ? "destructive" : "secondary"}>{t(`sales.status.${o.status}` as MessageKey)}</Badge>
        </PageHeader>
      </StickyToolbar>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("sales.buyer")}
            value={
              o.outletSdId ? (
                <Link href={`/prodazhi/pokupateli/${encodeURIComponent(o.outletSdId)}`} className="underline-offset-4 hover:underline">
                  {o.outletName ?? o.outletSdId}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <Field label={t("zakupki.number")} value={<span className="font-mono">{o.sdId}</span>} />
          <Field label={t("warehouse.warehouse")} value={o.warehouseName ?? "—"} />
          <Field label={t("zakupki.date")} value={formatDateTime(o.date)} />
          <Field label={t("outlets.agent")} value={o.agentName ?? "—"} />
          <Field label={t("outlets.expeditor")} value={o.expeditorName ?? "—"} />
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">N</TableHead>
              <TableHead>{t("nav.nomenclature")}</TableHead>
              <TableHead className="text-right">{t("warehouse.quantity")}</TableHead>
              <TableHead className="text-right">{t("warehouse.price")}</TableHead>
              {anyDiscount && <TableHead className="text-right">{t("sales.discount")}</TableHead>}
              <TableHead className="text-right">{t("statement.amount")}</TableHead>
              {anyReturned && <TableHead className="text-right">{t("sales.returned")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {o.lines.length === 0 && (
              <TableRow><TableCell colSpan={7}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
            )}
            {o.lines.map((l, i) => (
              <TableRow key={`${l.productSdId}-${i}`}>
                <TableCell className="tabular-nums">{i + 1}</TableCell>
                <TableCell className="min-w-48 whitespace-normal">{l.productName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(l.quantity)}</TableCell>
                <TableCell className="text-right"><Money value={l.price} /></TableCell>
                {anyDiscount && <TableCell className="text-right"><Money value={l.discount} /></TableCell>}
                <TableCell className="text-right"><Money value={l.amount} /></TableCell>
                {anyReturned && <TableCell className="text-right tabular-nums">{formatQty(l.returned)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Card>
        <CardContent className="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
          {Number(o.discount) !== 0 && (
            <>
              <span className="text-muted-foreground">{t("sales.before_discount")}</span>
              <Money value={o.totalBeforeDiscount} className="text-right" />
              <span className="text-muted-foreground">{t("sales.discount")}</span>
              <Money value={o.discount} className="text-right" />
            </>
          )}
          {Number(o.returns) !== 0 && (
            <>
              <span className="text-muted-foreground">{t("outlets.returned")}</span>
              <Money value={o.returns} className="text-right" />
            </>
          )}
          <span className="font-medium">{t("sales.grand_total")}</span>
          <Money value={o.total} className="text-right font-medium" />
        </CardContent>
      </Card>
    </>
  );
}
