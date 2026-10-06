import type { MenuGroup } from "./zakupki-menu";

/** The Продажи panel, laid out like 1C «Управление компанией» (owner's pages, 5 Oct 2026). */
export const PRODAZHI_MENU: MenuGroup[][] = [
  [
    {
      title: "nav.sales",
      links: [
        { label: "nav.sales_invoices", href: "/prodazhi/nakladnye" },
        // «Накладная» (newest order) removed from the panel on 6 Oct 2026; an order opens from the list:
        // { label: "nav.receipt", href: "/prodazhi/nakladnaya" },
        { label: "nav.buyers", href: "/prodazhi/pokupateli" },
      ],
    },
  ],
  [{ title: "zmenu.planning", links: [{ label: "nav.sales_plans", href: "/prodazhi/plany-prodazh" }] }],
  [{ title: "zmenu.analytics", links: [{ label: "nav.reports", href: "/prodazhi/otchety" }] }],
];
