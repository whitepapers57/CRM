# Salesdoc Mirror and Diagram Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror Andijan's Salesdoc data into PostgreSQL every 15 minutes and show the diagram's goods and money data — warehouse, SKU stock, stock-in from the supplier, sales outlets, returns, payments and the outlet/supplier settlements — in read-only screens.

**Architecture:** A NestJS `SyncModule` pulls each Salesdoc resource page by page through the existing `SalesdocClient`, maps rows with pure mapper functions, and replaces them in PostgreSQL by `sdId` inside one transaction per page. A `SettlementsModule` computes balances with SQL over the mirrored tables. The Next.js app renders server components that call the API.

**Tech Stack:** NestJS 12 (ESM, vitest), Prisma 7 + `@prisma/adapter-pg`, PostgreSQL 18, `@nestjs/schedule`, Next.js 16 (App Router, server components, server actions), Tailwind 4, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-29-distribution-finance-design.md`. This plan covers §2, §3.1, §3.3, §4.1, §4.2 (goods side only), §4.5 (goods/outlet parts), §4.7, §5, and the §7 screens Сверка, Торговые точки, Поставщик, Склад and the sync panel. Cash entries (§3.2, §4.3, §4.4) and users/roles (§6) are separate later plans. Until the roles plan lands the app has **no login** and must run on localhost only.

## Global Constraints

- Andijan only: `apand.salesdoc.io`, no `filial` sent (the login's own filial).
- Money is `Decimal(18,2)`, quantities `Decimal(18,3)`; never JS floats in storage or in API responses (money is returned as a string such as `"12345.60"`).
- Salesdoc timestamps are Tashkent wall-clock strings (`"2026-09-28 15:52:51"`). Store them as that wall-clock time in a UTC `DateTime` (append `Z`), and format them back with UTC getters. Never convert time zones.
- `debtDateExp` of `"1970-01-01"` means "no due date" → `null`.
- Order statuses: 1 New, 2 Sent, 3 Delivered, 4 Closed, 5 Cancelled. Only **3 and 4** count as owed; the same rule applies to returns.
- Payments: only `transactionType = 3` is outlet cash. Type 9 (shelf return) mirrors a return already subtracted on the goods side and must not be counted. Never pass `filter.transactionType` to `getPayment` — Salesdoc applies it after paging, so pages come back short and paging breaks.
- `getOrder` and `getOrderDefect` default to status `[1]`: always send `filter.status: [1,2,3,4,5]`; `getOrder` also needs `filter.agent: "all"`.
- Result keys: `getPaymentType` → `currency`, `getStock` and `getPurchase` → `warehouse`, `getOrderDefect` → `order`, `getShipper` → `shipper`.
- Imports inside `apps/api` use `.js` extensions (ESM, `nodenext`).
- Every user-visible string in `apps/web` goes through `t()` with keys in both `ru` and `uz` (`apps/web/src/i18n/messages.ts`), same key order in both.
- Dates shown to users are composed by hand (`dd.MM.yyyy`); never `Intl` month names (Uzbek renders "M09").
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- **An outlet that exists in orders or payments but not in `getClient`** (deleted or foreign outlet) must still appear in balances, named by its `sdId`, not silently vanish — test in Task 6.
- **Salesdoc failing halfway through a full load** (network, 401 after re-login, 5xx) must leave earlier pages saved and the next run must resume at the failed page — test in Task 5.
- **An order changing status after the first sync** (Sent → Delivered, Delivered → Cancelled) must change the outlet balance after the next incremental sync — test in Task 5.
- **The same record arriving twice** (in one page, or on two pages because data shifted between requests) must not crash the sync — test in Task 4.
- **A bad period** (`from` after `to`, `2026-13-01`, missing) must give a 400 with a readable message, and the web page must show the error, not crash — tests in Task 6 and Task 9.

---

## File Structure

```
apps/api/
  .env                                   + DATABASE_URL_TEST, SYNC_SCHEDULE
  prisma/schema.prisma                   + mirrored models, SyncCursor
  scripts/compare-balances.ts            one-off §4.7 check
  test/global-setup.ts                   migrate the test database
  vitest.config.ts                       globalSetup, serial files
  src/
    testing/test-db.ts                   PrismaService on the test DB + truncate
    salesdoc/salesdoc.client.ts          + pages() generator
    sync/
      salesdoc-date.ts                   parse wall-clock strings, day strings
      money.ts                           money()/qty() → Prisma.Decimal
      mappers.ts                         raw Salesdoc row → Prisma create data
      resources.ts                       one definition per synced resource
      sync.service.ts                    full / incremental passes, cursors, pruning
      sync.scheduler.ts                  cron: every 15 min + nightly full
      sync.controller.ts                 POST /sync/run, GET /sync/status
      sync.module.ts
    settlements/
      period.ts                          parse ?from&to
      settlements.service.ts             outlet balances, statements, summary
      settlements.controller.ts          /reconciliation, /outlets, /supplier
      settlements.module.ts
    warehouse/
      warehouse.service.ts               stock, purchases
      warehouse.controller.ts            /warehouse/*
      warehouse.module.ts
apps/web/src/
  i18n/messages.ts                       + keys; server helpers in i18n/server.ts
  lib/api.ts                             typed API calls
  lib/format.ts                          money/date formatting
  components/app/                        loader, text, field, period-filter, sidebar,
                                         locale-switch, data-table helpers
  app/layout.tsx, loading.tsx, error.tsx
  app/page.tsx                           Сверка
  app/outlets/page.tsx, app/outlets/[sdId]/page.tsx
  app/supplier/page.tsx
  app/warehouse/page.tsx, app/warehouse/purchases/[sdId]/page.tsx
  app/settings/sync/page.tsx, app/settings/sync/actions.ts
```

---

### Task 1: Page-by-page Salesdoc reading

**Files:**
- Modify: `apps/api/src/salesdoc/salesdoc.client.ts`
- Test: `apps/api/src/salesdoc/salesdoc.client.spec.ts`

**Interfaces:**
- Produces: `SalesdocClient.pages<Row>(method: string, resultKey: string, params?: SalesdocParams): AsyncGenerator<{ page: number; rows: Row[]; total: number }>` — yields each page; stops after an empty page or when `page * limit >= total`. `fetchAll` keeps its signature and is built on `pages`.

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('SalesdocClient', ...)`:

```ts
  it('pages() yields each page and starts at params.page', async () => {
    fetchMock
      .mockResolvedValueOnce(loginOk('t1'))
      .mockResolvedValueOnce(
        json({
          status: true,
          result: { order: [{ id: 3 }, { id: 4 }] },
          pagination: { limit: 2, total: 5, page: 2 },
        }),
      )
      .mockResolvedValueOnce(
        json({
          status: true,
          result: { order: [{ id: 5 }] },
          pagination: { limit: 2, total: 5, page: 3 },
        }),
      );

    const seen: Array<{ page: number; ids: number[] }> = [];
    for await (const p of client.pages<{ id: number }>('getOrder', 'order', {
      limit: 2,
      page: 2,
    })) {
      seen.push({ page: p.page, ids: p.rows.map((r) => r.id) });
    }

    expect(seen).toEqual([
      { page: 2, ids: [3, 4] },
      { page: 3, ids: [5] },
    ]);
  });

  it('pages() stops on an empty page even when total says more', async () => {
    fetchMock
      .mockResolvedValueOnce(loginOk('t1'))
      .mockResolvedValueOnce(
        json({
          status: true,
          result: { order: [] },
          pagination: { limit: 2, total: 99, page: 1 },
        }),
      );

    const pages = [];
    for await (const p of client.pages('getOrder', 'order', { limit: 2 })) {
      pages.push(p);
    }

    expect(pages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && npx vitest run src/salesdoc`
Expected: FAIL — `client.pages is not a function`.

- [ ] **Step 3: Implement** — in `salesdoc.client.ts` replace the whole `fetchAll` method with:

```ts
  /**
   * Reads a GET method page by page. Stops after an empty page or once
   * `page * limit` reaches the reported total.
   */
  async *pages<Row = Record<string, unknown>>(
    method: string,
    resultKey: string,
    params: SalesdocParams = {},
    filialId?: string,
  ): AsyncGenerator<{ page: number; rows: Row[]; total: number }> {
    const limit = params.limit ?? 1000;
    for (let page = params.page ?? 1; ; page++) {
      const res = await this.call<Record<string, Row[] | undefined>>(method, {
        params: { ...params, limit, page },
        filialId,
      });
      const rows = res.result[resultKey] ?? [];
      const total = res.pagination?.total ?? 0;
      yield { page, rows, total };
      if (rows.length === 0 || page * limit >= total) return;
    }
  }

  /** Reads every page of a GET method and returns `result[resultKey]` rows. */
  async fetchAll<Row = Record<string, unknown>>(
    method: string,
    resultKey: string,
    params: SalesdocParams = {},
    filialId?: string,
  ): Promise<Row[]> {
    const rows: Row[] = [];
    for await (const p of this.pages<Row>(method, resultKey, params, filialId)) {
      rows.push(...p.rows);
    }
    return rows;
  }
```

- [ ] **Step 4: Run all client tests**

Run: `cd apps/api && npx vitest run src/salesdoc`
Expected: PASS, 8 tests (the original 6 plus 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/salesdoc
git commit -m "feat(api): page-by-page Salesdoc reading

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Mirror schema and test database

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/.env`, `apps/api/.env.example`, `apps/api/vitest.config.ts`
- Create: `apps/api/test/global-setup.ts`, `apps/api/src/testing/test-db.ts`, `apps/api/src/testing/test-db.spec.ts`

**Interfaces:**
- Produces: Prisma models `Warehouse, Product, StockLevel, Supplier, Purchase, PurchaseLine, Outlet, Agent, Expeditor, Order, OrderLine, OutletReturn, ReturnLine, Payment, PaymentAllocation, PaymentType, Cashbox, SyncCursor` (fields exactly as below); `createTestDb(): PrismaService` and `truncateAll(db: PrismaService): Promise<void>` from `src/testing/test-db.ts`.

- [ ] **Step 1: Create the test database**

Run (PowerShell):
```powershell
$env:PGPASSWORD='PASSWORD'; psql -h 127.0.0.1 -U goodland_migrator -d goodland -c "create database distribution_finance_test"
```
Expected: `CREATE DATABASE`.

- [ ] **Step 2: Add env values** — append to `apps/api/.env`:

```
DATABASE_URL_TEST="postgresql://goodland_migrator:PASSWORD@127.0.0.1:5432/distribution_finance_test?schema=public"
SYNC_SCHEDULE=on
```

and to `apps/api/.env.example`:

```
DATABASE_URL_TEST="postgresql://USER:PASSWORD@127.0.0.1:5432/distribution_finance_test?schema=public"
SYNC_SCHEDULE=on
```

- [ ] **Step 3: Add the models** — append to `apps/api/prisma/schema.prisma`:

```prisma
// ─── Mirrored from Salesdoc (read-only in the app) ───────────────────────
// Every mirrored row: sdId = Salesdoc SD_id, raw = the row as received,
// seenAt = when a sync last saw it (rows not seen by a completed full pass
// are deleted). References between mirrored tables are plain sdId strings
// without foreign keys: Salesdoc may reference rows it no longer lists.

model PaymentType {
  sdId   String   @id
  csId   String?
  code1c String?
  name   String
  short  String?
  active Boolean
  raw    Json
  seenAt DateTime
}

model Cashbox {
  sdId   String   @id
  csId   String?
  code1c String?
  name   String
  active Boolean
  raw    Json
  seenAt DateTime
}

model Warehouse {
  sdId   String   @id
  csId   String?
  code1c String?
  name   String
  active Boolean
  raw    Json
  seenAt DateTime
}

model Supplier {
  sdId   String   @id
  csId   String?
  code1c String?
  name   String
  active Boolean
  raw    Json
  seenAt DateTime
}

model Agent {
  sdId   String   @id
  csId   String?
  code1c String?
  name   String
  active Boolean
  raw    Json
  seenAt DateTime
}

model Expeditor {
  sdId   String   @id
  csId   String?
  code1c String?
  name   String
  active Boolean
  raw    Json
  seenAt DateTime
}

model Product {
  sdId         String   @id
  csId         String?
  code1c       String?
  name         String
  active       Boolean
  packQuantity Int?
  raw          Json
  seenAt       DateTime
}

/// Current stock; sdId = "<warehouseSdId>:<productSdId>".
model StockLevel {
  sdId          String   @id
  warehouseSdId String
  productSdId   String
  productName   String
  quantity      Decimal  @db.Decimal(18, 3)
  seenAt        DateTime

  @@index([warehouseSdId])
}

model Outlet {
  sdId          String    @id
  csId          String?
  code1c        String?
  name          String
  firmName      String?
  inn           String?
  address       String?
  active        Boolean
  expeditorSdId String?
  updatedAtSd   DateTime?
  raw           Json
  seenAt        DateTime
}

/// Goods receipt from a supplier; sdId comes from purchase_id without its filial prefix.
model Purchase {
  sdId          String         @id
  csId          String?
  date          DateTime
  updatedAtSd   DateTime?
  warehouseSdId String?
  supplierSdId  String?
  total         Decimal        @db.Decimal(18, 2)
  raw           Json
  seenAt        DateTime
  lines         PurchaseLine[]

  @@index([date])
}

model PurchaseLine {
  id          Int      @id @default(autoincrement())
  purchaseSdId String
  purchase    Purchase @relation(fields: [purchaseSdId], references: [sdId], onDelete: Cascade)
  productSdId String?
  productName String
  quantity    Decimal  @db.Decimal(18, 3)
  price       Decimal  @db.Decimal(18, 2)
  amount      Decimal  @db.Decimal(18, 2)

  @@index([purchaseSdId])
}

model Order {
  sdId               String      @id
  csId               String?
  code1c             String?
  status             Int
  dateDocument       DateTime
  dateCreate         DateTime?
  dateDelivered      DateTime?
  totalSumma         Decimal     @db.Decimal(18, 2)
  discountSumma      Decimal     @db.Decimal(18, 2)
  totalAfterDiscount Decimal     @db.Decimal(18, 2)
  totalReturnsSumma  Decimal     @db.Decimal(18, 2)
  debtDateExp        DateTime?   @db.Date
  outletSdId         String?
  agentSdId          String?
  expeditorSdId      String?
  warehouseSdId      String?
  paymentTypeSdId    String?
  raw                Json
  seenAt             DateTime
  lines              OrderLine[]

  @@index([outletSdId, status, dateDocument])
  @@index([dateDocument])
}

model OrderLine {
  id          Int     @id @default(autoincrement())
  orderSdId   String
  order       Order   @relation(fields: [orderSdId], references: [sdId], onDelete: Cascade)
  productSdId String?
  productName String?
  quantity    Decimal @db.Decimal(18, 3)
  price       Decimal @db.Decimal(18, 2)
  discount    Decimal @db.Decimal(18, 2)
  summa       Decimal @db.Decimal(18, 2)
  returned    Decimal @db.Decimal(18, 3)

  @@index([orderSdId])
}

/// A return from an outlet (getOrderDefect). amount is positive.
/// Not named "Return": `return` is a JavaScript keyword and would become a client property.
model OutletReturn {
  sdId          String       @id
  csId          String?
  status        Int
  dateDocument  DateTime
  amount        Decimal      @db.Decimal(18, 2)
  outletSdId    String?
  agentSdId     String?
  expeditorSdId String?
  warehouseSdId String?
  reason        String?
  raw           Json
  seenAt        DateTime
  lines         ReturnLine[]

  @@index([outletSdId, status, dateDocument])
}

model ReturnLine {
  id          Int     @id @default(autoincrement())
  returnSdId  String
  outletReturn OutletReturn @relation(fields: [returnSdId], references: [sdId], onDelete: Cascade)
  productSdId String?
  quantity    Decimal @db.Decimal(18, 3)
  price       Decimal @db.Decimal(18, 2)
  summa       Decimal @db.Decimal(18, 2)

  @@index([returnSdId])
}

model Payment {
  sdId            String              @id
  csId            String?
  code1c          String?
  paymentDate     DateTime
  amount          Decimal             @db.Decimal(18, 2)
  transactionType Int
  paymentTypeSdId String?
  outletSdId      String?
  agentSdId       String?
  cashboxSdId     String?
  comment         String?
  raw             Json
  seenAt          DateTime
  allocations     PaymentAllocation[]

  @@index([outletSdId, transactionType, paymentDate])
}

model PaymentAllocation {
  id           Int     @id @default(autoincrement())
  paymentSdId  String
  payment      Payment @relation(fields: [paymentSdId], references: [sdId], onDelete: Cascade)
  orderSdId    String
  amount       Decimal @db.Decimal(18, 2)

  @@index([paymentSdId])
  @@index([orderSdId])
}

/// Sync progress per resource (see SyncService).
model SyncCursor {
  resource      String    @id
  lastSuccessAt DateTime?
  fullStartedAt DateTime?
  nextPage      Int?
}
```

- [ ] **Step 4: Migrate and generate**

Run: `cd apps/api && npx prisma migrate dev --name salesdoc_mirror && npx prisma generate`
Expected: migration `..._salesdoc_mirror` applied; "Generated Prisma Client".

- [ ] **Step 5: Test-database helpers** — create `apps/api/test/global-setup.ts`:

```ts
import { execSync } from 'node:child_process';

/** Brings the test database up to the current migrations before any spec runs. */
export default function setup() {
  process.loadEnvFile();
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set in apps/api/.env');
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
```

Create `apps/api/src/testing/test-db.ts`:

```ts
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';

/** A PrismaService on DATABASE_URL_TEST. Never points at the dev database. */
export function createTestDb(): PrismaService {
  try {
    process.loadEnvFile();
  } catch {
    // CI provides the env directly
  }
  const url = process.env.DATABASE_URL_TEST;
  if (!url?.includes('_test')) {
    throw new Error('DATABASE_URL_TEST must point at a *_test database');
  }
  const config = { getOrThrow: () => url } as unknown as ConfigService;
  return new PrismaService(config);
}

/** Empties every application table. Test database only. */
export async function truncateAll(db: PrismaService): Promise<void> {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
```

Replace `apps/api/vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Specs that touch the test database must not run concurrently.
    fileParallelism: false,
  },
});
```

- [ ] **Step 6: Write a harness test** — `apps/api/src/testing/test-db.spec.ts`:

