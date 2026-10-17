import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

function Bone({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("skeleton-sweep rounded-md bg-foreground/8", className)} style={style} />;
}

/** Widths (%) of the middle column, so the rows do not look stamped. */
const ROWS = [72, 56, 64, 48, 60, 52, 68, 44];

/**
 * What a page looks like while it loads: title, filters and table rows, shimmering.
 * Shown by every `loading.tsx` (see page-loading.tsx) and by PendingNav while a filter reloads the page.
 */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Bone className="h-8 w-48 sm:w-64" />
        <Bone className="ml-auto h-9 w-24 sm:w-32" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Bone className="h-9 w-36" />
        <Bone className="h-9 w-28" />
        <Bone className="h-9 w-44" />
      </div>
      <div className="flex flex-col divide-y rounded-lg border">
        {ROWS.map((w, i) => (
          <div key={i} className="flex items-center gap-4 p-3">
            <Bone className="h-4 w-10 shrink-0" />
            <div className="flex-1">
              <Bone className="h-4" style={{ width: `${w}%` }} />
            </div>
            <Bone className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
