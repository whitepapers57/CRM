# Edit / Delete Receipts, Month Closing, Minimal Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logged-in staff can edit (written to Salesdoc) and delete/restore (hidden in our app) приходные накладные while their month is open, close/reopen months, and see a history of every such action.

**Architecture:** API: a global auth guard with bearer sessions (`AuthModule`), an append-only `AuditLog` with `MonthsService` (open/closed months), and `PurchaseEditService` in the warehouse module for edit (via `SalesdocClient.call('setPurchase')`), delete/restore (`PurchaseHidden` table) and history; every receipt read excludes hidden ones. Web: a `/login` page whose server action stores the session token in an httpOnly cookie; `lib/api.ts` forwards it as `Authorization: Bearer` and sends 401s to `/login`; new months page; edit page, delete dialog, restore and history on the накладная.

**Tech Stack:** NestJS 12 (APP_GUARD, Reflector), Prisma 7, Node `crypto.scrypt`, `tsx` CLI scripts; Next.js 16 server actions, shadcn/Base UI (dialog, popover), existing shared components.

**Spec:** `docs/superpowers/specs/2026-10-03-receipt-edit-delete-design.md`

## Global Constraints

- Every API route requires a session except `GET /api/health` and `POST /api/auth/login`; 401 otherwise.
- Wrong login and wrong password give the same 401 message «Неверный логин или пароль».
- Passwords: `crypto.scrypt` with a per-user 16-byte salt, 64-byte key, stored as `scrypt$<salt b64>$<key b64>`; session tokens are 32 random bytes, only their SHA-256 stored; sessions last 30 days.
- A receipt's month = `date.toISOString().slice(0, 7)` (dates are stored as Tashkent wall time). Closed month → 409 «Месяц закрыт» for edit (old or new date), delete, restore.
- Delete needs a non-empty reason (400 «Укажите причину»). Hidden receipts are excluded from: Приходные накладные (unless «Показать удалённые»), Поставщики, supplier statements, the Сверка summary.
- `AuditLog` is append-only: no API updates or deletes it; it stores `userId` and a `userName` snapshot.
- Edit sends `setPurchase` with `CS_id` = `Purchase.csId`, `priceType` = stored `raw.priceType` (by `SD_id`), `store`/`shipper`/products by `SD_id`; local data changes only after Salesdoc answers `completed: 1`; Salesdoc errors → 502 with its message, nothing changed locally.
- **No real `setPurchase` call during development**; the only real one is Task 8's owner-approved unchanged round-trip.
- `PurchaseHidden` has **no foreign key** to `Purchase` (the sync deletes and re-inserts purchase rows; a cascade would erase deletions).
- All user-visible words in ru and uz (`apps/web/src/i18n/messages.ts`, same key order). Shared components only; no native `<select>`, checkbox or date input.
- Python edits write with `newline='\n'` (repo is LF via `.gitattributes`). Imports in `apps/api` end in `.js`. Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- API changes need `npx nest build` + restarting the "distribution-finance API" window before browser checks. The e2e suite runs against the real (Supabase) database: it must not create users there.

## Review Focus

- **A session whose user was disabled after login** must stop working on the next request — test in Task 1.
- **Editing a receipt into a closed month** (date moved from an open October to a closed September) must be refused even though its current month is open — test in Task 4.
- **The sync re-inserting a hidden receipt's row** must not bring it back into totals — test in Task 3 (hidden row survives a purchases save).
- **Salesdoc answering `completed: 0` with an error list** (not throwing) must leave our copy untouched and surface the message — test in Task 4.
- **The login page itself** must not redirect-loop when there is no session (layout fetches the user without the 401 redirect) — browser check in Task 5.

---

### Task 1: Minimal login in the API

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`, `apps/api/src/health.controller.ts`, `apps/api/test/app.e2e-spec.ts`, `apps/api/package.json`
- Create: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.guard.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/scripts/user.ts`
- Test: `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Produces: `AuthUser = { id: string; login: string; name: string }`; `hashPassword(pw)`, `verifyPassword(pw, stored)`; `AuthService.login(login, password): Promise<{ token: string; user: AuthUser }>`, `userFromToken(token?): Promise<AuthUser | null>`, `logout(token?)`, `createUser(login, name, password)`, `setPassword(login, password)`, `disable(login)`; decorators `Public()` and `CurrentUser()` from `auth.guard.ts`; routes `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

- [ ] **Step 1: Schema** — append to `schema.prisma`:

```prisma
/// A person who can log in. Created with `npm run user:add -w @df/api`.
model User {
  id           String    @id @default(uuid())
  login        String    @unique
  name         String
  passwordHash String
  active       Boolean   @default(true)
  createdAt    DateTime  @default(now())
  sessions     Session[]
}

/// A login session; id = SHA-256 of the token the browser holds.
model Session {
  id        String   @id
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  expiresAt DateTime

  @@index([userId])
}
```

Run: `cd apps/api && npx prisma migrate dev --name auth && npx prisma generate`
Expected: migration applied to the **Supabase** database (DATABASE_URL) and to the test DB on the next test run; client generated.

- [ ] **Step 2: Write the failing tests** — `apps/api/src/auth/auth.service.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuthService, hashPassword, verifyPassword } from './auth.service.js';

const db = createTestDb();
const auth = new AuthService(db);

describe('AuthService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('hashes with a salt and verifies only the right password', async () => {
    const a = await hashPassword('secret-1');
    const b = await hashPassword('secret-1');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('secret-1', a)).toBe(true);
    expect(await verifyPassword('secret-2', a)).toBe(false);
  });

  it('logs in by login (any case) and resolves the token back to the user', async () => {
    await auth.createUser('Sardor', 'Сардорбек', 'pass-123');
    const { token, user } = await auth.login(' SARDOR ', 'pass-123');
    expect(user).toMatchObject({ login: 'sardor', name: 'Сардорбек' });
    expect(await auth.userFromToken(token)).toMatchObject({ id: user.id, name: 'Сардорбек' });
    const stored = await db.session.findFirstOrThrow();
    expect(stored.id).not.toBe(token);
  });

  it('gives the same error for a wrong password and an unknown login', async () => {
    await auth.createUser('sardor', 'Сардорбек', 'pass-123');
    await expect(auth.login('sardor', 'nope')).rejects.toThrow('Неверный логин или пароль');
    await expect(auth.login('ghost', 'pass-123')).rejects.toThrow('Неверный логин или пароль');
  });

  it('stops a session as soon as its user is disabled', async () => {
    await auth.createUser('sardor', 'Сардорбек', 'pass-123');
    const { token } = await auth.login('sardor', 'pass-123');
    await auth.disable('sardor');
    expect(await auth.userFromToken(token)).toBeNull();
    await expect(auth.login('sardor', 'pass-123')).rejects.toThrow('Неверный логин или пароль');
  });

  it('rejects expired sessions, unknown tokens and logged-out tokens', async () => {
    await auth.createUser('sardor', 'Сардорбек', 'pass-123');
    const { token } = await auth.login('sardor', 'pass-123');
    expect(await auth.userFromToken('made-up')).toBeNull();
    expect(await auth.userFromToken(undefined)).toBeNull();
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await auth.userFromToken(token)).toBeNull();

    const second = await auth.login('sardor', 'pass-123');
    await auth.logout(second.token);
    expect(await auth.userFromToken(second.token)).toBeNull();
  });

  it('changes a password', async () => {
    await auth.createUser('sardor', 'Сардорбек', 'pass-123');
    await auth.setPassword('sardor', 'new-pass-456');
    await expect(auth.login('sardor', 'pass-123')).rejects.toThrow();
    expect((await auth.login('sardor', 'new-pass-456')).user.login).toBe('sardor');
  });
});
```

Run: `cd apps/api && npx vitest run src/auth`
Expected: FAIL — cannot find `./auth.service.js`.

- [ ] **Step 3: Implement** — `apps/api/src/auth/auth.service.ts`:

