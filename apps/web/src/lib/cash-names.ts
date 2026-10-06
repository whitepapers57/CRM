import { apiGet, type CashFormOptions, type CashRow } from "@/lib/api";

/**
 * id → name for the cash edit history (6 Oct 2026): cashboxes, bank accounts, suppliers, outlets and статьи,
 * inactive ones included (bank accounts and categories come whole; rows add what is on screen).
 */
export async function cashNames(rows: CashRow[] = []): Promise<Record<string, string>> {
  const [opts, banks, cats] = await Promise.all([
    apiGet<CashFormOptions>("/cash/form-options"),
    apiGet<Array<{ id: string; name: string }>>("/cash/bank-accounts"),
    apiGet<Array<{ id: string; name: string }>>("/cash/categories"),
  ]);
  const names: Record<string, string> = {};
  const put = (id: string | null | undefined, name: string | null | undefined) => {
    if (id && name) names[id] = name;
  };
  for (const r of rows) {
    put(r.cashboxSdId, r.cashboxName);
    put(r.bankAccountId, r.bankAccountName);
    put(r.supplierSdId, r.supplierName);
    if (r.operation === "from_buyer" || r.operation === "buyer_refund") put(r.outletSdId, r.party);
    if (r.categoryId) put(r.categoryId, r.party);
  }
  if (opts.ok) {
    for (const l of [opts.data.cashboxes, opts.data.bankAccounts, opts.data.suppliers, opts.data.outlets, opts.data.expenseCategories, opts.data.incomeCategories]) {
      for (const x of l) put(x.id, x.name);
    }
  }
  for (const r of banks.ok ? banks.data : []) put(r.id, r.name);
  for (const r of cats.ok ? cats.data : []) put(r.id, r.name);
  return names;
}
