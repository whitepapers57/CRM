# Закупки section — design

Date: 1 Oct 2026 · Status: agreed in chat, awaiting spec review
Parent spec: `2026-09-29-distribution-finance-design.md` (window = current month, §4).

## 1. Purpose

Give purchasing its own sidebar section, «Закупки», laid out like the owner's
1C «Управление компанией» screens (`page-example-images/`): a list of
приходные накладные, one накладная with its goods, and a list of
поставщики with what we owe them. Add empty placeholder pages for
«Номенклатура» and «Отчёты».

**Data source: Salesdoc only** (owner's answer). The 1C screens are a layout
reference, not a data source. Consequences, stated on the pages where they
matter:

- Andijan's Salesdoc has one supplier, «Основной поставщик», so Поставщики
  shows one row today.
- Salesdoc receipts carry no 1C number, contract, operation, VAT, unit or
  discount; those 1C columns are left out, not faked.
- Supplier payments do not exist until the cash module, so «Оплачено» is 0
  and the debt equals the receipts in the period.

Out of scope: creating or editing documents (read-only, Salesdoc stays the
source), 1C integration, Номенклатура and Отчёты content.

## 2. Navigation

```
Сверка
Торговые точки
Закупки                 (section heading, links to Приходные накладные)
   Приходные накладные  /zakupki/nakladnye
   Поставщики           /zakupki/postavshiki
Склад                   /warehouse (stock only)
Номенклатура            /nomenklatura
Отчёты                  /otchety
Синхронизация           /settings/sync
```

The sub-items are indented under «Закупки»; the section item is highlighted
whenever any `/zakupki/*` page is open. `/zakupki` redirects to
`/zakupki/nakladnye`.

## 3. Pages

### 3.1 Приходные накладные — `/zakupki/nakladnye`

- Sticky top bar: title, period picker, then filters: Поставщик (dropdown,
  «Все»), Склад (dropdown, «Все»), Поиск по номеру (text), «Применить».
- Table, newest first: **Дата · Номер · Поставщик · Сумма · Склад · Позиций**,
  then an **Итого** row (sum of Сумма over the filtered rows).
- Номер = Salesdoc's document id (`d0_432`). A row click opens the накладная.
- Empty → «Нет данных за этот период».

### 3.2 Накладная — `/zakupki/nakladnye/<sdId>`

- Title «Приходная накладная <номер> от <дата>».
- Header block (two columns, label: value): Поставщик, Склад, Номер, Дата,
  Операция «Поступление от поставщика» (constant: every Salesdoc purchase is
  one).
- Goods table: **N · Номенклатура · Количество · Цена · Сумма**, Итого row.
- Unknown id → the API's 404 message under the header.

### 3.3 Поставщики — `/zakupki/postavshiki`

- Sticky top bar: title, period picker.
- Table: **Поставщик · Получено · Оплачено · Долг (+ нам, − мы)**.
  - Получено = receipts dated in the period.
  - Оплачено = 0 until the cash module (caption says so).
  - Долг = −(supplier balance at the end of the period), 1C's sign: negative
    = we owe. Balance = receipts from the window start to the period end.
- Row click → that supplier's statement.

### 3.4 Акт сверки с поставщиком — `/zakupki/postavshiki/<sdId>`

Today's `/supplier` statement, scoped to one supplier: opening, each receipt
with running balance, closing.

### 3.5 Номенклатура `/nomenklatura`, Отчёты `/otchety`

Title + «Раздел в разработке» (ru) / «Bo'lim ishlab chiqilmoqda» (uz). No API call.

### 3.6 Moved addresses

| Old | New |
| --- | --- |
| `/supplier` | `/zakupki/postavshiki` |
| `/warehouse?tab=purchases` | `/zakupki/nakladnye` |
| `/warehouse/purchases/<id>` | `/zakupki/nakladnye/<id>` |

Old route files become permanent redirects with a comment pointing to the new
page (the code itself moves; nothing is deleted outright). Склад keeps only
the stock view; its tabs go away.

## 4. API

| Endpoint | Change |
| --- | --- |
| `GET /api/warehouse/purchases?from&to` | + `supplier` (sdId), `warehouse` (sdId), `search` (case-insensitive part of the number) filters; total follows the filters |
| `GET /api/warehouse/purchases/:sdId` | unchanged |
| `GET /api/suppliers?from&to` | **new**: `{ rows: [{ sdId, name, received, paid, debt }] }`, money as 2-dp strings, sorted by name; every `Supplier` row plus any supplier sdId that appears on a stored purchase |
| `GET /api/supplier/statement?from&to&supplier` | + `supplier` (sdId) filter; without it all suppliers, as today |

Rules (same as parent spec §4.2): Получено = Σ `Purchase.total` dated in
[from, to]; balance at period end = Σ receipts dated in [windowStart, to];
paid = 0; debt = −balance.

## 5. Language and UI rules

All new words in `apps/web/src/i18n/messages.ts` in ru and uz; shared
`Select`, `PagePeriod`, `StickyToolbar`, `Text`, `Loader`, `ApiError`;
money and dates through `lib/format`.

## 6. Testing

- API: purchases filters (supplier, warehouse, search, total follows
  filters); suppliers list (received/paid/debt sign, period bounds, a
  supplier present only on purchases); statement scoped to one supplier.
- Web: typecheck, lint; every new page and every redirect checked in a
  browser, desktop and 390 px, ru and uz.
