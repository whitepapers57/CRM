# Деньги (cash and bank) and the «История» button — design

Date: 6 Oct 2026 · Status: agreed in chat, awaiting spec review
Parent specs: `2026-09-29-distribution-finance-design.md` (§ cash entries),
`2026-10-03-receipt-edit-delete-design.md` (months, audit log, login).

## 1. Purpose

Record the money that leaves and enters the company (supplier payments,
expenses, salaries, loans, taxes…) so that settlements are real: the supplier's
«Оплачено» fills in and its debt shrinks to the true figure.

Owner's decisions (chat, 5–6 Oct 2026):

- **Entered in our app** (option B). 1C stops being used for this. Salesdoc's
  «Финансы → Расходы» is not used (it is empty; the API returns 0 rows).
- **Buyer payments come from Salesdoc automatically** (already synced).
- **Four pages**, as in 1C: Поступления на счёт, Расход со счёта,
  Поступления в кассу, Расход из кассы. «Перемещения денег» is a placeholder.
- **UZS only.** No opening balances (start where the data starts, 01.09.2026).
- **No employee list:** staff operations carry a typed name.
- **Categories («статьи») and bank accounts are placeholders** someone fills in
  later; the forms must work before that.
- **Every page with history gets a «История» button** (§8).

Out of scope: loans ledger and balances, cash on hand per cashbox, payroll
statements, transfers between accounts beyond «Взнос наличными в банк»,
writing anything to Salesdoc, roles.

## 2. Accounts

- **Кассы** are Salesdoc's cashboxes (already synced: Основная касса,
  «с инкассатора», Касса НИЧ, Касса Импорт).
- **Банковские счета:** new table `BankAccount` (`id`, `name`, `active`),
  seeded with «Основной счёт». Page «Банковские счета» lists them and lets a
  user add, rename and deactivate (same pattern as статьи, §5).

## 3. Cash operations

Table `CashOperation`:

| Field | Notes |
|---|---|
| `id` | uuid |
| `number` | `ДД-000001`, from a database sequence, never reused |
| `direction` | `in` \| `out` |
| `account` | `cash` \| `bank` |
| `cashboxSdId` / `bankAccountId` | exactly one, matching `account` |
| `date` | day (Tashkent), ≥ 01.09.2026, ≤ today |
| `amount` | Decimal(18,2), > 0, at most 2 decimals |
| `operation` | one of §4 |
| `supplierSdId` / `outletSdId` / `categoryId` / `counterpartyName` | the one the operation needs (§4) |
| `comment` | optional |
| `createdById`, `createdAt` | who entered it |
| `cancelledAt`, `cancelledById`, `cancelledByName`, `cancelReason` | set by «Отменить» |

- A cancelled operation stays listed (struck through, «Отменена: кто, когда,
  причина») and counts for nothing in any total.
- **Edit** while the operation's month (and the new date's month) is open;
  **Отменить** needs a reason and an open month; **Восстановить** undoes a
  cancel in an open month. A closed month refuses all three (409 «Месяц
  закрыт»), and refuses new operations dated in it.
- Every create, edit, cancel and restore writes the append-only `AuditLog`
  (actions `cash.create`, `cash.edit`, `cash.cancel`, `cash.restore`; target =
  operation id; before/after snapshots for edits).

## 4. Operation types

Field each type requires («Кому / Откуда»): **S** supplier, **B** buyer
(outlet), **C** статья, **N** typed name, **—** nothing.

Расход (касса and счёт):

| Operation | Needs |
|---|---|
| Поставщику | S |
| На расходы | C (expense статья) |
| Зарплата сотруднику | N |
| Зарплата по ведомости | — |
| Прочему контрагенту (учредителю) | N |
| Покупателю (возврат) | B |
| Возврат кредита | N |
| Выдача займа сотруднику | N |
| Подотчётнику | N |
| Налоги | C (expense статья) |
| Прочий расход | C (expense статья) |
| Взнос наличными в банк | — (касса only; also needs the target bank account) |

Поступление (касса and счёт):

