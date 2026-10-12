"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Select } from "@/components/app/select";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { deleteEmployee, dismissEmployee, makePermanent, restoreEmployee } from "../../actions";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
type Result = { ok: boolean; message?: string };

/** A confirm dialog: trigger button, title, optional body, server error inside, «Отмена» and the action with a spinner. */
function ConfirmAction({
  trigger,
  title,
  confirmLabel,
  destructive,
  locale,
  run,
  children,
  validate,
  triggerVariant = "outline",
}: {
  trigger: string;
  title: string;
  confirmLabel: string;
  destructive?: boolean;
  locale: Locale;
  run: () => Promise<Result>;
  children?: React.ReactNode;
  /** Returns false to stop before calling `run` (it shows its own error). */
  validate?: () => boolean;
  triggerVariant?: "outline" | "default";
}) {
  const t = (key: MessageKey) => translate(locale, key);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const go = () => {
    if (busy.current) return;
    if (validate && !validate()) return;
    busy.current = true;
    start(async () => {
      try {
        setError(null);
        const r = await run();
        if (r.ok) setOpen(false);
        else setError(r.message || t("errors.unknown"));
      } finally {
        busy.current = false;
      }
    });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <DialogTrigger className={cn(buttonVariants({ variant: triggerVariant }), "active:scale-95")}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="leading-snug">{title}</DialogTitle>
        {children}
        {error && <Text role="alert" variant="error">{error}</Text>}
        <DialogFooter>
          <DialogClose className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>{t("common.cancel")}</DialogClose>
          <Button variant={destructive ? "destructive" : "default"} onClick={go} disabled={pending} className="active:scale-95">
            {pending && <Spinner />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The card header's buttons: make permanent (interns), dismiss / restore, and delete (only when the API says it can). */
export function StatusActions({
  id,
  name,
  status,
  canDelete,
  reasons,
  locale,
}: {
  id: string;
  name: string;
  status: "intern" | "active" | "terminated";
  canDelete: boolean;
  reasons: Array<{ id: string; label: string }>;
  locale: Locale;
}) {
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
  const router = useRouter();
  const [reasonId, setReasonId] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "intern" && (
        <ConfirmAction
          trigger={t("kadry.make_permanent")}
          title={t("kadry.confirm_make_permanent", { name })}
          confirmLabel={t("kadry.make_permanent")}
          locale={locale}
          run={() => makePermanent(id)}
        />
      )}
      {status !== "terminated" && (
        <ConfirmAction
          trigger={t("kadry.dismiss")}
          title={t("kadry.dismiss_title")}
          confirmLabel={t("kadry.dismiss")}
          destructive
          locale={locale}
          validate={() => {
            if (reasons.length === 0) return false;
            if (!reasonId) {
              setReasonError(t("errors.required"));
              return false;
            }
            return true;
          }}
          run={() => dismissEmployee(id, reasonId)}
        >
          <Text variant="body">{t("kadry.dismiss_text", { name })}</Text>
          {reasons.length === 0 ? (
            <Text variant="caption">
              {t("kadry.no_reasons")}{" "}
              <Link href="/kadry/prichiny" className="underline underline-offset-4">{t("kadry.reasons")}</Link>
            </Text>
          ) : (
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.reason")}</Label>
              <Select
                value={reasonId}
                onValueChange={(v) => {
                  setReasonId(v);
                  setReasonError(null);
                }}
                invalid={!!reasonError}
                ariaLabel={t("kadry.reason")}
                className="w-full"
                options={[{ value: "", label: "—" }, ...reasons.map((r) => ({ value: r.id, label: r.label }))]}
              />
              {reasonError && <Text role="alert" variant="error" className="mt-1">{reasonError}</Text>}
            </div>
          )}
        </ConfirmAction>
      )}
      {status === "terminated" && (
        <ConfirmAction
          trigger={t("kadry.restore")}
          title={t("kadry.confirm_restore", { name })}
          confirmLabel={t("kadry.restore")}
          locale={locale}
          run={() => restoreEmployee(id)}
        />
      )}
      {canDelete && (
        <ConfirmAction
          trigger={t("kadry.delete")}
          title={t("kadry.confirm_delete_employee", { name })}
          confirmLabel={t("kadry.delete")}
          destructive
          locale={locale}
          run={async () => {
            const r = await deleteEmployee(id);
            if (r.ok) router.push("/kadry/sotrudniki");
            return r;
          }}
        />
      )}
    </div>
  );
}
