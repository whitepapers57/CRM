import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';
import { MonthsService, monthOf } from '../months/months.service.js';
import { tashkentDay } from '../sync/salesdoc-date.js';
import { DATA_START } from '../sync/window.js';
import { CashRefsService, type Account } from './cash-refs.service.js';
import { OPERATIONS, cashNumber, isOp, type OpCode } from './operations.js';

export interface CashInput {
  operation: OpCode;
  account: Account;
  date: string;
  amount: number | string;
  cashboxSdId?: string | null;
  bankAccountId?: string | null;
  targetBankAccountId?: string | null;
  supplierSdId?: string | null;
  outletSdId?: string | null;
  categoryId?: string | null;
  counterpartyName?: string | null;
  comment?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: string) => DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const s2 = (v: Prisma.Decimal) => v.toFixed(2);
const blank = (v?: string | null) => (v?.trim() ? v.trim() : null);

const MAX_AMOUNT = new Prisma.Decimal('1e16');
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;
/** A finite number, or a plain decimal string; anything else counts as zero (rejected by the caller). */
function parseAmount(v: unknown): Prisma.Decimal {
  if (typeof v === 'number' && Number.isFinite(v)) return new Prisma.Decimal(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (PLAIN_NUMBER.test(t)) return new Prisma.Decimal(t);
    const n = Number(t);
    // «1e17» is not a plain number, but say "too big" rather than "zero".
    if (t && Number.isFinite(n) && n >= 1e16) return new Prisma.Decimal(n);
  }
  return new Prisma.Decimal(0);
}

type Row = Prisma.CashOperationGetPayload<object>;
const snapshot = (o: Pick<Row, 'date' | 'amount' | 'account' | 'cashboxSdId' | 'bankAccountId' | 'supplierSdId' | 'outletSdId' | 'categoryId' | 'counterpartyName' | 'comment'>) => ({
  date: o.date.toISOString().slice(0, 10),
  amount: s2(new Prisma.Decimal(o.amount)),
  account: o.account,
  cashboxSdId: o.cashboxSdId,
  bankAccountId: o.bankAccountId,
  supplierSdId: o.supplierSdId,
  outletSdId: o.outletSdId,
  categoryId: o.categoryId,
  counterpartyName: o.counterpartyName,
  comment: o.comment,
});

