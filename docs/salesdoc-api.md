# Salesdoc API V2 — notes for this project

Full docs: https://github.com/Clever91/salesdoc-api-doc (en + ru), Postman examples:
https://documenter.getpostman.com/view/140637/2sA2r3bSJ9. Client code:
`apps/api/src/salesdoc/salesdoc.client.ts`.

## Transport

- One endpoint: `POST https://{domain}/api/v2`, JSON body, the operation is `method`.
- Body: `{ method, auth: { userId, token }, filial?: { filial_id }, params?, data? }`.
- `login` with `{ auth: { login, password } }` returns `{ userId, token }`.
- **One token per device: a new login invalidates the previous token.** Use a
  dedicated Salesdoc user for this app, or our login will kick out whoever
  else (1C, another integration) uses the same account — and vice versa.
- Envelope: `{ status, result, pagination?, error?: { code, message, data } }`.
  Error codes: 400 data, 401 auth, 402 unknown method, 403 method disabled,
  407 too many records in a SET, 429 rate-limited.

## Reading

- Pagination: `params.limit` (default and max 1000) and `params.page`.
- `params.period: { from, to, by: "create" | "update" }` — incremental pulls.
- `params.filter.include: sd | 1c | all` works only in getClientCategory,
  getMovement, getVsExchange, getOrder, getConsumption.

## Identifiers

Every object carries `CS_id` (may have filial prefix, `F1-d0_123`), `SD_id`
(`d0_123`) and `code_1C`. Store all three; match on `SD_id`.

## Finance-relevant methods

| Need | Method | Result key |
|---|---|---|
| Sales documents, debts, due date (`debtDateExp`) | `getOrder` | `order` |
| Returns | `getOrderDefect` | `order` |
| Exchanges | `getOrderReplace` | check the doc |
| Payments | `getPayment` | `payment` |
| Payment types (the "currencies" money is split by) | `getPaymentType` | `currency` |
| Client balances (negative = debt), by currency | `getBalance` | `balance` |
| Cash income / expense with categories | `getConsumption` | `consumption` |
| Cashboxes | `getCashbox` | `cashbox` |
| Payment confirmations | `getPaymentConfirmation` | `paymentConfirmation` |
| Clients / agents / expeditors / supervisors | `getClient`, `getAgent`, `getExpeditor`, `getSupervisor` | `client`, `agent`, `expeditor`, `supervisor` |
| Territories | `getTerritory` | `region` |
| Currency types | `getValyutaType` | `valyutaType` |
| Filials | `getFilials` | `filials` |
| Write back payments / expenses / balances | `setPayment`, `setConsumption`, `setBalance`, `setCurrentBalance` | — |

**`getOrder` returns only status 1 (New) unless told otherwise**, and it
ignores `params.period`. Pass `filter.status: [1,2,3,4,5]` (New, Sent,
Delivered, Closed, Cancelled), `filter.agent: "all"` and
`filter.period.date: { from, to }` (`YYYY-MM-DD`). `debtDateExp` is
`1970-01-01` when no due date is set.

Result keys do not always match the method name — pass the right one to
`SalesdocClient.fetchAll(method, resultKey)`.

## Limits

- SET: at most 250 records per group in `data` (else 407).
- `setCurrentBalance`: 3 requests / 5 min. `getStockForDate`: 1 / 5 min.
  `setStock`: 5 / 5 s. `getStoreLog`: 5 / 5 s and only 20:00–07:00 server time.

## Contragent servers

Some instances run in "contragent" mode: the client is a salepoint, the
contragent is the legal entity that owns the money. There `getBalance`
returns balances per contragent. Detected by the server; we cannot change it.

## Findings from building the sync (29 Sep 2026)

- `getPayment` `filter.transactionType` is applied after paging: pages come
  back short and `page * limit >= total` stops early. Never filter by it.
- Payment `transactionType` 9 (shelf return) mirrors a return already in
  `getOrderDefect`; only type 3 is outlet cash.
- `params.sort` is ignored (ASC and DESC return the same order) on getOrder,
  getPayment, getPurchase, getOrderDefect.
- `getPurchase` and `getBalance` ignore `limit` and return everything on every
  page; dedupe by id.
- `filter.period.date` works (full pages) on getOrder, getOrderDefect,
  getPayment and getPurchase; `filter.period.dateUpdate` works for incremental
  pulls.

