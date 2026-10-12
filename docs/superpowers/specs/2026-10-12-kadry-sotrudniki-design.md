# Кадры, part 1: Сотрудники — design

Date: 12 Oct 2026 · Status: agreed in chat, awaiting spec review
Parent: `2026-09-29-distribution-finance-design.md`. Reference for every field and screen:
`hr-crm-inventory.md` (the Goodland CRM's HR module, read from `origin/main` `ed12bcc`), §0 and §1.

## 1. Purpose

Rebuild the Goodland CRM's HR module in this app for the distribution company's own staff
(agents, expeditors, warehouse, office), section by section. This first part is the staff
register every later section hangs off: employees, departments, positions, dismissal reasons,
and the link between a person and the Salesdoc accounts they work under.

Owner's decisions (chat, 12 Oct 2026):

- **Distribution's own staff**, in this app's database, starting empty.
- **All seven CRM sections**, rebuilt in this stack (NestJS + Prisma + Next), one part at a
  time, in this order: 1 Сотрудники · 2 Посещаемость · 3 Зарплата · 4 Инвентарь ·
  5 Рекрутинг · 6 Онбординг · 7 Удержание. Each part has its own spec, plan and build.
- **No integrations**: no Face ID kiosk, Telegram bot, hh.ru, Goodland Academy, amoCRM.
- **Linked to Salesdoc**: Salesdoc's Andijan agents are *routes* («AND-AP-BEV-03 GOROD 1»),
  and its expeditors are partly people, partly placeholders («kassir», «A»), so cards are not
  created from Salesdoc; a person's card is **linked** to the Salesdoc account(s) they work under.
- **Sensitive data** (passport, PINFL, salary) is visible to every logged-in user for now;
  access control arrives with the roles plan.

Out of scope here: attendance, payroll, inventory, recruiting, onboarding, retention (parts 2–7);
Academy logins; my.mehnat.uz / diplom.edu.uz; photos and files; the CRM's empty
«Больничный лист» / «ГПХ» / «CV» placeholder tabs.

## 2. Data

All tables are new. Text fields are trimmed; empty strings are stored as NULL.

**`Department`** — `id`, `name` (unique, case-insensitive), `sortOrder` (int, default 0),
`headEmployeeId` (→ Employee, SET NULL), `createdAt`. No seeds.

**`Position`** — `id`, `departmentId` (→ Department, SET NULL), `name` (unique within its
department, case-insensitive; NULL department counts as one group), `description`, `sortOrder`,
`startTime` (`HH:MM`, nullable — arrival threshold, used by part 2), `workdays` (int[] of ISO
weekdays 1–7, nullable — used by part 2), `createdAt`.

**`TerminationReason`** — `id`, `label` (unique, case-insensitive), `sortOrder`, `active`
(default true), `createdAt`. Seeded: «По собственному желанию», «По соглашению сторон»,
«Истечение срока договора», «Несоответствие занимаемой должности», «Нарушение трудовой
дисциплины», «Сокращение штата».

**`Employee`**

| Field | Notes |
|---|---|
| `id` | uuid |
| `lastName`, `firstName`, `middleName` | last and first required |
| `name` | «Фамилия Имя Отчество», rebuilt on every save; what lists and pickers show |
| `phone`, `email` | |
| `birthDate`, `birthPlace`, `nationality`, `citizenship` | |
| `gender` | `male` / `female` («Мужской» / «Женский») |
| `passportSeries` | 2 letters, upper-cased |
| `passportNumber` | 7 digits |
| `passportIssuedBy`, `passportIssuedDate`, `passportValidUntil` | |
| `pinfl` | 14 digits, unique when set |
| `inn` | digits only |
| `address` | residence |
| `educationLevel` | `higher` / `incomplete_higher` / `specialized_secondary` / `secondary` / `incomplete_secondary` |
| `departmentId`, `positionId` | SET NULL on delete |
| `employmentType` | `TD` / `GPH` / `IP` / `SZ` (ТД / ГПХ / ИП / СЗ) |
| `remote` | bool, default false («Удалённый сотрудник» — part 2 leaves them out of attendance) |
| `workSchedule` | JSON `{ "1": { "start": "09:00", "end": "18:00" }, … }`, missing day = day off, NULL = use the position's |
| `rate` | decimal(4,2), default 1.00 |
| `salary` | bigint so'm, nullable |
| `hiredAt` | date |
| `orderNumber`, `orderDate` | hiring order |
| `experienceMonths` | prior experience, int ≥ 0 |
| `status` | `intern` / `active` / `terminated` (Стажёр / Активен / Уволен), default `active` |
| `terminatedAt`, `terminationReason` | set when dismissed; the reason is stored as text (copy of the label) |
| `createdAt`, `createdById` | |

**`EmployeeRelative`** (1:N, cascade) — `relation` (`spouse` / `mother` / `father` / `child` /
`sibling` / `other`: «Супруг(а)», «Мать», «Отец», «Ребёнок», «Брат/Сестра», «Другое»; required),
`fullName`, `birthDate`, `workplacePosition`, `residenceAddress`, `phone`.

**`EmployeeDiploma`** (1:N, cascade) — `degree` («Бакалавр», «Магистр», «Доктор», «Среднее»,
«Среднее спец.»), `institution`, `specialty`, `enrolledYear`, `graduatedYear`, `seriesNumber`,
`issuedDate`, `status` («Подтверждён» / «Не подтверждён»).

**`EmployeeSalesdocAccount`** — `kind` (`agent` / `expeditor` / `supervisor`), `sdId`,
`employeeId` (→ Employee, cascade), `linkedAt`, `linkedById`. Unique `(kind, sdId)`: an account
belongs to one person at a time; a person may hold several. No FK to the Salesdoc tables (the
sync recreates their rows).

**Supervisors** are synced like agents: new resource `supervisors` (`getSupervisor`, result key
`supervisor`) into a new table `Supervisor` (`sdId`, `csId`, `code1c`, `name`, `active`, `raw`,
`seenAt`).

## 3. Rules

- **Dismiss** («Уволить»): needs a reason from the active list; sets `status = terminated`,
  `terminatedAt = now`, `terminationReason` = its label. **Restore** («Восстановить»): back to
  `active`, clears both. **Make permanent** («Принять на постоянную работу», interns only):
  `intern → active`.
- **Delete** only while nothing refers to the employee (now: no Salesdoc links; later parts add
  their own checks), otherwise 409 «Нельзя удалить — за сотрудником есть связанные записи.
  Уволь его вместо удаления, чтобы сохранить историю.»
- **Department delete** refused while it has employees: «Нельзя удалить — в отделе N
  сотрудник(ов). Переведите их в другой отдел или снимите назначение.» **Position delete**
  refused likewise: «Нельзя удалить — на этой должности N сотрудник(ов). …»
- Duplicates get friendly messages, not database errors: «Отдел с таким названием уже есть»,
  «Такая должность в этом отделе уже есть», «Сотрудник с таким ПИНФЛ уже есть», «Такая причина
  уже есть».
- **Salesdoc link**: linking an account already linked to someone else is refused with «Эта
  учётная запись уже привязана к <ФИО>»; unlinking is allowed any time. An account that
  disappeared from Salesdoc stays linked and shows «нет в Salesdoc».
- **Work schedule** (same validation as the CRM): «Отметьте рабочие дни», «Укажите время»,
  «Конец должен быть позже начала».
- **Metrics** (on non-terminated staff): headcount; average age; gender split; average tenure
  from `hiredAt`; 12-month turnover = dismissed in the last 12 months ÷ ((begin + current) / 2),
  begin = current − hired in 12 months + dismissed in 12 months.
- **History**: every create, edit, status change, delete and Salesdoc link change of employees,
  departments, positions and reasons goes to the append-only `AuditLog` (actions `hr.*`,
  target = the record's id; before/after for edits).

## 4. Pages

Sidebar: new section **«Кадры»** (after Деньги) opening a 1C-style panel (`SectionPanel`):

- **Кадры:** Сотрудники, Подразделения и должности, Причины увольнения, Учётные записи Salesdoc
- **Later parts** (placeholder pages, own routes): Посещаемость, Зарплата, Инвентарь,
  Рекрутинг, Онбординг, Удержание
- the **birthdays widget** under the panel: active staff whose birthday is later this month —
  «сегодня», «через N дней», the age they turn; «Ближайших дней рождения в этом месяце нет».

Routes under `/kadry/…`. Every nested page has the back arrow; every form has «Отмена».

**Сотрудники** (`/kadry/sotrudniki`): metrics bar (5 cards); filter by department and
position; search «Поиск по ФИО, должности, ПИНФЛ, телефону»; status «Работают» / «Уволены» /
«Все» (default Работают); «Создать сотрудника»; «История». Columns: №, Должность, Фамилия
(+ «Стажёр» badge), Имя, Отчество, Тип занятости, Дата приёма, Salesdoc (linked accounts).
Row → card.

**Employee card** (`/kadry/sotrudniki/<id>`): header with initials, full name, status badge,
dismissed banner «Уволен · <date> · <reason>», actions «Принять на постоянную работу» (interns),
«Уволить» / «Восстановить», «Удалить», «История». Tabs:

- **Трудовая книжка** — Отдел, Должность, Тип занятости, Удалённый, График работы
  («Пн 09:00–18:00…» or «По должности»), Ставка, Оклад, Дата приёма, Номер и дата приказа,
  Общий стаж; «Редактировать».
- **Личные данные** — name parts, birth, gender, citizenship, nationality, passport, PINFL,
  INN, address, phone, email, education level; «Редактировать».
- **Образование** — diplomas table, add / edit / delete.
- **Родственники** — relatives table, add / edit / delete.
- **Salesdoc** — linked accounts (kind, name, «нет в Salesdoc» if gone), «Привязать» (pick from
  unlinked agents / expeditors / supervisors), «Отвязать».

**Create employee** (`/kadry/sotrudniki/new`): ФИО, ПИНФЛ, ИНН, then the Трудовая книжка
fields (status Стажёр or Активен; hire date and order date default to today).

**Подразделения и должности** (`/kadry/struktura`): departments (name, sort, head, employee
count) and positions (name, department, arrival time, workdays, description, employee count),
each with add / edit / delete.

**Причины увольнения** (`/kadry/prichiny`): list with add, rename, hide/show, sort order.

**Учётные записи Salesdoc** (`/kadry/salesdoc`): every synced agent / expeditor / supervisor
with the person it is linked to, or «Не привязана» and a «Привязать» picker of employees.

All words in ru and uz; phone width without horizontal page scroll; forms follow the house rules
(errors under each field, spinner while saving).

## 5. API

Under `/api/kadry/…`, all behind the session guard: employees (list with filters, get, create,
update, `status` change, dismiss, restore, delete), relatives and diplomas (nested CRUD),
Salesdoc links (link, unlink, list of accounts with their person), departments, positions,
termination reasons (CRUD), metrics, birthdays, history per page and per record.

## 6. Testing

- API: validation of every field rule above (name parts, passport, PINFL uniqueness, schedule,
  gender, employment type); dismiss / restore / make permanent; delete refused when linked;
  department / position delete refused while used; duplicate names → friendly 409/400;
  Salesdoc link uniqueness and unlink; supervisor sync mapping; metrics and turnover with fixed
  dates; birthdays across month ends; audit entries for each action.
- Web: typecheck, lint, browser check of create / edit / dismiss / restore / link on a test
  instance (test database, separate ports, stopped right after); ru, uz, 390 px.
