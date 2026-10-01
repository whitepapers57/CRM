import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PagePeriod } from "@/components/app/page-period";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type SupplierList } from "@/lib/api";

export default async function SuppliersPage({ searchParams }: PageProps<"/zakupki/postavshiki">) {
  const t = await getT();
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  const res = await apiGet<SupplierList>(`/suppliers${qs({ from, to })}`);
  const header = (
    <PageHeader title={t("nav.suppliers")}>
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
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("zakupki.supplier")}</TableHead>
              <TableHead className="text-right">{t("zakupki.received")}</TableHead>
              <TableHead className="text-right">{t("zakupki.paid")}</TableHead>
              <TableHead className="text-right">{t("zakupki.debt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.rows.length === 0 && (
              <TableRow><TableCell colSpan={4}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
            )}
            {res.data.rows.map((r) => (
              <TableRow key={r.sdId} className="relative hover:bg-muted/50">
                <TableCell className="font-medium">
                  <Link href={`/zakupki/postavshiki/${encodeURIComponent(r.sdId)}${qs({ from, to })}`} className="after:absolute after:inset-0">
                    {r.sdId === "-" ? t("zakupki.no_supplier") : r.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right"><Money value={r.received} /></TableCell>
                <TableCell className="text-right"><Money value={r.paid} /></TableCell>
                <TableCell className="text-right font-medium"><Money value={r.debt} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
