"use client";

import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** «Создать ▾»: one link per operation this page can create. */
export function CreateMenu({ label, items }: { label: string; items: Array<{ href: string; label: string }> }) {
  return (
    <Popover>
      <PopoverTrigger className={cn(buttonVariants(), "active:scale-95")}>
        {label}
        <ChevronDownIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-0 p-1">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="rounded-md px-2.5 py-2 text-sm hover:bg-muted">
            {i.label}
          </Link>
        ))}
      </PopoverContent>
    </Popover>
  );
}
