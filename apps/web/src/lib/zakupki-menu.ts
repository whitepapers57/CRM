import type { MessageKey } from "@/i18n/messages";

/** One link of the Закупки panel. `href` set = a page we have; otherwise it opens /zakupki/<slug> (in progress). */
export interface MenuLink {
  label: MessageKey;
  href?: string;
  slug?: string;
}

export interface MenuGroup {
  title: MessageKey;
  links: MenuLink[];
}

/** The Закупки panel, laid out like 1C «Управление компанией»: three columns of groups. */
export const ZAKUPKI_MENU: MenuGroup[][] = [
  [
    {
      title: "nav.purchases",
      links: [
        { label: "nav.suppliers", href: "/zakupki/postavshiki" },
        { label: "zmenu.supplier_orders", slug: "zakazy" },
        { label: "zmenu.invoices_received", slug: "scheta" },
        { label: "nav.receipts", href: "/zakupki/nakladnye" },
        { label: "zmenu.tax_invoices_received", slug: "scheta-faktury" },
        { label: "zmenu.extra_costs", slug: "dop-rashody" },
        { label: "zmenu.powers_of_attorney", slug: "doverennosti" },
        { label: "zmenu.receipt_corrections", slug: "korrektirovki-postupleniy" },
      ],
    },
    {
      title: "zmenu.supplier_settlements",
      links: [
        { label: "zmenu.reconciliations", slug: "sverki" },
        { label: "zmenu.debt_corrections", slug: "korrektirovki-dolga" },
      ],
    },
  ],
  [
    {
      title: "nav.warehouse",
      links: [
        { label: "zmenu.stock_transfers", slug: "peremeshcheniya" },
        { label: "zmenu.cell_transfers", slug: "peremeshcheniya-yacheyki" },
        { label: "zmenu.reservations", slug: "rezervirovaniya" },
        { label: "zmenu.inventories", slug: "inventarizatsii" },
        { label: "zmenu.warehouse_acts", slug: "skladskie-akty" },
      ],
    },
    { title: "zmenu.goods_services", links: [{ label: "nav.nomenclature", href: "/nomenklatura" }] },
    {
      title: "zmenu.prices",
      links: [
        { label: "zmenu.price_lists", slug: "prays-listy" },
        { label: "zmenu.price_types", slug: "vidy-tsen" },
      ],
    },
    { title: "zmenu.planning", links: [{ label: "zmenu.needs", slug: "raschet-potrebnostey" }] },
  ],
  [
    { title: "zmenu.analytics", links: [{ label: "nav.reports", href: "/otchety" }] },
    { title: "zmenu.settings", links: [{ label: "zmenu.more", slug: "nastroyki" }] },
  ],
];

export const zakupkiHref = (l: MenuLink) => l.href ?? `/zakupki/${l.slug}`;

/** The in-progress link a slug belongs to, if any. */
export function findSlug(slug: string): MenuLink | undefined {
  return ZAKUPKI_MENU.flat()
    .flatMap((g) => g.links)
    .find((l) => l.slug === slug);
}
