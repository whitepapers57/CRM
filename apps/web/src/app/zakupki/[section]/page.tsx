import { notFound } from "next/navigation";
import { PlaceholderPage } from "@/components/app/placeholder-page";
import { getT } from "@/i18n/server";
import { findSlug } from "@/lib/zakupki-menu";

/** A Закупки panel link whose page is not built yet. Built ones (nakladnye, postavshiki) have their own routes. */
export default async function ZakupkiSectionPage({ params }: PageProps<"/zakupki/[section]">) {
  const { section } = await params;
  const link = findSlug(section);
  if (!link) notFound();
  const t = await getT();
  return <PlaceholderPage title={t(link.label)} back="/zakupki" />;
}
