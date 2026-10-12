"use client";

import { useRef, useState, useTransition } from "react";
import { Field } from "@/components/app/field";
import { Select } from "@/components/app/select";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import type { KadryDepartment } from "@/lib/api";
import { serverErrorKey } from "@/lib/kadry-rules";
import { cn } from "@/lib/utils";
import { deleteDepartment, saveDepartment } from "../actions";
import { DeleteConfirm } from "./delete-confirm";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;

/** Create (department = null) or edit a department. The save is full replace: sortOrder and the head are always sent. */
export function DepartmentDialog({
  department,
  nextSort,
  employees,
  locale,
}: {
  department: KadryDepartment | null;
  nextSort: number;
  employees: { id: string; name: string }[];
  locale: Locale;
}) {
  const t = (key: MessageKey) => translate(locale, key);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sort, setSort] = useState("");
  const [head, setHead] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [sortError, setSortError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  const reset = () => {
    setName(department?.name ?? "");
    setSort(String(department?.sortOrder ?? nextSort));
    setHead(department?.headEmployeeId ?? "");
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
        const r = await saveDepartment(department?.id ?? null, { name: name.trim(), sortOrder: n, headEmployeeId: head || null });
        if (r.ok) setOpen(false);
        else if (r.code === "duplicate_department" && serverErrorKey(r.code)) setNameError(t(serverErrorKey(r.code)!));
        else setError(r.message || t("errors.unknown"));
      } finally {
        busy.current = false;
      }
    });
  };
  // A head who has since left the active list must still show, or saving would silently drop them.
  const options = [
    { value: "", label: t("kadry.not_set") },
    ...(department?.headEmployeeId && !employees.some((e) => e.id === department.headEmployeeId)
      ? [{ value: department.headEmployeeId, label: department.headName ?? department.headEmployeeId }]
      : []),
    ...employees.map((e) => ({ value: e.id, label: e.name })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger className={cn(buttonVariants({ variant: department ? "outline" : "default" }), "active:scale-95")}>
        {department ? t("kadry.edit") : t("kadry.add_department")}
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{department ? t("kadry.department") : t("kadry.add_department")}</DialogTitle>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={t("kadry.name")} value={name} error={nameError ?? undefined} onChange={(e) => { setName(e.target.value); setNameError(null); }} />
          <Field label={t("kadry.sort")} type="number" value={sort} error={sortError ?? undefined} onChange={(e) => { setSort(e.target.value); setSortError(null); }} />
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.head")}</Label>
            <Select value={head} onValueChange={setHead} options={options} ariaLabel={t("kadry.head")} className="w-full" />
          </div>
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

export function DeleteDepartment({ id, name, locale }: { id: string; name: string; locale: Locale }) {
  return <DeleteConfirm name={name} locale={locale} onDelete={() => deleteDepartment(id)} />;
}
