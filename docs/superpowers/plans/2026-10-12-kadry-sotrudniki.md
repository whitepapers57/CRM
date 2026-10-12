# Кадры part 1 — Сотрудники Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A staff register for the distribution company — employees with their personal and workplace data, relatives and diplomas, departments, positions, dismissal reasons, and links to the Salesdoc accounts each person works under — under a new sidebar section «Кадры».

**Architecture:** A new NestJS module `kadry` owns four services: `StructureService` (departments, positions, reasons), `EmployeesService` (cards, relatives, diplomas, status changes), `SalesdocLinksService` (accounts ↔ people) and `KadryStatsService` (metrics, birthdays). Input rules live in one pure file (`employee-rules.ts`) mirrored on the web (`lib/kadry-rules.ts`). Every write goes to the append-only `AuditLog` under `hr.*`. Supervisors join the Salesdoc sync. The web adds `/kadry/…` pages in the existing 1C-panel pattern.

**Tech Stack:** NestJS 12 + Prisma 7 (Postgres on Supabase; tests on local `DATABASE_URL_TEST`), vitest; Next.js 16 server components + server actions, Tailwind 4, shadcn/Base UI; ru/uz messages.

**Spec:** `docs/superpowers/specs/2026-10-12-kadry-sotrudniki-design.md` (field and screen reference: `docs/superpowers/specs/hr-crm-inventory.md` §1)

## Global Constraints

- Distribution's own staff; no Face ID kiosk, Telegram, hh.ru, Goodland Academy or amoCRM anything.
- Sensitive data (passport, PINFL, salary) is visible to every logged-in user (owner's decision, 12 Oct 2026).
- Cards are never created from Salesdoc; a person is **linked** to Salesdoc accounts (`agent` / `expeditor` / `supervisor`); one account belongs to one person at a time.
- Text fields are trimmed; empty strings are stored as NULL. Days are `YYYY-MM-DD`, compared in Tashkent time (`tashkentDay`).
- Passport series = 2 letters (upper-cased), number = 7 digits; PINFL = 14 digits, unique when set; INN digits only.
- Status `intern` / `active` / `terminated`; delete only while nothing refers to the employee; otherwise dismiss.
- Every create / edit / status change / delete / link change goes to `AuditLog` (actions `hr.*`), append-only.
- Every user-visible word has ru and uz in `apps/web/src/i18n/messages.ts`, same key order.
- Each form error shows under its own field; buttons give press feedback (`active:scale-95`) and a spinner while waiting; every nested page has the back arrow (`PageHeader back=…`); every form has «Отмена».
- Superseded code is commented out with a dated note, never deleted. LF line endings; write files from Python with `newline='\n'`.
- Migrations: `DATABASE_URL="$DATABASE_URL_LOCAL" npx prisma migrate dev --create-only --name <n>` in `apps/api`, edit, `DATABASE_URL="$DATABASE_URL_LOCAL" npx prisma migrate dev`, `npx prisma generate`; `npx prisma migrate deploy` for Supabase. Never `migrate reset`.
- Never write test data into the live Supabase database from a browser or script.

## Review Focus

- **Two departments named «Склад» and «склад »** must be refused as duplicates (case and spaces ignored), not create two — Task 2 test `refuses duplicate names regardless of case and spaces`.
- **A Salesdoc account already linked to Иванов linked again to Петров** must be refused with Иванов's name, and unlinking then relinking must work — Task 4 test `one account belongs to one person at a time`.
- **Dismissing an already dismissed employee, restoring an active one, making a non-intern permanent** must each give a clear 409, not silently change dates — Task 3 test `refuses status changes that do not apply`.
- **Birthdays at the end of December and on 29 February** must not crash or list wrong people — Task 4 test `lists birthdays later this month, including 29 February in a non-leap year`.
- **An employee dismissed and re-hired inside the last 12 months** must not make turnover negative or above 100% for one person — Task 4 test `turnover stays within 0–100 for small staff`.

---

## File structure

API (`apps/api`):
- `prisma/schema.prisma` — `Department`, `Position`, `TerminationReason`, `Employee`, `EmployeeRelative`, `EmployeeDiploma`, `EmployeeSalesdocAccount`, `Supervisor`.
- `src/sync/mappers.ts`, `src/sync/resources.ts` — supervisors resource.
- `src/audit/audit.service.ts`, `src/audit/audit.controller.ts` — `hr.*` actions.
- `src/kadry/employee-rules.ts` — pure input rules (validation + normalisation).
- `src/kadry/structure.service.ts` — departments, positions, reasons.
- `src/kadry/employees.service.ts` — employees, relatives, diplomas, status changes.
- `src/kadry/salesdoc-links.service.ts` — Salesdoc accounts and links.
- `src/kadry/kadry-stats.service.ts` — metrics, birthdays.
- `src/kadry/kadry.controller.ts`, `src/kadry/kadry.module.ts`.

Web (`apps/web/src`):
- `lib/kadry-menu.ts`, `lib/kadry-rules.ts` (+ `.test.ts`), `lib/api.ts` (types).
- `app/kadry/page.tsx` (panel + birthdays), `app/kadry/[section]/page.tsx` (placeholders for parts 2–7).
- `app/kadry/struktura/…`, `app/kadry/prichiny/…`, `app/kadry/salesdoc/…`.
- `app/kadry/sotrudniki/page.tsx` (list), `app/kadry/sotrudniki/new/page.tsx`, `app/kadry/sotrudniki/[id]/page.tsx` (card), `app/kadry/sotrudniki/[id]/edit/page.tsx`, `app/kadry/sotrudniki/[id]/lichnye/page.tsx`, shared client forms in `app/kadry/sotrudniki/…`.
- `app/kadry/actions.ts` (server actions), `app/layout.tsx` (sidebar), `i18n/messages.ts`.

---

### Task 1: Schema, migration, supervisors in the sync, `hr.*` audit actions

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/sync/mappers.ts`, `apps/api/src/sync/resources.ts`, `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/audit.controller.ts`
- Create: migration `…_kadry` (generated + seed SQL)
- Test: `apps/api/src/kadry/schema.spec.ts`, `apps/api/src/sync/resources.spec.ts`, `apps/api/src/sync/mappers.spec.ts`

**Interfaces:**
- Produces: the Prisma models below; `mapSupervisor(r, seenAt)`; sync resource `supervisors`; `AuditAction` gains the `hr.*` union below; `AuditController` accepts `actionPrefix=hr.`.

- [ ] **Step 1: Failing tests**

`apps/api/src/kadry/schema.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';

const db = createTestDb();

describe('kadry schema', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('keeps department names unique by key and links people, relatives, diplomas and accounts', async () => {
    const d = await db.department.create({ data: { name: 'Склад', nameKey: 'склад' } });
    await expect(db.department.create({ data: { name: 'склад', nameKey: 'склад' } })).rejects.toThrow();
    const p = await db.position.create({ data: { name: 'Кладовщик', nameKey: 'кладовщик', groupKey: d.id, departmentId: d.id, workdays: [1, 2, 3, 4, 5, 6] } });
    const e = await db.employee.create({
      data: { lastName: 'Нишонов', firstName: 'Шоядбек', name: 'Нишонов Шоядбек', departmentId: d.id, positionId: p.id, createdById: 'u1', rate: '1.00', salary: 6000000, hiredAt: new Date('2026-09-01') },
    });
    expect(e.status).toBe('active');
    expect(e.remote).toBe(false);
    await db.employeeRelative.create({ data: { employeeId: e.id, relation: 'mother', fullName: 'Нишонова Мухаббат' } });
    await db.employeeDiploma.create({ data: { employeeId: e.id, degree: 'Бакалавр', institution: 'АндГУ' } });
    await db.employeeSalesdocAccount.create({ data: { kind: 'expeditor', sdId: 'd0_5', employeeId: e.id, linkedById: 'u1' } });
    await expect(db.employeeSalesdocAccount.create({ data: { kind: 'expeditor', sdId: 'd0_5', employeeId: e.id, linkedById: 'u1' } })).rejects.toThrow();
    await db.employee.delete({ where: { id: e.id } });
    expect(await db.employeeRelative.count()).toBe(0);
    expect(await db.employeeDiploma.count()).toBe(0);
    expect(await db.employeeSalesdocAccount.count()).toBe(0);
  });

  it('allows one PINFL per person and many people without one', async () => {
    const base = { createdById: 'u1' };
    await db.employee.create({ data: { ...base, lastName: 'А', firstName: 'Б', name: 'А Б', pinfl: '12345678901234' } });
    await expect(db.employee.create({ data: { ...base, lastName: 'В', firstName: 'Г', name: 'В Г', pinfl: '12345678901234' } })).rejects.toThrow();
    await db.employee.create({ data: { ...base, lastName: 'Д', firstName: 'Е', name: 'Д Е' } });
    await db.employee.create({ data: { ...base, lastName: 'Ж', firstName: 'З', name: 'Ж З' } });
    expect(await db.employee.count()).toBe(3);
  });
});
```

Append to `apps/api/src/sync/mappers.spec.ts` (import `mapSupervisor` with the other mappers):

```ts
  it('maps a supervisor like an agent', () => {
    const s = mapSupervisor({ SD_id: 'd0_30', CS_id: 'F5-d0_30', code_1C: null, name: 'Супервайзер Андижан', active: 'Y', agents: [{ SD_id: 'd0_1' }] }, seenAt);
    expect(s).toMatchObject({ sdId: 'd0_30', csId: 'F5-d0_30', name: 'Супервайзер Андижан', active: true });
  });
```

(If `seenAt` is not defined at the top of `mappers.spec.ts`, use `new Date('2026-10-12T00:00:00Z')`.)

In `apps/api/src/sync/resources.spec.ts`, add `'supervisors'` to the expected names in `lists resources with reference data before documents`, and add:

```ts
  it('syncs supervisors from getSupervisor before documents', () => {
    expect(byName('supervisors')).toMatchObject({ method: 'getSupervisor', resultKey: 'supervisor', mode: 'replace' });
    const names = RESOURCES.map((r) => r.name);
    expect(names.indexOf('supervisors')).toBeLessThan(names.indexOf('purchases'));
  });
```

- [ ] **Step 2: Run** — `cd apps/api && npx vitest run src/kadry/schema.spec.ts src/sync` · Expected: FAIL (`db.department` undefined; `mapSupervisor` not exported; no `supervisors` resource).

- [ ] **Step 3: Schema** — append to `schema.prisma`:

```prisma
/// Кадры: a department. nameKey = lower(trim(name)): names are unique whatever the case.
model Department {
  id             String     @id @default(uuid())
  name           String
  nameKey        String     @unique
  sortOrder      Int        @default(0)
  headEmployeeId String?
  head           Employee?  @relation("DepartmentHead", fields: [headEmployeeId], references: [id], onDelete: SetNull)
  positions      Position[]
  employees      Employee[] @relation("EmployeeDepartment")
  createdAt      DateTime   @default(now())
}

/// Кадры: a position. groupKey = departmentId or "-", so a name is unique within one department.
model Position {
  id           String      @id @default(uuid())
  departmentId String?
  department   Department? @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  groupKey     String
  name         String
  nameKey      String
  description  String?
  sortOrder    Int         @default(0)
  /// "HH:MM" — arrival threshold (Кадры part 2).
  startTime    String?
  /// ISO weekdays 1–7; empty = not set (part 2 falls back to the global rule).
  workdays     Int[]       @default([])
  employees    Employee[]
  createdAt    DateTime    @default(now())

  @@unique([groupKey, nameKey])
}

model TerminationReason {
  id        String   @id @default(uuid())
  label     String
  labelKey  String   @unique
  sortOrder Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
}

/// Кадры: one person on the staff (spec §2).
model Employee {
  id                 String                    @id @default(uuid())
  lastName           String
  firstName          String
  middleName         String?
  /// «Фамилия Имя Отчество», rebuilt on every save.
  name               String
  phone              String?
  email              String?
  birthDate          DateTime?                 @db.Date
  birthPlace         String?
  nationality        String?
  citizenship        String?
  /// "male" | "female"
  gender             String?
  passportSeries     String?
  passportNumber     String?
  passportIssuedBy   String?
  passportIssuedDate DateTime?                 @db.Date
  passportValidUntil DateTime?                 @db.Date
  pinfl              String?                   @unique
  inn                String?
  address            String?
  /// higher | incomplete_higher | specialized_secondary | secondary | incomplete_secondary
  educationLevel     String?
  departmentId       String?
  department         Department?               @relation("EmployeeDepartment", fields: [departmentId], references: [id], onDelete: SetNull)
  positionId         String?
  position           Position?                 @relation(fields: [positionId], references: [id], onDelete: SetNull)
  /// TD | GPH | IP | SZ
  employmentType     String?
  remote             Boolean                   @default(false)
  /// { "1": { "start": "09:00", "end": "18:00" }, … }; NULL = the position's schedule.
  workSchedule       Json?
  rate               Decimal                   @default(1) @db.Decimal(4, 2)
  /// so'm
  salary             Int?
  hiredAt            DateTime?                 @db.Date
  orderNumber        String?
  orderDate          DateTime?                 @db.Date
  experienceMonths   Int?
  /// intern | active | terminated
  status             String                    @default("active")
  terminatedAt       DateTime?
  terminationReason  String?
  createdAt          DateTime                  @default(now())
  createdById        String
  relatives          EmployeeRelative[]
  diplomas           EmployeeDiploma[]
  salesdocAccounts   EmployeeSalesdocAccount[]
  headOf             Department[]              @relation("DepartmentHead")

  @@index([status])
  @@index([departmentId])
  @@index([positionId])
}

model EmployeeRelative {
  id                String    @id @default(uuid())
  employeeId        String
  employee          Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  /// spouse | mother | father | child | sibling | other
  relation          String
  fullName          String?
  birthDate         DateTime? @db.Date
  workplacePosition String?
  residenceAddress  String?
  phone             String?
  createdAt         DateTime  @default(now())

  @@index([employeeId])
}

model EmployeeDiploma {
  id            String    @id @default(uuid())
  employeeId    String
  employee      Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  degree        String?
  institution   String?
  specialty     String?
  enrolledYear  Int?
  graduatedYear Int?
  seriesNumber  String?
  issuedDate    DateTime? @db.Date
  status        String?
  createdAt     DateTime  @default(now())

  @@index([employeeId])
}

/// A Salesdoc account (route / expeditor / supervisor) a person works under. No FK to the synced tables: the sync recreates their rows.
model EmployeeSalesdocAccount {
  /// agent | expeditor | supervisor
  kind       String
  sdId       String
  employeeId String
  employee   Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  linkedAt   DateTime @default(now())
  linkedById String

  @@id([kind, sdId])
  @@index([employeeId])
}

model Supervisor {
  sdId   String   @id
  csId   String?
  code1c String?
  name   String
  active Boolean
  raw    Json
  seenAt DateTime
}
```

Create the migration without applying: `cd apps/api && DATABASE_URL="$DATABASE_URL_LOCAL" npx prisma migrate dev --create-only --name kadry` (bash: `export $(grep DATABASE_URL_LOCAL .env | xargs)` first). Append to the generated `migration.sql`:

```sql
INSERT INTO "TerminationReason" ("id", "label", "labelKey", "sortOrder") VALUES
  (gen_random_uuid()::text, 'По собственному желанию', 'по собственному желанию', 1),
  (gen_random_uuid()::text, 'По соглашению сторон', 'по соглашению сторон', 2),
  (gen_random_uuid()::text, 'Истечение срока договора', 'истечение срока договора', 3),
  (gen_random_uuid()::text, 'Несоответствие занимаемой должности', 'несоответствие занимаемой должности', 4),
  (gen_random_uuid()::text, 'Нарушение трудовой дисциплины', 'нарушение трудовой дисциплины', 5),
  (gen_random_uuid()::text, 'Сокращение штата', 'сокращение штата', 6);
```

Apply locally: `DATABASE_URL="$DATABASE_URL_LOCAL" npx prisma migrate dev`, then `npx prisma generate` (Prisma 7's migrate does not regenerate the client).

- [ ] **Step 4: Supervisors in the sync** — `src/sync/mappers.ts`: `export const mapSupervisor = (r: Raw, seenAt: Date) => base(r, seenAt);`. `src/sync/resources.ts`: add `supervisor: tx.supervisor as unknown as FlatModel,` to `m(tx)`, import `mapSupervisor`, and add `flat('supervisors', 'getSupervisor', 'supervisor', 'supervisor', mapSupervisor),` right after the `expeditors` line.

- [ ] **Step 5: Audit actions** — `src/audit/audit.service.ts`:

```ts
export type AuditAction =
  | 'purchase.edit' | 'purchase.delete' | 'purchase.restore'
  | 'month.close' | 'month.open'
  | 'cash.create' | 'cash.edit' | 'cash.cancel' | 'cash.restore'
  | 'hr.emp.create' | 'hr.emp.edit' | 'hr.emp.dismiss' | 'hr.emp.restore' | 'hr.emp.make_permanent' | 'hr.emp.delete'
  | 'hr.emp.relative.save' | 'hr.emp.relative.delete' | 'hr.emp.diploma.save' | 'hr.emp.diploma.delete'
  | 'hr.emp.salesdoc.link' | 'hr.emp.salesdoc.unlink'
  | 'hr.struct.department.save' | 'hr.struct.department.delete' | 'hr.struct.position.save' | 'hr.struct.position.delete'
  | 'hr.reason.save';