```ts
import { createTestDb, truncateAll } from './test-db.js';

describe('test database', () => {
  const db = createTestDb();
  afterAll(() => db.$disconnect());

  it('is migrated and truncatable', async () => {
    await db.warehouse.create({
      data: { sdId: 'd0_1', name: 'W', active: true, raw: {}, seenAt: new Date() },
    });
    await truncateAll(db);
    expect(await db.warehouse.count()).toBe(0);
  });
});
```

- [ ] **Step 7: Run all api tests**

Run: `cd apps/api && npx vitest run`
Expected: PASS (salesdoc client specs + the harness spec); the global setup prints "No pending migrations" or applies them.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma apps/api/test/global-setup.ts apps/api/src/testing apps/api/vitest.config.ts apps/api/.env.example
git commit -m "feat(api): Salesdoc mirror schema and test database harness

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Mappers from Salesdoc rows

**Files:**
- Create: `apps/api/src/sync/salesdoc-date.ts`, `apps/api/src/sync/money.ts`, `apps/api/src/sync/mappers.ts`
- Test: `apps/api/src/sync/salesdoc-date.spec.ts`, `apps/api/src/sync/mappers.spec.ts`

**Interfaces:**
- Produces:
  - `parseSdDate(s: string | null | undefined): Date | null` — `"2026-09-28 15:52:51"` or `"2026-09-28"` → `Date` of that wall time in UTC; `null`, `""` and `"1970-01-01"` → `null`; anything unparseable throws.
  - `tashkentDay(d: Date): string` — `YYYY-MM-DD` of the real instant `d` in Asia/Tashkent.
  - `money(v: unknown): Prisma.Decimal` (2 dp), `qty(v: unknown): Prisma.Decimal` (3 dp).
  - Mapper functions, each `(raw, seenAt: Date) =>` Prisma create data: `mapPaymentType, mapCashbox, mapWarehouse, mapSupplier, mapAgent, mapExpeditor, mapProduct, mapOutlet` → flat object with `sdId`; `mapStock(raw, seenAt)` → `StockLevel` data array; `mapPurchase`, `mapOrder`, `mapReturn`, `mapPayment` → `{ row, lines }` where `lines` omit `id` and the parent key (the saver adds it).

- [ ] **Step 1: Write failing date tests** — `apps/api/src/sync/salesdoc-date.spec.ts`:

```ts
import { parseSdDate, tashkentDay } from './salesdoc-date.js';

describe('parseSdDate', () => {
  it('keeps the wall-clock time as UTC', () => {
    expect(parseSdDate('2026-09-28 15:52:51')?.toISOString()).toBe(
      '2026-09-28T15:52:51.000Z',
    );
  });
  it('accepts a bare date', () => {
    expect(parseSdDate('2022-11-10')?.toISOString()).toBe(
      '2022-11-10T00:00:00.000Z',
    );
  });
  it('treats empty and 1970-01-01 as no date', () => {
    expect(parseSdDate(null)).toBeNull();
    expect(parseSdDate('')).toBeNull();
    expect(parseSdDate('1970-01-01')).toBeNull();
  });
  it('throws on garbage', () => {
    expect(() => parseSdDate('yesterday')).toThrow('Bad Salesdoc date');
  });
});

describe('tashkentDay', () => {
  it('uses the Tashkent calendar day (UTC+5)', () => {
    expect(tashkentDay(new Date('2026-09-28T20:00:00Z'))).toBe('2026-09-29');
    expect(tashkentDay(new Date('2026-09-28T18:59:00Z'))).toBe('2026-09-28');
  });
});
```

- [ ] **Step 2: Write failing mapper tests** — `apps/api/src/sync/mappers.spec.ts` (rows are real Andijan shapes, trimmed):

```ts
import {
  mapOrder,
  mapOutlet,
  mapPayment,
  mapPurchase,
  mapReturn,
  mapStock,
  mapWarehouse,
} from './mappers.js';

const seenAt = new Date('2026-09-29T10:00:00Z');

describe('mappers', () => {
  it('maps a warehouse with Y/N active flag', () => {
    const w = mapWarehouse(
      { CS_id: 'f5-d0_3', SD_id: 'd0_3', code_1C: 'andimport', name: 'Склад Импорт', active: 'Y' },
      seenAt,
    );
    expect(w).toMatchObject({ sdId: 'd0_3', csId: 'f5-d0_3', code1c: 'andimport', name: 'Склад Импорт', active: true, seenAt });
  });

  it('maps an outlet', () => {
    const o = mapOutlet(
      {
        CS_id: 'f5-a0_1083', SD_id: 'a0_1083', code_1C: null, name: 'Икромов Улугбек Мед Колледж',
        firmName: 'Икромов Улугбек Ятт', address: 'Кургонтепа', active: 'N', inn: '605789431',
        updatedAt: '2025-02-28 12:30:36', expeditor: { CS_id: 'f5-d0_1', SD_id: 'd0_1', code_1C: 'aid1' },
      },
      seenAt,
    );
    expect(o).toMatchObject({
      sdId: 'a0_1083', name: 'Икромов Улугбек Мед Колледж', firmName: 'Икромов Улугбек Ятт',
      inn: '605789431', active: false, expeditorSdId: 'd0_1',
    });
    expect(o.updatedAtSd?.toISOString()).toBe('2025-02-28T12:30:36.000Z');
  });

  it('flattens stock into one row per warehouse and product', () => {
    const rows = mapStock(
      {
        SD_id: 'd0_3', name: 'Склад Импорт',
        products: [
          { SD_id: 'd0_99', name: 'Крутец 18*100', quantity: 65 },
          { SD_id: 'd0_95', name: 'Гренки', quantity: 0 },
        ],
      },
      seenAt,
    );
    expect(rows.map((r) => [r.sdId, r.productSdId, r.quantity.toString()])).toEqual([
      ['d0_3:d0_99', 'd0_99', '65'],
      ['d0_3:d0_95', 'd0_95', '0'],
    ]);
  });

  it('maps a purchase using purchase_id without the filial prefix', () => {
    const { row, lines } = mapPurchase(
      {
        SD_id: 'd0_6', name: 'Нич склад основной', date: '2026-09-28 15:52:51', updated: '2026-09-28 11:22:19',
        purchase_id: 'f5-d0_432', shipper: { SD_id: '1', name: 'Основной поставщик' },
        detail: [
          { SD_id: 'd0_12', name: 'Черноголовка ПЭТ 1.5 л (Буратино)', quantity: 2592, price: 9101.83, amount: 23591931.96 },
          { SD_id: 'd0_700', name: 'Тархун 1,5 л', quantity: 432, price: 9101.83, amount: 3931988.66 },
        ],
      },
      seenAt,
    );
    expect(row).toMatchObject({ sdId: 'd0_432', csId: 'f5-d0_432', warehouseSdId: 'd0_6', supplierSdId: '1' });
    expect(row.total.toString()).toBe('27523920.62');
    expect(lines[0]).toMatchObject({ productSdId: 'd0_12', productName: 'Черноголовка ПЭТ 1.5 л (Буратино)' });
    expect(lines[0].amount.toString()).toBe('23591931.96');
  });

  it('maps an order, its lines, and no due date for 1970-01-01', () => {
    const { row, lines } = mapOrder(
      {
        CS_id: 'f5-d0_111012', SD_id: 'd0_111012', code_1C: null, status: 3,
        dateCreate: '2026-09-29 09:40:28', dateDocument: '2026-09-30 09:40:28', dateDelivered: null,
        totalSumma: 65002.56, discountSumma: 14950.59, totalSummaAfterDiscount: 50051.97,
        totalReturnsSumma: 0, debtDateExp: '1970-01-01',
        client: { SD_id: 'a2_1800' }, agent: { SD_id: 'd0_5' }, expeditor: { SD_id: null },
        store: { SD_id: 'd0_6' }, paymentType: { SD_id: 'd0_2' },
        orderProducts: [
          { product: { SD_id: 'd0_11', name: 'Дюшес 1.5' }, quantity: 7, price: 8337.5, discount: 0, summa: 58362.5, returned: 0 },
        ],
      },
      seenAt,
    );
    expect(row).toMatchObject({
      sdId: 'd0_111012', status: 3, outletSdId: 'a2_1800', agentSdId: 'd0_5',
      expeditorSdId: null, warehouseSdId: 'd0_6', paymentTypeSdId: 'd0_2', debtDateExp: null,
    });
    expect(row.totalAfterDiscount.toString()).toBe('50051.97');
    expect(row.dateDocument.toISOString()).toBe('2026-09-30T09:40:28.000Z');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productSdId: 'd0_11', productName: 'Дюшес 1.5' });
  });

  it('maps a return with a positive amount and the document date', () => {
    const { row, lines } = mapReturn(
      {
        CS_id: 'f5-d0_100235', SD_id: 'd0_100235', status: 3,
        date: '2026-06-10 15:02:00', dateLoad: '2026-06-10 09:00:00',
        totalSumma: -1105043.52, summa: -1105043.52,
        client: { SD_id: 'y7_131' }, agent: { SD_id: 'd0_2' }, expeditor: { SD_id: 'd0_3' },
        store: { SD_id: 'd0_1' }, reason: null,
        defectProducts: [{ product: { SD_id: 'd0_590' }, quantity: 102, price: 10833.76, summa: 1105043.52 }],
      },
      seenAt,
    );
    expect(row.amount.toString()).toBe('1105043.52');
    expect(row.dateDocument.toISOString()).toBe('2026-06-10T09:00:00.000Z');
    expect(row.outletSdId).toBe('y7_131');
    expect(lines[0].summa.toString()).toBe('1105043.52');
  });

  it('maps a payment and its order allocations', () => {
    const { row, lines } = mapPayment(
      {
        CS_id: 'f5-a0_20274', SD_id: 'a0_20274', code_1C: null, paymentDate: '2023-11-01 10:35:09',
        amount: 24978, comment: null, transactionType: 3, paymentType: { SD_id: 'd0_2' },
        client: { SD_id: 'v0_616' }, agent: { SD_id: 'd0_4' }, cashbox: { SD_id: '1' },
        orders: [{ SD_id: 'd0_1363', amount: 24978 }],
      },
      seenAt,
    );
    expect(row).toMatchObject({ sdId: 'a0_20274', transactionType: 3, outletSdId: 'v0_616', cashboxSdId: '1' });
    expect(row.amount.toString()).toBe('24978');
    expect(lines).toEqual([expect.objectContaining({ orderSdId: 'd0_1363' })]);
  });

  it('rounds float noise to two decimals', () => {
    const { row } = mapPayment(
      { SD_id: 'x', paymentDate: '2026-01-01', amount: -350985.54000000004, transactionType: 3, orders: [] },
      seenAt,
    );
    expect(row.amount.toString()).toBe('-350985.54');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/api && npx vitest run src/sync`
Expected: FAIL — cannot find `./salesdoc-date.js` / `./mappers.js`.

- [ ] **Step 4: Implement `salesdoc-date.ts`**

```ts
const WALL = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}:\d{2}))?$/;

/**
 * Salesdoc sends Tashkent wall-clock strings. We store that wall time as if
 * it were UTC and never convert zones, so "15:52" stays "15:52" everywhere.
 */
export function parseSdDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = WALL.exec(s.trim());
  if (!m) throw new Error(`Bad Salesdoc date: ${s}`);
  if (m[1] === '1970-01-01') return null;
  const d = new Date(`${m[1]}T${m[2] ?? '00:00:00'}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad Salesdoc date: ${s}`);
  return d;
}

/** Like parseSdDate, for fields Salesdoc always fills. */
export function requireSdDate(s: string | null | undefined, field: string): Date {
  const d = parseSdDate(s);
  if (!d) throw new Error(`Salesdoc row has no ${field}`);
  return d;
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tashkent',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Tashkent calendar day of a real instant, as YYYY-MM-DD. */
export function tashkentDay(d: Date): string {
  return dayFormat.format(d);
}
```

- [ ] **Step 5: Implement `money.ts`**

```ts
import { Prisma } from '../generated/prisma/client.js';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));

/** Salesdoc money (a JS float) as an exact 2-decimal value. */
export function money(v: unknown): Prisma.Decimal {
  return new Prisma.Decimal(num(v)).toDecimalPlaces(2);
}

/** Quantities keep 3 decimals (weights, part packs). */
export function qty(v: unknown): Prisma.Decimal {
  return new Prisma.Decimal(num(v)).toDecimalPlaces(3);
}
```

- [ ] **Step 6: Implement `mappers.ts`**

```ts
import { Prisma } from '../generated/prisma/client.js';
import { money, qty } from './money.js';
import { parseSdDate, requireSdDate } from './salesdoc-date.js';

/** A Salesdoc row: loosely typed, read defensively. */
export type Raw = Record<string, any>;

const ref = (o: Raw | null | undefined): string | null => o?.SD_id ?? null;
const active = (v: unknown) => v === true || v === 'Y' || v === 1;
const json = (r: Raw) => r as Prisma.InputJsonValue;

function base(r: Raw, seenAt: Date) {
  return {
    sdId: String(r.SD_id),
    csId: r.CS_id ?? null,
    code1c: r.code_1C ?? null,
    name: String(r.name ?? r.SD_id),
    active: active(r.active),
    raw: json(r),
    seenAt,
  };
}

export const mapPaymentType = (r: Raw, seenAt: Date) => ({ ...base(r, seenAt), short: r.short ?? null });
export const mapCashbox = (r: Raw, seenAt: Date) => base(r, seenAt);
export const mapWarehouse = (r: Raw, seenAt: Date) => base(r, seenAt);
export const mapSupplier = (r: Raw, seenAt: Date) => base(r, seenAt);
export const mapAgent = (r: Raw, seenAt: Date) => base(r, seenAt);
export const mapExpeditor = (r: Raw, seenAt: Date) => base(r, seenAt);

export const mapProduct = (r: Raw, seenAt: Date) => ({
  ...base(r, seenAt),
  packQuantity: r.packQuantity == null ? null : Number(r.packQuantity),
});

export const mapOutlet = (r: Raw, seenAt: Date) => ({
  ...base(r, seenAt),
  firmName: r.firmName ?? null,
  inn: r.inn ?? null,
  address: r.address ?? null,
  expeditorSdId: ref(r.expeditor),
  updatedAtSd: parseSdDate(r.updatedAt),
});

/** getStock returns one row per warehouse with its products inside. */
export function mapStock(r: Raw, seenAt: Date) {
  const warehouseSdId = String(r.SD_id);
  return ((r.products ?? []) as Raw[]).map((p) => ({
    sdId: `${warehouseSdId}:${p.SD_id}`,
    warehouseSdId,
    productSdId: String(p.SD_id),
    productName: String(p.name ?? p.SD_id),
    quantity: qty(p.quantity),
    seenAt,
  }));
}

/** getPurchase returns the warehouse fields at top level and the receipt in purchase_id/detail. */
export function mapPurchase(r: Raw, seenAt: Date) {
  const csId = String(r.purchase_id);
  const lines = ((r.detail ?? []) as Raw[]).map((l) => ({
    productSdId: ref(l),
    productName: String(l.name ?? l.SD_id ?? ''),
    quantity: qty(l.quantity),
    price: money(l.price),
    amount: money(l.amount),
  }));
  const total = lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
  return {
    row: {
      sdId: csId.replace(/^f\d+-/, ''),
      csId,
      date: requireSdDate(r.date, 'purchase date'),
      updatedAtSd: parseSdDate(r.updated),
      warehouseSdId: r.SD_id ?? null,
      supplierSdId: ref(r.shipper),
      total,
      raw: json(r),
      seenAt,
    },
    lines,
  };
}

export function mapOrder(r: Raw, seenAt: Date) {
  return {
    row: {
      sdId: String(r.SD_id),
      csId: r.CS_id ?? null,
      code1c: r.code_1C ?? null,
      status: Number(r.status),
      dateDocument: requireSdDate(r.dateDocument ?? r.dateCreate, 'order date'),
      dateCreate: parseSdDate(r.dateCreate),
      dateDelivered: parseSdDate(r.dateDelivered),
      totalSumma: money(r.totalSumma),
      discountSumma: money(r.discountSumma),
      totalAfterDiscount: money(r.totalSummaAfterDiscount),
      totalReturnsSumma: money(r.totalReturnsSumma),
      debtDateExp: parseSdDate(r.debtDateExp),
      outletSdId: ref(r.client),
      agentSdId: ref(r.agent),
      expeditorSdId: ref(r.expeditor),
      warehouseSdId: ref(r.store),
      paymentTypeSdId: ref(r.paymentType),
      raw: json(r),
      seenAt,
    },
    lines: ((r.orderProducts ?? []) as Raw[]).map((l) => ({
      productSdId: ref(l.product),
      productName: l.product?.name ?? null,
      quantity: qty(l.quantity),
      price: money(l.price),
      discount: money(l.discount),
      summa: money(l.summa),
      returned: qty(l.returned),
    })),
  };
}

/** Salesdoc sends return totals as negative numbers; we store the positive amount. */
export function mapReturn(r: Raw, seenAt: Date) {
  return {
    row: {
      sdId: String(r.SD_id),
      csId: r.CS_id ?? null,
      status: Number(r.status),
      dateDocument: requireSdDate(r.dateLoad ?? r.date, 'return date'),
      amount: money(r.summa ?? r.totalSumma).abs(),
      outletSdId: ref(r.client),
      agentSdId: ref(r.agent),
      expeditorSdId: ref(r.expeditor),
      warehouseSdId: ref(r.store),
      reason: r.reason == null ? null : String(r.reason),
      raw: json(r),
      seenAt,
    },
    lines: ((r.defectProducts ?? []) as Raw[]).map((l) => ({
      productSdId: ref(l.product),
      quantity: qty(l.quantity),
      price: money(l.price),
      summa: money(l.summa).abs(),
    })),
  };
}

export function mapPayment(r: Raw, seenAt: Date) {
  return {
    row: {
      sdId: String(r.SD_id),
      csId: r.CS_id ?? null,
      code1c: r.code_1C ?? null,
      paymentDate: requireSdDate(r.paymentDate, 'payment date'),
      amount: money(r.amount),
      transactionType: Number(r.transactionType),
      paymentTypeSdId: ref(r.paymentType),
      outletSdId: ref(r.client),
      agentSdId: ref(r.agent),
      cashboxSdId: ref(r.cashbox),
      comment: r.comment ?? null,
      raw: json(r),
      seenAt,
    },
    lines: ((r.orders ?? []) as Raw[])
      .filter((o) => o.SD_id)
      .map((o) => ({ orderSdId: String(o.SD_id), amount: money(o.amount) })),
  };
}
```