```ts
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';

export interface AuthUser {
  id: string;
  login: string;
  name: string;
}

const SESSION_DAYS = 30;
const BAD_LOGIN = 'Неверный логин или пароль';

const scrypt = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key))),
  );
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');
const normal = (login: string) => login.trim().toLowerCase();

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await scrypt(pw, salt)).toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const got = await scrypt(pw, Buffer.from(salt, 'base64'));
  const want = Buffer.from(key, 'base64');
  return got.length === want.length && timingSafeEqual(got, want);
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(login: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const u = await this.prisma.user.findUnique({ where: { login: normal(login) } });
    if (!u || !u.active || !(await verifyPassword(password, u.passwordHash))) {
      throw new UnauthorizedException(BAD_LOGIN);
    }
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: { id: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5) },
    });
    return { token, user: { id: u.id, login: u.login, name: u.name } };
  }

  async userFromToken(token?: string): Promise<AuthUser | null> {
    if (!token) return null;
    const s = await this.prisma.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
    if (!s || s.expiresAt <= new Date() || !s.user.active) return null;
    return { id: s.user.id, login: s.user.login, name: s.user.name };
  }

  async logout(token?: string): Promise<void> {
    if (token) await this.prisma.session.deleteMany({ where: { id: sha256(token) } });
  }

  createUser(login: string, name: string, password: string) {
    return hashPassword(password).then((passwordHash) =>
      this.prisma.user.create({ data: { login: normal(login), name: name.trim(), passwordHash } }),
    );
  }

  async setPassword(login: string, password: string): Promise<void> {
    const res = await this.prisma.user.updateMany({
      where: { login: normal(login) },
      data: { passwordHash: await hashPassword(password) },
    });
    if (res.count === 0) throw new NotFoundException(`No user ${login}`);
  }

  async disable(login: string): Promise<void> {
    const u = await this.prisma.user.update({ where: { login: normal(login) }, data: { active: false } });
    await this.prisma.session.deleteMany({ where: { userId: u.id } });
  }
}
```

`apps/api/src/auth/auth.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, type AuthUser } from './auth.service.js';

const IS_PUBLIC = 'df:isPublic';
/** Marks a route that needs no login (health, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const bearer = (header?: string) => (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

/** Every route needs a session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const user = await this.auth.userFromToken(bearer(req.headers.authorization));
    if (!user) throw new UnauthorizedException('Требуется вход');
    req.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
```

`apps/api/src/auth/auth.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { AuthService, type AuthUser } from './auth.service.js';
import { CurrentUser, Public, bearer } from './auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { login?: string; password?: string } = {}) {
    if (!body.login || !body.password) throw new BadRequestException('Введите логин и пароль');
    return this.auth.login(body.login, body.password);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Headers('authorization') header?: string) {
    await this.auth.logout(bearer(header));
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
```

`apps/api/src/auth/auth.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
```

Add `AuthModule` (from `./auth/auth.module.js`) to `AppModule.imports` right after `DatabaseModule`. In `health.controller.ts` import `{ Public }` from `./auth/auth.guard.js` and put `@Public()` on the `check()` route.

- [ ] **Step 4: User CLI** — `apps/api/scripts/user.ts`:

```ts
/**
 * Manage logins (there is no sign-up page):
 *   npm run user:add -w @df/api        → asks login, name, password
 *   npm run user:passwd -w @df/api     → asks login, new password
 *   npm run user:disable -w @df/api    → asks login
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { PrismaService } from '../src/database/prisma.service.js';

process.loadEnvFile();

/** Reads a line without echoing it (for passwords). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = '';
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(1);
        value = ch === '\u007f' || ch === '\b' ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function newPassword(): Promise<string> {
  const a = await askHidden('Пароль: ');
  const b = await askHidden('Ещё раз: ');
  if (a.length < 8) throw new Error('Пароль: не меньше 8 символов');
  if (a !== b) throw new Error('Пароли не совпадают');
  return a;
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const auth = new AuthService(prisma as unknown as PrismaService);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const command = process.argv[2];

try {
  const login = (await rl.question('Логин: ')).trim();
  if (command === 'add') {
    const name = (await rl.question('Имя (как показывать в истории): ')).trim();
    rl.close();
    await auth.createUser(login, name, await newPassword());
    console.log(`Создан пользователь ${login}`);
  } else if (command === 'passwd') {
    rl.close();
    await auth.setPassword(login, await newPassword());
    console.log(`Пароль изменён: ${login}`);
  } else if (command === 'disable') {
    rl.close();
    await auth.disable(login);
    console.log(`Отключён: ${login}`);
  } else {
    throw new Error('Команда: add | passwd | disable');
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  rl.close();
  await prisma.$disconnect();
}
```

In `apps/api/package.json` scripts add:
`"user:add": "tsx scripts/user.ts add"`, `"user:passwd": "tsx scripts/user.ts passwd"`, `"user:disable": "tsx scripts/user.ts disable"`.

- [ ] **Step 5: e2e reflects the guard** — in `apps/api/test/app.e2e-spec.ts` keep the health test; replace the `GET /salesdoc/status`, `GET /sync/status` and reversed-period tests with:

```ts
  it('refuses protected routes without a session', async () => {
    for (const path of ['/salesdoc/status', '/sync/status', '/reconciliation/summary', '/auth/me']) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
  });

  it('refuses a wrong login with 401 and an empty one with 400', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ login: 'nobody-here', password: 'x' }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(400);
  });
```

(The e2e suite runs against the Supabase database, so it never creates users; the login flow is covered by the service tests on the test DB. The reversed-period check stays covered by `period.spec.ts`.)

- [ ] **Step 6: Run everything**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx vitest run --config ./vitest.config.e2e.ts`
Expected: no type errors; all unit/integration specs PASS (67 + 6 new); e2e 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): minimal login — users, sessions, global auth guard, user CLI

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Audit log and months

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/audit/audit.service.ts`, `apps/api/src/months/months.service.ts`, `apps/api/src/months/months.controller.ts`, `apps/api/src/months/months.module.ts`
- Test: `apps/api/src/months/months.service.spec.ts`

**Interfaces:**
- Consumes: `AuthUser`, `CurrentUser` (Task 1), `DATA_START`, `tashkentDay`.
- Produces: `AuditService.record(db: Tx | PrismaService, e: { user: AuthUser; action: AuditAction; target: string; reason?: string; before?: unknown; after?: unknown })`, `AuditService.list(where: { target?: string; actionPrefix?: string })` → rows `{ id; at: string; userName; action; target; reason; before; after }` newest first; `AuditAction = 'purchase.edit' | 'purchase.delete' | 'purchase.restore' | 'month.close' | 'month.open'`; `monthOf(date: Date): string`; `MonthsService.isOpen(month)`, `assertOpen(month)` (409 «Месяц закрыт»), `list()` → `Array<{ month; closed; changedBy: string|null; changedAt: string|null }>` from `DATA_START`'s month to the current Tashkent month, `setClosed(month, closed, user)`, `history()`; routes `GET /api/months`, `POST /api/months/:month/close`, `POST /api/months/:month/open`, `GET /api/months/history`.

- [ ] **Step 1: Schema** — append:

```prisma
/// A month is open unless a row says closed. Closing is done by hand.
model Month {
  month       String    @id // YYYY-MM
  closed      Boolean   @default(false)
  changedById String?
  changedAt   DateTime?
}

/// Append-only history of edits, deletes, restores and month closing.
model AuditLog {
  id       String   @id @default(uuid())
  at       DateTime @default(now())
  userId   String
  userName String
  action   String
  target   String
  reason   String?
  before   Json?
  after    Json?

  @@index([target, at])
  @@index([action, at])
}
```

Run: `cd apps/api && npx prisma migrate dev --name months_audit && npx prisma generate`

