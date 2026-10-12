import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PagePeriod } from "@/components/app/page-period";
import { Text } from "@/components/app/text";
import { CheckboxField } from "@/components/app/checkbox-field";
import { Select } from "@/components/app/select";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type OutletBalance } from "@/lib/api";
import { cn } from "@/lib/utils";

type Filters = { agents: Array<{ sdId: string; name: string }>; expeditors: Array<{ sdId: string; name: string }> };

export default async function BuyersPage({ searchParams }: PageProps<"/prodazhi/pokupateli">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const page = Math.max(1, Number(get("page")) || 1);
  const query = { from: get("from"), to: get("to"), search: get("search"), agent: get("agent"), expeditor: get("expeditor"), nonZero: get("nonZero") };
  const [res, filters] = await Promise.all([
    apiGet<{ total: number; rows: OutletBalance[] }>(`/outlets/balances${qs({ ...query, page: String(page) })}`),
    apiGet<Filters>("/outlets/filters"),
  ]);
  const header = (
    <PageHeader back="/prodazhi" title={t("nav.buyers")}>
      <PagePeriod from={query.from} to={query.to} />
    </PageHeader>
  );
  if (!res.ok) return <><StickyToolbar>{header}</StickyToolbar><ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} /></>;
  const pages = Math.max(1, Math.ceil(res.data.total / 50));
  const link = (p: number) => `/prodazhi/pokupateli${qs({ ...query, page: String(p) })}`;

  return (
    <>
      <StickyToolbar>
      {header}
      <form className="flex flex-wrap items-center gap-3" action="/prodazhi/pokupateli">
        {query.from && <input type="hidden" name="from" value={query.from} />}
        {query.to && <input type="hidden" name="to" value={query.to} />}
        <Input name="search" defaultValue={query.search} placeholder={t("common.search")} aria-label={t("common.search")} className="w-56" />
        <Select
          name="agent"
          defaultValue={query.agent ?? ""}
          ariaLabel={t("outlets.agent")}
          options={[
            { value: "", label: `${t("outlets.agent")}: ${t("common.all")}` },
            ...(filters.ok ? filters.data.agents.map((a) => ({ value: a.sdId, label: a.name })) : []),
          ]}
        />
        <Select
          name="expeditor"
          defaultValue={query.expeditor ?? ""}
          ariaLabel={t("outlets.expeditor")}
          options={[
            { value: "", label: `${t("outlets.expeditor")}: ${t("common.all")}` },
            ...(filters.ok ? filters.data.expeditors.map((a) => ({ value: a.sdId, label: a.name })) : []),
          ]}
        />
        <CheckboxField name="nonZero" defaultChecked={query.nonZero === "true"} label={t("outlets.non_zero")} />
        <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
      </form>
      </StickyToolbar>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("outlets.name")}</TableHead>
              <TableHead className="text-right">{t("outlets.opening")}</TableHead>
              <TableHead className="text-right">{t("outlets.delivered")}</TableHead>
              <TableHead className="text-right">{t("outlets.returned")}</TableHead>
              <TableHead className="text-right">{t("outlets.paid")}</TableHead>
              <TableHead className="text-right">{t("outlets.closing")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.rows.length === 0 && (
              <TableRow><TableCell colSpan={6}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
            )}
            {res.data.rows.map((r) => (
              <TableRow key={r.outletSdId}>
                <TableCell className="max-w-72">
                  <Link href={`/prodazhi/pokupateli/${encodeURIComponent(r.outletSdId)}${qs({ from: query.from, to: query.to })}`} className="font-medium underline-offset-4 hover:underline">
                    <Text as="span" truncate className="block">{r.name}</Text>
                  </Link>
                  {r.inn && <Text variant="caption">{t("outlets.inn")} {r.inn}</Text>}
                </TableCell>
                <TableCell className="text-right"><Money value={r.opening} /></TableCell>
                <TableCell className="text-right"><Money value={r.delivered} /></TableCell>
                <TableCell className="text-right"><Money value={r.returned} /></TableCell>
                <TableCell className="text-right"><Money value={r.paid} /></TableCell>
                <TableCell className="text-right font-medium"><Money value={r.closing} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <nav className="flex items-center justify-between">
        <Text variant="caption">{t("common.page", { page: String(page), pages: String(pages) })}</Text>
        <div className="flex gap-2">
          <Link
            href={link(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={cn(buttonVariants({ variant: "outline" }), "active:scale-95", page <= 1 && "pointer-events-none opacity-50")}
          >
            {t("common.prev")}
          </Link>
          <Link
            href={link(Math.min(pages, page + 1))}
            aria-disabled={page >= pages}
            className={cn(buttonVariants({ variant: "outline" }), "active:scale-95", page >= pages && "pointer-events-none opacity-50")}
          >
            {t("common.next")}
          </Link>
        </div>
      </nav>
    </>
  );
}
