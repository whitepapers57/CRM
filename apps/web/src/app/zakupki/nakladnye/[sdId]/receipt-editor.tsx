"use client";

import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DateField } from "@/components/app/date-field";
import { Money } from "@/components/app/money-cell";
import { ProductPicker } from "@/components/app/product-picker";
import { Select } from "@/components/app/select";
import { Text } from "@/components/app/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import type { FormOptions } from "@/lib/api";
import { saveReceipt } from "../actions";

const DATA_START = "2026-09-01";

type Line = { key: number; productSdId: string; quantity: string; price: string };
type LineErrors = { product?: string; quantity?: string; price?: string };

export interface ReceiptInitial {
  date: string;
  warehouseSdId: string;
  supplierSdId: string;
  /** `amount` is Salesdoc's line amount: with the quantity it gives the exact unit price. */
  lines: Array<{ productSdId: string; quantity: string; price: string; amount: string }>;
}

const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")));
/** Salesdoc's unit prices go past 2 decimals; while the shown price is unchanged, use the exact one (the API does too). */
type Exact = Map<string, number>;
const exactKey = (productSdId: string, price: number) => `${productSdId}|${price.toFixed(2)}`;
const amount = (l: Line, exact: Exact) => {
  const q = num(l.quantity), p = num(l.price);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return Math.round(q * (exact.get(exactKey(l.productSdId, p)) ?? p) * 100) / 100;
};

