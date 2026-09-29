# distribution-finance — design

Date: 29 Sep 2026 · Status: awaiting review

## 1. Purpose

A finance tool for one distribution company (28 Salesdoc filials; v1 covers
**Andijan only**, `apand.salesdoc.io`, filial `500`). It follows the business
along two flows — goods and money — and shows, per counterparty, whether they
agree. The source diagram is `pipline.jpg` in the repo root:

- **Goods:** Supplier → stock in → Warehouse (by SKU) → Sales outlets.
- **Money:** cash inflow (outlet payments, refunds / returned funds) and cash
  outflow (expenses, loans, supplier payments).
- **Settlements (goods) = Settlements (cash).** The difference per
  counterparty is the open balance (debt).

Out of scope for v1: other filials, currency conversion (all UZS), writing
anything back to Salesdoc, a comparison with Salesdoc's own `getBalance`
(one manual check after the first full sync only — see §4.6), multi-company.

## 2. Architecture

npm-workspaces monorepo, already scaffolded:

| App | Stack | Role |
|---|---|---|
| `apps/api` | NestJS 12 (ESM), Prisma 7, PostgreSQL 18 | Sync, reconciliation, auth, REST API under `/api` |
| `apps/web` | Next.js 16, Tailwind 4, shadcn/ui | UI in Russian and Uzbek |

**Data strategy: mirror.** A scheduled job in the API copies Salesdoc data into
PostgreSQL; every screen and every calculation reads PostgreSQL only.
Manually entered money lives in the same database, so reports join both.

Existing pieces kept as they are: `SalesdocClient` (single shared login,
re-login on 401, paginated `fetchAll`), credentials in
`apps/api/data/salesdoc.json`, `SyncRun`.

## 3. Data model

Money is `Decimal(18,2)`, never float. Every mirrored table stores `sdId`
(unique), `csId`, `code1c`, the raw Salesdoc JSON (`raw Json`) and
`syncedAt`. Mirrored rows are read-only in the app.

### 3.1 Mirrored from Salesdoc

| Diagram box | Model | Salesdoc method → result key |
|---|---|---|
| Warehouse | `Warehouse` | `getWarehouse` → `warehouse` |
| SKU | `Product` | `getProduct` → `product` |
| SKU stock | `StockLevel` (warehouse × product, current) | `getStock` → `warehouse` |
| Supplier | `Supplier` | `getShipper` → `shipper` |
| Stock in | `Purchase`, `PurchaseLine` | `getPurchase` → `warehouse` (one row per receipt, lines in `detail`) |
| Sales outlets | `Outlet`, `Agent`, `Expeditor` | `getClient` → `client`, `getAgent` → `agent`, `getExpeditor` → `expeditor` |
| Goods out | `Order`, `OrderLine` | `getOrder` → `order`, with `filter.status [1..5]`, `filter.agent "all"` |
| Products returned to us | `Return`, `ReturnLine` | `getOrderDefect` → `order` |
| Cash in from outlets | `Payment`, `PaymentAllocation` (payment → order, amount) | `getPayment` → `payment` |
| Reference | `PaymentType`, `Cashbox` | `getPaymentType` → `currency`, `getCashbox` → `cashbox` |

`Order` keeps `status` (1 New, 2 Sent, 3 Delivered, 4 Closed, 5 Cancelled),
`dateDocument`, `totalSumma`, `discountSumma`, `totalSummaAfterDiscount`,
`debtDateExp` (null when Salesdoc sends `1970-01-01`), outlet, agent,
expeditor, warehouse, payment type.

### 3.2 Entered in the app

- **`CashEntry`** — `direction` (`in` | `out`), `kind`, `amount`, `date`,
  `cashboxId`, `paymentTypeId`, optional `supplierId` / `outletId` /
  `counterpartyId` / `expenseCategoryId`, `comment`, `createdById`,
  `updatedById`, timestamps, and cancellation fields `cancelledAt`,
  `cancelledById`, `cancelReason`.

  | Direction | Kinds |
  |---|---|
  | out | `expense`, `supplier_payment`, `loan_given`, `loan_repayment` |
  | in | `loan_received`, `loan_returned`, `supplier_refund`, `outlet_overpayment`, `other_inflow` |

  Required links by kind: `expense` → category; `supplier_*` → supplier;
  `loan_*` → counterparty; `outlet_overpayment` → outlet.
- **`ExpenseCategory`** — two levels (`parentId`), e.g. «Транспорт → Топливо».
- **`Counterparty`** — lenders and borrowers for loans.
- **`User`**, **`Role`**, **`RolePermission`** — see §6.

### 3.3 Sync bookkeeping

- **`SyncRun`** (exists) — one row per pull: method, status, rows, error, times.
- **`SyncCursor`** — per method: last successful `updatedSince` watermark,
  and the page reached during an unfinished full load.

## 4. Reconciliation rules

Balance = goods side − cash side. Balances are cumulative from the start of
history; a period view shows opening balance, movements in the period, and
closing balance. Items are dated by document date: orders `dateDocument`,
returns their document date, payments `paymentDate`, receipts their date,
cash entries `date`. Cancelled cash entries count for nothing.

### 4.1 Outlets — what they owe us

- Goods: Σ `totalSummaAfterDiscount` of orders with status **Delivered (3) or
  Closed (4)** − Σ returns. New, Sent and Cancelled orders count for nothing.
