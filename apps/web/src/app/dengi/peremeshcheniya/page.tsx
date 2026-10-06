import { PlaceholderPage } from "@/components/app/placeholder-page";
import { getT } from "@/i18n/server";

export default async function TransfersPage() {
  const t = await getT();
  return <PlaceholderPage title={t("money.transfers")} />;
}
