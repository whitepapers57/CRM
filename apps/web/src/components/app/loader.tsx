import { cn } from "@/lib/utils";

/** The one spinner. Pass the translated label from the caller. */
export function Loader({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("flex items-center justify-center p-8", className)}>
      <span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}
