"use client";

import { useRef, useState, useTransition } from "react";
import { Field } from "@/components/app/field";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import { saveReason } from "../actions";

const Spinner = () => <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;

/** One dismissal reason: label (inline Input while renaming), «скрыта» badge, rename and hide/show. Saves are full replace, so every call sends sortOrder and active too. */
export function ReasonRow({ id, label, sortOrder, active, locale }: { id: string; label: string; sortOrder: number; active: boolean; locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [toggling, startToggle] = useTransition();
  const busy = useRef(false);

  const save = () => {
    if (busy.current) return;
    if (!draft.trim()) {
      setError(t("errors.required"));
      return;
    }
    busy.current = true;
    startSave(async () => {
      try {
        setError(null);
        const r = await saveReason(id, { label: draft.trim(), sortOrder, active });
        if (r.ok) setEditing(false);
        else setError(r.message || t("errors.unknown"));
      } finally {
        busy.current = false;
      }
    });
  };
  const toggle = () => {
    if (busy.current) return;
    busy.current = true;
    startToggle(async () => {
      try {
        setError(null);
        const r = await saveReason(id, { label, sortOrder, active: !active });
        if (!r.ok) setError(r.message || t("errors.unknown"));
      } finally {
        busy.current = false;
      }
    });
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(label);
    setError(null);
  };

  return (
    <li className="flex flex-col gap-1 border-b py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <Input
            value={draft}
            aria-label={t("kadry.name")}
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
          <span className={active ? "min-w-0 flex-1 basis-48" : "min-w-0 flex-1 basis-48 text-muted-foreground"}>{label}</span>
        )}
        {!active && !editing && <Badge variant="secondary">{t("kadry.hidden")}</Badge>}
        {editing ? (
          <>
            <Button onClick={save} disabled={saving} className="active:scale-95">
              {saving && <Spinner />}
              {t("kadry.save")}
            </Button>
            <Button variant="outline" onClick={cancelEdit} disabled={saving} className="active:scale-95">
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => setEditing(true)} className="active:scale-95">
              {t("kadry.edit")}
            </Button>
            <Button variant="outline" onClick={toggle} disabled={toggling} className="active:scale-95">
              {toggling && <Spinner />}
              {active ? t("kadry.hide") : t("kadry.show")}
            </Button>
          </>
        )}
      </div>
      {error && <Text role="alert" variant="error">{error}</Text>}
    </li>
  );
}

/** «Название» + «Добавить причину»; the new reason goes to the end of the list. */
export function AddReason({ nextSort, locale }: { nextSort: number; locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const clear = () => {
    setLabel("");
    setError(null);
  };
  const add = () => {
    if (busy.current) return;
    if (!label.trim()) {
      setError(t("errors.required"));
      return;
    }
    busy.current = true;
    start(async () => {
      try {
        setError(null);
        const r = await saveReason(null, { label: label.trim(), sortOrder: nextSort, active: true });
        if (r.ok) setLabel("");
        else setError(r.message || t("errors.unknown"));
      } finally {
        busy.current = false;
      }
    });
  };
  return (
    <div className="flex flex-wrap items-start gap-2 pt-3">
      <Field
        label={t("kadry.name")}
        value={label}
        error={error ?? undefined}
        className="min-w-0 flex-1 basis-48"
        onChange={(e) => {
          setLabel(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
          if (e.key === "Escape") clear();
        }}
      />
      <Button onClick={add} disabled={pending} className="mt-5 active:scale-95">
        {pending && <Spinner />}
        {t("kadry.add_reason")}
      </Button>
      {label && (
        <Button variant="outline" onClick={clear} disabled={pending} className="mt-5 active:scale-95">
          {t("common.cancel")}
        </Button>
      )}
    </div>
  );
}
