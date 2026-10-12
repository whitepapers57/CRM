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
import { RELATIONS } from "@/lib/kadry-rules";
import { cn } from "@/lib/utils";
import { deleteRelative, saveRelative } from "../../actions";
import { ConfirmDelete } from "./confirm-delete";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
type Relative = KadryEmployee["relatives"][number];

/** Add (relative = null) or edit a relative. The save is full replace: every field is always sent. */
export function RelativeDialog({ employeeId, relative, locale }: { employeeId: string; relative: Relative | null; locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [open, setOpen] = useState(false);
  const [relation, setRelation] = useState("");
  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [workplace, setWorkplace] = useState("");
  const [residence, setResidence] = useState("");
  const [phone, setPhone] = useState("");
  const [relationError, setRelationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  const reset = () => {
    setRelation(relative?.relation ?? "");
    setFullName(relative?.fullName ?? "");
    setBirthDate(relative?.birthDate ?? "");
    setWorkplace(relative?.workplacePosition ?? "");
    setResidence(relative?.residenceAddress ?? "");
    setPhone(relative?.phone ?? "");
    setRelationError(null);
    setError(null);
  };
  const submit = () => {
    if (busy.current) return;
    if (!relation) {
      setRelationError(t("kadry.err.relation"));
      return;
    }
    busy.current = true;
    start(async () => {
      try {
        setError(null);
        const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
        const r = await saveRelative(employeeId, relative?.id ?? null, {
          relation,
          fullName: orNull(fullName),
          birthDate: birthDate || null,
          workplacePosition: orNull(workplace),
          residenceAddress: orNull(residence),
          phone: orNull(phone),
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
      <DialogTrigger className={cn(buttonVariants({ variant: relative ? "outline" : "default", size: relative ? "sm" : "default" }), "active:scale-95")}>
        {relative ? t("kadry.edit") : t("kadry.add_relative")}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{relative ? t("kadry.edit_relative") : t("kadry.add_relative")}</DialogTitle>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("kadry.relation")}</Label>
            <Select
              value={relation}
              onValueChange={(v) => {
                setRelation(v);
                setRelationError(null);
              }}
              invalid={!!relationError}
              ariaLabel={t("kadry.relation")}
              className="w-full"
              options={[{ value: "", label: t("kadry.pick_relation") }, ...RELATIONS.map((r) => ({ value: r, label: t(`kadry.rel.${r}` as MessageKey) }))]}
            />
            {relationError && <Text role="alert" variant="error" className="mt-1">{relationError}</Text>}
          </div>
          <Field label={t("kadry.full_name")} value={fullName} autoComplete="off" onChange={(e) => setFullName(e.target.value)} />
          <DateField clearable label={t("kadry.birth_date")} value={birthDate} onChange={setBirthDate} yearPicker={{ fromYear: 1920, toYear: new Date().getFullYear() }} locale={locale} />
          <Field label={t("kadry.workplace_position")} value={workplace} autoComplete="off" onChange={(e) => setWorkplace(e.target.value)} />
          <Field label={t("kadry.residence")} value={residence} autoComplete="off" onChange={(e) => setResidence(e.target.value)} />
          <Field label={t("kadry.phone")} value={phone} inputMode="tel" autoComplete="off" onChange={(e) => setPhone(e.target.value)} />
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

export function DeleteRelative({ employeeId, relative, locale }: { employeeId: string; relative: Relative; locale: Locale }) {
  const name = relative.fullName || translate(locale, `kadry.rel.${relative.relation}` as MessageKey);
  return <ConfirmDelete name={name} locale={locale} onDelete={() => deleteRelative(employeeId, relative.id)} />;
}
