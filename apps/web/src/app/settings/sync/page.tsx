import { ApiError } from "@/components/app/api-error";
import { DataAsOf } from "@/components/app/data-as-of";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, type SyncStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { SyncButtons } from "./sync-buttons";

/** Real instants (sync times) shown in Tashkent wall time. */
const local = (iso: string) => formatDateTime(new Date(new Date(iso).getTime() + 5 * 3600 * 1000).toISOString());

export default async function SyncPage() {
  const t = await getT();
  const res = await apiGet<SyncStatus>("/sync/status");
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const s = res.data;
  const statusLabel = (st: string) =>
    st === "succeeded" ? t("sync.status.succeeded") : st === "failed" ? t("sync.status.failed") : t("sync.status.running");

  return (
    <>
      <StickyToolbar><PageHeader title={t("sync.title")}>
        <SyncButtons
          labels={{ run: t("sync.run"), full: t("sync.run_full"), running: t("sync.running"), alreadyRunning: t("sync.already_running"), started: t("sync.started"), failed: t("errors.unknown") }}
        />
      </PageHeader></StickyToolbar>
      <AutoRefresh active={s.running} />
      {s.running && <Text variant="caption" role="status">{t("sync.running")}</Text>}
      <DataAsOf iso={s.dataAsOf} label={(time) => t("data.as_of", { time })} never={t("data.never")} />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("sync.resource")}</TableHead>
              <TableHead>{t("sync.last_success")}</TableHead>
              <TableHead>{t("sync.last_run")}</TableHead>
              <TableHead className="text-right">{t("sync.records")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.resources.map((r) => (
              <TableRow key={r.resource}>
                <TableCell className="font-mono text-xs">{r.resource}</TableCell>
                <TableCell className="whitespace-nowrap">{r.lastSuccessAt ? local(r.lastSuccessAt) : "—"}</TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  {r.lastRun ? (
                    <div className="flex flex-col gap-1">
                      <Badge variant={r.lastRun.status === "failed" ? "destructive" : "default"}>{statusLabel(r.lastRun.status)}</Badge>
                      {r.lastRun.error && <Text variant="error">{r.lastRun.error}</Text>}
                      {r.resumePage && <Text variant="caption">{t("sync.resume_page", { page: String(r.resumePage) })}</Text>}
                    </div>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.lastRun?.records ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
