"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Money } from "@/components/app/money-cell";
import { Text } from "@/components/app/text";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StockMoney, StockResponse } from "@/lib/api";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface StockLabels {
  name: string;
  article: string;
  code: string;
  quantity: string;
  actual: string;
  ordered: string;
  available: string;
  qty: string;
  sum: string;
  total: string;
  noCategory: string;
  empty: string;
  expandAll: string;
  collapseAll: string;
}

const Qty = ({ v }: { v: string }) => (
  <span className={cn("tabular-nums whitespace-nowrap", Number(v) < 0 && "text-destructive")}>{formatQty(v)}</span>
);

/** Money columns of one row: on hand, new orders, available — units and so'm. */
function MoneyCells({ m, strong }: { m: StockMoney; strong?: boolean }) {
  return (
    <>
      {[m.actual, m.ordered, m.available].map((v, i) => (
        <Fragment key={i}>
          <TableCell className={cn("text-right border-l", strong && "font-medium")}><Qty v={v.quantity} /></TableCell>
          <TableCell className={cn("text-right", strong && "font-medium")}>
            <Money value={v.sum} />
            {Number(v.unpriced) > 0 && <span className="ml-1 text-muted-foreground">*</span>}
          </TableCell>
        </Fragment>
      ))}
    </>
  );
}

function withoutEmpty(data: Pick<StockResponse, "groups" | "totals">) {
  const groups = data.groups
    .map((g) => ({ ...g, items: g.items.filter((it) => Number(it.actual.quantity) !== 0) }))
    .filter((g) => g.items.length > 0);
  return { ...data, groups };
}

/**
 * Склад like Salesdoc: one row per category («позиция») with its totals; a click opens its SKUs.
 * `finance` adds on hand / new orders / available to sell, in units and in so'm at receipt prices (FIFO).
 */
export function StockGroups({ data: all, finance, hideZero, labels: l }: { data: Pick<StockResponse, "groups" | "totals">; finance: boolean; hideZero: boolean; labels: StockLabels }) {
  // SKUs with none on hand come back only for their new orders; the units-only view leaves them out.
  const data = hideZero && !finance ? withoutEmpty(all) : all;
  const key = (g: StockResponse["groups"][number]) => g.categorySdId ?? "-";
  const [open, setOpen] = useState<Set<string>>(() => new Set(data.groups.length === 1 ? [key(data.groups[0])] : []));
  const toggle = (k: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const allOpen = data.groups.length > 0 && data.groups.every((g) => open.has(key(g)));
  const cols = finance ? 10 : 5;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          {finance && (
            <TableRow>
              <TableHead colSpan={4} />
              <TableHead colSpan={2} className="text-center border-l">{l.actual}</TableHead>
              <TableHead colSpan={2} className="text-center border-l">{l.ordered}</TableHead>
              <TableHead colSpan={2} className="text-center border-l">{l.available}</TableHead>
            </TableRow>
          )}
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>
              <span className="flex items-center gap-3">
                {l.name}
                {data.groups.length > 1 && (
                  <button
                    type="button"
                    className="text-xs font-normal text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => setOpen(allOpen ? new Set() : new Set(data.groups.map(key)))}
                  >
                    {allOpen ? l.collapseAll : l.expandAll}
                  </button>
                )}
              </span>
            </TableHead>
            <TableHead>{l.article}</TableHead>
            <TableHead>{l.code}</TableHead>
            {finance ? (
              [0, 1, 2].map((i) => (
                <Fragment key={i}>
                  <TableHead className="text-right border-l">{l.qty}</TableHead>
                  <TableHead className="text-right">{l.sum}</TableHead>
                </Fragment>
              ))
            ) : (
              <TableHead className="text-right">{l.quantity}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.groups.length === 0 && (
            <TableRow><TableCell colSpan={cols}><Text variant="caption">{l.empty}</Text></TableCell></TableRow>
          )}
          {data.groups.map((g, i) => {
            const k = key(g);
            const isOpen = open.has(k);
            return (
              <Fragment key={k}>
                <TableRow className="cursor-pointer bg-muted/40 hover:bg-muted" onClick={() => toggle(k)} aria-expanded={isOpen}>
                  <TableCell className="tabular-nums">{i + 1}</TableCell>
                  <TableCell className="min-w-56 font-medium">
                    <span className="flex items-center gap-1">
                      <ChevronRight className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-90")} aria-hidden />
                      {g.categoryName ?? l.noCategory}
                      <Text as="span" variant="caption" className="ml-1">· {g.items.length}</Text>
                    </span>
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  {finance ? <MoneyCells m={g} strong /> : <TableCell className="text-right font-medium"><Qty v={g.actual.quantity} /></TableCell>}
                </TableRow>
                {isOpen &&
                  g.items.map((it) => (
                    <TableRow key={it.productSdId}>
                      <TableCell />
                      <TableCell className="min-w-56 whitespace-normal pl-8">{it.productName}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{it.article ?? ""}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{it.code ?? ""}</TableCell>
                      {finance ? <MoneyCells m={it} /> : <TableCell className="text-right"><Qty v={it.actual.quantity} /></TableCell>}
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
        </TableBody>
        {data.groups.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell />
              <TableCell className="font-medium">{l.total}</TableCell>
              <TableCell />
              <TableCell />
              {finance ? <MoneyCells m={data.totals} strong /> : <TableCell className="text-right font-medium"><Qty v={data.totals.actual.quantity} /></TableCell>}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
