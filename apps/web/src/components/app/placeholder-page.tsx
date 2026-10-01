import { getT } from "@/i18n/server";
import { PageHeader } from "./page-header";
import { StickyToolbar } from "./sticky-toolbar";
import { Text } from "./text";

/** A routed page whose content comes later. */
export async function PlaceholderPage({ title }: { title: string }) {
  const t = await getT();
  return (
    <>
      <StickyToolbar>
        <PageHeader title={title} />
      </StickyToolbar>
      <Text variant="caption">{t("common.in_progress")}</Text>
    </>
  );
}
