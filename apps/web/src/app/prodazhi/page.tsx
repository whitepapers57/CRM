import { SectionPanel } from "@/components/app/section-panel";
import { getT } from "@/i18n/server";
import { PRODAZHI_MENU } from "@/lib/prodazhi-menu";

/** The Продажи panel: the section's pages, grouped as in 1C. */
export default async function ProdazhiPage() {
  const t = await getT();
  return <SectionPanel title={t("nav.sales")} menu={PRODAZHI_MENU} />;
}
