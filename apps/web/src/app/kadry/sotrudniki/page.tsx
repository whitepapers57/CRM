import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { HistoryButton } from "@/components/app/history-button";
import { HistoryList } from "@/components/app/history-list";
import { PageHeader } from "@/components/app/page-header";
import { Select } from "@/components/app/select";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MessageKey } from "@/i18n/messages";
import { getT } from "@/i18n/server";
import { apiGet, qs, type AuditEntry, type KadryEmployeeRow, type KadryMetrics, type KadryStructure } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { tenureLabel } from "@/lib/kadry-rules";
import { cn } from "@/lib/utils";

const STATUSES = ["working", "terminated", "all"] as const;

function Metric({ title, value, hint, children }: { title: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <Text variant="caption">{title}</Text>
        <Text as="div" variant="subtitle" className="text-2xl font-semibold tabular-nums">{value}</Text>
        {children}
        {hint && <Text variant="caption">{hint}</Text>}
      </CardContent>
    </Card>
  );
}

export default async function EmployeesPage({ searchParams }: PageProps<"/kadry/sotrudniki">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const status = (STATUSES as readonly string[]).includes(get("status") ?? "") ? (get("status") as string) : "working";
  const q = { status, department: get("department"), position: get("position"), search: get("search")?.trim() || undefined };
  const [res, structure, metrics, history] = await Promise.all([
    apiGet<KadryEmployeeRow[]>(`/kadry/employees${qs(q)}`),
    apiGet<KadryStructure>("/kadry/structure"),
    apiGet<KadryMetrics>("/kadry/metrics"),
    apiGet<AuditEntry[]>("/kadry/history/employees"),
  ]);
  const rows = res.ok ? res.data : [];
  const entries = history.ok ? history.data : [];
  const linkFor = Object.fromEntries(
    entries.map((e) => [
      e.target,
      { href: `/kadry/sotrudniki/${encodeURIComponent(e.target)}`, label: rows.find((r) => r.id === e.target)?.name ?? t("history.open_document") },
    ]),
  );
  const departments = structure.ok ? structure.data.departments : [];
  const positions = structure.ok ? structure.data.positions : [];
  const header = (
    <PageHeader back="/kadry" title={t("kadry.employees")}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/kadry/sotrudniki/new" className={cn(buttonVariants(), "active:scale-95")}>{t("kadry.create")}</Link>
        <HistoryButton label={t("history.open")}>
          <HistoryList bare entries={entries} linkFor={linkFor} />
        </HistoryButton>
      </div>
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
  const m = metrics.ok ? metrics.data : null;
  const sexTotal = m ? m.male + m.female : 0;
  const malePct = m && sexTotal ? Math.round((m.male / sexTotal) * 100) : 0;
  const noData = t("kadry.m.no_data");
  return (
    <>
      <StickyToolbar>
        {header}
        <form className="flex flex-wrap items-center gap-3" action="/kadry/sotrudniki">
          <Select
            name="department"
            defaultValue={q.department ?? ""}
            ariaLabel={t("kadry.department")}
            options={[
              { value: "", label: `${t("kadry.department")}: ${t("common.all")}` },
              { value: "none", label: t("kadry.no_department") },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
          <Select
            name="position"
            defaultValue={q.position ?? ""}
            ariaLabel={t("kadry.position")}
            options={[{ value: "", label: `${t("kadry.position")}: ${t("common.all")}` }, ...positions.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <Input name="search" defaultValue={q.search} placeholder={t("kadry.search")} aria-label={t("kadry.search")} className="w-72 max-w-full" />
          <Select
            name="status"
            defaultValue={status}
            ariaLabel={t("kadry.status")}
            options={STATUSES.map((s) => ({ value: s, label: t(`kadry.st.${s}` as MessageKey) }))}
          />
          <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
        </form>
      </StickyToolbar>

      {m && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Metric title={t("kadry.m.headcount")} value={String(m.headcount)} hint={t("kadry.m.headcount_hint")} />
          <Metric title={t("kadry.m.age")} value={m.averageAge == null ? "—" : String(Math.round(m.averageAge))} hint={m.averageAge == null ? noData : t("kadry.m.years")} />
          <Metric title={t("kadry.m.gender")} value={sexTotal ? `${malePct}% / ${100 - malePct}%` : "—"} hint={sexTotal ? undefined : noData}>
            {sexTotal > 0 && (
              <>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="bg-sky-500" style={{ width: `${malePct}%` }} />
                  <div className="bg-pink-400" style={{ width: `${100 - malePct}%` }} />
                </div>
                <Text variant="caption">{t("kadry.m.male_short")} {m.male} · {t("kadry.m.female_short")} {m.female}</Text>
              </>
            )}
          </Metric>
          <Metric title={t("kadry.m.tenure")} value={m.averageTenureMonths == null ? "—" : tenureLabel(m.averageTenureMonths)} hint={m.averageTenureMonths == null ? noData : undefined} />
          <Metric
            title={t("kadry.m.turnover")}
            value={m.turnoverPercent == null ? "—" : `${m.turnoverPercent}%`}
            hint={m.turnoverPercent == null ? noData : t("kadry.m.turnover_hint", { n: String(m.dismissed12m) })}
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">{t("kadry.col.n")}</TableHead>
              <TableHead>{t("kadry.position")}</TableHead>
              <TableHead>{t("kadry.last_name")}</TableHead>
              <TableHead>{t("kadry.first_name")}</TableHead>
              <TableHead>{t("kadry.middle_name")}</TableHead>
              <TableHead>{t("kadry.employment_type")}</TableHead>
              <TableHead>{t("kadry.hired_at")}</TableHead>
              <TableHead>{t("kadry.accounts")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={8}><Text variant="caption">{t("kadry.empty")}</Text></TableCell></TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={r.id} className={cn("relative hover:bg-muted/50", r.status === "terminated" && "text-muted-foreground")}>
                <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell>{r.positionName ?? "—"}</TableCell>
                <TableCell className="font-medium">
                  <Link href={`/kadry/sotrudniki/${encodeURIComponent(r.id)}`} className="after:absolute after:inset-0">{r.lastName}</Link>
                  {r.status === "intern" && <Badge variant="secondary" className="ml-2">{t("kadry.status.intern")}</Badge>}
                  {r.status === "terminated" && <Badge variant="outline" className="ml-2">{t("kadry.status.terminated")}</Badge>}
                </TableCell>
                <TableCell>{r.firstName}</TableCell>
                <TableCell>{r.middleName ?? "—"}</TableCell>
                <TableCell>{r.employmentType ? <Badge variant="outline">{t(`kadry.et_short.${r.employmentType}` as MessageKey)}</Badge> : "—"}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{r.hiredAt ? formatDate(r.hiredAt) : "—"}</TableCell>
                <TableCell>{r.accounts.length ? r.accounts.map((a) => a.name).join(", ") : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
