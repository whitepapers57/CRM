"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  /** Path prefix that makes this item active (defaults to href). */
  match?: string;
  children?: NavItem[];
}

export function Sidebar({ title, items, footer }: { title: string; items: NavItem[]; footer: React.ReactNode }) {
  const pathname = usePathname();
  // The login page stands alone.
  if (pathname === "/login") return null;
  const isActive = (i: NavItem) => {
    const m = i.match ?? i.href;
    return m === "/" ? pathname === "/" : pathname.startsWith(m);
  };
  const link = (i: NavItem, active: boolean, sub = false) => (
    <Link
      key={i.href + i.label}
      href={i.href}
      className={cn(
        "rounded-md px-3 py-2 text-sm transition active:scale-[0.98]",
        sub && "md:ml-3 md:py-1.5",
        active ? "bg-foreground text-background" : "hover:bg-muted",
      )}
    >
      {i.label}
    </Link>
  );
  return (
    <aside className="flex shrink-0 flex-col gap-4 border-b bg-muted/30 p-4 md:sticky md:top-0 md:h-screen md:w-56 md:overflow-y-auto md:border-r md:border-b-0">
      <span className="font-semibold">{title}</span>
      <nav className="flex flex-wrap gap-1 md:flex-col">
        {items.map((i) =>
          i.children ? (
            <div key={i.label} className="flex flex-wrap gap-1 md:flex-col">
              <Link
                href={i.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm transition active:scale-[0.98] hover:bg-muted",
                  isActive(i) && "font-semibold",
                )}
              >
                {i.label}
              </Link>
              {i.children.map((c) => link(c, isActive(c), true))}
            </div>
          ) : (
            link(i, isActive(i))
          ),
        )}
      </nav>
      <div className="md:mt-auto">{footer}</div>
    </aside>
  );
}
