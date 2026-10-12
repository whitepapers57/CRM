"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DateField } from "@/components/app/date-field";
import { Field } from "@/components/app/field";
import { ProductPicker } from "@/components/app/product-picker";
import { Select } from "@/components/app/select";
import { Text } from "@/components/app/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import type { CashFormOptions, CashPage } from "@/lib/api";
import { DEPOSIT, cleanAmount, needsOf, parseAmountInput } from "@/lib/cash-ops";
import { dateProblem, decimals } from "@/lib/receipt-rules";
import { cn } from "@/lib/utils";
import { saveCash } from "./actions";

const DATA_START = "2026-09-01";

export interface CashInitial {
  date: string;
  amount: string;
  cashboxSdId: string;
  bankAccountId: string;
  supplierSdId: string;
  outletSdId: string;
  categoryId: string;
  counterpartyName: string;
  comment: string;
}
type Errors = Partial<Record<"date" | "box" | "deposit" | "need" | "amount", string>>;

/** One form for every cash operation: the fields it shows follow the operation (spec §4). */
export function CashForm({
  page,
  operation,
  id,
  initial,
  options,
  closedMonths,
  today,
  locale,
  cancelHref,
}: {
  page: CashPage;
  operation: string;
  id?: string;
  initial?: Partial<CashInitial>;
  options: CashFormOptions;
  /** "YYYY-MM" of closed months: still pickable (to look), but not savable. */
  closedMonths: string[];
  today: string;
  locale: Locale;
  /** Where «Отмена» leads without saving. */
  cancelHref: string;
}) {
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
  const router = useRouter();
  const account = page.startsWith("cash") ? "cash" : "bank";
  const needs = needsOf(operation);
  const deposit = operation === DEPOSIT;

  const [date, setDate] = useState(initial?.date ?? today);
  const [cashbox, setCashbox] = useState(initial?.cashboxSdId ?? "");
  // The bank account: the account itself on bank pages, the account money is deposited to for a cash deposit.
  const [bank, setBank] = useState(initial?.bankAccountId ?? "");
  const [supplier, setSupplier] = useState(initial?.supplierSdId ?? "");
  const [outlet, setOutlet] = useState(initial?.outletSdId ?? "");
  const [category, setCategory] = useState(initial?.categoryId ?? "");
  const [name, setName] = useState(initial?.counterpartyName ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const closed = new Set(closedMonths);
  const dateError = (day: string) => {
    const why = dateProblem(day, closed, today);
    if (why === "before") return t("errors.before_window", { date: "01.09.2026" });
    if (why === "future") return t("errors.future");
    if (why === "closed") return t("errors.month_closed");
    return undefined;
  };
  const changeDate = (day: string) => {
    setDate(day);
    setErrors((e) => ({ ...e, date: dateError(day) }));
  };

  const pick = (list: Array<{ id: string; name: string }>) => [
    { value: "", label: t("money.choose") },
    ...list.map((x) => ({ value: x.id, label: x.name })),
  ];
  const needValue = { supplier, outlet, expenseCategory: category, incomeCategory: category, name: name.trim(), none: "x" }[needs];

  const validate = () => {
    const e: Errors = {};
    e.date = date ? dateError(date) : t("errors.required");
    if (account === "cash" ? !cashbox : !bank) e.box = t("errors.required");
    if (deposit && !bank) e.deposit = t("errors.required");
    if (!needValue) e.need = t("errors.required");
    const n = parseAmountInput(amount);
    if (amount.trim() === "") e.amount = t("errors.required");
    else if (n === null || !(n > 0)) e.amount = t("errors.positive");
    else if (decimals(cleanAmount(amount)) > 2) e.amount = t("errors.max_decimals", { n: "2" });
    setErrors(e);
    return Object.values(e).every((v) => !v);
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    if (!validate()) return;
    start(async () => {
      const r = await saveCash(id ?? null, {
        operation,
        account,
        date,
        amount: parseAmountInput(amount) ?? 0,
        cashboxSdId: account === "cash" ? cashbox : null,
        bankAccountId: account === "bank" ? bank : null,
        targetBankAccountId: deposit ? bank : null,
        supplierSdId: needs === "supplier" ? supplier : null,
        outletSdId: needs === "outlet" ? outlet : null,
        categoryId: needs === "expenseCategory" || needs === "incomeCategory" ? category : null,
        counterpartyName: needs === "name" ? name.trim() : null,
        comment: comment.trim() || null,
      });
      if (r.ok) router.push(`/dengi/op/${encodeURIComponent(id ?? r.id ?? "")}`);
      else setServerError(r.message || t("errors.unknown"));
    });
  };

  const needLabel = { supplier: t("money.supplier"), outlet: t("money.buyer"), expenseCategory: t("money.category"), incomeCategory: t("money.category"), name: t("money.party_name"), none: "" }[needs];
  const boxLabel = account === "cash" ? t("money.cashbox") : t("money.bank_account");
  const err = (m?: string) => m && <Text role="alert" variant="error" className="mt-1">{m}</Text>;
  const labelFor = (text: string) => <Label className="mb-1 block text-xs text-muted-foreground">{text}</Label>;

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
      <DateField label={t("money.date")} value={date} onChange={changeDate} min={DATA_START} error={errors.date} locale={locale} />

      <div>
        {labelFor(boxLabel)}
        {account === "cash" ? (
          <Select value={cashbox} onValueChange={setCashbox} invalid={!!errors.box} ariaLabel={boxLabel} className="w-full" options={pick(options.cashboxes)} />
        ) : (
          <Select value={bank} onValueChange={setBank} invalid={!!errors.box} ariaLabel={boxLabel} className="w-full" options={pick(options.bankAccounts)} />
        )}
        {err(errors.box)}
      </div>

      {deposit && (
        <div>
          {labelFor(t("money.bank_for_deposit"))}
          <Select value={bank} onValueChange={setBank} invalid={!!errors.deposit} ariaLabel={t("money.bank_for_deposit")} className="w-full" options={pick(options.bankAccounts)} />
          {err(errors.deposit)}
        </div>
      )}

      {needs === "supplier" && (
        <div>
          {labelFor(needLabel)}
          <Select value={supplier} onValueChange={setSupplier} invalid={!!errors.need} ariaLabel={needLabel} className="w-full" options={pick(options.suppliers)} />
          {err(errors.need)}
        </div>
      )}
      {needs === "outlet" && (
        <div>
          {labelFor(needLabel)}
          <ProductPicker
            value={outlet}
            onChange={setOutlet}
            products={options.outlets.map((o) => ({ sdId: o.id, name: o.name }))}
            label={needLabel}
            placeholder={t("money.choose")}
            searchLabel={t("common.search")}
            emptyLabel={t("money.nothing_found")}
            invalid={!!errors.need}
          />
          {err(errors.need)}
        </div>
      )}
      {(needs === "expenseCategory" || needs === "incomeCategory") && (
        <div>
          {labelFor(needLabel)}
          <Select
            value={category}
            onValueChange={setCategory}
            invalid={!!errors.need}
            ariaLabel={needLabel}
            className="w-full"
            options={pick(needs === "expenseCategory" ? options.expenseCategories : options.incomeCategories)}
          />
          {err(errors.need)}
        </div>
      )}
      {needs === "name" && <Field label={needLabel} value={name} onChange={(e) => setName(e.target.value)} error={errors.need} />}

      <Field label={t("money.amount")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} />
      <Field label={t("money.comment")} value={comment} onChange={(e) => setComment(e.target.value)} />

      {serverError && <Text role="alert" variant="error">{serverError}</Text>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="active:scale-95">
          {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          {t("money.save")}
        </Button>
        <Link
          href={cancelHref}
          aria-disabled={pending || undefined}
          className={cn(buttonVariants({ variant: "outline" }), "active:scale-95", pending && "pointer-events-none opacity-50")}
        >
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
