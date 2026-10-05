import { redirect } from "next/navigation";

/** Moved under Закупки on 5 Oct 2026; old links still land on the page. */
export default function Moved() {
  redirect("/zakupki/nomenklatura");
}