- [ ] **Step 7: Run the tests**

Run: `cd apps/api && npx vitest run src/sync`
Expected: PASS (5 date tests, 8 mapper tests).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/sync
git commit -m "feat(api): map Salesdoc rows to mirror tables

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Resource definitions and savers

**Files:**
- Create: `apps/api/src/sync/resources.ts`
- Test: `apps/api/src/sync/resources.spec.ts`

**Interfaces:**
- Consumes: mappers from Task 3, `createTestDb`/`truncateAll` from Task 2.
- Produces:
  ```ts
  export type Tx = Prisma.TransactionClient;
  export interface ResourceDef {
    name: string;                       // SyncCursor.resource and SyncRun.method
    method: string;                     // Salesdoc method
    resultKey: string;
    mode: 'replace' | 'incremental';    // replace = every run is a full pass
    filter?: Record<string, unknown>;   // always sent
    updatedBetween?: (from: string, to: string) => Record<string, unknown>; // incremental only
    save(tx: Tx, rows: Raw[], seenAt: Date): Promise<number>;
    prune(tx: Tx, before: Date): Promise<number>;
  }
  export const RESOURCES: ResourceDef[];  // in sync order
  ```

- [ ] **Step 1: Write the failing tests** — `apps/api/src/sync/resources.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { RESOURCES } from './resources.js';

const db = createTestDb();
const byName = (n: string) => RESOURCES.find((r) => r.name === n)!;
const t1 = new Date('2026-09-29T10:00:00Z');
const t2 = new Date('2026-09-29T11:00:00Z');

const order = (sdId: string, status: number, summa: number) => ({
  SD_id: sdId, status, dateDocument: '2026-09-01 10:00:00', totalSummaAfterDiscount: summa,
  client: { SD_id: 'o1' },
  orderProducts: [{ product: { SD_id: 'p1' }, quantity: 1, price: summa, summa }],
});

describe('resources', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('lists resources with reference data before documents', () => {
    const names = RESOURCES.map((r) => r.name);
    expect(names.indexOf('outlets')).toBeLessThan(names.indexOf('orders'));
    expect(names).toEqual(
      expect.arrayContaining(['paymentTypes', 'cashboxes', 'warehouses', 'suppliers', 'agents',
        'expeditors', 'products', 'stock', 'outlets', 'purchases', 'orders', 'returns', 'payments']),
    );
  });

  it('asks Salesdoc for every order status and agent', () => {
    expect(byName('orders').filter).toEqual({ status: [1, 2, 3, 4, 5], agent: 'all' });
    expect(byName('returns').filter).toEqual({ status: [1, 2, 3, 4, 5] });
    expect(byName('payments').filter).toBeUndefined();
  });

  it('replaces an order and its lines when it arrives again', async () => {
    const orders = byName('orders');
    await db.$transaction((tx) => orders.save(tx, [order('d0_1', 2, 100)], t1));
    await db.$transaction((tx) => orders.save(tx, [order('d0_1', 3, 120)], t2));

    const saved = await db.order.findUniqueOrThrow({ where: { sdId: 'd0_1' }, include: { lines: true } });
    expect(saved.status).toBe(3);
    expect(saved.totalAfterDiscount.toString()).toBe('120');
    expect(saved.lines).toHaveLength(1);
    expect(saved.seenAt).toEqual(t2);
  });

  it('keeps the last copy when one page repeats a record', async () => {
    const orders = byName('orders');
    const n = await db.$transaction((tx) =>
      orders.save(tx, [order('d0_1', 2, 100), order('d0_1', 3, 150)], t1),
    );
    expect(n).toBe(1);
    const saved = await db.order.findUniqueOrThrow({ where: { sdId: 'd0_1' } });
    expect(saved.totalAfterDiscount.toString()).toBe('150');
  });

  it('prunes only rows not seen since the given time', async () => {
    const orders = byName('orders');
    await db.$transaction((tx) => orders.save(tx, [order('old', 3, 1)], t1));
    await db.$transaction((tx) => orders.save(tx, [order('new', 3, 1)], t2));
    const pruned = await db.$transaction((tx) => orders.prune(tx, t2));
    expect(pruned).toBe(1);
    expect((await db.order.findMany()).map((o) => o.sdId)).toEqual(['new']);
  });

  it('saves stock as one row per warehouse and product', async () => {
    await db.$transaction((tx) =>
      byName('stock').save(
        tx,
        [{ SD_id: 'w1', products: [{ SD_id: 'p1', name: 'A', quantity: 5 }, { SD_id: 'p2', name: 'B', quantity: 0 }] }],
        t1,
      ),
    );
    expect(await db.stockLevel.count()).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && npx vitest run src/sync/resources.spec.ts`
Expected: FAIL — cannot find `./resources.js`.

- [ ] **Step 3: Implement `resources.ts`**

```ts
import type { Prisma } from '../generated/prisma/client.js';
import {
  mapAgent,
  mapCashbox,
  mapExpeditor,
  mapOrder,
  mapOutlet,
  mapPayment,
  mapPaymentType,
  mapProduct,
  mapPurchase,
  mapReturn,
  mapStock,
  mapSupplier,
  mapWarehouse,
  type Raw,
} from './mappers.js';

export type Tx = Prisma.TransactionClient;

export interface ResourceDef {
  name: string;
  method: string;
  resultKey: string;
  mode: 'replace' | 'incremental';
  filter?: Record<string, unknown>;
  updatedBetween?: (from: string, to: string) => Record<string, unknown>;
  save(tx: Tx, rows: Raw[], seenAt: Date): Promise<number>;
  prune(tx: Tx, before: Date): Promise<number>;
}

/** The subset of a Prisma model delegate the savers use. */
interface FlatModel {
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>;
}

/** Last copy of each sdId wins: Salesdoc can repeat a record while data shifts. */
function lastBySdId<T extends { sdId: string }>(items: T[]): T[] {
  return [...new Map(items.map((i) => [i.sdId, i])).values()];
}

async function replaceFlat(model: FlatModel, data: Array<{ sdId: string }>): Promise<number> {
  const unique = lastBySdId(data);
  if (unique.length === 0) return 0;
  await model.deleteMany({ where: { sdId: { in: unique.map((d) => d.sdId) } } });
  return (await model.createMany({ data: unique })).count;
}

/** Parent rows plus child lines; deleting the parent cascades to the old lines. */
async function replaceWithLines<L>(
  parent: FlatModel,
  child: FlatModel,
  parentKey: string,
  mapped: Array<{ row: { sdId: string }; lines: L[] }>,
): Promise<number> {
  const unique = lastBySdId(mapped.map((m) => ({ sdId: m.row.sdId, m }))).map((u) => u.m);
  if (unique.length === 0) return 0;
  await parent.deleteMany({ where: { sdId: { in: unique.map((u) => u.row.sdId) } } });
  const count = (await parent.createMany({ data: unique.map((u) => u.row) })).count;
  const lines = unique.flatMap((u) =>
    u.lines.map((l) => ({ ...(l as Record<string, unknown>), [parentKey]: u.row.sdId })),
  );
  if (lines.length) await child.createMany({ data: lines });
  return count;
}

const pruneModel = (model: FlatModel, before: Date) =>
  model.deleteMany({ where: { seenAt: { lt: before } } }).then((r) => r.count);

const m = (tx: Tx) => ({
  paymentType: tx.paymentType as unknown as FlatModel,
  cashbox: tx.cashbox as unknown as FlatModel,
  warehouse: tx.warehouse as unknown as FlatModel,
  supplier: tx.supplier as unknown as FlatModel,
  agent: tx.agent as unknown as FlatModel,
  expeditor: tx.expeditor as unknown as FlatModel,
  product: tx.product as unknown as FlatModel,
  stockLevel: tx.stockLevel as unknown as FlatModel,
  outlet: tx.outlet as unknown as FlatModel,
  purchase: tx.purchase as unknown as FlatModel,
  purchaseLine: tx.purchaseLine as unknown as FlatModel,
  order: tx.order as unknown as FlatModel,
  orderLine: tx.orderLine as unknown as FlatModel,
  ret: tx.outletReturn as unknown as FlatModel,
  returnLine: tx.returnLine as unknown as FlatModel,
  payment: tx.payment as unknown as FlatModel,
  allocation: tx.paymentAllocation as unknown as FlatModel,
});

type Models = ReturnType<typeof m>;

function flat(
  name: string,
  method: string,
  resultKey: string,
  model: keyof Models,
  map: (r: Raw, seenAt: Date) => { sdId: string },
): ResourceDef {
  return {
    name,
    method,
    resultKey,
    mode: 'replace',
    save: (tx, rows, seenAt) => replaceFlat(m(tx)[model], rows.map((r) => map(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx)[model], before),
  };
}

const updatePeriod = (key: string) => (from: string, to: string) => ({
  period: { [key]: { from, to } },
});

/** In sync order: reference data first, then documents. */
export const RESOURCES: ResourceDef[] = [
  flat('paymentTypes', 'getPaymentType', 'currency', 'paymentType', mapPaymentType),
  flat('cashboxes', 'getCashbox', 'cashbox', 'cashbox', mapCashbox),
  flat('warehouses', 'getWarehouse', 'warehouse', 'warehouse', mapWarehouse),
  flat('suppliers', 'getShipper', 'shipper', 'supplier', mapSupplier),
  flat('agents', 'getAgent', 'agent', 'agent', mapAgent),
  flat('expeditors', 'getExpeditor', 'expeditor', 'expeditor', mapExpeditor),
  flat('products', 'getProduct', 'product', 'product', mapProduct),
  {
    name: 'stock',
    method: 'getStock',
    resultKey: 'warehouse',
    mode: 'replace',
    save: (tx, rows, seenAt) =>
      replaceFlat(m(tx).stockLevel, rows.flatMap((r) => mapStock(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).stockLevel, before),
  },
  {
    name: 'outlets',
    method: 'getClient',
    resultKey: 'client',
    mode: 'incremental',
    updatedBetween: updatePeriod('update'),
    save: (tx, rows, seenAt) => replaceFlat(m(tx).outlet, rows.map((r) => mapOutlet(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).outlet, before),
  },
  {
    name: 'purchases',
    method: 'getPurchase',
    resultKey: 'warehouse',
    mode: 'incremental',
    updatedBetween: updatePeriod('dateUpdate'),
    save: (tx, rows, seenAt) =>
      replaceWithLines(m(tx).purchase, m(tx).purchaseLine, 'purchaseSdId', rows.map((r) => mapPurchase(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).purchase, before),
  },
  {
    name: 'orders',
    method: 'getOrder',
    resultKey: 'order',
    mode: 'incremental',
    filter: { status: [1, 2, 3, 4, 5], agent: 'all' },
    updatedBetween: updatePeriod('dateUpdate'),
    save: (tx, rows, seenAt) =>
      replaceWithLines(m(tx).order, m(tx).orderLine, 'orderSdId', rows.map((r) => mapOrder(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).order, before),
  },
  {
    name: 'returns',
    method: 'getOrderDefect',
    resultKey: 'order',
    mode: 'incremental',
    filter: { status: [1, 2, 3, 4, 5] },
    updatedBetween: updatePeriod('dateUpdate'),
    save: (tx, rows, seenAt) =>
      replaceWithLines(m(tx).ret, m(tx).returnLine, 'returnSdId', rows.map((r) => mapReturn(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).ret, before),
  },
  {
    name: 'payments',
    method: 'getPayment',
    resultKey: 'payment',
    mode: 'incremental',
    // Never filter by transactionType: Salesdoc applies it after paging.
    updatedBetween: updatePeriod('dateUpdate'),
    save: (tx, rows, seenAt) =>
      replaceWithLines(m(tx).payment, m(tx).allocation, 'paymentSdId', rows.map((r) => mapPayment(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).payment, before),
  },
];
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && npx vitest run src/sync/resources.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sync/resources.ts apps/api/src/sync/resources.spec.ts
git commit -m "feat(api): Salesdoc resource definitions and savers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sync service, schedule and endpoints

**Files:**
- Create: `apps/api/src/sync/sync.service.ts`, `apps/api/src/sync/sync.scheduler.ts`, `apps/api/src/sync/sync.controller.ts`, `apps/api/src/sync/sync.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/sync/sync.service.spec.ts`

**Interfaces:**
- Consumes: `SalesdocClient.pages` (Task 1), `RESOURCES`/`ResourceDef` (Task 4), `PrismaService`.
- Produces:
  - `SyncService.run(kind: 'incremental' | 'full'): Promise<SyncReport | { alreadyRunning: true }>` where `SyncReport = { kind; results: Array<{ resource: string; status: 'succeeded' | 'failed'; records: number; error?: string }> }`.
  - `SyncService.status(): Promise<SyncStatus>` where `SyncStatus = { running: boolean; dataAsOf: string | null; resources: Array<{ resource: string; lastSuccessAt: string | null; resumePage: number | null; lastRun: { status: string; records: number; error: string | null; startedAt: string; finishedAt: string | null } | null }> }`. `dataAsOf` is the oldest `lastSuccessAt` across all resources (null until every resource has succeeded once).
  - `POST /api/sync/run` body `{ kind?: 'incremental' | 'full' }` → the run's result (waits for it). `GET /api/sync/status` → `SyncStatus`.
- Constructor for tests: `new SyncService(prisma, client, resources = RESOURCES, now = () => new Date())`.

- [ ] **Step 1: Install the scheduler**

Run: `npm install -w @df/api @nestjs/schedule`
Expected: added without peer-dependency errors.

- [ ] **Step 2: Write the failing tests** — `apps/api/src/sync/sync.service.spec.ts`. The fake client replays scripted pages; the resource list is `orders` only, to keep each test about one thing.

```ts
import type { SalesdocClient } from '../salesdoc/salesdoc.client.js';
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { RESOURCES } from './resources.js';
import { SyncService } from './sync.service.js';

const db = createTestDb();
const orders = RESOURCES.filter((r) => r.name === 'orders');

const order = (sdId: string, status: number, summa = 100) => ({
  SD_id: sdId, status, dateDocument: '2026-09-01 10:00:00', totalSummaAfterDiscount: summa,
  client: { SD_id: 'o1' }, orderProducts: [],
});

type Call = { method: string; params: Record<string, any> };

/** Pages keyed by page number; a thrown Error in place of a page simulates a failure. */
function fakeClient(pages: Record<number, unknown[] | Error>, calls: Call[] = []) {
  return {
    async *pages(method: string, _key: string, params: Record<string, any> = {}) {
      for (let page = params.page ?? 1; ; page++) {
        calls.push({ method, params: { ...params, page } });
        const rows = pages[page];
        if (rows instanceof Error) throw rows;
        yield { page, rows: rows ?? [], total: 0 };
        if (!rows || rows.length === 0) return;
      }
    },
  } as unknown as SalesdocClient;
}

