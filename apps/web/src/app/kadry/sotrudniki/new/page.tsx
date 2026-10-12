import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type KadryStructure } from "@/lib/api";
import { tashkentToday } from "@/lib/today";
import { WorkplaceForm } from "../workplace-form";

export default async function NewEmployeePage() {
  const t = await getT();
  const locale = await getLocale();
  const res = await apiGet<KadryStructure>("/kadry/structure");
  return (
    <>
      <PageHeader back="/kadry/sotrudniki" title={t("kadry.new_title")} />
      {res.ok ? (
        <WorkplaceForm mode="create" structure={res.data} locale={locale} today={tashkentToday()} cancelHref="/kadry/sotrudniki" />
      ) : (
        <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />
      )}
    </>
  );
}
