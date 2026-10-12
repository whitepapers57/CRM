"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { DateField } from "@/components/app/date-field";
import { Field } from "@/components/app/field";
import { Select } from "@/components/app/select";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import type { KadryStructure } from "@/lib/api";
import { EMPLOYMENT_TYPES, emptyEmployeeForm, employeeProblems, positionOptions, serverErrorKey, type EmployeeForm, type EmployeeProblems } from "@/lib/kadry-rules";
import { cn } from "@/lib/utils";
import { createEmployee, updateEmployee } from "../actions";
import { ScheduleEditor } from "./schedule-editor";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;

/** «Пн–Сб» for a run of consecutive days, «Пн, Ср» otherwise. */
function daysLabel(days: number[], t: (k: MessageKey) => string): string {
  const d = [...days].sort((a, b) => a - b);
  const name = (n: number) => t(`kadry.wd.${n}` as MessageKey);
  if (d.length > 2 && d.every((n, i) => i === 0 || n === d[i - 1] + 1)) return `${name(d[0])}–${name(d[d.length - 1])}`;
  return d.map(name).join(", ");
}

/**
 * The «Рабочее место» form. Create mode also asks for the name block and the status;
 * edit mode (Task 7's «Трудовая книжка» page) starts from the whole card in `initial` and sends every field back,
 * because the API's PUT replaces all editable fields.
 */
// 12 Oct 2026: props were the block below, so an edit without employeeId fell through to createEmployee. Now a union: edit always carries employeeId and initial.
// export function WorkplaceForm({
//   mode,
//   structure,
//   locale,
//   today,
//   cancelHref,
//   initial,
//   employeeId,
//   doneHref,
// }: {
//   mode: "create" | "edit";
//   structure: KadryStructure;
//   locale: Locale;
//   today: string;
//   cancelHref: string;
//   /** Edit mode: the card as a form (`employeeFormFrom(card)`). */
//   initial?: EmployeeForm;
//   /** Edit mode: whose card this is. */
//   employeeId?: string;
//   /** Where to go after a successful save; create goes to the new card, edit defaults to `cancelHref`. */
//   doneHref?: string;
// }) {
type CommonProps = {
  structure: KadryStructure;
  locale: Locale;
  today: string;
  cancelHref: string;
  /** Where to go after a successful save; create goes to the new card, edit defaults to `cancelHref`. */
  doneHref?: string;
};
export type WorkplaceFormProps =
  | ({ mode: "create" } & CommonProps)
  | ({ mode: "edit"; employeeId: string; /** `employeeFormFrom(card)`. */ initial: EmployeeForm } & CommonProps);