/** Cash and bank operations entered in our app (spec §3–4). */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly months: MonthsService,
    private readonly audit: AuditService,
    private readonly refs: CashRefsService,
  ) {}

  /** Validates and normalises an input; throws the first problem, in form order. */
  private async clean(input: CashInput) {
    if (!isOp(input.operation)) throw new BadRequestException('Неверная операция');
    const def = OPERATIONS[input.operation];
    if (!(def.accounts as readonly string[]).includes(input.account)) throw new BadRequestException('Операция недоступна для этого счёта');
    if (!isDay(input.date ?? '')) throw new BadRequestException('Неверная дата');
    if (input.date < DATA_START) throw new BadRequestException('Дата раньше 01.09.2026');
    if (input.date > tashkentDay(new Date())) throw new BadRequestException('Дата в будущем');
    const amount = parseAmount(input.amount);
    if (amount.gte(MAX_AMOUNT)) throw new BadRequestException('Сумма слишком большая');
    if (!amount.gt(0)) throw new BadRequestException('Сумма должна быть больше нуля');
    if (amount.decimalPlaces() > 2) throw new BadRequestException('Сумма: не больше 2 знаков после запятой');

    let cashboxSdId: string | null = null;
    let bankAccountId: string | null = null;
    if (input.account === 'cash') {
      cashboxSdId = blank(input.cashboxSdId);
      if (!cashboxSdId) throw new BadRequestException('Выберите кассу');
      if (!(await this.prisma.cashbox.findUnique({ where: { sdId: cashboxSdId } }))) throw new BadRequestException('Касса не найдена');
      if ('bankTarget' in def) {
        bankAccountId = blank(input.targetBankAccountId ?? input.bankAccountId);
        if (!bankAccountId) throw new BadRequestException('Выберите счёт для взноса');
      }
    } else {
      bankAccountId = blank(input.bankAccountId);
      if (!bankAccountId) throw new BadRequestException('Выберите счёт');
    }
    if (bankAccountId && !(await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } }))) throw new BadRequestException('Счёт не найден');

    const out = { supplierSdId: null as string | null, outletSdId: null as string | null, categoryId: null as string | null, counterpartyName: null as string | null };
    switch (def.needs) {
      case 'supplier':
        out.supplierSdId = blank(input.supplierSdId);
        if (!out.supplierSdId) throw new BadRequestException('Выберите поставщика');
        if (!(await this.prisma.supplier.findUnique({ where: { sdId: out.supplierSdId } }))) throw new BadRequestException('Поставщик не найден');
        break;
      case 'outlet':
        out.outletSdId = blank(input.outletSdId);
        if (!out.outletSdId) throw new BadRequestException('Выберите покупателя');
        if (!(await this.prisma.outlet.findUnique({ where: { sdId: out.outletSdId } }))) throw new BadRequestException('Покупатель не найден');
        break;
      case 'expenseCategory':
      case 'incomeCategory': {
        out.categoryId = blank(input.categoryId);
        const cat = out.categoryId ? await this.prisma.cashCategory.findUnique({ where: { id: out.categoryId } }) : null;
        if (!cat || cat.kind !== (def.needs === 'expenseCategory' ? 'expense' : 'income')) throw new BadRequestException(out.categoryId && !cat ? 'Статья не найдена' : 'Выберите статью');
        break;
      }
      case 'name':
        out.counterpartyName = blank(input.counterpartyName);
        if (!out.counterpartyName) throw new BadRequestException('Укажите кому / от кого');
        break;
    }
    return {
      operation: input.operation,
      direction: def.direction,
      account: input.account,
      cashboxSdId,
      bankAccountId,
      date: new Date(`${input.date}T00:00:00Z`),
      amount,
      comment: blank(input.comment),
      ...out,
    };
  }

  private async find(id: string) {
    const o = await this.prisma.cashOperation.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Операция не найдена');
    return o;
  }

  async create(input: CashInput, user: AuthUser): Promise<{ id: string; number: string }> {
    const data = await this.clean(input);
    await this.months.assertOpen(monthOf(data.date));
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.cashOperation.create({ data: { ...data, createdById: user.id, createdByName: user.name } });
      await this.audit.record(tx, { user, action: 'cash.create', target: o.id, after: snapshot(o) });
      return { id: o.id, number: cashNumber(o.seq) };
    });
  }

  async update(id: string, input: CashInput, user: AuthUser): Promise<void> {
    const o = await this.find(id);
    if (o.cancelledAt) throw new ConflictException('Операция отменена');
    if (input.operation !== o.operation) throw new BadRequestException('Вид операции не меняется');
    const data = await this.clean(input);
    await this.months.assertOpen(monthOf(o.date));
    await this.months.assertOpen(monthOf(data.date));
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.cashOperation.update({ where: { id }, data });
      await this.audit.record(tx, { user, action: 'cash.edit', target: id, before: snapshot(o), after: snapshot(n) });
    });
  }

  async cancel(id: string, reason: string, user: AuthUser): Promise<void> {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('Укажите причину');
    const o = await this.find(id);
    await this.months.assertOpen(monthOf(o.date));
    await this.prisma.$transaction(async (tx) => {
      // Guarded update: two cancels at once — the second matches nothing.
      const r = await tx.cashOperation.updateMany({
        where: { id, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelledById: user.id, cancelledByName: user.name, cancelReason: why },
      });
      if (!r.count) throw new ConflictException('Операция уже отменена');
      await this.audit.record(tx, { user, action: 'cash.cancel', target: id, reason: why });
    });
  }

  async restore(id: string, user: AuthUser): Promise<void> {
    const o = await this.find(id);
    await this.months.assertOpen(monthOf(o.date));
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.cashOperation.updateMany({
        where: { id, cancelledAt: { not: null } },
        data: { cancelledAt: null, cancelledById: null, cancelledByName: null, cancelReason: null },
      });
      if (!r.count) throw new ConflictException('Операция не отменена');
      await this.audit.record(tx, { user, action: 'cash.restore', target: id });
    });
  }

  async get(id: string) {
    const o = await this.find(id);
    const names = await this.names([o]);
    const month = await this.prisma.month.findUnique({ where: { month: monthOf(o.date) } });
    return { ...this.view(o, names), monthOpen: !month?.closed };
  }

  /** Display names for a batch of operations. */
  private async names(ops: Row[]) {
    const ids = (k: keyof Row) => [...new Set(ops.map((o) => o[k]).filter((v): v is string => typeof v === 'string'))];
    const [sup, out, cat, box, acc] = await Promise.all([
      this.prisma.supplier.findMany({ where: { sdId: { in: ids('supplierSdId') } }, select: { sdId: true, name: true } }),
      this.prisma.outlet.findMany({ where: { sdId: { in: ids('outletSdId') } }, select: { sdId: true, name: true } }),
      this.prisma.cashCategory.findMany({ where: { id: { in: ids('categoryId') } }, select: { id: true, name: true } }),
      this.prisma.cashbox.findMany({ where: { sdId: { in: ids('cashboxSdId') } }, select: { sdId: true, name: true } }),
      this.prisma.bankAccount.findMany({ where: { id: { in: ids('bankAccountId') } }, select: { id: true, name: true } }),
    ]);
    return {
      supplier: new Map(sup.map((x) => [x.sdId, x.name])),
      outlet: new Map(out.map((x) => [x.sdId, x.name])),
      category: new Map(cat.map((x) => [x.id, x.name])),
      cashbox: new Map(box.map((x) => [x.sdId, x.name])),
      bank: new Map(acc.map((x) => [x.id, x.name])),
    };
  }

  private view(o: Row, n: Awaited<ReturnType<CashService['names']>>) {
    const party =
      (o.supplierSdId && n.supplier.get(o.supplierSdId)) ||
      (o.outletSdId && n.outlet.get(o.outletSdId)) ||
      (o.categoryId && n.category.get(o.categoryId)) ||
      o.counterpartyName ||
      null;
    return {
      id: o.id,
      number: cashNumber(o.seq),
      source: 'app' as 'app' | 'salesdoc',
      operation: o.operation,
      direction: o.direction,
      account: o.account,
      date: o.date.toISOString().slice(0, 10),
      amount: s2(o.amount),
      cashboxSdId: o.cashboxSdId,
      cashboxName: o.cashboxSdId ? (n.cashbox.get(o.cashboxSdId) ?? o.cashboxSdId) : null,
      bankAccountId: o.bankAccountId,
      bankAccountName: o.bankAccountId ? (n.bank.get(o.bankAccountId) ?? null) : null,
      supplierSdId: o.supplierSdId,
      supplierName: o.supplierSdId ? (n.supplier.get(o.supplierSdId) ?? o.supplierSdId) : null,
      outletSdId: o.outletSdId,
      categoryId: o.categoryId,
      counterpartyName: o.counterpartyName,
      party,
      comment: o.comment,
      createdByName: o.createdByName,
      cancelled: o.cancelledAt ? { by: o.cancelledByName ?? '', at: o.cancelledAt.toISOString(), reason: o.cancelReason ?? '' } : null,
    };
  }
}
