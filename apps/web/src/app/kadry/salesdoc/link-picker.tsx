"use client";

import { useRef, useState, useTransition } from "react";
import { ProductPicker } from "@/components/app/product-picker";
import { Text } from "@/components/app/text";
import { Button } from "@/components/ui/button";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import { linkAccount, unlinkAccount } from "../actions";
import { ConfirmDelete } from "../sotrudniki/[id]/confirm-delete";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;

/** For an unlinked account: a searchable employee picker over the working staff and «Привязать». */
export function LinkPicker({
  kind,
  sdId,
  employees,
  locale,
}: {
  kind: string;
  sdId: string;
  employees: Array<{ id: string; name: string }>;
  locale: Locale;
}) {
  const t = (key: MessageKey) => translate(locale, key);
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const link = () => {
    if (busy.current) return;
    if (!employeeId) {
      setError(t("kadry.pick_employee"));
      return;
    }
    busy.current = true;
    start(async () => {
      try {
        setError(null);
        const r = await linkAccount(employeeId, kind, sdId);
        // 12 Oct 2026: a failed link also clears the choice (the refreshed list may no longer hold it).
        if (!r.ok) {
          setEmployeeId("");
          setError(r.message || t("errors.unknown"));
        }
      } finally {
        busy.current = false;
      }
    });
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1 basis-56">
          <ProductPicker
            value={employeeId}
            onChange={(v) => {
              setEmployeeId(v);
              setError(null);
            }}
            products={employees.map((e) => ({ sdId: e.id, name: e.name }))}
            label={t("kadry.pick_employee")}
            placeholder={t("kadry.pick_employee")}
            searchLabel={t("kadry.search_picker")}
            emptyLabel={t("kadry.nothing_found")}
            invalid={!!error}
          />
        </div>
        <Button variant="outline" size="sm" onClick={link} disabled={pending} className="active:scale-95">
          {pending && <Spinner />}
          {t("kadry.link")}
        </Button>
      </div>
      {error && <Text role="alert" variant="error">{error}</Text>}
    </div>
  );
}

/** «Отвязать» for a linked row, with a confirm dialog. */
export function UnlinkButton({ employeeId, kind, sdId, name, locale }: { employeeId: string; kind: string; sdId: string; name: string; locale: Locale }) {
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
  return (
    <ConfirmDelete
      name={name}
      locale={locale}
      label={t("kadry.unlink")}
      title={t("kadry.confirm_unlink", { name })}
      onDelete={() => unlinkAccount(employeeId, kind, sdId)}
    />
  );
}
