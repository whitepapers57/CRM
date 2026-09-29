"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

export function Sidebar({ title, items, footer }: { title: string; items: NavItem[]; footer: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <aside className="flex shrink-0 flex-col gap-4 border-b bg-muted/30 p-4 md:min-h-screen md:w-56 md:border-r md:border-b-0">
      <span className="font-semibold">{title}</span>
      <nav className="flex flex-wrap gap-1 md:flex-col">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition active:scale-[0.98]",
              isActive(i.href) ? "bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {i.label}
          </Link>
        ))}
      </nav>
      <div className="md:mt-auto">{footer}</div>
    </aside>
  );
}
