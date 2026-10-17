// Until 17 Oct 2026 a spinner, shown only when switching sections:
// import { Loader } from "@/components/app/loader";
// import { getT } from "@/i18n/server";
//
// export default async function Loading() {
//   const t = await getT();
//   return <Loader label={t("common.loading")} />;
// }

// A loading.tsx shows only when the page right below its folder changes, so every route folder
// has one (all re-exporting this skeleton); this one covers switching sections.
export { PageLoading as default } from "@/components/app/page-loading";
