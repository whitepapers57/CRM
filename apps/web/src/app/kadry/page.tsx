import Link from "next/link";
import { SectionPanel } from "@/components/app/section-panel";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { apiGet, type KadryBirthday } from "@/lib/api";
import { KADRY_MENU } from "@/lib/kadry-menu";

/** The Кадры panel, with this month's upcoming birthdays underneath. */
export default async function KadryPage() {
  const t = await getT();
  const res = await apiGet<KadryBirthday[]>("/kadry/birthdays");
  const rows = res.ok ? res.data : [];
  return (
    <>
      <SectionPanel title={t("nav.kadry")} menu={KADRY_MENU} />
      <Card className="max-w-xl">
        <CardHeader><CardTitle>{t("kadry.birthdays")}</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <Text variant="caption">{t("kadry.birthdays_empty")}</Text>
          ) : (
            <ul className="divide-y">
              {rows.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <Link href={`/kadry/sotrudniki/${encodeURIComponent(b.id)}`} className="min-w-0 flex-1 basis-40 font-medium underline-offset-4 hover:underline">
                    {b.name}
                  </Link>
                  {b.daysLeft === 0 ? <Badge>{t("kadry.today")}</Badge> : <span className="text-muted-foreground">{t("kadry.in_days", { n: String(b.daysLeft) })}</span>}
                  {b.turnsAge != null && <span className="text-muted-foreground">{t("kadry.turns", { age: String(b.turnsAge) })}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
