import { SectionPanel } from "@/components/app/section-panel";
import { getT } from "@/i18n/server";
import { ZAKUPKI_MENU } from "@/lib/zakupki-menu";

// Until 5 Oct 2026 the section had no page of its own and opened its first list:
// export default function ZakupkiPage() {
//   redirect("/zakupki/nakladnye");
// }

/** The Закупки panel: the section's pages, grouped as in 1C. */
export default async function ZakupkiPage() {
  const t = await getT();
  return <SectionPanel title={t("nav.purchases")} menu={ZAKUPKI_MENU} />;
}