- [ ] **Step 2: Failing tests** — `apps/api/src/months/months.service.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { MonthsService, monthOf } from './months.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const months = new MonthsService(db, audit);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };

describe('MonthsService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('takes a receipt month from its stored wall-clock date', () => {
    expect(monthOf(new Date('2026-09-30T23:30:00Z'))).toBe('2026-09');
    expect(monthOf(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10');
  });

  it('lists months from September 2026, all open until closed', async () => {
    const list = await months.list();
    expect(list[0]).toEqual({ month: '2026-09', closed: false, changedBy: null, changedAt: null });
    expect(list.map((m) => m.month)).toContain('2026-10');
  });

  it('closes and reopens a month, recording who did it', async () => {
    await months.setClosed('2026-09', true, user);
    expect(await months.isOpen('2026-09')).toBe(false);
    await expect(months.assertOpen('2026-09')).rejects.toThrow('Месяц закрыт');
    expect((await months.list())[0]).toMatchObject({ month: '2026-09', closed: true, changedBy: 'Сардорбек' });

    await months.setClosed('2026-09', false, user);
    expect(await months.isOpen('2026-09')).toBe(true);
    const h = await months.history();
    expect(h.map((e) => [e.action, e.target, e.userName])).toEqual([
      ['month.open', '2026-09', 'Сардорбек'],
      ['month.close', '2026-09', 'Сардорбек'],
    ]);
  });

  it('refuses a malformed month or one before the data start', async () => {
    await expect(months.setClosed('2026-13', true, user)).rejects.toThrow('Неверный месяц');
    await expect(months.setClosed('2026-08', true, user)).rejects.toThrow('Неверный месяц');
  });
});
```

Run: `npx vitest run src/months` → Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** — `apps/api/src/audit/audit.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth.service.js';

export type AuditAction = 'purchase.edit' | 'purchase.delete' | 'purchase.restore' | 'month.close' | 'month.open';
type Db = PrismaService | Prisma.TransactionClient;
const json = (v: unknown) => (v === undefined ? undefined : (v as Prisma.InputJsonValue));

/** Append-only: there is no update or delete here, on purpose. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    db: Db,
    e: { user: AuthUser; action: AuditAction; target: string; reason?: string; before?: unknown; after?: unknown },
  ) {
    return db.auditLog.create({
      data: {
        userId: e.user.id,
        userName: e.user.name,
        action: e.action,
        target: e.target,
        reason: e.reason ?? null,
        before: json(e.before),
        after: json(e.after),
      },
    });
  }

  async list(where: { target?: string; actionPrefix?: string }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(where.target ? { target: where.target } : {}),
        ...(where.actionPrefix ? { action: { startsWith: where.actionPrefix } } : {}),
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      userName: r.userName,
      action: r.action,
      target: r.target,
      reason: r.reason,
      before: r.before,
      after: r.after,
    }));
  }
}
```

`apps/api/src/months/months.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';
import { tashkentDay } from '../sync/salesdoc-date.js';
import { DATA_START } from '../sync/window.js';

/** Month of a stored (Tashkent wall-clock) date, as YYYY-MM. */
export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

@Injectable()
export class MonthsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async isOpen(month: string): Promise<boolean> {
    const row = await this.prisma.month.findUnique({ where: { month } });
    return !row?.closed;
  }

  async assertOpen(month: string): Promise<void> {
    if (!(await this.isOpen(month))) throw new ConflictException('Месяц закрыт');
  }

  async list() {
    const all = monthsBetween(DATA_START.slice(0, 7), tashkentDay(new Date()).slice(0, 7));
    const rows = new Map((await this.prisma.month.findMany()).map((r) => [r.month, r]));
    const ids = [...new Set([...rows.values()].map((r) => r.changedById).filter(Boolean))] as string[];
    const users = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
    );
    return all.map((month) => {
      const r = rows.get(month);
      return {
        month,
        closed: r?.closed ?? false,
        changedBy: r?.changedById ? (users.get(r.changedById) ?? null) : null,
        changedAt: r?.changedAt?.toISOString() ?? null,
      };
    });
  }

  async setClosed(month: string, closed: boolean, user: AuthUser): Promise<void> {
    const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= DATA_START.slice(0, 7);
    if (!valid) throw new BadRequestException('Неверный месяц');
    await this.prisma.$transaction(async (tx) => {
      await tx.month.upsert({
        where: { month },
        create: { month, closed, changedById: user.id, changedAt: new Date() },
        update: { closed, changedById: user.id, changedAt: new Date() },
      });
      await this.audit.record(tx, { user, action: closed ? 'month.close' : 'month.open', target: month });
    });
  }

  history() {
    return this.audit.list({ actionPrefix: 'month.' });
  }
}
```

The user name for months comes from `User`, so the months tests must create the user first: in the spec's `beforeEach`, after `truncateAll`, add
`await db.user.create({ data: { id: 'u1', login: 'sardor', name: 'Сардорбек', passwordHash: 'x' } });`.

`apps/api/src/months/months.controller.ts`:

```ts
import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { MonthsService } from './months.service.js';

@Controller('months')
export class MonthsController {
  constructor(private readonly months: MonthsService) {}

  @Get()
  list() {
    return this.months.list();
  }

  @Get('history')
  history() {
    return this.months.history();
  }

  @Post(':month/close')
  @HttpCode(204)
  close(@Param('month') month: string, @CurrentUser() user: AuthUser) {
    return this.months.setClosed(month, true, user);
  }

  @Post(':month/open')
  @HttpCode(204)
  open(@Param('month') month: string, @CurrentUser() user: AuthUser) {
    return this.months.setClosed(month, false, user);
  }
}
```

`apps/api/src/months/months.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { MonthsController } from './months.controller.js';
import { MonthsService } from './months.service.js';

@Global()
@Module({
  controllers: [MonthsController],
  providers: [AuditService, MonthsService],
  exports: [AuditService, MonthsService],
})
export class MonthsModule {}
```

Add `MonthsModule` to `AppModule.imports` after `AuthModule`.

- [ ] **Step 4: Run** — `npx tsc --noEmit -p tsconfig.json && npx vitest run` → all PASS.

- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): month closing and an append-only audit log" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 3: Delete, restore, history; hidden receipts excluded everywhere

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/warehouse/warehouse.service.ts`, `apps/api/src/warehouse/warehouse.controller.ts`, `apps/api/src/warehouse/warehouse.module.ts`, `apps/api/src/settlements/settlements.service.ts`
- Create: `apps/api/src/warehouse/purchase-edit.service.ts`
- Test: `apps/api/src/warehouse/purchase-edit.service.spec.ts`

**Interfaces:**
- Consumes: `MonthsService`, `AuditService`, `monthOf`, `AuthUser` (Tasks 1–2).
- Produces: `PurchaseEditService.remove(sdId, reason, user)`, `restore(sdId, user)`, `history(sdId)`; `WarehouseService.purchases(p, q)` gains `q.includeHidden?: boolean` and each row gains `hidden: { by: string; at: string; reason: string } | null`; `WarehouseService.purchase(sdId)` gains `hidden` (same shape) and `monthOpen: boolean`; routes `DELETE /api/warehouse/purchases/:sdId` `{reason}`, `POST /api/warehouse/purchases/:sdId/restore`, `GET /api/warehouse/purchases/:sdId/history`, `GET /api/warehouse/purchases?…&includeHidden=true`.

- [ ] **Step 1: Schema** — append:

```prisma
/// A receipt deleted in our app (Salesdoc has no delete). No FK on purpose:
/// the sync deletes and re-inserts Purchase rows, which must not erase this.
model PurchaseHidden {
  purchaseSdId String   @id
  hiddenById   String
  hiddenByName String
  hiddenAt     DateTime @default(now())
  reason       String
}
```

Run: `npx prisma migrate dev --name purchase_hidden && npx prisma generate`

- [ ] **Step 2: Failing tests** — `apps/api/src/warehouse/purchase-edit.service.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { MonthsService } from '../months/months.service.js';
import { RESOURCES } from '../sync/resources.js';
import { parsePeriod } from '../settlements/period.js';
import { SettlementsService } from '../settlements/settlements.service.js';
import type { SyncService } from '../sync/sync.service.js';
import type { SalesdocClient } from '../salesdoc/salesdoc.client.js';
import { PurchaseEditService } from './purchase-edit.service.js';
import { WarehouseService } from './warehouse.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const months = new MonthsService(db, audit);
const salesdoc = { call: vi.fn() } as unknown as SalesdocClient;
const edit = new PurchaseEditService(db, salesdoc, months, audit);
const warehouse = new WarehouseService(db);
const sync = { status: async () => ({ running: false, dataAsOf: null, resources: [] }) } as unknown as SyncService;
const settlements = new SettlementsService(db, sync);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const seenAt = new Date();
const sept = parsePeriod('2026-09-01', '2026-09-30', '2026-09-29');

