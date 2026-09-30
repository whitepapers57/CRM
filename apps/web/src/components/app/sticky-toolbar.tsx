/** Keeps a page's header, period and filters pinned to the top while its table scrolls. */
export function StickyToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 border-b bg-background px-4 py-3">
      {children}
    </div>
  );
}
