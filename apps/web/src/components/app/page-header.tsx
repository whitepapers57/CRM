import { Text } from "./text";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <Text as="h1" variant="title">{title}</Text>
        {subtitle && <Text variant="caption">{subtitle}</Text>}
      </div>
      {children}
    </header>
  );
}
