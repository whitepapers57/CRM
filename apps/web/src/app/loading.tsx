import { Loader } from "@/components/app/loader";
import { getT } from "@/i18n/server";

export default async function Loading() {
  const t = await getT();
  return <Loader label={t("common.loading")} />;
}
