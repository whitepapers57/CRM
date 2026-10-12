import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type KadryEmployee } from "@/lib/api";
import { employeeFormFrom } from "@/lib/kadry-rules";
import { tashkentToday } from "@/lib/today";
import { PersonalForm } from "../personal-form";

/** «Личные данные» edit. */
export default async function EditPersonalPage({ params }: PageProps<"/kadry/sotrudniki/[id]/lichnye">) {
  const t = await getT();
  const locale = await getLocale();
  const { id } = await params;
  const card = await apiGet<KadryEmployee>(`/kadry/employees/${encodeURIComponent(id)}`);
  if (!card.ok) {
    return (
      <>
        <PageHeader back="/kadry/sotrudniki" title={t("kadry.tab.personal")} />
        <ApiError message={card.status === 0 ? t("errors.api_down") : card.status === 404 ? t("kadry.not_found") : card.message || t("errors.unknown")} />
      </>
    );
  }
  const back = `/kadry/sotrudniki/${encodeURIComponent(id)}?tab=personal`;
  return (
    <>
      <PageHeader back={back} title={`${card.data.name} · ${t("kadry.tab.personal")}`} />
      <PersonalForm employeeId={id} initial={employeeFormFrom(card.data)} locale={locale} today={tashkentToday()} cancelHref={back} />
    </>
  );
}
