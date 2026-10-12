import Link from "next/link";
import { getT } from "@/i18n/server";
import { type MenuGroup, zakupkiHref } from "@/lib/zakupki-menu";
import { PageHeader } from "./page-header";
import { StickyToolbar } from "./sticky-toolbar";
import { Text } from "./text";

/** A section's page as in 1C «Управление компанией»: columns of green-titled groups of links. */
export async function SectionPanel({ title, menu }: { title: string; menu: MenuGroup[][] }) {
  const t = await getT();
  return (
    <>
      <StickyToolbar>
        <PageHeader title={title} />
      </StickyToolbar>
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-3">
        {menu.map((column, ci) => (
          <div key={ci} className="flex flex-col gap-6">
            {column.map((group) => (
              // 2026-10-12: was <section key={group.title} className="flex flex-col gap-1">
              <section key={`${ci}-${group.title}`} className="flex flex-col gap-1">
                <Text as="h2" variant="subtitle" className="mb-1 text-emerald-700 dark:text-emerald-400">
                  {t(group.title)}
                </Text>
                {group.links.map((l) => (
                  <Link
                    key={l.label}
                    href={zakupkiHref(l)}
                    className="-mx-2 rounded-md px-2 py-1 text-sm transition hover:bg-muted hover:underline active:scale-[0.98]"
                  >
                    {t(l.label)}
                  </Link>
                ))}
              </section>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
