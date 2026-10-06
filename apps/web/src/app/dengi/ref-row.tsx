"use client";

import { useState, useTransition } from "react";
import { Field } from "@/components/app/field";
import { Select } from "@/components/app/select";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import { addRef, patchRef, setPaymentTypeAccount } from "./refs-actions";

type Kind = "categories" | "bank-accounts";
const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;

/** One статья / bank account: name (inline Input while renaming), «скрыта» badge, rename and hide buttons. */
export function RefRow({ kind, id, name, active, locale }: { kind: Kind; id: string; name: string; active: boolean; locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [toggling, startToggle] = useTransition();

  const save = () => {
    if (!draft.trim()) {
      setError(t("errors.required"));
      return;
    }
    startSave(async () => {
      setError(null);
      const r = await patchRef(kind, id, { name: draft.trim() });
      if (r.ok) setEditing(false);
      else setError(r.message || t("errors.unknown"));
    });
  };
  const toggle = () =>
    startToggle(async () => {
      setError(null);
      const r = await patchRef(kind, id, { active: !active });
      if (!r.ok) setError(r.message || t("errors.unknown"));
    });
  const cancelEdit = () => {
    setEditing(false);
    setDraft(name);
    setError(null);
  };

  return (
    <li className="flex flex-col gap-1 border-b py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <Input
            value={draft}
            aria-label={t("refs.name")}
            aria-invalid={error ? true : undefined}
            autoFocus
            className="min-w-0 flex-1 basis-48"
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancelEdit();
            }}
          />
        ) : (
          <span className={active ? "min-w-0 flex-1 basis-48" : "min-w-0 flex-1 basis-48 text-muted-foreground"}>{name}</span>
        )}
        {!active && !editing && <Badge variant="secondary">{t("refs.inactive")}</Badge>}
        {editing ? (
          <>
            <Button onClick={save} disabled={saving} className="active:scale-95">
              {saving && <Spinner />}
              {t("money.save")}
            </Button>
            <Button variant="outline" onClick={cancelEdit} disabled={saving} className="active:scale-95">
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => setEditing(true)} className="active:scale-95">
              {t("refs.rename")}
            </Button>
            <Button variant="outline" onClick={toggle} disabled={toggling} className="active:scale-95">
              {toggling && <Spinner />}
              {active ? t("refs.deactivate") : t("refs.activate")}
            </Button>
          </>
        )}
      </div>
      {error && <Text role="alert" variant="error">{error}</Text>}
    </li>
  );
}

/** «Название» + «Добавить»; `categoryKind` is sent only for статьи. */
export function AddRef({ kind, categoryKind, locale }: { kind: Kind; categoryKind?: "expense" | "income"; locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const add = () => {
    if (!name.trim()) {
      setError(t("errors.required"));
      return;
    }
    start(async () => {
      setError(null);
      const r = await addRef(kind, { name: name.trim(), ...(categoryKind ? { kind: categoryKind } : {}) });
      if (r.ok) setName("");
      else setError(r.message || t("errors.unknown"));
    });
  };
  return (
    <div className="flex flex-wrap items-start gap-2 pt-3">
      <Field
        label={t("refs.name")}
        value={name}
        error={error ?? undefined}
        className="min-w-0 flex-1 basis-48"
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
      />
      <Button onClick={add} disabled={pending} className="mt-5 active:scale-95">
        {pending && <Spinner />}
        {t("refs.add")}
      </Button>
    </div>
  );
}

/** «Попадают в» select for one Salesdoc payment type; saves on change. */
export function PaymentTypeSelect({ sdId, account, locale }: { sdId: string; account: "cash" | "bank"; locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [value, setValue] = useState<"cash" | "bank">(account);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const change = (v: string) => {
    const next = v === "bank" ? "bank" : "cash";
    const prev = value;
    setValue(next);
    start(async () => {
      setError(null);
      const r = await setPaymentTypeAccount(sdId, next);
      if (!r.ok) {
        setValue(prev);
        setError(r.message || t("errors.unknown"));
      }
    });
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Select
          value={value}
          onValueChange={change}
          ariaLabel={t("refs.goes_to")}
          options={[
            { value: "cash", label: t("refs.to_cash") },
            { value: "bank", label: t("refs.to_bank") },
          ]}
        />
        {pending && <Spinner />}
      </div>
      {error && <Text role="alert" variant="error">{error}</Text>}
    </div>
  );
}
