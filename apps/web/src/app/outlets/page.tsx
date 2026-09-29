import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { Text } from "@/components/app/text";
import { Select } from "@/components/app/select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type OutletBalance } from "@/lib/api";
import { tashkentToday } from "@/lib/today";
import { cn } from "@/lib/utils";

type Filters = { agents: Array<{ sdId: string; name: string }>; expeditors: Array<{ sdId: string; name: string }> };

export default async function Outlets({ searchParams }: PageProps<"/outlets">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const page = Math.max(1, Number(get("page")) || 1);
  const query = { from: get("from"), to: get("to"), search: get("search"), agent: get("agent"), expeditor: get("expeditor"), nonZero: get("nonZero") };
  const [res, filters] = await Promise.all([
    apiGet<{ total: number; rows: OutletBalance[] }>(`/outlets/balances${qs({ ...query, page: String(page) })}`),
    apiGet<Filters>("/outlets/filters"),
  ]);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const pages = Math.max(1, Math.ceil(res.data.total / 50));
  const today = tashkentToday();
  const link = (p: number) => `/outlets${qs({ ...query, page: String(p) })}`;
  const period = { from: query.from ?? `${today.slice(0, 7)}-01`, to: query.to ?? today };

  return (
    <>
      <PageHeader title={t("nav.outlets")}>
        <PeriodFilter
          from={period.from}
          to={period.to}
          labels={{ from: t("period.from"), to: t("period.to"), apply: t("common.apply"), invalid: t("errors.date_invalid"), order: t("errors.period_order") }}
        />
      </PageHeader>

      <form className="flex flex-wrap items-center gap-3" action="/outlets">
        {query.from && <input type="hidden" name="from" value={query.from} />}
        {query.to && <input type="hidden" name="to" value={query.to} />}
        <Input name="search" defaultValue={query.search} placeholder={t("common.search")} aria-label={t("common.search")} className="w-56" />
        <Select name="agent" defaultValue={query.agent ?? ""} aria-label={t("outlets.agent")}>
          <option value="">{t("outlets.agent")}: {t("common.all")}</option>
          {filters.ok && filters.data.agents.map((a) => <option key={a.sdId} value={a.sdId}>{a.name}</option>)}
        </Select>
        <Select name="expeditor" defaultValue={query.expeditor ?? ""} aria-label={t("outlets.expeditor")}>
          <option value="">{t("outlets.expeditor")}: {t("common.all")}</option>
          {filters.ok && filters.data.expeditors.map((a) => <option key={a.sdId} value={a.sdId}>{a.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="nonZero" value="true" defaultChecked={query.nonZero === "true"} />
          {t("outlets.non_zero")}
        </label>
        <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
      </form>

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
                  <Link href={`/outlets/${encodeURIComponent(r.outletSdId)}${qs({ from: query.from, to: query.to })}`} className="font-medium underline-offset-4 hover:underline">
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
