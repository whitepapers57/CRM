import { notFound } from "next/navigation";
import { PlaceholderPage } from "@/components/app/placeholder-page";
import { getT } from "@/i18n/server";
import { KADRY_LATER } from "@/lib/kadry-menu";

/** Parts 2–7 of Кадры: routed, content comes later. Unknown names are 404 (hasOwn, not `in`: "constructor" must not match). */
export default async function KadryLaterPage({ params }: PageProps<"/kadry/[section]">) {
  const { section } = await params;
  const t = await getT();
  if (!Object.hasOwn(KADRY_LATER, section)) notFound();
  return <PlaceholderPage title={t(KADRY_LATER[section])} back="/kadry" />;
}
