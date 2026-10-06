"use client";

import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const LIMIT = 50;

/** A searchable product dropdown over Номенклатура; shows up to 50 substring matches. */
export function ProductPicker({
  value,
  onChange,
  products,
  label,
  placeholder,
  searchLabel,
  invalid,
  emptyLabel,
}: {
  value: string;
  onChange: (sdId: string) => void;
  products: Array<{ sdId: string; name: string }>;
  label: string;
  placeholder: string;
  searchLabel: string;
  invalid?: boolean;
  /** Shown in the list when nothing matches the search. */
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const chosen = products.find((p) => p.sdId === value);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products).slice(0, LIMIT);
  }, [products, query]);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setQuery("");
      }}
    >
      <PopoverTrigger
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        className={cn(
          "flex h-9 w-full min-w-56 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition active:scale-[0.98]",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive",
        )}
      >
        <span className={cn("truncate", !chosen && "text-muted-foreground")}>{chosen?.name ?? (value || placeholder)}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 max-w-[calc(100vw-2rem)] gap-2 p-2">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchLabel} aria-label={searchLabel} />
        <div role="listbox" aria-label={label} className="flex max-h-72 flex-col overflow-y-auto">
          {matches.map((p) => (
            <button
              key={p.sdId}
              type="button"
              role="option"
              aria-selected={p.sdId === value}
              onClick={() => {
                onChange(p.sdId);
                setOpen(false);
              }}
              className={cn(
                "rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted active:scale-[0.99]",
                p.sdId === value && "bg-muted font-medium",
              )}
            >
              {p.name}
            </button>
          ))}
          {matches.length === 0 && emptyLabel && <span className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</span>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