```

Employee-related actions use target = employee id (so a card's history includes its relatives, diplomas and links); department / position / reason actions use their own id. `src/audit/audit.controller.ts`: `const PREFIXES = ['purchase.', 'month.', 'cash.', 'hr.emp.', 'hr.struct.', 'hr.reason.'];`

- [ ] **Step 6: Run** — `npx vitest run src/kadry/schema.spec.ts src/sync` · Expected: PASS. `npx tsc --noEmit -p tsconfig.json` · Expected: no output. Full suite `npx vitest run` · Expected: all pass.

- [ ] **Step 7: Supabase** — `npx prisma migrate deploy` · Expected: «1 migration applied».

- [ ] **Step 8: Commit** — `git add apps/api && git commit -m "feat(api): Кадры schema, supervisors in the sync, hr audit actions"`

---

### Task 2: Departments, positions, dismissal reasons

**Files:**
- Create: `apps/api/src/kadry/structure.service.ts`, `apps/api/src/kadry/structure.service.spec.ts`, `apps/api/src/kadry/kadry.controller.ts`, `apps/api/src/kadry/kadry.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/app.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuditService.record(db, …)`, `AuthUser`.
- Produces:
  - `StructureService.structure(): Promise<{ departments: DeptRow[]; positions: PosRow[] }>` where `DeptRow = { id, name, sortOrder, headEmployeeId, headName, employeeCount }`, `PosRow = { id, name, departmentId, departmentName, description, sortOrder, startTime, workdays, employeeCount }` (counts = non-terminated employees); sorted by `sortOrder` then name ('ru').
  - `saveDepartment(id | null, { name, sortOrder?, headEmployeeId? }, user) → { id }`, `deleteDepartment(id, user)`.
  - `savePosition(id | null, { name, departmentId?, description?, sortOrder?, startTime?, workdays? }, user) → { id }`, `deletePosition(id, user)`.
  - `reasons(): Promise<Array<{ id, label, sortOrder, active }>>`, `saveReason(id | null, { label, sortOrder?, active? }, user) → { id }`.
  - `nameKey(s) = s.trim().replace(/\s+/g, ' ').toLowerCase()`.
  - Routes (controller prefix `kadry`): `GET structure`, `POST departments`, `PUT departments/:id`, `DELETE departments/:id`, `POST positions`, `PUT positions/:id`, `DELETE positions/:id`, `GET reasons`, `POST reasons`, `PUT reasons/:id`.
  - Errors: 400 «Введите название», «Неверное время» (startTime not HH:MM), «Неверные рабочие дни» (workdays not distinct 1–7), «Отдел не найден», «Сотрудник не найден» (head); 409 «Отдел с таким названием уже есть», «Такая должность в этом отделе уже есть», «Такая причина уже есть», «Нельзя удалить — в отделе N сотрудник(ов). Переведите их в другой отдел или снимите назначение.», «Нельзя удалить — в отделе N должност(ей). Перенесите их в другой отдел или удалите.», «Нельзя удалить — на этой должности N сотрудник(ов). Переведите их на другую должность или снимите её.»; 404 «Не найдено».

- [ ] **Step 1: Failing test** — `structure.service.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { StructureService } from './structure.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const svc = new StructureService(db, audit);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const emp = (id: string, departmentId: string | null, positionId: string | null, status = 'active') =>
  db.employee.create({ data: { id, lastName: id, firstName: 'И', name: `${id} И`, departmentId, positionId, status, createdById: 'u1' } });

describe('StructureService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('creates departments and positions, counts working staff and shows the head', async () => {
    const sklad = await svc.saveDepartment(null, { name: '  Склад ', sortOrder: 2 }, user);
    const ofis = await svc.saveDepartment(null, { name: 'Офис', sortOrder: 1 }, user);
    const kl = await svc.savePosition(null, { name: 'Кладовщик', departmentId: sklad.id, startTime: '08:00', workdays: [6, 1, 2, 3, 4, 5] }, user);
    await emp('e1', sklad.id, kl.id);
    await emp('e2', sklad.id, kl.id, 'terminated');
    await svc.saveDepartment(sklad.id, { name: 'Склад', sortOrder: 2, headEmployeeId: 'e1' }, user);
    const s = await svc.structure();
    expect(s.departments.map((d) => [d.name, d.employeeCount, d.headName])).toEqual([['Офис', 0, null], ['Склад', 1, 'e1 И']]);
    expect(s.positions).toEqual([expect.objectContaining({ name: 'Кладовщик', departmentName: 'Склад', startTime: '08:00', workdays: [1, 2, 3, 4, 5, 6], employeeCount: 1 })]);
    expect(ofis.id).toBeTruthy();
  });

  it('refuses duplicate names regardless of case and spaces', async () => {
    const a = await svc.saveDepartment(null, { name: 'Склад' }, user);
    await expect(svc.saveDepartment(null, { name: '  склад ' }, user)).rejects.toThrow('Отдел с таким названием уже есть');
    await svc.savePosition(null, { name: 'Водитель', departmentId: a.id }, user);
    await expect(svc.savePosition(null, { name: 'водитель', departmentId: a.id }, user)).rejects.toThrow('Такая должность в этом отделе уже есть');
    await expect(svc.savePosition(null, { name: 'Водитель' }, user)).resolves.toBeTruthy(); // another group: no department
    await svc.saveReason(null, { label: 'Переезд' }, user);
    await expect(svc.saveReason(null, { label: 'ПЕРЕЕЗД' }, user)).rejects.toThrow('Такая причина уже есть');
  });

  it('validates names, times and weekdays', async () => {
    await expect(svc.saveDepartment(null, { name: ' ' }, user)).rejects.toThrow('Введите название');
    await expect(svc.savePosition(null, { name: 'X', startTime: '25:00' }, user)).rejects.toThrow('Неверное время');
    await expect(svc.savePosition(null, { name: 'X', workdays: [0] }, user)).rejects.toThrow('Неверные рабочие дни');
    await expect(svc.savePosition(null, { name: 'X', workdays: [1, 1] }, user)).rejects.toThrow('Неверные рабочие дни');
    await expect(svc.savePosition(null, { name: 'X', departmentId: 'nope' }, user)).rejects.toThrow('Отдел не найден');
    await expect(svc.saveDepartment(null, { name: 'Y', headEmployeeId: 'nope' }, user)).rejects.toThrow('Сотрудник не найден');
  });

  it('refuses deleting what is in use', async () => {
    const d = await svc.saveDepartment(null, { name: 'Склад' }, user);
    const p = await svc.savePosition(null, { name: 'Кладовщик', departmentId: d.id }, user);
    await expect(svc.deleteDepartment(d.id, user)).rejects.toThrow('в отделе 1 должност');
    await emp('e1', null, p.id, 'terminated');
    await expect(svc.deletePosition(p.id, user)).rejects.toThrow('на этой должности 1 сотрудник');
    await db.employee.update({ where: { id: 'e1' }, data: { positionId: null, departmentId: d.id } });
    await svc.deletePosition(p.id, user);
    await expect(svc.deleteDepartment(d.id, user)).rejects.toThrow('в отделе 1 сотрудник');
    await db.employee.update({ where: { id: 'e1' }, data: { departmentId: null } });
    await svc.deleteDepartment(d.id, user);
    expect((await svc.structure()).departments).toEqual([]);
    await expect(svc.deleteDepartment(d.id, user)).rejects.toThrow('Не найдено');
  });

  it('hides and renames reasons, sorted, with history', async () => {
    const r = await svc.saveReason(null, { label: 'Переезд', sortOrder: 9 }, user);
    await svc.saveReason(r.id, { label: 'Переезд в другой город', sortOrder: 9, active: false }, user);
    expect(await svc.reasons()).toEqual([expect.objectContaining({ label: 'Переезд в другой город', active: false })]);
    expect((await audit.list({ target: r.id })).map((e) => e.action)).toEqual(['hr.reason.save', 'hr.reason.save']);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/kadry/structure.service.spec.ts` · Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `structure.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';

export const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (s: unknown) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '');
const opt = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim() : null);
const byOrder = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru');
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Кадры reference lists: departments, positions, dismissal reasons (spec §2–3). */
@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async structure() {
    const [departments, positions, counts] = await Promise.all([
      this.prisma.department.findMany({ include: { head: { select: { name: true } } } }),
      this.prisma.position.findMany({ include: { department: { select: { name: true } } } }),
      this.prisma.employee.findMany({ where: { status: { not: 'terminated' } }, select: { departmentId: true, positionId: true } }),
    ]);
    const count = (key: 'departmentId' | 'positionId', id: string) => counts.filter((c) => c[key] === id).length;
    return {
      departments: departments
        .map((d) => ({ id: d.id, name: d.name, sortOrder: d.sortOrder, headEmployeeId: d.headEmployeeId, headName: d.head?.name ?? null, employeeCount: count('departmentId', d.id) }))
        .sort(byOrder),
      positions: positions
        .map((p) => ({
          id: p.id, name: p.name, departmentId: p.departmentId, departmentName: p.department?.name ?? null, description: p.description,
          sortOrder: p.sortOrder, startTime: p.startTime, workdays: [...p.workdays].sort((a, b) => a - b), employeeCount: count('positionId', p.id),
        }))
        .sort(byOrder),
    };
  }

  async saveDepartment(id: string | null, input: { name?: string; sortOrder?: number; headEmployeeId?: string | null }, user: AuthUser) {
    const name = clean(input?.name);
    if (!name) throw new BadRequestException('Введите название');
    const headEmployeeId = opt(input?.headEmployeeId);
    if (headEmployeeId && !(await this.prisma.employee.findUnique({ where: { id: headEmployeeId } }))) throw new BadRequestException('Сотрудник не найден');
    const data = { name, nameKey: nameKey(name), sortOrder: Math.trunc(Number(input?.sortOrder) || 0), headEmployeeId };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.department.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundException('Не найдено');
        const d = id ? await tx.department.update({ where: { id }, data }) : await tx.department.create({ data });
        await this.audit.record(tx, { user, action: 'hr.struct.department.save', target: d.id, before: before ?? undefined, after: d });
        return { id: d.id };
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Отдел с таким названием уже есть');
      throw e;
    }
  }

  async deleteDepartment(id: string, user: AuthUser) {
    const d = await this.prisma.department.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Не найдено');
    const people = await this.prisma.employee.count({ where: { departmentId: id } });
    if (people) throw new ConflictException(`Нельзя удалить — в отделе ${people} сотрудник(ов). Переведите их в другой отдел или снимите назначение.`);
    const positions = await this.prisma.position.count({ where: { departmentId: id } });
    if (positions) throw new ConflictException(`Нельзя удалить — в отделе ${positions} должност(ей). Перенесите их в другой отдел или удалите.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.department.delete({ where: { id } });
      await this.audit.record(tx, { user, action: 'hr.struct.department.delete', target: id, before: d });
    });
  }

  async savePosition(
    id: string | null,
    input: { name?: string; departmentId?: string | null; description?: string | null; sortOrder?: number; startTime?: string | null; workdays?: number[] },
    user: AuthUser,
  ) {
    const name = clean(input?.name);
    if (!name) throw new BadRequestException('Введите название');
    const departmentId = opt(input?.departmentId);
    if (departmentId && !(await this.prisma.department.findUnique({ where: { id: departmentId } }))) throw new BadRequestException('Отдел не найден');
    const startTime = opt(input?.startTime);
    if (startTime && !TIME.test(startTime)) throw new BadRequestException('Неверное время');
    const workdays = input?.workdays ?? [];
    if (!Array.isArray(workdays) || workdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7) || new Set(workdays).size !== workdays.length) {
      throw new BadRequestException('Неверные рабочие дни');
    }
    const data = {
      name, nameKey: nameKey(name), departmentId, groupKey: departmentId ?? '-', description: opt(input?.description),
      sortOrder: Math.trunc(Number(input?.sortOrder) || 0), startTime, workdays: [...workdays].sort((a, b) => a - b),
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.position.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundException('Не найдено');
        const p = id ? await tx.position.update({ where: { id }, data }) : await tx.position.create({ data });
        await this.audit.record(tx, { user, action: 'hr.struct.position.save', target: p.id, before: before ?? undefined, after: p });
        return { id: p.id };
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Такая должность в этом отделе уже есть');
      throw e;
    }
  }

  async deletePosition(id: string, user: AuthUser) {
    const p = await this.prisma.position.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Не найдено');
    const people = await this.prisma.employee.count({ where: { positionId: id } });
    if (people) throw new ConflictException(`Нельзя удалить — на этой должности ${people} сотрудник(ов). Переведите их на другую должность или снимите её.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.position.delete({ where: { id } });
      await this.audit.record(tx, { user, action: 'hr.struct.position.delete', target: id, before: p });
    });
  }

  async reasons() {
    const rows = await this.prisma.terminationReason.findMany({ select: { id: true, label: true, sortOrder: true, active: true } });
    return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ru'));
  }

  async saveReason(id: string | null, input: { label?: string; sortOrder?: number; active?: boolean }, user: AuthUser) {
    const label = clean(input?.label);
    if (!label) throw new BadRequestException('Введите название');
    const data = { label, labelKey: nameKey(label), sortOrder: Math.trunc(Number(input?.sortOrder) || 0), active: input?.active ?? true };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.terminationReason.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundException('Не найдено');
        const r = id ? await tx.terminationReason.update({ where: { id }, data }) : await tx.terminationReason.create({ data });
        await this.audit.record(tx, { user, action: 'hr.reason.save', target: r.id, before: before ?? undefined, after: r });
        return { id: r.id };
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Такая причина уже есть');
      throw e;
    }
  }
}
```

`kadry.controller.ts` (this task's routes; later tasks add theirs):

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { StructureService } from './structure.service.js';

@Controller('kadry')
export class KadryController {
  constructor(private readonly structure: StructureService) {}

  @Get('structure') getStructure() { return this.structure.structure(); }
  @Post('departments') addDepartment(@Body() b: { name?: string; sortOrder?: number; headEmployeeId?: string | null }, @CurrentUser() u: AuthUser) { return this.structure.saveDepartment(null, b ?? {}, u); }
  @Put('departments/:id') putDepartment(@Param('id') id: string, @Body() b: { name?: string; sortOrder?: number; headEmployeeId?: string | null }, @CurrentUser() u: AuthUser) { return this.structure.saveDepartment(id, b ?? {}, u); }
  @Delete('departments/:id') @HttpCode(204) delDepartment(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.structure.deleteDepartment(id, u); }
  @Post('positions') addPosition(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.structure.savePosition(null, b ?? {}, u); }
  @Put('positions/:id') putPosition(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.structure.savePosition(id, b ?? {}, u); }
  @Delete('positions/:id') @HttpCode(204) delPosition(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.structure.deletePosition(id, u); }
  @Get('reasons') getReasons() { return this.structure.reasons(); }
  @Post('reasons') addReason(@Body() b: { label?: string; sortOrder?: number; active?: boolean }, @CurrentUser() u: AuthUser) { return this.structure.saveReason(null, b ?? {}, u); }
  @Put('reasons/:id') putReason(@Param('id') id: string, @Body() b: { label?: string; sortOrder?: number; active?: boolean }, @CurrentUser() u: AuthUser) { return this.structure.saveReason(id, b ?? {}, u); }
}
```

(Type the `positions` bodies with the `savePosition` input type instead of `Record<string, unknown>` if TypeScript complains.)

`kadry.module.ts`: `@Module({ controllers: [KadryController], providers: [StructureService], exports: [StructureService] })`. Add `KadryModule` to `app.module.ts` after `CashModule`. Add `'/kadry/structure'` to the e2e 401 list.

- [ ] **Step 4: Run** — `npx vitest run src/kadry` and `npx vitest run --config ./vitest.config.e2e.ts` · Expected: PASS. `npx tsc --noEmit -p tsconfig.json` clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): Кадры departments, positions and dismissal reasons"`

---

### Task 3: Employees, relatives, diplomas, status changes

**Files:**
- Create: `apps/api/src/kadry/employee-rules.ts`, `apps/api/src/kadry/employee-rules.spec.ts`, `apps/api/src/kadry/employees.service.ts`, `apps/api/src/kadry/employees.service.spec.ts`
- Modify: `apps/api/src/kadry/kadry.controller.ts`, `apps/api/src/kadry/kadry.module.ts`

