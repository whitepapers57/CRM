"use client";

import { useRef, useState, useTransition } from "react";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import { cn } from "@/lib/utils";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;

/** «Удалить» with a confirm dialog; the server's refusal (e.g. «есть сотрудники») shows inside the dialog. */
export function DeleteConfirm({ name, locale, onDelete }: { name: string; locale: Locale; onDelete: () => Promise<{ ok: boolean; message?: string }> }) {
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const confirm = () => {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        setError(null);
        const r = await onDelete();
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
      <DialogTrigger className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>{t("kadry.delete")}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="leading-snug">{t("kadry.confirm_delete", { name })}</DialogTitle>
        {error && <Text role="alert" variant="error">{error}</Text>}
        <DialogFooter>
          <DialogClose className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>{t("common.cancel")}</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={pending} className="active:scale-95">
            {pending && <Spinner />}
            {t("kadry.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
