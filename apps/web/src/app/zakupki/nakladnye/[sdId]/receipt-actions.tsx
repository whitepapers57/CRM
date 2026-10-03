"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Field } from "@/components/app/field";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { deleteReceipt, restoreReceipt } from "../actions";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;

/** Редактировать / Удалить (open month), Восстановить (hidden, open month), or «Месяц закрыт». */
export function ReceiptActions({
  sdId,
  monthOpen,
  hidden,
  locale,
}: {
  sdId: string;
  monthOpen: boolean;
  hidden: boolean;
  locale: Locale;
}) {
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!monthOpen) return <Text variant="caption">{t("receipt.month_closed")}</Text>;

  if (hidden) {
    return (
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <Button
          variant="outline"
          disabled={pending}
          className="active:scale-95"
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await restoreReceipt(sdId);
              if (!r.ok) setError(r.message || t("errors.unknown"));
            })
          }
        >
          {pending && <Spinner />}
          {t("receipt.restore")}
        </Button>
        {error && <Text role="alert" variant="error">{error}</Text>}
      </div>
    );
  }

  const remove = () => {
    if (!reason.trim()) {
      setReasonError(t("errors.required"));
      return;
    }
    start(async () => {
      setError(null);
      const r = await deleteReceipt(sdId, reason.trim());
      if (r.ok) setOpen(false);
      else setError(r.message || t("errors.unknown"));
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/zakupki/nakladnye/${encodeURIComponent(sdId)}/edit`} className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>
        {t("receipt.edit")}
      </Link>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) {
            setReason("");
            setReasonError(null);
            setError(null);
          }
        }}
      >
        <DialogTrigger className={cn(buttonVariants({ variant: "destructive" }), "active:scale-95")}>{t("receipt.delete")}</DialogTrigger>
        <DialogContent>
          <DialogTitle className="leading-snug">{t("receipt.confirm_delete", { number: sdId })}</DialogTitle>
          <Field
            label={t("receipt.reason")}
            value={reason}
            error={reasonError ?? undefined}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") remove();
            }}
          />
          {error && <Text role="alert" variant="error">{error}</Text>}
          <DialogFooter>
            <DialogClose className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>{t("common.cancel")}</DialogClose>
            <Button variant="destructive" onClick={remove} disabled={pending} className="active:scale-95">
              {pending && <Spinner />}
              {t("receipt.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
