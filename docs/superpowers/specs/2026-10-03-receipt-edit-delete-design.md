# Edit / delete приходные накладные, month closing, minimal login — design

Date: 3 Oct 2026 · Status: agreed in chat, awaiting spec review
Parent specs: `2026-09-29-distribution-finance-design.md`, `2026-10-01-zakupki-design.md`.

## 1. Purpose

Let staff correct приходные накладные while their month is open, keep a
trustworthy record of who changed what, and let a month be closed so its
receipts can no longer change.

Owner's decisions (chat, 3 Oct 2026):

- **Edit writes to Salesdoc** (`setPurchase`), so Salesdoc's document and stock
  change too.
- **Delete hides the receipt in our app only** — Salesdoc's API has no delete
  for receipts. It is reversible («Восстановить») while the month is open.
- **History** of every edit, delete, restore and month close/reopen: who,
  when, what, and the reason for a delete.
- **Minimal login**: named users with passwords the owner sets; no roles yet
  (every logged-in user may do everything; roles arrive with the roles plan).
- **Months are closed by hand** («Закрыть месяц» / «Открыть»), and closing or
  reopening is itself recorded.

Out of scope: roles and permissions, creating new receipts, editing orders,
payments or returns, deleting anything in Salesdoc.

## 2. Login

- Table `User`: `id`, `login` (unique, lower-case), `name`, `passwordHash`
  (Node `crypto.scrypt`, per-user salt), `active`, `createdAt`.
- Table `Session`: `id` (random 32-byte token, only its SHA-256 stored),
  `userId`, `createdAt`, `expiresAt` (30 days).
- Users are created on this computer by the owner:
  `npm run user:add -w @df/api` asks login, name and password (password typed
  hidden, twice). `npm run user:passwd` changes a password; `user:disable`
  turns a user off. No sign-up page.
- `POST /api/auth/login {login, password}` → sets httpOnly cookie
  `df_session` (SameSite=Lax); `POST /api/auth/logout`; `GET /api/auth/me`
  → `{id, login, name}`. Wrong login or password → 401 «Неверный логин или
  пароль», same message for both.
- **Every API route requires a session** except `GET /api/health` and
  `POST /api/auth/login`; without one → 401. The web server forwards the
  browser's cookie to the API on every call; a 401 sends the user to
  `/login`. The sidebar footer shows the user's name and «Выйти».
- The scheduled sync runs inside the API and needs no session.

## 3. Months

- Table `Month`: `month` (`YYYY-MM`, PK), `closed` (bool), `changedById`,
  `changedAt`. A month with no row is open.
- A receipt belongs to the month of its date (Tashkent wall time, as stored).
- Page **Настройки → «Закрытие месяца»** (`/settings/months`): one row per
  month from September 2026 to the current month: status «Открыт» /
  «Закрыт», who changed it and when, and a button «Закрыть» / «Открыть»
  (with a confirmation).
- `GET /api/months`, `POST /api/months/:month/close`,
  `POST /api/months/:month/open`.
- In a closed month the API refuses edit, delete and restore with 409
  «Месяц закрыт»; the web hides those buttons.

## 4. Edit a receipt

- Button «Редактировать» on the Накладная page, shown only when its month is
  open. Opens an edit form on the same page.
- Editable: склад (dropdown), поставщик (dropdown), дата (date picker
  limited to open months and to ≥ 1 Sep 2026), comment, and goods lines —
  product (searchable picker over Номенклатура), quantity (> 0), price (≥ 0);
  add and remove lines; at least one line.
- Each field shows its own error under it; «Сохранить» shows a spinner and
  is disabled while saving.
- `PUT /api/warehouse/purchases/:sdId` with
  `{ date, warehouseSdId, supplierSdId, comment, lines: [{productSdId, quantity, price}] }`:
  1. check the receipt exists, is not hidden, and both its current and new
     months are open (else 404 / 409);
  2. send `setPurchase` with `CS_id` = the stored `purchase_id`
     (`Purchase.csId`), `date`, `priceType` = the stored one (from `raw`),
     `store`, `shipper`, `comment`, `products` [{SD_id, quantity, price}];
  3. Salesdoc answers `completed: 1` → update our `Purchase` and its lines
     from what was sent (product names from `Product`, total = Σ quantity ×
     price) and write the audit entry; the next sync re-reads Salesdoc's
     version;
  4. Salesdoc answers an error → nothing changes here; 502 with Salesdoc's
     message, shown in the form.
- Before the feature is used on real data, the first `setPurchase` is tested
  by re-sending one existing receipt unchanged (owner approves that call).

## 5. Delete and restore

- Button «Удалить» (open month only) → dialog with a required reason →
  `DELETE /api/warehouse/purchases/:sdId {reason}`.
- Table `PurchaseHidden`: `purchaseSdId` (PK), `hiddenById`, `hiddenAt`,
  `reason`. The `Purchase` row stays (the sync keeps mirroring it); every
  read that sums or lists receipts excludes hidden ones: Приходные
  накладные, Поставщики, supplier statements, the Сверка summary.
- Приходные накладные gets a checkbox «Показать удалённые»: hidden receipts
  then appear struck through with «Удалена: <кто>, <когда>, <причина>» and a
  button «Восстановить» (open month only) →
  `POST /api/warehouse/purchases/:sdId/restore`.
- Opening a hidden receipt's page works; it shows a «Удалена» banner.

## 6. History

- Table `AuditLog`: `id`, `at`, `userId`, `action`
  (`purchase.edit`, `purchase.delete`, `purchase.restore`, `month.close`,
  `month.open`), `target` (receipt sdId or month), `reason`, `before` and
  `after` (JSON: header fields and lines for edits). Append-only: no API
  updates or deletes it.
- Накладная page: block «История» — date-time, user, action, reason; an edit
  row expands to show changed fields and lines (before → after).
- Months page: the same list filtered to month actions.
- `GET /api/warehouse/purchases/:sdId/history`, `GET /api/months/history`.

## 7. UI and language

All new words in ru and uz; shared Field, Select, DateField, CheckboxField,
Loader, Text, StickyToolbar; dialogs use the design system's dialog; every
button shows press feedback and a spinner while waiting.

## 8. Testing

- API: login (right/wrong password, disabled user, expired session), 401 on
  a protected route; months close/open + audit; edit (sends the right
  `setPurchase` body via a fake Salesdoc client, updates the copy, audit
  before/after, refused in a closed month — current or target, refused for
  a hidden receipt, Salesdoc error leaves data unchanged); delete/restore
  (hidden excluded from list, suppliers, statement and summary; reason
  required; audit); history order.
- Web: typecheck, lint, browser check of login, edit, delete, restore,
  month close at desktop and 390 px, ru and uz.
- One real `setPurchase` round-trip on an unchanged receipt, approved by the
  owner, before first use.