async function purchase(sdId: string, day: string, total: number) {
  await db.purchase.create({
    data: { sdId, csId: `f5-${sdId}`, date: new Date(`${day}T10:00:00Z`), total, supplierSdId: '1', warehouseSdId: 'w1', raw: { priceType: { SD_id: 'd0_61' } }, seenAt },
  });
}

describe('PurchaseEditService — delete and restore', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.user.create({ data: { id: 'u1', login: 'sardor', name: 'Сардорбек', passwordHash: 'x' } });
    await db.supplier.create({ data: { sdId: '1', name: 'Основной поставщик', active: true, raw: {}, seenAt } });
    await purchase('d0_1', '2026-09-05', 100);
    await purchase('d0_2', '2026-09-06', 40);
  });
  afterAll(() => db.$disconnect());

  it('hides a deleted receipt from the list, suppliers, statement and summary', async () => {
    await edit.remove('d0_2', 'дубль', user);

    expect((await warehouse.purchases(sept, {})).rows.map((r) => r.sdId)).toEqual(['d0_1']);
    expect((await warehouse.purchases(sept, {})).total).toBe('100.00');
    expect((await settlements.suppliers(sept)).rows[0]).toMatchObject({ received: '100.00', debt: '-100.00' });
    expect((await settlements.supplierStatement(sept, '1')).closing).toBe('100.00');
    expect((await settlements.summary(sept)).supplier.received).toBe('100.00');

    const all = await warehouse.purchases(sept, { includeHidden: true });
    expect(all.rows.find((r) => r.sdId === 'd0_2')?.hidden).toMatchObject({ by: 'Сардорбек', reason: 'дубль' });
    expect((await warehouse.purchase('d0_2')).hidden).toMatchObject({ reason: 'дубль' });
  });

  it('keeps a deletion when the sync re-inserts the receipt row', async () => {
    await edit.remove('d0_2', 'дубль', user);
    const purchases = RESOURCES.find((r) => r.name === 'purchases')!;
    await db.$transaction((tx) =>
      purchases.save(tx, [{ SD_id: 'w1', date: '2026-09-06 10:00:00', purchase_id: 'f5-d0_2', shipper: { SD_id: '1' }, detail: [] }], new Date()),
    );
    expect((await warehouse.purchases(sept, {})).rows.map((r) => r.sdId)).toEqual(['d0_1']);
  });

  it('needs a reason, refuses twice, and refuses in a closed month', async () => {
    await expect(edit.remove('d0_1', '  ', user)).rejects.toThrow('Укажите причину');
    await edit.remove('d0_1', 'ошибка', user);
    await expect(edit.remove('d0_1', 'ещё раз', user)).rejects.toThrow('Накладная уже удалена');
    await months.setClosed('2026-09', true, user);
    await expect(edit.remove('d0_2', 'ошибка', user)).rejects.toThrow('Месяц закрыт');
    await expect(edit.restore('d0_1', user)).rejects.toThrow('Месяц закрыт');
  });

  it('restores while the month is open and records the whole story', async () => {
    await edit.remove('d0_2', 'дубль', user);
    await edit.restore('d0_2', user);
    expect((await warehouse.purchases(sept, {})).total).toBe('140.00');
    const h = await edit.history('d0_2');
    expect(h.map((e) => [e.action, e.userName, e.reason])).toEqual([
      ['purchase.restore', 'Сардорбек', null],
      ['purchase.delete', 'Сардорбек', 'дубль'],
    ]);
    await expect(edit.restore('d0_2', user)).rejects.toThrow('Накладная не удалена');
    await expect(edit.remove('nope', 'x', user)).rejects.toThrow('Накладная не найдена');
  });
});
```

Run: `npx vitest run src/warehouse/purchase-edit.service.spec.ts` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — `apps/api/src/warehouse/purchase-edit.service.ts` (Task 4 adds `update` to this class):

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';
import { MonthsService, monthOf } from '../months/months.service.js';
import { SalesdocClient } from '../salesdoc/salesdoc.client.js';

@Injectable()
export class PurchaseEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesdoc: SalesdocClient,
    private readonly months: MonthsService,
    private readonly audit: AuditService,
  ) {}

  private async find(sdId: string) {
    const p = await this.prisma.purchase.findUnique({ where: { sdId }, include: { lines: { orderBy: { id: 'asc' } } } });
    if (!p) throw new NotFoundException('Накладная не найдена');
    return p;
  }

  /** Hides the receipt in our app; Salesdoc's API cannot delete it. */
  async remove(sdId: string, reason: string, user: AuthUser): Promise<void> {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('Укажите причину');
    const p = await this.find(sdId);
    await this.months.assertOpen(monthOf(p.date));
    if (await this.prisma.purchaseHidden.findUnique({ where: { purchaseSdId: sdId } })) {
      throw new ConflictException('Накладная уже удалена');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseHidden.create({ data: { purchaseSdId: sdId, hiddenById: user.id, hiddenByName: user.name, reason: why } });
      await this.audit.record(tx, {
        user,
        action: 'purchase.delete',
        target: sdId,
        reason: why,
        before: { date: p.date.toISOString(), warehouseSdId: p.warehouseSdId, supplierSdId: p.supplierSdId, total: p.total.toFixed(2) },
      });
    });
  }

  async restore(sdId: string, user: AuthUser): Promise<void> {
    const p = await this.find(sdId);
    await this.months.assertOpen(monthOf(p.date));
    const hidden = await this.prisma.purchaseHidden.findUnique({ where: { purchaseSdId: sdId } });
    if (!hidden) throw new ConflictException('Накладная не удалена');
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseHidden.delete({ where: { purchaseSdId: sdId } });
      await this.audit.record(tx, { user, action: 'purchase.restore', target: sdId });
    });
  }

  history(sdId: string) {
    return this.audit.list({ target: sdId, actionPrefix: 'purchase.' });
  }
}
```

In `warehouse.service.ts`:
  - `purchases(p, q)`: add `includeHidden?: boolean` to `q`; before the query load `const hidden = new Map((await this.prisma.purchaseHidden.findMany()).map((h) => [h.purchaseSdId, h]));`; add to `where`: `...(q.includeHidden ? {} : { sdId: { notIn: [...hidden.keys()], ...(search ? { contains: search, mode: 'insensitive' } : {}) } })` — **merge** with the search filter so both apply (when `includeHidden` keep the original `...(search ? { sdId: { contains … } } : {})`); compute `total` over non-hidden rows only; each row adds `hidden: hiddenInfo(hidden.get(x.sdId))` where `const hiddenInfo = (h?: { hiddenByName: string; hiddenAt: Date; reason: string }) => (h ? { by: h.hiddenByName, at: h.hiddenAt.toISOString(), reason: h.reason } : null);`.
  - `purchase(sdId)`: add `hidden: hiddenInfo(await this.prisma.purchaseHidden.findUnique({ where: { purchaseSdId: sdId } }) ?? undefined)` and `monthOpen: !(await this.prisma.month.findUnique({ where: { month: x.date.toISOString().slice(0, 7) } }))?.closed`, plus `supplierSdId`, `warehouseSdId`, and on each line keep `productSdId` (already there).

In `settlements.service.ts` add `AND "sdId" NOT IN (SELECT "purchaseSdId" FROM "PurchaseHidden")` to the `opening` SQL of `supplierStatement` and to the `WHERE` of `suppliers`, and to the `findMany` in `supplierStatement` add `sdId: { notIn: (await this.prisma.purchaseHidden.findMany({ select: { purchaseSdId: true } })).map((h) => h.purchaseSdId) }`.

Controller (`warehouse.controller.ts`): add `includeHidden` query to `purchases` (`includeHidden: includeHidden === 'true'`), inject `PurchaseEditService`, and add:

```ts
  @Delete('purchases/:sdId')
  @HttpCode(204)
  remove(@Param('sdId') sdId: string, @Body() body: { reason?: string } = {}, @CurrentUser() user: AuthUser) {
    return this.edit.remove(sdId, body.reason ?? '', user);
  }

  @Post('purchases/:sdId/restore')
  @HttpCode(204)
  restore(@Param('sdId') sdId: string, @CurrentUser() user: AuthUser) {
    return this.edit.restore(sdId, user);
  }

  @Get('purchases/:sdId/history')
  history(@Param('sdId') sdId: string) {
    return this.edit.history(sdId);
  }
```

`warehouse.module.ts`: `imports: [SalesdocModule]`, `providers: [WarehouseService, PurchaseEditService]`.

- [ ] **Step 4: Run** — `npx tsc --noEmit -p tsconfig.json && npx vitest run` → all PASS (existing + 4 new). Run the purchases filter tests too (they are in the same suite) to confirm search still works with the hidden filter.

- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): delete and restore receipts (hidden in our app), history; hidden excluded from totals" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 4: Edit a receipt through Salesdoc; form options

**Files:**
- Modify: `apps/api/src/warehouse/purchase-edit.service.ts`, `apps/api/src/warehouse/warehouse.service.ts`, `apps/api/src/warehouse/warehouse.controller.ts`
- Test: `apps/api/src/warehouse/purchase-edit.service.spec.ts`

**Interfaces:**
- Produces: `PurchaseEditInput = { date: string /* YYYY-MM-DD */; warehouseSdId: string; supplierSdId?: string | null; lines: Array<{ productSdId: string; quantity: number; price: number }> }`; `PurchaseEditService.update(sdId, input, user)`; `WarehouseService.formOptions()` → `{ warehouses: {sdId,name}[]; suppliers: {sdId,name}[]; products: {sdId,name}[] }` (active products first, by name, ru); routes `PUT /api/warehouse/purchases/:sdId`, `GET /api/warehouse/form-options`.

- [ ] **Step 1: Failing tests** — append a second `describe` to `purchase-edit.service.spec.ts`:

```ts
describe('PurchaseEditService — edit through Salesdoc', () => {
  const call = salesdoc.call as unknown as ReturnType<typeof vi.fn>;
  const ok = { status: true, result: { completed: 1, error: 0, data: { purchase: [{ CS_id: 'f5-d0_1' }] } } };

  beforeEach(async () => {
    await truncateAll(db);
    call.mockReset();
    await db.user.create({ data: { id: 'u1', login: 'sardor', name: 'Сардорбек', passwordHash: 'x' } });
    await db.warehouse.createMany({ data: [{ sdId: 'w1', name: 'Нич', active: true, raw: {}, seenAt }, { sdId: 'w2', name: 'Импорт', active: true, raw: {}, seenAt }] });
    await db.product.createMany({ data: [{ sdId: 'p1', name: 'Дюшес 1.5', active: true, raw: {}, seenAt }, { sdId: 'p2', name: 'Тархун 1.5', active: true, raw: {}, seenAt }] });
    await db.purchase.create({
      data: {
        sdId: 'd0_1', csId: 'f5-d0_1', date: new Date('2026-10-02T15:52:51Z'), total: 100, warehouseSdId: 'w1', supplierSdId: '1',
        raw: { priceType: { SD_id: 'd0_61' } }, seenAt,
        lines: { create: [{ productSdId: 'p1', productName: 'Дюшес 1.5', quantity: 10, price: 10, amount: 100 }] },
      },
    });
  });

  const input = { date: '2026-10-03', warehouseSdId: 'w2', supplierSdId: '1', lines: [{ productSdId: 'p2', quantity: 3, price: 12.5 }] };

  it('sends setPurchase to Salesdoc, then updates our copy and records before/after', async () => {
    call.mockResolvedValue(ok);
    await edit.update('d0_1', input, user);

    expect(call).toHaveBeenCalledWith('setPurchase', {
      data: {
        purchase: [{
          CS_id: 'f5-d0_1',
          date: '2026-10-03 15:52:51',
          priceType: { SD_id: 'd0_61' },
          store: { SD_id: 'w2' },
          shipper: { SD_id: '1' },
          products: [{ SD_id: 'p2', quantity: 3, price: 12.5 }],
        }],
      },
    });
    const p = await db.purchase.findUniqueOrThrow({ where: { sdId: 'd0_1' }, include: { lines: true } });
    expect(p.warehouseSdId).toBe('w2');
    expect(p.total.toString()).toBe('37.5');
    expect(p.date.toISOString()).toBe('2026-10-03T15:52:51.000Z');
    expect(p.lines.map((l) => [l.productName, l.quantity.toString(), l.amount.toString()])).toEqual([['Тархун 1.5', '3', '37.5']]);

    const [entry] = await edit.history('d0_1');
    expect(entry).toMatchObject({ action: 'purchase.edit', userName: 'Сардорбек' });
    expect(entry.before).toMatchObject({ warehouseSdId: 'w1', lines: [{ productSdId: 'p1', quantity: '10', price: '10' }] });
    expect(entry.after).toMatchObject({ warehouseSdId: 'w2', lines: [{ productSdId: 'p2', quantity: '3', price: '12.5' }] });
  });

  it('changes nothing when Salesdoc reports an error without throwing', async () => {
    call.mockResolvedValue({ status: true, result: { completed: 0, error: 1, data: { purchase: [{ errors: ['Склад не найден'] }] } } });
    await expect(edit.update('d0_1', input, user)).rejects.toThrow('Склад не найден');
    expect((await db.purchase.findUniqueOrThrow({ where: { sdId: 'd0_1' } })).warehouseSdId).toBe('w1');
    expect(await edit.history('d0_1')).toEqual([]);
  });

  it('changes nothing when the Salesdoc call throws', async () => {
    call.mockRejectedValue(new Error('fetch failed'));
    await expect(edit.update('d0_1', input, user)).rejects.toThrow('fetch failed');
    expect((await db.purchase.findUniqueOrThrow({ where: { sdId: 'd0_1' } })).total.toString()).toBe('100');
  });

  it('refuses a move into a closed month even from an open one', async () => {
    await months.setClosed('2026-09', true, user);
    await expect(edit.update('d0_1', { ...input, date: '2026-09-30' }, user)).rejects.toThrow('Месяц закрыт');
    expect(call).not.toHaveBeenCalled();
  });

  it('validates the input before calling Salesdoc', async () => {
    await expect(edit.update('d0_1', { ...input, lines: [] }, user)).rejects.toThrow('Добавьте хотя бы одну строку');
    await expect(edit.update('d0_1', { ...input, lines: [{ productSdId: 'p2', quantity: 0, price: 1 }] }, user)).rejects.toThrow('Количество должно быть больше нуля');
    await expect(edit.update('d0_1', { ...input, lines: [{ productSdId: 'zz', quantity: 1, price: 1 }] }, user)).rejects.toThrow('Товар не найден');
    await expect(edit.update('d0_1', { ...input, warehouseSdId: 'zz' }, user)).rejects.toThrow('Склад не найден');
    await expect(edit.update('d0_1', { ...input, date: '2026-08-20' }, user)).rejects.toThrow('Дата раньше 01.09.2026');
    await edit.remove('d0_1', 'x', user);
    await expect(edit.update('d0_1', input, user)).rejects.toThrow('Накладная удалена');
    expect(call).not.toHaveBeenCalled();
  });
});
```

Run → Expected: FAIL (`edit.update is not a function`).

- [ ] **Step 2: Implement** — add to `PurchaseEditService` (imports: `BadGatewayException`, `Prisma` from `../generated/prisma/client.js`, `DATA_START` from `../sync/window.js`):

```ts
export interface PurchaseEditInput {
  date: string;
  warehouseSdId: string;
  supplierSdId?: string | null;
  lines: Array<{ productSdId: string; quantity: number; price: number }>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const snapshot = (p: { date: Date; warehouseSdId: string | null; supplierSdId: string | null; lines: Array<{ productSdId: string | null; quantity: Prisma.Decimal | number; price: Prisma.Decimal | number }> }) => ({
  date: p.date.toISOString(),
  warehouseSdId: p.warehouseSdId,
  supplierSdId: p.supplierSdId,
  lines: p.lines.map((l) => ({ productSdId: l.productSdId, quantity: String(l.quantity), price: String(l.price) })),
});
```