**Interfaces:**
- Consumes: Task 1 models, `AuditService`, `tashkentDay` (`src/sync/salesdoc-date.ts`).
- Produces:
  - `employee-rules.ts`: constants `GENDERS`, `EMPLOYMENT_TYPES`, `EDUCATION_LEVELS`, `RELATIONS`, `DEGREES`, `DIPLOMA_STATUSES`; `type WorkSchedule = Record<string, { start: string; end: string }>`; `interface EmployeeInput` (below); `cleanSchedule(v): WorkSchedule | null`; `cleanEmployee(input, today: string): EmployeeData`; `cleanRelative(input)`; `cleanDiploma(input)`; `fullName(last, first, middle)`.
  - `EmployeesService.list(q: { status?: 'working' | 'terminated' | 'all'; departmentId?: string; positionId?: string; search?: string }) → EmployeeRow[]` with `EmployeeRow = { id, name, lastName, firstName, middleName, positionName, departmentName, status, employmentType, hiredAt: string | null, accounts: Array<{ kind, sdId }> }` — `departmentId='none'` = without department; status default `working` (= intern + active); search = name, position name, PINFL or phone, case-insensitive; sorted by name ('ru').
  - `get(id) → EmployeeCard` = every Employee field (dates as `YYYY-MM-DD`, `rate` as string, `terminatedAt` ISO) + `departmentName`, `positionName`, `positionSchedule: { startTime, workdays }`, `relatives[]`, `diplomas[]`, `accounts: Array<{ kind, sdId }>`, `canDelete: boolean`.
  - `create(input, user) → { id }`, `update(id, input, user)`, `dismiss(id, reasonId, user)`, `restore(id, user)`, `makePermanent(id, user)`, `remove(id, user)`; `saveRelative(employeeId, relativeId | null, input, user) → { id }`, `deleteRelative(employeeId, relativeId, user)`; `saveDiploma(…)`, `deleteDiploma(…)`; `history(id)`.
  - Routes: `GET employees`, `GET employees/:id`, `POST employees` (201 `{ id }`), `PUT employees/:id`, `POST employees/:id/dismiss { reasonId }`, `POST employees/:id/restore`, `POST employees/:id/make-permanent`, `DELETE employees/:id`, `POST employees/:id/relatives`, `PUT employees/:id/relatives/:rid`, `DELETE employees/:id/relatives/:rid`, same for `diplomas`, `GET employees/:id/history`.

`EmployeeInput` (all optional except names):

```ts
export interface EmployeeInput {
  lastName?: string; firstName?: string; middleName?: string | null;
  phone?: string | null; email?: string | null;
  birthDate?: string | null; birthPlace?: string | null; nationality?: string | null; citizenship?: string | null;
  gender?: string | null;
  passportSeries?: string | null; passportNumber?: string | null; passportIssuedBy?: string | null;
  passportIssuedDate?: string | null; passportValidUntil?: string | null;
  pinfl?: string | null; inn?: string | null; address?: string | null; educationLevel?: string | null;
  departmentId?: string | null; positionId?: string | null; employmentType?: string | null; remote?: boolean;
  workSchedule?: WorkSchedule | null; rate?: number | string | null; salary?: number | string | null;
  hiredAt?: string | null; orderNumber?: string | null; orderDate?: string | null; experienceMonths?: number | string | null;
  /** Only on create: "intern" | "active" (default "active"). */
  status?: string;
}
```

Validation messages (400, first problem in this order): «Введите фамилию», «Введите имя», «Неверная дата» (any date not a real `YYYY-MM-DD`), «Дата рождения в будущем», «Неверный пол», «Серия паспорта — 2 буквы», «Номер паспорта — 7 цифр», «ПИНФЛ — 14 цифр», «ИНН — только цифры», «Неверный email» (no `@`), «Неверный уровень образования», «Неверный тип занятости», schedule: «Неверный график работы» / «Укажите время» / «Конец должен быть позже начала» / «Отметьте рабочие дни» (empty object), «Ставка — число больше 0» (≤ 0, > 99.99 or > 2 decimals), «Оклад — целое число сум» (negative, fractional, > 2 000 000 000), «Стаж — целое число месяцев» (negative or fractional), «Неверный статус» (create status not intern/active); then «Отдел не найден», «Должность не найдена»; 409 «Сотрудник с таким ПИНФЛ уже есть». Passport series accepts Latin or Cyrillic letters and is upper-cased; number, PINFL and INN have spaces stripped before checking.

Relative: «Выберите степень родства» (missing or not in `RELATIONS`), «Неверная дата». Diploma: «Неверная степень» (not in `DEGREES` when given), «Неверный статус диплома», «Неверный год» (years outside 1900–2100 or fractional), «Неверная дата».

Status errors (409): dismiss — «Сотрудник уже уволен», 400 «Выберите причину увольнения» (missing / unknown / hidden reason); restore — «Сотрудник не уволен»; make permanent — «Сотрудник не стажёр»; delete — «Нельзя удалить — за сотрудником есть связанные записи. Уволь его вместо удаления, чтобы сохранить историю.» (any Salesdoc link); 404 «Сотрудник не найден», «Запись не найдена» (relative/diploma of another employee or missing).

- [ ] **Step 1: Failing tests** — `employee-rules.spec.ts`:

```ts
import { cleanDiploma, cleanEmployee, cleanRelative, cleanSchedule, fullName } from './employee-rules.js';

const today = '2026-10-12';
const ok = { lastName: ' Нишонов ', firstName: 'Шоядбек', middleName: '' };

describe('employee rules', () => {
  it('builds the full name and stores empty strings as null', () => {
    const e = cleanEmployee({ ...ok, phone: '  ', address: ' Андижан ' }, today);
    expect(e).toMatchObject({ lastName: 'Нишонов', firstName: 'Шоядбек', middleName: null, name: 'Нишонов Шоядбек', phone: null, address: 'Андижан', status: 'active', remote: false });
    expect(fullName('Нишонов', 'Шоядбек', 'Абдуллаевич')).toBe('Нишонов Шоядбек Абдуллаевич');
  });

  it('normalises identity documents', () => {
    const e = cleanEmployee({ ...ok, passportSeries: 'ad', passportNumber: '123 45 67', pinfl: '3010 1990 1234 56', inn: ' 123456789 ' }, today);
    expect(e).toMatchObject({ passportSeries: 'AD', passportNumber: '1234567', pinfl: '30101990123456', inn: '123456789' });
    expect(cleanEmployee({ ...ok, passportSeries: 'аб' }, today).passportSeries).toBe('АБ');
  });

  it.each([
    [{ lastName: '' }, 'Введите фамилию'],
    [{ firstName: ' ' }, 'Введите имя'],
    [{ birthDate: '2026-02-30' }, 'Неверная дата'],
    [{ birthDate: '2026-10-13' }, 'Дата рождения в будущем'],
    [{ gender: 'x' }, 'Неверный пол'],
    [{ passportSeries: 'A1' }, 'Серия паспорта — 2 буквы'],
    [{ passportNumber: '123456' }, 'Номер паспорта — 7 цифр'],
    [{ pinfl: '1234567890123' }, 'ПИНФЛ — 14 цифр'],
    [{ inn: '12a' }, 'ИНН — только цифры'],
    [{ email: 'mail.ru' }, 'Неверный email'],
    [{ educationLevel: 'phd' }, 'Неверный уровень образования'],
    [{ employmentType: 'XX' }, 'Неверный тип занятости'],
    [{ rate: 0 }, 'Ставка — число больше 0'],
    [{ rate: '1.255' }, 'Ставка — число больше 0'],
    [{ salary: -1 }, 'Оклад — целое число сум'],
    [{ salary: '100.5' }, 'Оклад — целое число сум'],
    [{ experienceMonths: -2 }, 'Стаж — целое число месяцев'],
    [{ status: 'terminated' }, 'Неверный статус'],
  ])('refuses %o', (patch, message) => {
    expect(() => cleanEmployee({ ...ok, ...(patch as object) }, today)).toThrow(message);
  });

  it('checks the work schedule', () => {
    expect(cleanSchedule(null)).toBeNull();
    expect(cleanSchedule({ '1': { start: '09:00', end: '18:00' }, '6': { start: '09:00', end: '14:00' } })).toEqual({ '1': { start: '09:00', end: '18:00' }, '6': { start: '09:00', end: '14:00' } });
    expect(() => cleanSchedule({})).toThrow('Отметьте рабочие дни');
    expect(() => cleanSchedule({ '1': { start: '', end: '18:00' } })).toThrow('Укажите время');
    expect(() => cleanSchedule({ '1': { start: '18:00', end: '09:00' } })).toThrow('Конец должен быть позже начала');
    expect(() => cleanSchedule({ '8': { start: '09:00', end: '18:00' } })).toThrow('Неверный график работы');
    expect(() => cleanSchedule([1])).toThrow('Неверный график работы');
  });

  it('defaults rate to 1 and keeps money as whole so\'m', () => {
    expect(cleanEmployee(ok, today)).toMatchObject({ rate: '1.00', salary: null });
    expect(cleanEmployee({ ...ok, rate: '0,5', salary: '6 000 000' }, today)).toMatchObject({ rate: '0.50', salary: 6000000 });
  });

  it('checks relatives and diplomas', () => {
    expect(cleanRelative({ relation: 'mother', fullName: ' Нишонова ' })).toMatchObject({ relation: 'mother', fullName: 'Нишонова' });
    expect(() => cleanRelative({ relation: 'friend' })).toThrow('Выберите степень родства');
    expect(() => cleanRelative({})).toThrow('Выберите степень родства');
    expect(cleanDiploma({ degree: 'Бакалавр', graduatedYear: '2019' })).toMatchObject({ degree: 'Бакалавр', graduatedYear: 2019 });
    expect(() => cleanDiploma({ degree: 'PhD' })).toThrow('Неверная степень');
    expect(() => cleanDiploma({ status: 'Да' })).toThrow('Неверный статус диплома');
    expect(() => cleanDiploma({ enrolledYear: 1800 })).toThrow('Неверный год');
  });
});
```

`employees.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { EmployeesService } from './employees.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const svc = new EmployeesService(db, audit);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const base = { lastName: 'Нишонов', firstName: 'Шоядбек' };

describe('EmployeesService', () => {
  let dept = '';
  let pos = '';
  let reason = '';
  beforeEach(async () => {
    await truncateAll(db);
    dept = (await db.department.create({ data: { name: 'Доставка', nameKey: 'доставка' } })).id;
    pos = (await db.position.create({ data: { name: 'Экспедитор', nameKey: 'экспедитор', groupKey: dept, departmentId: dept, startTime: '08:00', workdays: [1, 2, 3, 4, 5, 6] } })).id;
    reason = (await db.terminationReason.create({ data: { label: 'По собственному желанию', labelKey: 'по собственному желанию' } })).id;
  });
  afterAll(() => db.$disconnect());

  it('creates a card, shows it with names and the position schedule, and records it', async () => {
    const { id } = await svc.create({ ...base, middleName: 'Абдуллаевич', departmentId: dept, positionId: pos, employmentType: 'TD', salary: 6000000, hiredAt: '2026-09-01', status: 'intern', pinfl: '30101990123456' }, user);
    const c = await svc.get(id);
    expect(c).toMatchObject({ name: 'Нишонов Шоядбек Абдуллаевич', departmentName: 'Доставка', positionName: 'Экспедитор', status: 'intern', hiredAt: '2026-09-01', rate: '1.00', salary: 6000000, canDelete: true });
    expect(c.positionSchedule).toEqual({ startTime: '08:00', workdays: [1, 2, 3, 4, 5, 6] });
    expect((await svc.history(id)).map((e) => e.action)).toEqual(['hr.emp.create']);
  });

  it('edits with before and after, and refuses a duplicate PINFL or unknown department', async () => {
    const a = await svc.create({ ...base, pinfl: '30101990123456' }, user);
    const b = await svc.create({ lastName: 'Нурдинов', firstName: 'Илхомжон' }, user);
    await expect(svc.update(b.id, { lastName: 'Нурдинов', firstName: 'Илхомжон', pinfl: '30101990123456' }, user)).rejects.toThrow('Сотрудник с таким ПИНФЛ уже есть');
    await expect(svc.create({ ...base, pinfl: '30101990123456' }, user)).rejects.toThrow('Сотрудник с таким ПИНФЛ уже есть');
    await expect(svc.update(b.id, { ...base, departmentId: 'nope' }, user)).rejects.toThrow('Отдел не найден');
    await expect(svc.update(b.id, { ...base, positionId: 'nope' }, user)).rejects.toThrow('Должность не найдена');
    await svc.update(a.id, { ...base, pinfl: '30101990123456', salary: 7000000 }, user);
    const edit = (await svc.history(a.id)).find((e) => e.action === 'hr.emp.edit')!;
    expect(edit.before).toMatchObject({ salary: null });
    expect(edit.after).toMatchObject({ salary: 7000000 });
    await expect(svc.update('nope', base, user)).rejects.toThrow('Сотрудник не найден');
  });

  it('dismisses with a reason, restores, and makes an intern permanent', async () => {
    const { id } = await svc.create({ ...base, status: 'intern' }, user);
    await svc.makePermanent(id, user);
    expect((await svc.get(id)).status).toBe('active');
    await expect(svc.dismiss(id, '', user)).rejects.toThrow('Выберите причину увольнения');
    await svc.dismiss(id, reason, user);
    const fired = await svc.get(id);
    expect(fired).toMatchObject({ status: 'terminated', terminationReason: 'По собственному желанию' });
    expect(fired.terminatedAt).toBeTruthy();
    await svc.restore(id, user);
    expect(await svc.get(id)).toMatchObject({ status: 'active', terminatedAt: null, terminationReason: null });
    expect((await svc.history(id)).map((e) => e.action).sort()).toEqual(['hr.emp.create', 'hr.emp.dismiss', 'hr.emp.make_permanent', 'hr.emp.restore']);
  });

  it('refuses status changes that do not apply', async () => {
    const { id } = await svc.create(base, user);
    await expect(svc.restore(id, user)).rejects.toThrow('Сотрудник не уволен');
    await expect(svc.makePermanent(id, user)).rejects.toThrow('Сотрудник не стажёр');
    await svc.dismiss(id, reason, user);
    const first = (await svc.get(id)).terminatedAt;
    await expect(svc.dismiss(id, reason, user)).rejects.toBeInstanceOf(ConflictException);
    expect((await svc.get(id)).terminatedAt).toBe(first);
    await db.terminationReason.update({ where: { id: reason }, data: { active: false } });
    await svc.restore(id, user);
    await expect(svc.dismiss(id, reason, user)).rejects.toThrow('Выберите причину увольнения');
  });

  it('deletes only while nothing refers to the employee', async () => {
    const { id } = await svc.create(base, user);
    await db.employeeSalesdocAccount.create({ data: { kind: 'agent', sdId: 'd0_1', employeeId: id, linkedById: 'u1' } });
    expect((await svc.get(id)).canDelete).toBe(false);
    await expect(svc.remove(id, user)).rejects.toThrow('Нельзя удалить — за сотрудником есть связанные записи');
    await db.employeeSalesdocAccount.deleteMany({});
    await svc.remove(id, user);
    await expect(svc.get(id)).rejects.toThrow('Сотрудник не найден');
    expect((await audit.list({ target: id })).map((e) => e.action)).toContain('hr.emp.delete');
  });

  it('lists working staff by default, filters and searches', async () => {
    const a = await svc.create({ ...base, departmentId: dept, positionId: pos, phone: '+998 90 123 45 67' }, user);
    await svc.create({ lastName: 'Абдуллаев', firstName: 'Бобур', pinfl: '12345678901234' }, user);
    const c = await svc.create({ lastName: 'Каримов', firstName: 'Жасур' }, user);
    await svc.dismiss(c.id, reason, user);
    expect((await svc.list({})).map((r) => r.lastName)).toEqual(['Абдуллаев', 'Нишонов']);
    expect((await svc.list({ status: 'terminated' })).map((r) => r.lastName)).toEqual(['Каримов']);
    expect(await svc.list({ status: 'all' })).toHaveLength(3);
    expect((await svc.list({ departmentId: 'none' })).map((r) => r.lastName)).toEqual(['Абдуллаев']);
    expect((await svc.list({ positionId: pos })).map((r) => r.id)).toEqual([a.id]);
    expect((await svc.list({ search: 'экспед' })).map((r) => r.id)).toEqual([a.id]);
    expect((await svc.list({ search: '1234567890' })).map((r) => r.lastName)).toEqual(['Абдуллаев']);
    expect((await svc.list({ search: '+998 90' })).map((r) => r.id)).toEqual([a.id]); // phone; a PINFL never holds '+'
  });

  it('keeps relatives and diplomas on the card, only for their own employee', async () => {
    const a = await svc.create(base, user);
    const b = await svc.create({ lastName: 'Каримов', firstName: 'Жасур' }, user);
    const r = await svc.saveRelative(a.id, null, { relation: 'mother', fullName: 'Нишонова Мухаббат', birthDate: '1970-05-01' }, user);
    await svc.saveRelative(a.id, r.id, { relation: 'mother', fullName: 'Нишонова Мухаббат Х.' }, user);
    const d = await svc.saveDiploma(a.id, null, { degree: 'Бакалавр', institution: 'АндГУ', graduatedYear: 2019 }, user);
    expect((await svc.get(a.id)).relatives).toEqual([expect.objectContaining({ fullName: 'Нишонова Мухаббат Х.', birthDate: null })]);
    expect((await svc.get(a.id)).diplomas).toEqual([expect.objectContaining({ institution: 'АндГУ', graduatedYear: 2019 })]);
    await expect(svc.deleteRelative(b.id, r.id, user)).rejects.toThrow('Запись не найдена');
    await svc.deleteRelative(a.id, r.id, user);
    await svc.deleteDiploma(a.id, d.id, user);
    expect((await svc.get(a.id)).relatives).toEqual([]);
    expect((await svc.history(a.id)).map((e) => e.action)).toEqual(expect.arrayContaining(['hr.emp.relative.save', 'hr.emp.relative.delete', 'hr.emp.diploma.save', 'hr.emp.diploma.delete']));
  });
});
```

