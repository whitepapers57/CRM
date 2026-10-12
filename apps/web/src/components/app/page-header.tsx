import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { Text } from "./text";

/**
 * Page title row. `back` (a parent route) puts a back chevron to the left of the title, on the same row —
 * every nested page has one; top-level sidebar pages do not.
 */
export async function PageHeader({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  children?: React.ReactNode;
}) {
  const t = await getT();
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          {back && (
            <Link
              href={back}
              aria-label={t("common.back")}
              title={t("common.back")}
              className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-md transition hover:bg-muted active:scale-90"
            >
              <ChevronLeftIcon className="size-6" />
            </Link>
          )}
          <Text as="h1" variant="title">{title}</Text>
        </div>
        {subtitle && <Text variant="caption" className={back ? "pl-8" : undefined}>{subtitle}</Text>}
      </div>
      {children}
    </header>
  );
}
