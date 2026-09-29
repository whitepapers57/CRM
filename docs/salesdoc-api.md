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
