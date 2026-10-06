import { SectionPanel } from "@/components/app/section-panel";
import { getT } from "@/i18n/server";
import { DENGI_MENU } from "@/lib/dengi-menu";

/** The Деньги panel: the section's pages, grouped as in 1C. */
export default async function DengiPage() {
  const t = await getT();
  return <SectionPanel title={t("nav.money")} menu={DENGI_MENU} />;
}
