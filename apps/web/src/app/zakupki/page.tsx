import { redirect } from "next/navigation";

/** The section has no page of its own: open its first list. */
export default function ZakupkiPage() {
  redirect("/zakupki/nakladnye");
}
