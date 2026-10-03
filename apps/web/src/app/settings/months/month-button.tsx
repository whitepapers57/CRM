"use client";

import { useState, useTransition } from "react";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { setMonth } from "./actions";

/** «Закрыть» / «Открыть» behind a confirmation dialog. */
export function MonthButton({
  month,
  closed,
  labels,
}: {
  month: string;
  closed: boolean;
  labels: { action: string; confirm: string; ok: string; cancel: string; failed: string };
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      setError(null);
      const r = await setMonth(month, !closed);
      if (r.ok) setOpen(false);
      else setError(r.message || labels.failed);
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <DialogTrigger className={cn(buttonVariants({ variant: closed ? "outline" : "secondary", size: "sm" }), "active:scale-95")}>
        {labels.action}
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="leading-snug">{labels.confirm}</DialogTitle>
        {error && <Text variant="error" role="alert">{error}</Text>}
        <DialogFooter>
          <DialogClose className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>{labels.cancel}</DialogClose>
          <Button onClick={go} disabled={pending} className="active:scale-95">
            {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {labels.ok}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
