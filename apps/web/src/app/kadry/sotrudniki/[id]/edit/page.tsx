import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type KadryEmployee, type KadryStructure } from "@/lib/api";
import { employeeFormFrom } from "@/lib/kadry-rules";
import { tashkentToday } from "@/lib/today";
import { WorkplaceForm } from "../../workplace-form";

/** «Трудовая книжка» edit: the workplace form prefilled from the whole card. */
export default async function EditWorkPage({ params }: PageProps<"/kadry/sotrudniki/[id]/edit">) {
  const t = await getT();
  const locale = await getLocale();
  const { id } = await params;
  const [card, structure] = await Promise.all([
    apiGet<KadryEmployee>(`/kadry/employees/${encodeURIComponent(id)}`),
    apiGet<KadryStructure>("/kadry/structure"),
  ]);
  const back = `/kadry/sotrudniki/${encodeURIComponent(id)}`;
  if (!card.ok || !structure.ok) {
    const bad = !card.ok ? card : structure;
    const message = bad.ok ? "" : bad.status === 0 ? t("errors.api_down") : bad.status === 404 ? t("kadry.not_found") : bad.message || t("errors.unknown");
    return (
      <>
        <PageHeader back="/kadry/sotrudniki" title={t("kadry.tab.work")} />
        <ApiError message={message} />
      </>
    );
  }
  return (
    <>
      <PageHeader back={back} title={`${card.data.name} · ${t("kadry.tab.work")}`} />
      <WorkplaceForm
        mode="edit"
        employeeId={id}
        initial={employeeFormFrom(card.data)}
        structure={structure.data}
        locale={locale}
        today={tashkentToday()}
        cancelHref={back}
      />
    </>
  );
}