/** The edit form of one приходная накладная; saving sends it to Salesdoc through the API. */
export function ReceiptEditor({
  sdId,
  initial,
  options,
  locale,
}: {
  sdId: string;
  initial: ReceiptInitial;
  options: FormOptions;
  locale: Locale;
}) {
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
  const router = useRouter();
  const [date, setDate] = useState(initial.date);
  const [warehouse, setWarehouse] = useState(initial.warehouseSdId);
  const [supplier, setSupplier] = useState(initial.supplierSdId);
  const [exact] = useState<Exact>(
    () => new Map(initial.lines.filter((l) => Number(l.quantity) > 0).map((l) => [exactKey(l.productSdId, Number(l.price)), Number(l.amount) / Number(l.quantity)])),
  );
  const [lines, setLines] = useState<Line[]>(initial.lines.map(({ productSdId, quantity, price }, i) => ({ key: i, productSdId, quantity, price })));
  const [nextKey, setNextKey] = useState(initial.lines.length);
  const [errors, setErrors] = useState<{ date?: string; warehouse?: string; lines?: string; byLine: Record<number, LineErrors> }>({ byLine: {} });
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + amount(l, exact), 0);

  const validate = () => {
    const e: typeof errors = { byLine: {} };
    if (!date) e.date = t("errors.required");
    if (!warehouse) e.warehouse = t("errors.required");
    if (lines.length === 0) e.lines = t("errors.required");
    for (const l of lines) {
      const le: LineErrors = {};
      if (!l.productSdId) le.product = t("errors.required");
      const q = num(l.quantity), p = num(l.price);
      if (l.quantity.trim() === "") le.quantity = t("errors.required");
      else if (!(q > 0)) le.quantity = t("errors.positive");
      if (l.price.trim() === "") le.price = t("errors.required");
      else if (!(p >= 0)) le.price = t("errors.not_negative");
      if (Object.keys(le).length) e.byLine[l.key] = le;
    }
    setErrors(e);
    return !e.date && !e.warehouse && !e.lines && Object.keys(e.byLine).length === 0;
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    if (!validate()) return;
    start(async () => {
      const r = await saveReceipt(sdId, {
        date,
        warehouseSdId: warehouse,
        supplierSdId: supplier || null,
        lines: lines.map((l) => ({ productSdId: l.productSdId, quantity: num(l.quantity), price: num(l.price) })),
      });
      if (r.ok) router.push(`/zakupki/nakladnye/${encodeURIComponent(sdId)}`);
      else setServerError(r.message || t("errors.unknown"));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">{t("warehouse.warehouse")}</Label>
          <Select
            value={warehouse}
            onValueChange={setWarehouse}
            invalid={!!errors.warehouse}
            ariaLabel={t("warehouse.warehouse")}
            options={options.warehouses.map((w) => ({ value: w.sdId, label: w.name }))}
          />
          {errors.warehouse && <Text role="alert" variant="error" className="mt-1">{errors.warehouse}</Text>}
        </div>
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">{t("zakupki.supplier")}</Label>
          <Select
            value={supplier}
            onValueChange={setSupplier}
            ariaLabel={t("zakupki.supplier")}
            options={[
              // A supplier cannot be cleared (Salesdoc may keep it); «—» only for receipts that have none.
              ...(initial.supplierSdId ? [] : [{ value: "", label: "—" }]),
              ...options.suppliers.map((s) => ({ value: s.sdId, label: s.name })),
            ]}
          />
        </div>
        <DateField label={t("zakupki.date")} value={date} onChange={setDate} min={DATA_START} error={errors.date} locale={locale} />
      </div>

      {/* Lines: columns from sm up; on phones each line is a card (product, then quantity · price · amount). */}
      <div className="rounded-lg border text-sm">
        <div className="hidden grid-cols-[2rem_minmax(14rem,1fr)_7rem_9rem_9rem_2.5rem] gap-3 border-b px-3 py-2 font-medium sm:grid">
          <span>N</span>
          <span>{t("nav.nomenclature")}</span>
          <span className="text-right">{t("warehouse.quantity")}</span>
          <span className="text-right">{t("warehouse.price")}</span>
          <span className="text-right">{t("statement.amount")}</span>
          <span />
        </div>
        {lines.map((l, i) => {
          const le = errors.byLine[l.key] ?? {};
          return (
            <div
              key={l.key}
              className="grid grid-cols-[2rem_1fr_1fr_2.5rem] items-start gap-x-3 gap-y-2 border-b px-3 py-3 sm:grid-cols-[2rem_minmax(14rem,1fr)_7rem_9rem_9rem_2.5rem]"
            >
              <span className="pt-2 tabular-nums">{i + 1}</span>
              <div className="col-span-2 sm:col-span-1">
                <ProductPicker
                  value={l.productSdId}
                  onChange={(v) => setLine(l.key, { productSdId: v })}
                  products={options.products}
                  label={`${t("warehouse.product")} ${i + 1}`}
                  placeholder={t("receipt.choose_product")}
                  searchLabel={t("receipt.search_product")}
                  invalid={!!le.product}
                />
                {le.product && <Text role="alert" variant="error" className="mt-1">{le.product}</Text>}
              </div>
              <div className="col-start-2 row-start-2 sm:col-start-auto sm:row-start-auto">
                <Input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                  aria-label={`${t("warehouse.quantity")} ${i + 1}`}
                  placeholder={t("warehouse.quantity")}
                  aria-invalid={le.quantity ? true : undefined}
                  className="h-9 text-right tabular-nums"
                />
                {le.quantity && <Text role="alert" variant="error" className="mt-1">{le.quantity}</Text>}
              </div>
              <div className="col-start-3 row-start-2 sm:col-start-auto sm:row-start-auto">
                <Input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={l.price}
                  onChange={(e) => setLine(l.key, { price: e.target.value })}
                  aria-label={`${t("warehouse.price")} ${i + 1}`}
                  placeholder={t("warehouse.price")}
                  aria-invalid={le.price ? true : undefined}
                  className="h-9 text-right tabular-nums"
                />
                {le.price && <Text role="alert" variant="error" className="mt-1">{le.price}</Text>}
              </div>
              <div className="col-span-2 col-start-2 row-start-3 pt-0 text-right sm:col-span-1 sm:col-start-auto sm:row-start-auto sm:pt-2">
                <Money value={String(amount(l, exact))} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("receipt.remove_line")}
                title={t("receipt.remove_line")}
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                className="col-start-4 row-start-1 active:scale-90 sm:col-start-auto sm:row-start-auto"
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          );
        })}
        <div data-total className="flex justify-between gap-3 bg-muted/40 px-3 py-2 font-medium">
          <span>{t("warehouse.total")}</span>
          <Money value={String(total)} />
        </div>
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          className="active:scale-95"
          onClick={() => {
            setLines((ls) => [...ls, { key: nextKey, productSdId: "", quantity: "", price: "" }]);
            setNextKey((k) => k + 1);
          }}
        >
          {t("receipt.add_line")}
        </Button>
        {errors.lines && <Text role="alert" variant="error" className="mt-1">{errors.lines}</Text>}
      </div>

      {serverError && <Text role="alert" variant="error">{serverError}</Text>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="active:scale-95">
          {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          {t("receipt.save")}
        </Button>
        <Text variant="caption">{t("receipt.salesdoc_note")}</Text>
      </div>
    </form>
  );
}
