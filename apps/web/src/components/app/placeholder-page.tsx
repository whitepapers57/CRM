import { getT } from "@/i18n/server";
import { PageHeader } from "./page-header";
import { StickyToolbar } from "./sticky-toolbar";
import { Text } from "./text";

/** A routed page whose content comes later. */
export async function PlaceholderPage({ title, back }: { title: string; back?: string }) {
  const t = await getT();
  return (
    <>
      <StickyToolbar>
        <PageHeader title={title} back={back} />
      </StickyToolbar>
      <Text variant="caption">{t("common.in_progress")}</Text>
    </>
  );
}