export function WorkplaceForm(props: WorkplaceFormProps) {
  const { mode, structure, locale, today, cancelHref, doneHref } = props;
  const initial = props.mode === "edit" ? props.initial : undefined;
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
  const router = useRouter();
  const [form, setForm] = useState<EmployeeForm>(() => initial ?? emptyEmployeeForm(today));
  const [problems, setProblems] = useState<EmployeeProblems>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  const set = <K extends keyof EmployeeForm>(key: K, value: EmployeeForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setProblems((p) => (p[key] ? { ...p, [key]: undefined } : p));
  };
  const err = (key: keyof EmployeeProblems) => (problems[key] ? t(problems[key]) : undefined);
  const text = (key: keyof EmployeeForm, label: MessageKey, extra?: Partial<React.ComponentProps<typeof Field>>) => (
    <Field label={t(label)} value={form[key] as string} error={err(key)} onChange={(e) => set(key, e.target.value as never)} {...extra} />
  );

  const { departments, positions } = structure;
  const shownPositions = form.departmentId ? positions.filter((p) => p.departmentId === form.departmentId || p.departmentId === null) : positions;
  const position = positions.find((p) => p.id === form.positionId);
  // The chosen position stays selectable even if it belongs to another department now; repeated names carry their department.
  const positionChoices = positionOptions(positions, shownPositions, form.positionId);
  const pickDepartment = (id: string) => {
    setForm((f) => {
      const keep = positions.find((p) => p.id === f.positionId);
      const clash = id && keep?.departmentId && keep.departmentId !== id;
      return { ...f, departmentId: id, positionId: clash ? "" : f.positionId };
    });
  };
  const pickPosition = (id: string) => {
    const p = positions.find((x) => x.id === id);
    setForm((f) => ({ ...f, positionId: id, departmentId: !f.departmentId && p?.departmentId ? p.departmentId : f.departmentId }));
  };
  const byPosition =
    position && position.workdays.length > 0 && position.startTime
      ? t("kadry.schedule_by_position_at", { days: daysLabel(position.workdays, t), time: position.startTime })
      : t("kadry.schedule_by_position");

  const submit = () => {
    if (busy.current) return;
    const found = employeeProblems(form, today);
    setProblems(found);
    if (Object.keys(found).length > 0) {
      // A problem in a field this form does not show (edit mode keeps the card's other fields) still has to be told.
      const shown = new Set<string>(["rate", "salary", "hiredAt", "orderDate", "experienceMonths", "workSchedule", ...(mode === "create" ? ["lastName", "firstName", "pinfl", "inn"] : [])]);
      const hidden = (Object.keys(found) as (keyof EmployeeProblems)[]).find((k) => !shown.has(k));
      setMessage(hidden && found[hidden] ? t(found[hidden]) : null);
      setTimeout(() => document.querySelector('[aria-invalid="true"],[data-error]')?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
      return;
    }
    busy.current = true;
    // 12 Oct 2026: the guard was released in a `finally`, i.e. before the navigation finished, so a second click could create
    // a second employee. Now it is released on failure only; a success leaves it locked while the page changes.
    const fail = (r: { message?: string; code?: string }) => {
      busy.current = false;
      const key = serverErrorKey(r.code);
      // A duplicate PINFL goes under the PINFL field (shown in create mode); in edit mode that field is not on this form.
      if (key && r.code === "duplicate_pinfl" && mode === "create") setProblems((p) => ({ ...p, pinfl: key }));
      else setMessage(key ? t(key) : r.message || t("errors.unknown"));
    };
    start(async () => {
      try {
        setMessage(null);
        // 12 Oct 2026: if (mode === "edit" && employeeId) {
        if (props.mode === "edit") {
          const r = await updateEmployee(props.employeeId, form);
          if (r.ok) {
            router.push(doneHref ?? cancelHref);
            router.refresh();
          } else fail(r);
        } else {
          const r = await createEmployee(form);
          if (r.ok && r.id) router.push(`/kadry/sotrudniki/${encodeURIComponent(r.id)}`);
          else fail(r);
        }
      } catch (e) {
        busy.current = false;
        throw e;
      }
    });
  };

  return (
    <form
      noValidate
      className="flex max-w-3xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {mode === "create" && (
        <Card>
          <CardHeader><CardTitle>{t("kadry.section.fio")}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {text("lastName", "kadry.last_name", { autoComplete: "off" })}
            {text("firstName", "kadry.first_name", { autoComplete: "off" })}
            {text("middleName", "kadry.middle_name", { autoComplete: "off" })}
            {text("pinfl", "kadry.pinfl", { inputMode: "numeric", autoComplete: "off" })}
            {text("inn", "kadry.inn", { inputMode: "numeric", autoComplete: "off" })}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{t("kadry.section.workplace")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {mode === "create" && (
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.status")}</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v === "intern" ? "intern" : "active")}
                ariaLabel={t("kadry.status")}
                className="w-full"
                options={[{ value: "active", label: t("kadry.status.active") }, { value: "intern", label: t("kadry.status.intern") }]}
              />
            </div>
          )}
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.department")}</Label>
            <Select
              value={form.departmentId}
              onValueChange={pickDepartment}
              ariaLabel={t("kadry.department")}
              className="w-full"
              options={[{ value: "", label: t("kadry.no_department") }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.position")}</Label>
            <Select
              value={form.positionId}
              onValueChange={pickPosition}
              ariaLabel={t("kadry.position")}
              className="w-full"
              // 12 Oct 2026: options={[{ value: "", label: "—" }, ...shownPositions.map((p) => ({ value: p.id, label: p.name }))]}
              options={[{ value: "", label: "—" }, ...positionChoices]}
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.employment_type")}</Label>
            <Select
              value={form.employmentType}
              onValueChange={(v) => set("employmentType", v)}
              ariaLabel={t("kadry.employment_type")}
              className="w-full"
              options={[{ value: "", label: "—" }, ...EMPLOYMENT_TYPES.map((e) => ({ value: e, label: t(`kadry.et.${e}` as MessageKey) }))]}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <div className="flex items-center gap-2">
              <Checkbox id="kadry-remote" checked={form.remote} onCheckedChange={(on) => set("remote", on === true)} />
              <Label htmlFor="kadry-remote" className="cursor-pointer text-sm font-normal">{t("kadry.remote")}</Label>
            </div>
            <Text variant="caption" className="pl-6">{t("kadry.remote_hint")}</Text>
          </div>
          <div className="sm:col-span-2">
            <ScheduleEditor value={form.workSchedule} onChange={(s) => set("workSchedule", s)} byPosition={byPosition} error={err("workSchedule")} locale={locale} />
          </div>
          {text("rate", "kadry.rate", { inputMode: "decimal", autoComplete: "off" })}
          {text("salary", "kadry.salary", { inputMode: "numeric", autoComplete: "off" })}
          <DateField clearable label={t("kadry.hired_at")} value={form.hiredAt} onChange={(d) => set("hiredAt", d)} yearPicker={{ fromYear: 1990, toYear: new Date().getFullYear() + 1 }} error={err("hiredAt")} locale={locale} />
          {text("orderNumber", "kadry.order_number", { autoComplete: "off" })}
          <DateField clearable label={t("kadry.order_date")} value={form.orderDate} onChange={(d) => set("orderDate", d)} yearPicker={{ fromYear: 1990, toYear: new Date().getFullYear() + 1 }} error={err("orderDate")} locale={locale} />
          {text("experienceMonths", "kadry.experience", { inputMode: "numeric", autoComplete: "off" })}
        </CardContent>
      </Card>
      {message && <Text role="alert" variant="error">{message}</Text>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} className="active:scale-95">
          {pending && <Spinner />}
          {t("kadry.save")}
        </Button>
        <Link href={cancelHref} className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>{t("common.cancel")}</Link>
      </div>
    </form>
  );
}
