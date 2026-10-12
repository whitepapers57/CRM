import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Text } from "@/components/app/text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { apiGet } from "@/lib/api";
import { AddRef, RefRow } from "../ref-row";

// 6 Oct 2026: was `<PlaceholderPage title={t("money.categories")} />` (routed through [page]/page.tsx LATER).

interface Category { id: string; name: string; kind: "expense" | "income"; active: boolean }

export default async function CategoriesPage() {
  const t = await getT();
  const locale = await getLocale();
  const res = await apiGet<Category[]>("/cash/categories");
  const header = (
    <StickyToolbar>
      <PageHeader back="/dengi" title={t("money.categories")} />
    </StickyToolbar>
  );
  if (!res.ok) return <>{header}<ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} /></>;
  return (
    <>
      {header}
      <Text variant="caption">{t("refs.placeholder_note")}</Text>
      <div className="grid gap-4 lg:grid-cols-2">
        {(["expense", "income"] as const).map((kind) => (
          <Card key={kind}>
            <CardHeader><CardTitle>{t(kind === "expense" ? "refs.expense" : "refs.income")}</CardTitle></CardHeader>
            <CardContent>
              <ul>
                {res.data.filter((c) => c.kind === kind).map((c) => (
                  <RefRow key={c.id} kind="categories" id={c.id} name={c.name} active={c.active} locale={locale} />
                ))}
              </ul>
              <AddRef kind="categories" categoryKind={kind} locale={locale} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
