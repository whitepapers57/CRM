import type { MessageKey } from "@/i18n/messages";
import { getT } from "@/i18n/server";
import type { AuditEntry } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { monthLabel, tashkentInstant } from "@/lib/month-label";
import { Text } from "./text";

type Snapshot = {
  date?: string;
  warehouseSdId?: string | null;
  supplierSdId?: string | null;
  lines?: Array<{ productSdId: string | null; quantity: string; price: string }>;
};

function Lines({ s, names }: { s: Snapshot; names: Record<string, string> }) {
  return (
    <ul className="ml-4 list-disc">
      {s.date && <li>{formatDate(s.date)}</li>}
      {s.warehouseSdId && <li>{names[s.warehouseSdId] ?? s.warehouseSdId}</li>}
      {s.supplierSdId && <li>{names[s.supplierSdId] ?? s.supplierSdId}</li>}
      {s.lines?.map((l, i) => (
        <li key={i}>
          {(l.productSdId && names[l.productSdId]) || l.productSdId} — {l.quantity} × {l.price}
        </li>
      ))}
    </ul>
  );
}

/** Append-only history, newest first. `names` maps sdIds (warehouse, supplier, product) to names. */
export async function HistoryList({ entries, names = {} }: { entries: AuditEntry[]; names?: Record<string, string> }) {
  const t = await getT();
  return (
    <section className="flex flex-col gap-2">
      <Text as="h2" variant="subtitle">{t("history.title")}</Text>
      {entries.length === 0 ? (
        <Text variant="caption">{t("history.empty")}</Text>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 p-3 text-sm">
              <div className="flex flex-wrap gap-x-3">
                <span className="tabular-nums text-muted-foreground">{formatDateTime(tashkentInstant(e.at))}</span>
                <span className="font-medium">{e.userName}</span>
                <span>{t(`history.action.${e.action}` as MessageKey)}</span>
                {e.action.startsWith("month.") && <span>{monthLabel(e.target, t)}</span>}
              </div>
              {e.reason && <Text variant="caption">{e.reason}</Text>}
              {e.action === "purchase.edit" && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("history.before")} → {t("history.after")}
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <Text variant="caption">{t("history.before")}</Text>
                      <Lines s={(e.before ?? {}) as Snapshot} names={names} />
                    </div>
                    <div>
                      <Text variant="caption">{t("history.after")}</Text>
                      <Lines s={(e.after ?? {}) as Snapshot} names={names} />
                    </div>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
