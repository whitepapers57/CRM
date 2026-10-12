import type { MessageKey } from "@/i18n/messages";
import type { MenuGroup } from "./zakupki-menu";

/** The Кадры panel (12 Oct 2026): part 1 live, parts 2–7 as placeholders under /kadry/<slug>. */
export const KADRY_MENU: MenuGroup[][] = [
  [{ title: "nav.kadry", links: [
    { label: "kadry.employees", href: "/kadry/sotrudniki" },
    { label: "kadry.structure", href: "/kadry/struktura" },
    { label: "kadry.reasons", href: "/kadry/prichiny" },
    { label: "kadry.salesdoc", href: "/kadry/salesdoc" },
  ] }],
  [{ title: "kadry.later", links: [
    { label: "kadry.attendance", href: "/kadry/poseshchaemost" },
    { label: "kadry.payroll", href: "/kadry/zarplata" },
    { label: "kadry.inventory", href: "/kadry/inventar" },
  ] }],
  [{ title: "kadry.later", links: [
    { label: "kadry.recruiting", href: "/kadry/rekruting" },
    { label: "kadry.onboarding", href: "/kadry/onbording" },
    { label: "kadry.retention", href: "/kadry/uderzhanie" },
  ] }],
];

/** Placeholder slugs for parts 2–7 → their title key. */
export const KADRY_LATER: Record<string, MessageKey> = {
  poseshchaemost: "kadry.attendance", zarplata: "kadry.payroll", inventar: "kadry.inventory",
  rekruting: "kadry.recruiting", onbording: "kadry.onboarding", uderzhanie: "kadry.retention",
};