describe('SyncService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('does a full pass first, saves every page and records the run', async () => {
    const svc = new SyncService(db, fakeClient({ 1: [order('a', 3)], 2: [order('b', 3)] }), orders);
    const report = await svc.run('incremental');

    expect(report).toMatchObject({ results: [{ resource: 'orders', status: 'succeeded', records: 2 }] });
    expect(await db.order.count()).toBe(2);
    const cursor = await db.syncCursor.findUniqueOrThrow({ where: { resource: 'orders' } });
    expect(cursor.lastSuccessAt).not.toBeNull();
    expect(cursor.nextPage).toBeNull();
    expect(await db.syncRun.count({ where: { method: 'orders', status: 'succeeded' } })).toBe(1);
  });

  it('keeps saved pages when a full pass fails and resumes at the failed page', async () => {
    const calls: Call[] = [];
    const failing = new SyncService(
      db, fakeClient({ 1: [order('a', 3)], 2: new Error('Salesdoc down') }, calls), orders,
    );
    const first = await failing.run('full');
    expect(first).toMatchObject({ results: [{ status: 'failed', error: 'Salesdoc down' }] });
    expect(await db.order.count()).toBe(1);
    expect((await db.syncCursor.findUniqueOrThrow({ where: { resource: 'orders' } })).nextPage).toBe(2);

    const resumeCalls: Call[] = [];
    const ok = new SyncService(db, fakeClient({ 2: [order('b', 3)] }, resumeCalls), orders);
    await ok.run('incremental');
    expect(resumeCalls[0].params.page).toBe(2);
    expect((await db.order.findMany({ orderBy: { sdId: 'asc' } })).map((o) => o.sdId)).toEqual(['a', 'b']);
  });

  it('asks only for changes since the last success, with a day of overlap', async () => {
    const t0 = new Date('2026-09-28T20:00:00Z'); // 29 Sep in Tashkent
    await new SyncService(db, fakeClient({ 1: [order('a', 2)] }), orders, () => t0).run('full');

    const calls: Call[] = [];
    const later = new Date('2026-09-29T08:00:00Z');
    await new SyncService(db, fakeClient({ 1: [order('a', 3)] }, calls), orders, () => later).run('incremental');

    expect(calls[0].params.filter).toEqual({
      status: [1, 2, 3, 4, 5], agent: 'all',
      period: { dateUpdate: { from: '2026-09-28', to: '2026-09-29' } },
    });
    expect((await db.order.findUniqueOrThrow({ where: { sdId: 'a' } })).status).toBe(3);
  });

  it('removes rows a completed full pass no longer sees, but never after an incremental pass', async () => {
    await new SyncService(db, fakeClient({ 1: [order('a', 3), order('gone', 3)] }), orders).run('full');
    await new SyncService(db, fakeClient({ 1: [order('a', 3)] }), orders).run('incremental');
    expect(await db.order.count()).toBe(2);

    await new SyncService(db, fakeClient({ 1: [order('a', 3)] }), orders).run('full');
    expect((await db.order.findMany()).map((o) => o.sdId)).toEqual(['a']);
  });

  it('refuses to start a second run while one is going', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = {
      async *pages() {
        await gate;
        yield { page: 1, rows: [], total: 0 };
      },
    } as unknown as SalesdocClient;
    const svc = new SyncService(db, slow, orders);
    const first = svc.run('incremental');
    expect(await svc.run('incremental')).toEqual({ alreadyRunning: true });
    release();
    await first;
  });

  it('reports data as of the oldest successful resource', async () => {
    const t = new Date('2026-09-29T09:30:00Z');
    await new SyncService(db, fakeClient({ 1: [] }), orders, () => t).run('incremental');
    const status = await new SyncService(db, fakeClient({}), orders).status();
    expect(status.dataAsOf).toBe(t.toISOString());
    expect(status.resources[0]).toMatchObject({ resource: 'orders', resumePage: null });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/api && npx vitest run src/sync/sync.service.spec.ts`
Expected: FAIL — cannot find `./sync.service.js`.

- [ ] **Step 4: Implement `sync.service.ts`**

```ts
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { SalesdocClient } from '../salesdoc/salesdoc.client.js';
import { RESOURCES, type ResourceDef } from './resources.js';
import { tashkentDay } from './salesdoc-date.js';

export type SyncKind = 'incremental' | 'full';

export interface SyncReport {
  kind: SyncKind;
  results: Array<{ resource: string; status: 'succeeded' | 'failed'; records: number; error?: string }>;
}

export interface SyncStatus {
  running: boolean;
  dataAsOf: string | null;
  resources: Array<{
    resource: string;
    lastSuccessAt: string | null;
    resumePage: number | null;
    lastRun: { status: string; records: number; error: string | null; startedAt: string; finishedAt: string | null } | null;
  }>;
}

export const SYNC_RESOURCES = Symbol('SYNC_RESOURCES');
export const SYNC_CLOCK = Symbol('SYNC_CLOCK');
const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);
  private running: Promise<SyncReport> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SalesdocClient,
    @Optional() @Inject(SYNC_RESOURCES) private readonly resources: ResourceDef[] = RESOURCES,
    @Optional() @Inject(SYNC_CLOCK) private readonly now: () => Date = () => new Date(),
  ) {}

  run(kind: SyncKind): Promise<SyncReport | { alreadyRunning: true }> {
    if (this.running) return Promise.resolve({ alreadyRunning: true });
    this.running = this.runAll(kind).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runAll(kind: SyncKind): Promise<SyncReport> {
    const results: SyncReport['results'] = [];
    for (const def of this.resources) {
      const run = await this.prisma.syncRun.create({ data: { method: def.name } });
      try {
        const records = await this.runResource(def, kind);
        await this.prisma.syncRun.update({
          where: { id: run.id },
          data: { status: 'succeeded', records, finishedAt: this.now() },
        });
        results.push({ resource: def.name, status: 'succeeded', records });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.log.warn(`${def.name}: ${error}`);
        await this.prisma.syncRun.update({
          where: { id: run.id },
          data: { status: 'failed', error, finishedAt: this.now() },
        });
        results.push({ resource: def.name, status: 'failed', records: 0, error });
      }
    }
    return { kind, results };
  }

  private async runResource(def: ResourceDef, kind: SyncKind): Promise<number> {
    const cursor = await this.prisma.syncCursor.findUnique({ where: { resource: def.name } });
    const needsFull =
      def.mode === 'replace' || kind === 'full' || !cursor?.lastSuccessAt || cursor.nextPage !== null;
    return needsFull
      ? this.fullPass(def, cursor?.fullStartedAt ?? null, cursor?.nextPage ?? null)
      : this.incrementalPass(def, cursor!.lastSuccessAt!);
  }

  /**
   * Reads everything, page by page, saving each page with the cursor in one
   * transaction, so a failure resumes at the failed page. Rows the completed
   * pass did not see are deleted.
   */
  private async fullPass(def: ResourceDef, resumedStart: Date | null, resumePage: number | null) {
    const startedAt = resumePage ? (resumedStart ?? this.now()) : this.now();
    const firstPage = resumePage ?? 1;
    await this.prisma.syncCursor.upsert({
      where: { resource: def.name },
      create: { resource: def.name, fullStartedAt: startedAt, nextPage: firstPage },
      update: { fullStartedAt: startedAt, nextPage: firstPage },
    });

    let records = 0;
    for await (const { page, rows } of this.client.pages(def.method, def.resultKey, {
      page: firstPage,
      ...(def.filter ? { filter: def.filter } : {}),
    })) {
      const seenAt = this.now();
      records += await this.prisma.$transaction(async (tx) => {
        const n = await def.save(tx, rows as Record<string, unknown>[], seenAt);
        await tx.syncCursor.update({ where: { resource: def.name }, data: { nextPage: page + 1 } });
        return n;
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await def.prune(tx, startedAt);
      await tx.syncCursor.update({
        where: { resource: def.name },
        data: { lastSuccessAt: startedAt, fullStartedAt: null, nextPage: null },
      });
    });
    return records;
  }

  /** Only records Salesdoc marks as updated since the last success, one day of overlap. */
  private async incrementalPass(def: ResourceDef, lastSuccessAt: Date) {
    const startedAt = this.now();
    const from = tashkentDay(new Date(lastSuccessAt.getTime() - DAY));
    const to = tashkentDay(startedAt);
    const filter = { ...(def.filter ?? {}), ...def.updatedBetween!(from, to) };

    let records = 0;
    for await (const { rows } of this.client.pages(def.method, def.resultKey, { filter })) {
      const seenAt = this.now();
      records += await this.prisma.$transaction((tx) =>
        def.save(tx, rows as Record<string, unknown>[], seenAt),
      );
    }
    await this.prisma.syncCursor.update({
      where: { resource: def.name },
      data: { lastSuccessAt: startedAt },
    });
    return records;
  }

  async status(): Promise<SyncStatus> {
    const cursors = await this.prisma.syncCursor.findMany();
    const resources = await Promise.all(
      this.resources.map(async (def) => {
        const cursor = cursors.find((c) => c.resource === def.name);
        const last = await this.prisma.syncRun.findFirst({
          where: { method: def.name },
          orderBy: { startedAt: 'desc' },
        });
        return {
          resource: def.name,
          lastSuccessAt: cursor?.lastSuccessAt?.toISOString() ?? null,
          resumePage: cursor?.nextPage ?? null,
          lastRun: last && {
            status: last.status,
            records: last.records,
            error: last.error,
            startedAt: last.startedAt.toISOString(),
            finishedAt: last.finishedAt?.toISOString() ?? null,
          },
        };
      }),
    );
    const times = resources.map((r) => r.lastSuccessAt);
    const dataAsOf = times.every(Boolean) ? [...(times as string[])].sort()[0] ?? null : null;
    return { running: this.running !== null, dataAsOf, resources };
  }
}
```

- [ ] **Step 5: Run the service tests**

Run: `cd apps/api && npx vitest run src/sync/sync.service.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Scheduler, controller, module** — `apps/api/src/sync/sync.scheduler.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncService } from './sync.service.js';

const enabled = () => process.env.SYNC_SCHEDULE !== 'off';

@Injectable()
export class SyncScheduler {
  constructor(private readonly sync: SyncService) {}

  /** Changes since the last success; the very first run becomes a full load. */
  @Cron('*/15 * * * *', { timeZone: 'Asia/Tashkent' })
  async incremental() {
    if (enabled()) await this.sync.run('incremental');
  }

  /** A nightly full pass removes records Salesdoc deleted. */
  @Cron('0 3 * * *', { timeZone: 'Asia/Tashkent' })
  async nightly() {
    if (enabled()) await this.sync.run('full');
  }
}
```

`apps/api/src/sync/sync.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { SyncService, type SyncKind } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('status')
  status() {
    return this.sync.status();
  }

  @Post('run')
  @HttpCode(200)
  run(@Body() body: { kind?: SyncKind } = {}) {
    const kind = body.kind ?? 'incremental';
    if (kind !== 'incremental' && kind !== 'full') {
      throw new BadRequestException('kind must be "incremental" or "full"');
    }
    return this.sync.run(kind);
  }
}
```

`apps/api/src/sync/sync.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SalesdocModule } from '../salesdoc/salesdoc.module.js';
import { SyncController } from './sync.controller.js';
import { SyncScheduler } from './sync.scheduler.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [SalesdocModule],
  controllers: [SyncController],
  providers: [SyncService, SyncScheduler],
  exports: [SyncService],
})
export class SyncModule {}
```

In `apps/api/src/app.module.ts` add the imports `ScheduleModule.forRoot()` (from `@nestjs/schedule`) and `SyncModule` (from `./sync/sync.module.js`) to the `imports` array, after `SalesdocModule`.

In `apps/api/test/app.e2e-spec.ts`, set `process.env.SYNC_SCHEDULE = 'off';` as the first line of `beforeAll`, and add:

```ts
  it('GET /sync/status lists every resource', async () => {
    const res = await request(app.getHttpServer()).get('/sync/status').expect(200);
    expect(res.body.resources.map((r: { resource: string }) => r.resource)).toContain('payments');
  });
```

- [ ] **Step 7: Typecheck and run everything**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx vitest run --config ./vitest.config.e2e.ts`
Expected: no type errors; all unit/integration specs PASS; e2e 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api package-lock.json
git commit -m "feat(api): Salesdoc sync with resumable full passes, 15-minute schedule

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Settlements API

**Files:**
- Create: `apps/api/src/settlements/period.ts`, `apps/api/src/settlements/settlements.service.ts`, `apps/api/src/settlements/settlements.controller.ts`, `apps/api/src/settlements/settlements.module.ts`
- Modify: `apps/api/src/app.module.ts` (import `SettlementsModule`)
- Test: `apps/api/src/settlements/period.spec.ts`, `apps/api/src/settlements/settlements.service.spec.ts`

**Interfaces:**
- Consumes: mirrored tables (Task 2), `SyncService.status()` (Task 5) for `dataAsOf`.
- Produces (money is a 2-dp string, dates ISO strings of wall time):
  - `parsePeriod(from?: string, to?: string, today?: string): Period` = `{ from: Date; toExclusive: Date; fromDay: string; toDay: string; toExclusiveDay: string }` — defaults to the first day of `today`'s month … `today`; throws `BadRequestException` on a bad date or `from > to`.
  - `SettlementsService.outletBalances(p: Period, q: { search?: string; expeditor?: string; agent?: string; nonZero?: boolean; page?: number; pageSize?: number })` → `{ total: number; rows: OutletBalance[] }`, `OutletBalance = { outletSdId; name; firmName: string|null; inn: string|null; opening; delivered; returned; paid; closing }`, sorted by `closing` descending.
  - `SettlementsService.outletStatement(outletSdId: string, p: Period)` → `{ outlet: { sdId; name; firmName; inn } ; opening; closing; rows: Array<{ kind: 'order'|'return'|'payment'; sdId; date; amount; balance }> }` — `amount` positive for orders, negative for returns and payments.
  - `SettlementsService.supplierStatement(p: Period)` → `{ opening; received; paid: "0.00"; closing; rows: Array<{ kind: 'purchase'; sdId; date; warehouseName: string|null; amount; balance }> }`.
  - `SettlementsService.summary(p: Period)` → `{ period: { from; to }; dataAsOf: string|null; outlets: { receivable; prepaid; delivered; returned; paid }; supplier: { received; paid; owed } }` — `receivable` = sum of positive closings, `prepaid` = sum of negative closings (as a positive number), `owed` = supplier closing.
  - `SettlementsService.outletFilters()` → `{ agents: Array<{ sdId; name }>; expeditors: Array<{ sdId; name }> }`.
  - Routes: `GET /api/reconciliation/summary?from&to`, `GET /api/outlets/balances?from&to&search&expeditor&agent&nonZero&page`, `GET /api/outlets/filters`, `GET /api/outlets/:sdId/statement?from&to`, `GET /api/supplier/statement?from&to`.

- [ ] **Step 1: Write failing period tests** — `apps/api/src/settlements/period.spec.ts`:

```ts
import { parsePeriod } from './period.js';

describe('parsePeriod', () => {
  it('defaults to the current month up to today', () => {
    const p = parsePeriod(undefined, undefined, '2026-09-29');
    expect(p.fromDay).toBe('2026-09-01');
    expect(p.toDay).toBe('2026-09-29');
    expect(p.toExclusive.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(p.toExclusiveDay).toBe('2026-09-30');
  });
  it('rejects an impossible date', () => {
    expect(() => parsePeriod('2026-13-01', '2026-09-29')).toThrow('from must be a date');
  });
  it('rejects from after to', () => {
    expect(() => parsePeriod('2026-09-30', '2026-09-01')).toThrow('from must not be after to');
  });
});
```

- [ ] **Step 2: Write failing settlement tests** — `apps/api/src/settlements/settlements.service.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import type { SyncService } from '../sync/sync.service.js';
import { parsePeriod } from './period.js';
import { SettlementsService } from './settlements.service.js';

const db = createTestDb();
const seenAt = new Date();
const sync = { status: async () => ({ running: false, dataAsOf: null, resources: [] }) } as unknown as SyncService;
const svc = new SettlementsService(db, sync);
const sept = parsePeriod('2026-09-01', '2026-09-30');

async function outlet(sdId: string, name: string) {
  await db.outlet.create({ data: { sdId, name, active: true, raw: {}, seenAt } });
}
async function order(sdId: string, outletSdId: string, status: number, amount: number, day: string, time = '10:00:00') {
  await db.order.create({
    data: {
      sdId, status, outletSdId, dateDocument: new Date(`${day}T${time}Z`),
      totalSumma: amount, discountSumma: 0, totalAfterDiscount: amount, totalReturnsSumma: 0, raw: {}, seenAt,
    },
  });
}
async function ret(sdId: string, outletSdId: string, status: number, amount: number, day: string) {
  await db.outletReturn.create({
    data: { sdId, status, outletSdId, amount, dateDocument: new Date(`${day}T10:00:00Z`), raw: {}, seenAt },
  });
}
async function payment(sdId: string, outletSdId: string, type: number, amount: number, day: string) {
  await db.payment.create({
    data: { sdId, outletSdId, transactionType: type, amount, paymentDate: new Date(`${day}T10:00:00Z`), raw: {}, seenAt },
  });
}

describe('SettlementsService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('balances an outlet: delivered orders minus returns minus payments', async () => {
    await outlet('o1', 'Star Shop');
    await order('before', 'o1', 3, 1000, '2026-08-20');     // opening
    await order('del', 'o1', 3, 500, '2026-09-05');
    await order('closed', 'o1', 4, 300, '2026-09-06');
    await order('sent', 'o1', 2, 999, '2026-09-07');        // not delivered yet
    await order('cancel', 'o1', 5, 999, '2026-09-08');      // never counts
    await order('late', 'o1', 3, 50, '2026-09-30', '23:30:00');   // last evening of the period
    await order('after', 'o1', 3, 777, '2026-10-01', '00:00:00'); // first second after it
    await ret('r1', 'o1', 3, 200, '2026-09-10');
    await ret('r-cancel', 'o1', 5, 999, '2026-09-10');
    await payment('p-old', 'o1', 3, 400, '2026-08-25');     // opening
    await payment('p1', 'o1', 3, 250, '2026-09-12');
    await payment('shelf', 'o1', 9, 200, '2026-09-10');     // mirrors r1, must not count

    const { rows, total } = await svc.outletBalances(sept, {});
    expect(total).toBe(1);
    expect(rows[0]).toEqual({
      outletSdId: 'o1', name: 'Star Shop', firmName: null, inn: null,
      opening: '600.00', delivered: '850.00', returned: '200.00', paid: '250.00', closing: '1000.00',
    });
  });

  it('keeps an outlet Salesdoc no longer lists, named by its id', async () => {
    await order('x', 'ghost', 3, 100, '2026-09-05');
    const { rows } = await svc.outletBalances(sept, {});
    expect(rows[0]).toMatchObject({ outletSdId: 'ghost', name: 'ghost', closing: '100.00' });
  });

  it('filters by search and hides zero balances on request', async () => {
    await outlet('o1', 'Star Shop');
    await outlet('o2', 'Moon Market');
    await order('a', 'o1', 3, 100, '2026-09-05');
    await order('b', 'o2', 3, 100, '2026-09-05');
    await payment('p', 'o2', 3, 100, '2026-09-06');

    expect((await svc.outletBalances(sept, { search: 'moon' })).rows.map((r) => r.outletSdId)).toEqual(['o2']);
    expect((await svc.outletBalances(sept, { nonZero: true })).rows.map((r) => r.outletSdId)).toEqual(['o1']);
  });

  it('builds an outlet statement with a running balance', async () => {
    await outlet('o1', 'Star Shop');
    await order('before', 'o1', 3, 1000, '2026-08-20');
    await order('del', 'o1', 3, 500, '2026-09-05');
    await ret('r1', 'o1', 3, 200, '2026-09-10');
    await payment('p1', 'o1', 3, 250, '2026-09-12');

    const s = await svc.outletStatement('o1', sept);
    expect(s.opening).toBe('1000.00');
    expect(s.rows.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ['order', '500.00', '1500.00'],
      ['return', '-200.00', '1300.00'],
      ['payment', '-250.00', '1050.00'],
    ]);
    expect(s.closing).toBe('1050.00');
  });

  it('owes the supplier every receipt while no payments exist yet', async () => {
    await db.warehouse.create({ data: { sdId: 'w1', name: 'Нич склад', active: true, raw: {}, seenAt } });
    for (const [sdId, day, total] of [['a', '2026-08-01', 1000], ['b', '2026-09-03', 500]] as const) {
      await db.purchase.create({ data: { sdId, date: new Date(`${day}T09:00:00Z`), total, warehouseSdId: 'w1', raw: {}, seenAt } });
    }
    const s = await svc.supplierStatement(sept);
    expect(s).toMatchObject({ opening: '1000.00', received: '500.00', paid: '0.00', closing: '1500.00' });
    expect(s.rows[0]).toMatchObject({ sdId: 'b', warehouseName: 'Нич склад', balance: '1500.00' });
  });

  it('summarises both sides of the diagram', async () => {
    await order('a', 'o1', 3, 500, '2026-09-05');
    await order('b', 'o2', 3, 100, '2026-09-05');
    await payment('p', 'o2', 3, 300, '2026-09-06');
    await db.purchase.create({ data: { sdId: 'pu', date: new Date('2026-09-02T09:00:00Z'), total: 700, raw: {}, seenAt } });

    const s = await svc.summary(sept);
    expect(s.outlets).toEqual({ receivable: '500.00', prepaid: '200.00', delivered: '600.00', returned: '0.00', paid: '300.00' });
    expect(s.supplier).toEqual({ received: '700.00', paid: '0.00', owed: '700.00' });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/api && npx vitest run src/settlements`
Expected: FAIL — cannot find `./period.js` / `./settlements.service.js`.

- [ ] **Step 4: Implement `period.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import { tashkentDay } from '../sync/salesdoc-date.js';

export interface Period {
  /** For Prisma client queries. */
  from: Date;
  toExclusive: Date;
  /** For raw SQL, cast with ::timestamp so no session time zone can shift them. */
  fromDay: string;
  toDay: string;
  toExclusiveDay: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function day(value: string, field: string): Date {
  const d = new Date(`${value}T00:00:00Z`);
  if (!DAY_RE.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} must be a date in YYYY-MM-DD`);
  }
  return d;
}

/** Inclusive `from`..`to` days (wall time); defaults to this month so far. */
export function parsePeriod(from?: string, to?: string, today = tashkentDay(new Date())): Period {
  const toDay = to || today;
  const fromDay = from || `${toDay.slice(0, 7)}-01`;
  const start = day(fromDay, 'from');
  const end = day(toDay, 'to');
  if (start > end) throw new BadRequestException('from must not be after to');
  const toExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return { from: start, toExclusive, fromDay, toDay, toExclusiveDay: toExclusive.toISOString().slice(0, 10) };
}
```

- [ ] **Step 5: Implement `settlements.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { SyncService } from '../sync/sync.service.js';
import type { Period } from './period.js';

type Dec = Prisma.Decimal;
const s = (v: Dec | number | null | undefined) => new Prisma.Decimal(v ?? 0).toFixed(2);

export interface OutletBalance {
  outletSdId: string;
  name: string;
  firmName: string | null;
  inn: string | null;
  opening: string;
  delivered: string;
  returned: string;
  paid: string;
  closing: string;
}

export interface BalanceQuery {
  search?: string;
  expeditor?: string;
  agent?: string;
  nonZero?: boolean;
  page?: number;
  pageSize?: number;
}

/** Outlet movements: §4.1 of the spec. Orders and returns count at status 3 or 4, payments at type 3. */
const MOVEMENTS = Prisma.sql`
  SELECT "outletSdId" AS outlet, "dateDocument" AS d, 'order' AS kind, "sdId", "totalAfterDiscount" AS amount
    FROM "Order" WHERE status IN (3, 4) AND "outletSdId" IS NOT NULL
  UNION ALL
  SELECT "outletSdId", "dateDocument", 'return', "sdId", -amount
    FROM "OutletReturn" WHERE status IN (3, 4) AND "outletSdId" IS NOT NULL
  UNION ALL
  SELECT "outletSdId", "paymentDate", 'payment', "sdId", -amount
    FROM "Payment" WHERE "transactionType" = 3 AND "outletSdId" IS NOT NULL`;

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  /** One row per outlet with opening, period movements and closing. */
  private balancesSql(p: Period) {
    return Prisma.sql`
      WITH mv AS (${MOVEMENTS}),
      agg AS (
        SELECT outlet,
          SUM(CASE WHEN d < ${p.fromDay}::timestamp THEN amount ELSE 0 END) AS opening,
          SUM(CASE WHEN d >= ${p.fromDay}::timestamp AND kind = 'order' THEN amount ELSE 0 END) AS delivered,
          SUM(CASE WHEN d >= ${p.fromDay}::timestamp AND kind = 'return' THEN -amount ELSE 0 END) AS returned,
          SUM(CASE WHEN d >= ${p.fromDay}::timestamp AND kind = 'payment' THEN -amount ELSE 0 END) AS paid,
          SUM(amount) AS closing
        FROM mv WHERE d < ${p.toExclusiveDay}::timestamp
        GROUP BY outlet
      )
      SELECT agg.*, COALESCE(o.name, agg.outlet) AS name, o."firmName", o.inn, o."expeditorSdId"
      FROM agg LEFT JOIN "Outlet" o ON o."sdId" = agg.outlet`;
  }

  async outletBalances(p: Period, q: BalanceQuery): Promise<{ total: number; rows: OutletBalance[] }> {
    const where: Prisma.Sql[] = [];
    if (q.search) {
      const like = `%${q.search}%`;
      where.push(Prisma.sql`(b.name ILIKE ${like} OR b."firmName" ILIKE ${like} OR b.inn ILIKE ${like})`);
    }
    if (q.expeditor) where.push(Prisma.sql`b."expeditorSdId" = ${q.expeditor}`);
    if (q.agent) {
      where.push(Prisma.sql`EXISTS (SELECT 1 FROM "Order" x WHERE x."outletSdId" = b.outlet AND x."agentSdId" = ${q.agent})`);
    }
    if (q.nonZero) where.push(Prisma.sql`b.closing <> 0`);
    const filter = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const pageSize = Math.min(q.pageSize ?? 50, 200);
    const offset = ((q.page ?? 1) - 1) * pageSize;

    const rows = await this.prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT b.*, COUNT(*) OVER () AS total
      FROM (${this.balancesSql(p)}) b ${filter}
      ORDER BY b.closing DESC, b.outlet
      LIMIT ${pageSize} OFFSET ${offset}`;

    return {
      total: rows.length ? Number(rows[0].total) : 0,
      rows: rows.map((r) => ({
        outletSdId: r.outlet,
        name: r.name,
        firmName: r.firmName ?? null,
        inn: r.inn ?? null,
        opening: s(r.opening),
        delivered: s(r.delivered),
        returned: s(r.returned),
        paid: s(r.paid),
        closing: s(r.closing),
      })),
    };
  }

  async outletStatement(outletSdId: string, p: Period) {
    const outlet = await this.prisma.outlet.findUnique({ where: { sdId: outletSdId } });
    const [{ opening }] = await this.prisma.$queryRaw<Array<{ opening: Dec | null }>>`
      SELECT SUM(amount) AS opening FROM (${MOVEMENTS}) mv
      WHERE outlet = ${outletSdId} AND d < ${p.fromDay}::timestamp`;
    const moves = await this.prisma.$queryRaw<Array<{ kind: 'order' | 'return' | 'payment'; sdId: string; d: Date; amount: Dec }>>`
      SELECT kind, "sdId", d, amount FROM (${MOVEMENTS}) mv
      WHERE outlet = ${outletSdId} AND d >= ${p.fromDay}::timestamp AND d < ${p.toExclusiveDay}::timestamp
      ORDER BY d, kind, "sdId"`;
    if (!outlet && moves.length === 0 && opening === null) {
      throw new NotFoundException(`Outlet ${outletSdId} not found`);
    }

    let balance = new Prisma.Decimal(opening ?? 0);
    const rows = moves.map((m) => {
      balance = balance.plus(m.amount);
      return { kind: m.kind, sdId: m.sdId, date: m.d.toISOString(), amount: s(m.amount), balance: s(balance) };
    });
    return {
      outlet: {
        sdId: outletSdId,
        name: outlet?.name ?? outletSdId,
        firmName: outlet?.firmName ?? null,
        inn: outlet?.inn ?? null,
      },
      opening: s(opening),
      closing: s(balance),
      rows,
    };
  }

  /** §4.2 goods side; supplier payments arrive with the cash-entries plan. */
  async supplierStatement(p: Period) {
    const [{ opening }] = await this.prisma.$queryRaw<Array<{ opening: Dec | null }>>`
      SELECT SUM(total) AS opening FROM "Purchase" WHERE date < ${p.fromDay}::timestamp`;
    const purchases = await this.prisma.purchase.findMany({
      where: { date: { gte: p.from, lt: p.toExclusive } },
      orderBy: [{ date: 'asc' }, { sdId: 'asc' }],
    });
    const warehouses = new Map(
      (await this.prisma.warehouse.findMany()).map((w) => [w.sdId, w.name]),
    );
    let balance = new Prisma.Decimal(opening ?? 0);
    let received = new Prisma.Decimal(0);
    const rows = purchases.map((pu) => {
      balance = balance.plus(pu.total);
      received = received.plus(pu.total);
      return {
        kind: 'purchase' as const,
        sdId: pu.sdId,
        date: pu.date.toISOString(),
        warehouseName: pu.warehouseSdId ? (warehouses.get(pu.warehouseSdId) ?? null) : null,
        amount: s(pu.total),
        balance: s(balance),
      };
    });
    return { opening: s(opening), received: s(received), paid: s(0), closing: s(balance), rows };
  }

  async summary(p: Period) {
    const [o] = await this.prisma.$queryRaw<Array<Record<string, Dec | null>>>`
      SELECT
        SUM(CASE WHEN closing > 0 THEN closing ELSE 0 END) AS receivable,
        SUM(CASE WHEN closing < 0 THEN -closing ELSE 0 END) AS prepaid,
        SUM(delivered) AS delivered, SUM(returned) AS returned, SUM(paid) AS paid
      FROM (${this.balancesSql(p)}) b`;
    const supplier = await this.supplierStatement(p);
    const { dataAsOf } = await this.sync.status();
    return {
      period: { from: p.fromDay, to: p.toDay },
      dataAsOf,
      outlets: {
        receivable: s(o.receivable),
        prepaid: s(o.prepaid),
        delivered: s(o.delivered),
        returned: s(o.returned),
        paid: s(o.paid),
      },
      supplier: { received: supplier.received, paid: supplier.paid, owed: supplier.closing },
    };
  }

  async outletFilters() {
    const [agents, expeditors] = await Promise.all([
      this.prisma.agent.findMany({ orderBy: { name: 'asc' }, select: { sdId: true, name: true } }),
      this.prisma.expeditor.findMany({ orderBy: { name: 'asc' }, select: { sdId: true, name: true } }),
    ]);
    return { agents, expeditors };
  }
}
```

- [ ] **Step 6: Controller and module** — `apps/api/src/settlements/settlements.controller.ts`:

```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { parsePeriod } from './period.js';
import { SettlementsService } from './settlements.service.js';

@Controller()
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('reconciliation/summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.settlements.summary(parsePeriod(from, to));
  }

  @Get('outlets/filters')
  filters() {
    return this.settlements.outletFilters();
  }

  @Get('outlets/balances')
  balances(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('expeditor') expeditor?: string,
    @Query('agent') agent?: string,
    @Query('nonZero') nonZero?: string,
    @Query('page') page?: string,
  ) {
    return this.settlements.outletBalances(parsePeriod(from, to), {
      search: search?.trim() || undefined,
      expeditor: expeditor || undefined,
      agent: agent || undefined,
      nonZero: nonZero === 'true',
      page: Math.max(1, Number(page) || 1),
    });
  }

  @Get('outlets/:sdId/statement')
  statement(@Param('sdId') sdId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.settlements.outletStatement(sdId, parsePeriod(from, to));
  }

  @Get('supplier/statement')
  supplier(@Query('from') from?: string, @Query('to') to?: string) {
    return this.settlements.supplierStatement(parsePeriod(from, to));
  }
}
```

`apps/api/src/settlements/settlements.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module.js';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [SyncModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
})
export class SettlementsModule {}
```

Add `SettlementsModule` (from `./settlements/settlements.module.js`) to `AppModule.imports`. In `test/app.e2e-spec.ts` add:

```ts
  it('GET /reconciliation/summary rejects a reversed period', () => {
    return request(app.getHttpServer())
      .get('/reconciliation/summary?from=2026-09-30&to=2026-09-01')
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('from must not be after to'));
  });