and the method:

```ts
  /** Writes the change to Salesdoc (setPurchase); our copy changes only after Salesdoc accepts it. */
  async update(sdId: string, input: PurchaseEditInput, user: AuthUser): Promise<void> {
    if (!DAY.test(input.date ?? '')) throw new BadRequestException('Неверная дата');
    if (input.date < DATA_START) throw new BadRequestException('Дата раньше 01.09.2026');
    if (!input.lines?.length) throw new BadRequestException('Добавьте хотя бы одну строку');
    for (const l of input.lines) {
      if (!(Number(l.quantity) > 0)) throw new BadRequestException('Количество должно быть больше нуля');
      if (!(Number(l.price) >= 0)) throw new BadRequestException('Цена не может быть отрицательной');
    }
    const p = await this.find(sdId);
    if (await this.prisma.purchaseHidden.findUnique({ where: { purchaseSdId: sdId } })) {
      throw new ConflictException('Накладная удалена');
    }
    if (!(await this.prisma.warehouse.findUnique({ where: { sdId: input.warehouseSdId } }))) {
      throw new BadRequestException('Склад не найден');
    }
    const products = new Map(
      (await this.prisma.product.findMany({ where: { sdId: { in: input.lines.map((l) => l.productSdId) } } })).map((x) => [x.sdId, x.name]),
    );
    if (input.lines.some((l) => !products.has(l.productSdId))) throw new BadRequestException('Товар не найден');
    await this.months.assertOpen(monthOf(p.date));
    await this.months.assertOpen(input.date.slice(0, 7));

    const priceType = (p.raw as { priceType?: { SD_id?: string } } | null)?.priceType?.SD_id;
    if (!priceType) throw new ConflictException('У накладной нет типа цены из Salesdoc');
    const time = p.date.toISOString().slice(11, 19);
    const res = await this.salesdoc.call<{ completed?: number; data?: { purchase?: Array<{ errors?: string[] }> } }>('setPurchase', {
      data: {
        purchase: [{
          CS_id: p.csId,
          date: `${input.date} ${time}`,
          priceType: { SD_id: priceType },
          store: { SD_id: input.warehouseSdId },
          ...(input.supplierSdId ? { shipper: { SD_id: input.supplierSdId } } : {}),
          products: input.lines.map((l) => ({ SD_id: l.productSdId, quantity: Number(l.quantity), price: Number(l.price) })),
        }],
      },
    });
    if (res.result?.completed !== 1) {
      const errors = res.result?.data?.purchase?.flatMap((x) => x.errors ?? []) ?? [];
      throw new BadGatewayException(errors.join('; ') || 'Salesdoc не принял изменения');
    }

    const lines = input.lines.map((l) => {
      const quantity = new Prisma.Decimal(l.quantity).toDecimalPlaces(3);
      const price = new Prisma.Decimal(l.price).toDecimalPlaces(2);
      return { productSdId: l.productSdId, productName: products.get(l.productSdId)!, quantity, price, amount: quantity.times(price).toDecimalPlaces(2) };
    });
    const total = lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
    const date = new Date(`${input.date}T${time}Z`);
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseLine.deleteMany({ where: { purchaseSdId: sdId } });
      await tx.purchase.update({
        where: { sdId },
        data: {
          date,
          warehouseSdId: input.warehouseSdId,
          supplierSdId: input.supplierSdId ?? null,
          total,
          lines: { create: lines },
        },
      });
      await this.audit.record(tx, {
        user,
        action: 'purchase.edit',
        target: sdId,
        before: snapshot(p),
        after: snapshot({ date, warehouseSdId: input.warehouseSdId, supplierSdId: input.supplierSdId ?? null, lines }),
      });
    });
  }
```

Note: `SalesdocClient.call` throws on `status: false` and on network errors; those propagate unchanged (the "throws" test). A thrown `SalesdocError` should reach the user as 502 — wrap the call: `try { … } catch (e) { if (e instanceof HttpException) throw e; throw new BadGatewayException(e instanceof Error ? e.message : String(e)); }` around the `this.salesdoc.call(...)` only.

`WarehouseService.formOptions()`:

```ts
  async formOptions() {
    const [warehouses, suppliers, products] = await Promise.all([
      this.prisma.warehouse.findMany({ select: { sdId: true, name: true } }),
      this.prisma.supplier.findMany({ select: { sdId: true, name: true } }),
      this.prisma.product.findMany({ select: { sdId: true, name: true, active: true } }),
    ]);
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');
    return {
      warehouses: warehouses.sort(byName),
      suppliers: suppliers.sort(byName),
      products: products
        .sort((a, b) => Number(b.active) - Number(a.active) || byName(a, b))
        .map(({ sdId, name }) => ({ sdId, name })),
    };
  }
```

Controller: `@Put('purchases/:sdId') @HttpCode(204) update(@Param('sdId') sdId, @Body() body: PurchaseEditInput, @CurrentUser() user)` → `this.edit.update(sdId, body, user)`; `@Get('form-options') formOptions()` → `this.warehouse.formOptions()` (declare it **before** `purchases/:sdId` routes is not required — different prefix).

- [ ] **Step 3: Run** — `npx tsc --noEmit -p tsconfig.json && npx vitest run && npx vitest run --config ./vitest.config.e2e.ts` → all PASS.

- [ ] **Step 4: Rebuild + restart the API window; commit** — `git add apps/api && git commit -m "feat(api): edit a receipt through Salesdoc setPurchase, with history" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 5: Login in the web app

**Files:**
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/app/sidebar.tsx`, `apps/web/src/i18n/messages.ts`
- Create: `apps/web/src/lib/session.ts`, `apps/web/src/app/login/page.tsx`, `apps/web/src/app/login/login-form.tsx`, `apps/web/src/app/login/actions.ts`, `apps/web/src/components/app/user-menu.tsx`

**Interfaces:**
- Produces: `SESSION_COOKIE = "df_session"`, `getSessionToken(): Promise<string | undefined>`, `getMe(): Promise<{ id; login; name } | null>` (never redirects); `apiGet/apiPost/apiPut/apiDelete` send `Authorization: Bearer <token>` and call `redirect("/login")` on 401; server actions `login(prev, formData)`, `logout()`; i18n keys `auth.title auth.login auth.password auth.submit auth.logout auth.bad_login`.

- [ ] **Step 1: Translations** — ru (before `"status.not_configured_hint"`): `"auth.title": "Вход"`, `"auth.login": "Логин"`, `"auth.password": "Пароль"`, `"auth.submit": "Войти"`, `"auth.logout": "Выйти"`, `"auth.bad_login": "Неверный логин или пароль"`; uz: `"auth.title": "Kirish"`, `"auth.login": "Login"`, `"auth.password": "Parol"`, `"auth.submit": "Kirish"`, `"auth.logout": "Chiqish"`, `"auth.bad_login": "Login yoki parol noto'g'ri"`.

- [ ] **Step 2: Session helpers** — `src/lib/session.ts`:

```ts
import { cookies } from "next/headers";

export const SESSION_COOKIE = "df_session";
const API_URL = process.env.API_URL ?? "http://localhost:4000/api";

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** The logged-in user, or null. Never redirects (the login page uses it too). */
export async function getMe(): Promise<{ id: string; login: string; name: string } | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}/auth/me`, { cache: "no-store", headers: { authorization: `Bearer ${token}` } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: API helper sends the token, 401 → /login** — in `src/lib/api.ts` replace `request` and the two exports:

```ts
import { redirect } from "next/navigation";
import { getSessionToken } from "./session";

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const token = await getSessionToken();
  let res: Response;
  let body: unknown = null;
  try {
    res = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      ...init,
      headers: { ...(init?.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    body = res.status === 204 ? null : await res.json().catch(() => null);
  } catch {
    return { ok: false, status: 0, message: "" };
  }
  // Outside try/catch: redirect() works by throwing.
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    const b = body as { message?: string | string[] } | null;
    const message = Array.isArray(b?.message) ? b.message.join(", ") : b?.message;
    return { ok: false, status: res.status, message: message ?? res.statusText };
  }
  return { ok: true, data: body as T };
}

export const apiGet = <T>(path: string) => request<T>(path);
const withBody = (method: string) => <T>(path: string, body?: unknown) =>
  request<T>(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPost = withBody("POST");
export const apiPut = withBody("PUT");
export const apiDelete = withBody("DELETE");
```

- [ ] **Step 4: Login page** — `src/app/login/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getSessionToken } from "@/lib/session";

const API_URL = process.env.API_URL ?? "http://localhost:4000/api";

export async function login(_: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: form.get("login"), password: form.get("password") }),
    cache: "no-store",
  }).catch(() => null);
  if (!res) return { error: "api_down" };
  if (!res.ok) return { error: "bad_login" };
  const { token } = (await res.json()) as { token: string };
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
  redirect("/");
}

export async function logout() {
  const token = await getSessionToken();
  if (token) {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
```

`src/app/login/login-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Field } from "@/components/app/field";
import { Text } from "@/components/app/text";
import { Button } from "@/components/ui/button";
import { login } from "./actions";

export function LoginForm({ labels }: { labels: { login: string; password: string; submit: string; bad_login: string; api_down: string } }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field name="login" label={labels.login} autoComplete="username" required />
      <Field name="password" type="password" label={labels.password} autoComplete="current-password" required />
      {state?.error && (
        <Text variant="error" role="alert">{state.error === "api_down" ? labels.api_down : labels.bad_login}</Text>
      )}
      <Button type="submit" disabled={pending} className="active:scale-95">
        {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {labels.submit}
      </Button>
    </form>
  );
}
```

`src/app/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { Text } from "@/components/app/text";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { getMe } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getMe()) redirect("/");
  const t = await getT();
  return (
    <div className="mx-auto mt-24 w-full max-w-sm">
      <Card>
        <CardHeader>
          <Text as="h1" variant="title">{t("auth.title")}</Text>
          <Text variant="caption">{t("app.title")}</Text>
        </CardHeader>
        <CardContent>
          <LoginForm labels={{ login: t("auth.login"), password: t("auth.password"), submit: t("auth.submit"), bad_login: t("auth.bad_login"), api_down: t("errors.api_down") }} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Sidebar shows the user and «Выйти»; hidden on /login** — `src/components/app/user-menu.tsx`:

```tsx
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Text } from "./text";

export function UserMenu({ name, label }: { name: string; label: string }) {
  return (
    <form action={logout} className="flex items-center justify-between gap-2">
      <Text variant="caption" truncate>{name}</Text>
      <Button type="submit" variant="ghost" size="sm" className="active:scale-95">{label}</Button>
    </form>
  );
}
```

In `sidebar.tsx` add at the top of `Sidebar`: `if (pathname === "/login") return null;`.
In `layout.tsx`: `const me = await getMe();` and pass `footer={<div className="flex flex-col gap-3">{me && <UserMenu name={me.name} label={t("auth.logout")} />}<LocaleSwitch … /></div>}`.

- [ ] **Step 6: Check** — `cd apps/web && npx next typegen && npx tsc --noEmit && npx eslint src` (no filtering of the output). Browser: create a test user first (Task 8 step 1 creates the owner's; here run `npm run user:add -w @df/api` yourself only if the owner agrees — otherwise verify with a user the owner created). Expected: `/` without a cookie lands on `/login` with no sidebar and no redirect loop; a wrong password shows «Неверный логин или пароль»; the right one opens Сверка with the name and «Выйти» in the sidebar; «Выйти» returns to `/login`.

- [ ] **Step 7: Commit** — `git add apps/web && git commit -m "feat(web): login page, session cookie, user and logout in the sidebar" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 6: Months page

**Files:**
- Create: `apps/web/src/app/settings/months/page.tsx`, `apps/web/src/app/settings/months/actions.ts`, `apps/web/src/app/settings/months/month-button.tsx`, `apps/web/src/components/app/history-list.tsx`
- Modify: `apps/web/src/app/layout.tsx` (nav item), `apps/web/src/i18n/messages.ts`, `apps/web/src/lib/api.ts` (types)

**Interfaces:**
- Consumes: Task 2 routes; `apiPost`.
- Produces: types `MonthRow = { month; closed; changedBy: string|null; changedAt: string|null }`, `AuditEntry = { id; at; userName; action; target; reason: string|null; before: unknown; after: unknown }`; `<HistoryList entries labels />` (reused by Task 7); server action `setMonth(month, closed)`.

- [ ] **Step 1: Translations** (ru / uz): `nav.months` «Закрытие месяца» / «Oyni yopish»; `months.month` «Месяц» / «Oy»; `months.status` «Статус» / «Holat»; `months.open` «Открыт» / «Ochiq»; `months.closed` «Закрыт» / «Yopiq»; `months.changed` «Изменил» / «O'zgartirdi»; `months.close` «Закрыть» / «Yopish»; `months.reopen` «Открыть» / «Ochish»; `months.confirm_close` «Закрыть {month}? Накладные этого месяца нельзя будет менять.» / «{month} yopilsinmi? Bu oy yuk xatlarini o'zgartirib bo'lmaydi.»; `months.confirm_open` «Открыть {month} снова?» / «{month} qayta ochilsinmi?»; `history.title` «История» / «Tarix»; `history.empty` «Изменений нет» / «O'zgarishlar yo'q»; `history.action.purchase.edit` «Изменена» / «O'zgartirildi»; `history.action.purchase.delete` «Удалена» / «O'chirildi»; `history.action.purchase.restore` «Восстановлена» / «Tiklandi»; `history.action.month.close` «Месяц закрыт» / «Oy yopildi»; `history.action.month.open` «Месяц открыт» / «Oy ochildi»; `common.confirm` «Подтвердить» / «Tasdiqlash»; `common.cancel` «Отмена» / «Bekor qilish». Month names are composed by hand (memory rule: no Intl month names) with a `months.names` list per locale: ru «Январь…Декабрь», uz «Yanvar, Fevral, Mart, Aprel, May, Iyun, Iyul, Avgust, Sentabr, Oktabr, Noyabr, Dekabr» — add as keys `month.1` … `month.12`.

- [ ] **Step 2: Add the dialog component** — `cd apps/web && npx shadcn@latest add dialog -y` (keep its generated imports as they are).

- [ ] **Step 3: Pages and components** — `history-list.tsx` (server component): a list of entries, newest first: `dd.MM.yyyy HH:mm` (real instant → Tashkent: `formatDateTime(new Date(Date.parse(at) + 5*3600e3).toISOString())`), user name, translated action, reason; for `purchase.edit` a `<details>` block listing before → after for date, warehouse, supplier and lines (`productSdId quantity × price`). Empty → `history.empty`.

`months/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { apiPost } from "@/lib/api";

export async function setMonth(month: string, closed: boolean): Promise<{ ok: boolean; message?: string }> {
  const res = await apiPost(`/months/${month}/${closed ? "close" : "open"}`);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, message: res.message };
}
```

`month-button.tsx` (client): a Button opening a Dialog with the confirm text, «Отмена» and «Подтвердить»; confirm calls `setMonth` in `useTransition`, shows a spinner, closes on success, shows the error under the buttons on failure.

`months/page.tsx`: StickyToolbar + PageHeader «Закрытие месяца»; table Месяц («Сентябрь 2026») · Статус (Badge) · Изменил («name, dd.MM.yyyy HH:mm» or «—») · button (`MonthButton` close/reopen); below, `HistoryList` of `GET /months/history`.

Nav: add `{ href: "/settings/months", label: t("nav.months") }` after the sync item.

- [ ] **Step 4: Check and browser-test** — typecheck, lint (unfiltered); browser: close September with confirm → status «Закрыт», name and time shown, history entry appears; reopen → «Открыт» + second entry; ru/uz; 390 px.

- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): month closing page with history" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 7: Edit, delete, restore and history on receipts

