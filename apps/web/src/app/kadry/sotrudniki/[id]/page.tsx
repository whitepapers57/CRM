// 17 Oct 2026: unused since the tabs became PendingLinks:
// import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { HistoryButton } from "@/components/app/history-button";
import { HistoryList } from "@/components/app/history-list";
import { PageHeader } from "@/components/app/page-header";
import { PendingLink } from "@/components/app/pending-nav";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import type { MessageKey } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type AuditEntry, type KadryEmployee, type KadryReason, type KadrySalesdocAccount, type KadryStructure } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ageLabel, ageYears, historyNames } from "@/lib/kadry-rules";
import { tashkentInstant } from "@/lib/month-label";
import { tashkentToday } from "@/lib/today";
import { cn } from "@/lib/utils";
import { SalesdocTab } from "./salesdoc-tab";
import { StatusActions } from "./status-actions";
import { EducationTab, PersonalTab, RelativesTab, WorkTab } from "./tabs";

const TABS = ["work", "personal", "education", "relatives", "salesdoc"] as const;
type Tab = (typeof TABS)[number];

/**
 * The employee card: header with status and actions, key facts, and five tabs (?tab=).
 * The tab bodies live in ./tabs.tsx (work, personal, education, relatives) and ./salesdoc-tab.tsx to keep this file short.
 */
export default async function EmployeeCardPage({ params, searchParams }: PageProps<"/kadry/sotrudniki/[id]">) {
  const t = await getT();
  const locale = await getLocale();
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.find((x) => x === sp.tab) ?? "work";
  const enc = encodeURIComponent(id);
  const [res, history, reasons, sd, structure] = await Promise.all([
    apiGet<KadryEmployee>(`/kadry/employees/${enc}`),
    apiGet<AuditEntry[]>(`/kadry/employees/${enc}/history`),
    apiGet<KadryReason[]>("/kadry/reasons"),
    // 12 Oct 2026: was fetched on the Salesdoc tab only; the history names linked accounts on every tab.
    // tab === "salesdoc" ? apiGet<KadrySalesdocAccount[]>("/kadry/salesdoc-accounts") : Promise.resolve(null),
    apiGet<KadrySalesdocAccount[]>("/kadry/salesdoc-accounts"),
    apiGet<KadryStructure>("/kadry/structure"),
  ]);
  if (!res.ok) {
    return (
      <>
        <StickyToolbar><PageHeader back="/kadry/sotrudniki" title={t("kadry.employees")} /></StickyToolbar>
        <ApiError message={res.status === 0 ? t("errors.api_down") : res.status === 404 ? t("kadry.not_found") : res.message || t("errors.unknown")} />
      </>
    );
  }
  const e = res.data;
  const today = tashkentToday();
  const age = e.birthDate ? ageYears(e.birthDate, today) : null;
  const initials = [e.lastName, e.firstName].map((s) => s.trim().charAt(0).toUpperCase()).join("");
  const activeReasons = (reasons.ok ? reasons.data : []).filter((r) => r.active);
  const reasonText = e.terminationReason || t("kadry.no_reason");
  const facts: Array<[string, string]> = [
    [t("kadry.position"), e.positionName ?? "—"],
    [t("kadry.department"), e.departmentName ?? "—"],
    [t("kadry.pinfl"), e.pinfl ?? "—"],
    [t("kadry.age"), age == null ? "—" : ageLabel(age, locale)],
    [t("kadry.hired_at"), e.hiredAt ? formatDate(e.hiredAt) : "—"],
  ];
  return (
    <>
      <StickyToolbar>
        <PageHeader back="/kadry/sotrudniki" title={e.name}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={e.status === "terminated" ? "outline" : e.status === "intern" ? "secondary" : "default"}>{t(`kadry.status.${e.status}` as MessageKey)}</Badge>
            <HistoryButton label={t("history.open")}>
              <HistoryList bare entries={history.ok ? history.data : []} names={historyNames(structure.ok ? structure.data : null, sd.ok ? sd.data : null)} />
            </HistoryButton>
            <StatusActions id={e.id} name={e.name} status={e.status} canDelete={e.canDelete} reasons={activeReasons} locale={locale} />
          </div>
        </PageHeader>
      </StickyToolbar>
      {e.status === "terminated" && (
        <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {t("kadry.dismissed_banner", { date: e.terminatedAt ? formatDate(tashkentInstant(e.terminatedAt)) : "—", reason: reasonText })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold">{initials}</div>
        <dl className="flex min-w-0 flex-1 flex-wrap gap-x-6 gap-y-2">
          {facts.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col">
              <dt><Text variant="caption">{label}</Text></dt>
              <dd className="text-sm font-medium [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <nav aria-label={t("kadry.employees")} className="max-w-full overflow-x-auto">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {/* 17 Oct 2026: the tabs were plain <Link>s; a ?tab= change showed nothing while it loaded. */}
          {TABS.map((x) => (
            <PendingLink
              key={x}
              href={x === "work" ? `/kadry/sotrudniki/${enc}` : `/kadry/sotrudniki/${enc}?tab=${x}`}
              aria-current={x === tab ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition active:scale-95",
                x === tab ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
              )}
            >
              {t(`kadry.tab.${x}` as MessageKey)}
            </PendingLink>
          ))}
        </div>
      </nav>
      {tab === "work" && <WorkTab e={e} />}
      {tab === "personal" && <PersonalTab e={e} age={age} />}
      {tab === "education" && <EducationTab e={e} locale={locale} />}
      {tab === "relatives" && <RelativesTab e={e} locale={locale} />}
      {tab === "salesdoc" &&
        (sd && sd.ok ? (
          <SalesdocTab employeeId={e.id} accounts={e.accounts} all={sd.data} locale={locale} readOnly={e.status === "terminated"} />
        ) : (
          <ApiError message={sd && sd.status !== 0 ? sd.message || t("errors.unknown") : t("errors.api_down")} />
        ))}
    </>
  );
}