(The relative update in the test sends no `birthDate`, so it becomes `null`: saves replace the whole record.)

- [ ] **Step 2: Run** — `npx vitest run src/kadry/employee-rules.spec.ts src/kadry/employees.service.spec.ts` · Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the rules** — `employee-rules.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

export const GENDERS = ['male', 'female'] as const;
export const EMPLOYMENT_TYPES = ['TD', 'GPH', 'IP', 'SZ'] as const;
export const EDUCATION_LEVELS = ['higher', 'incomplete_higher', 'specialized_secondary', 'secondary', 'incomplete_secondary'] as const;
export const RELATIONS = ['spouse', 'mother', 'father', 'child', 'sibling', 'other'] as const;
export const DEGREES = ['Бакалавр', 'Магистр', 'Доктор', 'Среднее', 'Среднее спец.'] as const;
export const DIPLOMA_STATUSES = ['Подтверждён', 'Не подтверждён'] as const;

export type WorkSchedule = Record<string, { start: string; end: string }>;
export interface EmployeeInput { /* exactly as in this task's Interfaces block */ }

const bad = (m: string) => new BadRequestException(m);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const digits = (v: unknown) => { const t = text(typeof v === 'number' ? String(v) : v); return t ? t.replace(/\s+/g, '') : null; };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function dayOf(v: unknown): Date | null {
  const s = text(v);
  if (!s) return null;
  if (!DAY.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw bad('Неверная дата');
  return new Date(`${s}T00:00:00Z`);
}
function oneOf<T extends string>(v: unknown, list: readonly T[], message: string): T | null {
  const s = text(v);
  if (!s) return null;
  if (!(list as readonly string[]).includes(s)) throw bad(message);
  return s as T;
}
function wholeNumber(v: unknown, message: string, max: number): number | null {
  const s = digits(v);
  if (s == null) return null;
  if (!/^-?\d+$/.test(s)) throw bad(message);
  const n = Number(s);
  if (n < 0 || n > max) throw bad(message);
  return n;
}

export const fullName = (last: string, first: string, middle: string | null) => [last, first, middle].filter(Boolean).join(' ');

export function cleanSchedule(v: unknown): WorkSchedule | null {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('Неверный график работы');
  const out: WorkSchedule = {};
  for (const [k, d] of Object.entries(v as Record<string, { start?: unknown; end?: unknown }>)) {
    if (!/^[1-7]$/.test(k)) throw bad('Неверный график работы');
    const start = text(d?.start);
    const end = text(d?.end);
    if (!start || !end || !TIME.test(start) || !TIME.test(end)) throw bad('Укажите время');
    if (end <= start) throw bad('Конец должен быть позже начала');
    out[k] = { start, end };
  }
  if (Object.keys(out).length === 0) throw bad('Отметьте рабочие дни');
  return out;
}

/** Validates and normalises an employee; `today` = Tashkent day "YYYY-MM-DD". Does not check that department/position exist. */
export function cleanEmployee(i: EmployeeInput, today: string) {
  const lastName = text(i?.lastName);
  if (!lastName) throw bad('Введите фамилию');
  const firstName = text(i?.firstName);
  if (!firstName) throw bad('Введите имя');
  const middleName = text(i?.middleName);
  const birthDate = dayOf(i.birthDate);
  if (birthDate && birthDate.toISOString().slice(0, 10) > today) throw bad('Дата рождения в будущем');
  const passportIssuedDate = dayOf(i.passportIssuedDate);
  const passportValidUntil = dayOf(i.passportValidUntil);
  const hiredAt = dayOf(i.hiredAt);
  const orderDate = dayOf(i.orderDate);
  const gender = oneOf(i.gender, GENDERS, 'Неверный пол');
  const series = text(i.passportSeries)?.toUpperCase() ?? null;
  if (series && !/^[A-ZА-ЯЁ]{2}$/.test(series)) throw bad('Серия паспорта — 2 буквы');
  const passportNumber = digits(i.passportNumber);
  if (passportNumber && !/^\d{7}$/.test(passportNumber)) throw bad('Номер паспорта — 7 цифр');
  const pinfl = digits(i.pinfl);
  if (pinfl && !/^\d{14}$/.test(pinfl)) throw bad('ПИНФЛ — 14 цифр');
  const inn = digits(i.inn);
  if (inn && !/^\d+$/.test(inn)) throw bad('ИНН — только цифры');
  const email = text(i.email);
  if (email && !email.includes('@')) throw bad('Неверный email');
  const educationLevel = oneOf(i.educationLevel, EDUCATION_LEVELS, 'Неверный уровень образования');
  const employmentType = oneOf(i.employmentType, EMPLOYMENT_TYPES, 'Неверный тип занятости');
  const workSchedule = cleanSchedule(i.workSchedule);
  const rateText = i.rate == null || i.rate === '' ? '1' : String(i.rate).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(rateText) || !(Number(rateText) > 0) || Number(rateText) > 99.99) throw bad('Ставка — число больше 0');
  const salary = wholeNumber(i.salary, 'Оклад — целое число сум', 2_000_000_000);
  const experienceMonths = wholeNumber(i.experienceMonths, 'Стаж — целое число месяцев', 1200);
  const status = i.status == null || i.status === '' ? 'active' : i.status;
  if (status !== 'intern' && status !== 'active') throw bad('Неверный статус');
  return {
    lastName, firstName, middleName, name: fullName(lastName, firstName, middleName),
    phone: text(i.phone), email, birthDate, birthPlace: text(i.birthPlace), nationality: text(i.nationality), citizenship: text(i.citizenship),
    gender, passportSeries: series, passportNumber, passportIssuedBy: text(i.passportIssuedBy), passportIssuedDate, passportValidUntil,
    pinfl, inn, address: text(i.address), educationLevel,
    departmentId: text(i.departmentId), positionId: text(i.positionId), employmentType, remote: i.remote === true,
    workSchedule, rate: new Prisma.Decimal(rateText).toFixed(2), salary, hiredAt, orderNumber: text(i.orderNumber), orderDate, experienceMonths,
    status,
  };
}

export function cleanRelative(i: Record<string, unknown>) {
  const relation = oneOf(i?.relation, RELATIONS, 'Выберите степень родства');
  if (!relation) throw bad('Выберите степень родства');
  return {
    relation, fullName: text(i.fullName), birthDate: dayOf(i.birthDate), workplacePosition: text(i.workplacePosition),
    residenceAddress: text(i.residenceAddress), phone: text(i.phone),
  };
}

export function cleanDiploma(i: Record<string, unknown>) {
  const year = (v: unknown) => {
    const n = wholeNumber(v, 'Неверный год', 2100);
    if (n != null && n < 1900) throw bad('Неверный год');
    return n;
  };
  return {
    degree: oneOf(i?.degree, DEGREES, 'Неверная степень'), institution: text(i?.institution), specialty: text(i?.specialty),
    enrolledYear: year(i?.enrolledYear), graduatedYear: year(i?.graduatedYear), seriesNumber: text(i?.seriesNumber),
    issuedDate: dayOf(i?.issuedDate), status: oneOf(i?.status, DIPLOMA_STATUSES, 'Неверный статус диплома'),
  };
}
```

(`wholeNumber` strips spaces, so «6 000 000» becomes 6000000; `cleanEmployee({ rate: 0 })` hits `!(0 > 0)`.)

- [ ] **Step 4: Implement the service** — `employees.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';
import { tashkentDay } from '../sync/salesdoc-date.js';
import { cleanDiploma, cleanEmployee, cleanRelative, type EmployeeInput } from './employee-rules.js';

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
type Data = ReturnType<typeof cleanEmployee>;
/** What history stores for an employee: the editable fields, dates as days. */
const snapshot = (e: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(e)
      .filter(([k]) => !['id', 'createdAt', 'createdById', 'name'].includes(k))
      .map(([k, v]) => [k, v instanceof Date ? (k === 'terminatedAt' ? v.toISOString() : ymd(v)) : v instanceof Prisma.Decimal ? v.toFixed(2) : v]),
  );

/** Кадры: employee cards, relatives, diplomas and status changes (spec §2–3). */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async find(id: string) {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    return e;
  }

  private async checkRefs(d: Data) {
    if (d.departmentId && !(await this.prisma.department.findUnique({ where: { id: d.departmentId } }))) throw new BadRequestException('Отдел не найден');
    if (d.positionId && !(await this.prisma.position.findUnique({ where: { id: d.positionId } }))) throw new BadRequestException('Должность не найдена');
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Сотрудник с таким ПИНФЛ уже есть');
      throw e;
    }
  }

  async list(q: { status?: string; departmentId?: string; positionId?: string; search?: string } = {}) {
    const status = q.status === 'terminated' ? ['terminated'] : q.status === 'all' ? undefined : ['intern', 'active'];
    const s = q.search?.trim();
    const rows = await this.prisma.employee.findMany({
      where: {
        ...(status ? { status: { in: status } } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId === 'none' ? null : q.departmentId } : {}),
        ...(q.positionId ? { positionId: q.positionId } : {}),
        ...(s
          ? {
              OR: [
                { name: { contains: s, mode: 'insensitive' as const } },
                { pinfl: { contains: s.replace(/\s+/g, '') } },
                { phone: { contains: s } },
                { position: { name: { contains: s, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: { position: { select: { name: true } }, department: { select: { name: true } }, salesdocAccounts: { select: { kind: true, sdId: true } } },
    });
    return rows
      .map((e) => ({
        id: e.id, name: e.name, lastName: e.lastName, firstName: e.firstName, middleName: e.middleName,
        positionName: e.position?.name ?? null, departmentName: e.department?.name ?? null, status: e.status,
        employmentType: e.employmentType, hiredAt: ymd(e.hiredAt), accounts: e.salesdocAccounts,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  async get(id: string) {
    const e = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        position: true, department: { select: { name: true } },
        relatives: { orderBy: { createdAt: 'asc' } }, diplomas: { orderBy: { createdAt: 'asc' } },
        salesdocAccounts: { select: { kind: true, sdId: true } },
      },
    });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    const { position, department, relatives, diplomas, salesdocAccounts, ...rest } = e;
    return {
      ...snapshot(rest),
      id: e.id, name: e.name, createdAt: e.createdAt.toISOString(),
      departmentName: department?.name ?? null, positionName: position?.name ?? null,
      positionSchedule: position ? { startTime: position.startTime, workdays: [...position.workdays].sort((a, b) => a - b) } : null,
      relatives: relatives.map((r) => ({ ...r, birthDate: ymd(r.birthDate), createdAt: r.createdAt.toISOString() })),
      diplomas: diplomas.map((d) => ({ ...d, issuedDate: ymd(d.issuedDate), createdAt: d.createdAt.toISOString() })),
      accounts: salesdocAccounts,
      canDelete: salesdocAccounts.length === 0,
    } as Record<string, unknown> & { status: string; terminatedAt: string | null; relatives: unknown[]; diplomas: unknown[]; canDelete: boolean };
  }

  async create(input: EmployeeInput, user: AuthUser) {
    const d = cleanEmployee(input ?? {}, tashkentDay(new Date()));
    await this.checkRefs(d);
    return this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const e = await tx.employee.create({ data: { ...d, workSchedule: d.workSchedule ?? Prisma.DbNull, createdById: user.id } });
        await this.audit.record(tx, { user, action: 'hr.emp.create', target: e.id, after: snapshot(e) });
        return { id: e.id };
      }),
    );
  }

  /** Replaces the editable fields; status stays as it is (changed only by the status actions). */
  async update(id: string, input: EmployeeInput, user: AuthUser) {
    const before = await this.find(id);
    const { status: _status, ...d } = cleanEmployee({ ...(input ?? {}), status: undefined }, tashkentDay(new Date()));
    await this.checkRefs({ ...d, status: 'active' });
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const after = await tx.employee.update({ where: { id }, data: { ...d, workSchedule: d.workSchedule ?? Prisma.DbNull } });
        await this.audit.record(tx, { user, action: 'hr.emp.edit', target: id, before: snapshot(before), after: snapshot(after) });
      }),
    );
  }

  async dismiss(id: string, reasonId: string, user: AuthUser) {
    const e = await this.find(id);
    if (e.status === 'terminated') throw new ConflictException('Сотрудник уже уволен');
    const reason = reasonId ? await this.prisma.terminationReason.findUnique({ where: { id: reasonId } }) : null;
    if (!reason || !reason.active) throw new BadRequestException('Выберите причину увольнения');
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.employee.updateMany({ where: { id, status: { not: 'terminated' } }, data: { status: 'terminated', terminatedAt: new Date(), terminationReason: reason.label } });
      if (!r.count) throw new ConflictException('Сотрудник уже уволен');
      await this.audit.record(tx, { user, action: 'hr.emp.dismiss', target: id, reason: reason.label });
    });
  }

  async restore(id: string, user: AuthUser) {
    await this.find(id);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.employee.updateMany({ where: { id, status: 'terminated' }, data: { status: 'active', terminatedAt: null, terminationReason: null } });
      if (!r.count) throw new ConflictException('Сотрудник не уволен');
      await this.audit.record(tx, { user, action: 'hr.emp.restore', target: id });
    });
  }

  async makePermanent(id: string, user: AuthUser) {
    await this.find(id);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.employee.updateMany({ where: { id, status: 'intern' }, data: { status: 'active' } });
      if (!r.count) throw new ConflictException('Сотрудник не стажёр');
      await this.audit.record(tx, { user, action: 'hr.emp.make_permanent', target: id });
    });
  }

  async remove(id: string, user: AuthUser) {
    const e = await this.find(id);
    if (await this.prisma.employeeSalesdocAccount.count({ where: { employeeId: id } })) {
      throw new ConflictException('Нельзя удалить — за сотрудником есть связанные записи. Уволь его вместо удаления, чтобы сохранить историю.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.delete({ where: { id } });
      await this.audit.record(tx, { user, action: 'hr.emp.delete', target: id, before: snapshot(e) });
    });
  }

  async saveRelative(employeeId: string, relativeId: string | null, input: Record<string, unknown>, user: AuthUser) {
    await this.find(employeeId);
    const data = cleanRelative(input ?? {});
    return this.prisma.$transaction(async (tx) => {
      if (relativeId && !(await tx.employeeRelative.findFirst({ where: { id: relativeId, employeeId } }))) throw new NotFoundException('Запись не найдена');
      const r = relativeId ? await tx.employeeRelative.update({ where: { id: relativeId }, data }) : await tx.employeeRelative.create({ data: { ...data, employeeId } });
      await this.audit.record(tx, { user, action: 'hr.emp.relative.save', target: employeeId, after: { ...data, birthDate: ymd(data.birthDate) } });
      return { id: r.id };
    });
  }

  async deleteRelative(employeeId: string, relativeId: string, user: AuthUser) {
    const r = await this.prisma.employeeRelative.findFirst({ where: { id: relativeId, employeeId } });
    if (!r) throw new NotFoundException('Запись не найдена');
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeRelative.delete({ where: { id: relativeId } });
      await this.audit.record(tx, { user, action: 'hr.emp.relative.delete', target: employeeId, before: { relation: r.relation, fullName: r.fullName } });
    });
  }

  async saveDiploma(employeeId: string, diplomaId: string | null, input: Record<string, unknown>, user: AuthUser) {
    await this.find(employeeId);
    const data = cleanDiploma(input ?? {});
    return this.prisma.$transaction(async (tx) => {
      if (diplomaId && !(await tx.employeeDiploma.findFirst({ where: { id: diplomaId, employeeId } }))) throw new NotFoundException('Запись не найдена');
      const d = diplomaId ? await tx.employeeDiploma.update({ where: { id: diplomaId }, data }) : await tx.employeeDiploma.create({ data: { ...data, employeeId } });
      await this.audit.record(tx, { user, action: 'hr.emp.diploma.save', target: employeeId, after: { ...data, issuedDate: ymd(data.issuedDate) } });
      return { id: d.id };
    });
  }

  async deleteDiploma(employeeId: string, diplomaId: string, user: AuthUser) {
    const d = await this.prisma.employeeDiploma.findFirst({ where: { id: diplomaId, employeeId } });
    if (!d) throw new NotFoundException('Запись не найдена');
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeDiploma.delete({ where: { id: diplomaId } });
      await this.audit.record(tx, { user, action: 'hr.emp.diploma.delete', target: employeeId, before: { degree: d.degree, institution: d.institution } });
    });
  }

  history(id: string) {
    return this.audit.list({ target: id });
  }
}
```

