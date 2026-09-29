import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { SalesdocClient } from '../salesdoc/salesdoc.client.js';
import { RESOURCES, type ResourceDef } from './resources.js';
import { tashkentDay } from './salesdoc-date.js';
import { syncWindow } from './window.js';

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
/** Resources whose rows are outlet movements (spec §4.1). */
const MOVEMENT_RESOURCES = ['orders', 'returns', 'payments'];
/**
 * Prisma cancels an interactive transaction after 5 s by default; a real page
 * of 1,000 orders with their lines took 8.6 s to save, and pruning a full
 * pass can delete tens of thousands of rows.
 */
const TX = { timeout: 5 * 60 * 1000, maxWait: 30 * 1000 };

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

  private queuedFull: Promise<SyncReport> | null = null;

  /**
   * One run at a time. A second incremental request is dropped (the next tick
   * covers it), but a full run queues behind the running one: the nightly
   * pass is what prunes deleted and out-of-window records, so it must not be
   * lost to a collision with the 15-minute tick.
   */
  run(kind: SyncKind): Promise<SyncReport | { alreadyRunning: true }> {
    if (this.running) {
      if (kind !== 'full') return Promise.resolve({ alreadyRunning: true });
      this.queuedFull ??= this.running
        .catch(() => undefined)
        .then(() => {
          this.queuedFull = null;
          return this.start('full');
        });
      return this.queuedFull;
    }
    return this.start(kind);
  }

  private start(kind: SyncKind): Promise<SyncReport> {
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
        const failedMovements = results
          .filter((r) => r.status === 'failed' && MOVEMENT_RESOURCES.includes(r.resource))
          .map((r) => r.resource);
        if (def.name === 'balances' && failedMovements.length) {
          // The anchor must describe the same moment as the stored movements.
          throw new Error(`skipped: ${failedMovements.join(', ')} failed in this run`);
        }
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

    const window = syncWindow(this.now());
    const filter = {
      ...(def.filter ?? {}),
      ...(def.dated ? def.dated(window.fetchFrom, window.to) : {}),
    };

    let records = 0;
    for await (const { page, rows } of this.client.pages(def.method, def.resultKey, {
      page: firstPage,
      ...(Object.keys(filter).length ? { filter } : {}),
    })) {
      const seenAt = this.now();
      records += await this.prisma.$transaction(async (tx) => {
        const n = await def.save(tx, rows as Record<string, unknown>[], seenAt);
        await tx.syncCursor.update({ where: { resource: def.name }, data: { nextPage: page + 1 } });
        return n;
      }, TX);
    }

    const { seen, stale } = await this.prisma.$transaction((tx) => def.seen(tx, startedAt));
    if (seen === 0 && stale > 0) {
      // A sudden empty answer is far likelier a Salesdoc glitch than a wiped
      // account; pruning would erase the mirror (and every balance anchor).
      await this.prisma.syncCursor.update({
        where: { resource: def.name },
        data: { fullStartedAt: null, nextPage: null },
      });
      throw new Error(
        `Salesdoc returned no rows for ${def.method}; refusing to prune ${stale} stored rows`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await def.prune(tx, startedAt);
      await tx.syncCursor.update({
        where: { resource: def.name },
        data: { lastSuccessAt: startedAt, fullStartedAt: null, nextPage: null },
      });
    }, TX);
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
      records += await this.prisma.$transaction(
        (tx) => def.save(tx, rows as Record<string, unknown>[], seenAt),
        TX,
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
