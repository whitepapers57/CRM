"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useTransition, type ComponentProps, type ReactNode } from "react";
import { PageSkeleton } from "./page-skeleton";

const NavContext = createContext<((href: string) => void) | null>(null);

/**
 * Wraps the page content (root layout). A navigation that changes only search params (a filter, a
 * page number) keeps the old page on screen and no loading.tsx fires, so the page looks stuck;
 * navigations started through usePendingNav() show the skeleton here until the new page is in.
 */
export function PendingNav({ label, children }: { label: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = useCallback((href: string) => start(() => router.push(href)), [router]);
  return <NavContext.Provider value={go}>{pending ? <PageSkeleton label={label} /> : children}</NavContext.Provider>;
}

/** Navigate with the page skeleton showing while it loads (plain push outside PendingNav). */
export function usePendingNav(): (href: string) => void {
  const go = useContext(NavContext);
  const router = useRouter();
  return go ?? ((href) => router.push(href));
}

/** A Link to the same page with other search params; shows the skeleton while it loads. Ctrl/⌘-click still opens a tab. */
export function PendingLink({ href, onClick, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const go = usePendingNav();
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(href);
      }}
      {...rest}
    />
  );
}