| Operation | Needs |
|---|---|
| От покупателя | B — for money Salesdoc does not have |
| Возврат от поставщика | S |
| Возврат займа сотрудником | N |
| Получение кредита | N |
| Прочее поступление | C (income статья) |

«Взнос наличными в банк» is one operation (direction `out`, account `cash`,
plus `bankAccountId` of the receiving account). It is listed on Расход из
кассы and also on Поступления на счёт as «Взнос наличными из кассы»; editing
or cancelling it changes both views.

## 5. Статьи движения денег (placeholder)

Table `CashCategory` (`id`, `name`, `kind` `expense` \| `income`, `active`).
Seeded: «Прочие расходы» (expense), «Прочие доходы» (income). Page «Статьи
движения денег»: two lists, add / rename / deactivate (a deactivated статья
stays on old operations but is not offered in forms). One level only; a parent
can be added later without changing operations.

## 6. Buyer payments from Salesdoc

Salesdoc `Payment` rows with `transactionType = 3` (the ones settlements
already count) appear read-only on:

- Поступления в кассу — payment type Наличный or Терминал;
- Поступления на счёт — payment type Перечисление.

Shown as Операция «От покупателя», Откуда = the outlet, Номер = the Salesdoc
id, marked «из Salesdoc»; no edit or cancel. The split is a setting per
payment type (`PaymentType` gets our own `account` column, default by name as
above), changed on the «Банковские счета» page.

## 7. Pages

Sidebar: new section **«Деньги»** (after Закупки) opening a 1C-style panel
(`SectionPanel`):

- **Банк:** Поступления на счёт, Расход со счёта
- **Касса:** Поступления в кассу, Расход из кассы
- **Деньги:** Перемещения денег (placeholder page, own route)
- **Справочники:** Статьи движения денег, Банковские счета

Routes under `/dengi/…`.

Each of the four lists:

- Toolbar: period (default: current month), Операция, Касса / Счёт,
  search (number, counterparty, comment), «Показать отменённые», «Создать ▾»
  (the menu of §4 for this page), «История» (§8).
- Columns: Дата, Номер, Откуда / Кому, Сумма, Операция, Комментарий; Итого
  of non-cancelled rows. Row → the operation's page.
- Operation page: the fields, «Редактировать», «Отменить» / «Восстановить»,
  «История». Edit uses the same form as create.
- Form: date (DateField; closed months stay pickable but show «Месяц закрыт»
  under the field), касса / счёт (Select), amount, the field the operation
  needs (supplier Select, buyer searchable picker, статья Select, or text),
  comment. Each error under its field; «Сохранить» with a spinner.

All words in ru and uz; phone width without horizontal page scroll.

## 8. «История» button (all pages with history)

History moves from an inline block to a **«История» button** in the page
header that opens a side panel (design-system dialog/sheet):

| Page | Shows |
|---|---|
| Приходная накладная | that receipt's entries (today's inline list) |
| Приходные накладные (list) | every `purchase.*` entry, newest first, each linking to its receipt |
| Закрытие месяца | `month.*` entries |
| Each Деньги list | `cash.*` entries of operations on that page |
| Cash operation | that operation's entries |

Newest first, up to 200 rows, same row format as today (time, user, action,
reason, before → after for edits). API: `GET /audit?actionPrefix=&target=`
(existing `AuditService.list`) plus a filter by page for cash lists.

## 9. Effects on settlements

- **Поставщики** and the supplier statement: «Оплачено» = Σ Поставщику −
  Σ Возврат от поставщика (non-cancelled, by date). Debt = на начало −
  получено + оплачено, as now.
- Nothing else changes yet (loans and cash on hand come later).

## 10. Testing

- API: each operation type's required field and refusals; account / cashbox
  consistency; number sequence; edit, cancel, restore with audit; closed-month
  refusals (current and target month); Взнос appears on both pages and
  cancels on both; Salesdoc buyer payments split by payment type; supplier
  «Оплачено» and debt; history endpoints per page.
- Web: typecheck, lint; browser check of create / edit / cancel / restore on
  each page, the «История» button on every page that has it, ru and uz,
  390 px — against a second API (another port) and web started on
  `DATABASE_URL_TEST`, so no real money is entered in Supabase.
