import { getT } from "@/i18n/server";
import { PageSkeleton } from "./page-skeleton";

/**
 * The `loading.tsx` of every route folder (`export { PageLoading as default } from …`).
 * A loading.tsx shows only when the page right below its folder changes, hence one per folder;
 * a filter on the same page (search params only) is covered by PendingNav instead.
 */
export async function PageLoading() {
  const t = await getT();
  return <PageSkeleton label={t("common.loading")} />;
}
