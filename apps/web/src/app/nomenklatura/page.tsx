import { PlaceholderPage } from "@/components/app/placeholder-page";
import { getT } from "@/i18n/server";

export default async function NomenclaturePage() {
  const t = await getT();
  return <PlaceholderPage title={t("nav.nomenclature")} />;
}
