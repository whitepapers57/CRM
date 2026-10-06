import type { MenuGroup } from "./zakupki-menu";

/** The Деньги panel (owner's pages, 6 Oct 2026), laid out like 1C. */
export const DENGI_MENU: MenuGroup[][] = [
  [
    { title: "money.bank", links: [{ label: "money.bank-in", href: "/dengi/bank-in" }, { label: "money.bank-out", href: "/dengi/bank-out" }] },
    { title: "money.cash", links: [{ label: "money.cash-in", href: "/dengi/cash-in" }, { label: "money.cash-out", href: "/dengi/cash-out" }] },
  ],
  [{ title: "nav.money", links: [{ label: "money.transfers", href: "/dengi/peremeshcheniya" }] }],
  [{ title: "money.refs", links: [{ label: "money.categories", href: "/dengi/stati" }, { label: "money.accounts", href: "/dengi/scheta" }] }],
];
