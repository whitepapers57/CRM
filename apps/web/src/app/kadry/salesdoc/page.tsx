import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { PendingLink } from "@/components/app/pending-nav";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MessageKey } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type KadryEmployeeRow, type KadrySalesdocAccount } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LinkPicker, UnlinkButton } from "./link-picker";

const KIND_ORDER = { agent: 0, expeditor: 1, supervisor: 2 } as const;

/** Salesdoc routes, expeditors and supervisors with the employee each is linked to; the unlinked ones can be linked right here. */
export default async function SalesdocAccountsPage({ searchParams }: PageProps<"/kadry/salesdoc">) {
  const t = await getT();
  const locale = await getLocale();
  const sp = await searchParams;
  const onlyUnlinked = sp.only === "unlinked";
  const [res, staff] = await Promise.all([
    apiGet<KadrySalesdocAccount[]>("/kadry/salesdoc-accounts"),
    apiGet<KadryEmployeeRow[]>("/kadry/employees?status=working"),
  ]);
  const header = <PageHeader back="/kadry" title={t("kadry.salesdoc")} />;
  if (!res.ok) {
    return (
      <>
        <StickyToolbar>{header}</StickyToolbar>
        <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />
      </>
    );
  }
  const employees = staff.ok ? staff.data.map((e) => ({ id: e.id, name: e.name })) : [];
  const all = [...res.data].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, "ru"));
  const rows = onlyUnlinked ? all.filter((a) => !a.employee) : all;
  const tab = (active: boolean) => cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }), "active:scale-95");
  return (
    <>
      <StickyToolbar>
        {header}
        <div className="flex flex-wrap gap-2">
          {/* 17 Oct 2026: plain <Link>s; a search-param-only change showed nothing while it loaded. */}
          <PendingLink href="/kadry/salesdoc" aria-current={onlyUnlinked ? undefined : "page"} className={tab(!onlyUnlinked)}>{t("common.all")} · {all.length}</PendingLink>
          <PendingLink href="/kadry/salesdoc?only=unlinked" aria-current={onlyUnlinked ? "page" : undefined} className={tab(onlyUnlinked)}>
            {t("kadry.only_unlinked")} · {all.filter((a) => !a.employee).length}
          </PendingLink>
        </div>
      </StickyToolbar>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="max-sm:hidden">
            <TableRow>
              <TableHead>{t("kadry.col.kind")}</TableHead>
              <TableHead>{t("kadry.col.account")}</TableHead>
              <TableHead>{t("kadry.col.employee")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={3}><Text variant="caption">{t("kadry.salesdoc_empty")}</Text></TableCell></TableRow>
            )}
            {rows.map((a) => (
              <TableRow key={`${a.kind}:${a.sdId}`} className="max-sm:block max-sm:py-1">
                <TableCell className="align-top max-sm:block max-sm:pb-0"><Badge variant="outline">{t(`kadry.kind.${a.kind}` as MessageKey)}</Badge></TableCell>
                <TableCell className="align-top max-sm:block max-sm:pb-0">
                  <span className="font-medium">{a.name}</span>
                  {!a.exists && <Text variant="caption">{t("kadry.gone")}</Text>}
                  {a.exists && !a.active && <Text variant="caption">{t("kadry.inactive_sd")}</Text>}
                </TableCell>
                <TableCell className="align-top max-sm:block">
                  {a.employee ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/kadry/sotrudniki/${encodeURIComponent(a.employee.id)}?tab=salesdoc`} className="underline-offset-4 hover:underline">{a.employee.name}</Link>
                      <UnlinkButton employeeId={a.employee.id} kind={a.kind} sdId={a.sdId} name={a.name} locale={locale} />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Text variant="caption">{t("kadry.not_linked")}</Text>
                      {a.exists && <LinkPicker kind={a.kind} sdId={a.sdId} employees={employees} locale={locale} />}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
