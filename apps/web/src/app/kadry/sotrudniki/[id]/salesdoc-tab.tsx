"use client";

import { useRef, useState, useTransition } from "react";
import { ProductPicker } from "@/components/app/product-picker";
import { Select } from "@/components/app/select";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import type { KadryAccount, KadrySalesdocAccount } from "@/lib/api";
import { linkAccount, unlinkAccount } from "../../actions";
import { ConfirmDelete } from "./confirm-delete";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
const KINDS = ["agent", "expeditor", "supervisor"] as const;

/** The employee's Salesdoc accounts, with «Отвязать», and a kind + searchable picker over the accounts nobody holds yet. */
export function SalesdocTab({
  employeeId,
  accounts,
  all,
  locale,
  readOnly,
}: {
  employeeId: string;
  accounts: KadryAccount[];
  all: KadrySalesdocAccount[];
  locale: Locale;
  /** A dismissed employee cannot take new accounts. */
  readOnly?: boolean;
}) {
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("agent");
  const [sdId, setSdId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  const known = new Map(all.map((a) => [`${a.kind}:${a.sdId}`, a]));
  const free = all.filter((a) => a.kind === kind && !a.employee && a.exists);

  const link = () => {
    if (busy.current) return;
    if (!sdId) {
      setError(t("kadry.pick_account"));
      return;
    }
    busy.current = true;
    start(async () => {
      try {
        setError(null);
        const r = await linkAccount(employeeId, kind, sdId);
        if (r.ok) setSdId("");
        else setError(r.message || t("errors.unknown"));
      } finally {
        busy.current = false;
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {accounts.length === 0 ? (
        <Text variant="caption">{t("kadry.no_accounts")}</Text>
      ) : (
        <ul className="divide-y rounded-lg border">
          {accounts.map((a) => {
            const meta = known.get(`${a.kind}:${a.sdId}`);
            return (
              <li key={`${a.kind}:${a.sdId}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
                <Badge variant="outline">{t(`kadry.kind.${a.kind}` as MessageKey)}</Badge>
                <span className="min-w-0 flex-1 basis-40 font-medium">{a.name}</span>
                {meta && !meta.exists && <Text variant="caption">{t("kadry.gone")}</Text>}
                {meta && meta.exists && !meta.active && <Text variant="caption">{t("kadry.inactive_sd")}</Text>}
                <ConfirmDelete
                  name={a.name}
                  locale={locale}
                  label={t("kadry.unlink")}
                  title={t("kadry.confirm_unlink", { name: a.name })}
                  onDelete={() => unlinkAccount(employeeId, a.kind, a.sdId)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div className="flex max-w-xl flex-col gap-3">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.pick_kind")}</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(KINDS.find((k) => k === v) ?? "agent");
                setSdId("");
                setError(null);
              }}
              ariaLabel={t("kadry.pick_kind")}
              className="w-full"
              options={KINDS.map((k) => ({ value: k, label: t(`kadry.kind.${k}` as MessageKey) }))}
            />
          </div>
          <div>
            <ProductPicker
              value={sdId}
              onChange={(v) => {
                setSdId(v);
                setError(null);
              }}
              products={free.map((a) => ({ sdId: a.sdId, name: a.name }))}
              label={t("kadry.pick_account")}
              placeholder={free.length === 0 ? t("kadry.no_free_accounts") : t("kadry.pick_account")}
              searchLabel={t("kadry.search_picker")}
              emptyLabel={t("kadry.nothing_found")}
              invalid={!!error}
            />
            {error && <Text role="alert" variant="error" className="mt-1">{error}</Text>}
          </div>
          <div>
            <Button onClick={link} disabled={pending} className="active:scale-95">
              {pending && <Spinner />}
              {t("kadry.link")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
