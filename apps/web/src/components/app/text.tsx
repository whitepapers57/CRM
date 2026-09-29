import { cn } from "@/lib/utils";

const variants = {
  title: "text-2xl font-semibold tracking-tight",
  subtitle: "text-base font-medium",
  body: "text-sm",
  caption: "text-xs text-muted-foreground",
  error: "text-sm text-destructive",
} as const;

export function Text({
  variant = "body",
  as: Tag = "p",
  truncate,
  className,
  children,
  ...rest
}: {
  variant?: keyof typeof variants;
  as?: "p" | "span" | "h1" | "h2" | "h3" | "div";
  truncate?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn(variants[variant], truncate ? "truncate" : "[overflow-wrap:anywhere]", className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