Note for the implementer: in `update`, `cleanEmployee` is called with `status: undefined` so it does not refuse the current status; the returned `status` is dropped. The `get` return type cast is only to keep callers typed — prefer a declared `EmployeeCard` interface if it reads cleaner.

Controller additions (inject `EmployeesService`):

```ts
  @Get('employees') employees(@Query('status') status?: string, @Query('department') departmentId?: string, @Query('position') positionId?: string, @Query('search') search?: string) {
    return this.employees.list({ status, departmentId: departmentId || undefined, positionId: positionId || undefined, search: search || undefined });
  }
  @Get('employees/:id') employee(@Param('id') id: string) { return this.employees.get(id); }
  @Post('employees') createEmployee(@Body() b: EmployeeInput, @CurrentUser() u: AuthUser) { return this.employees.create(b ?? {}, u); }
  @Put('employees/:id') @HttpCode(204) updateEmployee(@Param('id') id: string, @Body() b: EmployeeInput, @CurrentUser() u: AuthUser) { return this.employees.update(id, b ?? {}, u); }
  @Post('employees/:id/dismiss') @HttpCode(204) dismiss(@Param('id') id: string, @Body() b: { reasonId?: string }, @CurrentUser() u: AuthUser) { return this.employees.dismiss(id, b?.reasonId ?? '', u); }
  @Post('employees/:id/restore') @HttpCode(204) restore(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.employees.restore(id, u); }
  @Post('employees/:id/make-permanent') @HttpCode(204) makePermanent(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.employees.makePermanent(id, u); }
  @Delete('employees/:id') @HttpCode(204) removeEmployee(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.employees.remove(id, u); }
  @Post('employees/:id/relatives') addRelative(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.employees.saveRelative(id, null, b ?? {}, u); }
  @Put('employees/:id/relatives/:rid') @HttpCode(204) putRelative(@Param('id') id: string, @Param('rid') rid: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.employees.saveRelative(id, rid, b ?? {}, u).then(() => undefined); }
  @Delete('employees/:id/relatives/:rid') @HttpCode(204) delRelative(@Param('id') id: string, @Param('rid') rid: string, @CurrentUser() u: AuthUser) { return this.employees.deleteRelative(id, rid, u); }
  @Post('employees/:id/diplomas') addDiploma(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.employees.saveDiploma(id, null, b ?? {}, u); }
  @Put('employees/:id/diplomas/:did') @HttpCode(204) putDiploma(@Param('id') id: string, @Param('did') did: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) { return this.employees.saveDiploma(id, did, b ?? {}, u).then(() => undefined); }
  @Delete('employees/:id/diplomas/:did') @HttpCode(204) delDiploma(@Param('id') id: string, @Param('did') did: string, @CurrentUser() u: AuthUser) { return this.employees.deleteDiploma(id, did, u); }
  @Get('employees/:id/history') employeeHistory(@Param('id') id: string) { return this.employees.history(id); }
```

Register `EmployeesService` in `kadry.module.ts` providers/exports.

- [ ] **Step 5: Run** — `npx vitest run src/kadry`, `npx tsc --noEmit -p tsconfig.json`, full `npx vitest run`, e2e · Expected: all pass.

- [ ] **Step 6: Commit** — `git commit -m "feat(api): Кадры employees, relatives, diplomas and status changes"`

---

### Task 4: Salesdoc links, metrics, birthdays, page history

**Files:**
- Create: `apps/api/src/kadry/salesdoc-links.service.ts`, `apps/api/src/kadry/salesdoc-links.service.spec.ts`, `apps/api/src/kadry/kadry-stats.service.ts`, `apps/api/src/kadry/kadry-stats.service.spec.ts`
- Modify: `apps/api/src/kadry/kadry.controller.ts`, `apps/api/src/kadry/kadry.module.ts`, `apps/api/src/kadry/employees.service.ts` (list rows carry account names)

**Interfaces:**
- Consumes: Task 1 `Agent`, `Expeditor`, `Supervisor`, `EmployeeSalesdocAccount`; `AuditService.list({ actionPrefix })`.
- Produces:
  - `SalesdocLinksService.accounts() → Array<{ kind: 'agent' | 'expeditor' | 'supervisor'; sdId; name; active: boolean; exists: boolean; employee: { id; name } | null }>` — every synced agent, expeditor, supervisor plus linked accounts no longer synced (`exists: false`, `name` = sdId, `active: false`); sorted by kind (agent, expeditor, supervisor) then name ('ru').
  - `link(employeeId, kind, sdId, user)`, `unlink(employeeId, kind, sdId, user)`; `namesFor(accounts: Array<{kind, sdId}>) → Map<'kind:sdId', string>`.
  - `KadryStatsService.metrics(today = tashkentDay(new Date())) → { headcount: number; averageAge: number | null; male: number; female: number; averageTenureMonths: number | null; turnoverPercent: number | null; dismissed12m: number }`.
  - `birthdays(today = tashkentDay(new Date())) → Array<{ id; name; day: number; daysLeft: number; turnsAge: number | null }>`.
  - Routes: `GET salesdoc-accounts`, `POST employees/:id/salesdoc { kind, sdId }` (204), `DELETE employees/:id/salesdoc/:kind/:sdId` (204), `GET metrics`, `GET birthdays`, `GET history/:scope` where scope `employees` → prefix `hr.emp.`, `structure` → `hr.struct.`, `reasons` → `hr.reason.`, else 404 «Страница не найдена».
  - `EmployeeRow.accounts` becomes `Array<{ kind, sdId, name }>`; the card's `accounts` too.
  - Errors: 400 «Неверный вид учётной записи»; 404 «Учётная запись не найдена в Salesdoc», «Сотрудник не найден», «Привязка не найдена»; 409 «Эта учётная запись уже привязана к <ФИО>», «Уже привязана к этому сотруднику».

Rules: age in full years at `today`; tenure in whole months from `hiredAt` to `today` (only people with `hiredAt` ≤ today); averages over non-terminated people with the value, rounded to 1 decimal (`averageAge`) / whole months; `hired12m` = people of any status with `hiredAt` in (today − 12 months, today]; `dismissed12m` = `terminatedAt` (as a Tashkent day) in the same window; `begin = max(0, headcount − hired12m + dismissed12m)`; `turnoverPercent = dismissed12m / ((begin + headcount) / 2) × 100`, rounded to 1 decimal, capped at 100, `null` when the denominator is 0. Birthdays: non-terminated people whose birth month = today's month and birth day ≥ today's day; 29 February counts as 28 February in a non-leap year; sorted by day then name; `turnsAge` = this year − birth year when birth year > 1900.

- [ ] **Step 1: Failing tests** — `salesdoc-links.service.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { SalesdocLinksService } from './salesdoc-links.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const svc = new SalesdocLinksService(db, audit);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const seenAt = new Date();

describe('SalesdocLinksService', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.agent.createMany({ data: [
      { sdId: 'a1', name: 'AND-AP-BEV-03 GOROD 1', active: true, raw: {}, seenAt },
      { sdId: 'a2', name: 'AND-AP-BEV-02 RAYON 1', active: false, raw: {}, seenAt },
    ] });
    await db.expeditor.create({ data: { sdId: 'x1', name: 'Нишонов Шоядбек (60)', active: true, raw: {}, seenAt } });
    await db.supervisor.create({ data: { sdId: 's1', name: 'Супервайзер', active: true, raw: {}, seenAt } });
    for (const [id, last] of [['e1', 'Иванов'], ['e2', 'Петров']]) {
      await db.employee.create({ data: { id, lastName: last, firstName: 'И', name: `${last} И`, createdById: 'u1' } });
    }
  });
  afterAll(() => db.$disconnect());

  it('lists every account with its person, sorted by kind and name', async () => {
    await svc.link('e1', 'agent', 'a1', user);
    const rows = await svc.accounts();
    expect(rows.map((r) => [r.kind, r.name, r.active, r.employee?.name ?? null])).toEqual([
      ['agent', 'AND-AP-BEV-02 RAYON 1', false, null],
      ['agent', 'AND-AP-BEV-03 GOROD 1', true, 'Иванов И'],
      ['expeditor', 'Нишонов Шоядбек (60)', true, null],
      ['supervisor', 'Супервайзер', true, null],
    ]);
  });

  it('one account belongs to one person at a time', async () => {
    await svc.link('e1', 'agent', 'a1', user);
    await expect(svc.link('e2', 'agent', 'a1', user)).rejects.toThrow('Эта учётная запись уже привязана к Иванов И');
    await expect(svc.link('e1', 'agent', 'a1', user)).rejects.toThrow('Уже привязана к этому сотруднику');
    await svc.link('e1', 'expeditor', 'x1', user); // a person may hold several
    await svc.unlink('e1', 'agent', 'a1', user);
    await svc.link('e2', 'agent', 'a1', user);
    expect((await svc.accounts()).find((r) => r.sdId === 'a1')?.employee?.name).toBe('Петров И');
    expect((await audit.list({ target: 'e1' })).map((e) => e.action).sort()).toEqual(['hr.emp.salesdoc.link', 'hr.emp.salesdoc.link', 'hr.emp.salesdoc.unlink']);
  });

  it('checks the kind, the account and the person', async () => {
    await expect(svc.link('e1', 'boss', 'a1', user)).rejects.toThrow('Неверный вид учётной записи');
    await expect(svc.link('e1', 'agent', 'zz', user)).rejects.toThrow('Учётная запись не найдена в Salesdoc');
    await expect(svc.link('nope', 'agent', 'a1', user)).rejects.toThrow('Сотрудник не найден');
    await expect(svc.unlink('e1', 'agent', 'a1', user)).rejects.toThrow('Привязка не найдена');
  });

  it('keeps a link to an account that left Salesdoc and marks it', async () => {
    await svc.link('e1', 'supervisor', 's1', user);
    await db.supervisor.deleteMany({});
    expect((await svc.accounts()).find((r) => r.sdId === 's1')).toMatchObject({ exists: false, name: 's1', employee: { id: 'e1' } });
  });
});
```

`kadry-stats.service.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { KadryStatsService } from './kadry-stats.service.js';

const db = createTestDb();
const svc = new KadryStatsService(db);
const person = (id: string, d: { gender?: string; birthDate?: string; hiredAt?: string; status?: string; terminatedAt?: string }) =>
  db.employee.create({
    data: {
      id, lastName: id, firstName: 'И', name: `${id} И`, createdById: 'u1', gender: d.gender ?? null, status: d.status ?? 'active',
      birthDate: d.birthDate ? new Date(`${d.birthDate}T00:00:00Z`) : null, hiredAt: d.hiredAt ? new Date(`${d.hiredAt}T00:00:00Z`) : null,
      terminatedAt: d.terminatedAt ? new Date(`${d.terminatedAt}T10:00:00Z`) : null,
    },
  });

describe('KadryStatsService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('computes headcount, age, gender, tenure and turnover', async () => {
    await person('a', { gender: 'male', birthDate: '1990-10-12', hiredAt: '2025-10-12' });  // 36 y, 12 months
    await person('b', { gender: 'female', birthDate: '2000-10-13', hiredAt: '2026-09-12' }); // 25 y, 1 month
    await person('c', { gender: 'male', status: 'intern', hiredAt: '2026-10-01' });          // 0 months
    await person('d', { status: 'terminated', hiredAt: '2024-01-01', terminatedAt: '2026-03-01' });
    expect(await svc.metrics('2026-10-12')).toEqual({
      headcount: 3, averageAge: 30.5, male: 2, female: 1, averageTenureMonths: 4, dismissed12m: 1,
      // hired12m = b, c (a hired exactly 12 months ago is outside the window) = 2; begin = 3 − 2 + 1 = 2; 1 / 2.5 = 40 %
      turnoverPercent: 40,
    });
  });

  it('turnover stays within 0–100 for small staff', async () => {
    await person('a', { hiredAt: '2026-05-01' });
    await person('b', { status: 'terminated', hiredAt: '2026-02-01', terminatedAt: '2026-04-01' });
    await person('c', { status: 'terminated', hiredAt: '2026-02-01', terminatedAt: '2026-06-01' });
    const m = await svc.metrics('2026-10-12');
    expect(m.turnoverPercent).not.toBeNull();
    expect(m.turnoverPercent!).toBeGreaterThanOrEqual(0);
    expect(m.turnoverPercent!).toBeLessThanOrEqual(100);
    await db.employee.deleteMany({});
    expect(await svc.metrics('2026-10-12')).toMatchObject({ headcount: 0, averageAge: null, averageTenureMonths: null, turnoverPercent: null });
  });

  it('lists birthdays later this month, including 29 February in a non-leap year', async () => {
    await person('today', { birthDate: '1990-02-28' });
    await person('leap', { birthDate: '2000-02-29' });
    await person('later', { birthDate: '1985-02-28' });
    await person('past', { birthDate: '1990-02-27' });
    await person('gone', { birthDate: '1990-02-28', status: 'terminated' });
    const b = await svc.birthdays('2027-02-28');
    expect(b.map((x) => [x.name, x.daysLeft, x.turnsAge])).toEqual([['later И', 0, 42], ['leap И', 0, 27], ['today И', 0, 37]]);
    expect(await svc.birthdays('2026-12-31')).toEqual([]);
  });
});
```

(Birthdays on the same day are sorted by name ('ru'); `later И` < `leap И` < `today И`.)

Append to `employees.service.spec.ts`:

```ts
  it('shows linked account names in the list', async () => {
    const { id } = await svc.create(base, user);
    await db.agent.create({ data: { sdId: 'a1', name: 'AND-D-BEV-01 OPT', active: true, raw: {}, seenAt: new Date() } });
    await db.employeeSalesdocAccount.create({ data: { kind: 'agent', sdId: 'a1', employeeId: id, linkedById: 'u1' } });
    expect((await svc.list({}))[0].accounts).toEqual([{ kind: 'agent', sdId: 'a1', name: 'AND-D-BEV-01 OPT' }]);
    expect((await svc.get(id)).accounts).toEqual([{ kind: 'agent', sdId: 'a1', name: 'AND-D-BEV-01 OPT' }]);
  });
```

- [ ] **Step 2: Run** — `npx vitest run src/kadry` · Expected: FAIL (modules missing; list accounts have no name).

- [ ] **Step 3: Implement** — `salesdoc-links.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';

export const ACCOUNT_KINDS = ['agent', 'expeditor', 'supervisor'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
const isKind = (v: unknown): v is AccountKind => typeof v === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(v);

/** People ↔ the Salesdoc accounts they work under (spec §2–3). */
@Injectable()
export class SalesdocLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async synced() {
    const pick = { select: { sdId: true, name: true, active: true } } as const;
    const [agent, expeditor, supervisor] = await Promise.all([
      this.prisma.agent.findMany(pick), this.prisma.expeditor.findMany(pick), this.prisma.supervisor.findMany(pick),
    ]);
    return { agent, expeditor, supervisor };
  }

  /** "kind:sdId" → account name, for the accounts given (or all). */
  async namesFor(accounts?: Array<{ kind: string; sdId: string }>) {
    const s = await this.synced();
    const names = new Map<string, string>();
    for (const kind of ACCOUNT_KINDS) for (const a of s[kind]) names.set(`${kind}:${a.sdId}`, a.name);
    if (accounts) for (const a of accounts) if (!names.has(`${a.kind}:${a.sdId}`)) names.set(`${a.kind}:${a.sdId}`, a.sdId);
    return names;
  }

  async accounts() {
    const [s, links] = await Promise.all([
      this.synced(),
      this.prisma.employeeSalesdocAccount.findMany({ include: { employee: { select: { id: true, name: true } } } }),
    ]);
    const linked = new Map(links.map((l) => [`${l.kind}:${l.sdId}`, l.employee]));
    const rows = ACCOUNT_KINDS.flatMap((kind) =>
      s[kind].map((a) => ({ kind, sdId: a.sdId, name: a.name, active: a.active, exists: true, employee: linked.get(`${kind}:${a.sdId}`) ?? null })),
    );
    const seen = new Set(rows.map((r) => `${r.kind}:${r.sdId}`));
    for (const l of links) {
      if (!seen.has(`${l.kind}:${l.sdId}`) && isKind(l.kind)) rows.push({ kind: l.kind, sdId: l.sdId, name: l.sdId, active: false, exists: false, employee: l.employee });
    }
    const order = (k: AccountKind) => ACCOUNT_KINDS.indexOf(k);
    return rows.sort((a, b) => order(a.kind) - order(b.kind) || a.name.localeCompare(b.name, 'ru'));
  }

  async link(employeeId: string, kind: string, sdId: string, user: AuthUser) {
    if (!isKind(kind)) throw new BadRequestException('Неверный вид учётной записи');
    if (!(await this.prisma.employee.findUnique({ where: { id: employeeId } }))) throw new NotFoundException('Сотрудник не найден');
    const s = await this.synced();
    if (!s[kind].some((a) => a.sdId === sdId)) throw new NotFoundException('Учётная запись не найдена в Salesdoc');
    const holder = await this.prisma.employeeSalesdocAccount.findUnique({ where: { kind_sdId: { kind, sdId } }, include: { employee: { select: { name: true } } } });
    if (holder?.employeeId === employeeId) throw new ConflictException('Уже привязана к этому сотруднику');
    if (holder) throw new ConflictException(`Эта учётная запись уже привязана к ${holder.employee.name}`);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.employeeSalesdocAccount.create({ data: { kind, sdId, employeeId, linkedById: user.id } });
        await this.audit.record(tx, { user, action: 'hr.emp.salesdoc.link', target: employeeId, after: { kind, sdId } });
      });
    } catch (e) {
      // Two links at once: the second loses on the primary key.
      const again = await this.prisma.employeeSalesdocAccount.findUnique({ where: { kind_sdId: { kind, sdId } }, include: { employee: { select: { name: true } } } });
      if (again) throw new ConflictException(`Эта учётная запись уже привязана к ${again.employee.name}`);
      throw e;
    }
  }

  async unlink(employeeId: string, kind: string, sdId: string, user: AuthUser) {
    if (!isKind(kind)) throw new BadRequestException('Неверный вид учётной записи');
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.employeeSalesdocAccount.deleteMany({ where: { kind, sdId, employeeId } });
      if (!r.count) throw new NotFoundException('Привязка не найдена');
      await this.audit.record(tx, { user, action: 'hr.emp.salesdoc.unlink', target: employeeId, before: { kind, sdId } });
    });
  }
}
```