```

- [ ] **Step 7: Run everything**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx vitest run --config ./vitest.config.e2e.ts`
Expected: no type errors; settlement (6) and period (3) specs PASS with the rest; e2e 4 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/settlements apps/api/src/app.module.ts apps/api/test/app.e2e-spec.ts
git commit -m "feat(api): outlet and supplier settlements

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Warehouse API

**Files:**
- Create: `apps/api/src/warehouse/warehouse.service.ts`, `apps/api/src/warehouse/warehouse.controller.ts`, `apps/api/src/warehouse/warehouse.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/warehouse/warehouse.service.spec.ts`

**Interfaces:**
- Consumes: `parsePeriod` (Task 6), mirrored tables.
- Produces:
  - `WarehouseService.stock(q: { warehouse?: string; search?: string; includeZero?: boolean })` → `{ warehouses: Array<{ sdId; name }>; rows: Array<{ warehouseSdId; warehouseName; productSdId; productName; quantity: string }> }` sorted by warehouse name, then product name.
  - `WarehouseService.purchases(p: Period)` → `{ total: string; rows: Array<{ sdId; date; warehouseName: string|null; supplierName: string|null; lineCount: number; total: string }> }` newest first.
  - `WarehouseService.purchase(sdId: string)` → `{ sdId; date; warehouseName; supplierName; total; lines: Array<{ productSdId; productName; quantity; price; amount }> }` or `NotFoundException`.
  - Routes: `GET /api/warehouse/stock?warehouse&search&includeZero`, `GET /api/warehouse/purchases?from&to`, `GET /api/warehouse/purchases/:sdId`.

- [ ] **Step 1: Write the failing tests** — `apps/api/src/warehouse/warehouse.service.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { parsePeriod } from '../settlements/period.js';
import { WarehouseService } from './warehouse.service.js';

const db = createTestDb();
const svc = new WarehouseService(db);
const seenAt = new Date();

describe('WarehouseService', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.warehouse.createMany({
      data: [
        { sdId: 'w1', name: 'Нич склад основной', active: true, raw: {}, seenAt },
        { sdId: 'w2', name: 'Склад Импорт', active: true, raw: {}, seenAt },
      ],
    });
    await db.supplier.create({ data: { sdId: '1', name: 'Основной поставщик', active: true, raw: {}, seenAt } });
    await db.stockLevel.createMany({
      data: [
        { sdId: 'w1:p1', warehouseSdId: 'w1', productSdId: 'p1', productName: 'Дюшес 1.5', quantity: 65, seenAt },
        { sdId: 'w1:p2', warehouseSdId: 'w1', productSdId: 'p2', productName: 'Байкал', quantity: 0, seenAt },
        { sdId: 'w2:p1', warehouseSdId: 'w2', productSdId: 'p1', productName: 'Дюшес 1.5', quantity: 10, seenAt },
      ],
    });
  });
  afterAll(() => db.$disconnect());

  it('lists non-zero stock with warehouse names', async () => {
    const { rows, warehouses } = await svc.stock({});
    expect(warehouses.map((w) => w.name)).toEqual(['Нич склад основной', 'Склад Импорт']);
    expect(rows.map((r) => [r.warehouseName, r.productName, r.quantity])).toEqual([
      ['Нич склад основной', 'Дюшес 1.5', '65.000'],
      ['Склад Импорт', 'Дюшес 1.5', '10.000'],
    ]);
  });

  it('filters stock by warehouse, search, and can include zeros', async () => {
    expect((await svc.stock({ warehouse: 'w1', includeZero: true })).rows).toHaveLength(2);
    expect((await svc.stock({ search: 'байкал', includeZero: true })).rows.map((r) => r.productSdId)).toEqual(['p2']);
  });

  it('lists purchases in the period with totals, and opens one with its lines', async () => {
    await db.purchase.create({
      data: {
        sdId: 'd0_432', date: new Date('2026-09-28T15:52:51Z'), total: 1500, warehouseSdId: 'w1', supplierSdId: '1',
        raw: {}, seenAt,
        lines: { create: [{ productSdId: 'p1', productName: 'Дюшес 1.5', quantity: 100, price: 15, amount: 1500 }] },
      },
    });
    const list = await svc.purchases(parsePeriod('2026-09-01', '2026-09-30'));
    expect(list.total).toBe('1500.00');
    expect(list.rows[0]).toMatchObject({ sdId: 'd0_432', warehouseName: 'Нич склад основной', supplierName: 'Основной поставщик', lineCount: 1 });

    const one = await svc.purchase('d0_432');
    expect(one.lines[0]).toMatchObject({ productName: 'Дюшес 1.5', quantity: '100.000', price: '15.00', amount: '1500.00' });
    await expect(svc.purchase('nope')).rejects.toThrow('Purchase nope not found');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && npx vitest run src/warehouse`
Expected: FAIL — cannot find `./warehouse.service.js`.

- [ ] **Step 3: Implement** — `apps/api/src/warehouse/warehouse.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Period } from '../settlements/period.js';

const s2 = (v: Prisma.Decimal) => v.toFixed(2);
const s3 = (v: Prisma.Decimal) => v.toFixed(3);

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  private async names() {
    const [warehouses, suppliers] = await Promise.all([
      this.prisma.warehouse.findMany({ orderBy: { name: 'asc' }, select: { sdId: true, name: true } }),
      this.prisma.supplier.findMany({ select: { sdId: true, name: true } }),
    ]);
    return {
      warehouses,
      warehouse: new Map(warehouses.map((w) => [w.sdId, w.name])),
      supplier: new Map(suppliers.map((x) => [x.sdId, x.name])),
    };
  }

  async stock(q: { warehouse?: string; search?: string; includeZero?: boolean }) {
    const n = await this.names();
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        ...(q.warehouse ? { warehouseSdId: q.warehouse } : {}),
        ...(q.search ? { productName: { contains: q.search, mode: 'insensitive' } } : {}),
        ...(q.includeZero ? {} : { quantity: { not: 0 } }),
      },
    });
    const rows = levels
      .map((l) => ({
        warehouseSdId: l.warehouseSdId,
        warehouseName: n.warehouse.get(l.warehouseSdId) ?? l.warehouseSdId,
        productSdId: l.productSdId,
        productName: l.productName,
        quantity: s3(l.quantity),
      }))
      .sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, 'ru') || a.productName.localeCompare(b.productName, 'ru'));
    return { warehouses: n.warehouses, rows };
  }

  async purchases(p: Period) {
    const n = await this.names();
    const list = await this.prisma.purchase.findMany({
      where: { date: { gte: p.from, lt: p.toExclusive } },
      orderBy: [{ date: 'desc' }, { sdId: 'desc' }],
      include: { _count: { select: { lines: true } } },
    });
    const total = list.reduce((sum, x) => sum.plus(x.total), new Prisma.Decimal(0));
    return {
      total: s2(total),
      rows: list.map((x) => ({
        sdId: x.sdId,
        date: x.date.toISOString(),
        warehouseName: x.warehouseSdId ? (n.warehouse.get(x.warehouseSdId) ?? null) : null,
        supplierName: x.supplierSdId ? (n.supplier.get(x.supplierSdId) ?? null) : null,
        lineCount: x._count.lines,
        total: s2(x.total),
      })),
    };
  }

  async purchase(sdId: string) {
    const x = await this.prisma.purchase.findUnique({
      where: { sdId },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    if (!x) throw new NotFoundException(`Purchase ${sdId} not found`);
    const n = await this.names();
    return {
      sdId: x.sdId,
      date: x.date.toISOString(),
      warehouseName: x.warehouseSdId ? (n.warehouse.get(x.warehouseSdId) ?? null) : null,
      supplierName: x.supplierSdId ? (n.supplier.get(x.supplierSdId) ?? null) : null,
      total: s2(x.total),
      lines: x.lines.map((l) => ({
        productSdId: l.productSdId,
        productName: l.productName,
        quantity: s3(l.quantity),
        price: s2(l.price),
        amount: s2(l.amount),
      })),
    };
  }
}
```

