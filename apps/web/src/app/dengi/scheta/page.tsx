import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { apiGet } from "@/lib/api";
import { AddRef, PaymentTypeSelect, RefRow } from "../ref-row";

// 6 Oct 2026: was `<PlaceholderPage title={t("money.accounts")} />` (routed through [page]/page.tsx LATER).

interface BankAccount { id: string; name: string; active: boolean }
interface PaymentType { sdId: string; name: string; account: "cash" | "bank" }

export default async function AccountsPage() {
  const t = await getT();
  const locale = await getLocale();
  const [accounts, types] = await Promise.all([apiGet<BankAccount[]>("/cash/bank-accounts"), apiGet<PaymentType[]>("/cash/payment-types")]);
  const header = (
    <StickyToolbar>
      <PageHeader back="/dengi" title={t("money.accounts")} />
    </StickyToolbar>
  );
  if (!accounts.ok) return <>{header}<ApiError message={accounts.status === 0 ? t("errors.api_down") : accounts.message || t("errors.unknown")} /></>;
  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("money.accounts")}</CardTitle></CardHeader>
          <CardContent>
            <ul>
              {accounts.data.map((a) => (
                <RefRow key={a.id} kind="bank-accounts" id={a.id} name={a.name} active={a.active} locale={locale} />
              ))}
            </ul>
            <AddRef kind="bank-accounts" locale={locale} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("refs.payment_types")}</CardTitle></CardHeader>
          <CardContent>
            {types.ok ? (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("refs.name")}</TableHead>
                      <TableHead>{t("refs.goes_to")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {types.data.map((p) => (
                      <TableRow key={p.sdId}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell><PaymentTypeSelect sdId={p.sdId} account={p.account} locale={locale} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <ApiError message={types.status === 0 ? t("errors.api_down") : types.message || t("errors.unknown")} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