**Files:**
- Create: `apps/web/src/app/zakupki/nakladnye/[sdId]/edit/page.tsx`, `apps/web/src/app/zakupki/nakladnye/[sdId]/receipt-editor.tsx`, `apps/web/src/app/zakupki/nakladnye/[sdId]/receipt-actions.tsx`, `apps/web/src/app/zakupki/nakladnye/actions.ts`, `apps/web/src/components/app/product-picker.tsx`
- Modify: `apps/web/src/app/zakupki/nakladnye/[sdId]/page.tsx`, `apps/web/src/app/zakupki/nakladnye/page.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/i18n/messages.ts`

**Interfaces:**
- Consumes: Task 3/4 routes, Task 6 `HistoryList`, `DateField`, `Select`, `Field`, dialog.
- Produces: server actions `saveReceipt(sdId, input)`, `deleteReceipt(sdId, reason)`, `restoreReceipt(sdId)` → `{ ok: boolean; message?: string }`; `<ProductPicker value onChange products label />`.

- [ ] **Step 1: Translations** (ru / uz): `receipt.edit` «Редактировать» / «Tahrirlash»; `receipt.delete` «Удалить» / «O'chirish»; `receipt.restore` «Восстановить» / «Tiklash»; `receipt.save` «Сохранить» / «Saqlash»; `receipt.add_line` «Добавить строку» / «Qator qo'shish»; `receipt.remove_line` «Убрать строку» / «Qatorni olib tashlash»; `receipt.reason` «Причина удаления» / «O'chirish sababi»; `receipt.confirm_delete` «Удалить накладную {number}? В Salesdoc она останется, у нас — исчезнет из всех итогов.» / «{number} yuk xati o'chirilsinmi? Salesdoc'da qoladi, bizda hamma jamlardan chiqariladi.»; `receipt.deleted_banner` «Удалена: {by}, {at}. Причина: {reason}» / «O'chirilgan: {by}, {at}. Sabab: {reason}»; `receipt.month_closed` «Месяц закрыт — изменения недоступны» / «Oy yopiq — o'zgartirib bo'lmaydi»; `receipt.salesdoc_note` «Сохранение изменит накладную и остатки в Salesdoc» / «Saqlash Salesdoc'dagi yuk xati va qoldiqlarni o'zgartiradi»; `receipt.show_deleted` «Показать удалённые» / «O'chirilganlarni ko'rsatish»; `errors.required` «Заполните поле» / «Maydonni to'ldiring»; `errors.positive` «Должно быть больше нуля» / «Noldan katta bo'lishi kerak»; `errors.not_negative` «Не может быть отрицательным» / «Manfiy bo'lishi mumkin emas».

- [ ] **Step 2: Types** — in `lib/api.ts` extend `PurchaseDetail` with `supplierSdId: string | null; warehouseSdId: string | null; monthOpen: boolean; hidden: { by: string; at: string; reason: string } | null`; extend `PurchaseList.rows[]` with `hidden` (same shape); add `FormOptions = { warehouses: {sdId,name}[]; suppliers: {sdId,name}[]; products: {sdId,name}[] }` and the `AuditEntry` from Task 6.

- [ ] **Step 3: Server actions** — `zakupki/nakladnye/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { apiDelete, apiPost, apiPut } from "@/lib/api";

type Result = { ok: boolean; message?: string };
const done = (res: { ok: boolean; message?: string }): Result => {
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, message: res.message };
};

export async function saveReceipt(
  sdId: string,
  input: { date: string; warehouseSdId: string; supplierSdId: string | null; lines: Array<{ productSdId: string; quantity: number; price: number }> },
): Promise<Result> {
  return done(await apiPut(`/warehouse/purchases/${encodeURIComponent(sdId)}`, input));
}

export async function deleteReceipt(sdId: string, reason: string): Promise<Result> {
  return done(await apiDelete(`/warehouse/purchases/${encodeURIComponent(sdId)}`, { reason }));
}

export async function restoreReceipt(sdId: string): Promise<Result> {
  return done(await apiPost(`/warehouse/purchases/${encodeURIComponent(sdId)}/restore`));
}
```

- [ ] **Step 4: Product picker** — `components/app/product-picker.tsx` (client): a `Popover` whose trigger shows the chosen product name (or the label as placeholder), content = an `Input` filtering by substring (case-insensitive) and up to 50 matching products as buttons; picking one calls `onChange(sdId)` and closes. Same height/look as `Select`; `aria-label` from `label`.

- [ ] **Step 5: Editor** — `receipt-editor.tsx` (client), props `{ sdId, initial: { date; warehouseSdId; supplierSdId; lines: {productSdId, quantity, price}[] }, options: FormOptions, labels, locale }`:
  - Header: `Select` Склад, `Select` Поставщик (with «—» for none), `DateField` Дата (min 2026-09-01).
  - Lines table: № · `ProductPicker` · quantity `Input type=number step=any` · price `Input` · amount (computed, `Money`) · remove button; «Добавить строку»; Итого.
  - Validation on submit, each error under its own field (required product, quantity > 0, price ≥ 0, at least one line); the server's message (e.g. «Месяц закрыт», Salesdoc's error) in one alert above «Сохранить».
  - Caption `receipt.salesdoc_note` next to the button; «Сохранить» disabled with a spinner while saving; success → `router.push('/zakupki/nakladnye/<sdId>')`.

`[sdId]/edit/page.tsx` (server): loads `PurchaseDetail` and `FormOptions`; if `!monthOpen` or `hidden` → shows `receipt.month_closed` / banner instead of the form; otherwise renders the editor with the current values.

- [ ] **Step 6: Actions on the накладная page** — `receipt-actions.tsx` (client), props `{ sdId, number, monthOpen, hidden, labels }`:
  - `monthOpen && !hidden`: link-button «Редактировать» (`/zakupki/nakladnye/<sdId>/edit`) and «Удалить» → Dialog with the confirm text and a required reason (`Field`, error under it) → `deleteReceipt`; spinner; error shown in the dialog.
  - `monthOpen && hidden`: «Восстановить» → `restoreReceipt`.
  - `!monthOpen`: caption `receipt.month_closed`.

In `[sdId]/page.tsx`: render `ReceiptActions` in the page header; when `hidden` show a banner `receipt.deleted_banner`; below the goods table render `HistoryList` from `GET /warehouse/purchases/<sdId>/history`.

- [ ] **Step 7: Deleted receipts in the list** — in `zakupki/nakladnye/page.tsx` add `CheckboxField name="includeHidden" label={t("receipt.show_deleted")}` to the filter form and pass `includeHidden` to the API; a hidden row renders with `line-through text-muted-foreground` and a caption under the number with `receipt.deleted_banner`.

- [ ] **Step 8: Check and browser-test** — typecheck, lint (unfiltered), web tests. Browser (with a logged-in user; **no real save** — Salesdoc must not be written during development): open a receipt in an open month → Редактировать shows the form with current values; changing quantity updates amount and Итого; empty product / zero quantity show errors under the fields; delete with an empty reason is refused, with a reason hides it (list without it, «Показать удалённые» shows it struck through, Поставщики total drops); restore brings it back; history lists delete and restore with the user's name; close the month → buttons disappear and the page says «Месяц закрыт»; ru/uz; 390 px.

- [ ] **Step 9: Commit** — `git add apps/web && git commit -m "feat(web): edit, delete, restore and history on приходные накладные" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 8: Owner steps — first user and the one real Salesdoc write

**Files:** none (operational); ledger notes.

- [ ] **Step 1: The owner creates the first user** — the owner runs in their own terminal (password typed hidden):

```
cd D:\goodland\distribution-finance
npm run user:add -w @df/api
```

Expected: «Создан пользователь <login>»; logging in at http://localhost:3000/login works.

- [ ] **Step 2: Approved round-trip** — ask the owner to approve one real `setPurchase` call that re-sends one existing October receipt **unchanged** (same date, warehouse, supplier, lines). On approval: open that receipt's edit page and press «Сохранить» without changes. Expected: success; a `purchase.edit` history entry with identical before/after; the next sync (or «Синхронизировать») shows the receipt unchanged in Salesdoc's numbers (total and lines equal). If Salesdoc refuses (e.g. identifier or price type not accepted), record its message, stop, and report — do not retry with other identifiers without the owner.

- [ ] **Step 3: Record** — ledger note with the receipt id, the time, and the result.