`apps/api/src/warehouse/warehouse.controller.ts`:

```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { parsePeriod } from '../settlements/period.js';
import { WarehouseService } from './warehouse.service.js';

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get('stock')
  stock(
    @Query('warehouse') warehouse?: string,
    @Query('search') search?: string,
    @Query('includeZero') includeZero?: string,
  ) {
    return this.warehouse.stock({
      warehouse: warehouse || undefined,
      search: search?.trim() || undefined,
      includeZero: includeZero === 'true',
    });
  }

  @Get('purchases')
  purchases(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.purchases(parsePeriod(from, to));
  }

  @Get('purchases/:sdId')
  purchase(@Param('sdId') sdId: string) {
    return this.warehouse.purchase(sdId);
  }
}
```

`apps/api/src/warehouse/warehouse.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller.js';
import { WarehouseService } from './warehouse.service.js';

@Module({
  controllers: [WarehouseController],
  providers: [WarehouseService],
})
export class WarehouseModule {}
```

Add `WarehouseModule` to `AppModule.imports`.

- [ ] **Step 4: Run everything**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: no type errors; warehouse specs (3) PASS with the rest.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/warehouse apps/api/src/app.module.ts
git commit -m "feat(api): warehouse stock and goods receipts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: First full sync against Salesdoc and the one-off balance check

**Files:**
- Create: `apps/api/scripts/compare-balances.ts`
- Modify: `apps/api/package.json` (devDependency `tsx`)

**Interfaces:**
- Consumes: the running API (Tasks 5–7), `SalesdocClient`, `SettlementsService` SQL via Prisma.
- Produces: a printed report, and the numbers recorded in the commit message. No app code depends on it.

- [ ] **Step 1: Start the API and run a full sync**

Run: `npm run dev:api` (background), then:
```bash
curl -s -X POST localhost:4000/api/sync/run -H "content-type: application/json" -d '{"kind":"full"}' --max-time 3600
```
Expected: JSON `results` with every resource `"succeeded"`. Record counts: orders ≈ 110,000, payments ≈ 100,900, returns ≈ 962, purchases ≈ 432, outlets ≈ 1,893, products ≈ 575. If a resource failed, read its `error`, fix, and re-run — the run resumes at the failed page.

- [ ] **Step 2: Run an incremental sync and confirm it is fast**

Run: `curl -s -X POST localhost:4000/api/sync/run -H "content-type: application/json" -d '{}'`
Expected: every resource `"succeeded"`; incremental resources report only the day's changes (hundreds, not thousands).

- [ ] **Step 3: Write the comparison script** — `npm install -w @df/api -D tsx`, then `apps/api/scripts/compare-balances.ts`:

```ts
/**
 * One-off check (spec §4.7): our computed outlet closing balance vs
 * Salesdoc's getBalance (negative there = debt, so compare ours with -balance).
 * Run: cd apps/api && npx tsx scripts/compare-balances.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client.js';
import { SalesdocClient } from '../src/salesdoc/salesdoc.client.js';
import { SalesdocCredentialsStore } from '../src/salesdoc/salesdoc-credentials.store.js';

process.loadEnvFile();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const client = new SalesdocClient(new SalesdocCredentialsStore());

const ours = await prisma.$queryRaw<Array<{ outlet: string; closing: Prisma.Decimal }>>`
  SELECT outlet, SUM(amount) AS closing FROM (
    SELECT "outletSdId" AS outlet, "totalAfterDiscount" AS amount FROM "Order" WHERE status IN (3,4)
    UNION ALL SELECT "outletSdId", -amount FROM "OutletReturn" WHERE status IN (3,4)
    UNION ALL SELECT "outletSdId", -amount FROM "Payment" WHERE "transactionType" = 3
  ) mv WHERE outlet IS NOT NULL GROUP BY outlet`;
const mine = new Map(ours.map((r) => [r.outlet, new Prisma.Decimal(r.closing)]));

const theirs = await client.fetchAll<{ SD_id: string; name: string; balance: number }>('getBalance', 'balance');
let equal = 0;
const diffs: Array<{ sdId: string; name: string; ours: string; salesdoc: string; diff: string }> = [];
for (const b of theirs) {
  const sd = new Prisma.Decimal(-b.balance).toDecimalPlaces(2);
  const o = (mine.get(b.SD_id) ?? new Prisma.Decimal(0)).toDecimalPlaces(2);
  if (o.minus(sd).abs().lte(1)) equal++;
  else diffs.push({ sdId: b.SD_id, name: b.name, ours: o.toFixed(2), salesdoc: sd.toFixed(2), diff: o.minus(sd).toFixed(2) });
}
diffs.sort((a, b) => Math.abs(Number(b.diff)) - Math.abs(Number(a.diff)));
console.log(`Outlets compared: ${theirs.length}; equal within 1 UZS: ${equal}; different: ${diffs.length}`);
console.table(diffs.slice(0, 20));
await prisma.$disconnect();
```

- [ ] **Step 4: Run it**

Run: `cd apps/api && npx tsx scripts/compare-balances.ts`
Expected: a summary line and the 20 largest differences. **Do not change settlement rules to force a match.** Report the numbers to the owner: if most outlets match, the §4.1 rule holds; if many differ by a constant per outlet, Salesdoc holds opening balances or write-offs outside the mirrored data — that is a question for the owner, not a code fix.

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts apps/api/package.json package-lock.json
git commit -m "chore(api): one-off outlet balance comparison with Salesdoc

First full sync: <paste resource counts>. Balance check: <paste summary line>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Web foundation — layout, navigation, shared components

**Files:**
- Create: `apps/web/src/i18n/server.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/components/app/loader.tsx`, `apps/web/src/components/app/text.tsx`, `apps/web/src/components/app/field.tsx`, `apps/web/src/components/app/period-filter.tsx`, `apps/web/src/components/app/sidebar.tsx`, `apps/web/src/components/app/locale-switch.tsx`, `apps/web/src/components/app/select.tsx`, `apps/web/src/components/app/page-header.tsx`, `apps/web/src/components/app/api-error.tsx`, `apps/web/src/app/loading.tsx`, `apps/web/src/app/error.tsx`
- Modify: `apps/web/src/i18n/messages.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/app/layout.tsx`
- Test: `apps/web/src/lib/format.test.ts` (run with `node --test` via `tsx`)

**Interfaces:**
- Produces:
  - `getT(): Promise<(key: MessageKey, vars?: Record<string, string>) => string>` and `getLocale(): Promise<Locale>` (server, from the `locale` cookie, default `ru`).
  - `formatMoney(v: string): string` → `"1 234 567,89"`-style with narrow no-break spaces (`ru-RU`), `formatQty(v: string)`, `formatDate(iso: string): string` → `dd.MM.yyyy`, `formatDateTime(iso: string): string` → `dd.MM.yyyy HH:mm` (UTC getters: wall time).
  - `apiGet<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }>` — replaces the old `T | null` version; `apiPost<T>(path, body)` same shape.
  - Components: `<Loader />`, `<Text variant="title|subtitle|body|caption|error" truncate?>`, `<Field label error? {...inputProps} />` (the universal Input), `<Select {...selectProps} />`, `<PeriodFilter from to />` (client; updates `?from&to`), `<PageHeader title subtitle? />`, `<ApiError message />`, `<Sidebar />`.

- [ ] **Step 1: Add shadcn pieces**

Run: `cd apps/web && npx shadcn@latest add input label table -y`
Expected: `input.tsx`, `label.tsx`, `table.tsx` created in `src/components/ui`.

- [ ] **Step 2: Write the failing format tests** — `apps/web/src/lib/format.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime, formatMoney, formatQty } from "./format";

test("money groups thousands and keeps two decimals", () => {
  assert.equal(formatMoney("1234567.8").replace(/\s/g, " "), "1 234 567,80");
  assert.equal(formatMoney("-350985.54").replace(/\s/g, " "), "-350 985,54");
});

test("quantity drops trailing zeros", () => {
  assert.equal(formatQty("65.000"), "65");
  assert.equal(formatQty("1.500"), "1,5");
});

test("dates are wall time, composed by hand", () => {
  assert.equal(formatDate("2026-09-28T15:52:51.000Z"), "28.09.2026");
  assert.equal(formatDateTime("2026-09-28T15:52:51.000Z"), "28.09.2026 15:52");
});
```

Run: `cd apps/web && npx --yes tsx --test src/lib/format.test.ts`
Expected: FAIL — cannot find `./format.ts`.

- [ ] **Step 3: Implement `apps/web/src/lib/format.ts`**

```ts
const moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const pad = (n: number) => String(n).padStart(2, "0");

/** API money is a decimal string; Number is safe for display at UZS magnitudes. */
export const formatMoney = (v: string) => moneyFmt.format(Number(v));
export const formatQty = (v: string) => qtyFmt.format(Number(v));

/** Stored times are Tashkent wall time in UTC fields: read them with UTC getters. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
```

Run: `cd apps/web && npx tsx --test src/lib/format.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 4: Translations** — replace `apps/web/src/i18n/messages.ts` with:

```ts
// Keep both locales in the same key order.
export const messages = {
  ru: {
    "app.title": "Distribution Finance",
    "app.subtitle": "Финансы дистрибуции на данных Salesdoc",
    "common.loading": "Загрузка…",
    "common.apply": "Применить",
    "common.search": "Поиск",
    "common.all": "Все",
    "common.empty": "Нет данных за этот период",
    "common.prev": "Назад",
    "common.next": "Вперёд",
    "common.page": "Страница {page} из {pages}",
    "common.locale": "Язык",
    "nav.reconciliation": "Сверка",
    "nav.outlets": "Торговые точки",
    "nav.supplier": "Поставщик",
    "nav.warehouse": "Склад",
    "nav.sync": "Синхронизация",
    "period.from": "С",
    "period.to": "По",
    "data.as_of": "Данные на {time}",
    "data.never": "Данные ещё не загружены",
    "recon.goods": "Товар",
    "recon.cash": "Деньги",
    "recon.receivable": "Точки должны нам",
    "recon.prepaid": "Предоплата точек",
    "recon.supplier_owed": "Мы должны поставщику",
    "recon.delivered": "Отгружено точкам",
    "recon.returned": "Возвраты от точек",
    "recon.paid": "Оплачено точками",
    "recon.received": "Получено от поставщика",
    "recon.supplier_paid": "Оплачено поставщику",
    "recon.difference": "Разница (долг)",
    "recon.cash_pending": "Оплаты поставщику появятся с модулем кассы",
    "outlets.name": "Торговая точка",
    "outlets.inn": "ИНН",
    "outlets.opening": "На начало",
    "outlets.delivered": "Отгружено",
    "outlets.returned": "Возвраты",
    "outlets.paid": "Оплачено",
    "outlets.closing": "На конец",
    "outlets.agent": "Агент",
    "outlets.expeditor": "Экспедитор",
    "outlets.non_zero": "Только с долгом",
    "outlets.statement": "Акт сверки",
    "statement.date": "Дата",
    "statement.document": "Документ",
    "statement.amount": "Сумма",
    "statement.balance": "Остаток",
    "statement.kind.order": "Отгрузка",
    "statement.kind.return": "Возврат",
    "statement.kind.payment": "Оплата",
    "statement.kind.purchase": "Поступление",
    "supplier.title": "Поставщик",
    "warehouse.stock": "Остатки",
    "warehouse.purchases": "Поступления",
    "warehouse.warehouse": "Склад",
    "warehouse.product": "Товар",
    "warehouse.quantity": "Количество",
    "warehouse.include_zero": "Показать нулевые",
    "warehouse.lines": "Позиций",
    "warehouse.supplier": "Поставщик",
    "warehouse.price": "Цена",
    "warehouse.total": "Итого",
    "sync.title": "Синхронизация с Salesdoc",
    "sync.run": "Синхронизировать",
    "sync.run_full": "Полная загрузка",
    "sync.running": "Идёт синхронизация…",
    "sync.already_running": "Синхронизация уже идёт",
    "sync.resource": "Данные",
    "sync.last_success": "Последний успех",
    "sync.last_run": "Последний запуск",
    "sync.records": "Записей",
    "sync.resume_page": "Продолжит со страницы {page}",
    "sync.status.succeeded": "Успешно",
    "sync.status.failed": "Ошибка",
    "sync.status.running": "Выполняется",
    "status.not_configured_hint": "Добавьте доступ в apps/api/data/salesdoc.json",
    "errors.unknown": "Что-то пошло не так",
    "errors.api_down": "Сервер недоступен. Запустите API и обновите страницу.",
    "errors.retry": "Повторить",
    "errors.date_invalid": "Введите дату",
    "errors.period_order": "Дата «С» не может быть позже даты «По»",
  },
  uz: {
    "app.title": "Distribution Finance",
    "app.subtitle": "Salesdoc ma'lumotlari asosida distribyutsiya moliyasi",
    "common.loading": "Yuklanmoqda…",
    "common.apply": "Qo'llash",
    "common.search": "Qidirish",
    "common.all": "Hammasi",
    "common.empty": "Bu davr uchun ma'lumot yo'q",
    "common.prev": "Orqaga",
    "common.next": "Oldinga",
    "common.page": "{pages} dan {page}-sahifa",
    "common.locale": "Til",
    "nav.reconciliation": "Solishtirish",
    "nav.outlets": "Savdo nuqtalari",
    "nav.supplier": "Yetkazib beruvchi",
    "nav.warehouse": "Ombor",
    "nav.sync": "Sinxronizatsiya",
    "period.from": "Dan",
    "period.to": "Gacha",
    "data.as_of": "Ma'lumotlar {time} holatiga",
    "data.never": "Ma'lumotlar hali yuklanmagan",
    "recon.goods": "Tovar",
    "recon.cash": "Pul",
    "recon.receivable": "Nuqtalar bizdan qarzdor",
    "recon.prepaid": "Nuqtalarning oldindan to'lovi",
    "recon.supplier_owed": "Yetkazib beruvchiga qarzimiz",
    "recon.delivered": "Nuqtalarga jo'natildi",
    "recon.returned": "Nuqtalardan qaytarildi",
    "recon.paid": "Nuqtalar to'ladi",
    "recon.received": "Yetkazib beruvchidan olindi",
    "recon.supplier_paid": "Yetkazib beruvchiga to'landi",
    "recon.difference": "Farq (qarz)",
    "recon.cash_pending": "Yetkazib beruvchiga to'lovlar kassa moduli bilan paydo bo'ladi",
    "outlets.name": "Savdo nuqtasi",
    "outlets.inn": "STIR",
    "outlets.opening": "Boshida",
    "outlets.delivered": "Jo'natildi",
    "outlets.returned": "Qaytarildi",
    "outlets.paid": "To'landi",
    "outlets.closing": "Oxirida",
    "outlets.agent": "Agent",
    "outlets.expeditor": "Ekspeditor",
    "outlets.non_zero": "Faqat qarzdorlar",
    "outlets.statement": "Solishtirma dalolatnoma",
    "statement.date": "Sana",
    "statement.document": "Hujjat",
    "statement.amount": "Summa",
    "statement.balance": "Qoldiq",
    "statement.kind.order": "Jo'natma",
    "statement.kind.return": "Qaytarish",
    "statement.kind.payment": "To'lov",
    "statement.kind.purchase": "Kirim",
    "supplier.title": "Yetkazib beruvchi",
    "warehouse.stock": "Qoldiqlar",
    "warehouse.purchases": "Kirimlar",
    "warehouse.warehouse": "Ombor",
    "warehouse.product": "Tovar",
    "warehouse.quantity": "Miqdor",
    "warehouse.include_zero": "Nollarni ko'rsatish",
    "warehouse.lines": "Pozitsiyalar",
    "warehouse.supplier": "Yetkazib beruvchi",
    "warehouse.price": "Narx",
    "warehouse.total": "Jami",
    "sync.title": "Salesdoc bilan sinxronizatsiya",
    "sync.run": "Sinxronlash",
    "sync.run_full": "To'liq yuklash",
    "sync.running": "Sinxronizatsiya ketmoqda…",
    "sync.already_running": "Sinxronizatsiya allaqachon ketmoqda",
    "sync.resource": "Ma'lumot",
    "sync.last_success": "Oxirgi muvaffaqiyat",
    "sync.last_run": "Oxirgi ishga tushirish",
    "sync.records": "Yozuvlar",
    "sync.resume_page": "{page}-sahifadan davom etadi",
    "sync.status.succeeded": "Muvaffaqiyatli",
    "sync.status.failed": "Xato",
    "sync.status.running": "Bajarilmoqda",
    "status.not_configured_hint": "Kirish ma'lumotlarini apps/api/data/salesdoc.json ga qo'shing",
    "errors.unknown": "Nimadir xato ketdi",
    "errors.api_down": "Server mavjud emas. API ni ishga tushiring va sahifani yangilang.",
    "errors.retry": "Qayta urinish",
    "errors.date_invalid": "Sanani kiriting",
    "errors.period_order": "«Dan» sanasi «Gacha» sanasidan keyin bo'lishi mumkin emas",
  },
} as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof (typeof messages)["ru"];

export const defaultLocale: Locale = "ru";
export const locales: Locale[] = ["ru", "uz"];

export function translate(
  locale: Locale,
  key: MessageKey,
  vars: Record<string, string> = {},
): string {
  return messages[locale][key].replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}
```

`apps/web/src/i18n/server.ts`:

```ts
import { cookies } from "next/headers";
import { defaultLocale, locales, translate, type Locale, type MessageKey } from "./messages";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get("locale")?.value;
  return locales.includes(value as Locale) ? (value as Locale) : defaultLocale;
}