- Cash: Σ Salesdoc payments + Σ `outlet_overpayment` entries. An overpayment
  is entered in the app only when it is **not** already a Salesdoc payment.
- Positive = the outlet owes us; negative = prepaid.

### 4.2 Supplier — what we owe

- Goods: Σ purchase line amounts.
- Cash: Σ `supplier_payment` − Σ `supplier_refund`.
- Positive = we owe the supplier. Supplier returns are not exposed by the API
  (`getSupplierReturn` → 402); goods sent back appear only as a refund.

### 4.3 Loans — per counterparty

- Borrowed: `loan_received` − `loan_repayment` = we owe.
- Lent: `loan_given` − `loan_returned` = owed to us.

### 4.4 Cash position — per cashbox

Σ Salesdoc payments into the cashbox + Σ inflow entries − Σ outflow entries
= expected cash on hand.

### 4.5 The "=" (home screen)

For the selected period: the goods-side totals (outlets, supplier) beside
the cash-side totals, and the difference, which is the sum of the open
balances above.

### 4.6 Deferred: active settlements = passive settlements

The owner requires active and passive settlements to be equal, as the
diagram's "=" shows. Its exact definition (balance sheet актив = пассив, or
receivables = payables) is deferred until the diagram's data is built and
visible. Nothing in v1 may block it: keep purchase prices per line (cost of
goods) and every cash movement, so either definition can be computed later.

### 4.7 Known risk

If Salesdoc was seeded with opening balances (`setBalance`) instead of
building them from orders, computed outlet balances will differ from
Salesdoc's for those outlets. After the first full sync, compare once against
`getBalance` and report the differences; not a permanent feature.

## 5. Sync

- Scheduled in the API every **15 minutes**; also on demand ("sync now").
- One method at a time, reference data first (warehouses, products,
  payment types, cashboxes, supplier, agents, expeditors, outlets), then
  purchases, orders, returns, payments, stock.
- **First run** loads full history in the background; each page is upserted
  and the page number stored in `SyncCursor`, so a failure resumes where it
  stopped. Progress is shown in the sync panel.
- **Later runs** fetch only records changed since the cursor (the method's
  update-date filter, with a small overlap), upserting by `sdId`.
- Failures (Salesdoc down, bad credentials, 429) are recorded in `SyncRun`;
  the app keeps working on the last good data and shows the time of the last
  successful sync on the home screen.
- Because one Salesdoc login invalidates the previous token, the app must use
  a **dedicated Salesdoc user**. Until one exists it uses `ans`, which logs
  that person out of the Salesdoc web app on each login.

## 6. Users, roles and permissions

- **Platform staff** — built-in role, cannot be edited or deleted, holds every
  permission, and is the only role that can manage roles. The first account
  (the owner) is created with it by a CLI setup command; there is no public
  sign-up.
- **Custom roles** — platform staff create, rename, edit and delete roles on
  the Roles screen by ticking permissions from a fixed catalogue:

  | Area | Permissions |
  |---|---|
  | Viewing | `reconciliation.view`, `outlets.view`, `supplier.view`, `warehouse.view`, `cash.view`, `loans.view` |
  | Cash entries | `cash.create`, `cash.edit`, `cash.cancel` |
  | Reference lists | `references.manage` |
  | Salesdoc | `sync.run`, `sync.settings` |
  | People | `users.manage` |

- Seeded as ordinary, editable roles: «Бухгалтер» (all viewing, cash
  entries, references, `sync.run`) and «Руководитель» (all viewing).
- A user has exactly one role. A role in use cannot be deleted until its
  users are moved. Permission changes apply on the user's next request.
- `users.manage` can create users and assign any role except platform staff.
- Auth: login + password (hashed with argon2), session in an httpOnly cookie.
  The API checks permissions on every endpoint; the UI hides what the user
  cannot use, as a convenience only.

## 7. Screens

Russian and Uzbek, sidebar navigation, period filter and search on lists,
the shared loader on every wait, visible press feedback on every button.

| Screen | Permission | Content |
|---|---|---|
| Сверка (home) | `reconciliation.view` | Four totals (outlets owe us, we owe supplier, net loans, cash on hand); goods vs cash for the period; "данные на HH:MM" |
| Торговые точки | `outlets.view` | Table per outlet: delivered, returns, paid, balance; filter by agent / expeditor; outlet statement with running balance |
| Поставщик | `supplier.view` | Receipts vs payments and refunds, running balance |
| Склад | `warehouse.view` | Stock per warehouse × SKU; receipts list with lines |
| Касса | `cash.view` (+ `cash.*` to change) | Cashboxes with expected balance; entry list; add / edit / cancel entry form with per-field errors |
| Займы | `loans.view` | Balance per counterparty, drill-down to movements |
| Настройки | per section | Users (`users.manage`), Roles (platform staff), categories and counterparties (`references.manage`), Salesdoc sync panel (`sync.run` / `sync.settings`) |

## 8. Testing

- Unit tests for §4 with hand-built fixtures: an outlet with orders, a return
  and a partial payment; a cancelled order and a Sent order that must not
  count; a cancelled cash entry; loans in both directions.
- Sync tests against recorded Salesdoc responses (no live calls): paging,
  resume after failure, incremental upsert, `1970-01-01` → null.
- API e2e for permissions: each endpoint refuses a role without the
  permission; only platform staff reach role management.
- Every screen is checked in a real browser before it is called done.
