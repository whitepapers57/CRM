import { cn } from "@/lib/utils";

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn("h-9 rounded-md border bg-background px-2 text-sm transition active:scale-[0.98]", className)}
      {...props}
    />
  );
}