export async function getT() {
  const locale = await getLocale();
  return (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
}
```

- [ ] **Step 5: API helper** — replace `apps/web/src/lib/api.ts` with:

```ts
const API_URL = process.env.API_URL ?? "http://localhost:4000/api";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
      return { ok: false, status: res.status, message: message ?? res.statusText };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, message: "" };
  }
}

export const apiGet = <T>(path: string) => request<T>(path);

export const apiPost = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** `?from=..&to=..` plus extra params, skipping empty values. */
export function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface Summary {
  period: { from: string; to: string };
  dataAsOf: string | null;
  outlets: { receivable: string; prepaid: string; delivered: string; returned: string; paid: string };
  supplier: { received: string; paid: string; owed: string };
}

export interface OutletBalance {
  outletSdId: string;
  name: string;
  firmName: string | null;
  inn: string | null;
  opening: string;
  delivered: string;
  returned: string;
  paid: string;
  closing: string;
}

export interface StatementRow {
  kind: "order" | "return" | "payment" | "purchase";
  sdId: string;
  date: string;
  amount: string;
  balance: string;
  warehouseName?: string | null;
}

export interface OutletStatement {
  outlet: { sdId: string; name: string; firmName: string | null; inn: string | null };
  opening: string;
  closing: string;
  rows: StatementRow[];
}

export interface SupplierStatement {
  opening: string;
  received: string;
  paid: string;
  closing: string;
  rows: StatementRow[];
}

export interface StockResponse {
  warehouses: Array<{ sdId: string; name: string }>;
  rows: Array<{ warehouseSdId: string; warehouseName: string; productSdId: string; productName: string; quantity: string }>;
}

export interface PurchaseList {
  total: string;
  rows: Array<{ sdId: string; date: string; warehouseName: string | null; supplierName: string | null; lineCount: number; total: string }>;
}

export interface PurchaseDetail {
  sdId: string;
  date: string;
  warehouseName: string | null;
  supplierName: string | null;
  total: string;
  lines: Array<{ productSdId: string | null; productName: string; quantity: string; price: string; amount: string }>;
}

export interface SyncStatus {
  running: boolean;
  dataAsOf: string | null;
  resources: Array<{
    resource: string;
    lastSuccessAt: string | null;
    resumePage: number | null;
    lastRun: { status: string; records: number; error: string | null; startedAt: string; finishedAt: string | null } | null;
  }>;
}
```

- [ ] **Step 6: Shared components**

`apps/web/src/components/app/loader.tsx`:

```tsx
import { cn } from "@/lib/utils";

/** The one spinner. Pass the translated label from the caller. */
export function Loader({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("flex items-center justify-center p-8", className)}>
      <span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}
```

`apps/web/src/components/app/text.tsx`:

```tsx
import { cn } from "@/lib/utils";

const variants = {
  title: "text-2xl font-semibold tracking-tight",
  subtitle: "text-base font-medium",
  body: "text-sm",
  caption: "text-xs text-muted-foreground",
  error: "text-sm text-destructive",
} as const;

export function Text({
  variant = "body",
  as: Tag = "p",
  truncate,
  className,
  children,
  ...rest
}: {
  variant?: keyof typeof variants;
  as?: "p" | "span" | "h1" | "h2" | "h3" | "div";
  truncate?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn(variants[variant], truncate ? "truncate" : "[overflow-wrap:anywhere]", className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
```

`apps/web/src/components/app/field.tsx`:

```tsx
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "./text";

/** The universal Input: label, control, and its own error underneath. */
export function Field({
  label,
  error,
  className,
  ...input
}: { label: string; error?: string } & React.ComponentProps<typeof Input>) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} {...input} />
      {error && (
        <Text id={errorId} role="alert" variant="error" className="mt-1">
          {error}
        </Text>
      )}
    </div>
  );
}
```

`apps/web/src/components/app/period-filter.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "./field";

export interface PeriodLabels {
  from: string;
  to: string;
  apply: string;
  invalid: string;
  order: string;
}

/** Two dates, validated in place, written to ?from&to (page resets to 1). */
export function PeriodFilter({ from, to, labels }: { from: string; to: string; labels: PeriodLabels }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [values, setValues] = useState({ from, to });
  const [errors, setErrors] = useState<{ from?: string; to?: string }>({});
  const [pending, start] = useTransition();

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.from) next.from = labels.invalid;
    if (!values.to) next.to = labels.invalid;
    if (!next.from && !next.to && values.from > values.to) next.from = labels.order;
    setErrors(next);
    if (next.from || next.to) return;
    const q = new URLSearchParams(params);
    q.set("from", values.from);
    q.set("to", values.to);
    q.delete("page");
    start(() => router.push(`${pathname}?${q}`));
  }

  return (
    <form onSubmit={apply} className="flex flex-wrap items-start gap-3">
      <Field
        type="date"
        label={labels.from}
        value={values.from}
        error={errors.from}
        onChange={(e) => {
          setValues((v) => ({ ...v, from: e.target.value }));
          setErrors((er) => ({ ...er, from: undefined }));
        }}
      />
      <Field
        type="date"
        label={labels.to}
        value={values.to}
        error={errors.to}
        onChange={(e) => {
          setValues((v) => ({ ...v, to: e.target.value }));
          setErrors((er) => ({ ...er, to: undefined }));
        }}
      />
      <Button type="submit" disabled={pending} className="mt-5 active:scale-95">
        {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {labels.apply}
      </Button>
    </form>
  );
}
```

`apps/web/src/components/app/select.tsx` (the shared dropdown; pages never use a raw `<select>`):

```tsx
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn("h-9 rounded-md border bg-background px-2 text-sm transition active:scale-[0.98]", className)}
      {...props}
    />
  );
}
```

`apps/web/src/components/app/page-header.tsx`:

```tsx
import { Text } from "./text";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <Text as="h1" variant="title">{title}</Text>
        {subtitle && <Text variant="caption">{subtitle}</Text>}
      </div>
      {children}
    </header>
  );
}
```

`apps/web/src/components/app/api-error.tsx`:

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Text } from "./text";

/** A failed API call. `message` is already translated or comes from the API's 400 text. */
export function ApiError({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent>
        <Text variant="error" role="alert">{message}</Text>
      </CardContent>
    </Card>
  );
}
```

`apps/web/src/components/app/locale-switch.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Locale } from "@/i18n/messages";
import { cn } from "@/lib/utils";

export function LocaleSwitch({ current, label }: { current: Locale; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (l: Locale) => {
    document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  };
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {(["ru", "uz"] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => choose(l)}
          className={cn(
            "rounded-md px-2 py-1 text-xs uppercase transition active:scale-95",
            l === current ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
```

`apps/web/src/components/app/sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

export function Sidebar({ title, items, footer }: { title: string; items: NavItem[]; footer: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <aside className="flex shrink-0 flex-col gap-4 border-b bg-muted/30 p-4 md:min-h-screen md:w-56 md:border-r md:border-b-0">
      <span className="font-semibold">{title}</span>
      <nav className="flex flex-wrap gap-1 md:flex-col">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition active:scale-[0.98]",
              isActive(i.href) ? "bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {i.label}
          </Link>
        ))}
      </nav>
      <div className="md:mt-auto">{footer}</div>
    </aside>
  );
}
```

- [ ] **Step 7: Layout, loading and error** — replace `apps/web/src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LocaleSwitch } from "@/components/app/locale-switch";
import { Sidebar } from "@/components/app/sidebar";
import { getLocale, getT } from "@/i18n/server";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin", "cyrillic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "Distribution Finance",
  description: "Distribution finance on Salesdoc data",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const t = await getT();
  const items = [
    { href: "/", label: t("nav.reconciliation") },
    { href: "/outlets", label: t("nav.outlets") },
    { href: "/supplier", label: t("nav.supplier") },
    { href: "/warehouse", label: t("nav.warehouse") },
    { href: "/settings/sync", label: t("nav.sync") },
  ];
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background md:flex-row">
        <Sidebar
          title={t("app.title")}
          items={items}
          footer={<LocaleSwitch current={locale} label={t("common.locale")} />}
        />
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
```

`apps/web/src/app/loading.tsx`:

```tsx
import { Loader } from "@/components/app/loader";
import { getT } from "@/i18n/server";

export default async function Loading() {
  const t = await getT();
  return <Loader label={t("common.loading")} />;
}
```

`apps/web/src/app/error.tsx` (client components cannot read the cookie on the server; read it from `document.cookie`):

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/app/text";
import { defaultLocale, translate, type Locale } from "@/i18n/messages";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  useEffect(() => {
    if (document.cookie.includes("locale=uz")) setLocale("uz");
  }, []);
  return (
    <div className="flex flex-col items-start gap-3">
      <Text variant="error" role="alert">{translate(locale, "errors.unknown")}</Text>
      <Button onClick={reset} className="active:scale-95">{translate(locale, "errors.retry")}</Button>
    </div>
  );
}
```

- [ ] **Step 8: Typecheck, lint, render**

Run: `cd apps/web && npx next typegen && npx tsc --noEmit && npx eslint src`
Expected: no errors. (`app/page.tsx` still uses the old `apiGet` — Task 10 replaces it; if `tsc` fails only there, proceed and fix it in Task 10's first step.)

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): layout, navigation, shared loader/text/field, ru/uz strings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Screens — Сверка, Торговые точки, Поставщик

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/app/money-cell.tsx`, `apps/web/src/components/app/statement-table.tsx`, `apps/web/src/components/app/data-as-of.tsx`, `apps/web/src/app/outlets/page.tsx`, `apps/web/src/app/outlets/[sdId]/page.tsx`, `apps/web/src/app/supplier/page.tsx`

**Interfaces:**
- Consumes: `apiGet`, `qs`, types from Task 9's `lib/api.ts`; API routes from Task 6; `PeriodFilter`, `PageHeader`, `ApiError`, `Text`, `getT`.
- Produces: pages at `/`, `/outlets`, `/outlets/[sdId]`, `/supplier`.

- [ ] **Step 1: Shared pieces** — `apps/web/src/components/app/money-cell.tsx`:

```tsx
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", Number(value) < 0 && "text-destructive", className)}>
      {formatMoney(value)}
    </span>
  );
}
```

`apps/web/src/components/app/data-as-of.tsx`:

```tsx
import { formatDateTime } from "@/lib/format";
import { Text } from "./text";

/** dataAsOf is a real instant; show it in Tashkent time (UTC+5, no DST). */
export function DataAsOf({ iso, label, never }: { iso: string | null; label: (time: string) => string; never: string }) {
  if (!iso) return <Text variant="caption">{never}</Text>;
  const wall = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000).toISOString();
  return <Text variant="caption">{label(formatDateTime(wall))}</Text>;
}
```

`apps/web/src/components/app/statement-table.tsx`:

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StatementRow } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Money } from "./money-cell";
import { Text } from "./text";

export interface StatementLabels {
  date: string;
  document: string;
  amount: string;
  balance: string;
  opening: string;
  closing: string;
  empty: string;
  kind: Record<StatementRow["kind"], string>;
}

export function StatementTable({
  opening,
  closing,
  rows,
  labels,
}: {
  opening: string;
  closing: string;
  rows: StatementRow[];
  labels: StatementLabels;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.date}</TableHead>
            <TableHead>{labels.document}</TableHead>
            <TableHead className="text-right">{labels.amount}</TableHead>
            <TableHead className="text-right">{labels.balance}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/40">
            <TableCell colSpan={3}><Text variant="caption">{labels.opening}</Text></TableCell>
            <TableCell className="text-right"><Money value={opening} /></TableCell>
          </TableRow>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}><Text variant="caption">{labels.empty}</Text></TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={`${r.kind}-${r.sdId}`}>
              <TableCell className="whitespace-nowrap">{formatDateTime(r.date)}</TableCell>
              <TableCell>
                {labels.kind[r.kind]} <Text as="span" variant="caption">{r.sdId}{r.warehouseName ? ` · ${r.warehouseName}` : ""}</Text>
              </TableCell>
              <TableCell className="text-right"><Money value={r.amount} /></TableCell>
              <TableCell className="text-right"><Money value={r.balance} /></TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/40 font-medium">
            <TableCell colSpan={3}><Text variant="caption">{labels.closing}</Text></TableCell>
            <TableCell className="text-right"><Money value={closing} /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Сверка** — replace `apps/web/src/app/page.tsx` with:

```tsx
import { ApiError } from "@/components/app/api-error";
import { DataAsOf } from "@/components/app/data-as-of";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { Text } from "@/components/app/text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { apiGet, qs, type Summary } from "@/lib/api";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-0">
      <Text variant="body">{label}</Text>
      <Money value={value} className="font-medium" />
    </div>
  );
}

export default async function Reconciliation({ searchParams }: PageProps<"/">) {
  const t = await getT();
  const sp = await searchParams;
  const res = await apiGet<Summary>(`/reconciliation/summary${qs({ from: sp.from as string, to: sp.to as string })}`);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const s = res.data;
  const goods = (Number(s.outlets.delivered) - Number(s.outlets.returned)).toFixed(2);
  const diff = (Number(goods) - Number(s.outlets.paid)).toFixed(2);

  return (
    <>
      <PageHeader title={t("nav.reconciliation")} subtitle={t("app.subtitle")}>
        <PeriodFilter
          from={s.period.from}
          to={s.period.to}
          labels={{ from: t("period.from"), to: t("period.to"), apply: t("common.apply"), invalid: t("errors.date_invalid"), order: t("errors.period_order") }}
        />
      </PageHeader>
      <DataAsOf iso={s.dataAsOf} label={(time) => t("data.as_of", { time })} never={t("data.never")} />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [t("recon.receivable"), s.outlets.receivable],
          [t("recon.prepaid"), s.outlets.prepaid],
          [t("recon.supplier_owed"), s.supplier.owed],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader><Text variant="caption">{label}</Text></CardHeader>
            <CardContent><Money value={value} className="text-2xl font-semibold" /></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("recon.goods")}</CardTitle></CardHeader>
          <CardContent>
            <Row label={t("recon.delivered")} value={s.outlets.delivered} />
            <Row label={t("recon.returned")} value={s.outlets.returned} />
            <Row label={t("recon.received")} value={s.supplier.received} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("recon.cash")}</CardTitle></CardHeader>
          <CardContent>
            <Row label={t("recon.paid")} value={s.outlets.paid} />
            <Row label={t("recon.supplier_paid")} value={s.supplier.paid} />
            <Text variant="caption" className="pt-2">{t("recon.cash_pending")}</Text>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="flex items-baseline justify-between gap-4">
          <Text variant="subtitle">{t("recon.difference")}</Text>
          <Money value={diff} className="text-xl font-semibold" />
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 3: Торговые точки** — `apps/web/src/app/outlets/page.tsx`:

```tsx
import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { Text } from "@/components/app/text";
import { Select } from "@/components/app/select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type OutletBalance } from "@/lib/api";
import { tashkentToday } from "@/lib/today";
import { cn } from "@/lib/utils";

type Filters = { agents: Array<{ sdId: string; name: string }>; expeditors: Array<{ sdId: string; name: string }> };