`kadry-stats.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { tashkentDay } from '../sync/salesdoc-date.js';

const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Whole years / months between two "YYYY-MM-DD" days (from ≤ to). */
function fullYears(from: string, to: string) {
  const [fy, fm, fd] = parts(from); const [ty, tm, td] = parts(to);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}
function fullMonths(from: string, to: string) {
  const [fy, fm, fd] = parts(from); const [ty, tm, td] = parts(to);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}
/** The day 12 months before `today` (31 Mar → 31 Mar of the previous year; 29 Feb → 28 Feb). */
function yearAgo(today: string) {
  const [y, m, d] = parts(today);
  const day = m === 2 && d === 29 && !isLeap(y - 1) ? 28 : d;
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Metrics bar and birthdays widget (spec §3–4). */
@Injectable()
export class KadryStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(today = tashkentDay(new Date())) {
    const all = await this.prisma.employee.findMany({ select: { status: true, gender: true, birthDate: true, hiredAt: true, terminatedAt: true } });
    const working = all.filter((e) => e.status !== 'terminated');
    const ages = working.filter((e) => e.birthDate && ymd(e.birthDate) <= today).map((e) => fullYears(ymd(e.birthDate!), today));
    const tenures = working.filter((e) => e.hiredAt && ymd(e.hiredAt) <= today).map((e) => fullMonths(ymd(e.hiredAt!), today));
    const since = yearAgo(today);
    const inWindow = (d: string | null) => d != null && d > since && d <= today;
    const hired12m = all.filter((e) => inWindow(e.hiredAt ? ymd(e.hiredAt) : null)).length;
    const dismissed12m = all.filter((e) => inWindow(e.terminatedAt ? tashkentDay(e.terminatedAt) : null)).length;
    const headcount = working.length;
    const begin = Math.max(0, headcount - hired12m + dismissed12m);
    const denominator = (begin + headcount) / 2;
    const averageAge = avg(ages);
    const averageTenure = avg(tenures);
    return {
      headcount,
      averageAge: averageAge == null ? null : Math.round(averageAge * 10) / 10,
      male: working.filter((e) => e.gender === 'male').length,
      female: working.filter((e) => e.gender === 'female').length,
      averageTenureMonths: averageTenure == null ? null : Math.round(averageTenure),
      dismissed12m,
      turnoverPercent: denominator > 0 ? Math.min(100, Math.round((dismissed12m / denominator) * 1000) / 10) : null,
    };
  }

  async birthdays(today = tashkentDay(new Date())) {
    const [y, m, d] = parts(today);
    const people = await this.prisma.employee.findMany({ where: { status: { not: 'terminated' }, birthDate: { not: null } }, select: { id: true, name: true, birthDate: true } });
    return people
      .map((p) => {
        const [by, bm, bd] = parts(ymd(p.birthDate!));
        const day = bm === 2 && bd === 29 && !isLeap(y) ? 28 : bd;
        return { id: p.id, name: p.name, month: bm, day, daysLeft: day - d, turnsAge: by > 1900 ? y - by : null };
      })
      .filter((p) => p.month === m && p.day >= d)
      .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'ru'))
      .map(({ month: _m, ...p }) => p);
  }
}
```

(Check the first metrics test by hand: ages 36 and 25 → 30.5; tenures a = 12, b = 1, c = 0 → 13/3 = 4.33 → 4.)

`EmployeesService`: inject `SalesdocLinksService` (constructor `(prisma, audit, links)`), and in `list` and `get` map accounts through `await this.links.namesFor(accounts)` to `{ kind, sdId, name }`. Update the spec's `new EmployeesService(db, audit)` to `new EmployeesService(db, audit, new SalesdocLinksService(db, audit))`.

Controller additions (inject `SalesdocLinksService`, `KadryStatsService`, `AuditService`):

```ts
  @Get('salesdoc-accounts') accounts() { return this.links.accounts(); }
  @Post('employees/:id/salesdoc') @HttpCode(204) link(@Param('id') id: string, @Body() b: { kind?: string; sdId?: string }, @CurrentUser() u: AuthUser) { return this.links.link(id, b?.kind ?? '', b?.sdId ?? '', u); }
  @Delete('employees/:id/salesdoc/:kind/:sdId') @HttpCode(204) unlink(@Param('id') id: string, @Param('kind') kind: string, @Param('sdId') sdId: string, @CurrentUser() u: AuthUser) { return this.links.unlink(id, kind, sdId, u); }
  @Get('metrics') metrics() { return this.stats.metrics(); }
  @Get('birthdays') birthdays() { return this.stats.birthdays(); }
  @Get('history/:scope') history(@Param('scope') scope: string) {
    const PREFIX: Record<string, string> = { employees: 'hr.emp.', structure: 'hr.struct.', reasons: 'hr.reason.' };
    if (!Object.hasOwn(PREFIX, scope)) throw new NotFoundException('Страница не найдена');
    return this.audit.list({ actionPrefix: PREFIX[scope] });
  }
```

Register both services in `kadry.module.ts`. Add `'/kadry/metrics'` to the e2e 401 list.

- [ ] **Step 4: Run** — `npx vitest run src/kadry`, full suite, e2e, tsc · Expected: all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): Кадры Salesdoc links, metrics, birthdays, history"`

---

### Task 5: Web — «Кадры» panel, placeholders, birthdays, structure and reasons pages

**Files:**
- Create: `apps/web/src/lib/kadry-menu.ts`, `apps/web/src/app/kadry/page.tsx`, `apps/web/src/app/kadry/[section]/page.tsx`, `apps/web/src/app/kadry/actions.ts`, `apps/web/src/app/kadry/struktura/page.tsx`, `apps/web/src/app/kadry/struktura/department-dialog.tsx`, `apps/web/src/app/kadry/struktura/position-dialog.tsx`, `apps/web/src/app/kadry/prichiny/page.tsx`, `apps/web/src/app/kadry/prichiny/reason-row.tsx`
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/i18n/messages.ts`

**Interfaces:**
- Consumes: Task 2 and 4 routes; `SectionPanel`, `PlaceholderPage(title, back)`, `PageHeader back`, `HistoryButton`, `HistoryList`, `Field`, `Select` (controlled `value`/`onValueChange`), `Dialog`, `CheckboxField`.
- Produces: types in `lib/api.ts` — `KadryStructure`, `KadryDepartment`, `KadryPosition`, `KadryReason`, `KadryBirthday`, `KadryMetrics`; server actions in `app/kadry/actions.ts`: `saveDepartment(id | null, body)`, `deleteDepartment(id)`, `savePosition(id | null, body)`, `deletePosition(id)`, `saveReason(id | null, body)` → `{ ok: boolean; message?: string }` (all `revalidatePath("/kadry", "layout")`); `KADRY_MENU`; `WEEKDAYS` helper in `lib/kadry-menu.ts` is NOT used — weekday labels come from messages `kadry.wd.1`…`kadry.wd.7`.

- [ ] **Step 1: Messages** (ru / uz, same order). Navigation: `nav.kadry` «Кадры» / «Kadrlar»; `kadry.employees` «Сотрудники» / «Xodimlar»; `kadry.structure` «Подразделения и должности» / «Bo'limlar va lavozimlar»; `kadry.reasons` «Причины увольнения» / «Ishdan bo'shatish sabablari»; `kadry.salesdoc` «Учётные записи Salesdoc» / «Salesdoc hisoblari»; `kadry.later` «Скоро» / «Tez orada»; `kadry.attendance` «Посещаемость» / «Davomat»; `kadry.payroll` «Зарплата» / «Ish haqi»; `kadry.inventory` «Инвентарь» / «Inventar»; `kadry.recruiting` «Рекрутинг» / «Ishga qabul»; `kadry.onboarding` «Онбординг» / «Moslashuv»; `kadry.retention` «Удержание» / «Xodimlarni saqlash». Birthdays: `kadry.birthdays` «Дни рождения» / «Tug'ilgan kunlar»; `kadry.birthdays_empty` «Ближайших дней рождения в этом месяце нет» / «Bu oyda yaqin tug'ilgan kunlar yo'q»; `kadry.today` «сегодня» / «bugun»; `kadry.in_days` «через {n} дн.» / «{n} kundan keyin»; `kadry.turns` «исполнится {age}» / «{age} yoshga to'ladi». Structure: `kadry.departments` «Подразделения» / «Bo'limlar»; `kadry.positions` «Должности» / «Lavozimlar»; `kadry.department` «Отдел» / «Bo'lim»; `kadry.position` «Должность» / «Lavozim»; `kadry.no_department` «Без отдела» / «Bo'limsiz»; `kadry.name` «Название» / «Nomi»; `kadry.sort` «Порядок» / «Tartib»; `kadry.head` «Руководитель» / «Rahbar»; `kadry.not_set` «Не назначен» / «Tayinlanmagan»; `kadry.count` «Сотрудников» / «Xodimlar soni»; `kadry.start_time` «Время прихода» / «Kelish vaqti»; `kadry.start_time_hint` «Пусто — общее время (появится с посещаемостью).» / «Bo'sh — umumiy vaqt (davomat bilan qo'shiladi).»; `kadry.workdays` «Рабочие дни» / «Ish kunlari»; `kadry.description` «Описание» / «Tavsif»; `kadry.add_department` «Создать подразделение» / «Bo'lim yaratish»; `kadry.add_position` «Создать должность» / «Lavozim yaratish»; `kadry.edit` «Изменить» / «O'zgartirish»; `kadry.delete` «Удалить» / «O'chirish»; `kadry.confirm_delete` «Удалить «{name}»?» / «"{name}" o'chirilsinmi?»; `kadry.add_reason` «Добавить причину» / «Sabab qo'shish»; `kadry.hidden` «скрыта» / «yashirilgan»; `kadry.hide` «Скрыть» / «Yashirish»; `kadry.show` «Вернуть» / «Qaytarish»; `kadry.save` «Сохранить» / «Saqlash»; weekdays `kadry.wd.1`…`kadry.wd.7` «Пн» «Вт» «Ср» «Чт» «Пт» «Сб» «Вс» / «Du» «Se» «Ch» «Pa» «Ju» «Sh» «Ya». History labels: `history.action.hr.struct.department.save` «Отдел сохранён» / «Bo'lim saqlandi», `….department.delete` «Отдел удалён» / «Bo'lim o'chirildi», `….position.save` «Должность сохранена» / «Lavozim saqlandi», `….position.delete` «Должность удалена» / «Lavozim o'chirildi», `history.action.hr.reason.save` «Причина сохранена» / «Sabab saqlandi».

- [ ] **Step 2: Types** — `lib/api.ts`:

```ts
export interface KadryDepartment { id: string; name: string; sortOrder: number; headEmployeeId: string | null; headName: string | null; employeeCount: number }
export interface KadryPosition { id: string; name: string; departmentId: string | null; departmentName: string | null; description: string | null; sortOrder: number; startTime: string | null; workdays: number[]; employeeCount: number }
export interface KadryStructure { departments: KadryDepartment[]; positions: KadryPosition[] }
export interface KadryReason { id: string; label: string; sortOrder: number; active: boolean }
export interface KadryBirthday { id: string; name: string; day: number; daysLeft: number; turnsAge: number | null }
export interface KadryMetrics { headcount: number; averageAge: number | null; male: number; female: number; averageTenureMonths: number | null; turnoverPercent: number | null; dismissed12m: number }
```

- [ ] **Step 3: Panel, sidebar, placeholders** — `lib/kadry-menu.ts`:

```ts
import type { MenuGroup } from "./zakupki-menu";

/** The Кадры panel (12 Oct 2026): part 1 live, parts 2–7 as placeholders under /kadry/<slug>. */
export const KADRY_MENU: MenuGroup[][] = [
  [{ title: "nav.kadry", links: [
    { label: "kadry.employees", href: "/kadry/sotrudniki" },
    { label: "kadry.structure", href: "/kadry/struktura" },
    { label: "kadry.reasons", href: "/kadry/prichiny" },
    { label: "kadry.salesdoc", href: "/kadry/salesdoc" },
  ] }],
  [{ title: "kadry.later", links: [
    { label: "kadry.attendance", href: "/kadry/poseshchaemost" },
    { label: "kadry.payroll", href: "/kadry/zarplata" },
    { label: "kadry.inventory", href: "/kadry/inventar" },
  ] }],
  [{ title: "kadry.later", links: [
    { label: "kadry.recruiting", href: "/kadry/rekruting" },
    { label: "kadry.onboarding", href: "/kadry/onbording" },
    { label: "kadry.retention", href: "/kadry/uderzhanie" },
  ] }],
];

