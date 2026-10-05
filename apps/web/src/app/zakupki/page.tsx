import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { getT } from "@/i18n/server";
import { ZAKUPKI_MENU, zakupkiHref } from "@/lib/zakupki-menu";

// Until 5 Oct 2026 the section had no page of its own and opened its first list:
// export default function ZakupkiPage() {
//   redirect("/zakupki/nakladnye");
// }

/** The Закупки panel: every document and list of the section, grouped as in 1C. */
export default async function ZakupkiPage() {
  const t = await getT();
  return (
    <>
      <StickyToolbar>
        <PageHeader title={t("nav.purchases")} />
      </StickyToolbar>
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-3">
        {ZAKUPKI_MENU.map((column, ci) => (
          <div key={ci} className="flex flex-col gap-6">
            {column.map((group) => (
              <section key={group.title} className="flex flex-col gap-1">
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
