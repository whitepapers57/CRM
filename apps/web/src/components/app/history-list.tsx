import Link from "next/link";
import type { MessageKey } from "@/i18n/messages";
import { getT } from "@/i18n/server";
import type { AuditEntry } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { changedCashFields, type CashSnapField } from "@/lib/cash-ops";
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

type CashSnap = Record<string, unknown>;
const CASH_LABEL: Record<CashSnapField, MessageKey> = {
  date: "money.date", amount: "money.amount", account: "money.account_type", cashboxSdId: "money.cashbox", bankAccountId: "money.bank_account",
  supplierSdId: "money.supplier", outletSdId: "money.buyer", categoryId: "money.category", counterpartyName: "money.party_name", comment: "money.comment",
};

// 6 Oct 2026: showed only date, amount and comment, hiding every other change. Now every changed field, with names.
// function CashSnapshot({ s }: { s: CashSnap }) { ... date / amount / comment only ... }
function CashSnapshot({ s, fields, names, t }: { s: CashSnap; fields: CashSnapField[]; names: Record<string, string>; t: (k: MessageKey) => string }) {
  const show = (f: CashSnapField): string => {
    const v = s[f];
    if (v == null || v === "") return "—";
    if (f === "date") return formatDate(String(v));
    if (f === "amount") return formatMoney(String(v));
    if (f === "account") return t(v === "bank" ? "money.bank" : "money.cash");
    if (f === "cashboxSdId" || f === "bankAccountId" || f === "supplierSdId" || f === "outletSdId" || f === "categoryId") return names[String(v)] ?? String(v);
    return String(v);
  };
  return (
    <ul className="ml-4 list-disc">
      {fields.map((f) => (
        <li key={f}>
          <span className="text-muted-foreground">{t(CASH_LABEL[f])}: </span>
          {show(f)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Append-only history, newest first. `names` maps sdIds (warehouse, supplier, product) to names.
 * `linkFor` maps an entry's target to a link (href + visible label, e.g. «№ d0_432»); `bare` drops the heading (a dialog has its own).
 */
export async function HistoryList({
  entries,
  names = {},
  linkFor,
  bare = false,
}: {
  entries: AuditEntry[];
  names?: Record<string, string>;
  linkFor?: Record<string, { href: string; label: string }>;
  bare?: boolean;
}) {
  const t = await getT();
  return (
    <section className="flex flex-col gap-2">
      {!bare && <Text as="h2" variant="subtitle">{t("history.title")}</Text>}
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
                {linkFor?.[e.target] && (
                  <Link href={linkFor[e.target].href} className="text-xs underline-offset-4 hover:underline">{linkFor[e.target].label}</Link>
                )}
              </div>
              {e.reason && <Text variant="caption">{e.reason}</Text>}
              {e.action === "cash.edit" && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("history.before")} → {t("history.after")}
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <Text variant="caption">{t("history.before")}</Text>
                      <CashSnapshot s={(e.before ?? {}) as CashSnap} fields={changedCashFields((e.before ?? {}) as CashSnap, (e.after ?? {}) as CashSnap)} names={names} t={t} />
                    </div>
                    <div>
                      <Text variant="caption">{t("history.after")}</Text>
                      <CashSnapshot s={(e.after ?? {}) as CashSnap} fields={changedCashFields((e.before ?? {}) as CashSnap, (e.after ?? {}) as CashSnap)} names={names} t={t} />
                    </div>
                  </div>
                </details>
              )}
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