/** Placeholder slugs for parts 2–7 → their title key. */
export const KADRY_LATER: Record<string, MessageKey> = {
  poseshchaemost: "kadry.attendance", zarplata: "kadry.payroll", inventar: "kadry.inventory",
  rekruting: "kadry.recruiting", onbording: "kadry.onboarding", uderzhanie: "kadry.retention",
};
```

(Import `MessageKey` from `@/i18n/messages`. Two groups share the title key «Скоро»; `SectionPanel` keys groups by title — make its section `key={`${ci}-${group.title}`}` if React warns about duplicate keys.)

`app/kadry/page.tsx`: `SectionPanel title={t("nav.kadry")} menu={KADRY_MENU}` followed by a `Card` «Дни рождения» listing `GET /kadry/birthdays`: each row name (link to `/kadry/sotrudniki/<id>`), «сегодня» badge when `daysLeft = 0`, else `kadry.in_days`, plus `kadry.turns` when `turnsAge`; empty text `kadry.birthdays_empty`. `app/kadry/[section]/page.tsx`: `Object.hasOwn(KADRY_LATER, section) ? <PlaceholderPage title={t(KADRY_LATER[section])} back="/kadry" /> : notFound()`. Sidebar (`app/layout.tsx`): `{ href: "/kadry", label: t("nav.kadry") }` after the Деньги item.

- [ ] **Step 4: Actions** — `app/kadry/actions.ts` (`"use server"`), the same `done()` pattern as `app/dengi/refs-actions.ts`, using `apiPost` / `apiPut` / `apiDelete` on `/kadry/departments[/<id>]`, `/kadry/positions[/<id>]`, `/kadry/reasons[/<id>]`; `revalidatePath("/kadry", "layout")`.

- [ ] **Step 5: Структура page** — `app/kadry/struktura/page.tsx` (server): `PageHeader back="/kadry" title={t("kadry.structure")}` with `HistoryButton` (`GET /kadry/history/structure`); two `Card`s. Departments: table Название · Руководитель · Сотрудников · actions («Изменить» opens `DepartmentDialog`, «Удалить» confirm dialog `kadry.confirm_delete` → `deleteDepartment`, server error shown in the dialog); «Создать подразделение» button. Positions: table Должность · Отдел · Время прихода · Рабочие дни (weekday labels joined, «—» when empty) · Сотрудников · actions; «Создать должность».
  - `DepartmentDialog` (client): `Field` Название (error under it; required → `errors.required`), `Field` Порядок (number), `Select` Руководитель (options: «Не назначен» = "" + active employees from `GET /kadry/employees` passed in by the page as `{ id, name }[]`); «Сохранить» with spinner, «Отмена» (`DialogClose`); server error under the form.
  - `PositionDialog` (client): Название, `Select` Отдел («Без отдела» = ""), Время прихода (`Input type="time"`, hint `kadry.start_time_hint`), Рабочие дни (7 toggle buttons Пн…Вс, `aria-pressed`), Описание, Порядок; same buttons.
- [ ] **Step 6: Причины page** — `app/kadry/prichiny/page.tsx`: `PageHeader back="/kadry"` + `HistoryButton` (`history/reasons`); list of `ReasonRow` (label, «скрыта» badge when hidden, «Изменить» inline rename with «Сохранить» / «Отмена» and Escape, «Скрыть» / «Вернуть») and an add row (`Field` + «Добавить причину» + «Отмена» when typed). Reuse the double-submit guard (`useRef`) from `app/dengi/ref-row.tsx`.

- [ ] **Step 7: Check** — `cd apps/web && npx next typegen && npx tsc --noEmit && npx eslint src` (full output), ru/uz key-order check, `npx tsx --test src/lib/*.test.ts`. Browser (read-only against the running app on :3000 → Supabase): sidebar «Кадры» → panel with the birthdays card (empty), placeholder pages open with back arrow, `/kadry/nope` 404, Структура and Причины render (the six seeded reasons show), ru / uz / 390 px. Do NOT create or change anything in Supabase — writes are checked in Task 8.

- [ ] **Step 8: Commit** — `git commit -m "feat(web): Кадры panel, structure and dismissal reasons pages"`

---

### Task 6: Web — Сотрудники list and create

**Files:**
- Create: `apps/web/src/lib/kadry-rules.ts`, `apps/web/src/lib/kadry-rules.test.ts`, `apps/web/src/app/kadry/sotrudniki/page.tsx`, `apps/web/src/app/kadry/sotrudniki/new/page.tsx`, `apps/web/src/app/kadry/sotrudniki/workplace-form.tsx`, `apps/web/src/app/kadry/sotrudniki/schedule-editor.tsx`
- Modify: `apps/web/src/app/kadry/actions.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/i18n/messages.ts`

**Interfaces:**
- Consumes: Task 3/4 routes, Task 5 types and actions.
- Produces:
  - `lib/kadry-rules.ts`: `employeeProblems(form: EmployeeForm, today: string): Partial<Record<keyof EmployeeForm | "workSchedule", MessageKey>>` mirroring the API rules (same order and meaning); `scheduleProblem(s): MessageKey | null`; `fullName(…)`; `ageYears(birth, today)`; `tenureLabel(months)`; constants `EMPLOYMENT_TYPES`, `GENDERS`, `EDUCATION_LEVELS`, `RELATIONS`, `DEGREES`, `DIPLOMA_STATUSES` (same values as the API).
  - Types `KadryEmployeeRow`, `KadryEmployee` (card), `EmployeeForm` (all `EmployeeInput` fields as strings / booleans / schedule).
  - Server actions `createEmployee(form) → { ok; id?; message? }`, `updateEmployee(id, form)`.
  - `<WorkplaceForm mode="create" | "edit" … />` (client): the create page and Task 7's «Трудовая книжка» edit page share it.

- [ ] **Step 1: Failing test** — `lib/kadry-rules.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ageYears, employeeProblems, scheduleProblem, tenureLabel } from "./kadry-rules";

const today = "2026-10-12";
const base = { lastName: "Нишонов", firstName: "Шоядбек" };

test("needs last and first name, and checks documents like the API", () => {
  assert.deepEqual(employeeProblems({ lastName: "", firstName: " " }, today), { lastName: "kadry.err.last_name", firstName: "kadry.err.first_name" });
  assert.deepEqual(employeeProblems({ ...base, passportSeries: "A1", passportNumber: "12345", pinfl: "123", inn: "1a" }, today), {
    passportSeries: "kadry.err.passport_series", passportNumber: "kadry.err.passport_number", pinfl: "kadry.err.pinfl", inn: "kadry.err.inn",
  });
  assert.deepEqual(employeeProblems({ ...base, pinfl: "3010 1990 1234 56", passportSeries: "ad", passportNumber: "123 45 67" }, today), {});
  assert.deepEqual(employeeProblems({ ...base, birthDate: "2026-10-13", salary: "-1", rate: "0", experienceMonths: "1.5" }, today), {
    birthDate: "kadry.err.birth_future", salary: "kadry.err.salary", rate: "kadry.err.rate", experienceMonths: "kadry.err.experience",
  });
  assert.deepEqual(employeeProblems({ ...base, salary: "6 000 000", rate: "0,5" }, today), {});
});

test("checks the schedule", () => {
  assert.equal(scheduleProblem(null), null);
  assert.equal(scheduleProblem({}), "kadry.err.no_days");
  assert.equal(scheduleProblem({ "1": { start: "", end: "18:00" } }), "kadry.err.time");
  assert.equal(scheduleProblem({ "1": { start: "18:00", end: "09:00" } }), "kadry.err.end_before_start");
  assert.equal(scheduleProblem({ "1": { start: "09:00", end: "18:00" } }), null);
});

test("ages and tenure", () => {
  assert.equal(ageYears("1990-10-13", today), 35);
  assert.equal(ageYears("1990-10-12", today), 36);
  assert.equal(tenureLabel(38), "3 г 2 мес");
  assert.equal(tenureLabel(5), "5 мес");
  assert.equal(tenureLabel(24), "2 г");
});
```

Run `npx tsx --test src/lib/kadry-rules.test.ts` · Expected: FAIL «Cannot find module».

- [ ] **Step 2: Implement `lib/kadry-rules.ts`** with the exact behaviour the test pins (Russian-only units in `tenureLabel` are fine for the metrics bar; the page passes `t` for words elsewhere). Error keys (ru / uz): `kadry.err.last_name` «Введите фамилию» / «Familiyani kiriting»; `kadry.err.first_name` «Введите имя» / «Ismni kiriting»; `kadry.err.date` «Неверная дата» / «Noto'g'ri sana»; `kadry.err.birth_future` «Дата рождения в будущем» / «Tug'ilgan sana kelajakda»; `kadry.err.passport_series` «Серия паспорта — 2 буквы» / «Pasport seriyasi — 2 ta harf»; `kadry.err.passport_number` «Номер паспорта — 7 цифр» / «Pasport raqami — 7 ta raqam»; `kadry.err.pinfl` «ПИНФЛ — 14 цифр» / «JShShIR — 14 ta raqam»; `kadry.err.inn` «ИНН — только цифры» / «STIR — faqat raqamlar»; `kadry.err.email` «Неверный email» / «Noto'g'ri email»; `kadry.err.rate` «Ставка — число больше 0» / «Stavka — 0 dan katta son»; `kadry.err.salary` «Оклад — целое число сум» / «Maosh — butun so'm»; `kadry.err.experience` «Стаж — целое число месяцев» / «Staj — butun oylar soni»; `kadry.err.no_days` «Отметьте рабочие дни» / «Ish kunlarini belgilang»; `kadry.err.time` «Укажите время» / «Vaqtni kiriting»; `kadry.err.end_before_start` «Конец должен быть позже начала» / «Tugash vaqti boshlanishdan keyin bo'lsin». Run the test · Expected: PASS.

- [ ] **Step 3: Messages** for the list and forms (ru / uz): `kadry.search` «Поиск по ФИО, должности, ПИНФЛ, телефону» / «F.I.Sh., lavozim, JShShIR, telefon bo'yicha qidirish»; `kadry.st.working` «Работают» / «Ishlayapti»; `kadry.st.terminated` «Уволены» / «Bo'shatilgan»; `kadry.st.all` «Все» / «Hammasi»; status badges `kadry.status.intern` «Стажёр» / «Stajyor», `kadry.status.active` «Активен» / «Faol», `kadry.status.terminated` «Уволен» / «Bo'shatilgan»; columns `kadry.col.n` «№», `kadry.last_name` «Фамилия» / «Familiya», `kadry.first_name` «Имя» / «Ism», `kadry.middle_name` «Отчество» / «Otasining ismi», `kadry.employment_type` «Тип занятости» / «Bandlik turi», `kadry.hired_at` «Дата приёма» / «Ishga qabul sanasi», `kadry.accounts` «Salesdoc»; employment types `kadry.et.TD` «ТД — Трудовой договор» / «MSh — Mehnat shartnomasi», `kadry.et.GPH` «ГПХ — Гражданско-правовой договор» / «FHSh — Fuqarolik-huquqiy shartnoma», `kadry.et.IP` «ИП — Индивидуальный предприниматель» / «YaTT — Yakka tartibdagi tadbirkor», `kadry.et.SZ` «СЗ — Самозанятый» / «O'zini o'zi band qilgan», short badges `kadry.et_short.TD` «ТД» / «MSh» etc.; metrics `kadry.m.headcount` «Всего сотрудников» / «Jami xodimlar», `kadry.m.headcount_hint` «работают сейчас» / «hozir ishlayapti», `kadry.m.age` «Средний возраст» / «O'rtacha yosh», `kadry.m.years` «лет» / «yosh», `kadry.m.no_data` «нет данных» / «ma'lumot yo'q», `kadry.m.gender` «Распределение по полу» / «Jins bo'yicha», `kadry.m.male_short` «М» / «E», `kadry.m.female_short` «Ж» / «A», `kadry.m.tenure` «Средний стаж» / «O'rtacha staj», `kadry.m.turnover` «Текучесть (12 мес)» / «Kadrlar qo'nimsizligi (12 oy)», `kadry.m.turnover_hint` «уволено {n} за год» / «yil davomida {n} kishi bo'shatildi»; form `kadry.create` «Создать сотрудника» / «Xodim yaratish», `kadry.new_title` «Новый сотрудник» / «Yangi xodim», `kadry.section.fio` «ФИО сотрудника» / «Xodimning F.I.Sh.», `kadry.section.workplace` «Рабочее место» / «Ish joyi», `kadry.pinfl` «ПИНФЛ» / «JShShIR», `kadry.inn` «ИНН» / «STIR», `kadry.status` «Статус» / «Holat», `kadry.remote` «Удалённый сотрудник» / «Masofaviy xodim», `kadry.remote_hint` «Не учитывать в посещаемости.» / «Davomatda hisobga olinmaydi.», `kadry.schedule` «График работы» / «Ish jadvali», `kadry.schedule_custom` «Указать часы работы» / «Ish soatlarini ko'rsatish», `kadry.schedule_by_position` «По должности» / «Lavozim bo'yicha», `kadry.rate` «Ставка» / «Stavka», `kadry.salary` «Оклад (сум)» / «Maosh (so'm)», `kadry.order_number` «Номер приказа» / «Buyruq raqami», `kadry.order_date` «Дата приказа» / «Buyruq sanasi», `kadry.experience` «Общий стаж (месяцев)» / «Umumiy staj (oy)».

- [ ] **Step 4: Types and actions** — in `lib/api.ts`:

```ts
export interface KadryAccount { kind: "agent" | "expeditor" | "supervisor"; sdId: string; name: string }
export interface KadryEmployeeRow { id: string; name: string; lastName: string; firstName: string; middleName: string | null; positionName: string | null; departmentName: string | null; status: "intern" | "active" | "terminated"; employmentType: string | null; hiredAt: string | null; accounts: KadryAccount[] }
export type WorkSchedule = Record<string, { start: string; end: string }>;
export interface KadryEmployee {
  id: string; name: string; lastName: string; firstName: string; middleName: string | null;
  phone: string | null; email: string | null; birthDate: string | null; birthPlace: string | null; nationality: string | null; citizenship: string | null;
  gender: "male" | "female" | null; passportSeries: string | null; passportNumber: string | null; passportIssuedBy: string | null;
  passportIssuedDate: string | null; passportValidUntil: string | null; pinfl: string | null; inn: string | null; address: string | null; educationLevel: string | null;
  departmentId: string | null; departmentName: string | null; positionId: string | null; positionName: string | null;
  positionSchedule: { startTime: string | null; workdays: number[] } | null;
  employmentType: string | null; remote: boolean; workSchedule: WorkSchedule | null; rate: string; salary: number | null;
  hiredAt: string | null; orderNumber: string | null; orderDate: string | null; experienceMonths: number | null;
  status: "intern" | "active" | "terminated"; terminatedAt: string | null; terminationReason: string | null; createdAt: string;
  relatives: Array<{ id: string; relation: string; fullName: string | null; birthDate: string | null; workplacePosition: string | null; residenceAddress: string | null; phone: string | null }>;
  diplomas: Array<{ id: string; degree: string | null; institution: string | null; specialty: string | null; enrolledYear: number | null; graduatedYear: number | null; seriesNumber: string | null; issuedDate: string | null; status: string | null }>;
  accounts: KadryAccount[]; canDelete: boolean;
}
```

`EmployeeForm` lives in `lib/kadry-rules.ts`: every editable field as `string` (dates `YYYY-MM-DD` or ""), `remote: boolean`, `workSchedule: WorkSchedule | null`, `status: "intern" | "active"`. Actions in `app/kadry/actions.ts`: `createEmployee(form)` → `apiPost<{ id }>("/kadry/employees", toBody(form))`; `updateEmployee(id, form)` → `apiPut`. `toBody` sends "" as null, numbers as typed strings (the API strips spaces).

- [ ] **Step 5: List page** — `app/kadry/sotrudniki/page.tsx` (server): fetch `/kadry/employees${qs({ status, department, position, search })}`, `/kadry/structure`, `/kadry/metrics`, `/kadry/history/employees`. Header: `PageHeader back="/kadry" title={t("kadry.employees")}` with «Создать сотрудника» (link button to `/kadry/sotrudniki/new`) and `HistoryButton` (`linkFor` target → `{ href: /kadry/sotrudniki/<id>, label: <name from the rows> ?? t("history.open_document") }`). Metrics bar: 5 `Card`s in a responsive grid (`grid-cols-2 md:grid-cols-5`): headcount + hint; average age + «лет» / «нет данных»; gender «М n · x%» «Ж n · y%» with a two-colour bar; tenure via `tenureLabel`; turnover «x%» + hint with `dismissed12m`. Filter form (GET): Select Отдел (all / «Без отдела» = `none` / each), Select Должность (all / each), search `Input`, Select status (`working` default / `terminated` / `all`), «Применить». Table: №, Должность, Фамилия (+ «Стажёр» `Badge` for interns, muted row for dismissed), Имя, Отчество, Тип занятости (short badge), Дата приёма (`formatDate`), Salesdoc (account names, comma-separated, «—»). Whole row links to the card (as the receipts list does). Empty: `common.empty` replaced by «Сотрудников нет» (`kadry.empty` «Сотрудников нет» / «Xodimlar yo'q»).

- [ ] **Step 6: Create page and WorkplaceForm** — `app/kadry/sotrudniki/new/page.tsx`: `PageHeader back="/kadry/sotrudniki" title={t("kadry.new_title")}`; `<WorkplaceForm mode="create" structure={…} locale today={tashkentToday()} cancelHref="/kadry/sotrudniki" />`.
  - `WorkplaceForm` (client, `translate(locale, …)`): in create mode first «ФИО сотрудника»: Фамилия, Имя, Отчество, ПИНФЛ, ИНН (`Field`s). Then «Рабочее место»: Статус (Select Стажёр / Активен, create only), Отдел (Select, «Без отдела»), Должность (Select of positions filtered by the chosen department, plus positions without department; choosing a position with a department sets that department when none is chosen), Тип занятости (Select, «—» allowed), «Удалённый сотрудник» (checkbox + hint), `ScheduleEditor`, Ставка (default «1»), Оклад, Дата приёма (`DateField`, default today), Номер приказа, Дата приказа (`DateField`, default today), Общий стаж (месяцев).
  - `ScheduleEditor` (client): checkbox «Указать часы работы» — off = `null` (shows «По должности: Пн–Сб с 08:00» from the chosen position, or «По должности» when unknown); on = 7 weekday toggles, each checked day gets start / end `Input type="time"` (default 09:00–18:00); error under the editor from `scheduleProblem`.
  - Submit: `employeeProblems` → errors under each field (`Field error=…`); then `createEmployee` / `updateEmployee`; server message (e.g. «Сотрудник с таким ПИНФЛ уже есть») in one alert above the buttons; «Сохранить» with spinner + double-submit guard (`useRef`), «Отмена» link to `cancelHref`; success → `router.push(/kadry/sotrudniki/<id>)`.

- [ ] **Step 7: Check** — tsc, eslint (full), web tests, key order. Browser read-only on :3000: list renders (empty, metrics «нет данных»), filters submit, create page renders all fields; an empty submit shows «Введите фамилию» and «Введите имя» under their fields; a bad PINFL shows its error — guard: abort every POST/PUT/DELETE in Playwright so nothing reaches Supabase. ru / uz / 390 px.

- [ ] **Step 8: Commit** — `git commit -m "feat(web): Сотрудники list and create form"`

---

### Task 7: Web — employee card, edit forms, relatives, diplomas, Salesdoc

**Files:**
- Create: `apps/web/src/app/kadry/sotrudniki/[id]/page.tsx`, `apps/web/src/app/kadry/sotrudniki/[id]/edit/page.tsx`, `apps/web/src/app/kadry/sotrudniki/[id]/lichnye/page.tsx`, `apps/web/src/app/kadry/sotrudniki/[id]/personal-form.tsx`, `apps/web/src/app/kadry/sotrudniki/[id]/status-actions.tsx`, `apps/web/src/app/kadry/sotrudniki/[id]/relative-dialog.tsx`, `apps/web/src/app/kadry/sotrudniki/[id]/diploma-dialog.tsx`, `apps/web/src/app/kadry/sotrudniki/[id]/salesdoc-tab.tsx`, `apps/web/src/app/kadry/salesdoc/page.tsx`, `apps/web/src/app/kadry/salesdoc/link-picker.tsx`
- Modify: `apps/web/src/app/kadry/actions.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/i18n/messages.ts`

**Interfaces:**
- Consumes: Task 3/4 routes; Task 6 `WorkplaceForm`, `EmployeeForm`, rules; `HistoryButton`, `HistoryList`, `Dialog`.
- Produces: server actions `dismissEmployee(id, reasonId)`, `restoreEmployee(id)`, `makePermanent(id)`, `deleteEmployee(id)`, `saveRelative(id, rid | null, body)`, `deleteRelative(id, rid)`, `saveDiploma(…)`, `deleteDiploma(…)`, `linkAccount(id, kind, sdId)`, `unlinkAccount(id, kind, sdId)` → `{ ok; message? }`; type `KadrySalesdocAccount = { kind; sdId; name; active; exists; employee: { id; name } | null }`.

- [ ] **Step 1: Messages** (ru / uz): tabs `kadry.tab.work` «Трудовая книжка» / «Mehnat daftarchasi», `kadry.tab.personal` «Личные данные» / «Shaxsiy ma'lumotlar», `kadry.tab.education` «Образование» / «Ta'lim», `kadry.tab.relatives` «Родственники» / «Qarindoshlar», `kadry.tab.salesdoc` «Salesdoc»; actions `kadry.make_permanent` «Принять на постоянную работу» / «Doimiy ishga qabul qilish», `kadry.confirm_make_permanent` «Принять «{name}» на постоянную работу?» / «"{name}" doimiy ishga qabul qilinsinmi?», `kadry.dismiss` «Уволить» / «Ishdan bo'shatish», `kadry.dismiss_title` «Увольнение сотрудника» / «Xodimni ishdan bo'shatish», `kadry.dismiss_text` «{name} будет помечен как уволенный. Это можно отменить кнопкой «Восстановить».» / «{name} ishdan bo'shatilgan deb belgilanadi. Buni «Tiklash» tugmasi bilan bekor qilish mumkin.», `kadry.reason` «Причина увольнения» / «Bo'shatish sababi», `kadry.no_reasons` «Справочник причин пуст.» / «Sabablar ro'yxati bo'sh.», `kadry.restore` «Восстановить» / «Tiklash», `kadry.confirm_restore` «Восстановить сотрудника «{name}»?» / «"{name}" xodimi tiklansinmi?», `kadry.confirm_delete_employee` «Удалить сотрудника «{name}»? Это действие необратимо.» / «"{name}" xodimi o'chirilsinmi? Bu amalni qaytarib bo'lmaydi.», `kadry.dismissed_banner` «Уволен · {date} · {reason}» / «Bo'shatilgan · {date} · {reason}», `kadry.no_reason` «Причина не указана» / «Sabab ko'rsatilmagan»; personal fields `kadry.birth_date` «Дата рождения» / «Tug'ilgan sana», `kadry.birth_place` «Место рождения» / «Tug'ilgan joyi», `kadry.gender` «Пол» / «Jinsi», `kadry.g.male` «Мужской» / «Erkak», `kadry.g.female` «Женский» / «Ayol», `kadry.citizenship` «Гражданство» / «Fuqarolik», `kadry.nationality` «Национальность» / «Millati», `kadry.passport_series` «Серия паспорта» / «Pasport seriyasi», `kadry.passport_number` «Номер паспорта» / «Pasport raqami», `kadry.passport_issued_by` «Кем выдан» / «Kim tomonidan berilgan», `kadry.passport_issued_date` «Дата выдачи» / «Berilgan sana», `kadry.passport_valid_until` «Срок действия» / «Amal qilish muddati», `kadry.address` «Адрес проживания» / «Yashash manzili», `kadry.phone` «Телефон» / «Telefon», `kadry.email` «Email», `kadry.education_level` «Уровень образования» / «Ta'lim darajasi», levels `kadry.edu.higher` «Высшее» / «Oliy», `kadry.edu.incomplete_higher` «Незаконченное высшее» / «Tugallanmagan oliy», `kadry.edu.specialized_secondary` «Среднее специальное» / «O'rta maxsus», `kadry.edu.secondary` «Среднее» / «O'rta», `kadry.edu.incomplete_secondary` «Неполное среднее» / «To'liqsiz o'rta», `kadry.age` «Возраст» / «Yoshi»; relatives `kadry.relation` «Степень родства» / «Qarindoshlik darajasi», `kadry.rel.spouse` «Супруг(а)» / «Turmush o'rtog'i», `kadry.rel.mother` «Мать» / «Onasi», `kadry.rel.father` «Отец» / «Otasi», `kadry.rel.child` «Ребёнок» / «Farzandi», `kadry.rel.sibling` «Брат/Сестра» / «Aka-uka/opa-singil», `kadry.rel.other` «Другое» / «Boshqa», `kadry.full_name` «ФИО» / «F.I.Sh.», `kadry.workplace_position` «Место работы и должность» / «Ish joyi va lavozimi», `kadry.residence` «Место жительства» / «Yashash joyi», `kadry.add_relative` «Добавить родственника» / «Qarindosh qo'shish», `kadry.err.relation` «Выберите степень родства» / «Qarindoshlik darajasini tanlang»; diplomas `kadry.degree` «Степень / уровень» / «Daraja», `kadry.institution` «Учебное заведение» / «O'quv yurti», `kadry.specialty` «Специальность» / «Mutaxassislik», `kadry.enrolled_year` «Год поступления» / «Kirgan yili», `kadry.graduated_year` «Год окончания» / «Tamomlagan yili», `kadry.series_number` «Серия и номер диплома» / «Diplom seriyasi va raqami», `kadry.issued_date` «Дата выдачи» / «Berilgan sana», `kadry.diploma_status` «Статус» / «Holati», `kadry.add_diploma` «Добавить диплом» / «Diplom qo'shish», `kadry.err.year` «Неверный год» / «Noto'g'ri yil»; Salesdoc `kadry.kind.agent` «Маршрут (агент)» / «Marshrut (agent)», `kadry.kind.expeditor` «Экспедитор» / «Ekspeditor», `kadry.kind.supervisor` «Супервайзер» / «Supervayzer», `kadry.link` «Привязать» / «Bog'lash», `kadry.unlink` «Отвязать» / «Uzish», `kadry.not_linked` «Не привязана» / «Bog'lanmagan», `kadry.gone` «нет в Salesdoc» / «Salesdoc'da yo'q», `kadry.inactive_sd` «неактивна в Salesdoc» / «Salesdoc'da nofaol», `kadry.pick_account` «Выберите учётную запись» / «Hisobni tanlang», `kadry.pick_employee` «Выберите сотрудника» / «Xodimni tanlang»; history labels for every `hr.emp.*` action: create «Создан» / «Yaratildi», edit «Изменён» / «O'zgartirildi», dismiss «Уволен» / «Bo'shatildi», restore «Восстановлен» / «Tiklandi», make_permanent «Принят на постоянную работу» / «Doimiy ishga qabul qilindi», delete «Удалён» / «O'chirildi», relative.save «Родственник сохранён» / «Qarindosh saqlandi», relative.delete «Родственник удалён» / «Qarindosh o'chirildi», diploma.save «Диплом сохранён» / «Diplom saqlandi», diploma.delete «Диплом удалён» / «Diplom o'chirildi», salesdoc.link «Привязана учётная запись Salesdoc» / «Salesdoc hisobi bog'landi», salesdoc.unlink «Отвязана учётная запись Salesdoc» / «Salesdoc hisobi uzildi».

- [ ] **Step 2: Card page** — `app/kadry/sotrudniki/[id]/page.tsx` (server; `?tab=` = `work` default / `personal` / `education` / `relatives` / `salesdoc`; tabs are links styled as the shadcn segmented tabs, `aria-current` on the active one): fetch `/kadry/employees/<id>`, its history, `/kadry/reasons`, and for the Salesdoc tab `/kadry/salesdoc-accounts`. Header: `PageHeader back="/kadry/sotrudniki" title={e.name}` with a status `Badge`, `HistoryButton`, and `<StatusActions …/>`. Under it: initials circle + key facts row (Должность, Отдел, ПИНФЛ, Возраст via `ageYears`, Дата приёма); dismissed banner `kadry.dismissed_banner` (date via `formatDateTime(tashkentInstant(terminatedAt))` → date part; reason or `kadry.no_reason`).
  - **Трудовая книжка**: definition list Отдел, Должность, Тип занятости (full label), Удалённый (Да / Нет — `common.yes` «Да» / «Ha», `common.no` «Нет» / «Yo'q»), График работы (lines «Пн 09:00–18:00» or «По должности: …»), Ставка, Оклад (`formatMoney` without decimals → use `formatQty`), Дата приёма, Приказ «№ <n> от <date>», Общий стаж (`tenureLabel`); «Изменить» → `/kadry/sotrudniki/<id>/edit`.
  - **Личные данные**: the personal fields as a definition list; «Изменить» → `/kadry/sotrudniki/<id>/lichnye`.
  - **Образование**: table Степень · Учебное заведение · Специальность · Годы (enrolled–graduated) · Серия и № · Дата выдачи · Статус · actions (edit opens `DiplomaDialog`, delete confirm); «Добавить диплом».
  - **Родственники**: table Степень родства · ФИО · Дата рождения · Место работы и должность · Место жительства · Телефон · actions; «Добавить родственника» (`RelativeDialog`; relation required, error under it).
  - **Salesdoc**: `<SalesdocTab employeeId accounts={e.accounts} all={salesdocAccounts} />` — linked accounts (kind label, name, «нет в Salesdoc» / «неактивна в Salesdoc» notes, «Отвязать» with confirm); «Привязать»: Select of kind, then a searchable picker (reuse `ProductPicker` with `{ sdId, name }` of that kind's **unlinked** accounts); errors from the API (e.g. «Эта учётная запись уже привязана к …») shown under the picker.
- [ ] **Step 3: Status actions** — `status-actions.tsx` (client): interns get «Принять на постоянную работу» (confirm dialog); non-dismissed get «Уволить» → dialog with `kadry.dismiss_text`, required Select «Причина увольнения» from active reasons (error `errors.required` under it; when none: `kadry.no_reasons` + link to `/kadry/prichiny`); dismissed get «Восстановить» (confirm). «Удалить» shown only when `canDelete` (confirm `kadry.confirm_delete_employee`) → on success `router.push("/kadry/sotrudniki")`. Every dialog: «Отмена» (`DialogClose`), spinner, double-submit guard, server error inside the dialog.
- [ ] **Step 4: Edit pages** — `[id]/edit/page.tsx`: `PageHeader back={/kadry/sotrudniki/<id>}`, `WorkplaceForm mode="edit"` prefilled from the card (no ФИО block, no status select), `cancelHref` = the card. `[id]/lichnye/page.tsx`: `PersonalForm` (client) with sections «ФИО» (Фамилия, Имя, Отчество), «Личные данные» (Дата рождения, Пол, Гражданство (placeholder «Узбекистан»), Национальность, Место рождения, Адрес проживания, Телефон, Email), «Паспорт» (Серия — max 2, upper-cased as typed; Номер — digits only, max 7; Кем выдан; Дата выдачи; Срок действия), «Документы» (ПИНФЛ, ИНН), «Образование» (Уровень). Validation from `employeeProblems`; saves through `updateEmployee(id, { ...the card's other fields, ...these })` — the API replaces all editable fields, so each form sends the full set built from the card plus its own edits.
- [ ] **Step 5: Salesdoc accounts page** — `app/kadry/salesdoc/page.tsx`: `PageHeader back="/kadry"`; filter tabs «Все» / «Не привязаны» (`?only=unlinked`); table Вид · Учётная запись (+ «неактивна в Salesdoc» / «нет в Salesdoc») · Сотрудник (link to the card, or «Не привязана» + `<LinkPicker kind sdId employees />` — searchable employee picker over working staff + «Привязать»); for linked rows «Отвязать» (confirm).
- [ ] **Step 6: Check** — tsc, eslint (full), web tests, key order. Browser read-only on :3000 with Playwright aborting every non-GET under `/kadry`: the card cannot be opened without data — check the Salesdoc accounts page lists the 15 routes, 6 expeditors and the supervisors with «Не привязана»; ru / uz / 390 px. Real create / edit / link flows run in Task 8.
- [ ] **Step 7: Commit** — `git commit -m "feat(web): employee card, edit forms, relatives, diplomas and Salesdoc links"`

---

### Task 8: Whole-flow browser check on a test instance

**Files:** none committed (scripts and screenshots in the scratchpad).

- [ ] **Step 1: Start the test instance** — API: `cd apps/api && npx nest build`; start `node dist/main.js` with `DATABASE_URL=<DATABASE_URL_TEST>`, `PORT=4100`, `SYNC_SCHEDULE=off`, `SALESDOC_CREDENTIALS_FILE=data/__missing__.json` in its own window; record the PID. Web: `cd apps/web`, `API_URL=http://localhost:4100/api npx next dev -p 3100` — if Next refuses because the owner's dev server holds `.next`, set `distDir: process.env.NEXT_DIST_DIR ?? ".next"` in `next.config.ts` only for this run with `NEXT_DIST_DIR=.next-test`, and revert that edit and delete `.next-test` afterwards (do not commit it). Apply migrations to the test DB (`DATABASE_URL=<test> npx prisma migrate deploy`), truncate it, then seed with a tsx one-off: a user `check` / «Проверка» (`hashPassword` from `src/auth/auth.service.ts`), two agents, one expeditor, one supervisor, one termination reason.
- [ ] **Step 2: Drive it** (Playwright, base http://localhost:3100):
  1. Структура: create «Склад», «склад» → «Отдел с таким названием уже есть»; position «Кладовщик» in «Склад», 08:00, Пн–Сб.
  2. Create employee: empty submit → «Введите фамилию» / «Введите имя» under the fields; then Нишонов Шоядбек, PINFL, «Склад» / «Кладовщик», Стажёр, own schedule Пн–Пт 09:00–18:00 → card opens, «Стажёр» badge, schedule lines shown.
  3. Личные данные: passport «ad» / «1234567» → saved as «AD»; a second employee with the same PINFL → «Сотрудник с таким ПИНФЛ уже есть».
  4. Diploma and relative added, edited, deleted; history shows them.
  5. Salesdoc tab: link a route; the second employee linking the same route → «… уже привязана к Нишонов Шоядбек»; Salesdoc accounts page shows the link; «Удалить» is hidden while linked.
  6. «Принять на постоянную работу» → Активен; «Уволить» without reason → error; with reason → banner; list «Работают» hides him, «Уволены» shows him; metrics change; «Восстановить».
  7. Delete department in use → refused with the count message.
  8. «История» on the list, the card, Структура and Причины.
  9. ru / uz; 390 px on the list, the card and the create form.
- [ ] **Step 3:** Stop the two test windows (kill only the recorded PIDs); revert any `next.config.ts` edit; delete `.next-test`; report results with screenshot paths.

---

## Self-review

- Spec §2 data → Task 1 (all models; supervisors resource), §3 rules → Tasks 2–4 (dismiss / restore / make permanent / delete rule / duplicates / Salesdoc uniqueness / schedule validation / metrics / history), §4 pages → Tasks 5–7, §5 API → Tasks 2–4, §6 testing → each task + Task 8.
- Deviation, noted for the executor: position→department is `Restrict` and a department with positions cannot be deleted (spec said SET NULL) — refusing keeps `groupKey` correct; the message tells the user what to do.
- Names used across tasks: `StructureService.{structure,saveDepartment,deleteDepartment,savePosition,deletePosition,reasons,saveReason}`, `EmployeesService.{list,get,create,update,dismiss,restore,makePermanent,remove,saveRelative,deleteRelative,saveDiploma,deleteDiploma,history}`, `SalesdocLinksService.{accounts,link,unlink,namesFor}`, `KadryStatsService.{metrics,birthdays}`; audit actions as listed in Task 1.
