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
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import { EDUCATION_LEVELS, employeeProblems, GENDERS, type EmployeeForm, type EmployeeProblems } from "@/lib/kadry-rules";
import { cn } from "@/lib/utils";
import { updateEmployee } from "../../actions";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;

/**
 * «Личные данные». `initial` is the whole card as a form, because the API's PUT replaces every editable field:
 * the workplace fields ride along untouched and only the ones shown here change.
 */
export function PersonalForm({ employeeId, initial, locale, today, cancelHref }: { employeeId: string; initial: EmployeeForm; locale: Locale; today: string; cancelHref: string }) {
  const t = (key: MessageKey) => translate(locale, key);
  const router = useRouter();
  const [form, setForm] = useState<EmployeeForm>(initial);
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

  const submit = () => {
    if (busy.current) return;
    const found = employeeProblems(form, today);
    setProblems(found);
    if (Object.keys(found).length > 0) {
      // A problem in a field this form does not show (the card's workplace fields) is still told.
      const shown = new Set<string>(["lastName", "firstName", "birthDate", "email", "passportSeries", "passportNumber", "passportIssuedDate", "passportValidUntil", "pinfl", "inn"]);
      const hidden = (Object.keys(found) as (keyof EmployeeProblems)[]).find((k) => !shown.has(k));
      setMessage(hidden && found[hidden] ? t(found[hidden]) : null);
      setTimeout(() => document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
      return;
    }
    busy.current = true;
    start(async () => {
      try {
        setMessage(null);
        const r = await updateEmployee(employeeId, form);
        if (r.ok) {
          router.push(cancelHref);
          router.refresh();
        } else setMessage(r.message || t("errors.unknown"));
      } finally {
        busy.current = false;
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
      <Card>
        <CardHeader><CardTitle>{t("kadry.section.fio_short")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {text("lastName", "kadry.last_name", { autoComplete: "off" })}
          {text("firstName", "kadry.first_name", { autoComplete: "off" })}
          {text("middleName", "kadry.middle_name", { autoComplete: "off" })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("kadry.section.personal")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <DateField clearable label={t("kadry.birth_date")} value={form.birthDate} onChange={(d) => set("birthDate", d)} error={err("birthDate")} locale={locale} />
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.gender")}</Label>
            <Select
              value={form.gender}
              onValueChange={(v) => set("gender", v)}
              ariaLabel={t("kadry.gender")}
              className="w-full"
              options={[{ value: "", label: "—" }, ...GENDERS.map((g) => ({ value: g, label: t(`kadry.g.${g}` as MessageKey) }))]}
            />
          </div>
          {text("citizenship", "kadry.citizenship", { placeholder: t("kadry.citizenship_placeholder"), autoComplete: "off" })}
          {text("nationality", "kadry.nationality", { autoComplete: "off" })}
          {text("birthPlace", "kadry.birth_place", { autoComplete: "off" })}
          {text("address", "kadry.address", { autoComplete: "off" })}
          {text("phone", "kadry.phone", { inputMode: "tel", autoComplete: "off" })}
          {text("email", "kadry.email", { type: "email", autoComplete: "off" })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("kadry.section.passport")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("kadry.passport_series")}
            value={form.passportSeries}
            error={err("passportSeries")}
            maxLength={2}
            autoComplete="off"
            onChange={(e) => set("passportSeries", e.target.value.toUpperCase())}
          />
          <Field
            label={t("kadry.passport_number")}
            value={form.passportNumber}
            error={err("passportNumber")}
            maxLength={7}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => set("passportNumber", e.target.value.replace(/\D/g, ""))}
          />
          <div className="sm:col-span-2">{text("passportIssuedBy", "kadry.passport_issued_by", { autoComplete: "off" })}</div>
          <DateField clearable label={t("kadry.passport_issued_date")} value={form.passportIssuedDate} onChange={(d) => set("passportIssuedDate", d)} error={err("passportIssuedDate")} locale={locale} />
          <DateField clearable label={t("kadry.passport_valid_until")} value={form.passportValidUntil} onChange={(d) => set("passportValidUntil", d)} error={err("passportValidUntil")} locale={locale} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("kadry.section.documents")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {text("pinfl", "kadry.pinfl", { inputMode: "numeric", autoComplete: "off" })}
          {text("inn", "kadry.inn", { inputMode: "numeric", autoComplete: "off" })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("kadry.section.education")}</CardTitle></CardHeader>
        <CardContent>
          <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.education_level")}</Label>
          <Select
            value={form.educationLevel}
            onValueChange={(v) => set("educationLevel", v)}
            ariaLabel={t("kadry.education_level")}
            className="w-full sm:w-72"
            options={[{ value: "", label: "—" }, ...EDUCATION_LEVELS.map((l) => ({ value: l, label: t(`kadry.edu.${l}` as MessageKey) }))]}
          />
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
