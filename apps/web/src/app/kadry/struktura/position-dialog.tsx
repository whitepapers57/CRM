"use client";

import { useRef, useState, useTransition } from "react";
import { Field } from "@/components/app/field";
import { Select } from "@/components/app/select";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import type { KadryPosition } from "@/lib/api";
import { cn } from "@/lib/utils";
import { deletePosition, savePosition } from "../actions";
import { DeleteConfirm } from "./delete-confirm";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Create (position = null) or edit a position. The save is full replace: every field is always sent. */
export function PositionDialog({
  position,
  nextSort,
  departments,
  locale,
}: {
  position: KadryPosition | null;
  nextSort: number;
  departments: { id: string; name: string }[];
  locale: Locale;
}) {
  const t = (key: MessageKey) => translate(locale, key);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("");
  const [time, setTime] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [description, setDescription] = useState("");
  const [sort, setSort] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [sortError, setSortError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  const reset = () => {
    setName(position?.name ?? "");
    setDept(position?.departmentId ?? "");
    setTime(position?.startTime ?? "");
    setDays(position?.workdays ?? []);
    setDescription(position?.description ?? "");
    setSort(String(position?.sortOrder ?? nextSort));
    setNameError(null);
    setSortError(null);
    setError(null);
  };
  const submit = () => {
    if (busy.current) return;
    const n = Number(sort);
    const bad = sort.trim() === "" || !Number.isInteger(n);
    setNameError(name.trim() ? null : t("errors.required"));
    setSortError(bad ? t("errors.required") : null);
    if (!name.trim() || bad) return;
    busy.current = true;
    start(async () => {
      try {
        setError(null);
        const r = await savePosition(position?.id ?? null, {
          name: name.trim(),
          departmentId: dept || null,
          description: description.trim() || null,
          sortOrder: n,
          startTime: time || null,
          workdays: [...days].sort((a, b) => a - b),
        });
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
        if (o) reset();
      }}
    >
      <DialogTrigger className={cn(buttonVariants({ variant: position ? "outline" : "default" }), "active:scale-95")}>
        {position ? t("kadry.edit") : t("kadry.add_position")}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{position ? t("kadry.position") : t("kadry.add_position")}</DialogTitle>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={t("kadry.name")} value={name} error={nameError ?? undefined} onChange={(e) => { setName(e.target.value); setNameError(null); }} />
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.department")}</Label>
            <Select
              value={dept}
              onValueChange={setDept}
              ariaLabel={t("kadry.department")}
              className="w-full"
              options={[{ value: "", label: t("kadry.no_department") }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
            />
          </div>
          <div>
            <Field label={t("kadry.start_time")} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            <Text variant="caption" className="mt-1">{t("kadry.start_time_hint")}</Text>
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.workdays")}</Label>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d) => {
                const on = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                    className={cn(
                      "h-9 min-w-11 rounded-lg border px-2 text-sm transition active:scale-95",
                      on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                    )}
                  >
                    {t(`kadry.wd.${d}` as MessageKey)}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label={t("kadry.description")} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Field label={t("kadry.sort")} type="number" value={sort} error={sortError ?? undefined} onChange={(e) => { setSort(e.target.value); setSortError(null); }} />
          {error && <Text role="alert" variant="error">{error}</Text>}
          <DialogFooter>
            <DialogClose className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>{t("common.cancel")}</DialogClose>
            <Button type="submit" disabled={pending} className="active:scale-95">
              {pending && <Spinner />}
              {t("kadry.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeletePosition({ id, name, locale }: { id: string; name: string; locale: Locale }) {
  return <DeleteConfirm name={name} locale={locale} onDelete={() => deletePosition(id)} />;
}
