"use client";

// 17 Oct 2026: navigated in its own transition, which only spun the button; PendingNav now shows the page skeleton.
// import { useRouter, useSearchParams, usePathname } from "next/navigation";
// import { useState, useTransition } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/messages";
import { DateField } from "./date-field";
import { usePendingNav } from "./pending-nav";

export interface PeriodLabels {
  from: string;
  to: string;
  apply: string;
  invalid: string;
  order: string;
  beforeWindow: string;
}

/** Two dates, validated in place, written to ?from&to (page resets to 1). */
export function PeriodFilter({ from, to, min, locale, labels }: { from: string; to: string; min?: string; locale: Locale; labels: PeriodLabels }) {
  // const router = useRouter();
  const go = usePendingNav();
  const pathname = usePathname();
  const params = useSearchParams();
  const [values, setValues] = useState({ from, to });
  const [errors, setErrors] = useState<{ from?: string; to?: string }>({});
  // const [pending, start] = useTransition();

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.from) next.from = labels.invalid;
    if (!values.to) next.to = labels.invalid;
    if (!next.from && !next.to && values.from > values.to) next.from = labels.order;
    if (!next.from && min && values.from < min) next.from = labels.beforeWindow;
    setErrors(next);
    if (next.from || next.to) return;
    const q = new URLSearchParams(params);
    q.set("from", values.from);
    q.set("to", values.to);
    q.delete("page");
    // start(() => router.push(`${pathname}?${q}`));
    go(`${pathname}?${q}`);
  }

  return (
    <form onSubmit={apply} noValidate className="flex flex-wrap items-start gap-3">
      <DateField
        label={labels.from}
        value={values.from}
        min={min}
        error={errors.from}
        locale={locale}
        onChange={(day) => {
          setValues((v) => ({ ...v, from: day }));
          setErrors((er) => ({ ...er, from: undefined }));
        }}
      />
      <DateField
        label={labels.to}
        value={values.to}
        min={min}
        error={errors.to}
        locale={locale}
        onChange={(day) => {
          setValues((v) => ({ ...v, to: day }));
          setErrors((er) => ({ ...er, to: undefined }));
        }}
      />
      {/* <Button type="submit" disabled={pending} className="mt-5 active:scale-95">
        {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />} */}
      <Button type="submit" className="mt-5 active:scale-95">
        {labels.apply}
      </Button>
    </form>
  );
}
