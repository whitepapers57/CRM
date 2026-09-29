"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "./field";

export interface PeriodLabels {
  from: string;
  to: string;
  apply: string;
  invalid: string;
  order: string;
}

/** Two dates, validated in place, written to ?from&to (page resets to 1). */
export function PeriodFilter({ from, to, labels }: { from: string; to: string; labels: PeriodLabels }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [values, setValues] = useState({ from, to });
  const [errors, setErrors] = useState<{ from?: string; to?: string }>({});
  const [pending, start] = useTransition();

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.from) next.from = labels.invalid;
    if (!values.to) next.to = labels.invalid;
    if (!next.from && !next.to && values.from > values.to) next.from = labels.order;
    setErrors(next);
    if (next.from || next.to) return;
    const q = new URLSearchParams(params);
    q.set("from", values.from);
    q.set("to", values.to);
    q.delete("page");
    start(() => router.push(`${pathname}?${q}`));
  }

  return (
    <form onSubmit={apply} className="flex flex-wrap items-start gap-3">
      <Field
        type="date"
        label={labels.from}
        value={values.from}
        error={errors.from}
        onChange={(e) => {
          setValues((v) => ({ ...v, from: e.target.value }));
          setErrors((er) => ({ ...er, from: undefined }));
        }}
      />
      <Field
        type="date"
        label={labels.to}
        value={values.to}
        error={errors.to}
        onChange={(e) => {
          setValues((v) => ({ ...v, to: e.target.value }));
          setErrors((er) => ({ ...er, to: undefined }));
        }}
      />
      <Button type="submit" disabled={pending} className="mt-5 active:scale-95">
        {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {labels.apply}
      </Button>
    </form>
  );
}
