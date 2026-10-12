import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LocaleSwitch } from "@/components/app/locale-switch";
import { Sidebar, type NavItem } from "@/components/app/sidebar";
import { UserMenu } from "@/components/app/user-menu";
import { getLocale, getT } from "@/i18n/server";
import { getMe } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin", "cyrillic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "Distribution Finance",
  description: "Distribution finance on Salesdoc data",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const me = await getMe();
  const t = await getT();
  const items: NavItem[] = [
    { href: "/", label: t("nav.reconciliation") },
    // «Торговые точки» moved into Продажи as «Покупатели» on 5 Oct 2026:
    // { href: "/outlets", label: t("nav.outlets") },
    { href: "/prodazhi", label: t("nav.sales") },
    // Закупки opens its 1C-style panel (/zakupki) since 5 Oct 2026; it used to list two pages here:
    // children: [
    //   { href: "/zakupki/nakladnye", label: t("nav.receipts") },
    //   { href: "/zakupki/postavshiki", label: t("nav.suppliers") },
    // ],
    { href: "/zakupki", label: t("nav.purchases") },
    { href: "/dengi", label: t("nav.money") },
    { href: "/kadry", label: t("nav.kadry") },
    { href: "/warehouse", label: t("nav.warehouse") },
    // Номенклатура and Отчёты live inside Закупки since 5 Oct 2026:
    // { href: "/nomenklatura", label: t("nav.nomenclature") },
    // { href: "/otchety", label: t("nav.reports") },
    { href: "/settings/sync", label: t("nav.sync") },
    { href: "/settings/months", label: t("nav.months") },
  ];
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background md:flex-row">
        <Sidebar
          title={t("app.title")}
          items={items}
          footer={
            <div className="flex flex-col gap-3">
              {me && <UserMenu name={me.name} label={t("auth.logout")} />}
              <LocaleSwitch current={locale} label={t("common.locale")} />
            </div>
          }
        />
        <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-6 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
