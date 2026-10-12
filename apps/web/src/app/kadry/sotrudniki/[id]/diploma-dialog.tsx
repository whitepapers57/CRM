"use client";

import { useRef, useState, useTransition } from "react";
import { DateField } from "@/components/app/date-field";
import { Field } from "@/components/app/field";
import { Select } from "@/components/app/select";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import type { KadryEmployee } from "@/lib/api";
import { DEGREES, DIPLOMA_STATUSES } from "@/lib/kadry-rules";
import { cn } from "@/lib/utils";
import { deleteDiploma, saveDiploma } from "../../actions";
import { ConfirmDelete } from "./confirm-delete";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
type Diploma = KadryEmployee["diplomas"][number];

/** A year is empty or four digits between 1900 and 2100 (the API refuses anything else). */
const yearProblem = (v: string) => {
  const s = v.trim();
  if (!s) return false;
  return !/^\d{4}$/.test(s) || Number(s) < 1900 || Number(s) > 2100;
};

/** Add (diploma = null) or edit a diploma. The save is full replace: every field is always sent. */
export function DiplomaDialog({ employeeId, diploma, locale }: { employeeId: string; diploma: Diploma | null; locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [open, setOpen] = useState(false);
  const [degree, setDegree] = useState("");
  const [institution, setInstitution] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [enrolled, setEnrolled] = useState("");
  const [graduated, setGraduated] = useState("");
  const [series, setSeries] = useState("");
  const [issued, setIssued] = useState("");
  const [status, setStatus] = useState("");
  const [yearErrors, setYearErrors] = useState<{ enrolled?: string; graduated?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  const reset = () => {
    setDegree(diploma?.degree ?? "");
    setInstitution(diploma?.institution ?? "");
    setSpecialty(diploma?.specialty ?? "");
    setEnrolled(diploma?.enrolledYear == null ? "" : String(diploma.enrolledYear));
    setGraduated(diploma?.graduatedYear == null ? "" : String(diploma.graduatedYear));
    setSeries(diploma?.seriesNumber ?? "");
    setIssued(diploma?.issuedDate ?? "");
    setStatus(diploma?.status ?? "");
    setYearErrors({});
    setError(null);
  };
  const submit = () => {
    if (busy.current) return;
    const found = {
      enrolled: yearProblem(enrolled) ? t("kadry.err.year") : undefined,
      graduated: yearProblem(graduated) ? t("kadry.err.year") : undefined,
    };
    setYearErrors(found);
    if (found.enrolled || found.graduated) return;
    busy.current = true;
    start(async () => {
      try {
        setError(null);
        const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
        const r = await saveDiploma(employeeId, diploma?.id ?? null, {
          degree: degree || null,
          institution: orNull(institution),
          specialty: orNull(specialty),
          enrolledYear: enrolled.trim() ? Number(enrolled) : null,
          graduatedYear: graduated.trim() ? Number(graduated) : null,
          seriesNumber: orNull(series),
          issuedDate: issued || null,
          status: status || null,
        });
        if (r.ok) setOpen(false);
        else setError(r.message || t("errors.unknown"));
      } finally {
        busy.current = false;
      }
    });
  };
  const pick = (label: string, value: string, set: (v: string) => void, list: readonly string[]) => (
    <div>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={set} ariaLabel={label} className="w-full" options={[{ value: "", label: "—" }, ...list.map((d) => ({ value: d, label: d }))]} />
    </div>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger className={cn(buttonVariants({ variant: diploma ? "outline" : "default", size: diploma ? "sm" : "default" }), "active:scale-95")}>
        {diploma ? t("kadry.edit") : t("kadry.add_diploma")}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{diploma ? t("kadry.edit_diploma") : t("kadry.add_diploma")}</DialogTitle>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {pick(t("kadry.degree"), degree, setDegree, DEGREES)}
          <Field label={t("kadry.institution")} value={institution} autoComplete="off" onChange={(e) => setInstitution(e.target.value)} />
          <Field label={t("kadry.specialty")} value={specialty} autoComplete="off" onChange={(e) => setSpecialty(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("kadry.enrolled_year")}
              value={enrolled}
              inputMode="numeric"
              autoComplete="off"
              error={yearErrors.enrolled}
              onChange={(e) => {
                setEnrolled(e.target.value);
                setYearErrors((y) => ({ ...y, enrolled: undefined }));
              }}
            />
            <Field
              label={t("kadry.graduated_year")}
              value={graduated}
              inputMode="numeric"
              autoComplete="off"
              error={yearErrors.graduated}
              onChange={(e) => {
                setGraduated(e.target.value);
                setYearErrors((y) => ({ ...y, graduated: undefined }));
              }}
            />
          </div>
          <Field label={t("kadry.series_number")} value={series} autoComplete="off" onChange={(e) => setSeries(e.target.value)} />
          <DateField label={t("kadry.issued_date")} value={issued} onChange={setIssued} locale={locale} />
          {pick(t("kadry.diploma_status"), status, setStatus, DIPLOMA_STATUSES)}
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

export function DeleteDiploma({ employeeId, diploma, locale }: { employeeId: string; diploma: Diploma; locale: Locale }) {
  const name = diploma.institution || diploma.degree || translate(locale, "kadry.edit_diploma");
  return <ConfirmDelete name={name} locale={locale} onDelete={() => deleteDiploma(employeeId, diploma.id)} />;
}