export default async function Outlets({ searchParams }: PageProps<"/outlets">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const page = Math.max(1, Number(get("page")) || 1);
  const query = { from: get("from"), to: get("to"), search: get("search"), agent: get("agent"), expeditor: get("expeditor"), nonZero: get("nonZero") };
  const [res, filters] = await Promise.all([
    apiGet<{ total: number; rows: OutletBalance[] }>(`/outlets/balances${qs({ ...query, page: String(page) })}`),
    apiGet<Filters>("/outlets/filters"),
  ]);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const pages = Math.max(1, Math.ceil(res.data.total / 50));
  const today = tashkentToday();
  const link = (p: number) => `/outlets${qs({ ...query, page: String(p) })}`;
  const period = { from: query.from ?? `${today.slice(0, 7)}-01`, to: query.to ?? today };

  return (
    <>
      <PageHeader title={t("nav.outlets")}>
        <PeriodFilter
          from={period.from}
          to={period.to}
          labels={{ from: t("period.from"), to: t("period.to"), apply: t("common.apply"), invalid: t("errors.date_invalid"), order: t("errors.period_order") }}
        />
      </PageHeader>

      <form className="flex flex-wrap items-center gap-3" action="/outlets">
        {query.from && <input type="hidden" name="from" value={query.from} />}
        {query.to && <input type="hidden" name="to" value={query.to} />}
        <Input name="search" defaultValue={query.search} placeholder={t("common.search")} aria-label={t("common.search")} className="w-56" />
        <Select name="agent" defaultValue={query.agent ?? ""} aria-label={t("outlets.agent")}>
          <option value="">{t("outlets.agent")}: {t("common.all")}</option>
          {filters.ok && filters.data.agents.map((a) => <option key={a.sdId} value={a.sdId}>{a.name}</option>)}
        </Select>
        <Select name="expeditor" defaultValue={query.expeditor ?? ""} aria-label={t("outlets.expeditor")}>
          <option value="">{t("outlets.expeditor")}: {t("common.all")}</option>
          {filters.ok && filters.data.expeditors.map((a) => <option key={a.sdId} value={a.sdId}>{a.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="nonZero" value="true" defaultChecked={query.nonZero === "true"} />
          {t("outlets.non_zero")}
        </label>
        <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("outlets.name")}</TableHead>
              <TableHead className="text-right">{t("outlets.opening")}</TableHead>
              <TableHead className="text-right">{t("outlets.delivered")}</TableHead>
              <TableHead className="text-right">{t("outlets.returned")}</TableHead>
              <TableHead className="text-right">{t("outlets.paid")}</TableHead>
              <TableHead className="text-right">{t("outlets.closing")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.rows.length === 0 && (
              <TableRow><TableCell colSpan={6}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
            )}
            {res.data.rows.map((r) => (
              <TableRow key={r.outletSdId}>
                <TableCell className="max-w-72">
                  <Link href={`/outlets/${encodeURIComponent(r.outletSdId)}${qs({ from: query.from, to: query.to })}`} className="font-medium underline-offset-4 hover:underline">
                    <Text as="span" truncate className="block">{r.name}</Text>
                  </Link>
                  {r.inn && <Text variant="caption">{t("outlets.inn")} {r.inn}</Text>}
                </TableCell>
                <TableCell className="text-right"><Money value={r.opening} /></TableCell>
                <TableCell className="text-right"><Money value={r.delivered} /></TableCell>
                <TableCell className="text-right"><Money value={r.returned} /></TableCell>
                <TableCell className="text-right"><Money value={r.paid} /></TableCell>
                <TableCell className="text-right font-medium"><Money value={r.closing} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <nav className="flex items-center justify-between">
        <Text variant="caption">{t("common.page", { page: String(page), pages: String(pages) })}</Text>
        <div className="flex gap-2">
          <Link
            href={link(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={cn(buttonVariants({ variant: "outline" }), "active:scale-95", page <= 1 && "pointer-events-none opacity-50")}
          >
            {t("common.prev")}
          </Link>
          <Link
            href={link(Math.min(pages, page + 1))}
            aria-disabled={page >= pages}
            className={cn(buttonVariants({ variant: "outline" }), "active:scale-95", page >= pages && "pointer-events-none opacity-50")}
          >
            {t("common.next")}
          </Link>
        </div>
      </nav>
    </>
  );
}
```

Also create `apps/web/src/lib/today.ts`:

```ts
/** Today's date in Tashkent as YYYY-MM-DD (matches the API's default period). */
export function tashkentToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
```

- [ ] **Step 4: Outlet statement** — `apps/web/src/app/outlets/[sdId]/page.tsx`:

```tsx
import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { StatementTable } from "@/components/app/statement-table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type OutletStatement } from "@/lib/api";
import { tashkentToday } from "@/lib/today";

export default async function OutletStatementPage({ params, searchParams }: PageProps<"/outlets/[sdId]">) {
  const t = await getT();
  const { sdId } = await params;
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  const res = await apiGet<OutletStatement>(`/outlets/${encodeURIComponent(sdId)}/statement${qs({ from, to })}`);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const s = res.data;
  const today = tashkentToday();

  return (
    <>
      <PageHeader title={s.outlet.name} subtitle={[t("outlets.statement"), s.outlet.firmName, s.outlet.inn && `${t("outlets.inn")} ${s.outlet.inn}`].filter(Boolean).join(" · ")}>
        <PeriodFilter
          from={from ?? `${today.slice(0, 7)}-01`}
          to={to ?? today}
          labels={{ from: t("period.from"), to: t("period.to"), apply: t("common.apply"), invalid: t("errors.date_invalid"), order: t("errors.period_order") }}
        />
      </PageHeader>
      <StatementTable
        opening={s.opening}
        closing={s.closing}
        rows={s.rows}
        labels={{
          date: t("statement.date"), document: t("statement.document"), amount: t("statement.amount"),
          balance: t("statement.balance"), opening: t("outlets.opening"), closing: t("outlets.closing"), empty: t("common.empty"),
          kind: { order: t("statement.kind.order"), return: t("statement.kind.return"), payment: t("statement.kind.payment"), purchase: t("statement.kind.purchase") },
        }}
      />
    </>
  );
}
```

- [ ] **Step 5: Поставщик** — `apps/web/src/app/supplier/page.tsx`:

```tsx
import { ApiError } from "@/components/app/api-error";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { StatementTable } from "@/components/app/statement-table";
import { Text } from "@/components/app/text";
import { getT } from "@/i18n/server";
import { apiGet, qs, type SupplierStatement } from "@/lib/api";
import { tashkentToday } from "@/lib/today";

export default async function SupplierPage({ searchParams }: PageProps<"/supplier">) {
  const t = await getT();
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  const res = await apiGet<SupplierStatement>(`/supplier/statement${qs({ from, to })}`);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const today = tashkentToday();

  return (
    <>
      <PageHeader title={t("supplier.title")}>
        <PeriodFilter
          from={from ?? `${today.slice(0, 7)}-01`}
          to={to ?? today}
          labels={{ from: t("period.from"), to: t("period.to"), apply: t("common.apply"), invalid: t("errors.date_invalid"), order: t("errors.period_order") }}
        />
      </PageHeader>
      <Text variant="caption">{t("recon.cash_pending")}</Text>
      <StatementTable
        opening={res.data.opening}
        closing={res.data.closing}
        rows={res.data.rows}
        labels={{
          date: t("statement.date"), document: t("statement.document"), amount: t("statement.amount"),
          balance: t("statement.balance"), opening: t("outlets.opening"), closing: t("outlets.closing"), empty: t("common.empty"),
          kind: { order: t("statement.kind.order"), return: t("statement.kind.return"), payment: t("statement.kind.payment"), purchase: t("statement.kind.purchase") },
        }}
      />
    </>
  );
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `cd apps/web && npx next typegen && npx tsc --noEmit && npx eslint src`
Expected: no errors.

- [ ] **Step 7: Look at it in the browser** — with the API (synced, Task 8) and `npm run dev:web` running, open `/`, `/outlets`, one outlet's statement, and `/supplier` in Chrome; also at 390 px width. Check: numbers match the API JSON for the same period; `?from=2026-09-30&to=2026-09-01` typed in the URL shows the red API error text, not a crash; Uzbek switch changes every label. Screenshot each.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): reconciliation, outlets with statements, supplier screens

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Screens — Склад and the sync panel

**Files:**
- Create: `apps/web/src/app/warehouse/page.tsx`, `apps/web/src/app/warehouse/purchases/[sdId]/page.tsx`, `apps/web/src/app/settings/sync/page.tsx`, `apps/web/src/app/settings/sync/actions.ts`, `apps/web/src/app/settings/sync/sync-buttons.tsx`

**Interfaces:**
- Consumes: Task 7 routes, Task 5 `/sync/status` and `/sync/run`, Task 9 components.
- Produces: pages `/warehouse` (tabs by `?tab=stock|purchases`), `/warehouse/purchases/[sdId]`, `/settings/sync`; server action `runSync(kind: 'incremental' | 'full'): Promise<{ ok: boolean; message?: string }>`.

- [ ] **Step 1: Склад** — `apps/web/src/app/warehouse/page.tsx`:

```tsx
import Link from "next/link";
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { Text } from "@/components/app/text";
import { Select } from "@/components/app/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, qs, type PurchaseList, type StockResponse } from "@/lib/api";
import { formatDateTime, formatQty } from "@/lib/format";
import { tashkentToday } from "@/lib/today";
import { cn } from "@/lib/utils";

export default async function WarehousePage({ searchParams }: PageProps<"/warehouse">) {
  const t = await getT();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab = get("tab") === "purchases" ? "purchases" : "stock";
  const today = tashkentToday();
  const tabs = (
    <nav className="flex gap-1">
      {(["stock", "purchases"] as const).map((k) => (
        <Link
          key={k}
          href={`/warehouse?tab=${k}`}
          className={cn("rounded-md px-3 py-2 text-sm transition active:scale-95", tab === k ? "bg-foreground text-background" : "hover:bg-muted")}
        >
          {t(k === "stock" ? "warehouse.stock" : "warehouse.purchases")}
        </Link>
      ))}
    </nav>
  );

  if (tab === "stock") {
    const res = await apiGet<StockResponse>(`/warehouse/stock${qs({ warehouse: get("warehouse"), search: get("search"), includeZero: get("includeZero") })}`);
    if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
    return (
      <>
        <PageHeader title={t("nav.warehouse")}>{tabs}</PageHeader>
        <form className="flex flex-wrap items-center gap-3" action="/warehouse">
          <input type="hidden" name="tab" value="stock" />
          <Select name="warehouse" defaultValue={get("warehouse") ?? ""} aria-label={t("warehouse.warehouse")}>
            <option value="">{t("warehouse.warehouse")}: {t("common.all")}</option>
            {res.data.warehouses.map((w) => <option key={w.sdId} value={w.sdId}>{w.name}</option>)}
          </Select>
          <Input name="search" defaultValue={get("search")} placeholder={t("common.search")} aria-label={t("common.search")} className="w-56" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="includeZero" value="true" defaultChecked={get("includeZero") === "true"} />
            {t("warehouse.include_zero")}
          </label>
          <Button type="submit" variant="secondary" className="active:scale-95">{t("common.apply")}</Button>
        </form>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("warehouse.warehouse")}</TableHead>
                <TableHead>{t("warehouse.product")}</TableHead>
                <TableHead className="text-right">{t("warehouse.quantity")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.data.rows.length === 0 && (
                <TableRow><TableCell colSpan={3}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
              )}
              {res.data.rows.map((r) => (
                <TableRow key={`${r.warehouseSdId}:${r.productSdId}`}>
                  <TableCell className="whitespace-nowrap">{r.warehouseName}</TableCell>
                  <TableCell><Text as="span">{r.productName}</Text></TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.quantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  const from = get("from");
  const to = get("to");
  const res = await apiGet<PurchaseList>(`/warehouse/purchases${qs({ from, to })}`);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  return (
    <>
      <PageHeader title={t("nav.warehouse")}>{tabs}</PageHeader>
      <PeriodFilter
        from={from ?? `${today.slice(0, 7)}-01`}
        to={to ?? today}
        labels={{ from: t("period.from"), to: t("period.to"), apply: t("common.apply"), invalid: t("errors.date_invalid"), order: t("errors.period_order") }}
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("statement.date")}</TableHead>
              <TableHead>{t("warehouse.warehouse")}</TableHead>
              <TableHead>{t("warehouse.supplier")}</TableHead>
              <TableHead className="text-right">{t("warehouse.lines")}</TableHead>
              <TableHead className="text-right">{t("statement.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.rows.length === 0 && (
              <TableRow><TableCell colSpan={5}><Text variant="caption">{t("common.empty")}</Text></TableCell></TableRow>
            )}
            {res.data.rows.map((r) => (
              <TableRow key={r.sdId}>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/warehouse/purchases/${encodeURIComponent(r.sdId)}`} className="underline-offset-4 hover:underline">
                    {formatDateTime(r.date)}
                  </Link>
                </TableCell>
                <TableCell>{r.warehouseName}</TableCell>
                <TableCell>{r.supplierName}</TableCell>
                <TableCell className="text-right tabular-nums">{r.lineCount}</TableCell>
                <TableCell className="text-right"><Money value={r.total} /></TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={4}>{t("warehouse.total")}</TableCell>
              <TableCell className="text-right"><Money value={res.data.total} /></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
```

`apps/web/src/app/warehouse/purchases/[sdId]/page.tsx`:

```tsx
import { ApiError } from "@/components/app/api-error";
import { Money } from "@/components/app/money-cell";
import { PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, type PurchaseDetail } from "@/lib/api";
import { formatDateTime, formatQty } from "@/lib/format";

export default async function PurchasePage({ params }: PageProps<"/warehouse/purchases/[sdId]">) {
  const t = await getT();
  const { sdId } = await params;
  const res = await apiGet<PurchaseDetail>(`/warehouse/purchases/${encodeURIComponent(sdId)}`);
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const p = res.data;
  return (
    <>
      <PageHeader
        title={`${t("statement.kind.purchase")} ${p.sdId}`}
        subtitle={[formatDateTime(p.date), p.warehouseName, p.supplierName].filter(Boolean).join(" · ")}
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("warehouse.product")}</TableHead>
              <TableHead className="text-right">{t("warehouse.quantity")}</TableHead>
              <TableHead className="text-right">{t("warehouse.price")}</TableHead>
              <TableHead className="text-right">{t("statement.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.lines.map((l, i) => (
              <TableRow key={`${l.productSdId}-${i}`}>
                <TableCell>{l.productName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(l.quantity)}</TableCell>
                <TableCell className="text-right"><Money value={l.price} /></TableCell>
                <TableCell className="text-right"><Money value={l.amount} /></TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={3}>{t("warehouse.total")}</TableCell>
              <TableCell className="text-right"><Money value={p.total} /></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Sync panel** — `apps/web/src/app/settings/sync/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { apiPost } from "@/lib/api";

export async function runSync(kind: "incremental" | "full"): Promise<{ ok: boolean; alreadyRunning?: boolean; message?: string }> {
  const res = await apiPost<{ alreadyRunning?: true }>("/sync/run", { kind });
  revalidatePath("/", "layout");
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, alreadyRunning: res.data.alreadyRunning === true };
}
```

`apps/web/src/app/settings/sync/sync-buttons.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Text } from "@/components/app/text";
import { Button } from "@/components/ui/button";
import { runSync } from "./actions";

export function SyncButtons({
  labels,
}: {
  labels: { run: string; full: string; running: string; alreadyRunning: string; failed: string };
}) {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<"incremental" | "full" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const go = (k: "incremental" | "full") => {
    setKind(k);
    setMessage(null);
    start(async () => {
      const r = await runSync(k);
      if (!r.ok) setMessage(r.message || labels.failed);
      else if (r.alreadyRunning) setMessage(labels.alreadyRunning);
    });
  };

  const spinner = <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => go("incremental")} disabled={pending} className="active:scale-95">
          {pending && kind === "incremental" && spinner}
          {labels.run}
        </Button>
        <Button variant="outline" onClick={() => go("full")} disabled={pending} className="active:scale-95">
          {pending && kind === "full" && spinner}
          {labels.full}
        </Button>
      </div>
      {pending && <Text variant="caption" role="status">{labels.running}</Text>}
      {message && <Text variant="error" role="alert">{message}</Text>}
    </div>
  );
}
```

`apps/web/src/app/settings/sync/page.tsx`:

```tsx
import { ApiError } from "@/components/app/api-error";
import { DataAsOf } from "@/components/app/data-as-of";
import { PageHeader } from "@/components/app/page-header";
import { Text } from "@/components/app/text";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { apiGet, type SyncStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { SyncButtons } from "./sync-buttons";

/** Real instants (sync times) shown in Tashkent wall time. */
const local = (iso: string) => formatDateTime(new Date(new Date(iso).getTime() + 5 * 3600 * 1000).toISOString());

export default async function SyncPage() {
  const t = await getT();
  const res = await apiGet<SyncStatus>("/sync/status");
  if (!res.ok) return <ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} />;
  const s = res.data;
  const statusLabel = (st: string) =>
    st === "succeeded" ? t("sync.status.succeeded") : st === "failed" ? t("sync.status.failed") : t("sync.status.running");

  return (
    <>
      <PageHeader title={t("sync.title")}>
        <SyncButtons
          labels={{ run: t("sync.run"), full: t("sync.run_full"), running: t("sync.running"), alreadyRunning: t("sync.already_running"), failed: t("errors.unknown") }}
        />
      </PageHeader>
      <DataAsOf iso={s.dataAsOf} label={(time) => t("data.as_of", { time })} never={t("data.never")} />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("sync.resource")}</TableHead>
              <TableHead>{t("sync.last_success")}</TableHead>
              <TableHead>{t("sync.last_run")}</TableHead>
              <TableHead className="text-right">{t("sync.records")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.resources.map((r) => (
              <TableRow key={r.resource}>
                <TableCell className="font-mono text-xs">{r.resource}</TableCell>
                <TableCell className="whitespace-nowrap">{r.lastSuccessAt ? local(r.lastSuccessAt) : "—"}</TableCell>
                <TableCell>
                  {r.lastRun ? (
                    <div className="flex flex-col gap-1">
                      <Badge variant={r.lastRun.status === "failed" ? "destructive" : "default"}>{statusLabel(r.lastRun.status)}</Badge>
                      {r.lastRun.error && <Text variant="error">{r.lastRun.error}</Text>}
                      {r.resumePage && <Text variant="caption">{t("sync.resume_page", { page: String(r.resumePage) })}</Text>}
                    </div>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.lastRun?.records ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd apps/web && npx next typegen && npx tsc --noEmit && npx eslint src`
Expected: no errors.

- [ ] **Step 4: Look at it in the browser** — open `/warehouse` (both tabs, one receipt), `/settings/sync`; press «Синхронизировать» and watch the spinner, then the refreshed table; press it twice quickly and confirm the second press is disabled; check 390 px width and the Uzbek switch. Screenshot each.

- [ ] **Step 5: Final full check and commit**

Run: `cd apps/api && npx vitest run && npx vitest run --config ./vitest.config.e2e.ts && cd ../web && npx tsc --noEmit && npx eslint src`
Expected: all green.

```bash
git add apps/web
git commit -m "feat(web): warehouse stock, goods receipts, Salesdoc sync panel

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Update `README.md` endpoints list with the new routes and `docs/salesdoc-api.md` with the two findings from this plan (getPayment `transactionType` filter is applied after paging; type 9 shelf-return payments mirror returns), then commit `docs: sync findings`.

---

### Task 12: Three-month window, balances anchored on Salesdoc (added 29 Sep 2026)

Owner decision after Task 8: store only the current month and the two before it; anchor outlet balances on Salesdoc `getBalance` (spec §4, §4.1, §4.7, §5 updated in 0b57e77).

**Files:**
- Create: `apps/api/src/sync/window.ts`, `apps/api/src/sync/window.spec.ts`
- Modify: `apps/api/prisma/schema.prisma` (+ `OutletBalance`), `apps/api/src/sync/mappers.ts` (+ `mapBalance`), `apps/api/src/sync/resources.ts` (+ `balances`, `dated`), `apps/api/src/sync/sync.service.ts` (window filter on full passes), `apps/api/src/settlements/period.ts` (window floor), `apps/api/src/settlements/settlements.service.ts` (anchor formula, window-bounded supplier opening), their specs; `apps/web/src/lib/api.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/i18n/messages.ts` (show the window start).

**Interfaces:**
- `syncWindow(now: Date): { start: string; fetchFrom: string; to: string }` — Tashkent days: `start` = 1st of the month two months back, `fetchFrom` = `start` − 7 days (order date vs document date margin), `to` = today.
- `ResourceDef.dated?: (from: string, to: string) => { period: { date: { from; to } } }` — sent on full passes only, with `fetchFrom`..`to`.
- Model `OutletBalance { sdId @id, name?, debt Decimal(18,2), raw, seenAt }`; `mapBalance(raw, seenAt)` → `debt = −balance`; resource `balances` (`getBalance` → `balance`, replace mode).
- `parsePeriod(from?, to?, today?)` throws `from must not be before <start>` when `from` < window start; `Period.windowStart: string`.
- Outlet balance at moment t = `OutletBalance.debt` (0 if absent) − Σ movements dated ≥ t. Supplier opening = Σ purchases dated in [windowStart, from).
- `summary()` adds `windowStart: string`.

Tests: window boundaries; mapper sign; `balances` resource saves; full pass sends `period.date` = `fetchFrom`..`to`; settlement specs rewritten on anchors (outlet with only a balance row, outlet with movements but no balance row, statement opening from anchor, supplier purchase inside the 7-day margin excluded); period floor 400.
